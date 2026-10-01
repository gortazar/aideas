#!/usr/bin/env python3
"""A stand-in for the orchestrator's /state endpoint.

Used by two things: tests/http, which drives the real libsoup transport against it, and the
compositor smoke test, which runs the whole extension against it. It answers on 127.0.0.1 and
prints the port it bound to on the first line of stdout, so a caller can let the kernel pick a
free port instead of guessing one.

The behaviour of each path is what a test needs to provoke:

    /state              the body given by --body, or a plausible running cycle
    /state-idle         an available body with nothing running
    /state-unavailable  available:false, with a reason
    /state-notjson      a 200 that is not JSON at all, like a proxy error page
    /state-huge         a 200 with a body far too large to be a queue
    /state-slow         a 200 that arrives after --slow seconds, to be timed out
    /state-500          a server error
    /state-429          a status libsoup's Status enumeration does not contain
    /other              valid JSON that is not /state, like a wrong port
    /requests           how many state reads have been served, which is how the smoke test
                        proves a disabled extension left no timer behind still polling
    /cycles             every POST /cycle this server received, as JSON — which is how a test
                        knows the button really sent something, and what it sent
    /stops              every POST /stop this server received, the same way

POST /cycle answers whatever --cycle-mode says, so a test can have a box that starts a cycle,
one that refuses at a named gate, one that predates the endpoint (404), one that rejects the
secret (401) and one that rate-limits (429).

POST /stop is different in one deliberate way: in its default mode it is **stateful**, and
really flips the `paused` this server's /state reports. That is what lets a test press the
button and then read the queue's state back, which is the whole behaviour of the pair.
"""
import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RUNNING = {
    "available": True,
    "running": True,
    "agents": ["aideas"],
    "cycle_started_at": None,  # filled in at request time so the age is always fresh
    "lock_age_seconds": 12,
    "ideas": [
        {"position": 1, "slug": "aideas", "version": "0.1", "state": "running",
         "note": "an agent is working on it now", "will_run_next": False},
        {"position": 2, "slug": "restore-wss", "version": "0.1", "state": "blocked",
         "note": "2 unanswered questions", "will_run_next": False, "open_questions": 2,
         "open_question_texts": [
             "Which browsers must be restored, and does that include their tabs?",
             "Should a window that was closed by hand come back on the next restore?"]},
        {"position": 3, "slug": "vacas", "version": "0.1", "state": "ready",
         "note": "not started", "will_run_next": False, "target_version": "0.1"},
        {"position": 4, "slug": "recap", "version": "0.4", "state": "queued",
         "note": "behind #3", "will_run_next": False},
    ],
}

IDLE = {
    "available": True,
    "running": False,
    "agents": [],
    "cycle_started_at": None,
    "lock_age_seconds": 4000,
    "ideas": [
        {"position": 1, "slug": "aideas", "version": "0.1", "state": "ready",
         "note": "minor update -> v0.2", "will_run_next": True, "target_version": "0.2"},
        {"position": 2, "slug": "restore-wss", "version": "0.1", "state": "blocked",
         "note": "1 unanswered question", "will_run_next": False, "open_questions": 1,
         "open_question_texts": [
             "Which browsers must be restored, and does that include their tabs?"]},
    ],
}


ALL_BLOCKED = {
    "available": True,
    "running": False,
    "agents": [],
    "cycle_started_at": None,
    "lock_age_seconds": 5000,
    "ideas": [
        {"position": 1, "slug": "restore-wss", "version": "0.1", "state": "blocked",
         "note": "5 unanswered questions", "will_run_next": False, "open_questions": 5,
         "open_question_texts": [
             "Which browsers must be restored, and does that include their tabs?",
             "Should a window that was closed by hand come back on the next restore?",
             "Is a browser profile enough to identify a window, or is the title needed too?",
             "What happens to a workspace that no longer exists on this machine?",
             "Should the extension restore anything at all without being asked?"]},
        {"position": 2, "slug": "restore-wss", "version": "0.1", "state": "queued",
         "note": "behind #1", "will_run_next": False},
        {"position": 3, "slug": "vacas", "version": "0.1", "state": "blocked",
         "note": "1 unanswered question", "will_run_next": False, "open_questions": 1,
         "open_question_texts": ["The AMO API key, please - it is the only thing left."]},
        {"position": 4, "slug": "recap", "version": "0.4", "state": "blocked",
         "note": "STATUS.md says blocked", "will_run_next": False},
    ],
}


