status: in_progress
version: 0.1
started_at: 2026-08-10
last_session_id: d24e6611-e9d4-4925-90e2-8fa4db5094ca
last_run: 2026-08-11T15:05:29+02:00
last_cycle_cost_usd: 2.97405

## Log
- 2026-08-11T15:05:29+02:00 — in_progress ($2.97405)
- 2026-08-10T15:19:15+02:00 — in_progress ($0.0)
- 2026-08-10T14:13:00+02:00 — in_progress ($13.098638499999996)




### 2026-08-10
Started against a finished `recap`: its `--json` is schema version 1, documented in
`ideas/recap/README.md`, and this extension is written against exactly that.

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
- [ ] M6b — leak test: enable/disable repeatedly with nothing left behind
- [ ] M6c — README, screenshots

Difficulty estimate: medium, as planned. recap being finished removes the risk the plan
called biggest; what is left is the compositor-side work (no blocking, nothing leaked) and
proving it in a real shell.

Next: M6b — the leak test: enable and disable the extension repeatedly in a real headless
shell and prove nothing is left behind.
