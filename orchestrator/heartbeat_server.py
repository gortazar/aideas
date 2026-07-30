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
import time
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE_PATH = os.environ.get("HEARTBEAT_STATE_PATH", "/var/lib/idea-agent/heartbeat.json")
SECRET = os.environ.get("HEARTBEAT_SHARED_SECRET", "")
BIND_IP = os.environ.get("HEARTBEAT_BIND_IP", "127.0.0.1")
PORT = int(os.environ.get("HEARTBEAT_PORT", "8787"))


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


class Handler(BaseHTTPRequestHandler):
    def _authorized(self, body_secret):
        if not SECRET:
            return True
        return hmac.compare_digest(body_secret or "", SECRET)

    def do_POST(self):
        if self.path != "/heartbeat":
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
        if self.path != "/status":
            self.send_response(404)
            self.end_headers()
            return
        state = load_state()
        stale_seconds = time.time() - state.get("last_ts", 0)
        body = json.dumps({**state, "stale_seconds": stale_seconds}).encode()
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

