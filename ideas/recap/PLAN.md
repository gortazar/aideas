# Plan: recap — a paragraph of what each session did

Difficulty estimate: medium — the rendering half really is a minor change, but nothing in recap reads
more than the last 512 KiB of a transcript today, and "what was done in the last 24 hours" needs a
whole window of one, which means new reading, a new cache key and a perf budget to defend.

## Context

recap prints one line per project, and with `-v` one line per session under it. Every line is a
*status*: what the agent was asked, and where it stopped. Nothing says what actually happened while
you were away. This entry adds that: under each session line, an indented paragraph describing the
session's work over the report window.

Four facts about the existing code shape the work:

1. **The readers deliberately read only the ends of a transcript.** `internal/claude` takes the first
   64 KiB and the last 512 KiB (`headBytes`/`tailBytes`) because transcripts reach tens of megabytes
   and a status only needs the tail; `internal/opencode` takes the last `tailParts` parts, newest
   first. A busy 24 hours easily exceeds both. Widening the window is the substance of this entry, and
   it is the only part that can make recap slow.
2. **`--json` is a public interface with a consumer.** `render.SchemaVersion` is 1, and `recap-gs`
   checks it and refuses a version it does not know. So the paragraph is added as an *optional* field
   and the version stays at 1 — see the assumption below.
3. **The cache keys on size + mtime and is versioned.** `internal/cache` stores the whole parsed
   `session.Session`. Once a reader extracts more, entries written by 0.2 must be ignored, so
   `cache.version` goes to 2. Without that, an upgraded recap prints no paragraphs for every session
   it has already seen — and the tests would not catch it, because they build fresh caches.
4. **`--smart` already exists and is already opt-in.** One Messages API call, a declared and
   test-pinned list of short facts, and any failure falls back to the heuristic text. The paragraph
   follows exactly that rule rather than inventing a second network path.

Assumptions, stated rather than asked:

- **"Each claude session" means each agent session**, opencode included. recap's whole design is
  agent-independent — a reader produces a `session.Session` and nothing downstream knows the format —
  and shipping a paragraph for one agent only would be the first exception to that. opencode gets the
  same paragraph from its `part`/`message` rows.
- **The window is the report window, not a hardcoded 24h.** `--since` already defaults to 24h, so the
  idea's "last 24 hours" is the default behaviour; `--since 2d` widens the paragraph with the report,
  and `--all` means the whole session. One window for the whole command is easier to explain than a
  report window plus a separate paragraph window.
- **The paragraph is heuristic and offline by default**, and rewritten by the model when `--smart` is
  given. recap works with no key and no network today; that does not change for a minor entry.
- **`--json` stays at schema version 1.** The new field is optional and `omitempty`, so every existing
  consumer keeps parsing exactly what it parsed before. A bump to 2 would make `recap-gs` — the only
  known consumer, which the last entry shipped — report an incompatible recap, in exchange for
  nothing. The rule is written down in the README instead: the version bumps when a field is removed,
  renamed or changes meaning, never when an optional one is added.
- The paragraph is prose about *observable* work: requests, tools, files, duration, how it ended. It
  never claims a result recap cannot see. "Ran the test suite" is not something a transcript proves;
  "ran `go test` eleven times" is.

## Features

- **An activity window in the domain model** — `session.Activity`, filled by both readers, holding
  what happened between `window start` and `LastActivity`: the requests the user made (clipped), a
  count per tool, the files touched most often, the number of assistant turns, how many turns ended
  in an error, the first and last timestamps actually seen, and a `Truncated` flag with the timestamp
  coverage really begins at. Every field is best-effort like the rest of `session.Session`: a reader
  that cannot fill it leaves it zero and the paragraph degrades to what is known.
- **A widened, bounded transcript read** — `internal/claude` reads backwards from the end of the file
  in chunks until it has covered the requested window or hit a hard cap (4 MiB), instead of one fixed
  512 KiB tail. The cap is what keeps a pathological transcript from turning a 150 ms command into a
  slow one; when it bites, `Truncated` is set and the paragraph says "since 06:10" rather than
  pretending it saw the whole day. `internal/opencode` gets the equivalent: parts filtered by
  `time_created` over the window, with a `LIMIT` as the same kind of cap.
