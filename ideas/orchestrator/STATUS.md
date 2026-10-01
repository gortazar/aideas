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
- [x] **U3 — `orchestrator_state()` refreshes.** `refresh_payload()` runs before
      `queue_rows`, so one request can never report a queue from before its own fetch, and
      only when the lock says no cycle is running — asserted on the commit sha, not just on
      the payload. Rate limited to one fetch per `ORCHESTRATOR_STATE_REFRESH_SECONDS`
      (120), measured on `time.monotonic` with an injectable clock so no test sleeps; a
      failed attempt starts the window too. The end-to-end case is the reported bug: an
      unticked question answered and pushed by a second clone shows as `ready` on the next
      poll, with no cycle having run. 7 tests.
- [x] **U4 — the `refresh` field and the status line.** Keys are exactly `state`, `reason`,
      `checked_at`, `age_seconds`; `state` is the closed pair `current`/`stale`; `reason` is
      null when current; `checked_at` is the last **success** and `age_seconds` its integer
      age; a box that has never managed a refresh reports nulls, not a third state. An
      `available: false` body still carries nothing but `reason`, and a refresh that raises
      degrades to `stale` instead of 500ing. `orchestrator.py status` prints the same
      sentence — but **read-only**: `upstream_gap()` answers from the last fetch rather than
      calling its mutating sibling, because `status` is interactive and a cycle may be
      building in that tree. `local_refresh_blocker()` holds the three network-free refusals
      so both callers word them identically. 133 tests.
- [x] **U5 — the contract.** `state-contract.md` gains `refresh` in the available-body key
      table, a `### Freshness` section carrying the decision table and the closed two-word
      vocabulary, and a line under *What the extension must not assume*: `stale` is an
      ordinary state and a consumer that ignores the key stays correct. The exact-keys
      assertion in `ideas/aideas/tests/test_state_contract.py` gains `refresh`, plus one
      test of its shape. Both suites green: 133 orchestrator, 114 aideas. **No extension
      source touched** — rendering the field is the aideas idea's own entry, and the key is
      additive precisely so an extension that ignores it keeps working.
- [x] **U6 — what refreshing needs from the box.** `SETUP.md` gains a subsection under
      `/state`, and `idea-heartbeat.service` the matching commented lines. Checking the real
      unit rather than assuming turned up two requirements beyond the planned
      `ReadWritePaths`: `RestrictAddressFamilies` omits `AF_UNIX`, which both an ssh-agent
      socket and `systemd-resolved` need, and `ProtectHome=yes` makes a clone under `/home`
      invisible to that unit for reading as much as for writing. `origin` here is SSH
      (`git@github.com:gortazar/aideas.git`), so the `BatchMode=yes` in the fetch is load
      bearing, not decorative. All of it is optional: a box that cannot refresh reports
      `stale` with the reason and serves the queue it had.
- [ ] **U7 — 1.8**, `status: done`, suite green under `env -i`.

Next: U7 — ORCHESTRATOR_VERSION 1.8, version: 1.8, status: done, suite green under env -i.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator
