status: in_progress
started_at: 2026-08-05T13:26:54+02:00
last_session_id: 58e4e9b2-48c5-4ddf-bb7a-4bce8e161845
last_run: 2026-08-06T14:10:11+02:00
last_cycle_cost_usd: 12.033532499999998

## Log
- 2026-08-06T14:10:11+02:00 — in_progress ($12.033532499999998)
Difficulty estimate: **hard**, unchanged. M0 confirmed that the two things that made it hard are
real (no app identity at `window-created`, no geometry until the first buffer commit) and added a
third the plan did not anticipate: snap confinement makes browsers and Electron apps hard even to
*test*.

## Done

**M0 — spike and document.** Complete.
- `tools/probe/` logs every window/app event with all reachable `Meta.Window` metadata as JSON lines
  to the journal; `tools/nested-shell.sh` boots a headless `gnome-shell` on a private bus with
  isolated `XDG_*` directories; `tools/probe-scenario.sh` drives one app per capability question
  through it. The harvest is committed at `docs/probe-data/nested-session.jsonl`.
- `docs/gnome-internals.md` is written from that harvest. The load-bearing findings: app identity is
  absent at `window-created` (`Shell.WindowTracker` hands out synthetic `window:N` ids), geometry is
  `0x0` until the client commits a buffer (measured 52 ms – 1325 ms), `/proc/<pid>/cmdline` is an
  exact tier-1 document source for apps launched with a document but useless for D-Bus-activated
  ones, and monitor connectors must come from `org.gnome.Mutter.DisplayConfig` because Shell 46 has
  no `Meta.Display.get_monitor_connector` at all.
- Go/no-go on tier-1 document sources: **go**, with per-app adapters, as planned.

**M1 — skeleton.** Complete.
- `flake.nix` with a dev shell and four checks — `lint`, `unit`, `dbus`, `bundle`. `nix flake check`
  is green and takes ~5 s warm.
- 46 unit tests under plain `gjs`; 12 D-Bus tests against a private bus via `dbus-run-session`.
- CI runs `nix flake check`, plus a non-blocking `nested-shell-smoke` job (see below).
- The daemon (`src/daemon/`) owns `org.gnome.Tasks`, with a systemd user unit and D-Bus activation.
- The extension (`src/extension/`) owns `org.gnome.Tasks.Shell`, provides the top-bar switcher, and
  forwards coalesced window events.

**Part of M2 — task model and persistence.** Tasks can be created, renamed, activated, stopped and
deleted over D-Bus, and persist as one atomically-written JSON document each under
`~/.local/share/gnome-tasks/`. Documented in `docs/state-schema.md`, with migration rules tested.

### Verified by hand, in a nested headless Shell

The extension loads into a real GNOME Shell 46 session; `org.gnome.Tasks.Shell.Ping` and
`ListWindows` answer over the bus, the latter returning app id, GTK application/window object paths,
pid, geometry, workspace, monitor connector and maximised state for a live Calculator window. The
daemon, started on the same private bus, created two tasks, activated one, and wrote the expected
files to disk.

## Next

1. **M2 proper** — restore *applications only* on activation. This needs `LaunchApp` on the Shell
   interface, which brings M3's first experiment forward (below). Then the switcher keyboard
   shortcut and per-task deactivation policy behaviour.
2. **M3's blocking experiments**, both still unverified because the probe only observes and every
   launch in the harvest came from `gio launch`: does an activation token from
   `global.context.get_app_launch_context()` come back on the new window, and does
   `move_resize_frame()` work for Wayland clients when called from an extension?
3. **Screenshots** for the README. Blocked in the nested session: GNOME 46 refuses
   `org.gnome.Shell.Screenshot` for non-portal callers with `AccessDenied`. The realistic route is
   `make install` into a real session, then a log out and back in — which needs the machine's owner,
   since Wayland cannot reload the Shell in place.
4. `docs/kde-activities.md` and `docs/app-adapters.md` are still unwritten. The first wants a Plasma
   installation to verify against rather than recollection.
5. Probing Firefox and Electron needs a non-snap build, a Flatpak, or a real login session: snap
   confinement blocked all three snap apps in the nested session (details in
   `docs/gnome-internals.md`). Required before M6, not before M4.

## Open question answered this session

**Can CI run a nested headless GNOME Shell?** Locally, yes — `gnome-shell --headless
--virtual-monitor` runs on this machine with no display attached and loads extensions, which is now
the project's main integration-test instrument. On GitHub runners it is still unknown, so
`.github/workflows/ci-gnome-tasks.yml` carries a `nested-shell-smoke` job marked
`continue-on-error` that boots one and prints a verdict. **Check that job's output on the next
push** and record the answer here; the blocking checks do not depend on it.

## Notes for the next session

- Run `git add -A` before `nix flake check`: a flake only sees git-tracked files, so a brand-new
  untracked test is invisible and appears to pass.
- `tools/nested-shell.sh` refuses to run if nested-session settings leak into the real dconf
  database. That guard exists because this session's first version *did* leak, rewriting the live
  desktop's `enabled-extensions`; the cause and four related environment-inheritance traps are
  written up in `docs/gnome-internals.md`.
- While repairing that leak, `org.gnome.mutter dynamic-workspaces` and
  `org.gnome.desktop.interface enable-animations` were reset to their schema defaults, because the
  prior values were not recoverable. Worth confirming with the user.

- 2026-08-06T01:22:09+02:00 — in_progress ($10.616743999999999)
- 2026-08-05T13:26:54+02:00 — in_progress ($13.361972999999997)
