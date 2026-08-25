#!/usr/bin/env python3
"""The gates a cycle must pass, over fixture repositories.

`cycle_preflight()` is what `POST /cycle` reports on and what `Orchestrator.run()` obeys, so
these tests are the reason the panel's "Run a cycle" button can name the gate that refused it
instead of doing nothing visible. Pure Python: no spawn, no network, no server.

Run with `python3 -m unittest discover -s tests`, or through ci-aideas.yml's contract job.
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

import orchestrator  # noqa: E402


def heartbeat(state, detail="fixture"):
    """A heartbeat evidence source that says whatever a test needs."""
    return lambda: (state, detail)


class PreflightTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name)
        (self.repo / "README.md").write_text("# ideas\n\n## Ideas\n\n1. [a](ideas/a/) - one\n")
        self.config("allowed_hours: unlimited\nmax_daily_cost_usd: unlimited\n")

    def config(self, text):
        (self.repo / ".agent-config.yml").write_text(text)

    def stop_file(self):
        path = self.repo / ".orchestrator" / "stop"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()

    def spent(self, amount):
        log = self.repo / ".orchestrator" / "usage.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        today = time.strftime("%Y-%m-%d")
        log.write_text(f"{today},{amount},alpha,build,3\n")

    def lock(self, *, renewed_ago=0, ttl_minutes=5, agents=("alpha",)):
        lock_dir = self.repo / ".orchestrator" / "lock"
        lock_dir.mkdir(parents=True, exist_ok=True)
        now = time.time()
        (lock_dir / "meta.json").write_text(json.dumps({
            "acquired_at": now - renewed_ago,
            "renewed_at": now - renewed_ago,
            "ttl_minutes": ttl_minutes,
            "agents": list(agents),
        }))

    def heartbeat_file(self, *, seconds_ago):
        path = self.repo / "heartbeat.json"
        path.write_text(json.dumps({"last_ts": time.time() - seconds_ago,
                                    "last_event": "post_tool_use", "session_id": "x"}))
        return path

    def preflight(self, **kwargs):
        kwargs.setdefault("heartbeat", heartbeat(orchestrator.HEARTBEAT_IDLE))
        return orchestrator.cycle_preflight(self.repo, **kwargs)


class TheAllClear(PreflightTestCase):
    def test_an_idle_box_with_nothing_in_the_way_may_start(self):
        check = self.preflight()

        self.assertTrue(check.ok)
        self.assertIsNone(check.gate)
        self.assertIsNone(check.reason)

    def test_a_stale_lock_does_not_block_a_new_cycle(self):
        self.lock(renewed_ago=3600, ttl_minutes=5)

        self.assertTrue(self.preflight().ok, "a killed cycle must not wedge the button forever")

    def test_no_heartbeat_source_at_all_is_not_a_refusal(self):
        # `run()` always passes one; a caller that has no way to observe the laptop is not
        # thereby forbidden from starting a cycle.
        self.assertTrue(orchestrator.cycle_preflight(self.repo).ok)


class TheGates(PreflightTestCase):
    def test_the_stop_file_is_named_in_the_reason(self):
        self.stop_file()

        check = self.preflight()

        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "stop-file")
        self.assertEqual(check.reason, "Paused: .orchestrator/stop exists")

    def test_outside_the_allowed_hours_says_the_window(self):
        self.config("allowed_hours: 23:00-08:00\ntimezone: Europe/Madrid\n"
                    "max_daily_cost_usd: unlimited\n")
        # Whatever the hour is where this runs, one of the two windows is closed.
        closed = orchestrator.cycle_preflight(self.repo, heartbeat=heartbeat("idle"))
        if closed.ok:
            self.config("allowed_hours: 00:00-00:01\ntimezone: Europe/Madrid\n"
                        "max_daily_cost_usd: unlimited\n")
            closed = orchestrator.cycle_preflight(self.repo, heartbeat=heartbeat("idle"))

        self.assertFalse(closed.ok)
        self.assertEqual(closed.gate, "allowed-hours")
        self.assertIn("Outside allowed_hours", closed.reason)
        self.assertIn("Europe/Madrid", closed.reason)

    def test_a_spent_budget_says_both_numbers(self):
        self.config("allowed_hours: unlimited\nmax_daily_cost_usd: 10\n")
        self.spent(12.40)

        check = self.preflight()

        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "budget")
        self.assertEqual(check.reason, "Daily budget spent ($12.40 of $10)")

    def test_an_unparseable_budget_refuses_rather_than_being_free_money(self):
        self.config("allowed_hours: unlimited\nmax_daily_cost_usd: lots\n")

        check = self.preflight()

        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "budget")

    def test_an_active_laptop_session_is_reported_as_such(self):
        check = self.preflight(heartbeat=heartbeat(orchestrator.HEARTBEAT_ACTIVE))

        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "heartbeat")
        self.assertEqual(check.reason, "A Claude Code session is active on this laptop")

    def test_an_unreadable_heartbeat_is_told_apart_from_an_active_one(self):
        check = self.preflight(
            heartbeat=heartbeat(orchestrator.HEARTBEAT_UNKNOWN, "no state file"))

        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "heartbeat")
        self.assertIn("Cannot tell", check.reason)
        self.assertIn("no state file", check.reason,
                      "the detail is what makes this diagnosable")

    def test_a_live_lock_is_a_cycle_already_running(self):
        self.lock(renewed_ago=10)

        check = self.preflight()

        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "lock")
        self.assertEqual(check.reason, "A cycle is already running")

    def test_the_gates_are_applied_in_the_order_run_applies_them(self):
        """Everything wrong at once: the first gate is the one reported."""
        self.config("allowed_hours: 00:00-00:01\nmax_daily_cost_usd: 1\n")
        self.spent(99)
        self.lock(renewed_ago=1)
        self.stop_file()

        self.assertEqual(self.preflight(
            heartbeat=heartbeat(orchestrator.HEARTBEAT_ACTIVE)).gate, "stop-file")

        (self.repo / ".orchestrator" / "stop").unlink()
        self.assertEqual(self.preflight(
            heartbeat=heartbeat(orchestrator.HEARTBEAT_ACTIVE)).gate, "allowed-hours")

        self.config("allowed_hours: unlimited\nmax_daily_cost_usd: 1\n")
        self.assertEqual(self.preflight(
            heartbeat=heartbeat(orchestrator.HEARTBEAT_ACTIVE)).gate, "budget")

        self.config("allowed_hours: unlimited\nmax_daily_cost_usd: unlimited\n")
        self.assertEqual(self.preflight(
            heartbeat=heartbeat(orchestrator.HEARTBEAT_ACTIVE)).gate, "heartbeat")

        self.assertEqual(self.preflight().gate, "lock")


class TheOverride(PreflightTestCase):
    """`Run anyway` skips the gates about *when* it is convenient, never those about safety."""

    def test_it_skips_the_hours(self):
        self.config("allowed_hours: 00:00-00:01\nmax_daily_cost_usd: unlimited\n")

        self.assertFalse(self.preflight().ok)
        self.assertTrue(self.preflight(override=True).ok)

    def test_it_skips_an_active_laptop_session(self):
        active = heartbeat(orchestrator.HEARTBEAT_ACTIVE)

        self.assertFalse(self.preflight(heartbeat=active).ok)
        self.assertTrue(self.preflight(heartbeat=active, override=True).ok)

    def test_it_never_skips_the_stop_file(self):
        self.stop_file()

        check = self.preflight(override=True)

        self.assertFalse(check.ok, "a pause is a pause: it stays until it is removed")
        self.assertEqual(check.gate, "stop-file")

    def test_it_never_skips_the_budget(self):
        self.config("allowed_hours: unlimited\nmax_daily_cost_usd: 5\n")
        self.spent(6)

        check = self.preflight(override=True)

        self.assertFalse(check.ok, "the cap is the one thing standing between a click and money")
        self.assertEqual(check.gate, "budget")

    def test_it_never_skips_the_lock(self):
        self.lock(renewed_ago=5)

        check = self.preflight(override=True)

        self.assertFalse(check.ok)
        self.assertEqual(check.gate, "lock")


class TheHeartbeatFile(PreflightTestCase):
    """The endpoint's evidence source: the receiver's own state file, never its own socket."""

    def test_a_fresh_heartbeat_means_a_session_is_active(self):
        path = self.heartbeat_file(seconds_ago=5)

        state, detail = orchestrator.heartbeat_from_file(path, staleness_seconds=600)

        self.assertEqual(state, orchestrator.HEARTBEAT_ACTIVE)
        self.assertIn("5s old", detail)

    def test_an_old_heartbeat_means_nobody_is_working(self):
        path = self.heartbeat_file(seconds_ago=3600)

        state, _ = orchestrator.heartbeat_from_file(path, staleness_seconds=600)

        self.assertEqual(state, orchestrator.HEARTBEAT_IDLE)

    def test_a_missing_or_broken_file_is_unknown_rather_than_idle(self):
        missing = self.repo / "nope.json"
        broken = self.repo / "broken.json"
        broken.write_text("{not json")
        empty = self.repo / "empty.json"
        empty.write_text("{}")

        for path in (missing, broken):
            state, detail = orchestrator.heartbeat_from_file(path, staleness_seconds=600)
            self.assertEqual(state, orchestrator.HEARTBEAT_UNKNOWN, f"for {path.name}")
            self.assertTrue(detail, "and says why")

        # An empty state file is a receiver that has never been posted to: last_ts 0, which is
        # very stale, which is idle. That is the right reading and not an error.
        self.assertEqual(orchestrator.heartbeat_from_file(empty, 600)[0],
                         orchestrator.HEARTBEAT_IDLE)

    def test_the_preflight_passes_the_heartbeat_gate_with_no_server_listening(self):
        """The regression the plan asked for by name: reading a file, not calling ourselves.

        A handler inside the single-threaded receiver that asked its own /status would block on
        its own socket, time out, and report "cannot tell" every single time.
        """
        path = self.heartbeat_file(seconds_ago=7200)

        check = orchestrator.cycle_preflight(
            self.repo,
            heartbeat=lambda: orchestrator.heartbeat_from_file(path, staleness_seconds=600))

        self.assertTrue(check.ok, check.reason)


class ClaudeOnThePath(PreflightTestCase):
    def test_it_is_missing_when_the_path_does_not_hold_it(self):
        self.assertEqual(orchestrator.claude_missing_reason({"PATH": "/nonexistent"}),
                         "claude is not on the orchestrator's PATH")

    def test_it_is_found_when_the_path_does(self):
        fake = self.repo / "bin"
        fake.mkdir()
        binary = fake / "claude"
        binary.write_text("#!/bin/sh\n")
        binary.chmod(0o755)

        self.assertIsNone(orchestrator.claude_missing_reason({"PATH": str(fake)}))

    def test_an_empty_environment_is_missing_rather_than_a_crash(self):
        self.assertIsNotNone(orchestrator.claude_missing_reason({}))


class TheLockReader(PreflightTestCase):
    """One reader, shared by /state and the preflight, so they cannot disagree."""

    def test_a_live_lock_reports_its_agents_and_age(self):
        self.lock(renewed_ago=30, agents=("alpha", "beta"))

        running, agents, since, age = orchestrator.lock_status(self.repo)

        self.assertTrue(running)
        self.assertEqual(agents, ["alpha", "beta"])
        self.assertIsNotNone(since)
        self.assertLessEqual(abs(age - 30), 2)

    def test_a_stale_lock_holds_nothing_but_still_has_an_age(self):
        self.lock(renewed_ago=4000, ttl_minutes=5)

        running, agents, since, age = orchestrator.lock_status(self.repo)

        self.assertFalse(running)
        self.assertEqual(agents, [])
        self.assertIsNone(since)
        self.assertGreater(age, 300)

    def test_no_lock_and_a_corrupt_lock_both_read_as_nothing_running(self):
        self.assertEqual(orchestrator.lock_status(self.repo), (False, [], None, None))

        lock_dir = self.repo / ".orchestrator" / "lock"
        lock_dir.mkdir(parents=True, exist_ok=True)
        (lock_dir / "meta.json").write_text("{not json")

        self.assertEqual(orchestrator.lock_status(self.repo), (False, [], None, None))


if __name__ == "__main__":
    unittest.main()
