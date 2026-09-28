status: not_started
version: 0.1
started_at: 2026-08-05T13:26:54+02:00
last_session_id: 58e4e9b2-48c5-4ddf-bb7a-4bce8e161845
last_run: 2026-08-09T13:03:02+02:00
last_cycle_cost_usd: 13.001496000000001

## Log
- 2026-08-09T13:03:02+02:00 — done ($13.001496000000001)
- 2026-08-08T16:56:24+02:00 — in_progress ($21.542557000000002)
- 2026-08-07T21:32:12+02:00 — in_progress ($20.986539999999994)
- 2026-08-07T11:29:05+02:00 — in_progress ($19.358296000000006)
- 2026-08-06T17:46:26+02:00 — in_progress ($26.866495500000003)
- 2026-08-06T14:10:11+02:00 — in_progress ($12.033532499999998)
- 2026-08-06T01:22:09+02:00 — in_progress ($10.616743999999999)
- 2026-08-05T13:26:54+02:00 — in_progress ($13.361972999999997)

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

### What CI runs, and what it has already answered

`.github/workflows/ci-gnome-tasks.yml` runs on every push and pull request touching
`ideas/gnome-tasks/**` or the workflow itself. It has two jobs, both on `ubuntu-latest`:

* **`test` (blocking)** — `nix flake check --print-build-logs`, which is the whole suite: `lint`,
  `unit`, `dbus`, `bundle`.
* **`nested-shell-smoke` (`continue-on-error: true`)** — installs `gnome-shell`, boots a nested
  headless Shell via `tools/nested-shell.sh` with `tools/probe`, and prints a verdict.

As of 2026-09-28 the workflow has run 13 times on this repository (`origin` is
`git@github.com:gortazar/aideas.git`); the four most recent runs concluded `success`. The newest,
run **36414701024** (`e1113a8`, 2026-09-28), is the reference below.

**A nested headless GNOME Shell does run on a GitHub runner.** This answers the last open question in
`plans/01-2026-08-28.md`, and it has been answered in public since **2026-08-06** — the first run
whose SHA carried the smoke job (run **31112654174**, `4970510a`) already printed it. Every smoke job
since has printed the same line:

```
VERDICT: a nested headless GNOME Shell runs on this runner.
```

The probe record behind that verdict, from run 36414701024, is `gnome-shell 46.0` under a real
compositor with one 1280×800 virtual monitor:

```json
{"event":"probe-enabled","t":63410297,"shell_version":"46.0","session_type":null,
 "n_workspaces":4,"dynamic_workspaces":false,
 "monitors":[{"index":0,"x":0,"y":0,"width":1280,"height":800,"scale":1,"is_primary":true,"is_builtin":null}]}
{"event":"display-config","t":63432843,"serial":2,
 "monitors":[{"connector":"Meta-0","vendor":"MetaVendor","product":"MetaVirtualMonitor","serial":"0x00"}]}
```

Two cautions that come with reading this:

* **A green run says nothing about the nested Shell.** `continue-on-error: true` makes the run — and
  the smoke job's own API conclusion — report `success` whatever the verdict step did. Only the
  printed `VERDICT:` line and the `nested-shell-log` artifact carry the answer. That is why the
  question could sit open for three weeks with the answer already in the logs.
* **The runner is not GPU-less, contrary to the job's own comment.** `ls -l /dev/dri` prints
  `crw-rw---- 1 root video 226, 1 … card1` on all four runs checked (2026-08-06, both 2026-08-09 runs,
  2026-08-28) and again on 2026-09-28. So the verdict is "a nested Shell boots on `ubuntu-latest`",
  *not* "Mutter falls back to software rendering successfully" — the local attempts to approximate a
  GPU-less runner were chasing a condition that does not hold there. The comment above the job in the
  workflow still asserts it does; correcting that comment is code, not this entry.

## What is built but not verified

Stated plainly, because "done" should not imply more than was actually checked:

* **The browser extension has never run in a real browser.** Every byte of the protocol is tested —
  including against the real native-messaging host — but Firefox and Chrome are snap-confined on this
  machine and cannot be launched into the nested session at all. Someone with a normal browser install
  should load `browser/` and confirm.
* **Nobody has installed this into a real session.** `make install` plus a log out and back in needs
  the machine's owner; Wayland cannot reload the Shell in place. Everything here was exercised in a
  nested session instead.
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
