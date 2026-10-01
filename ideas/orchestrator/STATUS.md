status: done
version: 1.8
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
- [x] **U7 — 1.8 and `status: done`.** `ORCHESTRATOR_VERSION`, the version comment and
      `version:` here all say 1.8, asserted by `check-version.sh`. 133 orchestrator tests
      green four ways — normally, under `env -i` with `LC_ALL=C`, `HOME=/nonexistent`, an
      antipodean `TZ` and nothing on `PATH` but `/usr/bin` and `/bin`, under a comma-decimal
      locale, and under `-W error::ResourceWarning` — plus 114 aideas contract tests.

Run the suites from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator
    python3 -m unittest discover -s ideas/aideas/tests

## What `done` covers

Every feature in this entry's `PLAN.md` is delivered, tested and committed.

- **`/state` answers for `origin`.** `refresh_clone()` fast-forwards the clone, and
  `orchestrator_state()` calls it *before* `queue_rows`, so one request can never report a
  queue from before its own fetch. The reported bug is a test: an unticked question answered
  and pushed by another clone shows as `ready` on the next poll, with no cycle having run.
- **Every refusal is decided, not discovered.** Nine rows, each with its own sentence and its
  own test, and each refusal asserted to leave `rev-parse HEAD` and `git status`
  byte-identical. `merge --ff-only` is what makes a GET safe to do this at all.
- **A GET never touches a tree a cycle is building in.** Gated on the lock the function
  already reads, and asserted on the commit sha rather than on the payload.
- **Bounded and non-interactive.** One fetch per 120 s on a monotonic clock, abandoned after
  5 s, with `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true` and `BatchMode=yes` — proved by a stub
  `git` that sleeps and one that echoes its environment. This process also serves
  `POST /heartbeat`, and a heartbeat that does not land reads as an idle laptop.
- **The contract records it**, with the decision table and the closed two-word vocabulary, and
  the exact-keys test that keeps the document true was updated in the same commit.
- **`status` tells the same story read-only.** `upstream_gap()` answers from the last fetch:
  a status command must not block on the network, and must not move a tree a cycle may be in.

## Not verified from inside this session

**`scripts/check-release.sh` has not been run for 1.8**, because the release cannot exist yet:
an agent may not push this repository, and `release-orchestrator.yml` fires on the push the
orchestrator makes *after* this cycle, reading the `status: done` above. 1.6 and 1.7 both ended
in this position and both published correctly; 1.7 was verified at the start of this session.

**First thing to run next**, and the recovery if it reports nothing:

    ideas/orchestrator/scripts/check-release.sh
    gh workflow run release-orchestrator.yml --repo gortazar/aideas -f force=true

CI has not run remotely for this entry either, for the same reason. Both suites are green
locally on `/usr/bin/python3` 3.12 with nothing on `PATH` but `/usr/bin` and `/bin`.

**The refresh has never run on the real box.** Everything here is proved against bare
repositories on disk; whether `idea-heartbeat.service` can actually write the clone and fetch
non-interactively is a property of that machine, which is why `SETUP.md` now carries the two
requirements and a command to check them. A box where it does not work reports `stale` with
the reason rather than failing, so the worst case is the pre-1.8 behaviour, labelled.

## Follow-ups, deliberately not done here

- **The extension does not render `refresh` yet.** That is the `aideas` idea's work under its
  own entry; the key is additive so an extension ignoring it stays correct. Until then the
  panel is fresh but does not say so.
- **`release-orchestrator.yml` hardcodes 1.6's headline** in the release title, so 1.7 is
  published as "rescued work reaches the remote, and there are tests". Cosmetic, and that file
  is outside this entry's stated scope.
- **A long fetch still blocks `POST /heartbeat`**, since one thread serves everything. Bounded
  at 5 s, which is the mitigation the entry chose; a background refresh the GET kicks but never
  waits on is the larger fix, and belongs to its own entry.
- **No backoff after a model limit**, and **`planning_pass` still raises `FileNotFoundError`
  when `claude` is absent** — both carried over from 1.7, both still outside scope.
- The root `sonar-project.properties` still lists `orchestrator` under `sonar.sources`, so
  `orchestrator/tests/` is analysed as production code.
