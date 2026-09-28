status: done
version: 1.7
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
- [x] **U5 — `ORCHESTRATOR_VERSION = "1.7"`**, its one-line entry in the version comment,
      and `version: 1.7` here. `scripts/check-version.sh` confirms the two agree; neither
      it nor `check-release.sh` needed editing, since both read the version rather than
      hardcoding it.
- [x] **U6 — `status: done` at 1.7.** 102 tests green four ways: normally, under `env -i`
      with `LC_ALL=C`, `HOME=/nonexistent`, an antipodean `TZ` and **no `claude` on `PATH`**,
      under a comma-decimal locale, and under `-W error::ResourceWarning`. The clean-
      environment run caught a real defect in this entry's own tests: one of them reached a
      state where `run()` legitimately archives `PLAN.md` and drafts a new one, so it invoked
      the **real** `claude`. It passed here and would have failed on CI, which has none
      installed. Every test that calls `run()` now stubs the CLI.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator

## What `done` covers

Every feature in this entry's `PLAN.md` is delivered, tested and committed.

- **A failed agent is reported as failed.** `agent_failure()` reads `is_error` first, because
  in the observed payload it was the only field that was right, and treats a non-`success`
  subtype as a failure too. `finalize` then leaves the idea's status, `started_at` and
  version exactly as they were — which matters beyond honesty, since writing `in_progress`
  started the staleness clock `pick_ideas` deprioritises on.
- **The failure outlives the cycle.** A `— failed: <reason>` line goes into the idea's
  STATUS.md log in the shape `LOG_ENTRY_RE` matches, so it survives the next
  `rewrite_status` and rides into the next agent's briefing.
- **A dead session id recovers itself.** stderr is captured, one bounded probe finds the
  agent that refused to start, its useless session id is deleted and it is respawned once
  without `--resume`. A model-limit failure is deliberately not respawned.
- **A cycle where every agent failed exits non-zero**, so it appears in `systemctl --failed`
  rather than as a clean run. Partial failure stays 0, because real work landed.
- **Two bugs found while testing, both fixed:** the respawn truncated the stderr that
  explained it, and a config without `max_cycle_cost_usd` passed `--max-budget-usd ''`, which
  the CLI rejects outright — killing every agent before it started, silently, under 1.6.

## Not verified from inside this session

**`scripts/check-release.sh` has not been run for 1.7, because the release cannot exist yet.**
An agent may not push this repository; `release-orchestrator.yml` fires on the push the
orchestrator makes *after* this cycle, reading the `status: done` above. This is the same
position 1.6 ended in, and 1.6 published correctly — verified at the start of this session:

    checking gortazar/aideas orchestrator-v1.6 ... PASS: published, verified and installable

**First thing to run next**, and the recovery if it reports nothing:

    ideas/orchestrator/scripts/check-release.sh
    gh workflow run release-orchestrator.yml --repo gortazar/aideas -f force=true

CI has likewise never run remotely for this entry, for the same reason. The suite is green
locally on `/usr/bin/python3` 3.12 with nothing on `PATH` but `/usr/bin` and `/bin`, which is
a closer approximation of the runner than the developer shell is.

## Follow-ups, deliberately not done here

- **No backoff after a model limit**, per the answered open question: the next cycle tries
  again and fails again, now loudly. If the retry noise matters in practice it should be its
  own entry, not a widening of this one.
- **`planning_pass` still raises `FileNotFoundError` when `claude` is absent**, taking the
  cycle down with a traceback. That is loud rather than silent, so it is outside this entry's
  subject, but `claude_missing_reason()` already exists and `cycle_preflight` could use it.
- The root `sonar-project.properties` still lists `orchestrator` under `sonar.sources`, so
  `orchestrator/tests/` is analysed as production code. That file is outside this entry's
  scope and `gortazar/aideas` is ungated, so it cannot block.