# What POST /cycle answers, per --cycle-mode. The shapes are the ones docs/state-contract.md
# specifies, so an extension that copes with these copes with the real box.
CYCLE_REPLIES = {
    "started": (200, {"started": True, "gate": None, "reason": None,
                      "command": "python3 orchestrator.py run"}),
    "refused": (200, {"started": False, "gate": "heartbeat",
                      "reason": "A Claude Code session is active on this laptop"}),
    "paused": (200, {"started": False, "gate": "stop-file",
                     "reason": "Paused: .orchestrator/stop exists"}),
    "unsupported": (404, None),
    "unauthorised": (401, None),
    "rate-limited": (429, {"started": False, "gate": "rate-limit",
                           "reason": "a cycle was just launched, wait 24 s"}),
    "garbage": (200, "<html>not an answer</html>"),
}


# What POST /stop answers, per --stop-mode. "live" is not in here: it is the stateful default,
# computed from the flag the request just moved.
STOP_REPLIES = {
    "unsupported": (404, None),
    "unauthorised": (401, None),
    "server-gate": (200, {"paused": None, "changed": False, "gate": "server",
                          "reason": "IDEAS_REPO_PATH is not set"}),
    "write-gate": (200, {"paused": True, "changed": False, "gate": "write",
                         "reason": "could not remove /repo/.orchestrator/stop: Is a directory"}),
    "garbage": (200, "<html>not an answer</html>"),
}


