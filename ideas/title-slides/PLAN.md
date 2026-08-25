# Plan: title-slides 0.5 — index the `##` headings, not the `#` ones

Difficulty estimate: medium — the code change is a couple of predicates, but it replaces the
feature's contract, so every index fixture, screenshot and README paragraph is rewritten, and a
guard that was decorative until now (generated headings are not indexed) becomes load-bearing.

## Context

The report: **the index must be extracted from level 2 titles (`##`), not from level 1 (`#`).
Level 1 is reserved for the title slide; sections use level 2 instead.** Minor version, so 0.5.

This is the other half of the 0.4 conversation. 0.4 reproduced a deck that set `show-index: true`
and saw nothing, found the deck had fourteen `##` headings and no `#` at all, and — on the answered
question "in a section-less deck no agenda is inserted" — shipped a *warning* saying the deck has no
sections to index. The reporter's answer to that warning is this entry: the deck is not
section-less. Its sections are the `##`s. `#` is where the deck's own title page goes, so keying the
index off `#` indexes the one heading level that is guaranteed not to be a section.

So 0.4's warning was the right response to the wrong contract, and this entry moves the contract.
`tests/fixtures/real-deck/T4-funciones.qmd` — already upstream, already rendered by
`nix flake check` — stops warning and starts getting an index, and that diff is the proof.

**The rule this plan implements: the index lists the headings that start slides.** Concretely
`is_section(block) = block.level < slide_level` becomes `block.level == slide_level`, which at
Quarto's default `slide-level: 2` is exactly "level 2" as reported, and makes `#` — above the slide
level — neither listed nor given an index slide. Stated as a decision rather than asked, because it
reproduces the report at the default and disposes of the whole `slide-level` matrix that 0.4 had to
special-case: at `slide-level: 1` the index lists `#` headings and its own heading is a `#`, at
`slide-level: 3` it lists `###`, and only `slide-level: 0` — where no heading starts a slide — is
left with nothing to index and keeps 0.4's warning. The alternative, hard-coding level 2 whatever
the slide level, is in Open Questions.

Further assumptions, stated once:

- **This is a behaviour change, not a bug fix**, which is why it is a minor bump. A deck with `#`
  sections and `##` slides — the shape `tests/fixtures/index.qmd` and `example/deck.qmd` have —
  gets a different deck out of 0.5 than out of 0.4: its index slides move from before each `#` to
  before each `##`, and list the `##` titles. The release notes lead with that rather than bury it.
- **The carry is untouched.** The 0.1 contract stands as written, `#` still clears the carried
  title, and `title-slides:` behaves identically with this entry applied. Only the index moves.
- **The 0.4 warning survives, with new reasons.** Silence is still never an outcome; the deck that
  now warns is the one with no slide-level headings at all, or with all of them hidden.
- **No new frontmatter key**, on the same grounds as 0.4: the reporter should not have to discover a
  key to get the level their deck already uses. `index-level:` stays in Open Questions.

## Features

- **The index is built from slide-level headings** — `##` at Quarto's default — in document order,
  each one listed with the text the author wrote.
- **`#` is reserved for the title slide**: a level-1 heading is never listed on an index and never
  gets an index slide put in front of it, so a deck's title page and its `#` section slides are left
  exactly as the author wrote them.
- **The reporter's deck gets its index** — the real-deck fixture stops emitting the 0.4 warning, its
  fourteen accented `##` titles appear on the index, and the pinned outline changes to match. That
  outline diff is the acceptance criterion, and the test fails if the index disappears again.
- **The emphasis still moves** — the entry for the slide the index introduces is wrapped in `Strong`
  and in the `title-slides-index-current` span, unchanged from 0.2, so the CSS hook and the
  screenshots' meaning survive the level change.
- **Generated headings are neither indexed nor anchors** — a `title-slides-continuation` heading
  inserted by the carry sits at the slide level, which is now precisely what the index looks for.
  Without an explicit `is_generated` check, a deck using both features would get an index slide
  before every continuation and its title repeated down the list. A test fails when the check is
  removed.
