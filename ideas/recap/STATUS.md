status: not_started
version: 0.3
started_at: 2026-08-09
last_session_id: fa22503c-6cd0-436e-b54f-1a557e15f321
last_run: 2026-08-13T23:28:10+02:00
last_cycle_cost_usd: 24.105846499999995

## Log
- 2026-08-13T23:28:10+02:00 — done ($24.105846499999995)
- 2026-08-13T20:00:38+02:00 — done ($14.869310999999998)
- 2026-08-11T18:50:50+02:00 — in_progress ($11.018076)
- 2026-08-11T15:05:29+02:00 — in_progress ($0.0)
- 2026-08-10T15:19:10+02:00 — in_progress ($0.0)
- 2026-08-10T00:38:35+02:00 — done ($7.578085)
- 2026-08-09T18:54:00+02:00 — in_progress ($9.104486499999998)
- 2026-08-09T18:00:54+02:00 — in_progress ($9.662947499999998)

## Units — 0.3 (a paragraph of what each session did)
- [x] U0 — restore the submodule pin: a merge had left the `upstream/` gitlink at a
      pre-release commit while `flake.lock` pointed at the released one. check-pin.sh
      catches exactly this, and now passes again.
- [x] U1 — `session.Activity` and `session.Report`: the paragraph, table-tested, with a
      test that it never claims a result the transcript cannot show
- [x] U2 — Claude reader fills Activity: tool counts, files by frequency, turns, errors,
      requests, first/last seen; capped at 10 files and the last 5 requests
- [x] U3 — windowed backwards read with a **1 MiB** cap (4 MiB measured at 0.93s for
      `--all`; 1 MiB costs nothing on the default window), Truncated flag, and a generated
      8 MiB transcript asserting the cap bites and the status is window-independent.
      290ms cold / 11ms warm on this machine, against 156ms before this entry
- [x] U4 — rendering: indented under the line it belongs to, wrapped to the terminal (80
      when not a terminal), blank line after, `--report`/`--no-report` and the `report`
      config key. Paragraphs are on by default, per the answered question
- [x] U5 — opencode reader fills Activity from its parts, with the part cap raised from
      40 to 400 so a window has something to count
- [x] U6 — `--json` carries `report` and an `activity` object, schema version deliberately
      still 1, with a test walking every field a version-1 consumer reads
- [x] U7 — `--smart` rewrites sentence and paragraph in one call; the reply is now an
      array of {sentence, report} objects and the parser is strict about it
- [x] U8 — cache version 2, with a test using a literal 0.2-shaped entry; verified against
      a real 64-entry version-1 cache on this machine
- [x] U9 — README, regenerated screenshot, version 0.3, released as v0.3 and verified from
      a clean directory

**v0.3 is published**: https://github.com/gortazar/recap/releases/tag/v0.3. The release
workflow ran green including the smoke job on ubuntu and macOS, and the published one-liner
was then run here from a clean directory: it installed 0.3 and printed paragraphs against
the real store.

What the paragraph looks like in practice, from this machine:

    🟡 aideas (Claude Code) -> Asked to "Done, run another cycle" — answered, waiting for you.
        Over 4h: 5 requests, ending "Done, run another cycle". 37 tool calls —
        mostly Bash (22), Edit (11), Monitor (3) — touching AGENTS.md,
        orchestrator.py and 1 other file. 1 turn ended in an error. Waiting since
        20:56.

Two decisions worth recording:

- **The cap is 1 MiB, not the 4 MiB the plan named.** Measured across 25 projects, 4 MiB cost
  nothing on the default 24h window — most sessions are covered long before any cap — but
  made `--all` take 0.93s where 1 MiB takes 0.31s. The plan explicitly allowed bringing it
  down if it had to come down.
- **Speed: 290ms cold, 11ms warm**, against 156ms cold before this entry. Reading a day
  instead of a tail is what the difference buys; parsing each record's blocks once rather
  than twice clawed back about 20ms of it. `--all` is 310ms.





