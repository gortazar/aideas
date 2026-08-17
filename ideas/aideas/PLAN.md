# Plan: aideas — a grey bulb, and the questions behind "blocked"

Difficulty estimate: medium — each piece is small, but the change crosses three boundaries at
once (the `/state` contract, the orchestrator that serves it, the extension that renders it) and
it ships the extension's first image asset, whose one hard requirement — that GNOME recolours it
like a stock symbolic icon — can only be confirmed in a real compositor.

## Context

The entry asks for three things, and they are less independent than they look:

1. **The icon must be a bulb 💡, in grey, matching GNOME Shell.** Today `ICONS` in
   `src/lib/indicatorModel.js:26-33` maps the six panel states to six *different* stock
   freedesktop icons — `system-run-symbolic`, `dialog-question-symbolic`,
   `media-playback-pause-symbolic`, and so on — so the button has no identity of its own: it
   looks like a gear, then a question mark, then a pause sign. A bulb is the idea's mark and
   should stay a bulb whatever the state is.
   "In grey colors" is what a **symbolic** icon already gives: GNOME recolours symbolic icons to
   the panel foreground, so the bulb matches the theme, follows light/dark, and dims with the
   rest of the top bar. The thing being ruled out is the coloured emoji. That also means **the
   state cannot be carried by colour** — the shell will paint every variant the same grey — so
   each state has to differ in *shape*.
   This reverses one v0.1 decision, deliberately: the comment above `ICONS` says the extension
   "ships no image assets, so there is nothing to theme wrongly". There is no bulb in the stock
   Adwaita symbolic set, so the bulb has to be shipped. `make build` already copies all of
   `src/extension/.` into the bundle (`Makefile:62`), so an `icons/` folder there travels into
   the zip with no build change.

2. **Show the unanswered questions of each blocked idea.** The extension cannot do this today,
   and not because of the menu: `/state` does not carry the text. A blocked row has
   `open_questions` — a *count* (`docs/state-contract.md:104`, written by
   `orchestrator.py:1441-1447`) — and the menu renders that count, or the note that says the
   same thing, at `menuModel.js:91-97`. The question text exists only in `PLAN.md` on the box, so
   the count has to become the count *and* the text, which is an additive contract change of
   exactly the kind `docs/state-contract.md:148-152` says to expect. `count_open_questions()`
   already knows how to find the lines (`orchestrator.py:392-404`); it has to return them too.
   Note that not every blocked row has questions: `STATUS.md says blocked` is also `blocked`
   (`orchestrator.py:1448-1449`) and carries no `open_questions` at all. Those rows keep reading
   exactly as they do now.

3. **When all ideas are blocked, say so unmistakably.** There is no such state today: with no
   cycle running, one blocked idea and ten blocked ideas produce the same `blocked` icon and a
   number. "Everything is stuck waiting for me" is a different fact from "some things are
   waiting" — it is the only queue state where nothing will move until a person acts — and it
   deserves its own bulb.
   This collides with the visibility rule from v0.1, whose answered question made the button
   visible **only while a cycle is running**. An all-blocked queue is by definition not running,
   so under today's rule the new bulb would be invisible to anyone without "always show" on, and
   the feature would ship unseeable. The first open question below settles that; the plan assumes
   the button appears.

Assumptions, stated rather than asked:

- **This is version 0.3**, a minor entry: `STATUS.md`, `src/extension/metadata.json`
  (`version-name`) and `flake.nix` (`packages.default.version`), which the release workflow
  asserts are one string.
- **This work may edit `orchestrator/heartbeat_server.py`, `orchestrator/orchestrator.py` and
  `docs/state-contract.md`**, under the grant recorded in `plans/01-2026-08-17.md` and used again
  in 0.2. Everything else stays inside `ideas/aideas/`. The root `README.md` is the queue and is
  never touched.
- **The contract only grows.** `open_questions` keeps its meaning and its type; the text arrives
  as a new key. An extension that does not see it, or a box that does not send it, must both
  behave exactly as they do today — the laptop and the box are updated at different times.
- **Question text is untrusted, unbounded input.** It comes from a markdown file an agent wrote:
  multi-line, `**bold**`, hundreds of characters, occasionally the whole rationale of a decision.
  The server bounds it and the menu wraps it; neither trusts it.
- **Rows stay read-only.** Answering a question means editing `PLAN.md` on the box. Showing the
  questions does not make the menu a place to answer them.

## Features

