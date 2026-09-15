"""The fixtures themselves, asserted on before anything is built on top of them.

If the superproject fixture cannot reproduce a submodule living inside a linked worktree —
`.git` a file pointing into `.git/worktrees/<wt>/modules/<path>` — then every
`settle_submodules` test is testing a different layout than production. And a `pre-receive`
hook that silently does not run would turn the gated-remote case into a tautology, so the
refusal is asserted directly here.
"""

from __future__ import annotations

from tests import support


class SuperprojectLayout(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)

    def test_submodule_git_dir_is_per_worktree(self) -> None:
        dotgit = self.project.sub_in_worktree / ".git"
        self.assertTrue(dotgit.is_file(), "a submodule in a linked worktree has a .git *file*")
        gitdir = dotgit.read_text().split("gitdir:", 1)[1].strip()
        resolved = (self.project.sub_in_worktree / gitdir).resolve()
        expected = (self.project.repo / ".git" / "worktrees" / "demo" / "modules"
                    / self.project.sub_path).resolve()
        self.assertEqual(resolved, expected)
        self.assertTrue(resolved.is_dir())

    def test_superproject_has_shared_module_dir(self) -> None:
        shared = self.project.repo / ".git" / "modules" / self.project.sub_path
        self.assertTrue(shared.is_dir(), "the superproject's own checkout has .git/modules/<path>")

    def test_submodule_paths_finds_the_idea_submodule(self) -> None:
        orch = self.orchestrator(self.project.repo)
        self.assertEqual(orch.submodule_paths(self.project.worktree, "demo"),
                         [self.project.sub_path])
        self.assertEqual(orch.submodule_paths(self.project.worktree, "other"), [])

    def test_worktree_is_on_agent_branch(self) -> None:
        branch = support.git("rev-parse", "--abbrev-ref", "HEAD", cwd=self.project.worktree)
        self.assertEqual(branch.stdout.strip(), "agent/demo")


class Remotes(support.GitSandbox):
    def _clone_with_commit(self, bare, name: str):
        clone = self.path(name)
        support.git("clone", "--quiet", str(bare), str(clone), cwd=self.tmp)
        support.write(clone / "new.txt", "new\n")
        support.commit_all(clone, "new work")
        return clone

    def test_plain_remote_accepts_main(self) -> None:
        bare = support.bare_remote(self.path("plain.git"))
        support.seed_remote(bare, self.path("seed"))
        clone = self._clone_with_commit(bare, "clone")
        pushed = support.git("push", "--quiet", "origin", "HEAD:refs/heads/main", cwd=clone,
                             check=False)
        self.assertEqual(pushed.returncode, 0, pushed.stderr)

    def test_gated_remote_refuses_main_but_takes_a_branch(self) -> None:
        bare = support.gated_remote(self.path("gated.git"), self.path("seed"))
        # The seed landed before the hook went in; from here on, main only moves by "pull
        # request", which is the shape of a gated repository with history.
        self.assertIn("main", support.remote_branches(bare))
        clone = self._clone_with_commit(bare, "clone")
        refused = support.git("push", "--quiet", "origin", "HEAD:refs/heads/main", cwd=clone,
                              check=False)
        self.assertNotEqual(refused.returncode, 0, "the pre-receive hook did not run")
        self.assertIn("pull request required", refused.stderr)
        accepted = support.git("push", "--quiet", "origin", "HEAD:refs/heads/agent/x", cwd=clone,
                               check=False)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn("agent/x", support.remote_branches(bare))

    def test_refusing_remote_takes_nothing(self) -> None:
        bare = support.refusing_remote(self.path("refusing.git"), self.path("seed"))
        clone = self._clone_with_commit(bare, "clone")
        for ref in ("refs/heads/main", "refs/heads/agent/x"):
            refused = support.git("push", "--quiet", "origin", f"HEAD:{ref}", cwd=clone,
                                  check=False)
            self.assertNotEqual(refused.returncode, 0, f"{ref} was accepted")
