"""Fixtures shared by the orchestrator's test suite.

Everything here is built from a stock `git` and the standard library, inside a temporary
directory that the machine's own configuration cannot reach: `GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_NOSYSTEM` are forced for the duration of every test, so a `user.name`, a
`push.default`, a signing key or a `protocol.file.allow` on the developer's box cannot change
a result. `HOME` is moved too, because `recover_session_id` reads transcripts from under it.

The fixtures are the ones every case needs:

- `GitSandbox`         — a TestCase base with the environment above and a fresh tmpdir.
- `init_repo`          — a working repository on `main` with one commit.
- `bare_remote`        — a bare repository on `main`.
- `gated_remote`       — a bare repository whose `pre-receive` hook refuses every update to
                         `refs/heads/main`, which is how a branch ruleset is simulated
                         without a network.
- `refusing_remote`    — a bare repository whose hook refuses everything.
- `Superproject`       — a repository with `.agent-config.yml`, `README.md`, an idea folder
                         and a submodule at `ideas/<slug>/upstream`, plus a linked worktree on
                         `agent/<slug>` with that submodule checked out inside it — the exact
                         layout `settle_submodules` reads back.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

import orchestrator as orch

PRE_RECEIVE_REFUSING_MAIN = """#!/bin/sh
# Simulates a branch ruleset: the default branch only moves by pull request.
status=0
while read -r _old _new ref; do
    if [ "$ref" = "refs/heads/main" ]; then
        echo "refusing $ref: protected by ruleset (pull request required)" >&2
        status=1
    fi
