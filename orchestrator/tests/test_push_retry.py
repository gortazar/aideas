"""push_if_ahead: absorb a push that lost a race (orchestrator 1.1).

The regression this guards: a push rejected because someone pushed while the cycle ran was
deferred to "the next cycle", which with the timer disabled meant days or never.
"""

from __future__ import annotations

import contextlib
import io

from tests import support

COUNTING_REFUSAL = """#!/bin/sh
echo attempt >> "$(dirname "$0")/../push-attempts"
echo "refused" >&2
exit 1
"""


class PushRetryTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo
        self.orch = self.orchestrator(self.repo)

    def pending(self) -> int:
        return int(support.git("rev-list", "--count", "@{u}..HEAD", cwd=self.repo).stdout)

    def push_attempts(self) -> int:
        counter = self.project.remote / "push-attempts"
        return len(counter.read_text().splitlines()) if counter.exists() else 0

    def push_if_ahead(self, **kwargs) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.orch.push_if_ahead(**kwargs)
        return out.getvalue()

    def someone_else_pushes(self, filename: str, content: str = "theirs\n") -> None:
        other = self.path("other")
        support.git("clone", "--quiet", str(self.project.remote), str(other), cwd=self.tmp)
        support.write(other / filename, content)
        support.commit_all(other, f"someone edits {filename}")
        support.git("push", "--quiet", "origin", "main", cwd=other)

    def test_nothing_pending_is_a_noop(self) -> None:
        self.assertEqual(self.pending(), 0)
        before = support.remote_branches(self.project.remote)["main"]
        output = self.push_if_ahead()
        self.assertEqual(output, "")
        self.assertEqual(support.remote_branches(self.project.remote)["main"], before)

    def test_plain_push_when_ahead(self) -> None:
        support.write(self.repo / "notes.md", "local\n")
        head = support.commit_all(self.repo, "local work")
        self.push_if_ahead()
        self.assertEqual(support.remote_branches(self.project.remote)["main"], head)
        self.assertEqual(self.pending(), 0)

    def test_rejected_push_merges_and_retries(self) -> None:
        support.write(self.repo / "ours.md", "ours\n")
        support.commit_all(self.repo, "local work")
        self.someone_else_pushes("theirs.md")

        output = self.push_if_ahead()
        self.assertIn("merging and retrying", output)
        self.assertIn("push succeeded after merging", output)
        self.assertEqual(self.pending(), 0)
        remote_head = support.remote_branches(self.project.remote)["main"]
        tree = support.git("ls-tree", "--name-only", remote_head, cwd=self.repo).stdout.split()
        self.assertIn("ours.md", tree)
        self.assertIn("theirs.md", tree)

    def test_retries_are_bounded_by_attempts(self) -> None:
        support.install_hook(self.project.remote, "pre-receive", COUNTING_REFUSAL)
        support.write(self.repo / "ours.md", "ours\n")
        support.commit_all(self.repo, "local work")

        output = self.push_if_ahead(attempts=3)
        self.assertEqual(self.push_attempts(), 3)
        self.assertIn("will retry next cycle", output)
        self.assertEqual(self.pending(), 1, "the commit stays local for the next cycle")

    def test_genuine_conflict_abandons_immediately(self) -> None:
        support.write(self.repo / "shared.md", "ours\n")
        support.commit_all(self.repo, "local edit")
        self.someone_else_pushes("shared.md", "theirs\n")

        output = self.push_if_ahead(attempts=3)
        self.assertIn("conflicting edits", output)
        self.assertIn("will retry next cycle", output)
        # No merge left half-done, and no spin: the work is intact on the local branch.
        self.assertFalse((self.repo / ".git" / "MERGE_HEAD").exists())
        self.assertEqual(support.git("status", "--porcelain", cwd=self.repo).stdout, "")
        self.assertEqual(self.pending(), 1)
        self.assertEqual((self.repo / "shared.md").read_text(), "ours\n")
