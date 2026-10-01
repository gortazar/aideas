"""`/state` must answer for `origin`, not for whatever the last cycle left behind (1.8).

Two ideas showed as `blocked` in the panel for days after their questions had been answered and
pushed. Nothing was wrong with the extension or with `queue_rows`: `orchestrator_state()` reads
the working tree, and the only `git pull` in the system runs at the *start of a cycle*. With the
timer off, that is days away or never.

It presented as two bugs, which is why it was hard to read: the indicator polls every 60 s and
got a byte-identical answer every time, so "the data is wrong" and "the panel is dead" were the
same missing fetch.

A GET that writes to a working tree is the hazard of this entry, so every refusal is proved to
leave the tree byte-identical — asserted on `rev-parse HEAD` and on `git status`, not merely on
the reported reason. `merge --ff-only` cannot conflict: it either moves HEAD along a line origin
already has, or it declines and changes nothing.

Every remote here is a bare repository on disk. No network, no DNS, no real origin.
"""

from __future__ import annotations

import contextlib
import io
import os

import orchestrator as orch
from tests import support


class StateEndpointRefreshTests(support.GitSandbox):
    """`/state` refreshes before it reads the queue, and only when nothing is running."""

    def setUp(self) -> None:
        super().setUp()
        import heartbeat_server as hb
        self.hb = hb
        hb.reset_refresh_state()
        self.addCleanup(hb.reset_refresh_state)

        self.origin = support.bare_remote(self.path("origin.git"))
        self.seed = self.path("seed")
        support.init_repo(self.seed, "README.md", "# Ideas\n\n## Ideas\n\n1. [demo](ideas/demo)\n")
        support.write(self.seed / ".agent-config.yml", support.AGENT_CONFIG)
        support.write(self.seed / "ideas" / "demo" / "STATUS.md",
                      "status: in_progress\nversion: 0.1\n")
        support.write(self.seed / "ideas" / "demo" / "PLAN.md",
                      "# Plan\n\n## Open Questions\n\n- [ ] what colour should it be?\n")
        support.commit_all(self.seed, "an idea with an unanswered question")
        support.git("remote", "add", "origin", str(self.origin), cwd=self.seed)
        support.git("push", "--quiet", "-u", "origin", "main", cwd=self.seed)

        self.repo = self.path("clone")
        support.git("clone", "--quiet", str(self.origin), str(self.repo), cwd=self.tmp)
        os.environ["IDEAS_REPO_PATH"] = str(self.repo)

    def answer_the_question_and_push(self) -> None:
        """What the laptop does: tick the box, commit, push. No cycle runs."""
        support.write(self.seed / "ideas" / "demo" / "PLAN.md",
                      "# Plan\n\n## Open Questions\n\n- [x] what colour should it be? Blue.\n")
        support.commit_all(self.seed, "answer the question")
        support.git("push", "--quiet", "origin", "main", cwd=self.seed)

    def idea_state(self, payload: dict) -> str:
        return payload["ideas"][0]["state"]

    # -- the bug itself ----------------------------------------------------------------

    def test_an_answered_question_becomes_ready_without_a_cycle_running(self) -> None:
        first = self.hb.orchestrator_state()
        self.assertTrue(first["available"], first.get("reason"))
        self.assertEqual(self.idea_state(first), "blocked")

        self.answer_the_question_and_push()
        self.hb.reset_refresh_state()  # the next poll is past the window

        second = self.hb.orchestrator_state()

        self.assertEqual(self.idea_state(second), "ready",
                         "the panel still shows the tree the last cycle left behind")
        self.assertEqual(second["refresh"]["state"], "current")

    def test_the_refresh_happens_before_the_queue_is_read(self) -> None:
        """One request must not report a queue from before its own fetch."""
        self.answer_the_question_and_push()

        payload = self.hb.orchestrator_state()

        self.assertEqual(self.idea_state(payload), "ready")

    # -- the lock gate -----------------------------------------------------------------

    def test_a_running_cycle_means_the_tree_is_not_touched(self) -> None:
        lock = orch.RepoLock(self.repo / ".orchestrator", 5, 30)
        self.assertTrue(lock.acquire())
        self.addCleanup(lock.release)
        self.answer_the_question_and_push()
        before = support.git("rev-parse", "HEAD", cwd=self.repo).stdout.strip()

        payload = self.hb.orchestrator_state()

        self.assertEqual(support.git("rev-parse", "HEAD", cwd=self.repo).stdout.strip(),
                         before, "a GET moved the tree while a cycle was running")
        self.assertEqual(payload["refresh"]["state"], "stale")
        self.assertIn("a cycle is running", payload["refresh"]["reason"])

    # -- the rate limit ----------------------------------------------------------------

    def test_two_calls_inside_the_window_fetch_once(self) -> None:
        stub = self.stub_binary("git", 'exec "$REAL_BINARY" "$@"')
        clock = [1000.0]

        self.hb.orchestrator_state(clock=lambda: clock[0])
        after_first = len(stub.calls_matching("fetch"))
        clock[0] += 1  # a second poll, well inside the 120 s window
        self.hb.orchestrator_state(clock=lambda: clock[0])

        self.assertEqual(after_first, 1, "the first call did not fetch")
        self.assertEqual(len(stub.calls_matching("fetch")), 1,
                         "the window did not stop the second fetch")

    def test_a_call_past_the_window_fetches_again(self) -> None:
        stub = self.stub_binary("git", 'exec "$REAL_BINARY" "$@"')
        clock = [1000.0]

        self.hb.orchestrator_state(clock=lambda: clock[0])
        clock[0] += self.hb.REFRESH_SECONDS + 1
        self.hb.orchestrator_state(clock=lambda: clock[0])

        self.assertEqual(len(stub.calls_matching("fetch")), 2)

    def test_a_skipped_refresh_keeps_reporting_current(self) -> None:
        clock = [1000.0]
        first = self.hb.orchestrator_state(clock=lambda: clock[0])
        self.assertEqual(first["refresh"]["state"], "current")

        clock[0] += 1
        second = self.hb.orchestrator_state(clock=lambda: clock[0])

        self.assertEqual(second["refresh"]["state"], "current",
                         "inside the window is what 'current' means")

    def test_a_failed_attempt_restarts_the_clock_too(self) -> None:
        """A box with no network must not shell out on every single poll."""
        support.git("remote", "set-url", "origin", str(self.path("gone.git")), cwd=self.repo)
        stub = self.stub_binary("git", 'exec "$REAL_BINARY" "$@"')
        clock = [1000.0]

        failed = self.hb.orchestrator_state(clock=lambda: clock[0])
        attempts = len(stub.calls_matching("fetch"))
        clock[0] += 1
        self.hb.orchestrator_state(clock=lambda: clock[0])

        self.assertEqual(failed["refresh"]["state"], "stale")
        self.assertEqual(len(stub.calls_matching("fetch")), attempts,
                         "a failed fetch must still start the window")


