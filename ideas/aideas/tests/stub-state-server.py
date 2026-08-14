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
    /other              valid JSON that is not /state, like a wrong port
    /requests           how many state reads have been served, which is how the smoke test
                        proves a disabled extension left no timer behind still polling
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
         "note": "2 unanswered questions", "will_run_next": False, "open_questions": 2},
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
         "note": "1 unanswered question", "will_run_next": False, "open_questions": 1},
    ],
}


def make_handler(options):
    # Counts every /state* read. /requests itself is not a read, so a test can poll it freely.
    served = {"count": 0}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, status, body, content_type="application/json"):
            payload = body if isinstance(body, bytes) else body.encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):  # noqa: N802 — the BaseHTTPRequestHandler spelling
            path = self.path.split("?", 1)[0]

            if path == "/requests":
                self._send(200, json.dumps(served))
                return
            if path.startswith("/state"):
                served["count"] += 1

            if path == "/state":
                if options.body is not None:
                    self._send(200, options.body)
                    return
                if options.mode == "idle":
                    self._send(200, json.dumps(IDLE))
                    return
                running = dict(RUNNING, cycle_started_at=time.time() - 720)
                self._send(200, json.dumps(running))
            elif path == "/state-idle":
                self._send(200, json.dumps(IDLE))
            elif path == "/state-unavailable":
                self._send(200, json.dumps(
                    {"available": False, "reason": "IDEAS_REPO_PATH is not set"}))
            elif path == "/state-notjson":
                self._send(200, "<html><body>502 Bad Gateway</body></html>", "text/html")
            elif path == "/state-huge":
                self._send(200, b'{"available":true,"pad":"' + b"x" * (2 * 1024 * 1024) + b'"}')
            elif path == "/state-slow":
                time.sleep(options.slow)
                self._send(200, json.dumps(dict(RUNNING, cycle_started_at=time.time())))
            elif path == "/state-500":
                self._send(500, "boom", "text/plain")
            elif path == "/other":
                self._send(200, json.dumps({"last_ts": 0, "stale_seconds": 12}))
            else:
                self._send(404, "not found", "text/plain")

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
    parser.add_argument("--mode", choices=("running", "idle"), default="running",
                        help="what /state reports: a running cycle, or an idle box with a "
                             "blocked idea. Two servers in the two modes are how the smoke "
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
