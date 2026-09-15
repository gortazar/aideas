"""settle_submodules: an agent's submodule commits must outlive its worktree (orchestrator 1.6).

`git worktree remove --force` deletes .git/worktrees/<wt>/modules/<path>, and every commit an
agent made inside its submodule lives there and nowhere else. The parent records the gitlink
either way, so losing them leaves a submodule reference pointing at a commit that exists
nowhere at all.

The rungs of the ladder, in order, each asserted here:

    already on a remote branch      -> nothing to do
    direct push accepted            -> pushed <path> to origin/<branch>
    direct push refused (a ruleset) -> agent/<slug>-sweep, a WARNING, and a STATUS.md notice
    that branch refused too         -> agent/<slug>-sweep-<date>
    everything refused              -> the local rescue ref, and the old WARNING

The gated remote is the case that would otherwise only ever be observed in production, on a
real repository whose `main` requires a pull request, after the work was already lost.
"""

from __future__ import annotations

import contextlib
import io
import shutil
from datetime import datetime

from tests import support


class SettleSubmodulesTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.orch = None  # built by build(), once the remote's shape is chosen

    # -- fixtures ---------------------------------------------------------------------

    def build(self, remote_kind: str = "plain") -> None:
        maker = {"plain": support.bare_remote,
                 "gated": support.gated_remote,
                 "refusing": support.refusing_remote}[remote_kind]
        if remote_kind == "plain":
            self.sub_remote = maker(self.path("upstream.git"))
            support.seed_remote(self.sub_remote, self.path("seed"))
        else:
            self.sub_remote = maker(self.path("upstream.git"), self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo
        self.sub = self.project.sub_in_worktree
        self.orch = self.orchestrator(self.repo)
        self.agent = self.project.agent()

    def settle(self) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.orch.settle_submodules(self.agent)
        return out.getvalue()

    def commit_in_submodule(self, name: str = "feature.txt") -> str:
        support.write(self.sub / name, "agent work\n")
        return support.commit_all(self.sub, f"agent adds {name}")

    def sub_head(self) -> str:
        return support.git("rev-parse", "HEAD", cwd=self.sub).stdout.strip()

    def remote_heads(self) -> dict[str, str]:
        return support.remote_branches(self.sub_remote)

    def status_text(self) -> str:
        return (self.agent.idea_dir / "STATUS.md").read_text()

    # -- committing what the agent left loose -----------------------------------------

    def test_uncommitted_work_in_the_submodule_is_committed(self) -> None:
        self.build("plain")
        before = self.sub_head()
        support.write(self.sub / "half-done.txt", "mid-unit when the deadline hit\n")

        output = self.settle()

        self.assertNotEqual(self.sub_head(), before, "the loose file was never committed")
        self.assertIn("swept up uncommitted work", output)
        self.assertEqual(support.git("status", "--porcelain", cwd=self.sub).stdout, "")
        subject = support.git("log", "-1", "--format=%s", cwd=self.sub).stdout
        self.assertIn("demo", subject)
        self.assertIn("automated build cycle", subject)

    def test_untracked_files_are_swept_too(self) -> None:
        self.build("plain")
        support.write(self.sub / "new" / "module.py", "print('hi')\n")
        self.settle()
        tracked = support.git("ls-files", cwd=self.sub).stdout.split()
        self.assertIn("new/module.py", tracked)

    # -- rung 1: nothing to do --------------------------------------------------------

    def test_commit_already_on_a_remote_branch_is_left_alone(self) -> None:
        self.build("plain")
        # The fixture's checkout is the pin, which is origin/main: nothing can be lost.
        before = self.remote_heads()

        output = self.settle()

        self.assertEqual(output, "", "a commit already on the remote needs no rescue")
        self.assertEqual(self.remote_heads(), before)

    def test_a_commit_pushed_by_the_agent_itself_is_left_alone(self) -> None:
        self.build("plain")
        head = self.commit_in_submodule()
        support.git("push", "--quiet", "origin", "HEAD:refs/heads/agent/demo/today", cwd=self.sub)
        support.git("fetch", "--quiet", "origin", cwd=self.sub)

        output = self.settle()

        self.assertEqual(output, "", "the disciplined case needs no sweep")
        self.assertEqual(self.remote_heads()["agent/demo/today"], head)

    # -- rung 2: the direct push ------------------------------------------------------

    def test_plain_remote_gets_the_direct_push(self) -> None:
        self.build("plain")
        head = self.commit_in_submodule()

        output = self.settle()

        self.assertEqual(self.remote_heads()["main"], head)
        self.assertIn(f"pushed {self.project.sub_path} to origin/main", output)
        self.assertNotIn("WARNING", output)
        self.assertNotIn("sweep", self.status_text())

    # -- rung 3: the ruleset refuses main ---------------------------------------------

    def test_gated_remote_falls_back_to_a_sweep_branch(self) -> None:
        self.build("gated")
        head = self.commit_in_submodule()

        # The premise, asserted before the fallback: main really is refused.
        refused = support.git("push", "--quiet", "origin", "HEAD:refs/heads/main", cwd=self.sub,
                              check=False)
        self.assertNotEqual(refused.returncode, 0, "the pre-receive hook did not run")

        output = self.settle()

        heads = self.remote_heads()
        self.assertIn("agent/demo-sweep", heads, "the rescued work never reached the remote")
        self.assertEqual(heads["agent/demo-sweep"], head)
        self.assertNotEqual(heads.get("main"), head, "main is gated and must not have moved")

    def test_gated_remote_logs_what_happened_and_what_to_do(self) -> None:
        self.build("gated")
        head = self.commit_in_submodule()

        output = self.settle()

        self.assertIn("WARNING", output)
        self.assertIn("agent/demo-sweep", output)
        self.assertIn(self.project.sub_path, output)
        self.assertIn(head[:8], output)
        # Distinguishable from the "could not push at all" rung a week later.
        self.assertNotIn("will be lost", output)
        self.assertNotIn("refs/aideas/rescued", output)

    def test_gated_remote_writes_the_notice_into_status_md(self) -> None:
        self.build("gated")
        head = self.commit_in_submodule()

        self.settle()

        notice = self.status_text()
        self.assertIn("agent/demo-sweep", notice)
        self.assertIn(self.project.sub_path, notice)
        self.assertIn(head[:8], notice)
        self.assertIn("gh pr create", notice)
        # start_agent briefs the next agent with the *last 20 lines* of STATUS.md, so a
        # notice further up than that is a notice nobody reads.
        tail = "\n".join(notice.splitlines()[-20:])
        self.assertIn("agent/demo-sweep", tail)

    def test_the_notice_is_committed_by_the_worktree_sweep(self) -> None:
        """It has to reach the superproject, which happens through the agent's own branch."""
        self.build("gated")
        self.commit_in_submodule()

        self.settle()

        support.git("add", "-A", cwd=self.agent.worktree)
        support.git("commit", "--quiet", "-m", "sweep", cwd=self.agent.worktree)
        support.git("merge", "--no-ff", "--no-edit", "--quiet", "agent/demo", cwd=self.repo)
        self.assertIn("agent/demo-sweep",
                      (self.repo / "ideas" / "demo" / "STATUS.md").read_text())

    def test_a_second_sweep_never_force_pushes_over_the_first(self) -> None:
        """Losing rescued work to the rescue mechanism is the worst possible outcome."""
        self.build("gated")
        first = self.commit_in_submodule("first.txt")
        self.settle()
        self.assertEqual(self.remote_heads()["agent/demo-sweep"], first)

        # A second cycle whose submodule history diverged: rewind and commit something else,
        # so a push to the existing sweep branch is a non-fast-forward.
        support.git("reset", "--hard", "--quiet", f"{first}~1", cwd=self.sub)
        second = self.commit_in_submodule("second.txt")

        output = self.settle()

        heads = self.remote_heads()
        self.assertEqual(heads["agent/demo-sweep"], first, "the first sweep was overwritten")
        dated = f"agent/demo-sweep-{datetime.now():%Y-%m-%d}"
        self.assertEqual(heads.get(dated), second,
                         f"the diverged sweep should have landed on {dated}: {output}")

    # -- rung 4: nothing takes it at all ----------------------------------------------

    def test_refusing_remote_falls_to_the_local_rescue_ref(self) -> None:
        self.build("refusing")
        head = self.commit_in_submodule()

        output = self.settle()

        self.assertEqual(self.remote_heads(), {"main": self.remote_heads()["main"]})
        self.assertNotIn("agent/demo-sweep", self.remote_heads())
        self.assertIn("WARNING", output)
        self.assertIn(f"refs/aideas/rescued/demo/{head[:8]}", output)

        shared = self.repo / ".git" / "modules" / self.project.sub_path
        rescued = support.git("rev-parse", f"refs/aideas/rescued/demo/{head[:8]}",
                              cwd=shared).stdout.strip()
        self.assertEqual(rescued, head, "the objects did not reach the shared module dir")

    def test_rescued_objects_survive_removing_the_worktree(self) -> None:
        """The whole point: the gitlink the parent records must still resolve afterwards."""
        self.build("refusing")
        head = self.commit_in_submodule()
        self.settle()

        support.git("worktree", "remove", "--force", str(self.agent.worktree), cwd=self.repo)

        shared = self.repo / ".git" / "modules" / self.project.sub_path
        kind = support.git("cat-file", "-t", head, cwd=shared).stdout.strip()
        self.assertEqual(kind, "commit")

    def test_refusing_remote_keeps_the_resolve_before_next_cycle_wording(self) -> None:
        self.build("refusing")
        self.commit_in_submodule()
        # Break the rescue too, so the bleakest branch is the one exercised.
        shutil.rmtree(self.repo / ".git" / "modules" / self.project.sub_path)

        output = self.settle()

        self.assertIn("ONLY in the worktree", output)
        self.assertIn("resolve this before the next cycle", output)

    # -- not this idea's submodules ---------------------------------------------------

    def test_only_this_ideas_submodules_are_settled(self) -> None:
        """submodule_paths filters on ideas/<slug>/, so another idea's work is not touched."""
        self.build("plain")
        head = self.commit_in_submodule()
        self.agent.slug = "somebody-else"

        output = self.settle()

        self.assertEqual(output, "")
        self.assertNotIn(head, self.remote_heads().values())
