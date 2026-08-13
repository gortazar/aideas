status: done
version: 0.1
started_at: 2026-08-10
last_session_id: d24e6611-e9d4-4925-90e2-8fa4db5094ca
last_run: 2026-08-11T18:50:50+02:00
last_cycle_cost_usd: 6.586843

## Log
- 2026-08-11T18:50:50+02:00 — in_progress ($6.586843)
- 2026-08-11T15:05:29+02:00 — in_progress ($2.97405)
- 2026-08-10T15:19:15+02:00 — in_progress ($0.0)
- 2026-08-10T14:13:00+02:00 — in_progress ($13.098638499999996)

### 2026-08-13 — done

Every feature in `PLAN.md` is built, tested, green, released and installable without
building anything.

- **The extension** is [`gortazar/recap-gs`](https://github.com/gortazar/recap-gs), pinned
  here as the `upstream/` submodule at
  [eff4dfe](https://github.com/gortazar/recap-gs/commit/eff4dfe). Upstream CI is green on
  `main` (ESLint, 147 headless tests, a `--strict` schema compile, and the upload zip
  assembled and inspected), and `nix flake check` here runs those same checks against the
  pinned commit.
- **Released**: [v0.1](https://github.com/gortazar/recap-gs/releases/tag/v0.1), published by
  the tag-triggered workflow in that repository, carrying
  `recap@recap-gs.patxi.shell-extension.zip` and its SHA-256.
- **Installable without building**:
  `curl -fsSL https://raw.githubusercontent.com/gortazar/recap-gs/main/install.sh | sh`.
  Verified from a clean directory against the published release, with `XDG_DATA_HOME`
  redirected so the check could not touch this machine's live session: the asset downloads,
  the checksum verifies, and all 25 files land in the extensions directory.
- **Proven in a real shell**: `ci/smoke-test.sh` boots a headless GNOME Shell 46 with a
  throwaway `HOME`, and reports the extension loading, a panel button appearing, its menu
  filling with six project rows out of a real subprocess, the menu and preferences window
  opening, and five enable/disable rounds with nothing left attached to the main loop. The
  screenshots in the README are frames from that run. It was last run before the move
  upstream; every file under `src/` is byte-identical between that run and the released
  commit (checked, not assumed — what changed afterwards was the flake, the lint config,
  the README and the packaging).

## Units
- [x] M1 — skeleton: flake (dev shell, `nix build`, `nix flake check` running lint, the
      headless suite, schema compile and pack validation), `metadata.json` for GNOME 46-50,
      a GSettings schema, an extension that enables and disables cleanly, the shipped
      symbolic icons, and `src/lib/contract.js` — the schema version, recap's six status
      words, their icons and their urgency order. 11 tests.
- [x] M0 — the contract: four fixtures recorded from the real recap binary against recap's
      own demo store by `scripts/record-fixtures.sh` (every status, empty, finished,
      liveness unavailable), tested for the guarantees version 1 makes, and
      `docs/recap-json-contract.md` naming the version and both spellings of the
      vocabulary. 20 tests.
- [x] M2a — decoding: `recap --json` output becomes a document or a named problem, never a
      throw — no output, unreadable output, JSON that is not a recap report, and a schema
      version we were not written against are four different answers. The envelope is
      checked hard; a nonsense project entry travels on, because one bad row is not a
      reason to show nothing. 31 tests.
- [x] M2b — the row model: one row per project in recap's order, carrying its status icon,
      agent, recap's own sentence and an age in words; the session a click would resume
      (the one in the state the row reports, most recent first, never one without a
      directory to resume it in); and the hide-finished / hide-idle preferences. 51 tests.
- [x] M2c — the panel summary: the worst state wins, so one project waiting for you is
      visible without opening anything; the count beside the icon is how many are in that
      state; the tooltip spells the fleet out most-urgent-first; and a problem is always a
      neutral icon, never an alarm. 60 tests.
- [x] M2d — the command line and what to make of the answer: recap's own flags built from
      the settings (never `--smart`), and one run classified into a document or a named
      problem — missing binary, failed to start, non-zero exit with recap's own first line
      of stderr, timeout, no output, unreadable output. Both halves pure, so the paths that
      never happen on a working machine are the ones under test. 76 tests.
- [x] M3 — the subprocess seam: `Gio.Subprocess` + `communicate_utf8_async`, a timeout
      that cancels the run *and kills the child*, no two refreshes overlapping, the last
      good report kept and marked stale when a refresh fails, and `destroy()` cancelling
      what is in flight with no timer left behind. Tested twice over: against a fake seam
      with fake timers, and against real processes (`/bin/sh`, a binary that is not there,
      one that fails, one that hangs). 90 tests.
- [x] M4a — the menu model, decided without a compositor: every state of the world
      produces something to read — asking, no sessions, hidden by your own filters, recap
      unavailable, an old report dated and kept rather than an emptied menu — and a stale
      report never drives the panel icon, so a hang cannot raise a false alarm. 101 tests.
- [x] M4b — the refresh schedule: one GLib timeout source, refreshing at once and then on
      the interval, skipping (but not abandoning) ticks while suppressed, restarting the
      interval when woken by an opened menu, and leaving nothing behind when stopped. The
      timer functions are injected, so a rule about time is checked without waiting.
      112 tests.
- [x] M4c — the widgets: a panel button whose icon and count come from the summary, a menu
      of rows (status icon, project, agent, age, recap's sentence wrapped rather than
      elided — the shell has no tooltips) and notes, refreshed on the schedule, on menu
      open, on a settings change and when the user comes back to the machine; suppressed
      while locked or idle (idle monitor loaded dynamically, so a shell without one still
      works). Plus static hygiene guards: nothing under lib/ imports the shell, nothing
      synchronous, no eval, no prototype patching, every connected signal disconnected in
      _onDestroy, and a stylesheet that only styles our own classes. 120 tests.
- [x] M5 — preferences: an Adwaita window built from a description in `lib/preferences.js`,
      so a test can hold it against the GSettings schema — a key with no row is a setting
      nobody can change, and a row with no key is a control that does nothing. Project
      roots are edited as a colon-separated list, the way PATH is written. 129 tests.
- [x] M6a — click-through: activating a row opens a terminal in the session's own
      directory and resumes the agent there (`claude --resume <id>`, `opencode --session
      <id>`), preferring the desktop's own terminal and falling back through eleven known
      ones. An agent it cannot resume, or a machine with no terminal, says so in a
      notification rather than doing nothing. 146 tests.
- [x] M6b — the real shell: `ci/smoke-test.sh` boots a headless GNOME Shell against a
      throwaway `HOME` and a stand-in recap, and a test-only driver extension inside it
      checks the panel button appears, the menu fills with project rows, the menu and the
      preferences window open, and five enable/disable rounds leave nothing attached to the
      main loop — the last measured by patching `GLib.timeout_add*` and looking the ids up
      in the main context afterwards, so a leak is named rather than guessed at. It found
      two real defects; see below. 147 tests.
- [x] M6c — the screenshots (frames from that same run, cropped by `ci/crop.js`), the
      upstream README that opens with the install command, and this idea's own README.
- [x] Shipping — the extension moved to its own repository, CI and a tag-triggered release
      workflow there, `install.sh` that downloads and verifies the published asset, the
      `upstream/` submodule and a `flake.nix` here that runs upstream's checks at the
      pinned commit, `scripts/check-pin.sh`, and `v0.1` released and install-verified.

## What the real shell found

Two defects that no amount of headless testing would have shown, both fixed:

1. **Every status icon was invisible.** The SVGs began with an XML declaration and then a
   three-line comment, which pushes `<svg>` past the window gdk-pixbuf sniffs for a format
   signature: the loader then refuses the file outright, and the panel draws a blank with
   nothing in the log naming it. The comments moved inside the `<svg>` element, and the
   suite now loads every shipped icon through `GdkPixbuf` — the test that would have caught
   it, written after it did not.
2. **The smoke test lied about a working extension.** Its "the menu filled up" check counted
   any menu item, and the menu says "Asking recap…" immediately, so it passed while the
   report never arrived. It counts project rows now.

## Deviations from PLAN.md

- **Tooltips.** The plan wanted each row's recap elided with the full sentence in a tooltip.
  GNOME Shell has no tooltip API for menu items, so the sentence wraps instead and the
  stylesheet caps the menu width. The full text is also the row's accessible name.
- **`gnome-extensions pack` is not what packs the zip.** It ships with gnome-shell — about a
  gigabyte of closure to download for one CLI call in a check that otherwise needs no
  compositor. `checks.pack` assembles the same file set and asserts what the tool would
  refuse on: the required `metadata.json` fields, the uuid, a `--strict`-compiling schema,
  and every file the extension needs present in the zip.
- **The real-shell smoke test is not in CI.** GitHub's runners have no GNOME Shell, and
  installing one plus a virtual monitor is a far bigger dependency than the thing it checks.
  It is a script anyone can run, and it was run against the released commit on this machine
  (GNOME Shell 46).
- **Six statuses, not five.** The plan lists five; recap's schema has six — `unclear` is a
  state it reports whenever it cannot tell, and the panel has to draw it.

## Deliberately not done

- **Submitting to extensions.gnome.org.** The answered open question sets the bar at "just
  green", and publishing is a decision, not a build step. The release asset is exactly the
  zip EGO would take, so it is a form away whenever that is wanted.
- **Notifications on a status change.** The open question answered "not for v1".
- **Anything at all written to an agent's session.** The only process this extension ever
  starts is the terminal you asked for by clicking a row.

Difficulty estimate: medium, as planned. recap being finished removed the risk the plan
called biggest. What actually took the time was the compositor side — proving nothing
blocks and nothing leaks in a shell that has to be booted to be asked.

Next: nothing — the plan is delivered at 0.1. If the idea is reopened: notifications on a
transition to *waiting* would be the first thing to weigh, a session-level submenu for
projects with several sessions the second, and running the smoke test in a Fedora container
in CI the third.
