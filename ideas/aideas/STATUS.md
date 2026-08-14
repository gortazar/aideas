status: in_progress
version: 0.1
started_at: 2026-08-14T15:31:00+02:00
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

Difficulty estimate: **medium**, as PLAN.md said. The GNOME Shell side is well-trodden
(`ideas/gnome-tasks` is an in-repo extension with a gjs test harness to copy), and `/state`
already serves exactly what the menu needs. What has to be invented is the packaging: this
idea has no upstream repo, so its flake, CI, installer and release all live here.

## Units
<!-- The honest progress report: one line per unit of work, ticked only once it is
     committed with its tests passing. Refresh this at every unit, not at session end.
     Keep "next" to the single unit being started now. -->
- [x] **U1 — the contract.** `docs/state-contract.md` specifies the `/state` response as a
      versioned surface: the two body shapes, the six always-present row keys, the two
      conditional ones, and the closed five-word `state` vocabulary.
      `tests/test_state_contract.py` makes it true — 24 tests driving
      `orchestrator.queue_rows()` and `heartbeat_server.orchestrator_state()` over fixture
      repositories built on disk (running cycle, stale lock, corrupt lock, blocked idea,
      duplicate slugs, no `PLAN.md`, no `STATUS.md`, empty queue, unset `IDEAS_REPO_PATH`,
      unparseable queue). All green with stock `python3`, no dependencies.
- [x] **U2 — the flake and the skeleton.** `flake.nix` with three checks — `lint` (eslint,
      offline, built-in rules only), `unit` (the headless gjs suite) and `bundle` (the
      assembled extension validated by `tools/check-bundle.js`) — all three green locally
      under `nix flake check`, plus a `packages.default` that produces the release zip.
      `Makefile`, `tests/harness.js` and `tests/run.js` (both from `ideas/gnome-tasks`),
      `metadata.json` for GNOME 46–50, the GSettings schema, an `extension.js` whose
      `disable()` undoes its `enable()`, and `src/lib/duration.js` — the header line's
      wording — with 11 tests. 17 gjs tests green.
      `.github/workflows/ci-aideas.yml` gained a second job for the contract test, and now
      also triggers on changes to `orchestrator/`.
- [x] **U3a — parsing.** `src/lib/state.js` turns a `/state` body into one of four readings —
      `ok`, `unavailable`, `unreachable`, `unconfigured` — with every field either usable or
      null, and never throws. Unknown `state` words keep their own name and are flagged
      `known: false` rather than dropped; duplicate slugs and slugless rows survive; an
      absurd queue is capped at 200 rows with the remainder counted. 31 tests, including a
      body that is JSON but not `/state` (a wrong port), which reports unreachable rather
      than pretending. 48 gjs tests green.
- [x] **U3b — grouping and wording.** `src/lib/menuModel.js` turns a reading into the whole
      menu as data: the header line (`Cycle running for 12 min, 2 agents` / `Idle`, with the
      age of the reading and the lock's last renewal), four sections in glance order
      (Running, Blocked, Ready, Also in the queue) with empty ones omitted, per-row wording
      taken from `note` as served, the `will_run_next` row marked, an empty queue said in a
      sentence, and the failure messages — with `unavailable` and `unreachable` deliberately
      worded apart. When an attempt fails, the last good reading is shown beneath it marked
      stale and dated rather than the menu emptying itself. 36 tests, clock injected. 84 gjs
      tests green.
- [x] **U4 — visibility and the badge.** `src/lib/indicatorModel.js` decides the button as a
      pure function of the reading: visible only while a cycle is running (the answered
      question), with the "always show" preference overriding; six state icons, all stock
      symbolic names so the extension ships no assets; a badge counting agents while running
      and blocked ideas while idle, absent rather than zero; and an accessible name carrying
      the panel's whole meaning. 21 tests. 105 gjs tests green.
- [ ] U5 — the panel button and menu.
- [ ] U6 — the HTTP client: libsoup, timeout, single-flight, backoff, last-good retention.
- [ ] U7 — the scheduler: interval, menu-open rate, lock/idle suppression, injected clock.
- [ ] U8 — preferences and the GSettings schema, including *Test connection*.
- [ ] U9 — the real shell: smoke test, screenshots, a recorded run against the real box.
- [ ] U10 — packaging: `install.sh`, release workflow, README, SETUP.md pointer, release
      verified from a clean directory.

Next: U5 — the panel button and menu.

## Notes for later units

- **One behaviour found while pinning the contract, now documented and tested:** every
  entry of a *running* slug comes back as `running`, not just the first. `queue_rows`
  checks the agent list before the duplicate check and never adds a running slug to its
  seen set. So the Running section must tolerate the same slug appearing twice, and rows
  must be keyed by `position` — `slug` is not unique.
- **`lock_age_seconds` survives a dead cycle** (`running: false`, non-null age), which is
  exactly the signal for a box that stopped renewing. `cycle_started_at` does *not*: it is
  null unless the cycle is live.
- **The contract test is not a flake check, deliberately.** The flake's root is this folder,
  and `tests/test_state_contract.py` imports the orchestrator from two directories up, which
  a flake cannot see. It runs as its own CI job and as `make test-contract`, needing nothing
  but a stock `python3` — which is what it is designed for, since it can then also be run on
  the box itself. PLAN.md said "the contract test through flake.nix"; this is the one
  documented deviation from it.
- **One decision the answered question did not cover, taken in U4:** what the button does
  when a poll fails while a cycle was running a moment ago. Strictly hiding it would blink the
  panel out on every VPN hiccup, and would make the "unreachable" icon PLAN.md lists
  unreachable in practice — it could only ever be seen with "always show" on. So a good
  reading keeps the button up for 5 minutes after contact is lost, wearing the unreachable
  icon and the count it last knew. Still "only while a cycle is running", just not forgetting
  between two readings. A box that answers `available: false` does **not** borrow from the
  past: it is talking to us, and what it says is that it cannot read its queue.
- The answered open questions settle: the button is visible **only while a cycle is
  running**; this work may edit `SETUP.md` and `orchestrator/`; the release is a tag on
  this repo (`aideas-shell-v0.1`) published by `.github/workflows/release-aideas.yml`; menu
  rows stay read-only.
