status: not_started
version: 1.7
started_at: 2026-09-15T18:39:34+02:00
last_session_id: c42e4c48-8bfe-49f0-accb-f4d4d5588837
last_run: 2026-09-28T18:48:58+02:00
last_cycle_cost_usd: 0.0

## Log
- 2026-09-28T18:48:58+02:00 — done ($0.0)
- 2026-09-15T19:50:36+02:00 — done ($7.222608499999999)
- 2026-09-15T19:36:05+02:00 — in_progress ($0.0)
- 2026-09-15T18:39:34+02:00 — in_progress ($5.172212999999999)





## Units

**1.8 — `/state` must answer for `origin`, not the local clone.** Seven units, one commit each.

- [x] **U1 — 1.7 shipped.** `check-release.sh` reports `orchestrator-v1.7` published
      2026-09-28, checksum matching the bytes served, packed `orchestrator.py` declaring 1.7,
      and the `install.sh` asset identical to the one inside the tarball. No force dispatch
      was needed. That closes the one item 1.7 could not verify from inside its own session.
- [x] **U2 — `refresh_clone()` and the decision table.** One function next to `lock_status`,
      returning `(ok, reason)` and never raising: it refuses for a non-clone, a dirty tree
      (tracked files only), a missing upstream, a failed or timed-out fetch, and a diverged
      clone. `merge --ff-only` is what makes it safe from a GET — it either moves HEAD along a
      line origin already has or changes nothing. 12 tests, one per row, each refusal asserted
      to leave `rev-parse HEAD` and `git status` byte-identical. The fetch is bounded and
      carries `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true` and `BatchMode=yes`, proved with a
      stub `git` that sleeps and one that echoes its environment. `support.stub_binary()`
      generalises `stub_claude`.
- [ ] **U3 — `orchestrator_state()` refreshes**: the lock gate, the rate limit, the ordering
      before `queue_rows`, and the end-to-end test that an answered question becomes `ready`.
- [ ] **U4 — the `refresh` field** on the available body, and the status command's warning.
- [ ] **U5 — the contract** in `ideas/aideas/docs/state-contract.md` and its exact-keys test.
- [ ] **U6 — `SETUP.md`** and the hardened unit's `ReadWritePaths` note.
- [ ] **U7 — 1.8**, `status: done`, suite green under `env -i`.

Next: U3 — refresh before the queue is read, only when no cycle is running, at most once per
ORCHESTRATOR_STATE_REFRESH_SECONDS.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator
