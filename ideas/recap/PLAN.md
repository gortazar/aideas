# Plan: recap — widen the window until there is something to say

Difficulty estimate: medium — the escalation itself is a loop over a handful of candidate windows, but it
changes the shape of the default output, adds a field to a public JSON schema, and has to interact
correctly with the windowed transcript read and the other filters.

## Context

recap's default window is 24 hours (`internal/cli`, `--since` default `24h`, since 0.4 parsed by the
`s`/`m`/`h`/`d`/`w` grammar). If nothing was touched in that window the whole report is one line on
stderr — `recap: nothing to report` — and the user's next move is always the same: run it again with
`--since 3d`. The idea is to have recap do that itself: try 1d, then 2d, then 3d, and so on until the
report has something in it, and say in the output which window the report is actually for.

What already exists and can be built on:

- `report.FilterSessions` applies the window in memory over the sessions discovered by
  `claude.Discover` / `opencode.Discover` (`internal/report/filter.go`), so *re-filtering* at a wider
  window costs nothing — no re-read, no re-parse.
- Since 0.3 the same `--since` value also bounds **how much of each transcript is read** for the
  paragraph, so the window is not purely a filter: reading is window-dependent. 0.4 measured this on
  this machine's real store (25 projects): `24h` 293 ms, `7d` 305 ms, `30d` 318 ms, `--all` 324 ms,
  warm 12 ms. **A wide window costs ~25 ms, not a multiple**, because the 1 MiB per-session cap bounds
  each read whatever the window asks for.
- `render.Text` prints project lines and nothing else; there is no header, no footer, and the empty
  case goes to stderr with exit 0. `--json` prints a `Document` with `version`, `generated_at`,
  `liveness` and `projects` (`internal/render/json.go`), schema version 1, which the recap-gs
  extension reads.

That measurement decides the design: **read once at the widest candidate window, then escalate the
filter in memory.** No re-reading, no second discovery pass, one code path whether or not the window
widens, and the paragraphs are computed against the window the report ends up being for rather than
against 1d. The price is ~25 ms on every default run, which is inside the noise of the 293 ms cold run
and free on the 12 ms warm one — and it is a price paid only when `--since` is left at its default.

Assumptions, stated rather than asked:

- **Escalation happens only when the user did not choose a window.** An explicit `--since 6h` means
  six hours; if that is empty, the answer is "nothing in six hours", not a report about last Tuesday.
  `--all` is unaffected. Whether a `since` key in the config file counts as "the user chose" is an open
  question below.
- **The steps are whole days: 1d, 2d, 3d, … up to 30d.** The idea says "2d, then 3d, and so on"; a cap
  is still needed or an empty machine walks to the beginning of time and reports a session from March
  as if it were news. 30d is where `--all` becomes the honest answer, and 0.4 measured 30d as safe.
- **Nothing about the existing forms or defaults changes in meaning.** `--since 24h` is still 24 hours;
  the default is still one day. The only cosmetic change is spelling the default `1d` instead of `24h`
  so that the value printed in the output matches the value a user would type back in.
- **Escalation is about emptiness, not about a good report.** One project in 1d is a result; recap does
  not widen to find a *better* line.

One thing to check before anything else: the `upstream/` checkout in this idea directory is **older
than the released 0.3** — `internal/cli` still has the `not a duration` error and no duration grammar,
`internal/render` has no paragraph, `render.Document` has no `report`/`activity`. The 0.4 gitlink was
already restored twice for exactly this reason (see STATUS U0 for 0.3 and 0.4). Run
`git submodule update --init` and `scripts/check-pin.sh` first, and plan against what is pinned.

## Features

- **A window that widens itself.** With `--since` left at its default, recap tries 1d, 2d, 3d, … 30d
  and stops at the first window that yields a non-empty report. The candidate list is a pure function
  of the sessions' `LastActivity` and the clock, table-testable without touching a store.
- **The window is always named in the output.** The text report gains one leading line saying which
  window it is for, in the same grammar `--since` accepts, so it can be copied back into the flag:
  `last 1d` when nothing widened, and `last 3d (nothing in the last 1d)` when it did. Project lines
  below are unchanged, so the "one line per project" shape survives.
- **An honest empty case.** When even 30d is empty, stderr says `nothing to report in the last 30d —
  try --all`, exit 0 as today. The message names the widest window actually tried, not the default.
- **`--json` carries the window.** A `window` object — `{"since": "3d", "seconds": 259200, "default":
  true, "widened_from": "1d"}` — alongside `liveness`. Additive, so **schema version stays 1**, exactly
  as 0.3 did when it added `report` and `activity`; a version-1 consumer that ignores the field still
  reads the same document. recap-gs can now show "nothing today, here is the last three days".
- **Escalation respects the other filters.** `--agent`, `--project`, `--root`, `--running` and the
  config `ignore` list are applied at each candidate window, and "empty" means the report the user
  would have seen is empty — so `recap --project foo` widens until *foo* appears rather than until
  something unrelated does. `--running`, which can be legitimately empty at every window, ends at the
  30d message.
