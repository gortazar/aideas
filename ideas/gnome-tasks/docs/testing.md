# What is tested where

Three layers, because window management cannot be tested the way pure logic can.

| Layer | Runs under | Command | In CI? |
| --- | --- | --- | --- |
| Shell-free logic — state model, schema migration, adapter selection, layout matching, monitor remapping | plain `gjs -m` | `make test-unit` | yes, blocking |
| The daemon's D-Bus surface | `dbus-run-session` | `make test-dbus` | yes, blocking (from M1) |
| Window capture and restore | a nested headless `gnome-shell` | `tools/nested-shell.sh` | experimental, non-blocking |
| Lint | `eslint` | `make lint` | yes, blocking |

`nix flake check` runs the blocking set hermetically, and is what
`.github/workflows/ci-gnome-tasks.yml` invokes.

## Can CI run a nested headless GNOME Shell?

This was an open question in `PLAN.md`. What is established so far:

**Locally: yes.** `gnome-shell --headless --virtual-monitor 1280x800 --wayland-display wayland-9`
on a private D-Bus session starts on Ubuntu 24.04 with GNOME Shell 46, loads an extension from an
isolated `XDG_DATA_HOME`, and runs real GTK4 Wayland clients (text editor, calculator, Nautilus,
gnome-terminal) with no physical display attached. `tools/nested-shell.sh` automates exactly that,
and the evidence it produced is in [gnome-internals.md](gnome-internals.md). Mutter logs
`Failed to open gpu '/dev/dri/cardN'` warnings and carries on.

**On GitHub runners: not yet known.** The two things that could break it are software rendering
(no `/dev/dri` at all on a runner, so Mutter must fall back to llvmpipe) and the size of the
`gnome-shell` apt closure. Rather than guess, the CI workflow carries a separate
`nested-shell-smoke` job, marked `continue-on-error`, whose only job is to answer the question in
public: it installs `gnome-shell`, boots the nested session with the probe extension, and asserts
the probe emitted its `probe-enabled` record. The blocking checks never depend on it.

Until that job has run, window capture/restore is verified by hand against a real session, and
what was verified is recorded in `STATUS.md`.

## Running the nested session by hand

```console
$ tools/nested-shell.sh start --extension tools/probe --state /tmp/gtn
$ source /tmp/gtn/env          # now gsettings/gio/gnome-extensions talk to the nested session
$ gio launch /usr/share/applications/org.gnome.Calculator.desktop
$ tools/nested-shell.sh stop --state /tmp/gtn
```

Two rules for anything that drives this harness, both learned by breaking them
(see [gnome-internals.md](gnome-internals.md#the-test-harness-and-four-traps-in-it)):

* Never run `gsettings` against a bus whose daemon did not start with the isolated `XDG_*`
  exported — the write lands in the developer's real dconf database. `nested-shell.sh` now aborts
  if it detects that.
* Launch browsers and Electron apps with `--no-remote` / an isolated user-data-dir, or the launch
  is handed to the instance already running on the developer's own desktop.
