"""A stored session id that no longer resolves must not fail the idea forever (1.7).

`start_agent` passes `--resume <id>` whenever `state/sessions/<slug>.id` exists. When that
conversation is gone — expired, or its transcript deleted — `claude` exits immediately with
`No conversation found with session ID: <id>` on stderr. Nothing ever rewrote or deleted that
file on failure, so the idea failed the same way every cycle, forever.

It failed invisibly in its own way, too: stderr was inherited rather than captured, no result
JSON was written, and the run landed in the "produced no result JSON (agent stopped)" warning
— which says the agent was *killed*, the opposite of what happened.

The recovery is bounded on purpose: one probe pass for the whole set of agents, one respawn
per agent per cycle, and only for this signature. An agent that died of the model limit is not
restarted — that would burn another five seconds to produce a second identical failure.
"""

from __future__ import annotations

import contextlib
import io
import json

from tests import support

# A stub that refuses --resume the way the real CLI does, and otherwise succeeds. It writes
# the result JSON to stdout, which the orchestrator redirects into the agent's out_file.
REFUSE_RESUME = """
for arg in "$@"; do
    if [ "$arg" = "--resume" ]; then
        echo "No conversation found with session ID: dead-session-id" >&2
        exit 1
    fi
done
cat <<'JSON'
%s
JSON
""" % json.dumps(support.HEALTHY_RESULT)

# The model limit: fails fast, but not for a reason a respawn could fix.
ALWAYS_LIMIT = """
cat <<'JSON'
%s
JSON
exit 0
""" % json.dumps(support.LIMIT_RESULT)


class ResumeFallbackTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo
        # The fixture already made the worktree; start_agent makes its own.
        support.git("worktree", "remove", "--force",
                    str(self.repo / ".orchestrator" / "worktrees" / "demo"), cwd=self.repo)
        self.orch = self.orchestrator(self.repo)
        self.session_file = self.repo / ".orchestrator" / "sessions" / "demo.id"
        self.session_file.parent.mkdir(parents=True, exist_ok=True)

    def store_session(self, session_id: str = "dead-session-id") -> None:
        self.session_file.write_text(session_id)

    def run_cycle(self) -> str:
        """Start the agent, let the probe pass run, and wait for whatever it left running."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.orch.agents.append(self.orch.start_agent("demo"))
            self.orch.recover_dead_sessions()
            for agent in self.orch.agents:
                if agent.process:
                    agent.process.wait()
        return out.getvalue()

    # -- the dead session -------------------------------------------------------------

    def test_a_dead_session_is_dropped_and_the_agent_respawned_without_resume(self) -> None:
        stub = self.stub_claude(REFUSE_RESUME)
        self.store_session()

        output = self.run_cycle()

        self.assertTrue(stub.log_file.exists(), "the stub never ran — is it on PATH?")
        self.assertEqual(stub.calls, 2, f"expected one refused run and one retry: {stub.invocations()}")
        self.assertIn("--resume dead-session-id", stub.invocations()[0])
        self.assertNotIn("--resume", stub.invocations()[1], "the retry must start fresh")
        self.assertFalse(self.session_file.exists(),
                         "a session id proven not to resolve must not be kept")
        self.assertIn("no longer exists", output)
        self.assertIn("fresh conversation", output)

    def test_the_respawned_agents_result_is_the_one_finalize_reads(self) -> None:
        self.stub_claude(REFUSE_RESUME)
        self.store_session()

        self.run_cycle()

        agent = self.orch.agents[0]
        self.assertEqual(agent.load_result().get("session_id"),
                         support.HEALTHY_RESULT["session_id"],
                         "the out_file must hold the retry's result, not the failure")

    def test_stderr_is_captured_and_the_respawn_does_not_erase_it(self) -> None:
        """The reason for the retry is in the first run's stderr; reopening "w" wiped it."""
        self.stub_claude(REFUSE_RESUME)
        self.store_session()

        self.run_cycle()

        errors = sorted((self.repo / ".orchestrator" / "logs").glob("*.err"))
        self.assertTrue(errors, "the agent's stderr was not captured anywhere")
        captured = "\n".join(path.read_text() for path in errors)
        self.assertIn("No conversation found", captured,
                      "the respawn truncated the evidence that explains it")

    # -- not every fast exit is a dead session ----------------------------------------

    def test_a_model_limit_failure_is_not_respawned(self) -> None:
        stub = self.stub_claude(ALWAYS_LIMIT)
        self.store_session("live-session-id")

        output = self.run_cycle()

        self.assertEqual(stub.calls, 1, "a limit failure must not be retried")
        self.assertTrue(self.session_file.is_file(), "its session id is still good")
        self.assertEqual(self.session_file.read_text(), "live-session-id")
        self.assertNotIn("fresh conversation", output)

    def test_an_agent_that_is_still_working_is_left_alone(self) -> None:
        """The probe inspects poll(); it must never wait on a healthy agent."""
        stub = self.stub_claude("sleep 30\nexit 0")
        self.store_session("live-session-id")

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            agent = self.orch.start_agent("demo")
            self.orch.agents.append(agent)
            self.orch.recover_dead_sessions()
            still_running = agent.process.poll() is None
            agent.process.kill()
            agent.process.wait()

        self.assertTrue(still_running, "the probe killed or waited on a working agent")
        self.assertEqual(stub.calls, 1)
        self.assertTrue(self.session_file.is_file())

    def test_no_session_file_means_nothing_to_recover(self) -> None:
        stub = self.stub_claude(REFUSE_RESUME)

        output = self.run_cycle()

        self.assertEqual(stub.calls, 1)
        self.assertNotIn("--resume", stub.invocations()[0])
        self.assertNotIn("fresh conversation", output)

    def test_the_respawn_happens_at_most_once(self) -> None:
        """A stub that refuses everything must not be restarted in a loop."""
        stub = self.stub_claude(
            'echo "No conversation found with session ID: whatever" >&2\nexit 1')
        self.store_session()

        self.run_cycle()

        self.assertEqual(stub.calls, 2, f"respawned more than once: {stub.invocations()}")