- **A bulb, in every state.** `src/extension/icons/` gains a small family of symbolic SVGs drawn
  on the 16px grid to the Adwaita conventions (single path, `fill="currentColor"`, no embedded
  colour, `-symbolic.svg` suffix so the shell recolours rather than blits them). The panel wears
  a bulb whatever is happening; what changes between states is the *drawing*, never the colour:
  a lit bulb with rays while a cycle runs, a plain bulb when idle, an unlit bulb for all-blocked,
  and the bulb with a small badge glyph for the states that are about the connection rather than
  the queue. `ICONS` keeps its shape — a state-to-icon map, one lookup, still a pure function —
  so every existing indicator test keeps applying and only the expected names change.
- **The icon is grey because it is symbolic, not because it is painted grey.** The extension
  loads the SVGs as symbolic icons so GNOME applies the panel foreground colour itself: the bulb
  matches the shell in light and dark themes, in high contrast, and while the top bar dims. A
  unit test asserts every shipped SVG carries no hard-coded fill colour, and the smoke test
  asserts the panel icon really resolved (not a missing-image placeholder) and is drawn in the
  panel's own colour.
- **An "everything is blocked" bulb that reads as a stop, not a state.** A new `allBlocked`
  panel state, entered when the reading is good, no cycle is running, there is at least one
  blocked idea and **no row the orchestrator could pick up** — no `ready`, no `running`, no
  `to be planned`. (`queued` rows do not count: a duplicate entry behind a blocked one is stuck
  too.) It gets the unlit bulb, the count of blocked ideas as its badge, and an accessible name
  that says the whole thing in one line: `aideas: every idea is blocked, 3 waiting for an
  answer`. `blocked` — some blocked, something else could still run — keeps its own lit-but-
  waiting bulb, so the two are told apart at a glance.
- **The panel appears when the queue stops.** Visibility grows one clause: the button is shown
  while a cycle is running, while "always show" is on, **and while every idea is blocked** — the
  one state whose entire purpose is to be noticed by a person. Subject to the first open
  question; if that is answered the other way, the state and its icon stay and only the extra
  visibility clause goes.
- **`/state` carries the questions, not just how many.** A blocked row gains
  `open_question_texts`: an array of one-line strings, one per unticked `- [ ]` in the
  `## Open Questions` section, in file order — the same lines `count_open_questions()` already
  counts, so the count and the texts can never disagree. Present only when `open_questions` is,
  absent (never null) otherwise, per the contract's convention for conditional keys.
- **The server bounds what it sends.** A question is folded to one line (continuation lines
  joined, whitespace collapsed), trimmed of its checkbox and of markdown emphasis, cut to a fixed
  length with an ellipsis, and at most a fixed number of questions per idea are sent. The
  contract's "about 120 bytes per idea" becomes a stated per-row bound instead of an estimate a
  chatty `PLAN.md` could blow past — `/state` is read every few seconds by a panel.
- **Questions in the menu, under the idea they belong to.** Each blocked row is followed by its
  questions as read-only child lines, indented and dimmed, keyed off the row's `position` (the
  only unique field). The row keeps its own detail line ("3 unanswered questions") as the summary
  above them. Long questions wrap over at most two lines rather than being cut mid-word, and a
  row with more questions than are shown ends with `+2 more`, so the menu never grows without
  bound. All of it is decided in `menuModel.js` / `menuItems.js` as data, and asserted headlessly.
- **Nothing changes for the rows that have no questions.** `STATUS.md says blocked` renders as it
  does today. So does a blocked row from a box that has not been updated, and a row whose
  `open_question_texts` is missing, empty, not an array, or full of non-strings — each of those
  is a shape `state.js` already has to be hostile about, and each gets a test.
- **The Blocked section works while a cycle runs, too.** Showing questions is a property of a
  blocked row, not of the panel state, so the questions are there whenever the section is —
  including behind a running cycle, and including in a stale last-good reading, where they are
  dimmed with everything else.
- **The contract says all of this.** `docs/state-contract.md` gains `open_question_texts` in the
  row table with its bounds and its absent-rather-than-null rule, and
  `tests/test_state_contract.py` asserts it against fixture repositories — a blocked idea with
  questions, one blocked by `STATUS.md` with none, a question longer than the cap, a `PLAN.md`
  with more questions than the cap, and a ticked-then-unticked mixture — so the two halves cannot
  drift.
- **Screenshots that show what was built.** The smoke test captures the three new looks — running,
  some blocked, all blocked — plus the menu with questions expanded, since "clearly states it" is
  a claim about appearance and the only honest evidence for it is a picture.

## Approach

Units, each one commit, tests first:

