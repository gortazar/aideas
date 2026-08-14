# Plan: recap — `--since 6h`, `--since 7d`

Difficulty estimate: easy — the flag, the day unit and the config key all exist and work today; what is
left is a grammar, its error messages, its documentation and its tests, all inside one small function.

## Context

The idea asks for "an option to ask for the sessions in the last n hours or n days: `--since 6h`
`--since 7d`". **Both of those already work.** `internal/cli` declares
`--since` with a default of `24h`, `parseDuration` is `time.ParseDuration` plus a `d` suffix, and
`filters.Since` hides any session whose `LastActivity` is older than the window
(`internal/report/filter.go`). `recap --since 6h` and `recap --since 7d` are exercised by the existing
suite (`cli_test.go` uses `-since 2d` and a config file with `since = "3d"`).

So this entry is not "add the flag". It is: confirm the flag really does what the idea asks for, and
close the gaps that a user typing `--since` actually falls into. Those gaps are real and small:

1. **The grammar is narrower than it looks.** `d` is handled by cutting a trailing `d` and parsing the
   rest as a float, so `7d` and `1.5d` work but `2d12h` does not — it reaches `time.ParseDuration`,
   which rejects the `d`. There is no `w`. `6H` fails where `6h` succeeds, because nothing lowercases
   the input.
2. **The error message says nothing.** Every failure is the string `not a duration`, so
   `recap --since yesterday` prints `recap: --since "yesterday": not a duration` and never says what
   it would have accepted. When the bad value came from the config file, the message still blames
   `--since`, which is not where the user typed it.
3. **`--since 0` is a silent `--all`.** `FilterSessions` only applies the window when `Since > 0`, so a
   zero or negative duration disables it instead of reporting nothing — quiet, surprising, and
   untested.
4. **The documentation names two units and stops.** The README flag table and the flag's own help
   string both say "understands `90m`, `2d`"; neither states the full grammar, and the usage block has
   no `--since` example at all, although "what happened in the last 24 hours" is the first line of it.

Assumptions, stated rather than asked:

- **The window stays relative and stays one window.** `--since` bounds the report, and since 0.3 the
  same value bounds how much of each transcript is read for the paragraph. This entry does not split
  them.
- **`w` is worth having, `mo` and `y` are not.** A week is a normal thing to ask a coding agent report
  for; a month of sessions is what `--all` is for, and "month" would have to pick between 30 days and
  a calendar month.
- **Nothing about the existing accepted forms changes.** `24h`, `90m`, `2d`, `1.5d` mean today exactly
  what they will mean after this entry. This is additive, so no existing test should need editing —
  if one does, that is a regression.

One thing to check before anything else: the `upstream/` checkout in this idea directory looks older
than the released 0.3 — `internal/claude` still reads a fixed 512 KiB tail and has no `Activity`, and
the README has no `--report` row, both of which 0.3 shipped. Run `scripts/check-pin.sh` and read the
gitlink first; plan the perf unit (U4) against what is actually pinned, not against this working tree.

## Features

- **One duration grammar, written down once.** `parseDuration` grows into a small, separately tested
  function that accepts a chain of `<number><unit>` terms — `s`, `m`, `h`, `d`, `w` — with an optional
  fraction, case-insensitively: `90m`, `6h`, `7d`, `2w`, `1.5d`, `2d12h`, `6H`. Days are 24 hours and
  weeks are 7 days, no calendar arithmetic. `time.ParseDuration` still handles what it already handles,
  so nothing that parses today stops parsing.
- **Errors that say what was expected.** `recap: --since "yesterday": expected a duration like 6h, 90m
  or 7d`. A bad value from the config file names the file and the key instead of the flag:
  `recap: ~/.config/recap/config.toml: since "yesterday": expected …`. Both exit 2, as they do now.
- **Zero and negative windows are errors, not silent behaviour.** `--since 0`, `--since -6h`,
  `--since 0h` each fail with `a window must be positive; use --all for no window`. This is the one
  behaviour change in the entry, and the message names the flag that does what the user probably meant.
