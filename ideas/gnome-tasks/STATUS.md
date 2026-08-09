status: done
started_at: 2026-08-05T13:26:54+02:00
last_session_id: 58e4e9b2-48c5-4ddf-bb7a-4bce8e161845
last_run: 2026-08-08T16:56:24+02:00
last_cycle_cost_usd: 21.542557000000002

Difficulty estimate: **hard**, as PLAN.md said — four programs, a platform that hides the
information the idea needs, and a long tail of per-app work. Every feature in PLAN.md is now built,
tested and green.

## What "done" covers

All twelve features in `PLAN.md`, each with tests:

| Feature | Where |
| --- | --- |
| Top-bar task switcher | `src/extension/indicator.js` — switch, stop, create, route to preferences; cycle shortcuts plus one accelerator per task |
| Task model with persistent state | `src/lib/task.js`, `taskStore.js` — versioned JSON per task, atomic writes, migration chain |
| Session capture | continuous, debounced, signal-driven; pausable; with an exclusion list |
| Session restore on activation | launches what a task remembered, places what is already open |
| Deactivation policy | `leave`, `close` and `hide` (parks on the last workspace), per task |
| Document tracking, tiered | `src/lib/adapters/` — tier 0/1/2, per-app rules, no guessing for unknown apps |
| Firefox adapter (tier 2) | `browser/` + `src/native-host/` — and Chrome, per the answered open question |
| Managed commands | transient systemd scopes, argv not shell, confirm-before-first-run |
| Preferences UI | `src/prefs/` — tasks, icons, shortcuts, policies, remembered windows, commands, capture, exclusions |
| Public D-Bus API | `org.gnome.Tasks`, echoing `org.kde.ActivityManager` |
| Documented GNOME research | `docs/gnome-internals.md`, `kde-activities.md`, `state-schema.md`, `app-adapters.md`, `limitations.md` (+ `testing.md`) |
| Reproducible environment + green CI | `flake.nix`: lint, unit, dbus, bundle — all green |

**Tests: 151 unit + 56 D-Bus, plus lint and a bundle check, all green under `nix flake check`.** The
D-Bus suite runs a real daemon against a fake compositor, a fake systemd and the real
native-messaging host, so capture, restore, policies, commands and tier-2 are covered without
needing a desktop.

**`make smoke` proves the whole idea end to end** in a nested headless GNOME Shell 46: create a task,
open an app, watch it be captured unprompted, switch away and watch the policy fire, switch back and
get the app *and its document* back at the same geometry, press a per-task shortcut, and build the
preferences window against the live daemon. Eleven checks, all passing.

### The two experiments that could have sunk the design

Both are committed as re-runnable scripts, and both changed the code:

* **Wayland geometry control works** (`tools/experiment-geometry.py`). `move_resize_frame()` from an
  extension is honoured exactly, including on a workspace the user is not looking at. The app's own
  minimum size wins, and a refused size drops the accompanying move.
* **Activation tokens do not come back on the window** (`tools/experiment-m3.sh`). The token reaches
  the application but `Meta.Window.get_startup_id()` is null, so windows are matched to launches by
  app id and timing — a guess, labelled as one in every log line it produces.

## What is built but not verified

Stated plainly, because "done" should not imply more than was actually checked:

* **The browser extension has never run in a real browser.** Every byte of the protocol is tested —
  including against the real native-messaging host — but Firefox and Chrome are snap-confined on this
  machine and cannot be launched into the nested session at all. Someone with a normal browser install
  should load `browser/` and confirm.
* **Nobody has installed this into a real session.** `make install` plus a log out and back in needs
  the machine's owner; Wayland cannot reload the Shell in place. Everything here was exercised in a
  nested session instead.
* **Whether GitHub runners can run a nested headless Shell is still unknown.** This checkout's
  `origin` is a local bare repo, so `.github/workflows/ci-gnome-tasks.yml` has never run; its
  `nested-shell-smoke` job is written, non-blocking, and will answer the question the first time this
  lands on a GitHub remote. Two attempts to approximate a GPU-less runner locally failed
  (`LIBGL_ALWAYS_SOFTWARE` does not stop Mutter opening `/dev/dri`, Mutter 46 has no
  force-software-rendering switch, and hiding `/dev/dri` needs a user namespace this sandbox forbids).
* **Connector names across a real replug.** Layouts are remapped by connector name and the nested
  session has one virtual monitor, so the remapping arithmetic is unit-tested but the *stability* of
  the key is not.

`docs/limitations.md` is the full list, including what cannot work at all (shell state inside a
terminal, unsaved work, documents for apps with no adapter).

## Deliberately not built

* Placing browser windows *after* the browser rebuilds them — the tabs come back, the per-window
  geometry may not (`docs/app-adapters.md`).
* Explicit resource linking, activity templates, per-task wallpaper and favourites: out of scope by
  decision or absent from `PLAN.md`.
* Publishing to extensions.gnome.org, which the answered open questions rule out and which is what
  makes the separate daemon possible at all.

## If this is picked up again

- Run `git add -A` before `nix flake check`: a flake only sees git-tracked files, so a brand-new
  untracked test is invisible and appears to pass.
- **Never put a top-level `await` in the daemon's `main.js`.** Module evaluation becomes a promise
  job, `loop.run()` runs inside it, and no microtask ever drains: every `await` in the process hangs
  for ever while D-Bus replies arrive normally. The reasoning is a comment in `main.js`.
- Building a nested container for a `GLib.Variant` tuple wants a *plain array*, not a ready-made
  variant; passing one silently produces an empty container. This cost time twice — once on window
  placement, once on systemd scope properties.
- `tools/nested-shell.sh` aborts if nested-session settings leak into the real dconf database. That
  guard exists because an early version leaked and rewrote the live desktop's `enabled-extensions`;
  the related environment-inheritance traps are in `docs/gnome-internals.md`.
- The user's `org.gnome.mutter dynamic-workspaces` and `org.gnome.desktop.interface enable-animations`
  were reset to schema defaults while repairing that leak, because the prior values were not
  recoverable. Still worth confirming with them.

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->
- 2026-08-08T16:56:24+02:00 — in_progress ($21.542557000000002)
- 2026-08-07T21:32:12+02:00 — in_progress ($20.986539999999994)
- 2026-08-07T11:29:05+02:00 — in_progress ($19.358296000000006)
- 2026-08-06T17:46:26+02:00 — in_progress ($26.866495500000003)
- 2026-08-06T14:10:11+02:00 — in_progress ($12.033532499999998)
- 2026-08-06T01:22:09+02:00 — in_progress ($10.616743999999999)
- 2026-08-05T13:26:54+02:00 — in_progress ($13.361972999999997)
