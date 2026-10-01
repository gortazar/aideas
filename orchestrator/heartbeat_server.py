#!/usr/bin/env python3
"""
Minimal heartbeat receiver for the idea-builder orchestrator.

Bind this ONLY to your VPN interface IP (set HEARTBEAT_BIND_IP), never 0.0.0.0 on a
public interface. Claude Code hooks on the laptop POST to /heartbeat on SessionStart,
PostToolUse, and SessionEnd. The orchestrator polls GET /status to decide if a laptop
Claude Code session is currently active.

State is kept in a single JSON file so it survives restarts of this process.
"""
import json
import os
import shlex
import subprocess
import sys
import time
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# GET /state answers "is a cycle running, and what is every idea doing" for anything
# building a UI on top — a shell extension, a status bar. It is served from here because
# this is already the one process on the orchestrator box that the laptop can reach, and
# because a GNOME Shell extension must not spawn `orchestrator.py status` to find out:
# spawning external programs is what EGO review rejects.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import orchestrator as _orch
except Exception:  # noqa: BLE001 — /state degrades, /heartbeat must keep working
    _orch = None

STATE_PATH = os.environ.get("HEARTBEAT_STATE_PATH", "/var/lib/idea-agent/heartbeat.json")
SECRET = os.environ.get("HEARTBEAT_SHARED_SECRET", "")
BIND_IP = os.environ.get("HEARTBEAT_BIND_IP", "127.0.0.1")
PORT = int(os.environ.get("HEARTBEAT_PORT", "8787"))

# How a cycle is started when POST /cycle decides one may run.
#
# Set this on a box whose heartbeat unit is sandboxed — which idea-heartbeat.service is:
# ProtectSystem=strict, ProtectHome=yes, MemoryMax=128M and no PATH carrying `claude`. A cycle
# fork()ed from inside that would start, find no claude, and fail every agent. Pointing it at
# `systemctl start idea-orchestrator.service` makes systemd, not this process, supply the
# cycle's PATH, its home directory and its timeouts. SETUP.md has both forms and the reason.
CYCLE_COMMAND = os.environ.get("ORCHESTRATOR_CYCLE_COMMAND", "")

# A panel is a thing that can get stuck. The lock already makes a duplicate cycle harmless, so
# this is only about not filling the journal with launches after a double-click.
CYCLE_MIN_SECONDS = float(os.environ.get("ORCHESTRATOR_CYCLE_MIN_SECONDS", "30"))

# When the last launch was requested. Module state on purpose: the rate limit is about this
# process, and a test resets it.
_last_launch = 0.0

# How often GET /state may shell out to `git fetch`. The panel polls every 60 s, so at 120 s
# at most every other poll costs a fetch and a push shows up within about two minutes. The
# server is a single-threaded HTTPServer: every second spent fetching is a second in which
# POST /heartbeat waits, and a heartbeat that does not land reads as an idle laptop.
REFRESH_SECONDS = float(os.environ.get("ORCHESTRATOR_STATE_REFRESH_SECONDS", "120"))

# The last refresh *attempt*, on a monotonic clock — a wall clock that steps backwards over
# NTP or a suspend would otherwise freeze the refresh for as long as the step. A failed
# attempt starts the window exactly as a successful one does, so a box with no network does
# not shell out on every poll.
_last_refresh_attempt: float | None = None
# The outcome of that attempt, carried between polls so a request inside the window can report
# what the last real one found.
_refresh_reason: str | None = None
# Unix seconds of the last *successful* refresh, or None. Mirrors cycle_started_at exactly, so
# a consumer has no new idiom to learn.
_refresh_ok_at: float | None = None


def reset_refresh_state():
    """Forget the refresh window. For tests, and for the same reason _last_launch has one."""
    global _last_refresh_attempt, _refresh_reason, _refresh_ok_at
    _last_refresh_attempt = None
    _refresh_reason = None
    _refresh_ok_at = None


