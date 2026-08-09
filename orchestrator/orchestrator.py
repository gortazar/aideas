#!/usr/bin/env python3
"""
Idea-builder orchestrator — run this on a schedule (every 5 min is fine; it exits fast
when there's nothing to do). See orchestrator/systemd/ for the timer unit.

SPEC (authoritative):
  1. Read .agent-config.yml. If outside allowed_hours, or today's recorded cost is over
     max_daily_cost_usd, exit immediately.
  2. Ask the local heartbeat server (fed by the laptop over VPN) whether a Claude Code
     session is currently active there. If the heartbeat is fresh (< heartbeat_
     staleness_minutes old), you're working — exit immediately.
  3. Acquire the repo lock, renewing it for as long as the cycle runs. If another cycle
     is renewing it, exit.
  4. git pull, and push anything a previous cycle failed to push.
  5. PLANNING PASS: for every idea in README.md with no ideas/<slug>/PLAN.md yet, invoke
     Claude to draft one; scaffold the idea folder and its root CI workflow; commit.
  6. BUILD PASS: take up to parallel_agents ideas, highest README priority first, where
     PLAN.md exists, has no unanswered questions, and status is neither blocked nor done.
     An idea in progress past stale_idea_after_hours is deprioritised but not abandoned.
  7. Give each agent its own git worktree on branch agent/<slug>, and regenerate that
     idea's CLAUDE.md from AGENTS.md + PLAN.md + tail of STATUS.md.
  8. Invoke `claude -p` in each worktree, in parallel, resuming its prior session.
  9. Stop the agents on the deadline, a signal, or the stop file — always gracefully, so
     the work still gets committed. Merge each branch back, update STATUS.md, commit.
 10. Push, record real cost, release the lock, exit.

Ported from orchestrator.sh. Two classes of bug simply cannot recur here: the float
comparisons that silently disabled the budget gate under a comma-decimal locale are now
native arithmetic, and agents are held as Popen objects, so signalling one can no longer
hit a wrapper process instead of Claude itself.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

UNLIMITED = {"unlimited", "none", "off"}
LOG_ENTRY_RE = re.compile(
    r"^- \d{4}-\d{2}-\d{2}T\S+ — (in_progress|blocked|done) "
)
# The trailing slash is optional: requiring it silently swallowed every entry written as
# `(ideas/recap)` rather than `(ideas/recap/)` — no error, the idea simply never existed.
# The negative lookahead stops `recap` from also matching inside `ideas/recap-gs`.
SLUG_RE = re.compile(r"(?<=ideas/)[a-z0-9][a-z0-9-]*(?![a-z0-9-])")


def log(message: str) -> None:
    print(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {message}",
          flush=True)


def is_unlimited(value: str | None) -> bool:
    return (value or "").strip().lower() in UNLIMITED


# --------------------------------------------------------------------------- config


def load_config(path: Path) -> dict[str, str]:
    """Parse the `key: value` subset of YAML the config actually uses.

    Deliberately dependency-free: the orchestrator box should need nothing but a stock
    python3. Values containing '#' would be truncated, which nothing in the config does.
    """
    cfg: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        cfg[key.strip()] = value.strip().strip('"').strip("'")
    return cfg


@dataclass
class Config:
    raw: dict[str, str]

    def get(self, key: str, default: str = "") -> str:
        return self.raw.get(key, default)

    def number(self, key: str, default: float) -> float:
        try:
            return float(self.raw[key])
        except (KeyError, ValueError):
            return default

    def integer(self, key: str, default: int) -> int:
        try:
            value = int(self.raw[key])
        except (KeyError, ValueError):
            return default
        return value if value > 0 else default


# ----------------------------------------------------------------------------- lock


class RepoLock:
    """Expiring lock over the ideas repo, renewed while the cycle runs.

    `mkdir` is the atomic primitive (works on any POSIX filesystem, no flock needed).
    The lock is *renewed* rather than trusted for its whole TTL: timing out from when the
    lock was taken made "held" mean only "taken recently", so a stalled cycle kept the
    lock looking valid while a long one kept working after others were free to reclaim it.
    A suspended laptop showed both at once — 17 hours held against a 60-minute TTL. With
    renewal, "held" means "something was alive within the last TTL", which stays true
    across suspends, crashes and SIGKILL alike.
    """

    def __init__(self, state_dir: Path, ttl_minutes: float, renew_seconds: float):
        self.dir = state_dir / "lock"
        self.meta = self.dir / "meta.json"
        self.ttl_minutes = ttl_minutes
        self.renew_seconds = renew_seconds
        self.token = f"{os.uname().nodename}-{os.getpid()}-{time.time_ns()}"
        self.acquired_at = 0
        self._lost = threading.Event()
        self._stop_renewing = threading.Event()
        self._renewer: threading.Thread | None = None

    def _token_in_meta(self) -> str | None:
        try:
            return json.loads(self.meta.read_text()).get("token")
        except (OSError, json.JSONDecodeError):
            return None

    def _write_meta(self) -> None:
        payload = {
            "token": self.token,
            "acquired_at": self.acquired_at,
            "renewed_at": int(time.time()),
            "ttl_minutes": self.ttl_minutes,
            "pid": os.getpid(),
        }
        tmp = self.meta.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload))
        tmp.replace(self.meta)  # rename, so a reader never sees a half-written file

    def _renew_loop(self) -> None:
        while not self._stop_renewing.wait(self.renew_seconds):
            if self._token_in_meta() != self.token:
                # Someone declared this cycle dead and took the lock while it was stalled.
                # Stop renewing rather than stamping over the new holder's lock.
                self._lost.set()
                return
            try:
                self._write_meta()
            except OSError:
                self._lost.set()
                return

    def acquire(self) -> bool:
        self.dir.parent.mkdir(parents=True, exist_ok=True)
        self.acquired_at = int(time.time())
        try:
            self.dir.mkdir()
        except FileExistsError:
            if not self._reclaim_if_stale():
                return False
        self._write_meta()
        self._renewer = threading.Thread(target=self._renew_loop, daemon=True)
        self._renewer.start()
        return True

    def _reclaim_if_stale(self) -> bool:
        try:
            meta = json.loads(self.meta.read_text())
        except (OSError, json.JSONDecodeError):
            # Unreadable metadata: treat as abandoned rather than wedging forever.
            log("Reclaiming lock with unreadable metadata")
            shutil.rmtree(self.dir, ignore_errors=True)
            self.dir.mkdir(parents=True, exist_ok=True)
            return True

        # A lock written before renewal existed has no renewed_at; fall back to when it
        # was taken so an old lock left by an upgrade still ages out.
        last_seen = meta.get("renewed_at") or meta.get("acquired_at")
        ttl = meta.get("ttl_minutes", self.ttl_minutes)
        if last_seen is None:
            shutil.rmtree(self.dir, ignore_errors=True)
            self.dir.mkdir(parents=True, exist_ok=True)
            return True

        age_minutes = (time.time() - float(last_seen)) / 60
        if age_minutes <= float(ttl):
            return False
        log(f"Reclaiming stale lock (no renewal for {age_minutes:.0f}m > ttl {ttl}m)")
        shutil.rmtree(self.dir, ignore_errors=True)
        self.dir.mkdir(parents=True, exist_ok=True)
        return True

    @property
    def lost(self) -> bool:
        return self._lost.is_set()

    def release(self) -> None:
        self._stop_renewing.set()
        if self._renewer:
            self._renewer.join(timeout=2)
        # Never delete a lock that is no longer ours: after a reclaim it belongs to a live
        # cycle, and removing it would hand the repo to a third one.
        if self._token_in_meta() in (self.token, None) or not self.meta.exists():
            shutil.rmtree(self.dir, ignore_errors=True)


# ------------------------------------------------------------------------------ git


def git(*args: str, cwd: Path, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=check,
        capture_output=True, text=True,
    )


# ------------------------------------------------------------------- idea state I/O


def has_unanswered_questions(plan: Path) -> bool:
    """True iff the Open Questions section still holds an unticked checkbox.

    Only `- [ ]` counts, as the template documents. Also treating any line ending in "?"
    as a question made ordinary prose look blocking.
    """
    if not plan.is_file():
        return False
    in_section = False
    for line in plan.read_text().splitlines():
        if line.startswith("## Open Questions"):
            in_section = True
            continue
        if line.startswith("## "):
            in_section = False
        if in_section and re.match(r"^\s*-\s*\[\s\]", line):
            return True
    return False


def status_value(status: Path, key: str) -> str | None:
    if not status.is_file():
        return None
    for line in status.read_text().splitlines():
        match = re.match(rf"^{key}:\s*(.*)$", line, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def parse_timestamp(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return parsed.timestamp()


def recover_session_id(agent_cwd: Path) -> str | None:
    """Read the session id off the transcript Claude Code left on disk.

    A SIGTERMed agent still writes a result JSON carrying its session id, so this is the
    fallback for the cases that don't: SIGKILL after the grace period, or a crash. Without
    it those would silently start a brand-new conversation next cycle, throwing away
    everything the agent had worked out. Transcripts live in a directory named after the
    working directory with every non-alphanumeric character replaced by '-'.
    """
    encoded = re.sub(r"[^a-zA-Z0-9]", "-", str(agent_cwd))
    directory = Path.home() / ".claude" / "projects" / encoded
    if not directory.is_dir():
        return None
    transcripts = sorted(directory.glob("*.jsonl"), key=lambda p: p.stat().st_mtime,
                         reverse=True)
    return transcripts[0].stem if transcripts else None


# ----------------------------------------------------------------------- the agents


@dataclass
class Agent:
    slug: str
    worktree: Path
    out_file: Path
    process: subprocess.Popen | None = None
    result: dict = field(default_factory=dict)

    @property
    def idea_dir(self) -> Path:
        return self.worktree / "ideas" / self.slug

    def load_result(self) -> dict:
        try:
            self.result = json.loads(self.out_file.read_text())
        except (OSError, json.JSONDecodeError):
            self.result = {}
        return self.result


class Orchestrator:
    def __init__(self, repo: Path, heartbeat_url: str):
        self.repo = repo
        self.heartbeat_url = heartbeat_url.rstrip("/")
        self.state_dir = repo / ".orchestrator"
        # Everything under .orchestrator/ must exist before the lock (which lives there)
        # can be taken — on a fresh clone it doesn't.
        for sub in ("logs", "sessions", "worktrees"):
            (self.state_dir / sub).mkdir(parents=True, exist_ok=True)

        self.config = Config(load_config(repo / ".agent-config.yml"))
        self.usage_log = self.state_dir / "usage.log"
        self.stop_file = self.state_dir / "stop"
        self.agents_md = repo / "AGENTS.md"

        self.started_at = time.time()
        self.stop_reason: str | None = None
        self.lock = RepoLock(
            self.state_dir,
            self.config.number("lock_ttl_minutes", 5),
            self.config.number("lock_renew_seconds", 30),
        )
        self.agents: list[Agent] = []

    # -- graceful stop ------------------------------------------------------------

    def request_stop(self, reason: str) -> None:
        if self.stop_reason is None:
            self.stop_reason = reason

    def deadline_passed(self) -> bool:
        limit = self.config.get("max_cycle_minutes", "45")
        if is_unlimited(limit):
            return False
        try:
            minutes = float(limit)
        except ValueError:
            minutes = 45.0
        return time.time() >= self.started_at + minutes * 60

    def stop_requested(self) -> bool:
        """SIGTERM, the stop file, the deadline and a reclaimed lock all mean the same
        thing: wind the agents down and finish the cycle properly."""
        if self.stop_reason:
            return True
        if self.stop_file.exists():
            self.request_stop("stop file")
        elif self.deadline_passed():
            self.request_stop(
                f"max_cycle_minutes={self.config.get('max_cycle_minutes', '45')} reached")
        elif self.lock.lost:
            self.request_stop("lock reclaimed by another cycle")
        return self.stop_reason is not None

    # -- gates --------------------------------------------------------------------

    def within_allowed_hours(self) -> bool:
        window = self.config.get("allowed_hours", "")
        if is_unlimited(window):
            log(f"allowed_hours is {window}; running at any hour.")
            return True
        tz_name = self.config.get("timezone", "")
        if tz_name:
            os.environ["TZ"] = tz_name
            time.tzset()
        try:
            start_s, end_s = window.split("-")
            to_minutes = lambda t: int(t.split(":")[0]) * 60 + int(t.split(":")[1])
            start, end = to_minutes(start_s), to_minutes(end_s)
        except (ValueError, IndexError):
            log(f"allowed_hours is unparseable ({window!r}); refusing to run.")
            return False
        now = datetime.now()
        current = now.hour * 60 + now.minute
        inside = (start <= current < end) if start <= end else (
            current >= start or current < end)
        if not inside:
            log(f"Outside allowed_hours ({window} {tz_name}); exiting.")
        return inside

    def spend_today(self) -> float:
        """usage.log is CSV: date,cost_usd,slug,phase,turns"""
        today = datetime.now().strftime("%Y-%m-%d")
        total = 0.0
        if not self.usage_log.is_file():
            return 0.0
        for line in self.usage_log.read_text().splitlines():
            parts = line.split(",")
            if len(parts) >= 2 and parts[0] == today:
                try:
                    total += float(parts[1])
                except ValueError:
                    continue
        return total

    def within_budget(self) -> bool:
        cap = self.config.get("max_daily_cost_usd", "")
        spent = self.spend_today()
        if is_unlimited(cap):
            log(f"Today's spend so far: ${spent:.4f}; daily budget is {cap}.")
            return True
        try:
            limit = float(cap)
        except ValueError:
            # An unreadable cap counts as spent: never treat a broken config as free money.
            log(f"max_daily_cost_usd is unparseable ({cap!r}); exiting.")
            return False
        if spent >= limit:
            log(f"Daily budget spent (${spent:.4f} >= ${limit:.2f}); exiting.")
            return False
        log(f"Today's spend so far: ${spent:.4f} of ${limit:.2f}.")
        return True

    def laptop_is_idle(self) -> bool:
        """A dead heartbeat server is not evidence the laptop is idle — it is the absence
        of evidence either way. Backing off is the safe reading: building while the user
        works spends the very allowance this gate exists to protect."""
        try:
            with urllib.request.urlopen(f"{self.heartbeat_url}/status", timeout=3) as r:
                stale_seconds = float(json.loads(r.read()).get("stale_seconds", 0))
        except Exception as exc:  # noqa: BLE001 — any failure means "can't tell"
            log(f"Heartbeat server unreachable at {self.heartbeat_url} ({exc}); "
                "can't tell whether the laptop is busy; exiting.")
            return False
        threshold = self.config.number("heartbeat_staleness_minutes", 10) * 60
        if stale_seconds < threshold:
            log(f"Laptop Claude Code session active (heartbeat {stale_seconds:.0f}s old); "
                "exiting.")
            return False
        return True

    # -- README ---------------------------------------------------------------------

    def ideas_section(self) -> str:
        """Just the '## Ideas' section — the actual work queue.

        Scanning the whole file made any path mentioned in prose look like an idea: the
        format documentation's own `ideas/recap` example became a phantom entry the
        planner then tried to draft a plan for. It would equally resurrect everything
        moved to a '## Finished' section. Falls back to the whole file when there is no
        such heading, which is what a README written before sections existed looks like.
        """
        text = (self.repo / "README.md").read_text()
        match = re.search(r"^##\s+Ideas\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
        return match.group(1) if match else text

    def idea_slugs(self) -> list[str]:
        """Slugs in README order, de-duplicated.

        The shell version ended in `uniq`, which only drops *adjacent* repeats; this drops
        all of them, which is what was always meant.
        """
        seen: list[str] = []
        for slug in SLUG_RE.findall(self.ideas_section()):
            if slug not in seen:
                seen.append(slug)
        return seen

    def idea_description(self, slug: str) -> str:
        """The entry's lines, from its link to the next blank line."""
        # Bounded so `recap` doesn't match the `ideas/recap-gs` entry, and slash-optional
        # so it finds the link however it was written.
        link = re.compile(rf"ideas/{re.escape(slug)}(?![a-z0-9-])")
        lines = self.ideas_section().splitlines()
        collected: list[str] = []
        for line in lines:
            if not collected and not link.search(line):
                continue
            if collected and not line.strip():
                break
            collected.append(line)
        return "\n".join(collected)

    # -- usage ----------------------------------------------------------------------

    def record_usage(self, agent: Agent, phase: str) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        result = agent.result
        if not result:
            # Cost and turns live only in the result JSON. A SIGTERMed agent does still
            # write one, so this is only reached after a SIGKILL or a crash. Say so rather
            # than logging a confident $0, which would make the cycle look free.
            with self.usage_log.open("a") as fh:
                fh.write(f"{today},0,{agent.slug},{phase}-stopped,0\n")
            log(f"WARNING: {phase}/{agent.slug} produced no result JSON (agent stopped); "
                "its real cost is unknown and is recorded as $0.")
            return
        cost = float(result.get("total_cost_usd", 0) or 0)
        turns = result.get("num_turns", 0)
        denials = len(result.get("permission_denials") or [])
        with self.usage_log.open("a") as fh:
            fh.write(f"{today},{cost},{agent.slug},{phase},{turns}\n")
        log(f"{phase}/{agent.slug}: ${cost:.4f}, {turns} turns, {denials} permission denials.")
        if denials:
            # Denials mean Claude tried a tool --allowed-tools didn't cover: it silently
            # did less than it wanted to, which otherwise looks like a quiet cycle.
            log(f"WARNING: {denials} tool call(s) denied — widen --allowed-tools if this repeats.")

    def claude_budget_args(self, key: str) -> list[str]:
        value = self.config.get(key, "")
        return [] if is_unlimited(value) else ["--max-budget-usd", value]

    # -- planning pass ----------------------------------------------------------------

    def planning_pass(self, slugs: list[str]) -> None:
        template_status = self.repo / "ideas" / "_template" / "STATUS.md"
        template_ci = self.repo / "ideas" / "_template" / "ci.yml"

        for slug in slugs:
            # Planning draws on the same wall clock as the build phase; without this a
            # long planning pass could burn the whole deadline and hand over to agents
            # with no time left.
            if self.stop_requested():
                log(f"Stopping before planning {slug}: {self.stop_reason}.")
                return

            idea_dir = self.repo / "ideas" / slug
            idea_dir.mkdir(parents=True, exist_ok=True)
            status = idea_dir / "STATUS.md"
            if not status.exists() and template_status.is_file():
                shutil.copy(template_status, status)

            # GitHub only discovers workflows under the repo-root .github/workflows/, so
            # each idea's path-filtered CI lives there as ci-<slug>.yml. Scaffolded for
            # every idea, not only newly planned ones: a hand-seeded PLAN.md skips the
            # drafting below, and gating the workflow on that left such ideas with no CI.
            ci_path = self.repo / ".github" / "workflows" / f"ci-{slug}.yml"
            if not ci_path.exists() and template_ci.is_file():
                ci_path.parent.mkdir(parents=True, exist_ok=True)
                body = template_ci.read_text().split("# --- template header ends ---\n", 1)
                ci_path.write_text(body[-1].replace("<idea-slug>", slug))
                git("add", str(ci_path.relative_to(self.repo)), cwd=self.repo)
                git("commit", "-m", f"Add CI workflow for {slug}", "--quiet", cwd=self.repo)

            plan = idea_dir / "PLAN.md"
            if plan.exists():
                continue

            log(f"Drafting plan for {slug}")
            out_file = self.state_dir / "logs" / f"plan-{slug}-{int(time.time())}.json"
            prompt = (
                f"Draft ideas/{slug}/PLAN.md for this idea:\n\n"
                f"{self.idea_description(slug)}\n\n"
                "Include: a '## Features' section listing main features, and if anything is\n"
                "genuinely ambiguous, a '## Open Questions' section where every question is its\n"
                "own '- [ ] question text' line. Also add a one-line difficulty estimate\n"
                "(easy/medium/hard) with a short reason. Do not start implementing yet."
            )
            command = [
                "claude", "-p", prompt,
                "--allowed-tools", "Read,Write",
                "--permission-mode", "acceptEdits",
                *self.claude_budget_args("max_plan_cost_usd"),
                "--output-format", "json",
            ]
            with out_file.open("w") as fh:
                subprocess.run(command, cwd=self.repo, stdout=fh)

            agent = Agent(slug=slug, worktree=self.repo, out_file=out_file)
            agent.load_result()
            self.record_usage(agent, "plan")
            git("add", f"ideas/{slug}", cwd=self.repo)
            git("commit", "-m", f"Draft plan for {slug}", "--quiet", cwd=self.repo)

    # -- scheduling ---------------------------------------------------------------------

    def pick_ideas(self, slugs: list[str], want: int) -> list[str]:
        fresh: list[str] = []
        stalled: list[str] = []
        stale_after = self.config.number("stale_idea_after_hours", 6)

        for slug in slugs:
            idea_dir = self.repo / "ideas" / slug
            plan, status = idea_dir / "PLAN.md", idea_dir / "STATUS.md"
            if not plan.is_file() or has_unanswered_questions(plan):
                continue
            state = (status_value(status, "status") or "").lower()
            if state == "blocked":
                continue
            # A finished idea stays finished; without this it is rebuilt every cycle.
            if state in ("done", "complete", "completed"):
                continue
            if state == "in_progress":
                started = parse_timestamp(status_value(status, "started_at"))
                if started and (time.time() - started) / 3600 > stale_after:
                    # Grinding on too long — deprioritise, don't disqualify.
                    stalled.append(slug)
                    continue
            fresh.append(slug)

        # Fresh ideas fill the slots first; stalled ones take what's left. That keeps a
        # long-running idea deprioritised without ever abandoning it — if everything is
        # stalled, work continues rather than halting forever.
        chosen = (fresh + stalled)[:want]
        if chosen and not fresh:
            log(f"All eligible ideas are past stale_idea_after_hours; resuming {chosen[0]}.")
        return chosen

    # -- build pass -----------------------------------------------------------------------

    def start_agent(self, slug: str) -> Agent:
        worktree = self.state_dir / "worktrees" / slug
        # A worktree left behind by a killed cycle would block `worktree add`.
        git("worktree", "remove", "--force", str(worktree), cwd=self.repo)
        git("branch", "-D", f"agent/{slug}", cwd=self.repo)
        git("worktree", "add", "--quiet", "-b", f"agent/{slug}", str(worktree), "HEAD",
            cwd=self.repo)

        agent = Agent(
            slug=slug,
            worktree=worktree,
            out_file=self.state_dir / "logs" / f"{slug}-{int(time.time())}.json",
        )

        # CLAUDE.md is regenerated every cycle, never hand-edited, so edits to AGENTS.md
        # and newly answered questions in PLAN.md propagate on the very next cycle.
        parts = [self.agents_md.read_text(), ""]
        parts.append((agent.idea_dir / "PLAN.md").read_text())
        parts.append("\n## Current status")
        status_file = agent.idea_dir / "STATUS.md"
        if status_file.is_file():
            parts.append("\n".join(status_file.read_text().splitlines()[-20:]))
        (agent.idea_dir / "CLAUDE.md").write_text("\n".join(parts))

        resume: list[str] = []
        session_file = self.state_dir / "sessions" / f"{slug}.id"
        if session_file.is_file():
            resume = ["--resume", session_file.read_text().strip()]

        command = [
            "claude", "-p", "Continue implementing this idea per CLAUDE.md.",
            "--allowed-tools", "Bash,Read,Edit,Write,Glob,Grep",
            "--permission-mode", "acceptEdits",
            *self.claude_budget_args("max_cycle_cost_usd"),
            "--output-format", "json",
            *resume,
        ]
        agent.process = subprocess.Popen(
            command, cwd=agent.idea_dir, stdout=agent.out_file.open("w"),
        )
        return agent

    def wait_for_agents(self) -> None:
        """Poll rather than block: a plain wait would run until the agents finish, which
        with no budget cap may be never, leaving no room to react to a stop request or to
        finish before systemd's TimeoutStartSec kills us mid-merge."""
        limit = self.config.get("max_cycle_minutes", "45")
        if not is_unlimited(limit):
            finish_by = datetime.fromtimestamp(self.started_at + float(limit) * 60)
            log(f"Cycle must finish by {finish_by.strftime('%H:%M:%S')} "
                f"(max_cycle_minutes={limit}, counted from script start).")

        while any(a.process and a.process.poll() is None for a in self.agents):
            if self.stop_requested():
                self.wind_down()
                break
            time.sleep(5)

        for agent in self.agents:
            if agent.process:
                agent.process.wait()

    def wind_down(self) -> None:
        """Ask every agent to stop, then give it agent_grace_seconds before forcing it.
        Claude Code handles SIGTERM by shutting the session down and still writes its
        result JSON, so the work in the worktree and the resumable session both survive."""
        log(f"Winding down agents gracefully: {self.stop_reason}.")
        grace = self.config.number("agent_grace_seconds", 90)
        alive = [a for a in self.agents if a.process and a.process.poll() is None]
        for agent in alive:
            log(f"  SIGTERM -> {agent.slug} agent (pid {agent.process.pid})")
            agent.process.terminate()

        deadline = time.time() + grace
        for agent in alive:
            remaining = max(0.0, deadline - time.time())
            try:
                agent.process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                log(f"  {agent.slug} agent still alive after {grace:.0f}s; "
                    "escalating to SIGKILL")
                agent.process.kill()

    # -- finalize -------------------------------------------------------------------------

    def rewrite_status(self, slug: str, new_status: str, session_id: str, cost: float) -> None:
        status_file = self.repo / "ideas" / slug / "STATUS.md"
        existing = status_file.read_text().splitlines() if status_file.is_file() else []

        previous_started = status_value(status_file, "started_at")
        started = previous_started or datetime.now().astimezone().isoformat(timespec="seconds")
        now = datetime.now().astimezone().isoformat(timespec="seconds")

        # Re-gather the log from wherever it ended up. The agent rewrites STATUS.md too,
        # and when it puts its own report directly under "## Log" the older entries get
        # carried below it — so the log arrives fragmented, oldest entries stranded at the
        # bottom. Collecting by line shape fixes that however the agent lays the file out.
        previous_entries = [ln for ln in existing if LOG_ENTRY_RE.match(ln)]

        body: list[str] = []
        in_header, in_comment = True, False
        for line in existing:
            if in_header and (re.match(r"^[a-z_]+:", line) or not line.strip()):
                continue
            in_header = False
            if line.startswith("## Log") or LOG_ENTRY_RE.match(line):
                continue
            # Skip whole HTML comments, not just their opening line: dropping only the
            # opener stranded the rest of a multi-line comment as visible text.
            if in_comment:
                if "-->" in line:
                    in_comment = False
                continue
            if line.lstrip().startswith("<!--"):
                if "-->" not in line:
                    in_comment = True
                continue
            body.append(line)

        out = [
            f"status: {new_status}",
            f"started_at: {started}",
            f"last_session_id: {session_id}",
            f"last_run: {now}",
            f"last_cycle_cost_usd: {cost}",
            "",
            "## Log",
            f"- {now} — {new_status} (${cost})",
            *previous_entries,
            "",
            *body,
        ]
        status_file.write_text("\n".join(out).rstrip() + "\n")

    def finalize(self, agent: Agent) -> None:
        slug = agent.slug
        result = agent.load_result()

        session_id = result.get("session_id") or ""
        if not session_id:
            # No result JSON: the agent was killed rather than stopped. Fall back to the
            # transcript so the next cycle can still --resume this conversation.
            session_id = recover_session_id(agent.idea_dir) or ""
            if session_id:
                log(f"{slug}: recovered session {session_id} from its transcript.")
        if session_id:
            (self.state_dir / "sessions" / f"{slug}.id").write_text(session_id)

        # Sweep up whatever the agent left uncommitted in its own worktree.
        git("add", "-A", cwd=agent.worktree)
        git("commit", "-m", f"{slug}: uncommitted work from automated build cycle",
            "--quiet", cwd=agent.worktree)

        # Each agent touches only its own ideas/<slug>/ and ci-<slug>.yml, so the branches
        # are disjoint and this should never conflict. If one does, something crossed
        # lanes: keep the branch and worktree for inspection rather than discarding work.
        merge = git("merge", "--no-ff", "--no-edit", "--quiet", f"agent/{slug}", cwd=self.repo)
        if merge.returncode != 0:
            git("merge", "--abort", cwd=self.repo)
            log(f"WARNING: merging agent/{slug} conflicted — work kept on that branch in "
                f"{agent.worktree}; skipping.")
            self.record_usage(agent, "build")
            return
        git("worktree", "remove", "--force", str(agent.worktree), cwd=self.repo)
        git("branch", "-d", f"agent/{slug}", "--quiet", cwd=self.repo)

        # pick_ideas only selects ideas with zero unanswered questions, so any unticked
        # checkbox now can only have been appended by the run that just finished.
        plan = self.repo / "ideas" / slug / "PLAN.md"
        status_file = self.repo / "ideas" / slug / "STATUS.md"
        if has_unanswered_questions(plan):
            new_status = "blocked"
        elif (status_value(status_file, "status") or "").lower() in (
                "done", "complete", "completed"):
            # The agent declared the idea finished. Preserve that: overwriting it with
            # in_progress meant an idea could never reach a terminal state, so a finished
            # one was rebuilt from scratch every cycle, forever.
            new_status = "done"
        else:
            new_status = "in_progress"

        cost = float(result.get("total_cost_usd", 0) or 0)
        self.rewrite_status(slug, new_status, session_id, cost)

        git("add", "-A", cwd=self.repo)
        note = "blocked on new question" if new_status == "blocked" else "progress"
        git("commit", "-m", f"{slug}: automated build cycle ({note})", "--quiet", cwd=self.repo)
        self.record_usage(agent, "build")
        log(f"Cycle complete for {slug} ({new_status}).")

    # -- main ---------------------------------------------------------------------------

    def run(self) -> int:
        if self.stop_file.exists():
            log(f"Paused: {self.stop_file} exists. Remove it to resume.")
            return 0
        if not self.within_allowed_hours() or not self.within_budget():
            return 0
        if not self.laptop_is_idle():
            return 0
        if not self.lock.acquire():
            log("Lock held by another run; exiting.")
            return 0

        try:
            if git("pull", "--quiet", "--ff-only", cwd=self.repo).returncode != 0:
                log("pull failed — continuing with the local tree")

            # Push anything a previous cycle committed but failed to send. Its own retry
            # only happens after the next cycle's agents finish, so a transient network
            # failure otherwise leaves work unpushed for another full cycle — and if the
            # clone is disposable, until it is deleted.
            ahead = git("rev-list", "--count", "@{u}..HEAD", cwd=self.repo).stdout.strip()
            if ahead.isdigit() and int(ahead) > 0:
                log(f"{ahead} commit(s) from a previous cycle are unpushed; pushing "
                    "before starting work.")
                if git("push", "--quiet", cwd=self.repo).returncode != 0:
                    log("push still failing — continuing; will retry at the end of this cycle")

            slugs = self.idea_slugs()
            if not slugs:
                log("No ideas found in README.md (expected links of the form ideas/<slug>/); "
                    "exiting.")
                return 0

            self.planning_pass(slugs)

            # Commit scaffolding before worktrees branch off HEAD, or agents start from a
            # tree missing their own STATUS.md and the merge trips over local changes.
            git("add", "-A", cwd=self.repo)
            git("commit", "-m", "Scaffold idea files", "--quiet", cwd=self.repo)

            # Starting agents now would mean launching them with no time to work.
            if self.stop_requested():
                log(f"Not starting a build phase: {self.stop_reason}.")
                return 0

            parallel = self.config.integer("parallel_agents", 2)
            chosen = self.pick_ideas(slugs, parallel)
            if not chosen:
                log("No idea is currently buildable (all blocked or planned only); exiting.")
                return 0
            log(f"Building {len(chosen)} of {parallel} slot(s) in parallel: {' '.join(chosen)}")

            git("worktree", "prune", cwd=self.repo)
            self.agents = [self.start_agent(slug) for slug in chosen]
            self.wait_for_agents()

            if self.lock.lost:
                # Finalize anyway: the agents' work is real and abandoning it would be
                # worse than a brief overlap. Each finalize is seconds of git.
                log("WARNING: this cycle's lock was reclaimed while it ran — another cycle")
                log("WARNING: may be working on this repo concurrently. Finalizing anyway;")
                log("WARNING: check for merge conflicts and leftover agent/* branches.")

            for agent in self.agents:
                self.finalize(agent)

            if git("push", "--quiet", cwd=self.repo).returncode != 0:
                log("push failed — will retry next cycle")
            return 0
        finally:
            self.lock.release()


def main() -> int:
    repo = os.environ.get("IDEAS_REPO_PATH")
    heartbeat = os.environ.get("ORCHESTRATOR_HEARTBEAT_SELF_URL")
    if not repo:
        print("IDEAS_REPO_PATH must be set to the local clone of your ideas repo",
              file=sys.stderr)
        return 2
    if not heartbeat:
        print("ORCHESTRATOR_HEARTBEAT_SELF_URL must be set, e.g. http://127.0.0.1:8787",
              file=sys.stderr)
        return 2

    orchestrator = Orchestrator(Path(repo).resolve(), heartbeat)

    def on_signal(signum, _frame):
        # systemd sends SIGTERM when TimeoutStartSec expires or on `systemctl stop`.
        # Treat it as "wind down now" rather than dying, so the cycle still commits.
        orchestrator.request_stop(f"signal {signal.Signals(signum).name}")

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    return orchestrator.run()


if __name__ == "__main__":
    sys.exit(main())