- **`--since` examples where a user will see them.** The README usage block gains
  `recap --since 6h` and `recap --since 7d` beside the existing lines; the flag table row and the
  `--help` string both list the units rather than sampling two of them; the config-file section says
  `since` takes the same grammar and points at the same list.
- **Tests that pin the grammar.** A table test over accepted forms (input → duration) and rejected ones
  (input → an error message that quotes the input and names a unit), plus end-to-end `cli` tests that
  `--since 6h` hides a session touched 8 hours ago and `--since 7d` brings back one touched 3 days ago,
  against the fixture tree the existing tests already build.
- **The cost of a wide window, measured.** With 0.3's windowed transcript read, `--since` is also a
  performance knob: `--since 7d` reads more of every transcript than `--since 24h` does. Time
  `--since 24h`, `--since 7d`, `--since 30d` and `--all` against this machine's real store, check the
  1 MiB cap still bites and `Truncated` is honest at 30d, and record the four numbers in `STATUS.md`
  next to 0.3's 290 ms cold / 11 ms warm.

## Approach

Units, each one commit, tests first:

1. **U1 — the grammar**: the parser and its table test, in `internal/cli` next to its only caller (it is
   ~30 lines; a package of its own would be ceremony). No CLI behaviour change yet beyond the newly
   accepted forms.
2. **U2 — the messages**: the flag error, the config-file error naming the file and key, and the
   positive-window rule with its `--all` hint. This is where `--since 0` changes meaning, so it gets
   the cli-level tests.
3. **U3 — docs**: README usage lines, flag table, config section, and the `--help` string, all naming
   the same unit list.
4. **U4 — measure and record**: the four timings against the real store, `STATUS.md` updated, and — only
   if the numbers say a wide window is genuinely expensive — a note in the README rather than a new
   knob.
5. **U5 — release**: `version: 0.4` in `flake.nix` and upstream's, tag `v0.4` in `gortazar/recap`, let
   the release workflow publish, verify the published one-liner from a clean directory as 0.2 and 0.3
   were verified, then `scripts/check-pin.sh` and `flake.lock` in this repo.

## Risks / things to verify early

- **The idea may already be delivered.** See the first open question. If the answer is "confirm and
  close", U1–U3 are still worth doing and U5 is not — do not cut a release for a help-string change.
- **`--since 0` changing meaning is a user-visible break**, tiny but real: anyone who wrote
  `since = "0"` in a config file to mean `--all` gets an error instead of a report. That is the right
  trade for a silent surprise, but it belongs in the release notes.
- **Flag syntax for negative values.** `--since -6h` is parsed by `flag` as `--since` with value `-6h`
  only because `-6h` does not look like a flag; the test should also cover `--since=-6h`, which is the
  form that unambiguously reaches the parser.
- **A wide window multiplies the read**, which is exactly the risk 0.3 measured and capped. `--since
  30d` must not become the command that makes recap slow; if it does, the cap comes down before the
  window is widened further.
- **Work in `upstream/` is not saved by the end-of-cycle sweep.** A submodule checkout is a detached
  HEAD, so `git push origin main` from inside it is a silent no-op — 0.2 lost two sessions to this.
  Commit, push, and confirm with `git ls-remote origin main` before the unit is called done, then move
  the gitlink and `flake.lock` in this repository together.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] `--since 6h` and `--since 7d` both work in the shipped recap today. Is the intent (a) confirm
      that and close the idea, doing only the documentation and tests, or (b) the hardening entry this
      plan describes — grammar, error messages, positive-window rule — as 0.4? Ticking this line as-is
      chooses **(b)**.
- [x] Should a bare number be accepted? `--since 6` could mean 6 hours (hours being the unit the idea
      names first) or be an error that tells you to say `6h`. Ticking this line as-is makes it an
      **error**: a bare number is as likely to have meant days.
- [x] Should `--since` also accept an absolute point in time — `--since 09:00`, `--since 2026-08-10`,
      `--since yesterday`? It is a different feature behind the same flag, and `yesterday` is currently
      pinned as an *error* by `TestBadFlagValuesFailWithAMessage`. Ticking this line as-is keeps
      `--since` **relative only**.