def refresh_payload(repo, *, running, clock=None, now=None, refresh=None):
    """Bring the clone up to date if allowed, and describe the result for the body.

    `state` is a closed two-word vocabulary. `current` means a fetch succeeded within the
    refresh window and the clone is at its upstream's commit; `stale` means everything else,
    with `reason` a sentence meant to be shown verbatim. There is deliberately no third word
    for "never checked": a box that cannot fetch is serving data it cannot vouch for, which is
    exactly what `stale` means, and the reason says which case it is — one fewer branch for
    every consumer.

    A running cycle is reported as `stale` without touching anything. The orchestrator pulls at
    the start of every cycle, so the clone is about as fresh as it can be; the point is that a
    GET must never move a tree out from under a cycle that is building in it.
    """
    global _last_refresh_attempt, _refresh_reason, _refresh_ok_at
    clock = clock or time.monotonic
    now = now or time.time
    refresh = refresh or _orch.refresh_clone

    def body(state, reason):
        age = None if _refresh_ok_at is None else round(now() - _refresh_ok_at)
        return {"state": state, "reason": reason,
                "checked_at": _refresh_ok_at, "age_seconds": age}

    if running:
        return body("stale", "a cycle is running; the clone is refreshed at the start "
                             "of each cycle")

    moment = clock()
    inside_window = (_last_refresh_attempt is not None
                     and moment - _last_refresh_attempt < REFRESH_SECONDS)
    if not inside_window:
        _last_refresh_attempt = moment
        try:
            ok, reason = refresh(repo)
        except Exception as exc:  # noqa: BLE001 — /state degrades, it never 500s
            ok, reason = False, f"the refresh failed: {exc}"
        _refresh_reason = None if ok else reason
        if ok:
            _refresh_ok_at = now()

    return body("current" if _refresh_reason is None else "stale", _refresh_reason)


def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH) as f:
            return json.load(f)
    return {"last_ts": 0, "last_event": None, "session_id": None}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_PATH)


def orchestrator_state(*, clock=None, now=None, refresh=None):
    """Live cycle state plus the state of every idea in the queue.

    Liveness and the agent list both come from the lock's metadata, which a running cycle
    rewrites every lock_renew_seconds. That is deliberate: the same write proves the cycle
    is alive and says what it is working on, so a reader can never see one without the
    other. A lock whose last renewal is older than its TTL means nothing is running — the
    cycle was killed, suspended or crashed.

    The clone is brought up to its upstream *before* the queue is read, so that one request
    can never report a queue from before its own fetch. This endpoint used to answer out of
    whatever the last cycle left behind, which meant a question answered and pushed from the
    laptop stayed `blocked` in the panel until a cycle happened to run — days, with the timer
    off. What a reader wants to know is what the next cycle would see, and that is `origin`.
    """
    repo_path = os.environ.get("IDEAS_REPO_PATH")
    if not repo_path or _orch is None:
        return {"available": False,
                "reason": "IDEAS_REPO_PATH is not set" if not repo_path
                          else "orchestrator module could not be imported"}
    repo = Path(repo_path)

    # One reader for the lock, shared with the preflight POST /cycle runs, so that "a cycle is
    # running" cannot mean one thing to this endpoint and another to the button beside it.
    running, agents, since, age = _orch.lock_status(repo)

    # Before queue_rows, which reads the files this may have just moved.
    refresh_state = refresh_payload(repo, running=running, clock=clock, now=now,
                                    refresh=refresh)

    try:
        ideas = _orch.queue_rows(repo, tuple(agents))
    except Exception as exc:  # noqa: BLE001 — a malformed README must not 500 the endpoint
        return {"available": False, "reason": f"could not read the queue: {exc}"}

    return {
        "available": True,
        "running": running,
        "agents": agents,
        "cycle_started_at": since,
        "lock_age_seconds": None if age is None else round(age),
        # Whether this body is answering for `origin` or only for the local clone, and when it
        # last managed to check. `stale` is an ordinary state, not an error.
        "refresh": refresh_state,
        # The stop file, which nothing in the orchestrator ever removes. Reported because it
        # is the one thing about the queue a reader cannot deduce: a paused box looks exactly
        # like an idle one until something tries to start a cycle and is refused.
        "paused": _orch.is_paused(repo),
        "ideas": ideas,
    }


