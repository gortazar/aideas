"""RepoLock: the renewing cycle lock (orchestrator 1.0).

The regression this guards: "held" used to mean "taken recently", so a suspended laptop kept
a lock looking valid for 17 hours while a long cycle was free to be reclaimed under it.
"""

from __future__ import annotations

import contextlib
import io
import json
import time

import orchestrator as orch
from tests import support


class RepoLockTests(support.GitSandbox):
    def lock(self, ttl_minutes: float = 5, renew_seconds: float = 30) -> orch.RepoLock:
        return orch.RepoLock(self.path("state"), ttl_minutes, renew_seconds)

    def test_second_cycle_cannot_acquire_a_held_lock(self) -> None:
        first = self.lock()
        self.assertTrue(first.acquire())
        self.addCleanup(first.release)
        second = self.lock()
        self.assertFalse(second.acquire())
        # And the first holder's metadata is untouched.
        self.assertEqual(json.loads(first.meta.read_text())["token"], first.token)

    def test_stale_lock_is_reclaimed(self) -> None:
        stale = self.lock()
        self.assertTrue(stale.acquire())
        stale._stop_renewing.set()  # the old cycle died: nothing renews it any more
        stale._renewer.join(timeout=2)
        meta = json.loads(stale.meta.read_text())
        meta["renewed_at"] = int(time.time()) - 60 * 60  # last seen an hour ago
        stale.meta.write_text(json.dumps(meta))

        fresh = self.lock(ttl_minutes=5)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertTrue(fresh.acquire(), "a lock past its TTL must be reclaimable")
        self.assertIn("Reclaiming stale lock", out.getvalue())
        self.addCleanup(fresh.release)
        self.assertEqual(json.loads(fresh.meta.read_text())["token"], fresh.token)

    def test_lock_within_ttl_is_not_reclaimed_even_if_not_renewing(self) -> None:
        held = self.lock()
        self.assertTrue(held.acquire())
        self.addCleanup(held.release)
        self.assertFalse(self.lock()._reclaim_if_stale())

    def test_renew_loop_keeps_a_live_lock_alive(self) -> None:
        live = self.lock(renew_seconds=0.05)
        self.assertTrue(live.acquire())
        self.addCleanup(live.release)
        before = json.loads(live.meta.read_text())
        # Age the stamp by hand, then wait for the renewer to overwrite it.
        before["renewed_at"] -= 1000
        live.meta.write_text(json.dumps(before))
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if json.loads(live.meta.read_text())["renewed_at"] > before["renewed_at"]:
                break
            time.sleep(0.02)
        self.assertGreater(json.loads(live.meta.read_text())["renewed_at"], before["renewed_at"])
        self.assertFalse(live.lost)

    def test_lost_after_another_token_overwrites_metadata(self) -> None:
        mine = self.lock(renew_seconds=0.05)
        self.assertTrue(mine.acquire())
        self.addCleanup(mine.release)
        meta = json.loads(mine.meta.read_text())
        meta["token"] = "someone-else"
        mine.meta.write_text(json.dumps(meta))
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and not mine.lost:
            time.sleep(0.02)
        self.assertTrue(mine.lost)
        # Releasing must not delete the other cycle's lock.
        mine.release()
        self.assertTrue(mine.meta.exists())
        self.assertEqual(json.loads(mine.meta.read_text())["token"], "someone-else")

    def test_release_removes_own_lock(self) -> None:
        mine = self.lock()
        self.assertTrue(mine.acquire())
        mine.release()
        self.assertFalse(mine.dir.exists())
        self.assertTrue(self.lock().acquire())

    def test_agents_ride_along_with_renewal_and_lock_status_reads_them(self) -> None:
        repo = self.path("repo")
        mine = orch.RepoLock(repo / ".orchestrator", 5, 30)
        self.assertTrue(mine.acquire())
        self.addCleanup(mine.release)
        mine.set_agents(["alpha", "beta"])
        self.assertEqual(json.loads(mine.meta.read_text())["agents"], ["alpha", "beta"])
        running, agents, since, age = orch.lock_status(repo)
        self.assertTrue(running)
        self.assertEqual(agents, ["alpha", "beta"])
        self.assertEqual(since, mine.acquired_at)
        self.assertLess(age, 60)

    def test_lock_status_reports_a_stale_lock_as_not_running(self) -> None:
        repo = self.path("repo")
        dead = orch.RepoLock(repo / ".orchestrator", 5, 30)
        self.assertTrue(dead.acquire())
        dead._stop_renewing.set()
        dead._renewer.join(timeout=2)
        meta = json.loads(dead.meta.read_text())
        meta["renewed_at"] = int(time.time()) - 3600
        meta["agents"] = ["ghost"]
        dead.meta.write_text(json.dumps(meta))
        running, agents, since, _age = orch.lock_status(repo)
        self.assertFalse(running)
        self.assertEqual(agents, [])
        self.assertIsNone(since)