1. **U1 — the server side.** `count_open_questions()` grows a sibling that returns the lines;
   `queue_rows()` attaches `open_question_texts` with its folding and its caps; the contract
   document and `tests/test_state_contract.py` follow in the same commit. Nothing in the
   extension yet — the endpoint must be right before anything renders it.
2. **U2 — parsing it, hostilely.** `state.js` reads the new key into `row.openQuestionTexts`,
   defaulting to `[]` for every wrong shape, with unit tests for absent, null, not-an-array,
   non-string members, empty strings and an over-long array.
3. **U3 — the menu.** `menuModel.js` emits question lines under blocked rows; `menuItems.js`
   flattens them; `indicator.js` gains one widget case, dimmed and non-reactive. Unit tests
   compare whole menus, including the stale and cycle-running cases.
4. **U4 — the bulbs.** The SVG family, the loader, `ICONS` repointed, the no-hard-coded-colour
   test, and a `check-bundle.js` check that every name `ICONS` uses is a file that shipped —
   because a missing icon in a panel is a silent blank square, not an error.
5. **U5 — `allBlocked`.** The new state and the visibility clause in `indicatorModel.js`, with
   tests for the boundaries: one ready row among blocked ones is not all-blocked, a `queued`
   duplicate does not rescue it, an empty queue is not all-blocked, and a running cycle never is.
6. **U6 — the compositor.** Smoke-test assertions that the icon resolved and is recoloured, that
   the all-blocked panel appears without "always show", and that the menu renders questions;
   screenshots for each. This is the unit that can fail in a way no other can.
7. **U7 — the bump and the docs.** 0.3 in the three files, `README.md` on what the bulb states
   mean, and `STATUS.md` recording what was run and what it printed.

## Risks / things to verify early

- **A file icon may not be recoloured.** GNOME recolours symbolic icons, but whether a
  `Gio.FileIcon` pointing into the extension directory gets that treatment — as opposed to an
  icon-theme name — depends on the `-symbolic.svg` suffix being honoured by the texture cache.
  If it is not, the fallback is to add the extension's `icons/` to the icon theme search path and
  keep using `icon_name`. Worth settling in U4, before three SVGs are drawn to the wrong plan.
- **Grey means state cannot be colour.** Every bulb variant will be painted the same. If two
  states are not distinguishable in a 16px monochrome silhouette, they are not distinguishable at
  all — the smoke-test screenshots are the check, and the badge carries the number regardless.
- **`/state` gets bigger, and it is polled.** Ten blocked ideas with five questions each is a
  much larger body than the contract's "about 120 bytes per idea". The caps are what keep the
  panel's polling cheap; they are part of the feature, not a detail.
- **Box and laptop are updated separately.** A new extension against an old server, and an old
  extension against a new server, must both work. Both directions get a test.
- **The bulb is what an installed user sees.** The icon change lands on the laptop through a
  release, which 0.2 made work; `make check-release` after the merge is still how anyone knows it
  published.
- **Do not touch the root `README.md`,** and keep the orchestrator edits to the two files named
  above.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **Should the panel button appear when every idea is blocked, even though no cycle is
      running?** The v0.1 answered question fixed visibility to "only while a cycle is running",
      and an all-blocked queue is never running — so under that rule the new bulb would exist but
      never be seen without turning "always show" on, which makes the third part of this entry
      pointless. The plan assumes the button appears in that one extra case, on the grounds that
      it is the only state whose meaning is "a person is now the bottleneck". Ticking this line
      as-is chooses that. The alternative is to keep the rule strictly and let the all-blocked
      bulb only ever be seen by people who already keep the button on. Yes, should appear always.
- [x] **Should the bulb replace *all six* state icons, or only the queue ones?** The entry says
      "the icon must be a bulb", and the plan assumes the whole family becomes bulbs, so the
      button always looks like the same thing and the state is read from its shape and badge. The
      alternative is to keep stock icons for the three states that are about the *connection*
      rather than the queue — `unreachable`, `unavailable`, `unconfigured` — where a
      network-offline or warning glyph says more, at the cost of the panel sometimes not looking
      like this extension at all. The icon on the task bar must be a bulb. Keep the per-idea icons as-is.
- [x] **How much of a long question should the menu show?** The plan assumes each question is
      folded to one line, wrapped over at most two lines in the menu, cut with an ellipsis after
      that, and at most three questions shown per idea with `+n more` for the rest — a menu is a
      glance, and the full text is in `PLAN.md`. The alternatives are to show every question in
      full however long the menu becomes, or to show only the first question per idea as a taste
      of what is waiting. Follow the plan.
