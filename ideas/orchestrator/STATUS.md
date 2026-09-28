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
- [x] **U2 — `agent_failure` wired in.** `finalize` returns early on a failed result: no
      `rewrite_status`, so `status:`, `started_at`, `version` and the staleness clock are
      all untouched. It logs the model's own sentence and the consequence
      (`status left at not_started — nothing was built this cycle`), and
      `note_agent_failure` inserts a `— failed: <reason>` line under `## Log` in the shape
      `LOG_ENTRY_RE` matches. `record_usage` writes `<phase>-failed` and the reason, which
      covers the planning pass too. The merge, worktree removal and branch delete all still
      run, so a resumed agent that hit the limit on its last turn keeps its commits.
      82 tests green.
- [x] **U3 — the dead session id.** Each agent's stderr is captured to `<out>.err` (it was
      inherited and lost, which is why a CLI that refused to start left no trace at all).
      `recover_dead_sessions` sleeps once for the whole set (`early_exit_probe_seconds`,
      default 5, 0.3 in tests), then `poll()`s: an agent that exited non-zero with
      `No conversation found with session ID` gets its session file deleted and is respawned
      once without `--resume`. A limit failure is *not* respawned. Two bugs the tests
      caught: the respawn truncated the stderr that explains it (now opened for append),
      and every spawn leaked two file descriptors (now closed once the child holds them —
      the suite runs clean under `-W error::ResourceWarning`). 89 tests green.
- [x] **U4 — the cycle's own verdict.** `cycle_exit_code()` returns 1 when every agent
      failed, with one summary line naming the distinct reasons; 0 with a WARNING when some
      failed and some worked, because real work landed; 0 and silence otherwise. An agent
      with no result JSON is not counted — that is the killed-agent case, which has its own
      report. Verified that both orchestrator units are `Type=oneshot` with no `Restart=`,
      so a failed cycle marks the unit failed without looping (the `Restart=always` in
      install.sh belongs to the heartbeat server). **Incidental fix found by the stub:** a
      config with no `max_cycle_cost_usd` passed `--max-budget-usd ''`, which the CLI
      rejects, so every agent died before starting — the same invisible failure this entry
      is about. An absent limit now means no flag. 102 tests green.
- [ ] **U5 — `ORCHESTRATOR_VERSION = "1.7"`** and the version-comment entry.
- [ ] **U6 — `status: done` at 1.7**, suite green under `env -i`, then `check-release.sh`.

Next: U5 — ORCHESTRATOR_VERSION = "1.7" and its one-line entry in the version comment.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator
