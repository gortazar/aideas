status: in_progress
version: 0.1
started_at: 2026-08-10
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

### 2026-08-10
Started against a finished `recap`: its `--json` is schema version 1, documented in
`ideas/recap/README.md`, and this extension is written against exactly that.

## Units
<!-- The honest progress report: one line per unit of work, ticked only once it is
     committed with its tests passing. Refresh this at every unit, not at session end.
     Keep "next" to the single unit being started now. -->
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
- [ ] M4c — the widgets: indicator, menu rows, refresh on menu open, lock and idle
      suppression wired to the real shell
- [ ] M5 — preferences window wired to the GSettings keys
- [ ] M6a — click-through: resume the session in a terminal, in its own directory
- [ ] M6b — leak test: enable/disable repeatedly with nothing left behind
- [ ] M6c — README, screenshots

Difficulty estimate: medium, as planned. recap being finished removes the risk the plan
called biggest; what is left is the compositor-side work (no blocking, nothing leaked) and
proving it in a real shell.

Next: M4c — the widgets: the panel button and the menu built from the model, wired to the
source, the schedule, and the shell's lock and idle state.
