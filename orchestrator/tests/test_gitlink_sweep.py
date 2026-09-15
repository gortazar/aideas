"""sweep_repo / sync_submodule_checkouts: the superproject sweep must not move pins
(orchestrator 1.3).

The regression this guards: `git add -A` records a submodule's *working tree* HEAD, which
after a merge is behind the index, so every "automated build cycle" commit reverted the pin
an agent had just advanced — four times over eleven days.
"""

from __future__ import annotations

import contextlib
import io

from tests import support


class GitlinkSweepTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        self.old_pin = support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo
        self.orch = self.orchestrator(self.repo)

    def advance_upstream(self) -> str:
        """A new commit on the submodule's remote, as an agent's merged work would leave it."""
        seed = self.path("seed")
        support.write(seed / "feature.txt", "new\n")
        sha = support.commit_all(seed, "feature")
        support.git("push", "--quiet", "origin", "main", cwd=seed)
        return sha

    def merge_pin_without_checkout(self, sha: str) -> None:
        """What `git merge agent/<slug>` does to the clone: index moves, checkout does not."""
        support.git("update-index", "--cacheinfo", f"160000,{sha},{self.project.sub_path}",
                    cwd=self.repo)
        support.git("commit", "--quiet", "-m", "merge agent branch (pin advanced)", cwd=self.repo)

    def recorded_pin(self, rev: str = "HEAD") -> str:
        line = support.git("ls-tree", rev, "--", self.project.sub_path, cwd=self.repo).stdout
        return line.split()[2]

    def checkout_head(self) -> str:
        return support.git("rev-parse", "HEAD", cwd=self.project.sub_in_repo).stdout.strip()

    def test_sweep_does_not_revert_an_advanced_pin(self) -> None:
        new_pin = self.advance_upstream()
        self.merge_pin_without_checkout(new_pin)
        self.assertEqual(self.recorded_pin(), new_pin)
        self.assertEqual(self.checkout_head(), self.old_pin, "checkout is behind, as after a merge")

        support.write(self.repo / "loose.md", "left behind\n")
        with contextlib.redirect_stdout(io.StringIO()):
            self.orch.sweep_repo("sweep")

        self.assertEqual(self.recorded_pin(), new_pin, "the sweep reverted the pin")
        tree = support.git("ls-tree", "--name-only", "HEAD", cwd=self.repo).stdout.split()
        self.assertIn("loose.md", tree, "the loose file was still swept up")
        staged = support.git("ls-files", "-s", "--", self.project.sub_path, cwd=self.repo).stdout
        self.assertIn(new_pin, staged, "the index must agree with HEAD after the sweep")
        # The checkout is deliberately left where it was: moving it is sync's job, not the sweep's.
        self.assertEqual(self.checkout_head(), self.old_pin)

    def test_naive_add_all_would_have_reverted_it(self) -> None:
        """The control: without the fix, `add -A` writes the stale checkout back."""
        new_pin = self.advance_upstream()
        self.merge_pin_without_checkout(new_pin)
        support.write(self.repo / "loose.md", "left behind\n")
        support.git("add", "-A", cwd=self.repo)
        staged = support.git("ls-files", "-s", "--", self.project.sub_path, cwd=self.repo).stdout
        self.assertIn(self.old_pin, staged, "the fixture no longer reproduces the 1.3 bug")

    def test_sync_brings_the_checkout_forward(self) -> None:
        new_pin = self.advance_upstream()
        self.merge_pin_without_checkout(new_pin)
        with contextlib.redirect_stdout(io.StringIO()):
            self.orch.sync_submodule_checkouts("demo")
        self.assertEqual(self.checkout_head(), new_pin)
        # And a worktree branched now inherits the right pin rather than re-infecting the
        # next agent with the stale one.
        fresh = self.path("fresh-worktree")
        support.git("worktree", "add", "--quiet", "--detach", str(fresh), "HEAD", cwd=self.repo)
        self.assertEqual(self.recorded_pin(), new_pin)
        line = support.git("ls-tree", "HEAD", "--", self.project.sub_path, cwd=fresh).stdout
        self.assertEqual(line.split()[2], new_pin)

    def test_all_submodule_paths_reads_gitmodules(self) -> None:
        self.assertEqual(self.orch.all_submodule_paths(), [self.project.sub_path])