def make_handler(options):
    # Counts every /state* read. /requests itself is not a read, so a test can poll it freely.
    served = {"count": 0}
    # Every POST /cycle, in order, with what it carried.
    cycles = []
    # Every POST /stop, the same way, plus the flag they move. The flag is what /state reports,
    # so a test can stop the queue and then watch the panel's own reading change.
    stops = []
    paused = {"value": options.paused}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, status, body, content_type="application/json"):
            payload = body if isinstance(body, bytes) else body.encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _state(self, body):
            """A state body with the pause flag this server is currently holding.

            Merged at request time rather than baked into the constants, because POST /stop
            moves it: the panel writes, then reads its own effect back.
            """
            return json.dumps(dict(body, paused=paused["value"]))

        def do_GET(self):  # noqa: N802 — the BaseHTTPRequestHandler spelling
            path = self.path.split("?", 1)[0]

            if path == "/requests":
                self._send(200, json.dumps(served))
                return
            if path == "/cycles":
                self._send(200, json.dumps(cycles))
                return
            if path == "/stops":
                self._send(200, json.dumps(stops))
                return
            if path.startswith("/state"):
                served["count"] += 1

            if path == "/state":
                if options.body is not None:
                    self._send(200, options.body)
                    return
                if options.mode == "idle":
                    self._send(200, self._state(IDLE))
                    return
                if options.mode == "all-blocked":
                    self._send(200, self._state(ALL_BLOCKED))
                    return
                self._send(200, self._state(dict(RUNNING, cycle_started_at=time.time() - 720)))
            elif path == "/state-idle":
                self._send(200, self._state(IDLE))
            elif path == "/state-unavailable":
                self._send(200, json.dumps(
                    {"available": False, "reason": "IDEAS_REPO_PATH is not set"}))
            elif path == "/state-notjson":
                self._send(200, "<html><body>502 Bad Gateway</body></html>", "text/html")
            elif path == "/state-huge":
                self._send(200, b'{"available":true,"pad":"' + b"x" * (2 * 1024 * 1024) + b'"}')
            elif path == "/state-slow":
                time.sleep(options.slow)
                self._send(200, self._state(dict(RUNNING, cycle_started_at=time.time())))
            elif path == "/state-500":
                self._send(500, "boom", "text/plain")
            elif path == "/state-429":
                # A status outside libsoup's Status enumeration: reading it through
                # get_status() throws inside the async callback and hangs the request.
                self._send(429, "slow down", "text/plain")
            elif path == "/other":
                self._send(200, json.dumps({"last_ts": 0, "stale_seconds": 12}))
            else:
                self._send(404, "not found", "text/plain")

        def do_POST(self):  # noqa: N802 — the BaseHTTPRequestHandler spelling
            path = self.path.split("?", 1)[0]
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                payload = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                payload = {"unparseable": raw.decode("utf-8", "replace")}

            if path == "/stop":
                stops.append({"body": payload,
                              "content_type": self.headers.get("Content-Type", "")})
                self._stop(payload)
                return

            if path != "/cycle":
                self._send(404, "not found", "text/plain")
                return

            cycles.append({"body": payload,
                           "content_type": self.headers.get("Content-Type", "")})

            status, body = CYCLE_REPLIES[options.cycle_mode]
            if body is None:
                self._send(status, "", "text/plain")
            elif isinstance(body, str):
                self._send(status, body, "text/html")
            else:
                self._send(status, json.dumps(body))

        def _stop(self, payload):
            """POST /stop. In "live" mode it really moves the flag /state reports."""
            if options.stop_mode != "live":
                status, body = STOP_REPLIES[options.stop_mode]
                if body is None:
                    self._send(status, "", "text/plain")
                elif isinstance(body, str):
                    self._send(status, body, "text/html")
                else:
                    self._send(status, json.dumps(body))
                return

            want = payload.get("resume") is not True
            changed = paused["value"] != want
            paused["value"] = want
            if want:
                reason = ("the queue is paused; a running cycle winds down at its next check"
                          if changed else "the queue was already paused")
            else:
                reason = ("the queue is no longer paused" if changed
                          else "the queue was not paused")
            self._send(200, json.dumps(
                {"paused": want, "changed": changed, "gate": None, "reason": reason}))

        def log_message(self, fmt, *args):
            pass  # quiet: the test's output is the test's

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0,
                        help="0 (the default) lets the kernel pick a free one")
    parser.add_argument("--body", default=None,
                        help="exact body to return from /state")
    parser.add_argument("--slow", type=float, default=30.0,
                        help="seconds /state-slow waits before answering")
    parser.add_argument("--cycle-mode", choices=tuple(CYCLE_REPLIES), default="started",
                        help="what POST /cycle answers")
    parser.add_argument("--stop-mode", choices=("live", *STOP_REPLIES), default="live",
                        help="what POST /stop answers. 'live' (the default) really moves the "
                             "pause flag /state reports; the rest are fixed failures")
    parser.add_argument("--paused", action="store_true",
                        help="start with the queue already paused")
    parser.add_argument("--mode", choices=("running", "idle", "all-blocked"),
                        default="running",
                        help="what /state reports: a running cycle, an idle box with a blocked "
                             "idea, or a queue where every idea is blocked and nothing can "
                             "move without a person. Servers in these modes are how the smoke "
                             "test moves the extension between states.")
    options = parser.parse_args()

    # Threaded, and it has to be: with HTTP/1.1 keep-alive a single-threaded server holds one
    # connection open and makes concurrent callers wait for it, which reads as a timeout rather
    # than as the queueing it is.
    server = ThreadingHTTPServer(("127.0.0.1", options.port), make_handler(options))
    server.daemon_threads = True
    # The first line of stdout is the contract with whoever spawned us.
    print(server.server_address[1], flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