class RefreshFieldShapeTests(support.GitSandbox):
    """What `refresh` promises a consumer, case by case."""

    def setUp(self) -> None:
        super().setUp()
        import heartbeat_server as hb
        self.hb = hb
        hb.reset_refresh_state()
        self.addCleanup(hb.reset_refresh_state)

        self.origin = support.bare_remote(self.path("origin.git"))
        self.seed = self.path("seed")
        support.init_repo(self.seed, "README.md", "# Ideas\n\n## Ideas\n\n1. [demo](ideas/demo)\n")
        support.write(self.seed / ".agent-config.yml", support.AGENT_CONFIG)
        support.write(self.seed / "ideas" / "demo" / "STATUS.md", "status: in_progress\n")
        support.write(self.seed / "ideas" / "demo" / "PLAN.md", "# Plan\n")
        support.commit_all(self.seed, "an idea")
        support.git("remote", "add", "origin", str(self.origin), cwd=self.seed)
        support.git("push", "--quiet", "-u", "origin", "main", cwd=self.seed)
        self.repo = self.path("clone")
        support.git("clone", "--quiet", str(self.origin), str(self.repo), cwd=self.tmp)
        os.environ["IDEAS_REPO_PATH"] = str(self.repo)

    def refresh(self, **kwargs) -> dict:
        return self.hb.orchestrator_state(**kwargs)["refresh"]

    def test_the_keys_are_exactly_these_four(self) -> None:
        self.assertEqual(set(self.refresh()),
                         {"state", "reason", "checked_at", "age_seconds"})

    def test_a_successful_refresh_is_current_with_no_reason(self) -> None:
        refresh = self.refresh(now=lambda: 1_700_000_000.0)

        self.assertEqual(refresh["state"], "current")
        self.assertIsNone(refresh["reason"], "reason is null when there is nothing to say")
        self.assertEqual(refresh["checked_at"], 1_700_000_000.0)
        self.assertEqual(refresh["age_seconds"], 0)

    def test_age_seconds_is_an_integer_age_of_the_last_success(self) -> None:
        clock, wall = [1000.0], [1_700_000_000.0]
        self.refresh(clock=lambda: clock[0], now=lambda: wall[0])

        clock[0] += 1          # inside the window: no new attempt
        wall[0] += 412.7       # but time has passed
        refresh = self.refresh(clock=lambda: clock[0], now=lambda: wall[0])

        self.assertEqual(refresh["checked_at"], 1_700_000_000.0, "the last *success*")
        self.assertEqual(refresh["age_seconds"], 413)
        self.assertIsInstance(refresh["age_seconds"], int)

    def test_a_box_that_has_never_managed_a_refresh_reports_nulls(self) -> None:
        support.git("remote", "set-url", "origin", str(self.path("gone.git")), cwd=self.repo)

        refresh = self.refresh()

        self.assertEqual(refresh["state"], "stale")
        self.assertIsNone(refresh["checked_at"])
        self.assertIsNone(refresh["age_seconds"])

    def test_the_state_vocabulary_is_closed(self) -> None:
        self.assertIn(self.refresh()["state"], ("current", "stale"))

    def test_each_declined_case_has_its_own_sentence(self) -> None:
        cases = {
            "uncommitted changes": lambda: support.write(self.repo / "README.md", "edited\n"),
            "no upstream branch": lambda: support.git(
                "checkout", "--quiet", "--detach", "HEAD", cwd=self.repo),
            "could not reach": lambda: support.git(
                "remote", "set-url", "origin", str(self.path("gone.git")), cwd=self.repo),
        }
        for expected, provoke in cases.items():
            with self.subTest(expected):
                support.git("checkout", "--quiet", "main", cwd=self.repo)
                support.git("checkout", "--quiet", "--", ".", cwd=self.repo)
                support.git("remote", "set-url", "origin", str(self.origin), cwd=self.repo)
                self.hb.reset_refresh_state()
                provoke()

                refresh = self.refresh()

                self.assertEqual(refresh["state"], "stale")
                self.assertIn(expected, refresh["reason"])

    def test_an_unavailable_body_still_promises_nothing_but_reason(self) -> None:
        """The contract says so, and a consumer branches on `available` before anything else."""
        os.environ["IDEAS_REPO_PATH"] = ""

        payload = self.hb.orchestrator_state()

        self.assertFalse(payload["available"])
        self.assertEqual(set(payload), {"available", "reason"})

    def test_a_refresh_that_raises_does_not_500_the_endpoint(self) -> None:
        def explode(_repo):
            raise RuntimeError("git went missing")

        payload = self.hb.orchestrator_state(refresh=explode)

        self.assertTrue(payload["available"], "the queue is still readable")
        self.assertEqual(payload["refresh"]["state"], "stale")
        self.assertIn("git went missing", payload["refresh"]["reason"])