- **Hidden slides stay hidden** — `.unlisted` or `visibility="hidden"` on a slide-level heading
  keeps it off the index and gives it no index slide, the same rule 0.2 applied to sections, so
  `show-index` still cannot leak the title of a slide the author suppressed.
- **Duplicate and accented titles survive** — `Definición` twice and `Parámetros por defecto` three
  times are listed as written (subject to Open Questions), and identifiers still come from the
  shared `taken_identifiers` table, so `<slide>-index-<n>` cannot collide with a continuation or
  with anything in the deck.
- **`show-index: true` is still never silent** — 0.4's warning stays, re-aimed: no slide-level
  headings at all, every one of them hidden, or `slide-level: 0`, where no heading starts a slide.
  Named key, specific reason, once per document.
- **Index slides are asserted to be reachable, not merely present** — reveal's vertical-stack
  nesting changes when an index precedes a `##` instead of a `#`, so the render test checks where
  the index `<section>` lands and that nothing hides it.
- **Docs and screenshots match the new rule** — the README's "index rule, exactly" section, the
  worked example, the two index screenshots and the 0.4 troubleshooting entry all describe `##`
  indexing; the paragraph promising that no agenda of `##` slides is invented is replaced by what
  0.5 actually does.
- **Released and installable** — `_extension.yml` at 0.5.0, `v0.5` tagged upstream with
  `title-slides-0.5.zip` attached and verified present, both install paths re-checked from clean
  directories by rendering the real deck, then the gitlink and `flake.lock` moved here together with
  `scripts/check-pin.sh` green.

## Approach

Units, one commit each, expectation written before implementation:

1. **U0 — pin, baseline, and the current output written down.** `git submodule update --init`,
   `scripts/check-pin.sh`, full 0.4 suite green before any change; the sweep has reverted this
   gitlink once already. Then record, from real renders rather than from reading the code: what the
   real deck does today (warning, fourteen slides), and what `index.qmd` and `example/deck.qmd`
   produce today, so the 0.5 diff is measured against evidence rather than against the goldens.
2. **U1 — the failing expectations.** Rewrite `tests/fixtures/index.expected.qmd` for `##`
   indexing, update the real-deck expected outline, and add unit fixtures: a deck with only `##`
   headings, a deck with both `#` and `##`, a deck whose `#` is a title slide followed by `##`s.
   They fail. If keeping CI green means landing them with U2, the expectations are still written
   first.
3. **U2 — the predicate.** `is_section` becomes `is_indexed` — `level == slide_level`, not hidden,
   not generated — and `sections_of`, `index_slide` and `insert_indexes` follow it. Keep
   `insert_indexes` a pure function over top-level blocks so the unit tests drive it directly. The
   `is_generated` exclusion lands here with the test that fails without it.
4. **U3 — the warning, re-aimed, and the degenerate cases re-pinned.** New reason strings for "no
   `##` headings", "all hidden" and `slide-level: 0`; then every case 0.4 pinned as *warning* that
   is now an *index* — no sections, one heading, `slide-level: 1`, a `#` nested in a div, both
   features on together — rewritten as a decision, each perturbed once to confirm it can fail.
