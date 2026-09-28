"""A failed agent must not be recorded as quiet progress (orchestrator 1.7).

When the account's model limit was exhausted, both agents exited in about five seconds and
each wrote a result JSON whose `subtype` said `success` and whose `is_error` said `true`.
Every reader believed `subtype`: the cycle wrote `status: in_progress`, logged
`$0.0000, 1 turns` and said `Cycle complete`. With the timer on, that repeated every five
minutes and nothing anywhere said a thing was wrong.

Writing `in_progress` is not merely misleading. For an idea at `not_started` it sets
`started_at`, which starts the `stale_idea_after_hours` clock `pick_ideas` uses to
deprioritise — so a run of limit failures can push a never-started idea into the stalled
bucket without a single turn having been taken.

Two failure modes that are already reported must stay distinguishable from this one: an agent
killed with no result JSON at all, and a merge that conflicted.
"""

from __future__ import annotations

import contextlib
import io
import json

import orchestrator as orch
from tests import support


class ClassifierTests(support.GitSandbox):
    """`agent_failure(result)`: None when healthy, a reason string when not."""

    def test_the_observed_limit_payload_is_a_failure(self) -> None:
        reason = orch.agent_failure(support.LIMIT_RESULT)
        self.assertIsNotNone(reason, "subtype said success and is_error said otherwise")
        self.assertIn("reached your Fable limit", reason,
                      "the model's own sentence is the most informative reason there is")

    def test_a_healthy_result_is_not_a_failure(self) -> None:
        self.assertIsNone(orch.agent_failure(support.HEALTHY_RESULT))

    def test_a_non_success_subtype_is_a_failure(self) -> None:
        reason = orch.agent_failure({"subtype": "error_max_turns", "num_turns": 40})
        self.assertIsNotNone(reason)
        self.assertIn("error_max_turns", reason)

    def test_is_error_without_a_result_string_still_says_something_useful(self) -> None:
        reason = orch.agent_failure({"subtype": "success", "is_error": True, "num_turns": 3})
        self.assertIsNotNone(reason)
        self.assertIn("num_turns=3", reason)

    def test_an_empty_result_is_not_classified_as_a_failure(self) -> None:
        """`{}` means no result JSON, which already has its own report — don't double-count."""
        self.assertIsNone(orch.agent_failure({}))

    def test_a_result_with_neither_key_is_healthy(self) -> None:
        """An older CLI omitting is_error must not turn every cycle into a failure."""
        self.assertIsNone(orch.agent_failure({"type": "result", "num_turns": 5,
                                              "total_cost_usd": 0.5}))


class FinalizeOnFailureTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo
        self.orch = self.orchestrator(self.repo)
        self.agent = self.project.agent()
        self.agent.out_file.parent.mkdir(parents=True, exist_ok=True)
        self.status_file = self.repo / "ideas" / "demo" / "STATUS.md"

    def write_result(self, result: dict | None) -> None:
        if result is None:
            return  # no result JSON at all: the killed-agent case
        self.agent.out_file.write_text(json.dumps(result))

    def finalize(self, result: dict | None) -> str:
        self.write_result(result)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.orch.finalize(self.agent)
        return out.getvalue()

    def set_status(self, text: str) -> None:
        support.write(self.status_file, text)
        support.commit_all(self.repo, "status")
        # The agent's worktree shares the branch point, so keep the two consistent.
        support.write(self.agent.idea_dir / "STATUS.md", text)
        support.commit_all(self.agent.worktree, "status")

    def usage_rows(self) -> list[str]:
        log_file = self.repo / ".orchestrator" / "usage.log"
        return log_file.read_text().splitlines() if log_file.exists() else []

    # -- the status is left alone -----------------------------------------------------

    def test_a_failed_agent_does_not_move_a_not_started_idea(self) -> None:
        self.set_status("status: not_started\nversion: 0.1\n\n## Log\n")

        self.finalize(support.LIMIT_RESULT)

        text = self.status_file.read_text()
        self.assertEqual(orch.status_value(self.status_file, "status"), "not_started",
                         "a failed agent must not claim the idea is in progress")
        self.assertIsNone(orch.status_value(self.status_file, "started_at"),
                          "started_at starts the staleness clock; no turn was taken")
        self.assertNotIn("— in_progress", text)

    def test_a_failed_agent_does_not_touch_an_in_progress_idea_either(self) -> None:
        self.set_status("status: in_progress\nversion: 0.3\n"
                        "started_at: 2026-01-01T00:00:00+01:00\n\n## Log\n")

        self.finalize(support.LIMIT_RESULT)

        self.assertEqual(orch.status_value(self.status_file, "status"), "in_progress")
        self.assertEqual(orch.status_value(self.status_file, "started_at"),
                         "2026-01-01T00:00:00+01:00", "the clock must not be restarted")
        self.assertEqual(orch.status_value(self.status_file, "version"), "0.3")

    def test_the_failure_is_logged_with_the_models_own_words(self) -> None:
        self.set_status("status: not_started\nversion: 0.1\n\n## Log\n")

        output = self.finalize(support.LIMIT_RESULT)

        self.assertIn("WARNING", output)
        self.assertIn("reached your Fable limit", output)
        self.assertIn("status left at not_started", output)
        self.assertNotIn("Cycle complete for demo (in_progress)", output)

    def test_the_failure_is_recorded_in_status_md_where_the_next_agent_reads_it(self) -> None:
        self.set_status("status: not_started\nversion: 0.1\n\n## Log\n")

        self.finalize(support.LIMIT_RESULT)

        text = self.status_file.read_text()
        self.assertIn("failed:", text)
        self.assertIn("reached your Fable limit", text)
        # In the shape LOG_ENTRY_RE matches, so next cycle's rewrite_status re-gathers it
        # rather than stranding it at the bottom of the file.
        entries = [ln for ln in text.splitlines() if orch.LOG_ENTRY_RE.match(ln)]
        self.assertTrue(entries, f"no line matched LOG_ENTRY_RE in:\n{text}")
        self.assertIn("failed", entries[0])
        # And within the last 20 lines, which is what start_agent briefs the next agent with.
        self.assertIn("failed", "\n".join(text.splitlines()[-20:]))

    # -- everything else still happens -------------------------------------------------

    def test_the_worktree_and_branch_are_still_cleaned_up(self) -> None:
        self.set_status("status: not_started\nversion: 0.1\n\n## Log\n")

        self.finalize(support.LIMIT_RESULT)

        self.assertFalse(self.agent.worktree.exists(), "1.2's regression must not return")
        branches = support.git("branch", "--list", "agent/demo", cwd=self.repo).stdout
        self.assertEqual(branches.strip(), "")

    def test_work_already_committed_by_a_resumed_agent_is_still_merged(self) -> None:
        """A long run that hits the limit on its last turn has real commits. Keep them."""
        self.set_status("status: in_progress\nversion: 0.1\n\n## Log\n")
        support.write(self.agent.idea_dir / "delivered.md", "hours of work\n")
        support.commit_all(self.agent.worktree, "real work before the limit hit")

        self.finalize(support.LIMIT_RESULT)

        self.assertTrue((self.repo / "ideas" / "demo" / "delivered.md").is_file(),
                        "the merge must still run; only the status write is skipped")

    def test_usage_records_the_failure_rather_than_a_confident_zero(self) -> None:
        self.set_status("status: not_started\nversion: 0.1\n\n## Log\n")

        output = self.finalize(support.LIMIT_RESULT)

        rows = self.usage_rows()
        self.assertTrue(rows)
        self.assertIn("build-failed", rows[-1])
        self.assertIn("demo", rows[-1])
        self.assertIn("reached your Fable limit", output)

    # -- the neighbouring failure modes stay distinct ----------------------------------

    def test_no_result_json_still_reports_the_agent_as_stopped(self) -> None:
        """The killed-agent case is a different sentence and must not be swallowed."""
        self.set_status("status: in_progress\nversion: 0.1\n\n## Log\n")

        output = self.finalize(None)

        self.assertIn("produced no result JSON", output)
        self.assertIn("agent stopped", output)
        self.assertNotIn("the agent failed after", output)
        rows = self.usage_rows()
        self.assertIn("build-stopped", rows[-1])

    def test_a_healthy_agent_is_unaffected(self) -> None:
        self.set_status("status: not_started\nversion: 0.1\n\n## Log\n")

        output = self.finalize(support.HEALTHY_RESULT)

        self.assertEqual(orch.status_value(self.status_file, "status"), "in_progress")
        self.assertIsNotNone(orch.status_value(self.status_file, "started_at"))
        self.assertIn("Cycle complete for demo (in_progress)", output)
        self.assertNotIn("WARNING", output)
        self.assertIn("build", self.usage_rows()[-1])
        self.assertNotIn("build-failed", self.usage_rows()[-1])

    def test_a_failed_agent_keeps_its_session_id(self) -> None:
        """So the same conversation resumes once the limit lifts."""
        self.set_status("status: not_started\nversion: 0.1\n\n## Log\n")

        self.finalize(support.LIMIT_RESULT)

        session_file = self.repo / ".orchestrator" / "sessions" / "demo.id"
        self.assertTrue(session_file.is_file())
        self.assertEqual(session_file.read_text().strip(),
                         support.LIMIT_RESULT["session_id"])


class PlanningFailureTests(support.GitSandbox):
    """The same limit kills the planning pass, which said nothing at all about it."""

    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.orch = self.orchestrator(self.project.repo)

    def test_record_usage_marks_a_failed_planning_run(self) -> None:
        agent = orch.Agent(slug="demo", worktree=self.project.repo,
                           out_file=self.path("plan.json"))
        agent.result = dict(support.LIMIT_RESULT)

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.orch.record_usage(agent, "plan")

        rows = (self.project.repo / ".orchestrator" / "usage.log").read_text().splitlines()
        self.assertIn("plan-failed", rows[-1])
        self.assertIn("WARNING", out.getvalue())
        self.assertIn("reached your Fable limit", out.getvalue())