class StatusCommandTests(support.GitSandbox):
    """`/state` and `orchestrator.py status` have been one implementation since 1.4."""

    def setUp(self) -> None:
        super().setUp()
        self.origin = support.bare_remote(self.path("origin.git"))
        self.seed = self.path("seed")
        support.init_repo(self.seed, "README.md", "# Ideas\n\n## Ideas\n\n1. [demo](ideas/demo)\n")
        support.write(self.seed / ".agent-config.yml", support.AGENT_CONFIG)
        support.write(self.seed / "ideas" / "demo" / "STATUS.md", "status: in_progress\n")
        support.write(self.seed / "ideas" / "demo" / "PLAN.md", "# Plan\n")
        support.commit_all(self.seed, "an idea")
        support.git("remote", "add", "origin", str(self.origin), cwd=self.seed)
        support.git("push", "--quiet", "-u", "origin", "main", cwd=self.seed)
        self.repo = self.path("clone")
        support.git("clone", "--quiet", str(self.origin), str(self.repo), cwd=self.tmp)

    def status_output(self) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            orch.cmd_status(self.repo, "http://127.0.0.1:1")
        return out.getvalue()

    def test_a_clone_behind_its_upstream_is_warned_about(self) -> None:
        support.write(self.seed / "new.md", "pushed elsewhere\n")
        support.commit_all(self.seed, "new work")
        support.git("push", "--quiet", "origin", "main", cwd=self.seed)
        support.git("fetch", "--quiet", "origin", cwd=self.repo)  # status never fetches

        output = self.status_output()

        self.assertIn("WARNING", output)
        self.assertIn("may be behind origin", output)
        self.assertIn("1 commit behind", output)

    def test_a_current_clone_says_nothing_about_it(self) -> None:
        output = self.status_output()

        self.assertNotIn("may be behind origin", output)

    def test_status_never_fetches_and_never_moves_the_tree(self) -> None:
        """It is run interactively and must answer at once; a cycle may be in that tree."""
        stub = self.stub_binary("git", 'exec "$REAL_BINARY" "$@"')
        support.write(self.seed / "new.md", "pushed elsewhere\n")
        support.commit_all(self.seed, "new work")
        support.git("push", "--quiet", "origin", "main", cwd=self.seed)
        before = support.git("rev-parse", "HEAD", cwd=self.repo).stdout.strip()

        self.status_output()

        self.assertEqual(stub.calls_matching("fetch"), [], "status shelled out to the network")
        self.assertEqual(support.git("rev-parse", "HEAD", cwd=self.repo).stdout.strip(),
                         before, "status moved the working tree")

    def test_a_dirty_tree_is_reported_in_the_same_words_as_the_endpoint(self) -> None:
        support.write(self.repo / "README.md", "edited by hand\n")

        output = self.status_output()

        self.assertIn("uncommitted changes", output)