5. **U4 — docs, screenshots and release.** README rule, example and troubleshooting; regenerate the
   two index screenshots from a deck of the new shape; `_extension.yml` to 0.5.0; cut the tag and
   confirm the tag *and its asset* landed (`git ls-remote --tags`, then look at the release — the
   orchestrator's push carries no tag, so the workflow tags itself); verify both install paths from
   clean directories against the real deck; move the gitlink and `flake.lock` here together and
   check the remote CI run, not just the local one.

## Testing

- **Real deck** (`tests/run-real-deck.sh`, existing) — the acceptance test. New pinned outline, the
  accented titles listed on the index, no warning on stderr, and the filter-off run still fourteen
  slides so the no-op proof stays honest.
- **Golden** — `index.qmd` is rewritten by design; `basic.qmd`, `nested.qmd` and `sections.qmd`
  must pass **byte-identically**, because they exercise the carry, which this entry does not touch.
  A diff there is a finding, not a fixture to update.
- **Unit** — the transform as a pure function: `##`-only deck, `#`-and-`##` deck, title slide then
  `##`s, hidden slide-level headings, `slide-level: 1` and `3` and `0`, carry and index together
  with `---` continuations present, and the `is_generated` guard.
- **Reachability** — where the index `<section>` sits in the rendered HTML now that it precedes a
  `##`, and that no class or inline style hides it. String and structure assertions; no browser.
- **Smoke and install** — both still run; the smoke test's index assertions move to the new level,
  and the install test is unchanged.
- **Every new or changed expectation is perturbed once** to prove it can fail, as in 0.3 and 0.4.

## Risks / things to verify early

- **The pin.** `scripts/check-pin.sh` before anything else; `STATUS.md` claiming 0.4 is not evidence
  that the gitlink points at it.
- **The generated-heading guard is now load-bearing.** 0.2 recorded that the carry could not adopt an
  index title because a `#` always followed one; 0.4 recorded that removing the guard broke fourteen
  tests. Now the index also has to *skip* continuations. Verify by removing each check in turn.
- **The index slide count.** Indexing the slide level means one index per slide, so the reporter's
  fourteen-slide deck becomes twenty-eight. This is Open Question 1 and the answer decides the
  acceptance outline; do not build past U1 without it.
- **Reveal's nesting changes.** 0.2 documented an index being pulled into the preceding section's
  vertical stack. An index at the same level as the heading it precedes nests differently — check
  the rendered structure on a deck with `#` sections before assuming the caveat still reads true.
- **Rewriting a golden is what a broken fix looks like.** `index.expected.qmd` changes here by
  design; the other three must not, and neither may the carry unit tests.
- **`slide-number: c/t` and any in-deck link that counts slides** shift with the extra slides. A
  README sentence, not a surprise.
- **`upstream/` is a detached-HEAD submodule** — `git push origin HEAD:main` and confirm with
  `git ls-remote origin main` before calling a unit done; a plain push prints nothing and does
  nothing.
- **The release workflow must create its own tag**; the orchestrator's push carries none.
- **`quarto render --quiet` hides the warning**, as 0.4 found — do not read a quiet render as proof
  that a deck no longer warns.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] One index slide before **every** `##`, or a single one at the top of the deck? Ticking this
      line as-is keeps 0.2's shape exactly one level down — an index before each indexed heading,
      with the emphasis moving — which is what makes the `title-slides-index-current` span mean
      anything, and turns the reporter's fourteen-slide deck into twenty-eight slides. The
      alternative is one index slide at the top listing all fourteen with nothing emboldened (an
      agenda), leaving the deck at fifteen: quieter, but then the current-item emphasis has no
      purpose. A third possibility is repeated indexes only where consecutive titles differ.
- [ ] Are consecutive repeated titles listed once or every time? Ticking this line as-is lists every
      `##` **verbatim in document order**, so the reporter's index reads `Definición`, `Definición`,
      … `Parámetros por defecto` three times in a row — a faithful list of slides, a poor agenda.
      The alternative collapses a run of identical adjacent titles into one entry, emphasised for
      every slide in the run, giving that deck ten entries instead of fourteen.
- [ ] Does the old behaviour stay reachable for decks that do use `#` sections? Ticking this line
      as-is makes 0.5 a **straight replacement**: `#` headings are no longer indexed at all, and a
      0.4 user with `#` sections silently gets a differently indexed deck. The alternative is an
      `index-level:` key (defaulting to the slide level) so both conventions are expressible — more
      surface, but it is also the answer to the level question 0.4 deferred.