done
exit $status
"""

PRE_RECEIVE_REFUSING_ALL = """#!/bin/sh
# Simulates a remote that takes nothing: expired credentials, or a repository gone read-only.
echo "refusing every update" >&2
exit 1
"""


def run(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    """Run a command, capturing output; raise with both streams in the message on failure."""
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise AssertionError(
            f"{' '.join(args)} failed in {cwd} ({result.returncode}):\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}")
    return result


def git(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    return run("git", *args, cwd=cwd, check=check)


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def commit_all(repo: Path, message: str) -> str:
    git("add", "-A", cwd=repo)
    git("commit", "--quiet", "-m", message, cwd=repo)
    return git("rev-parse", "HEAD", cwd=repo).stdout.strip()


def init_repo(path: Path, first_file: str = "README.md", content: str = "hello\n") -> Path:
    path.mkdir(parents=True, exist_ok=True)
    git("init", "--quiet", "-b", "main", cwd=path)
    write(path / first_file, content)
    commit_all(path, "initial")
    return path


def bare_remote(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    git("init", "--quiet", "--bare", "-b", "main", cwd=path)
    return path


def install_hook(bare: Path, name: str, body: str) -> Path:
    hook = bare / "hooks" / name
    hook.parent.mkdir(exist_ok=True)
    hook.write_text(body)
    hook.chmod(hook.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return hook


def gated_remote(path: Path, seed_dir: Path) -> Path:
    """A bare remote with history that refuses updates to `refs/heads/main` from now on.

    Seeded *before* the hook goes in, because a gated repository is one with a `main` that
    used to accept pushes — the hook is the ruleset arriving.
    """
    bare = bare_remote(path)
    seed_remote(bare, seed_dir)
    install_hook(bare, "pre-receive", PRE_RECEIVE_REFUSING_MAIN)
    return bare


def refusing_remote(path: Path, seed_dir: Path) -> Path:
    """A bare remote with history that refuses every update, whatever the ref."""
    bare = bare_remote(path)
    seed_remote(bare, seed_dir)
    install_hook(bare, "pre-receive", PRE_RECEIVE_REFUSING_ALL)
    return bare


def remote_branches(bare: Path) -> dict[str, str]:
    """{branch name: sha} for every `refs/heads/*` in a bare repository."""
    listing = git("for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/",
                  cwd=bare).stdout
    return dict(line.split() for line in listing.splitlines() if line.strip())


def seed_remote(bare: Path, workdir: Path, files: dict[str, str] | None = None) -> str:
    """Give a bare remote a `main` with one commit, via a throwaway clone. Returns the sha."""
    init_repo(workdir)
    for name, text in (files or {}).items():
        write(workdir / name, text)
    if files:
        commit_all(workdir, "seed")
    git("remote", "add", "origin", str(bare), cwd=workdir)
    git("push", "--quiet", "origin", "main", cwd=workdir)
    return git("rev-parse", "HEAD", cwd=workdir).stdout.strip()


AGENT_CONFIG = """\
parallel_agents: 1
max_daily_cost_usd: unlimited
max_cycle_minutes: unlimited
allowed_hours: unlimited
lock_ttl_minutes: 5
lock_renew_seconds: 30
"""


class GitSandbox(unittest.TestCase):
    """A TestCase whose git sees only the configuration written here."""

    def setUp(self) -> None:
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="orchestrator-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

        home = self.tmp / "home"
        home.mkdir()
        gitconfig = write(home / "gitconfig", (
            "[user]\n\tname = Test Agent\n\temail = agent@example.invalid\n"
            "[init]\n\tdefaultBranch = main\n"
            "[commit]\n\tgpgsign = false\n"
            "[protocol \"file\"]\n\tallow = always\n"
            "[advice]\n\tdetachedHead = false\n"
        ))
        self._saved_env = {key: os.environ.get(key) for key in (
            "HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT",
            "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "XDG_CONFIG_HOME")}
        os.environ["HOME"] = str(home)
        os.environ["GIT_CONFIG_GLOBAL"] = str(gitconfig)
        os.environ["GIT_CONFIG_NOSYSTEM"] = "1"
        os.environ["GIT_TERMINAL_PROMPT"] = "0"
        for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "XDG_CONFIG_HOME"):
            os.environ.pop(key, None)
        self.addCleanup(self._restore_env)

    def _restore_env(self) -> None:
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def path(self, *parts: str) -> Path:
        return self.tmp.joinpath(*parts)

    def orchestrator(self, repo: Path) -> orch.Orchestrator:
        """An Orchestrator over `repo`, with no heartbeat and the sandbox config."""
        return orch.Orchestrator(repo, "")


@dataclass
class Superproject:
    """A superproject with one idea whose `upstream` is a submodule, and an agent worktree."""
    slug: str
    repo: Path
    remote: Path
    sub_remote: Path
    worktree: Path
    sub_path: str

    @property
    def sub_in_worktree(self) -> Path:
        return self.worktree / self.sub_path

    @property
    def sub_in_repo(self) -> Path:
        return self.repo / self.sub_path

    def agent(self) -> orch.Agent:
        return orch.Agent(slug=self.slug, worktree=self.worktree,
                          out_file=self.repo / ".orchestrator" / "logs" / f"{self.slug}.json")


def make_superproject(root: Path, slug: str, sub_remote: Path,
                      readme_entry: str | None = None) -> Superproject:
    """Build the layout the orchestrator works in, up to and including an agent worktree.

    `sub_remote` must already hold a `main` (see `seed_remote`). The superproject itself gets a
    bare `origin` so `push_if_ahead` and `@{u}` work, and its `.gitignore` hides
    `.orchestrator/` exactly as the real repository's does.
    """
    repo = init_repo(root / "repo", ".gitignore", ".orchestrator/\nideas/*/CLAUDE.md\n")
    write(repo / ".agent-config.yml", AGENT_CONFIG)
    entry = readme_entry or f"1. [{slug}](ideas/{slug}) - a test idea. Minor update.\n"
    write(repo / "README.md", f"# Ideas\n\n## Ideas\n\n{entry}\n## Finished\n")
    write(repo / "AGENTS.md", "# Rules\n\nBe good.\n")
    write(repo / "ideas" / slug / "PLAN.md", "# Plan\n\n## Features\n\n- one\n\n## Open Questions\n")
    write(repo / "ideas" / slug / "STATUS.md", "status: in_progress\nversion: 0.1\n\n## Log\n\n## Units\n")
    commit_all(repo, "scaffold")

    sub_path = f"ideas/{slug}/upstream"
    git("submodule", "add", "--quiet", str(sub_remote), sub_path, cwd=repo)
    commit_all(repo, f"add {sub_path} submodule")

    remote = bare_remote(root / "remote.git")
    git("remote", "add", "origin", str(remote), cwd=repo)
    git("push", "--quiet", "-u", "origin", "main", cwd=repo)

    worktree = repo / ".orchestrator" / "worktrees" / slug
    worktree.parent.mkdir(parents=True, exist_ok=True)
    git("worktree", "add", "--quiet", "-b", f"agent/{slug}", str(worktree), "HEAD", cwd=repo)
    git("submodule", "update", "--init", "--quiet", "--", sub_path, cwd=worktree)
    return Superproject(slug=slug, repo=repo, remote=remote, sub_remote=sub_remote,
                        worktree=worktree, sub_path=sub_path)
