status: in_progress
version: 0.1
started_at: 2026-08-16
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

## Units
<!-- The honest progress report: one line per unit of work, ticked only once it is
     committed with its tests passing. Refresh this at every unit, not at session end.
     Keep "next" to the single unit being started now. -->
- [x] Upstream repository created (`gortazar/restore-wss`), pinned here as the `upstream` submodule
- [x] M0a — `docs/similar-tools.md`: eleven tools read from source, plus `tools/wayland-globals.sh`
      and its committed output proving GNOME 46 here has no session-management Wayland global

Next: M0b — the probe: what a real window and its `/proc` tree expose on this machine, captured as
fixtures.

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
