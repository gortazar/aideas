status: not_started
version: 0.2
started_at: 2026-08-10
last_session_id: d24e6611-e9d4-4925-90e2-8fa4db5094ca
last_run: 2026-08-14T01:33:08+02:00
last_cycle_cost_usd: 35.47045299999999

## Log
- 2026-08-14T01:33:08+02:00 — done ($35.47045299999999)
- 2026-08-13T20:00:38+02:00 — done ($20.4351435)
- 2026-08-11T18:50:50+02:00 — in_progress ($6.586843)
- 2026-08-11T15:05:29+02:00 — in_progress ($2.97405)
- 2026-08-10T15:19:15+02:00 — in_progress ($0.0)
- 2026-08-10T14:13:00+02:00 — in_progress ($13.098638499999996)




### 2026-08-14 — done (0.2: notice the moment a session asks or finishes)

The panel now changes at the moment something happens, instead of up to 30 seconds later,
and stays changed until you acknowledge it.

- **Released**: [v0.2](https://github.com/gortazar/recap-gs/releases/tag/v0.2) from
  [e6c96e1](https://github.com/gortazar/recap-gs/commit/e6c96e1), which is also what the
  `upstream/` submodule and the flake input are pinned to. Upstream CI green on `main`; 237
  headless tests, up from 147.
- **Install-verified** from a clean directory against the published asset, with
  `XDG_DATA_HOME` redirected so it could not touch this machine's session: 32 files, the
  shim and both hook installers among them, and the installed `install-hooks.sh --print`
  runs.
- **Proven in a real headless shell**: a separate process runs `recap-gs-notify` with a
  Claude Code hook payload, the panel takes the asking style, the flagged project leads the
  menu carrying the agent's words, the marks survive being read and clear when the menu
  closes, the pulse ends at full opacity, and five enable/disable rounds leave no timer and
  no bus name owned. The screenshots are frames from that run.

## Units (0.2)
- [x] U1 — the attention model: events in, flagged projects out. Longest-prefix matching on
      whole path components (so `aideas-old` never lands on `aideas`), fleet attention for an
      event that matches nothing, coalescing and a per-minute ceiling that suppress the
      *pulse* but not the *flag*, asking beating finished both ways, and clearing only on
      looking, clicking, or recap saying the session stopped waiting. 175 tests.
- [x] U2 — decoding: each agent's own hook JSON becomes an event or a named reason to ignore
      it — never a throw, capped before it is parsed, message stripped of control characters
      and clipped, `cwd` required and absolute. 189 tests.
- [x] U3 — the bus surface: `Event(kind, payload)` on `org.gnome.Shell.Extensions.RecapGs`,
      owned in `enable()` and released in `disable()`, tested against a real bus because no
      stand-in can vouch for a name being owned or given back. 198 tests.
- [x] U4 — the shim and the installer: `recap-gs-notify` (always exits 0, bounded, silent
      when nothing is listening) and `install-hooks.sh` (shows the change, asks, backs up,
      merges, idempotent, never touches a hook you wrote). 213 tests.
- [x] U5 — the appearance: style classes from the theme's accent colour, a bounded three-flash
      pulse, flagged rows at the top of the menu with a dot and the agent's message, and
      attention outranking both the polled summary and a stale report. 222 tests.
- [x] U6 — the refresh trigger: an accepted event nudges the existing single-flight refresher,
      and a locked or idle machine raises the flag while spawning nothing. 225 tests.
- [x] U7 — the two secondary sources, each behind a preference and each raising fleet
      attention only, since neither a notification nor a bell can name a project. 235 tests.
- [x] U8 — the Detection page: the three switches, the exact install command built from the
      extension's own installed path with a copy button, and a read-out that asks the bus the
      same question a hook would. 237 tests.
- [x] U9 — the real shell: the smoke test drives the whole path from a separate process and
      checks the bus name is given back; the acknowledgement bug it found is fixed.
- [x] U10 — `docs/event-interface.md`, the README's Notifications section, `v0.2` released
      and install-verified.

## What the real shell found, again

**Acknowledgement was taken when the menu opened**, which cleared the marks in the same
instant you went looking for them: a lit panel, opened, showing nothing marked and no
message. It is taken when the menu closes now. Only a compositor could have shown that —
every unit test of the rule passed both ways round.

Two smaller ones: the smoke test and `install-local.sh` installed `src/` alone while the
packed zip puts `bin/` and `hooks/` beside it, so the shim the extension tells you to run was
not there; and `ci/crop.js` cropped already-cropped screenshots into slivers on a second run.

## What "done" does not cover

**No real Claude Code session has ever run the hook on this machine.** Everything up to that
point is exercised for real — the installer writes a `settings.json` whose shape is asserted
field by field, and the smoke test runs the actual shim, as a separate process, with a real
Claude Code hook payload on stdin, into the real bus interface of a real extension in a real
shell. What is not exercised is Claude Code itself deciding to run that command, because
doing it honestly would mean either editing the live session's own `~/.claude/settings.json`
— which the installer is careful to ask a human about, and this is not the human — or
spending the user's credentials on a throwaway agent session. The plan asked for it; it is
the one line of it I did not do, and this says so rather than implying otherwise.

**opencode's `session.idle` was not observed either**, for the same reason: the plugin is
written against the documented API and its payload is exact (we write it), but no opencode
session has emitted one here.

## Deviations from PLAN.md (0.2)

- **The menu clears on close, not on open.** The plan said opening the menu clears the flags
  on the rows it shows. Taken literally that removes the marks before they can be read, so
  the visit still clears them — when it ends.
- **The message tray source is best-effort.** The plan called its API the biggest risk and
  said to ship the D-Bus source alone rather than one that works on a single version. It is
  shipped, off by default, feature-detected and wrapped: if the signals are not there it
  stays off and says so once in the log. Only GNOME 46 could be tried here.
- **The panel keeps the same two status icons** for asking and finished rather than gaining
  new ones — the exclamation mark and the tick already mean exactly those two things. What is
  new is the colour, the pulse and the count.


### 2026-08-13 — done (0.1: the panel indicator)

Every feature in the 0.1 `PLAN.md` is built, tested, green, released and installable without
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

## Units (0.1)
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

## What the real shell found (0.1)

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

## Deviations from PLAN.md (0.1)

- **The code is not "built inside" this folder**, which is what the open question about
  where it should live was answered with. The repo-wide rule changed under it: every idea
  now develops in its own GitHub repository, included here as a submodule, so that a
  release workflow can publish assets with nothing but its own `GITHUB_TOKEN`. The later,
  broader rule wins; the extension lives at `gortazar/recap-gs` and this folder is the
  wrapper the rule describes.
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

---

Difficulty estimate at 0.2: medium, as planned, and for the reason the plan gave. The
appearance was an afternoon; the surface underneath it — a public bus interface, a shim
running inside somebody's agent on every turn, and an installer editing their configuration
— is where the care went. What took the longest was neither: it was the build sandbox,
which has no python3, no bash, no session bus and no /usr/bin, and therefore disagreed with
this laptop three separate times about tests that passed here.

Next at 0.2: nothing outstanding. If the idea is reopened, in order: run the hook from a
real Claude Code session (the one line of the plan not done, above); a desktop notification
for `asking` only, off by default, which is the case the answered question left half-open;
and a way to see *which session* within a project asked, which needs recap to say more than
it does today.