class RefreshCloneTests(support.GitSandbox):
    """One row of the decision table per test."""

    def setUp(self) -> None:
        super().setUp()
        self.origin = support.bare_remote(self.path("origin.git"))
        self.seed = self.path("seed")
        support.seed_remote(self.origin, self.seed, {"README.md": "# Ideas\n\n## Ideas\n"})
        self.repo = self.path("clone")
        support.git("clone", "--quiet", str(self.origin), str(self.repo), cwd=self.tmp)

    # -- helpers ----------------------------------------------------------------------

    def head(self, repo=None) -> str:
        return support.git("rev-parse", "HEAD", cwd=repo or self.repo).stdout.strip()

    def status(self) -> str:
        return support.git("status", "--porcelain", cwd=self.repo).stdout

    def push_to_origin(self, name: str = "new.md", text: str = "pushed elsewhere\n") -> str:
        """A second clone pushes a commit, the way the laptop does."""
        support.write(self.seed / name, text)
        sha = support.commit_all(self.seed, f"add {name}")
        support.git("push", "--quiet", "origin", "main", cwd=self.seed)
        return sha

    def assert_untouched(self, before_head: str, before_status: str) -> None:
        self.assertEqual(self.head(), before_head, "a refusal moved HEAD")
        self.assertEqual(self.status(), before_status, "a refusal changed the working tree")

    # -- the rows that refresh ---------------------------------------------------------

    def test_a_clean_clone_behind_origin_fast_forwards(self) -> None:
        pushed = self.push_to_origin()
        self.assertNotEqual(self.head(), pushed)

        ok, reason = orch.refresh_clone(self.repo)

        self.assertTrue(ok, reason)
        self.assertIsNone(reason)
        self.assertEqual(self.head(), pushed, "the clone did not move to origin's commit")
        self.assertTrue((self.repo / "new.md").is_file())

    def test_a_clone_already_level_with_origin_is_current(self) -> None:
        before = self.head()

        ok, reason = orch.refresh_clone(self.repo)

        self.assertTrue(ok, reason)
        self.assertIsNone(reason)
        self.assertEqual(self.head(), before)

    # -- the rows that decline ---------------------------------------------------------

    def test_a_dirty_tree_is_left_alone(self) -> None:
        self.push_to_origin()
        support.write(self.repo / "README.md", "# edited by hand, not committed\n")
        before_head, before_status = self.head(), self.status()

        ok, reason = orch.refresh_clone(self.repo)

        self.assertFalse(ok)
        self.assertIn("uncommitted changes", reason)
        self.assert_untouched(before_head, before_status)

    def test_an_untracked_file_does_not_count_as_dirty(self) -> None:
        """A fast-forward cannot clobber an untracked file; git refuses the checkout instead."""
        pushed = self.push_to_origin()
        support.write(self.repo / "scratch.txt", "mine\n")

        ok, reason = orch.refresh_clone(self.repo)

        self.assertTrue(ok, reason)
        self.assertEqual(self.head(), pushed)
        self.assertTrue((self.repo / "scratch.txt").is_file(), "the untracked file was eaten")

    def test_a_detached_head_is_left_alone(self) -> None:
        self.push_to_origin()
        support.git("checkout", "--quiet", "--detach", "HEAD", cwd=self.repo)
        before_head, before_status = self.head(), self.status()

        ok, reason = orch.refresh_clone(self.repo)

        self.assertFalse(ok)
        self.assertIn("no upstream branch", reason)
        self.assert_untouched(before_head, before_status)

    def test_a_branch_with_no_upstream_is_left_alone(self) -> None:
        support.git("checkout", "--quiet", "-b", "local-only", cwd=self.repo)
        before_head, before_status = self.head(), self.status()

        ok, reason = orch.refresh_clone(self.repo)

        self.assertFalse(ok)
        self.assertIn("no upstream branch", reason)
        self.assert_untouched(before_head, before_status)

    def test_a_path_that_is_not_a_clone_is_named(self) -> None:
        plain = self.path("not-a-clone")
        plain.mkdir()

        ok, reason = orch.refresh_clone(plain)

        self.assertFalse(ok)
        self.assertIn("not a git clone", reason)
        self.assertIn(str(plain), reason)

    def test_a_missing_directory_is_not_an_exception(self) -> None:
        ok, reason = orch.refresh_clone(self.path("nowhere"))

        self.assertFalse(ok)
        self.assertIn("not a git clone", reason)

    def test_an_unreachable_origin_reports_gits_own_words(self) -> None:
        support.git("remote", "set-url", "origin", str(self.path("gone.git")), cwd=self.repo)
        before_head, before_status = self.head(), self.status()

        ok, reason = orch.refresh_clone(self.repo)

        self.assertFalse(ok)
        self.assertIn("could not reach origin", reason)
        self.assertEqual(len(reason.splitlines()), 1, "the reason is shown verbatim in a panel")
        self.assert_untouched(before_head, before_status)

    def test_a_diverged_clone_declines_and_says_it_needs_a_person(self) -> None:
        self.push_to_origin()
        support.write(self.repo / "local.md", "committed here only\n")
        support.commit_all(self.repo, "a local commit origin does not have")
        before_head, before_status = self.head(), self.status()

        ok, reason = orch.refresh_clone(self.repo)

        self.assertFalse(ok)
        self.assertIn("diverged", reason)
        self.assertIn("needs a person", reason)
        self.assert_untouched(before_head, before_status)
        # The fetch did happen; only the merge declined. That distinction is the point of the
        # separate reason: the remote is fine, this clone is not.
        self.assertTrue(
            support.git("rev-parse", "origin/main", cwd=self.repo).stdout.strip())

    def test_a_fetch_that_hangs_is_abandoned_not_waited_on(self) -> None:
        """One HTTPServer thread serves /heartbeat too; a hang here blocks that."""
        stub = self.stub_binary("git", '''
case "$1 $2" in
  "fetch "*|"fetch") sleep 30; exit 0 ;;
esac
exec "$REAL_BINARY" "$@"
''')
        before_head = self.head()

        ok, reason = orch.refresh_clone(self.repo, timeout=0.5)

        self.assertFalse(ok)
        self.assertIn("could not reach origin", reason)
        self.assertIn("timed out", reason)
        self.assertTrue(stub.calls_matching("fetch"), "the stub git never ran")
        self.assertEqual(self.head(), before_head)

    def test_the_fetch_is_non_interactive(self) -> None:
        """A credential prompt on a unit with no terminal would block for ever."""
        stub = self.stub_binary("git", '''
case "$1" in
  fetch)
    {
      echo "GIT_TERMINAL_PROMPT=$GIT_TERMINAL_PROMPT"
      echo "GIT_ASKPASS=$GIT_ASKPASS"
      echo "GIT_SSH_COMMAND=$GIT_SSH_COMMAND"
    } >> "$INVOCATION_LOG"
    exit 0 ;;
esac
exec "$REAL_BINARY" "$@"
''')

        orch.refresh_clone(self.repo)

        recorded = "\n".join(stub.invocations())
        self.assertIn("GIT_TERMINAL_PROMPT=0", recorded)
        self.assertIn("GIT_ASKPASS=true", recorded)
        self.assertIn("BatchMode=yes", recorded)
