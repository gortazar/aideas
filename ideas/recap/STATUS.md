status: in_progress
started_at: 2026-08-09
last_session_id: fa22503c-6cd0-436e-b54f-1a557e15f321
last_run: 2026-08-09T18:54:00+02:00
last_cycle_cost_usd: 9.104486499999998

## Log
- 2026-08-09T18:54:00+02:00 — in_progress ($9.104486499999998)
- 2026-08-09T18:00:54+02:00 — in_progress ($9.662947499999998)



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
- [x] M2a — Claude Code reader: tail-read a session JSONL into a domain Session,
      against six scrubbed fixtures covering the tail shapes seen in the real store
- [x] M2b — status rules: transcript tail + liveness + clock -> one of
      running / waiting / idle / interrupted / finished / unclear, table-tested
- [x] M2c — recap sentence assembly: `Asked to "X" — interrupted mid-Bash.`, pure
      logic over the session fields, table-tested
- [x] M3 — liveness: read the process table, recognise agents by argv[0] (not by a
      substring of the command line, which would count the shells they spawn), correlate
      by working directory; tested against a fake /proc tree
- [x] M4a — discovery: walk a ~/.claude/projects tree and read every session in it,
      surviving unreadable ones
- [x] M4b — grouping into one line per project (busiest session leads) and rendering it:
      icons, `--no-icons` word column, `--legend`, `-v` session lines, human ages
- [x] M4c — CLI wiring and the filter flags: `--since` (default 24h, understands days),
      `--all`, `--agent`, `--project`, `--running`, `--root` (default: your home), plus
      `--legend`, `--no-icons`, `-v`. Runs against the real store in 0.17s
- [x] M5 — opencode reader: the same domain type out of its SQLite store, read-only,
      against a scrubbed dump of the real store plus hand-written rows for the states this
      machine never produced; wired into the CLI alongside Claude Code
- [x] M6a — `--json`: a versioned document (schema version 1) with a project entry per
      line of the text report and a session entry under each, plus a `liveness` field so a
      consumer knows whether an unclear status means 'no process table'
- [x] M6b — config file at ~/.config/recap/config.toml: `since`, `roots`, `ignore`,
      `icons` and an `[icon]` table of per-status glyphs, with flags taking precedence and
      a mistake in the file reported with its line number
- [x] M6c — cache parsed sessions on file size + mtime under ~/.cache/recap, with
      `--no-cache` to bypass it: 156ms cold, 11ms warm on this machine's 25 projects
- [ ] M6d — README with the icon vocabulary, the JSON schema and a screenshot
- [ ] M7 — `--smart`: the same sentence written by a model, for when the heuristic one
      reads too blunt (answered open question in PLAN.md)

Difficulty estimate: medium — unchanged. The formats turned out to be readable and both
carry more structure than feared (opencode in particular has `title`, `agent`, `model` and
a todo list as columns), so the risk is concentrated in the status rules and liveness.

Next: M6d — the README: install, usage, the icon vocabulary, the JSON schema, the config
file, and a screenshot of real output.