- **The read is done once, at the widest candidate.** Discovery and the transcript reads use the cap
  window; only the filter escalates. Timed against the real store and recorded in `STATUS.md` beside
  0.4's numbers: the default run must stay within a few tens of milliseconds of 293 ms cold, and warm
  must stay ~12 ms.
- **Docs that describe the behaviour where a user meets it.** README: a paragraph in the Durations /
  `--since` section on widening, the cap, and how to turn it off (`--since 1d` explicitly, or `--all`);
  the flag help string for `--since` says it widens when empty; the config section says the same about
  `since`; usage block shows the widened first line.
- **Tests that pin all of it.** Table test over the escalation (sessions at 6h / 3d / 40d → chosen
  window and the "widened from" value); cli tests that a fixture whose only session is 3 days old
  produces a report headed `last 3d (nothing in the last 1d)`, that `--since 6h` on the same tree
  reports nothing and does *not* widen, that `--all` is untouched, that a store with a 40-day-old
  session gives the 30d message and exit 0, and a `--json` test walking the `window` object plus one
  asserting `version` is still 1.

## Approach

Units, each one commit, tests first:

1. **U0 — restore the pin**: `git submodule update --init`, `scripts/check-pin.sh`, confirm the gitlink
   is the released v0.4 commit and `flake.lock` agrees. Nothing else starts until this passes.
2. **U1 — the escalation, as a pure function**: candidate windows, "first non-empty wins", the 30d cap,
   returning the chosen window and whether (and from what) it widened. Lives next to `FilterSessions`
   in `internal/report`, since that is what it drives, with its table test.
3. **U2 — wire it into `cli`**: only when `--since` was not set (and per the answered question, only
   when the config key did not set it either); discovery and reads at the cap window; the chosen window
   into `Filters.Since`. This is where the "read once, filter many" decision lands, so it gets the
   cli-level tests for widening, for the explicit-window case, and for `--all`.
4. **U3 — the output**: the leading line in `render.Text`, the 30d stderr message, and the `window`
   object in `render.JSON` with the schema-version test.
5. **U4 — measure and record**: default cold/warm and `--since 7d`/`--all` against this machine's real
   store, next to 0.4's table in `STATUS.md`. If the default run has become materially slower, the
   fallback is a narrower read window with a re-read only on widening — decided by the numbers, not
   now.
6. **U5 — docs and release**: README, `--help`, config section; `version: 0.5` in `flake.nix` and
   upstream's; tag `v0.5` in `gortazar/recap` (the release workflow tags itself — the orchestrator's
   push carries no tag); let it publish; verify the published one-liner from a clean directory with a
   default run, a widened run and `--json`; then move the gitlink and `flake.lock` here together.

## Risks / things to verify early

- **The leading line changes the default output for everyone**, including anything parsing recap's
  stdout line-per-project. It is one line and it is the point of the idea, but it belongs in the
  release notes, and it is the reason the line is *first* and prefix-free rather than interleaved.
- **A wide read at the cap could cost more than 0.4 measured**, if the pinned reader's window handling
  differs from what STATUS records. Time it in U2, not in U5; the fallback (read narrow, re-read only
  when widening) is a real design, just a slower and more complicated one.
- **`--running` widening to 30d every time nothing is running** is the case most likely to feel wrong.
  Verify the message reads sensibly there, and check the in-memory escalation over 30 candidates is
  genuinely free (it is 30 passes over a slice of a few dozen sessions).
- **Sessions with a zero `LastActivity`** are kept by `FilterSessions` at any window today; make sure
  they do not make every window "non-empty" and silently disable widening.
- **The cache is keyed on size + mtime, not on the window**, so a warm entry read at 1d must not be
  reused as if it had been read at 30d. Check whether 0.3's cache version 2 records the window; if it
  does not, that is a bug this entry can trip over and must handle.
- **Work in `upstream/` is not saved by the end-of-cycle sweep.** A submodule checkout is a detached
  HEAD, so `git push origin main` from inside it is a silent no-op — 0.2 lost two sessions to this.
  Confirm with `git ls-remote origin main` before calling a unit done.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Does a `since` key in `~/.config/recap/config.toml` count as the user choosing a window (no
      widening), or as choosing a *starting point* to widen from? Ticking this line as-is treats it as
      **an explicit choice: no widening**, on the grounds that someone who wrote it down meant it.
- [ ] Is the widening cap 30d? Ticking this line as-is keeps **30d**, after which stderr says to use
      `--all`. Alternatives are 7d (a week; safer, gives up sooner) or no cap at all.
- [ ] Should the window line be printed on every run, or only when the window widened? The idea says
      "always specifying in the output the value considered", so ticking this line as-is prints it
      **always** — one extra line on every default run, including runs where nothing widened.
