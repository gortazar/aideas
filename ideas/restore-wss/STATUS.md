status: in_progress
version: 0.1
started_at: 2026-08-16
last_session_id: ebf1ecd2-6691-4213-9815-2f9920396ad5
last_run: 2026-08-16T22:39:18+02:00
last_cycle_cost_usd: 20.323337000000002

## Log
- 2026-08-16T22:39:18+02:00 — in_progress ($20.323337000000002)


## Units
- [x] Upstream repository created (`gortazar/restore-wss`), pinned here as the `upstream` submodule
- [x] M0a — `docs/similar-tools.md`: eleven tools read from source, plus `tools/wayland-globals.sh`
      and its committed output proving GNOME 46 here has no session-management Wayland global

- [x] M0b — `docs/platform-findings.md` + `tools/proc-probe.py` + `tools/nested-shell.sh`: the
      terminal question answered against a real `gnome-terminal` (tabs are enumerable from `/proc`;
      the foreground job is the descendant whose pgrp equals the session leader's `tpgid`), with two
      committed process-tree fixtures

- [x] M1 — skeleton: `flake.nix` (unit, D-Bus, ruff and extension-syntax checks), `Makefile`, CI in
      the upstream repo, the `org.gnome.SessionCore` extension and the `org.gnome.RestoreWss`
      daemon, `restore-wss status`
- [x] M2 — capture and crash-safe snapshot: `~/.restore-wss/state/session.json` written temp +
      fsync + rename with a retained previous generation, capture rules tested against fixtures,
      and a D-Bus test proving the daemon writes a change nobody asked it to write

- [x] M3 — restore: the ported window matcher, the restore plan (idempotent, monitor-relative
      geometry, ambiguity refused rather than guessed), the extension's placement and launch
      methods, and `restore-wss restore` with `--dry-run`, `--yes` and `--json`

**Green:** `nix flake check` — 71 unit tests, 9 D-Bus tests on a private bus, ruff, extension
syntax. **`tools/smoke-nested.sh`: all 8 checks pass** against a real headless GNOME Shell 46 with
`gnome-terminal` (run 2026-08-17): the extension answers over D-Bus, the daemon captures a window
move unprompted, and after the application is killed `restore-wss restore` launches it again and
puts it back on the workspace and at the position it was captured on. The application rounded
700x500 down to 694x489 — a terminal snapping to its character grid, which is the "the app's own
size constraints win" finding from M0, observed again.

Next: M5 — terminals: the `/proc` process-tree capture the M0 probe proved possible, redaction of
secret-looking arguments at capture time, and the whitelist command policy.

## Findings that change the plan

- `xx_session_management_v1` has been renamed and promoted: it is `xdg-session-management-v1` in
  wayland-protocols *staging* since 2026-03-23. Mutter has implemented it since the `gnome-47`
  branch (storing state in a GVDB file), KWin since 2026-04. **Not on this machine** — GNOME 46's
  registry advertises no such global (`docs/probe-data/wayland-globals.txt`) — and still opt-in per
  application everywhere, so the introspection design stands; the schema will reserve a field for
  windows that restore themselves.
- The command-replay allow-list is not excessive caution: `i3-restore` and `tmux-resurrect` both
  landed on the same answer, while Another Window Session Manager and `i3-resurrect` replay captured
  command lines through a shell unreviewed.
