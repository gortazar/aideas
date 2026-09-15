"""clear_worktree / start_agent: surviving what a previous cycle left behind (orchestrator 1.2).

The regression this guards: a killed cycle left a plain directory where the worktree goes,
`worktree add` refused it, nothing checked, and the cycle died later reading PLAN.md from a
months-old checkout.
"""

from __future__ import annotations

import contextlib
import io
import os
import stat
from unittest import mock

import orchestrator as orch
from tests import support


REAL_POPEN = orch.subprocess.Popen


class FakeProcess:
    """Stands in for the `claude` Popen: never started, so no agent is ever spawned here."""
    pid = 4242
    started: list["FakeProcess"] = []

    def __init__(self, command, cwd, stdout):
        self.command, self.cwd = command, cwd
        stdout.close()
        FakeProcess.started.append(self)

    def poll(self):
        return 0


def popen_without_claude(command, *args, **kwargs):
    """`subprocess.run` (and so `git()`) goes through Popen too; only `claude` is faked."""
    if command and command[0] == "claude":
        return FakeProcess(command, kwargs.get("cwd"), kwargs.get("stdout"))
    return REAL_POPEN(command, *args, **kwargs)


class WorktreeSetupTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.sub_remote = support.bare_remote(self.path("upstream.git"))
        support.seed_remote(self.sub_remote, self.path("seed"))
        self.project = support.make_superproject(self.path("sp"), "demo", self.sub_remote)
        self.repo = self.project.repo
        self.orch = self.orchestrator(self.repo)
        # The fixture already made the agent worktree; these tests are about making it again.
        self.worktree = self.repo / ".orchestrator" / "worktrees" / "demo"

    def test_leftover_plain_directory_is_removed(self) -> None:
        # Forget the registration the way a re-clone does, leaving only the directory.
        support.git("worktree", "remove", "--force", str(self.worktree), cwd=self.repo)
        self.worktree.mkdir(parents=True)
        support.write(self.worktree / "stale" / "file.txt", "old\n")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.orch.clear_worktree(self.worktree, "demo")
        self.assertFalse(self.worktree.exists())
        self.assertIn("leftover directory", out.getvalue())

    def test_read_only_files_do_not_stop_the_removal(self) -> None:
        support.git("worktree", "remove", "--force", str(self.worktree), cwd=self.repo)
        locked_dir = self.worktree / "unpacked"
        support.write(locked_dir / "ro.txt", "read only\n")
        os.chmod(locked_dir / "ro.txt", stat.S_IRUSR)
        os.chmod(locked_dir, stat.S_IRUSR | stat.S_IXUSR)
        self.addCleanup(lambda: locked_dir.exists() and os.chmod(locked_dir, 0o755))
        with contextlib.redirect_stdout(io.StringIO()):
            self.orch.clear_worktree(self.worktree, "demo")
        self.assertFalse(self.worktree.exists())

    def test_registered_worktree_is_removed_and_branch_deleted(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()):
            self.orch.clear_worktree(self.worktree, "demo")
        self.assertFalse(self.worktree.exists())
        branches = support.git("branch", "--list", "agent/demo", cwd=self.repo).stdout
        self.assertEqual(branches.strip(), "")

    def test_failed_worktree_add_raises_naming_the_fault(self) -> None:
        # Make `worktree add -b agent/demo` fail: the branch is checked out elsewhere, so
        # clear_worktree's `branch -D` cannot delete it and `-b` then refuses to recreate it.
        support.git("worktree", "remove", "--force", str(self.worktree), cwd=self.repo)
        elsewhere = self.path("elsewhere")
        support.git("worktree", "add", "--quiet", str(elsewhere), "agent/demo", cwd=self.repo)
        FakeProcess.started.clear()
        with mock.patch.object(orch.subprocess, "Popen", popen_without_claude), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(orch.AgentSetupError) as raised:
                self.orch.start_agent("demo")
        message = str(raised.exception)
        self.assertIn("demo", message)
        self.assertIn("agent/demo", message, "the real git error, not a PLAN.md traceback")
        self.assertNotIn("PLAN.md missing", message)
        self.assertEqual(FakeProcess.started, [], "no agent may be spawned on a failed setup")

    def test_missing_plan_raises_instead_of_starting(self) -> None:
        support.git("rm", "--quiet", "ideas/demo/PLAN.md", cwd=self.repo)
        support.git("commit", "--quiet", "-m", "drop plan", cwd=self.repo)
        support.git("worktree", "remove", "--force", str(self.worktree), cwd=self.repo)
        with mock.patch.object(orch.subprocess, "Popen", popen_without_claude), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(orch.AgentSetupError) as raised:
                self.orch.start_agent("demo")
        self.assertIn("PLAN.md missing", str(raised.exception))
        self.assertFalse(self.worktree.exists(), "a half-made worktree is cleaned up")

    def test_start_agent_builds_claude_md_from_agents_plan_and_status_tail(self) -> None:
        status = self.repo / "ideas" / "demo" / "STATUS.md"
        lines = ["status: in_progress", "version: 0.1", "", "## Log", ""]
        lines += [f"old line {n}" for n in range(30)]
        lines += ["**Sweep notice** the tail must reach the agent"]
        support.write(status, "\n".join(lines) + "\n")
        support.commit_all(self.repo, "long status")
        support.git("worktree", "remove", "--force", str(self.worktree), cwd=self.repo)

        with mock.patch.object(orch.subprocess, "Popen", popen_without_claude), \
                contextlib.redirect_stdout(io.StringIO()):
            agent = self.orch.start_agent("demo")
        self.assertEqual(agent.worktree, self.worktree)
        claude_md = (agent.idea_dir / "CLAUDE.md").read_text()
        self.assertIn("Be good.", claude_md)
        self.assertIn("## Features", claude_md)
        self.assertIn("Sweep notice", claude_md)
        self.assertNotIn("old line 5", claude_md, "only the last 20 lines of STATUS.md")
        self.assertIn("old line 29", claude_md)
        self.assertEqual(agent.process.cwd, agent.idea_dir)
