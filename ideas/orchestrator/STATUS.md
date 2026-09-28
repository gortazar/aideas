status: not_started
version: 1.6
started_at: 2026-09-15T18:39:34+02:00
last_session_id: c42e4c48-8bfe-49f0-accb-f4d4d5588837
last_run: 2026-09-15T19:50:36+02:00
last_cycle_cost_usd: 7.222608499999999

## Log
- 2026-09-15T19:50:36+02:00 — done ($7.222608499999999)
- 2026-09-15T19:36:05+02:00 — in_progress ($0.0)
- 2026-09-15T18:39:34+02:00 — in_progress ($5.172212999999999)




## Units

**1.7 — a failed agent must not read as a quiet one.** Six units, one commit each.
The 1.6 release was verified first: `check-release.sh` reports orchestrator-v1.6 published,
its checksum matching the bytes served and its packed `orchestrator.py` declaring 1.6. That
closes the one item the previous entry left open.

- [x] **U1 — `stub_claude` and `test_agent_failure.py`.** `support.py` gains a fake `claude`
      first on `PATH` that records every argv, plus `LIMIT_RESULT` (the exact observed
      payload: `subtype: success` *and* `is_error: true`) and `HEALTHY_RESULT`. Four fixture
      tests assert the stub really is what runs, is executable, logs its calls and leaves
      `PATH` restored. `agent_failure()` lands with its six classifier tests green.
      **Committed red on purpose:** 5 `finalize`/`record_usage` cases fail, which is U2's
      specification. 82 tests, 5 failing.
- [ ] **U2 — `agent_failure` wired into `finalize`, `note_agent_failure`, `record_usage`.**
- [ ] **U3 — `test_resume_fallback.py`**, stderr capture, the probe pass and the one respawn.
- [ ] **U4 — `test_cycle_outcome.py`**, the failure count, summary line and exit code.
- [ ] **U5 — `ORCHESTRATOR_VERSION = "1.7"`** and the version-comment entry.
- [ ] **U6 — `status: done` at 1.7**, suite green under `env -i`, then `check-release.sh`.

Next: U2 — leave a failed idea's status alone, record the failure where the next agent reads
it, and stop printing a confident $0.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator
