#!/usr/bin/env python3
"""`POST /cycle`: the decision, the rate limit, the response shape — and no spawning.

The launch is one injected callable, so these tests assert *that a launch was requested, with
which command and which environment*, and nothing is ever started. The single real spawn is
exercised by hand against this repo's own orchestrator and recorded in STATUS.md, which is the
only way to check the part that depends on a real environment.
"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))

import heartbeat_server  # noqa: E402
import orchestrator  # noqa: E402


class Spawned:
    """A stand-in for the spawn, remembering what it was asked to start."""

    def __init__(self, explode=None):
        self.calls = []
        self.explode = explode

    def __call__(self, argv, env):
        self.calls.append((list(argv), dict(env)))
        if self.explode:
            raise self.explode

    @property
    def argv(self):
        return self.calls[-1][0]

    @property
    def env(self):
        return self.calls[-1][1]


class EndpointTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name)
        (self.repo / "README.md").write_text("# ideas\n\n## Ideas\n\n1. [a](ideas/a/) - one\n")
        (self.repo / ".agent-config.yml").write_text(
            "allowed_hours: unlimited\nmax_daily_cost_usd: unlimited\n")

        # A heartbeat state file old enough to mean "nobody is working".
        self.state_path = self.repo / "heartbeat.json"
        self.state_path.write_text(json.dumps({"last_ts": time.time() - 7200}))

        # A `claude` the default command's environment can find, so the guard passes unless a
        # test is about the guard.
        self.bin = self.repo / "bin"
        self.bin.mkdir()
        claude = self.bin / "claude"
        claude.write_text("#!/bin/sh\n")
        claude.chmod(0o755)

        self.environment({
            "IDEAS_REPO_PATH": str(self.repo),
            "HEARTBEAT_STATE_PATH": str(self.state_path),
            "PATH": f"{self.bin}:{os.environ.get('PATH', '')}",
        })
        self.configure(command="", min_seconds=30)
        heartbeat_server._last_launch = 0.0
        self.addCleanup(setattr, heartbeat_server, "_last_launch", 0.0)

    def environment(self, values):
        """Replace the process environment for the duration of one test."""
        previous = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(previous)))
        os.environ.clear()
        os.environ.update(values)

    def configure(self, *, command=None, min_seconds=None, state_path=None, secret=None):
        """Set the module-level configuration the server reads at import time."""
        for name, value in (("CYCLE_COMMAND", command),
                            ("CYCLE_MIN_SECONDS", min_seconds),
                            ("STATE_PATH", state_path if state_path is not None
                             else str(self.state_path)),
                            ("SECRET", secret)):
            if value is None:
                continue
            self.addCleanup(setattr, heartbeat_server, name,
                            getattr(heartbeat_server, name))
            setattr(heartbeat_server, name, value)

    def request(self, **kwargs):
        kwargs.setdefault("spawn", Spawned())
        status, body = heartbeat_server.request_cycle(**kwargs)
        return status, body, kwargs["spawn"]


class TheHappyPath(EndpointTestCase):
    def test_it_launches_and_says_so(self):
        status, body, spawn = self.request()

        self.assertEqual(status, 200)
        self.assertEqual(body["started"], True)
        self.assertIsNone(body["gate"])
        self.assertIsNone(body["reason"])
        self.assertEqual(len(spawn.calls), 1, "exactly one launch")

    def test_the_default_command_is_how_this_deployment_starts_a_cycle(self):
        _status, _body, spawn = self.request()

        self.assertEqual(spawn.argv[-1], "run")
        self.assertTrue(spawn.argv[-2].endswith("orchestrator.py"), spawn.argv)

    def test_a_configured_command_is_used_verbatim(self):
        self.configure(command="systemctl start idea-orchestrator.service")

        _status, _body, spawn = self.request()

        self.assertEqual(spawn.argv,
                         ["systemctl", "start", "idea-orchestrator.service"])

    def test_the_child_is_told_where_the_repo_is(self):
        _status, _body, spawn = self.request()

        self.assertEqual(spawn.env["IDEAS_REPO_PATH"], str(self.repo))

    def test_the_reply_names_the_command_it_started(self):
        status, body, _spawn = self.request()

        self.assertEqual(status, 200)
        self.assertIn("orchestrator.py", body["command"],
                      "so a journal or a log says what was actually launched")


class TheGates(EndpointTestCase):
    def test_a_refusal_is_a_normal_answer_with_a_reason(self):
        (self.repo / ".orchestrator").mkdir(parents=True, exist_ok=True)
        (self.repo / ".orchestrator" / "stop").touch()

        status, body, spawn = self.request()

        self.assertEqual(status, 200, "a gate saying no is not an HTTP error")
        self.assertEqual(body["started"], False)
        self.assertEqual(body["gate"], "stop-file")
        self.assertIn("Paused", body["reason"])
        self.assertEqual(spawn.calls, [], "and nothing was launched")

    def test_an_active_laptop_session_refuses(self):
        self.state_path.write_text(json.dumps({"last_ts": time.time()}))

        status, body, spawn = self.request()

        self.assertEqual(body["gate"], "heartbeat")
        self.assertEqual(body["reason"], "A Claude Code session is active on this laptop")
        self.assertEqual(spawn.calls, [])

    def test_the_override_gets_past_it(self):
        self.state_path.write_text(json.dumps({"last_ts": time.time()}))

        status, body, spawn = self.request(override=True)

        self.assertEqual(body["started"], True)
        self.assertEqual(len(spawn.calls), 1)

    def test_the_override_does_not_get_past_the_stop_file(self):
        (self.repo / ".orchestrator").mkdir(parents=True, exist_ok=True)
        (self.repo / ".orchestrator" / "stop").touch()

        _status, body, spawn = self.request(override=True)

        self.assertEqual(body["gate"], "stop-file")
        self.assertEqual(spawn.calls, [])

    def test_a_cycle_already_running_refuses(self):
        lock = self.repo / ".orchestrator" / "lock"
        lock.mkdir(parents=True, exist_ok=True)
        (lock / "meta.json").write_text(json.dumps({
            "acquired_at": time.time(), "renewed_at": time.time(),
            "ttl_minutes": 5, "agents": ["alpha"]}))

        _status, body, spawn = self.request()

        self.assertEqual(body["gate"], "lock")
        self.assertEqual(body["reason"], "A cycle is already running")
        self.assertEqual(spawn.calls, [])

    def test_no_repo_path_is_the_box_saying_it_cannot_do_this(self):
        self.environment({"PATH": os.environ.get("PATH", "")})

        status, body, spawn = self.request()

        self.assertEqual(status, 200)
        self.assertEqual(body["gate"], "server")
        self.assertEqual(body["reason"], "IDEAS_REPO_PATH is not set")
        self.assertEqual(spawn.calls, [])


class TheClaudeGuard(EndpointTestCase):
    def test_it_refuses_a_default_launch_that_would_fail_every_agent(self):
        self.environment({
            "IDEAS_REPO_PATH": str(self.repo),
            "HEARTBEAT_STATE_PATH": str(self.state_path),
            "PATH": "/nonexistent",
        })

        _status, body, spawn = self.request()

        self.assertEqual(body["gate"], "claude")
        self.assertEqual(body["reason"], "claude is not on the orchestrator's PATH")
        self.assertEqual(spawn.calls, [], "better to refuse than to burn a cycle")

    def test_a_configured_command_is_not_second_guessed(self):
        # `systemctl start …` legitimately has no claude on its own PATH: systemd supplies the
        # cycle's environment, which is the whole reason a box configures a command.
        self.environment({
            "IDEAS_REPO_PATH": str(self.repo),
            "HEARTBEAT_STATE_PATH": str(self.state_path),
            "PATH": "/nonexistent",
        })
        self.configure(command="systemctl start idea-orchestrator.service")

        _status, body, spawn = self.request()

        self.assertEqual(body["started"], True)
        self.assertEqual(len(spawn.calls), 1)


class TheRateLimit(EndpointTestCase):
    def test_a_second_launch_straight_away_is_refused(self):
        first = self.request()
        self.assertEqual(first[1]["started"], True)

        status, body, spawn = self.request()

        self.assertEqual(status, 429)
        self.assertEqual(body["gate"], "rate-limit")
        self.assertIn("wait", body["reason"])
        self.assertEqual(spawn.calls, [], "a double-click must not fill the journal")

    def test_it_lets_go_after_the_window(self):
        self.request()

        status, body, spawn = self.request(now=time.time() + 31)

        self.assertEqual(status, 200)
        self.assertEqual(body["started"], True)
        self.assertEqual(len(spawn.calls), 1)

    def test_a_refused_request_does_not_start_the_clock(self):
        (self.repo / ".orchestrator").mkdir(parents=True, exist_ok=True)
        stop = self.repo / ".orchestrator" / "stop"
        stop.touch()
        self.request()
        stop.unlink()

        status, body, _spawn = self.request()

        self.assertEqual(status, 200, "nothing was launched, so nothing is being rate-limited")
        self.assertEqual(body["started"], True)


class WhenTheLaunchItselfFails(EndpointTestCase):
    def test_it_answers_rather_than_500ing(self):
        spawn = Spawned(explode=FileNotFoundError("no such file: python3"))

        status, body, _ = self.request(spawn=spawn)

        self.assertEqual(status, 200)
        self.assertEqual(body["started"], False)
        self.assertEqual(body["gate"], "spawn")
        self.assertIn("could not start a cycle", body["reason"])

    def test_a_failed_launch_is_not_rate_limited_afterwards(self):
        self.request(spawn=Spawned(explode=OSError("boom")))

        status, body, _spawn = self.request()

        self.assertEqual(body["started"], True, status)


class TheResponseShape(EndpointTestCase):
    def test_every_answer_is_small_total_and_json(self):
        cases = [lambda: self.request()]

        (self.repo / ".orchestrator").mkdir(parents=True, exist_ok=True)
        (self.repo / ".orchestrator" / "stop").touch()
        cases.append(lambda: self.request())

        for case in cases:
            status, body, _spawn = case()
            self.assertIn(status, (200, 429))
            self.assertIsInstance(body["started"], bool)
            self.assertIn("gate", body)
            self.assertIn("reason", body)
            self.assertIsInstance(json.dumps(body), str)
            if not body["started"]:
                self.assertTrue(body["reason"], "a refusal always says why")
                self.assertTrue(body["gate"], "and which gate it was")


class TheAuthorisation(EndpointTestCase):
    """The `_authorized()` path POST /heartbeat already uses, per the answered question."""

    def test_no_secret_configured_accepts_anything(self):
        self.configure(secret="")

        self.assertTrue(heartbeat_server.Handler._authorized(None, None))
        self.assertTrue(heartbeat_server.Handler._authorized(None, "whatever"))

    def test_a_configured_secret_must_match(self):
        self.configure(secret="s3cret")

        self.assertTrue(heartbeat_server.Handler._authorized(None, "s3cret"))
        self.assertFalse(heartbeat_server.Handler._authorized(None, "wrong"))
        self.assertFalse(heartbeat_server.Handler._authorized(None, None))
        self.assertFalse(heartbeat_server.Handler._authorized(None, ""))


if __name__ == "__main__":
    unittest.main()
