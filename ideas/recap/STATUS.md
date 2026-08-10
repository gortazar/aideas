status: in_progress
version: 0.1
started_at: 2026-08-09
last_session_id: fa22503c-6cd0-436e-b54f-1a557e15f321
last_run: 2026-08-10T00:38:35+02:00
last_cycle_cost_usd: 7.578085

## Units — 0.2 (install it without a Go toolchain)
- [x] U1 — repo split: recap's source is now its own repository, gortazar/recap, seeded
      with a fresh initial commit and tracked here as the `upstream/` submodule. The idea
      keeps PLAN/STATUS, a wrapper flake that builds and tests the pinned commit, and
      scripts/check-pin.sh so the submodule gitlink and the flake input cannot drift.
      ci-recap.yml checks out submodules and runs both.
- [ ] U2 — `recap --version`, stamped by the flake and the release build
- [ ] U3 — tools/release-build.sh: four static tarballs plus SHA256SUMS, with a test
- [ ] U4 — install.sh with file:// seams, and tools/install_test.sh
- [ ] U5 — release workflow in gortazar/recap: version guard, build, gh release create,
      workflow_dispatch dry run
- [ ] U6 — post-publish install smoke job on ubuntu + macos
- [ ] U7 — README: install, uninstall, platform table, how a release is cut
- [ ] U8 — version 0.2, status done

Deviation from PLAN.md, forced by its own answered question: the plan's Context assumes
this stays in the monorepo, so it namespaces tags `recap-v<version>` and filters every
"latest release" lookup on that prefix. The answer chose a separate repo instead, where
tags are plain `v<version>` and `/releases/latest` means what it says. Everything else in
the plan stands.

## Log
- 2026-08-10T00:38:35+02:00 — done ($7.578085)
- 2026-08-09T18:54:00+02:00 — in_progress ($9.104486499999998)
- 2026-08-09T18:00:54+02:00 — in_progress ($9.662947499999998)




### 2026-08-09 — done
Every feature in `PLAN.md` is built, tested and committed, and `nix flake check` is green:
both readers, the status rules, the sentence (heuristic and `--smart`), liveness, the text
and `--json` renderers, all the filters, the config file, the cache, the README and the
screenshot. Verified end to end against this machine's real stores — 25 projects, 156 ms
cold, 11 ms warm.

Two things "done" does *not* cover, both because this machine could not produce them:
- `--smart` has never made a live API call; there is no `ANTHROPIC_API_KEY` here, so it is
  tested against an httptest stand-in for the Messages API.
- No Claude Code session on this machine has ever used `TodoWrite`, so there is no recorded
  fixture for the "3 of 7 done" marker on that side. opencode's `todo` table is covered.

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
- [x] M6d — README: install, usage, every flag, the icon vocabulary with the rule behind
      each, the config file, the versioned JSON schema with its guarantees, and a
      screenshot generated from a made-up store by tools/screenshot.sh
- [x] M7 — `--smart`: one Messages API call rewrites every project's sentence, sending
      only a declared list of short facts (pinned by a test); any failure falls back to the
      plain sentences with a word on stderr. Exercised against an httptest server — there
      was no ANTHROPIC_API_KEY on this machine to try the live path

Difficulty estimate: medium — unchanged. The formats turned out to be readable and both
carry more structure than feared (opencode in particular has `title`, `agent`, `model` and
a todo list as columns), so the risk is concentrated in the status rules and liveness.

Next: nothing — the plan is delivered. If the idea is reopened: try `--smart` against the
real API once a key is available, record a `TodoWrite` fixture if a session ever produces
one, and add a third agent (which should be a new reader and nothing else).
