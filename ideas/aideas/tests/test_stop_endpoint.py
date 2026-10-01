#!/usr/bin/env python3
"""`POST /stop`: the stop file, written and removed, with the filesystem really there.

Unlike `POST /cycle`, nothing is injected here — the whole point of this endpoint is a file on
disk, so these tests assert the file, not a string. The temporary repository is the filesystem
the endpoint writes into, and each test checks what is on disk afterwards as well as what came
back on the wire.

The endpoint is a *pause switch*: it is idempotent in both directions, it is never rate-limited
(a second stop costs nothing, and the moment someone hammers it is the moment they most want it
to work), and the file it writes outlives the cycle, the server and the machine.
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


class StopTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name)
        (self.repo / "README.md").write_text("# ideas\n\n## Ideas\n\n1. [a](ideas/a/) - one\n")
        (self.repo / ".agent-config.yml").write_text("allowed_hours: unlimited\n")
        self.environment({"IDEAS_REPO_PATH": str(self.repo)})

    def environment(self, values):
        """Replace the process environment for the duration of one test."""
        previous = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(previous)))
        os.environ.clear()
        os.environ.update(values)

    @property
    def stop_file(self):
        return self.repo / ".orchestrator" / "stop"

    def pause_by_hand(self):
        """What `touch "$IDEAS_REPO_PATH/.orchestrator/stop"` does."""
        self.stop_file.parent.mkdir(parents=True, exist_ok=True)
        self.stop_file.write_text("")

    def request(self, **kwargs):
        return heartbeat_server.request_stop(**kwargs)


class Stopping(StopTestCase):
    def test_it_creates_the_stop_file_and_says_so(self):
        status, body = self.request()

        self.assertEqual(status, 200)
        self.assertIs(body["paused"], True)
        self.assertIs(body["changed"], True)
        self.assertIsNone(body["gate"])
        self.assertIsInstance(body["reason"], str)
        self.assertTrue(self.stop_file.exists(), "the file is the whole endpoint")

    def test_the_file_it_writes_is_the_one_the_orchestrator_polls(self):
        self.request()

        self.assertIs(orchestrator.is_paused(self.repo), True)
        self.assertTrue(orchestrator.Orchestrator(self.repo, "").stop_requested())

    def test_the_gate_refuses_a_cycle_afterwards(self):
        """The endpoint and the preflight must agree without being told to."""
        self.request()

        check = orchestrator.cycle_preflight(self.repo)
        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "stop-file")

    def test_a_second_stop_is_a_200_that_changed_nothing(self):
        self.request()
        status, body = self.request()

        self.assertEqual(status, 200, "already paused is an answer, not an error")
        self.assertIs(body["paused"], True)
        self.assertIs(body["changed"], False)
        self.assertIn("already", body["reason"])

    def test_it_does_not_disturb_a_stop_file_someone_else_wrote(self):
        self.pause_by_hand()
        self.stop_file.write_text("paused by hand\n")

        status, body = self.request()

        self.assertEqual(status, 200)
        self.assertIs(body["changed"], False)
        self.assertEqual(self.stop_file.read_text(), "paused by hand\n")

    def test_it_creates_the_state_directory_if_it_is_missing(self):
        """A fresh clone has no .orchestrator/ at all; pausing it must still work."""
        self.assertFalse((self.repo / ".orchestrator").exists())

        status, body = self.request()

        self.assertEqual(status, 200)
        self.assertIs(body["paused"], True)
        self.assertTrue(self.stop_file.exists())

    def test_the_file_says_where_it_came_from(self):
        """Whoever finds this file weeks later should be able to tell who left it."""
        self.request()

        self.assertIn("aideas", self.stop_file.read_text())

    def test_it_is_not_rate_limited(self):
        """Deliberately unlike /cycle: stopping is about safety and costs nothing."""
        for _ in range(5):
            status, body = self.request()
            self.assertEqual(status, 200)
            self.assertIs(body["paused"], True)

    def test_stopping_does_not_touch_a_running_cycle_s_lock(self):
        """It is a wind-down request, not a kill: /state keeps reporting the live cycle."""
        lock_dir = self.repo / ".orchestrator" / "lock"
        lock_dir.mkdir(parents=True)
        now = time.time()
        (lock_dir / "meta.json").write_text(json.dumps({
            "acquired_at": now - 60, "renewed_at": now,
            "ttl_minutes": 5, "agents": ["a"],
        }))

        self.request()

        running, agents, _since, _age = orchestrator.lock_status(self.repo)
        self.assertIs(running, True)
        self.assertEqual(agents, ["a"])


class Resuming(StopTestCase):
    def test_it_removes_the_stop_file_and_says_so(self):
        self.pause_by_hand()

        status, body = self.request(resume=True)

        self.assertEqual(status, 200)
        self.assertIs(body["paused"], False)
        self.assertIs(body["changed"], True)
        self.assertIsNone(body["gate"])
        self.assertFalse(self.stop_file.exists())

    def test_it_removes_a_stop_file_nobody_here_wrote(self):
        """The file is a pause switch whoever set it; the panel is a way out of it."""
        self.pause_by_hand()
        self.stop_file.write_text("paused by hand\n")

        status, body = self.request(resume=True)

        self.assertEqual(status, 200)
        self.assertIs(body["changed"], True)
        self.assertFalse(self.stop_file.exists())

    def test_resuming_an_unpaused_queue_is_a_200_that_changed_nothing(self):
        status, body = self.request(resume=True)

        self.assertEqual(status, 200)
        self.assertIs(body["paused"], False)
        self.assertIs(body["changed"], False)
        self.assertIn("not paused", body["reason"])

    def test_stop_then_resume_leaves_nothing_behind(self):
        self.request()
        self.request(resume=True)

        self.assertFalse(self.stop_file.exists())
        self.assertIs(orchestrator.is_paused(self.repo), False)
        self.assertNotEqual(orchestrator.cycle_preflight(self.repo).gate, "stop-file",
                            "the gate is open again")

    def test_it_is_idempotent(self):
        self.pause_by_hand()
        for expected_change in (True, False, False):
            status, body = self.request(resume=True)
            self.assertEqual(status, 200)
            self.assertIs(body["changed"], expected_change)
            self.assertIs(body["paused"], False)


class WhenItCannot(StopTestCase):
    def test_no_repo_path_is_a_gate_not_a_crash(self):
        self.environment({})

        status, body = self.request()

        self.assertEqual(status, 200)
        self.assertEqual(body["gate"], "server")
        self.assertIn("IDEAS_REPO_PATH", body["reason"])
        self.assertIsNone(body["paused"],
                          "a server that cannot look must not claim to know")
        self.assertIs(body["changed"], False)

    def test_a_write_that_fails_is_reported_rather_than_500ing(self):
        """A directory where the file belongs: the orchestrator reads that as paused, and
        removing it is not this endpoint's business to force."""
        self.stop_file.mkdir(parents=True)

        status, body = self.request(resume=True)

        self.assertEqual(status, 200)
        self.assertEqual(body["gate"], "write")
        self.assertIs(body["changed"], False)
        self.assertTrue(self.stop_file.exists(), "nothing was destroyed on the way out")

    def test_the_body_is_json_serialisable_in_every_shape(self):
        bodies = [self.request()[1], self.request(resume=True)[1]]
        self.environment({})
        bodies.append(self.request()[1])

        for body in bodies:
            self.assertIsInstance(json.dumps(body), str)
            self.assertEqual(set(body), {"paused", "changed", "gate", "reason"})