def default_cycle_command():
    """How this deployment starts a cycle when nothing has been configured.

    Exactly how the orchestrator that runs here is launched by hand today: a detached
    `python3 orchestrator.py run`, from the directory this file lives in.
    """
    return [sys.executable or "python3",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "orchestrator.py"),
            "run"]


def cycle_command():
    """The configured command if there is one, else this deployment's default."""
    return shlex.split(CYCLE_COMMAND) if CYCLE_COMMAND.strip() else default_cycle_command()


def cycle_environment():
    """The environment a spawned cycle gets: this process's, with the repo path assured.

    Inherited rather than built from nothing, because on a box the interesting parts of it —
    PATH, HOME, the heartbeat URL — are what the unit file sets, and a cycle needs the same
    ones the orchestrator unit would have got. Where that inheritance is wrong is exactly where
    ORCHESTRATOR_CYCLE_COMMAND is the answer, rather than this function guessing.
    """
    env = dict(os.environ)
    repo = env.get("IDEAS_REPO_PATH")
    if repo:
        env["IDEAS_REPO_PATH"] = repo
    return env


def spawn_cycle(argv, env):
    """Start a cycle and stop caring about it.

    `start_new_session=True` detaches it into its own process group, so it survives this
    server being restarted and is not killed with it — a cycle takes 45 minutes and this
    process is not its supervisor. Output goes wherever this server's does, which under systemd
    is the journal.
    """
    subprocess.Popen(argv, env=env, start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def request_cycle(*, override=False, spawn=spawn_cycle, now=None):
    """Decide whether to start a cycle, and start it. Returns (http_status, body).

    The whole of POST /cycle except the HTTP: the gates, the rate limit, the claude check and
    the launch, with the spawn injected so that a test can assert *that a launch was requested,
    with which command and which environment* without anything being spawned.

    `started: true` means **launched**, never finished. The cycle re-applies these same gates
    itself and may still exit; a caller confirms by watching /state, not by believing this.
    """
    global _last_launch
    moment = time.time() if now is None else now

    repo_path = os.environ.get("IDEAS_REPO_PATH")
    if not repo_path or _orch is None:
        return 200, {"started": False, "gate": "server",
                     "reason": "IDEAS_REPO_PATH is not set" if not repo_path
                               else "orchestrator module could not be imported"}

    since = moment - _last_launch
    if since < CYCLE_MIN_SECONDS:
        wait = int(CYCLE_MIN_SECONDS - since) + 1
        return 429, {"started": False, "gate": "rate-limit",
                     "reason": f"a cycle was just launched, wait {wait} s"}

    staleness = 600.0
    try:
        repo = Path(repo_path)
        config = _orch.Config(_orch.load_config(repo / ".agent-config.yml"))
        staleness = config.number("heartbeat_staleness_minutes", 10) * 60
    except Exception:  # noqa: BLE001 — a missing config is not a reason to refuse
        repo = Path(repo_path)

    check = _orch.cycle_preflight(
        repo,
        heartbeat=lambda: _orch.heartbeat_from_file(STATE_PATH, staleness),
        override=override)
    if not check.ok:
        return 200, {"started": False, "gate": check.gate, "reason": check.reason}

    argv, env = cycle_command(), cycle_environment()

    # Only for the default command: a configured one is a deployment's own business, and it may
    # legitimately be a systemctl call that has no claude on its own PATH.
    if not CYCLE_COMMAND.strip():
        missing = _orch.claude_missing_reason(env)
        if missing:
            return 200, {"started": False, "gate": "claude", "reason": missing}

    try:
        spawn(argv, env)
    except Exception as exc:  # noqa: BLE001 — a failed launch must answer, not 500
        return 200, {"started": False, "gate": "spawn",
                     "reason": f"could not start a cycle: {exc}"}

    _last_launch = moment
    return 200, {"started": True, "gate": None, "reason": None,
                 "command": " ".join(argv)}


def request_stop(*, resume=False):
    """Pause the queue, or resume it. Returns (http_status, body).

    The whole of POST /stop except the HTTP. Deliberately unlike `/cycle` in three ways:

    - **No gates.** Stopping is always allowed. There is nothing to protect against: the file
      only ever makes the orchestrator do less.
    - **No rate limit.** A launch costs money, so `/cycle` has one; a second stop costs nothing,
      and the one situation where someone presses this repeatedly is the situation where they
      most want it to work.
    - **Both directions.** Nothing in the orchestrator ever removes the stop file, so a button
      that could only create one would pause the fleet for ever. `resume=True` is the way out,
      and it removes a file set by any means, not only one this endpoint wrote.

    `changed: false` is a normal 200: it means the queue was already in the state asked for.
    """
    repo_path = os.environ.get("IDEAS_REPO_PATH")
    if not repo_path or _orch is None:
        # `paused: null` rather than false: this server cannot look, and claiming "not paused"
        # about a repository it cannot find would be inventing the one fact it was asked for.
        return 200, {"paused": None, "changed": False, "gate": "server",
                     "reason": "IDEAS_REPO_PATH is not set" if not repo_path
                               else "orchestrator module could not be imported"}

    repo = Path(repo_path)
    want = not resume
    note = f"paused by the aideas panel at {time.strftime('%Y-%m-%dT%H:%M:%S%z')}"
    try:
        changed = _orch.set_paused(repo, want, note=note)
    except OSError as exc:  # noqa: BLE001 — a failed write must answer, not 500
        return 200, {"paused": _orch.is_paused(repo), "changed": False, "gate": "write",
                     "reason": f"could not {'create' if want else 'remove'} "
                               f"{_orch.stop_file_path(repo)}: {exc}"}

    if want:
        reason = ("the queue is paused; a running cycle winds down at its next check"
                  if changed else "the queue was already paused")
    else:
        reason = ("the queue is no longer paused" if changed
                  else "the queue was not paused")
    return 200, {"paused": want, "changed": changed, "gate": None, "reason": reason}


class Handler(BaseHTTPRequestHandler):
    def _authorized(self, body_secret):
        if not SECRET:
            return True
        return hmac.compare_digest(body_secret or "", SECRET)

    def _json(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path not in ("/heartbeat", "/cycle", "/stop"):
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            payload = {}

        if not self._authorized(payload.get("secret")):
            self.send_response(401)
            self.end_headers()
            return

        # The extension's one write. Authenticated the way this system already authenticates
        # writes — the shared secret in the body, as POST /heartbeat's is — and answering with
        # *why* when it refuses, because every gate below returns "success, silently" and a
        # button that cannot say which one said no reports nothing at all.
        if self.path == "/cycle":
            status, body = request_cycle(override=payload.get("override") is True)
            self._json(status, body)
            return

        # The other write: the stop file. `is True`, not truthiness — stop and resume are
        # opposites, and `{"resume": "no"}` is exactly the shape a hand-written request gets
        # wrong. Anything that is not literally true is a stop.
        if self.path == "/stop":
            status, body = request_stop(resume=payload.get("resume") is True)
            self._json(status, body)
            return

        event = payload.get("event", "unknown")
        # session_end means "idle right now" rather than "just active" — back-date it
        # so the orchestrator doesn't wait out a full staleness window unnecessarily.
        state = {
            "last_ts": 0 if event == "session_end" else time.time(),
            "last_event": event,
            "session_id": payload.get("session_id"),
        }
        save_state(state)
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == "/state":
            body = json.dumps(orchestrator_state()).encode()
        elif self.path == "/status":
            state = load_state()
            stale_seconds = time.time() - state.get("last_ts", 0)
            body = json.dumps({**state, "stale_seconds": stale_seconds}).encode()
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # keep this quiet; rely on systemd/journald if you want logs


if __name__ == "__main__":
    server = HTTPServer((BIND_IP, PORT), Handler)
    print(f"heartbeat_server listening on {BIND_IP}:{PORT}")
    server.serve_forever()