## Units — 0.2 (install it without a Go toolchain)
- [x] U1 — repo split: recap's source is now its own repository, gortazar/recap, seeded
      with a fresh initial commit and tracked here as the `upstream/` submodule. The idea
      keeps PLAN/STATUS, a wrapper flake that builds and tests the pinned commit, and
      scripts/check-pin.sh so the submodule gitlink and the flake input cannot drift.
      ci-recap.yml checks out submodules and runs both.
- [x] U2 — `recap --version`: `recap 0.2 (commit 66aac02, built 2026-08-13T17:50:06Z)`,
      dev/unknown when nobody stamped it; both flakes and the release build stamp it
- [x] U3 — tools/release-build.sh: four static tarballs plus SHA256SUMS, byte-identical
      across two runs of the same commit, with a test that asserts exactly that
- [x] U4 — install.sh with RECAP_BASE_URL/RECAP_API_URL seams, and a 23-assertion
      tools/install_test.sh driving it against a fake release with no network
- [x] U5 — release workflow in gortazar/recap: version guard (its own tested script),
      build, gh release create, workflow_dispatch dry run, contents:write and nothing else
- [x] U6 — post-publish smoke job: installs the published one-liner on ubuntu-latest and
      macos-latest and asserts the version. Both passed on the real release
- [x] U7 — README: the one-liner first, the read-it-first variant beside it, what the
      checksum does and does not prove, platform table, uninstall, the release recipe
- [x] U8 — version 0.2, released as v0.2 and verified from a clean directory

**v0.2 is published**: https://github.com/gortazar/recap/releases/tag/v0.2 — four platform
tarballs plus SHA256SUMS. The release workflow ran green, including the smoke job that
installs the published one-liner on ubuntu and macOS, so the darwin cross-build is known to
*run*, not merely known to build. The one-liner was then run here from a clean directory
with a fresh HOME: it resolved the latest release, verified the checksum, installed, and the
binary reported `recap 0.2 (commit 66aac02, built 2026-08-13T17:50:06Z)`.

One repository setting had to change for any of that to work, and it is worth knowing about:
`gortazar/recap` had its Actions token set to read-only, which would have failed
`gh release create` with a 403. It is now **read and write** — the setting recap's README
names as the first thing to check when a release job fails.

Deviations from PLAN.md, forced by its own answered question: the plan's Context assumes
this stays in the monorepo, so it namespaces tags `recap-v<version>` and filters every
"latest release" lookup on that prefix. The answer chose a separate repo instead, where tags
are plain `v<version>` and `/releases/latest` means what it says.

Two smaller consequences of the same choice:

- The version guard checks the tag against `flake.nix` only. `STATUS.md` lives in *this*
  repository, which a workflow over there cannot see; `scripts/check-pin.sh` is what keeps
  the two repositories honest with each other.
- `go install github.com/gortazar/recap/cmd/recap@latest` now works, because the module path
  and the repository finally agree. The plan listed that as impossible, which it was under
  the monorepo.

The plan also assumed the agent could not cut a release, and asked only that the path be
verifiable without one. The answered question granted push access to `gortazar/recap`, so
the release was cut and verified for real instead.

Cost of the two lost sessions, recorded so it is not repeated: a submodule checkout is a
detached HEAD with a stale local `main`, so `git push origin main` from inside it is a
silent no-op that exits 0. U3–U5 were written, "pushed", and destroyed by the end-of-cycle
sweep twice before this was spotted. Work in `upstream/` is only safe once
`git ls-remote origin main` shows it.





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

Difficulty estimate: medium — as planned. The rendering half really was small; the reading
half was where the work and the measuring went.

Difficulty estimate (0.1, kept for the record): medium — unchanged. The formats turned out to be readable and both
carry more structure than feared (opencode in particular has `title`, `agent`, `model` and
a todo list as columns), so the risk is concentrated in the status rules and liveness.

Next: nothing — the plan is delivered. If the idea is reopened: try `--smart` against the
real API once a key is available, record a `TodoWrite` fixture if a session ever produces
one, and add a third agent (which should be a new reader and nothing else).