class OverRealHTTP(StopTestCase):
    """The handler, not just the function: routing, the shared authorisation, and the 404 a
    client must read as "this box is older than this extension" rather than as a failure."""

    def serve(self, secret=""):
        import threading
        from http.server import HTTPServer
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen

        previous = heartbeat_server.SECRET
        heartbeat_server.SECRET = secret
        self.addCleanup(setattr, heartbeat_server, "SECRET", previous)

        server = HTTPServer(("127.0.0.1", 0), heartbeat_server.Handler)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"

        def post(path, payload):
            request = Request(f"{base}{path}", data=json.dumps(payload).encode(),
                              headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urlopen(request, timeout=5) as reply:
                    return reply.status, json.loads(reply.read() or b"{}")
            except HTTPError as error:
                return error.code, None

        return post

    def test_a_post_to_stop_pauses_the_queue(self):
        post = self.serve()

        status, body = post("/stop", {})

        self.assertEqual(status, 200)
        self.assertIs(body["paused"], True)
        self.assertTrue(self.stop_file.exists())

    def test_resume_is_the_same_call_with_resume_true(self):
        post = self.serve()
        post("/stop", {})

        status, body = post("/stop", {"resume": True})

        self.assertEqual(status, 200)
        self.assertIs(body["paused"], False)
        self.assertFalse(self.stop_file.exists())

    def test_only_a_literal_true_resumes(self):
        """`{"resume": "no"}` must not accidentally mean resume: a truthy string is exactly
        the shape a hand-written curl gets wrong, and the two directions are opposites."""
        post = self.serve()

        status, body = post("/stop", {"resume": "no"})

        self.assertEqual(status, 200)
        self.assertIs(body["paused"], True, "anything but true is a stop")

    def test_a_configured_secret_is_required(self):
        post = self.serve(secret="s3cret")

        self.assertEqual(post("/stop", {})[0], 401)
        self.assertFalse(self.stop_file.exists(), "a refused request writes nothing")
        self.assertEqual(post("/stop", {"secret": "s3cret"})[0], 200)
        self.assertTrue(self.stop_file.exists())

    def test_an_unknown_path_is_still_404(self):
        post = self.serve()

        self.assertEqual(post("/stopp", {})[0], 404)

    def test_state_reports_the_pause_the_endpoint_just_made(self):
        """The round trip the panel actually makes: write, then read it back."""
        post = self.serve()
        post("/stop", {})

        self.assertIs(heartbeat_server.orchestrator_state()["paused"], True)


class SetPaused(unittest.TestCase):
    """`orchestrator.set_paused()` — the file write itself, so the server never builds that
    path by hand and a test can assert the file rather than the string."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name)

    def test_it_reports_whether_it_changed_anything(self):
        self.assertIs(orchestrator.set_paused(self.repo, True), True)
        self.assertIs(orchestrator.set_paused(self.repo, True), False)
        self.assertIs(orchestrator.set_paused(self.repo, False), True)
        self.assertIs(orchestrator.set_paused(self.repo, False), False)

    def test_the_path_is_the_shared_one(self):
        orchestrator.set_paused(self.repo, True)

        self.assertTrue(orchestrator.stop_file_path(self.repo).exists())
        self.assertIs(orchestrator.is_paused(self.repo), True)

    def test_a_note_is_written_only_when_the_file_is_created(self):
        orchestrator.set_paused(self.repo, True, note="first")
        orchestrator.set_paused(self.repo, True, note="second")

        self.assertEqual(orchestrator.stop_file_path(self.repo).read_text(), "first\n")


if __name__ == "__main__":
    unittest.main()
