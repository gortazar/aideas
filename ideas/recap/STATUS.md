status: in_progress
started_at: 2026-08-09
last_session_id:
last_run: 2026-08-09

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

### 2026-08-09
M0 format spike done against the real stores on this machine (Claude Code JSONL,
opencode 1.18.14 — which is SQLite now, not the old `storage/` JSON tree). Findings in
`docs/session-formats.md`. M1 skeleton committed: flake, Go module, `recap` binary.

Language choice: the `PLAN.md` answer to "what language and runtime" is "English", which
answers a different question than the one asked, so this was decided rather than re-asked
(re-asking would block the idea for a whole cycle over a stack choice). **Go**, standard
library only for now: a single static binary with a sub-100 ms start, which the sub-300 ms
target needs, and trivially callable from GJS for the future `recap-gs`. Say so if you
wanted Rust and it will be swapped while the code is still small.

## Units
- [x] M0 — format spike: `docs/session-formats.md` describing both on-disk formats, the
      records recap keys on, and what invalidates the status rules
- [x] M1 — skeleton: flake (dev shell, `nix build`, `nix flake check` running `go test` +
      gofmt), Go module, `recap` binary that exits 0, CI wired to the real test command
- [ ] M2a — Claude Code reader: tail-read a session JSONL into a domain Session
- [ ] M2b — status classification rules over fixtures
- [ ] M2c — recap sentence assembly
- [ ] M3 — liveness detection behind a seam
- [ ] M4 — rendering: icons, one line per project, `--no-icons`, `--legend`, sorting, filters
- [ ] M5 — opencode reader
- [ ] M6 — `--json`, `-v`, caching, config file, README screenshot

Difficulty estimate: medium — unchanged. The formats turned out to be readable and both
carry more structure than feared (opencode in particular has `title`, `agent`, `model` and
a todo list as columns), so the risk is concentrated in the status rules and liveness.

Next: M2a — a Claude Code reader that tail-reads one session's JSONL into a domain Session,
against a committed scrubbed fixture.
