status: done
version: 0.2
started_at: 2026-08-05T13:26:54+02:00
last_session_id: c3d5db78-bba1-4d98-a6d7-bab417992f88
last_run: 2026-09-28T18:48:58+02:00
last_cycle_cost_usd: 3.0325110000000004

## Log
- 2026-09-28T18:48:58+02:00 — done ($3.0325110000000004)
- 2026-08-09T13:03:02+02:00 — done ($13.001496000000001)
- 2026-08-08T16:56:24+02:00 — in_progress ($21.542557000000002)
- 2026-08-07T21:32:12+02:00 — in_progress ($20.986539999999994)
- 2026-08-07T11:29:05+02:00 — in_progress ($19.358296000000006)
- 2026-08-06T17:46:26+02:00 — in_progress ($26.866495500000003)
- 2026-08-06T14:10:11+02:00 — in_progress ($12.033532499999998)
- 2026-08-06T01:22:09+02:00 — in_progress ($10.616743999999999)
- 2026-08-05T13:26:54+02:00 — in_progress ($13.361972999999997)


## 0.2 — what this entry changed

**No code.** 0.2 corrected the record. `STATUS.md` claimed this checkout's `origin` was a local bare
repo and that `.github/workflows/ci-gnome-tasks.yml` had never run; both halves were false, and the
sentence was load-bearing — it was the stated reason the nested-Shell runner question was open. The
answer had been sitting in public CI logs since 2026-08-06. This entry went and read it, wrote down
what it says, and audited the rest of the file for the same class of error. What "done" covers for
0.2: the CI section below, the `docs/testing.md` correction, re-attributed test counts, the
no-upstream deviation, and the found-elsewhere table. **No release**, for the reason in
*This idea has no repository of its own*.

The `status:` header read `not_started` while this entry was queued, which was correct — the
orchestrator rewrites it per entry, and it was never a bug in the 0.1 record. It is set to `done`
here because the 0.2 work is finished.

Difficulty estimate for the 0.1 build: **hard**, as its plan said — four programs, a platform that
hides the information the idea needs, and a long tail of per-app work. Every feature in that plan is
built, tested and green. **0.2 was easy**, as its plan said: one file to rewrite, no code, and the
work was reading evidence rather than producing it.

Throughout this file, *the original plan* means [`plans/01-2026-08-28.md`](plans/01-2026-08-28.md),
which is where the twelve features live. `PLAN.md` is whatever entry is currently being worked on and
no longer describes the build.

## What "done" covers

All twelve features in the original plan, each with tests:

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
| Reproducible environment + green CI | `flake.nix`: lint, unit, dbus, bundle — all four green, last measured 2026-09-28 (below) |

**Tests: 151 unit + 56 D-Bus, plus lint and a bundle check, all green under `nix flake check`.**
Re-measured for this entry rather than carried over: CI run **36414701024** (2026-09-28) built the
checks uncached and printed `151 passed, 0 failed, 151 total` for `gnome-tasks-unit` and
`56 passed, 0 failed, 56 total` for `gnome-tasks-dbus`. A local
`git add -A && nix flake check --print-build-logs` in the same session exited 0 over all four checks
(`lint`, `unit`, `dbus`, `bundle`), from cache, so it corroborates green but not the counts. The
counts had not moved since 0.1.

The D-Bus suite runs a real daemon against a fake compositor, a fake systemd and the real
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
`plans/01-2026-08-28.md:204` — *"Can CI run a nested headless Gnome Shell on the available GitHub
runners?"*, which the user answered *"I don't know what github runners can do. You might need to
discover it for yourself."* It has been discoverable in public since **2026-08-06** — the first run
whose SHA carried the smoke job (run **31112654174**, `4970510a`) already printed it. **All ten runs
that carried the job have printed the same line**, checked one by one:

```
VERDICT: a nested headless GNOME Shell runs on this runner.
```

31112654174, 31117350267, 31166187904, 31211906764, 31263208278, 31309991357, 31342738093,
31976842505, 33152614983, 36414701024. The three older runs (`0456387`, `d3b2ec2`) predate the job.
Run 31211906764 is worth noting: it concluded `failure` at the run level — its `test` job broke — and
the smoke job still printed the verdict, which is the same independence that lets a green run hide a
red one.

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
* **The runner has a `/dev/dri`, contrary to the job's own comment — and Mutter goes GPU-less
  anyway.** `ls -l /dev/dri` prints `crw-rw---- 1 root video 226, 1 … card1` on all five runs checked
  (2026-08-06, both 2026-08-09 runs, 2026-08-28, 2026-09-28), so the comment above the job saying "a
  runner has no `/dev/dri`" is wrong. The conclusion it was reaching for holds regardless: the
  `nested-shell-log` artifact from run 36414701024 shows Mutter logging
  `libmutter-Message: Created surfaceless renderer without GPU` and going on to serve the probe. So
  GPU-less operation *is* confirmed — by the headless backend choosing a surfaceless renderer, not by
  the device node being absent. Fixing the stale comment is code, and belongs to another entry.

## What is built but not verified

Stated plainly, because "done" should not imply more than was actually checked:

* **The browser extension has never run in a real browser.** Every byte of the protocol is tested —
  including against the real native-messaging host. It was not tried in a browser because on the
  Ubuntu 24.04 development machine this idea was built on, as of 2026-08-09, Firefox and Chrome were
  snap-confined and could not be launched into the nested session at all. That is an excuse about one
  machine on one day, not a property of the code: the gap is still open wherever you are reading this.
  Someone with an unconfined browser install should load `browser/` and confirm.
* **Nobody has installed this into a real session.** `make install` plus a log out and back in needs
  the machine's owner; Wayland cannot reload the Shell in place. Everything here was exercised in a
  nested session instead. Still true on 2026-09-28.
