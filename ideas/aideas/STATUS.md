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
- [ ] U2 — the flake and the skeleton: `flake.nix`, eslint config, gjs test runner,
      `metadata.json`, an `extension.js` that enables and disables cleanly, CI green.
- [ ] U3 — parsing and grouping: a `/state` body in, sections and rows out.
- [ ] U4 — visibility and the badge.
- [ ] U5 — the panel button and menu.
- [ ] U6 — the HTTP client: libsoup, timeout, single-flight, backoff, last-good retention.
- [ ] U7 — the scheduler: interval, menu-open rate, lock/idle suppression, injected clock.
- [ ] U8 — preferences and the GSettings schema, including *Test connection*.
- [ ] U9 — the real shell: smoke test, screenshots, a recorded run against the real box.
- [ ] U10 — packaging: `install.sh`, release workflow, README, SETUP.md pointer, release
      verified from a clean directory.

Next: U2 — the flake and the skeleton.

## Notes for later units

- **One behaviour found while pinning the contract, now documented and tested:** every
  entry of a *running* slug comes back as `running`, not just the first. `queue_rows`
  checks the agent list before the duplicate check and never adds a running slug to its
  seen set. So the Running section must tolerate the same slug appearing twice, and rows
  must be keyed by `position` — `slug` is not unique.
- **`lock_age_seconds` survives a dead cycle** (`running: false`, non-null age), which is
  exactly the signal for a box that stopped renewing. `cycle_started_at` does *not*: it is
  null unless the cycle is live.
- The answered open questions settle: the button is visible **only while a cycle is
  running**; this work may edit `SETUP.md` and `orchestrator/`; the release is a tag on
  this repo (`aideas-shell-v0.1`) published by `.github/workflows/release-aideas.yml`; menu
  rows stay read-only.
