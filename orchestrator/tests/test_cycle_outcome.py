"""A cycle in which every agent failed is not a successful cycle (orchestrator 1.7).

`run()` started the agents, finalized each one and returned 0 unconditionally. A cycle where
both agents died in five seconds exited green, systemd recorded a clean run, and the only
durable trace was a couple of $0.0 commits. That is the top-level version of the same bug the
rest of this entry is about.

The answered open question settles the contract: all agents failed means a non-zero exit, so
the run shows up in `systemctl --failed` for someone who is not reading the journal. Some
failed, some worked means exit 0 with a WARNING, because real work landed. Either way the
`finally` block still pushes and releases the lock — the exit code is the last thing that
changes and is never a reason to skip cleanup.
"""

from __future__ import annotations

import contextlib
import io
import json

import orchestrator as orch
from tests import support


class CycleOutcomeTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo
        self.orch = self.orchestrator(self.repo)

    def agent_with(self, slug: str, result: dict | None) -> orch.Agent:
        """An agent that has already run, with the result JSON it left behind."""
        out_file = self.repo / ".orchestrator" / "logs" / f"{slug}.json"
        out_file.parent.mkdir(parents=True, exist_ok=True)
        if result is not None:
            out_file.write_text(json.dumps(result))
        agent = orch.Agent(slug=slug, worktree=self.project.worktree, out_file=out_file)
        agent.load_result()
        return agent

    def summarise(self, *results: dict | None) -> tuple[int, str]:
        self.orch.agents = [self.agent_with(f"idea{n}", r)
                            for n, r in enumerate(results, 1)]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.orch.cycle_exit_code()
        return code, out.getvalue()

    # -- the exit code ----------------------------------------------------------------

    def test_every_agent_failed_exits_non_zero(self) -> None:
        code, output = self.summarise(support.LIMIT_RESULT, support.LIMIT_RESULT)

        self.assertNotEqual(code, 0, "a cycle where nothing ran must not look successful")
        self.assertIn("WARNING", output)
        self.assertIn("all 2 agent(s) failed", output)
        self.assertIn("reached your Fable limit", output)

    def test_one_agent_failing_among_several_still_exits_zero(self) -> None:
        code, output = self.summarise(support.LIMIT_RESULT, support.HEALTHY_RESULT)

        self.assertEqual(code, 0, "real work landed; the cycle did its job")
        self.assertIn("WARNING", output)
        self.assertIn("1 of 2", output)

    def test_no_failures_is_silent_and_zero(self) -> None:
        code, output = self.summarise(support.HEALTHY_RESULT, support.HEALTHY_RESULT)

        self.assertEqual(code, 0)
        self.assertNotIn("WARNING", output)
        self.assertEqual(output, "")

    def test_a_single_failed_agent_exits_non_zero(self) -> None:
        code, output = self.summarise(support.LIMIT_RESULT)

        self.assertNotEqual(code, 0)
        self.assertIn("all 1 agent(s) failed", output)

    def test_an_agent_with_no_result_json_does_not_count_as_failed(self) -> None:
        """A killed agent is a different thing and already reported; don't conflate them."""
        code, output = self.summarise(None)

        self.assertEqual(code, 0)
        self.assertEqual(output, "")

    def test_no_agents_at_all_is_not_a_failed_cycle(self) -> None:
        self.orch.agents = []
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.orch.cycle_exit_code()
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue(), "")

    def test_the_summary_names_the_reasons_once_each(self) -> None:
        other = dict(support.LIMIT_RESULT, result="Overloaded. Try again later.")
        _code, output = self.summarise(support.LIMIT_RESULT, other)

        self.assertIn("reached your Fable limit", output)
        self.assertIn("Overloaded", output)


class BudgetArgumentTests(support.GitSandbox):
    """Found by the stub: a missing cost key killed every agent before it started.

    `--max-budget-usd ''` is rejected by the CLI outright, so every agent died instantly —
    which under 1.6 read as a quiet cycle, the very failure this version is about.
    """

    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.orch = self.orchestrator(self.project.repo)

    def test_a_missing_limit_passes_no_flag(self) -> None:
        self.assertEqual(self.orch.claude_budget_args("max_cycle_cost_usd"), [])

    def test_an_empty_limit_passes_no_flag(self) -> None:
        self.orch.config.raw["max_cycle_cost_usd"] = "   "
        self.assertEqual(self.orch.claude_budget_args("max_cycle_cost_usd"), [])

    def test_unlimited_passes_no_flag(self) -> None:
        self.orch.config.raw["max_cycle_cost_usd"] = "unlimited"
        self.assertEqual(self.orch.claude_budget_args("max_cycle_cost_usd"), [])

    def test_a_real_limit_is_passed_through(self) -> None:
        self.orch.config.raw["max_cycle_cost_usd"] = "50.00"
        self.assertEqual(self.orch.claude_budget_args("max_cycle_cost_usd"),
                         ["--max-budget-usd", "50.00"])


class RunCleanupTests(support.GitSandbox):
    """Whatever the exit code, the lock is released and the push attempted."""

    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo

    def runnable_orchestrator(self) -> orch.Orchestrator:
        """One whose preflight passes: the laptop reports idle instead of unreachable."""
        orchestrator = self.orchestrator(self.repo)
        orchestrator.heartbeat_over_http = lambda: (orch.HEARTBEAT_IDLE, "idle in the test")
        return orchestrator

    def test_an_early_return_inside_the_cycle_still_releases_the_lock_and_pushes(self) -> None:
        orchestrator = self.runnable_orchestrator()
        pushed: list[str] = []
        orchestrator.push_if_ahead = lambda context="", attempts=3: pushed.append(context)

        # Nothing is buildable: the one idea is done. run() takes an early return from inside
        # the try, which is the path that must still clean up.
        support.write(self.repo / "ideas" / "demo" / "STATUS.md",
                      "status: done\nversion: 0.1\n\n## Log\n")
        support.commit_all(self.repo, "done")

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = orchestrator.run()

        self.assertEqual(code, 0)
        self.assertIn("No idea is currently buildable", out.getvalue())
        self.assertEqual(pushed, [""], "the finally block must still push")
        self.assertFalse((self.repo / ".orchestrator" / "lock").exists(),
                         "the lock must be released on every path")

    def test_a_refused_preflight_neither_pushes_nor_takes_the_lock(self) -> None:
        """The cycle never started, so there is nothing to push and no lock to release."""
        orchestrator = self.orchestrator(self.repo)
        pushed: list[str] = []
        orchestrator.push_if_ahead = lambda context="", attempts=3: pushed.append(context)
        orchestrator.stop_file.parent.mkdir(parents=True, exist_ok=True)
        orchestrator.stop_file.write_text("paused by hand\n")

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = orchestrator.run()

        self.assertEqual(code, 0)
        self.assertEqual(pushed, [])
        self.assertIn("stop-file", out.getvalue())