* **Connector names across a real replug.** Layouts are remapped by connector name and every session
  this has run in has had exactly one virtual monitor — `Meta-0` in CI (run 36414701024), the same
  locally — so the remapping arithmetic is unit-tested but the *stability* of the key across a real
  monitor being unplugged and plugged back in is not. CI cannot close this one: a runner has no
  physical outputs either.

`docs/limitations.md` is the full list, including what cannot work at all (shell state inside a
terminal, unsaved work, documents for apps with no adapter).

## Deliberately not built

* Placing browser windows *after* the browser rebuilds them — the tabs come back, the per-window
  geometry may not (`docs/app-adapters.md`).
* Explicit resource linking, activity templates, per-task wallpaper and favourites: out of scope by
  decision or absent from the original plan.
* Publishing to extensions.gnome.org, which the answered open questions rule out and which is what
  makes the separate daemon possible at all.

## This idea has no repository of its own

AGENTS.md expects every idea to live in `github.com/<owner>/<slug>`, included here as a submodule at
`ideas/<idea>/upstream`, with its own CI, releases and Sonar project. **gnome-tasks does not.** Its
source, tests, workflow and docs are all directly in `gortazar/aideas`, there is no `upstream/`
submodule, `.github/workflows/ci-gnome-tasks.yml` in this repository *is* its CI, and its Sonar
coverage is the whole-repo `gortazar_aideas` project — which is the badge `README.md` line 3 already
points at.

Nothing in the original entry authorised that arrangement; it is recorded here because it is a real
deviation, not because it has been decided either way. Two consequences worth knowing:

* **No releases.** 0.1 shipped none and 0.2 ships none, because the tag would have to go on a
  repository this idea does not own. That was the answered open question for this entry, taken as the
  default: no release, reason recorded, and no release workflow added to `gortazar/aideas`.
* **Moving it is not this entry's decision.** Creating `gortazar/gnome-tasks` and migrating the
  history is a substantial piece of work that the 0.2 entry explicitly ruled out of scope.

## The same false sentence elsewhere

The reported error was one instance of a pattern from the same era — a sandbox clone described as
though it were the repository. Where else it was found, and what was done:

| Where | State |
| --- | --- |
| `ideas/gnome-tasks/STATUS.md:74` (as reported) | **fixed** in this entry |
| `ideas/gnome-tasks/docs/testing.md:27` — "On GitHub runners: not yet known" | **fixed** in this entry; it was the same claim one file over, and leaving it would have contradicted the correction above |
| `ideas/pwgen/STATUS.md:107-108` | **already fixed** under pwgen's own entry, which now quotes the old sentence as something it corrected. Nothing outstanding, and out of bounds for this entry regardless |
| `ideas/gnome-tasks/PLAN.md:11-12`, `CLAUDE.md:363-364` | **left alone**: these *quote* the false sentence in order to describe the correction. `CLAUDE.md` is regenerated and must not be edited at all |

## Where each claim above comes from

0.2 has no tests to run, so "verified" means every assertion has a source. Anything measured on a
machine on a day is dated; anything unpaired was cut or rewritten as an explicit unknown.

| Claim | Source |
| --- | --- |
| `origin` is `git@github.com:gortazar/aideas.git` | `git remote -v`, 2026-09-28 |
| The workflow has run 13 times; four most recent are `success` | `gh run list --workflow=ci-gnome-tasks.yml --limit 30` |
| Per-job conclusions | `gh run view <id> --json jobs` |
| The `VERDICT:` line, on all ten smoke runs | `gh run view <run> --job <job> --log`, each of the ten ids listed above |
| The smoke job first appears at `4970510` (2026-08-06) | `git show <sha>:.github/workflows/ci-gnome-tasks.yml` over all 13 run SHAs |
| The `probe-enabled` / `display-config` records, connector `Meta-0` | `gh run download 36414701024 -n nested-shell-log` |
| `Created surfaceless renderer without GPU` | the same artifact, `gtn/shell.log` |
| `/dev/dri/card1` exists on the runner | the "Report what we are running on" step, all five runs above |
| 151 unit + 56 D-Bus, 0 failed | CI run 36414701024 build log, 2026-09-28 |
| All four flake checks green | local `git add -A && nix flake check --print-build-logs`, exit 0, 2026-09-28 |
| `pwgen/STATUS.md` is already corrected | read at `ideas/pwgen/STATUS.md:107-108` |
| The question this answers is the plan's last | `plans/01-2026-08-28.md:204`, nine questions at lines 196-204 |

One gap, stated rather than papered over: **the CI run caused by *this* change has not been read**,
because agents do not push this repository — the orchestrator merges and pushes after the session, so
that run did not exist while the file was being written. The freshest run available was 36414701024
on `e1113a8`, the commit immediately before these, and it is the one quoted throughout. Two reasons
that is adequate here, and one caveat:

* The smoke job's input — `tools/nested-shell.sh`, `tools/probe`, the workflow — is untouched by
  0.2, so there is no mechanism by which its verdict could change.
* 0.2 changes only `STATUS.md` and `docs/`, both of which `flake.nix` deliberately excludes from the
  check inputs, so the `test` job on the next run will replay cached results. **A green run on this
  push would not be fresh evidence that the suites pass** — that is what the local `nix flake check`
  is for, and it is the trap that made a green run look like a verdict in the first place.
* The caveat: if a future smoke run ever contradicts the verdict above, this section is wrong and
  should be rewritten from that run, not defended.

Unchanged and *not* re-verified this session, by decision: `make smoke`'s eleven checks and the two
experiments. Those are claims about 2026-08-09 on a development machine and are labelled as such; a
nested-Shell run from this session would have been a long blocking wait and would not have made the
corrected sentence any truer.

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
