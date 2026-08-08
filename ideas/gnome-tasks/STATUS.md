status: in_progress
started_at: 2026-08-05T13:26:54+02:00
last_session_id: 58e4e9b2-48c5-4ddf-bb7a-4bce8e161845
last_run: 2026-08-08T16:56:24+02:00
last_cycle_cost_usd: 21.542557000000002

## Log
- 2026-08-08T16:56:24+02:00 — in_progress ($21.542557000000002)
- 2026-08-07T21:32:12+02:00 — in_progress ($20.986539999999994)
- 2026-08-07T11:29:05+02:00 — in_progress ($19.358296000000006)
- 2026-08-06T17:46:26+02:00 — in_progress ($26.866495500000003)
- 2026-08-06T14:10:11+02:00 — in_progress ($12.033532499999998)
- 2026-08-06T01:22:09+02:00 — in_progress ($10.616743999999999)
- 2026-08-05T13:26:54+02:00 — in_progress ($13.361972999999997)




Difficulty estimate: **hard**, unchanged — but the two experiments that could have invalidated the
design are done, and it survived. Wayland geometry control works; exact launch-to-window matching
does not, and never will through the API the plan assumed.

## Done

**M0 — spike and document.** Complete. `tools/probe/` + `tools/nested-shell.sh` +
`tools/probe-scenario.sh`, harvest committed at `docs/probe-data/nested-session.jsonl`, findings in
`docs/gnome-internals.md`. The load-bearing ones: a window has no app identity at `window-created`
(synthetic `window:N` ids), geometry is `0x0` until the client commits a buffer (52 ms – 1325 ms),
`/proc/<pid>/cmdline` is an exact tier-1 document source for apps launched with a document and
useless for D-Bus-activated ones, and monitor connectors must come from
`org.gnome.Mutter.DisplayConfig`.

**M1 — skeleton.** Complete. `nix flake check` runs lint, 70 unit tests, 22 D-Bus tests and a bundle
check, green, in seconds. Daemon owns `org.gnome.Tasks` with a systemd user unit and D-Bus
activation; extension owns `org.gnome.Tasks.Shell`.

**M2 — task model, persistence, switcher, capture and restore.** Complete, and this is the first
genuinely useful version: **a task remembers the applications you open, and switching back brings
them back where they were.** Tasks persist as one atomic JSON document each
(`docs/state-schema.md`), capture is continuous and debounced, `CaptureEnabled` pauses it entirely,
and switch-away applies the outgoing task's deactivation policy (`close` and `leave` implemented;
`hide` says it is not implemented rather than silently doing nothing).

**M3 — placement.** Mostly done, ahead of schedule, because its two open questions had to be
answered before M2's restore could work at all:
- `LaunchApp` / `PlaceWindow` / `CloseWindow` / `GetPlacementReport` are implemented, with the launch
  matcher and its confidence hierarchy in `src/lib/launchMatcher.js`.
- Still missing from M3: remapping a saved layout onto a *different* monitor set, and the
  dynamic-workspace edge cases.

### The two experiments, and their verdicts

`tools/experiment-m3.sh` and `tools/experiment-geometry.py` are committed, so both can be re-run.

- **Wayland geometry control: WORKS.** `move_resize_frame()` from an extension is honoured exactly,
  position and size, including for a window on a workspace the user is not looking at. Caveats: the
  app's own minimum size wins (Calculator refuses to be shorter than 491 px), and when a size is
  refused the accompanying move is dropped with it.
- **Activation tokens: DO NOT come back on the window.** The token reaches the application (it is in
  `/proc/<pid>/environ`) but `Meta.Window.get_startup_id()` is null, so matching falls back to app id
  plus timing — a guess that can misattribute windows when two launches of the same app are in
  flight. Every match records which strategy produced it. `Meta.StartupNotification`'s sequences are
  the next thing to try.
- Measuring either of these is a trap in its own right: a Wayland geometry change is a negotiation,
  so reading the frame straight after asking returns the old one.

### Verified end to end

`make smoke` boots a nested headless Shell with the real extension and a real daemon and walks the
whole loop — create, capture unprompted, close on switch-away, restore on switch-back — with the
restored geometry identical to the remembered geometry. `screenshots/nested-session.png` shows the
switcher in the top bar with the active task.

## Next

1. **M4 — documents (tier 1).** The adapter framework, then adapters for the cases M0 showed to be
   tractable: `/proc/<pid>/cmdline` for apps launched with a file, `/proc/<pid>/fd` for Nautilus,
   title parsing for terminals' working directory. `docs/app-adapters.md` comes with it.
2. **Finish M3**: monitor remapping (connector + EDID identity is already captured, nothing consumes
   it yet) and dynamic-workspace behaviour.
3. **`hide` deactivation policy**, which needs a parking-workspace policy decided first.
4. **M5 — commands** as transient systemd units.
5. `docs/kde-activities.md` still unwritten; it wants a Plasma installation to verify against rather
   than recollection.
6. Probing Firefox and Electron still needs a non-snap build, a Flatpak or a real login session.

## Open questions answered by experiment

**Can CI run a nested headless GNOME Shell?** Locally yes, and it is now the project's main
integration instrument. On GitHub runners: **still unknown, and unknowable from here** — this
repository's `origin` is a local bare repo, so the workflow has never run. Two attempts to
approximate a runner locally both failed: `LIBGL_ALWAYS_SOFTWARE=1` does not stop Mutter opening
`/dev/dri/card1`, Mutter 46 has no force-software-rendering switch, and hiding `/dev/dri` needs a
user namespace this sandbox forbids. The `nested-shell-smoke` job in
`.github/workflows/ci-gnome-tasks.yml` is written and marked `continue-on-error`, so the answer
arrives the first time this lands on a GitHub remote. The blocking checks never depend on it.

## Notes for the next session

- Run `git add -A` before `nix flake check`: a flake only sees git-tracked files, so a brand-new
  untracked test is invisible and appears to pass.
- **Never put a top-level `await` in the daemon's `main.js`.** Module evaluation becomes a promise
  job, `loop.run()` then runs inside that job, and no microtask is ever drained: D-Bus calls go out,
  replies arrive, callbacks fire, and every `await` hangs for ever. This cost an hour to find and the
  reasoning is a comment in `main.js` so it does not come back.
- `tools/nested-shell.sh` refuses to run if nested-session settings leak into the real dconf
  database. That guard exists because an earlier version *did* leak, rewriting the live desktop's
  `enabled-extensions`; the cause and the related environment-inheritance traps are in
  `docs/gnome-internals.md`.
- The user's `org.gnome.mutter dynamic-workspaces` and `org.gnome.desktop.interface enable-animations`
  were reset to schema defaults while repairing that leak, because the prior values were not
  recoverable. Still worth confirming with them.