- **The paragraph itself** (`session.Report`) — a pure function from `Activity` plus the session's
  status to two or three sentences, table-tested like `session.Sentence`. Shape: what it was working
  on, what it did, how it ended. For example:

      Over 7h: 4 requests, ending "make the release workflow verify the checksum". 118 tool
      calls — mostly Bash (61), Edit (28), Read (21) — touching release-build.sh, install.sh
      and 6 other files. 2 turns ended in an error. Idle since 20:41.

  Sessions with nothing in the window get one honest short sentence ("Nothing in the last 24h; last
  active 3d ago."), never an empty block or a fabricated summary.
- **Indented rendering under each session** — the paragraph is printed under its session line,
  indented one level deeper than the line it belongs to (session lines are indented 4, so the
  paragraph is 8) and wrapped to the terminal width, or 80 when stdout is not a terminal, so a
  redirect produces a stable file and CI output does not depend on the runner's `COLUMNS`. A blank
  line after each paragraph, because several 3-line paragraphs stacked without one are unreadable.
- **A flag to control it** — `--report` shows paragraphs; `--no-report` hides them. Which one is the
  default is the open question below, and it is a one-line change either way, so the flag pair, its
  config-file key (`report = true|false`, flags winning as everything else does) and both tests are
  written regardless.
- **`--json` carries the same paragraph** — a `report` string on each session object, plus an
  `activity` object with the counts the paragraph was built from (`tool_counts`, `files`,
  `requests`, `turns`, `errors`, `window_start`, `truncated`) so `recap-gs` and anything else can
  render its own version rather than re-parsing prose. Both `omitempty`; schema version unchanged;
  the guarantee spelled out in the README.
- **`--smart` rewrites the paragraphs too** — the existing single call is extended to return a
  sentence *and* a paragraph per project, from facts that gain the activity counts. Same rules as
  today: an explicit fact list pinned by a test, nothing from tool output or file contents, and any
  failure keeps the heuristic text with a word on stderr. Only the lead session's paragraph is
  rewritten, matching what `--smart` already does for sentences — a model call per session would turn
  one request into twenty.
- **A performance test that fails loudly** — a generated 8 MiB transcript with 24 hours of records,
  asserting the read stays under the cap and the whole run under a stated bound. recap's identity is
  "an answer now"; the 156 ms cold / 11 ms warm figures in `STATUS.md` are the thing this entry is
  most likely to ruin, so they get an assertion rather than a hope. `STATUS.md` records the new
  numbers against this machine's real store.
- **Cache correctness across the upgrade** — `cache.version` 2, with a test that an entry written in
  the version-1 shape is ignored rather than believed.
- **README and screenshot** — the paragraph in the usage section with a real example, the flag and its
  config key, what the paragraph does and does not claim, what `--smart` changes, and a refreshed
  `screenshots/recap.svg` (generated by `tools/screenshot.sh` from a made-up store) showing the
  indented form.

## Approach

Units, each one commit, tests first:

1. **U1 — `session.Activity`** and `session.Report`: the type, the paragraph function and its table
   tests, against hand-built `Activity` values. No reader changes yet, so the paragraph's wording is
   settled before anything expensive is built to feed it.
2. **U2 — Claude reader fills `Activity`**, still within the current 512 KiB tail, against the
   existing fixtures plus one new fixture with a day's worth of turns.
3. **U3 — windowed backwards read** in the Claude reader, with the 4 MiB cap and the `Truncated`
   flag, plus the generated-large-transcript test from the Features section.
4. **U4 — rendering**: indentation, wrapping, the blank line, `--report`/`--no-report` and the config
   key. This is the point where the output changes for a user.
5. **U5 — opencode reader fills `Activity`** over the same window, against the scrubbed dump plus
   hand-written rows.
6. **U6 — `--json`**: `report` and `activity`, schema version deliberately unchanged, with a test
   asserting a version-1 consumer's fields are all still present and unchanged.
7. **U7 — `--smart` paragraphs**, against the httptest stand-in (no key on this machine, as in 0.1).
8. **U8 — cache version 2** and the stale-entry test. Deliberately late: it is the unit that makes the
   upgrade correct, and doing it last means every earlier unit was exercised against a cold cache.
9. **U9 — README, screenshot, `version: 0.3`, `status: done`**, then tag `v0.3` in `gortazar/recap`,
   let the release workflow publish, and verify the published one-liner from a clean directory the way
   0.2 was verified.

## Risks / things to verify early

- **This is where recap gets slow.** Reading a day instead of a tail multiplies the work per session by
  the number of transcripts, and there are 25 projects on this machine. Measure in U3, not in U9, and
  if the cap has to come down, bring it down.
- **`--since 30d` is a legitimate request and a very expensive one.** The cap must bound the read even
  when the window does not. Verify `--all` on the real store before believing it.
- **A paragraph per session multiplies the output.** `recap -v` on 25 projects is already 60 lines;
  paragraphs could make it 200. This is exactly why the default matters — see the open question — and
  why the wrapping and the blank line are in the plan rather than left to taste.
- **The 512 KiB tail is load-bearing for the status rules.** The pending-tool bookkeeping walks every
  record it reads; widening the window must not change any existing status. The existing reader and
  status tests are the guard, and they must stay green untouched — if one needs editing, that is a
  regression, not a test that needs updating.
- **Cache size.** Storing per-session activity grows `~/.cache/recap/sessions.json` by a few hundred
  bytes per session. Fine at this scale, but keep the file counts bounded — cap the files list at ten
  and the requests at the last five, in the reader, not in the renderer.
- **Wrapping and emoji.** Terminal width detection must not break `--no-icons` alignment or piped
  output; when stdout is not a terminal the width is fixed at 80 and the tests rely on that.
- **`--smart`'s prompt now asks for two things per project.** The response parser is strict about
  shape (an array of strings, same length, same order); returning objects instead is a real change to
  `parseSentences` and needs its own tests for a malformed reply, not just a happy path.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Should the paragraph show by default, or only when asked for? The idea says "below each claude
      session", and per-session lines only exist under `-v` today — so the narrow reading is "`recap -v`
      grows a paragraph under each session line, plain `recap` is untouched". The broad reading is that
      plain `recap` should print the paragraph too, which would change the default output from ~25 lines
      to ~100 and make the windowed read happen on every run, including the runs where you only wanted
      the status. Three options, and the plan is written so that only the default differs:
      **(a)** paragraphs under `-v` only, plain `recap` unchanged — safest, and `--report` turns them on
      without `-v`;
      **(b)** paragraphs always, `--no-report` to suppress;
      **(c)** paragraphs by default for sessions active *within* the window and `-v` for the rest.
      Ticking this line as-is chooses **(a)**.
