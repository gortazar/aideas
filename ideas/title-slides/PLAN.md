# Plan: title-slides — `show-index`, an index slide before every section

Difficulty estimate: easy — every mechanism it needs already exists from 0.1 (top-level block walk,
unique identifiers, `unlisted`, the unit/golden/smoke harnesses, the release workflow); the only real
subtlety is keeping an injected index heading from becoming a carried title.

## Context

0.1 shipped `_extensions/title-slides/title-slides.lua`: a single `Pandoc` pass, switched on by
`title-slides: true`, that walks the **top-level** block list tracking `current` — the most recent
heading of the slide level *S* — and inserts a copy of it after every top-level `---` that does not
already introduce a title. A heading of level `< S` (a section slide, `#` by default) clears
`current`. Copies get `<original>-cont-<n>` identifiers that skip anything already taken, plus the
classes `title-slides-continuation` and `unlisted`. `slide_level_of` reads
`PANDOC_WRITER_OPTIONS.slide_level` first, then metadata, then 2. See `upstream/README.md` for the
rule as documented, and `plans/01-2026-08-24.md` for how it got there.

0.2 adds a second, independent thing to the same pass: with `show-index: true` in the frontmatter,
inject an **index slide** immediately before each section — a slide listing every section of the
deck in document order, with the section that comes next in **bold**. This is beamer's
`\AtBeginSection` habit, brought to a Quarto deck.

What already exists and can be built on:

- The pass is already a pure function over the top-level block list (`carry_titles`), already
  distinguishes "section heading" (level `< S`) from "slide heading" (level `== S`), and is already
  unit-tested that way — `tests/unit/nested-rules.lua`, `tests/unit/slide-level.lua`,
  `tests/fixtures/sections.qmd`.
- `taken_identifiers` / `continuation_identifier` already produce collision-free derived ids; an
  index slide needs exactly the same treatment, since one deck gets several of them.
- The `unlisted` class already keeps generated headings out of the TOC, verified against a rendered
  deck with `toc: true`.
- `enabled(meta)` already reads a flag through `quarto.metadata.get` with a plain `Meta` fallback, so
  a second flag costs one call.
- `tests/run-golden.sh` renders `fixtures/<case>.qmd` and `fixtures/<case>.expected.qmd` and diffs
  the two after normalising ids and marker classes — which turns "the index slide is what you would
  have typed by hand" into a test rather than a claim.

Assumptions stated rather than asked (the ones with real design weight are in *Open Questions*):

- **A section is a top-level heading of level `< S`** — `#` with the default slide level. That is
  what Quarto renders as a section slide and what 0.1 already treats as a section boundary. Under
  `slide-level: 1` (or `0`) no heading is below the slide level, so there are no sections and
  `show-index` does nothing, consistent with how `slide-level: 0` already makes the carry inert.
- **The index is its own slide**, formed by a level-*S* heading plus a bullet list, inserted
  immediately before the section heading. A level-*S* heading is what starts a slide, so the index
  lands as a slide of its own and the section slide follows unchanged.
- **The index lists every section of the document**, not only the ones still to come, so the same
  list appears on each index slide with a different entry emboldened.
- **Entries are plain text, not links.** The literal reading of the idea, and it keeps the golden
  comparison honest. Linked entries can come later without changing the frontmatter.
- **The two features are independent.** `title-slides: true` carries titles; `show-index: true`
  injects indexes; either switches the filter on, neither implies the other. `filters:
  [title-slides]` is still needed to load the extension, and a document with neither key renders
  exactly as today.
- **Minor version: 0.2.** Additive, no change to any 0.1 behaviour, so a deck written for 0.1 renders
  byte-identically under 0.2 — that is a test, not a hope.

## Features

- **`show-index: true` in the frontmatter** — read through the same `quarto.metadata.get`-then-`Meta`
  chain as `title-slides`, accepting the same truthy spellings, defaulting to off. Absent the key,
  nothing changes; present with `false`, nothing changes.
- **An index slide before every section** — for each top-level heading of level `< S`, a level-*S*
  heading followed by a bullet list of all the sections, inserted immediately before it, so a reader
  sees where the deck is going before each new part.
- **The next section in bold** — the entry for the section the index precedes is wrapped in `Strong`
  and additionally carries a `title-slides-index-current` span class, so the emphasis is visible in
  any renderer and can be restyled (colour, size) from CSS without touching the filter.
- **Index slides do not disturb the title carry** — an injected index heading is never picked up as
  `current`, so a `---` after a section still inherits the section's own `##`, not the index's title.
  The carry runs over the author's blocks and the injection happens around it; a deck with both keys
  set produces exactly the slides both features promise, independently.
- **Safe identifiers and navigation** — index headings get derived-but-unique ids in the established
  shape (`<base>-index-<n>`, skipping anything taken), carry `title-slides-index` for styling or
  hiding, and are `unlisted` so a repeated index never fills the table of contents. Cross-references
  keep pointing at the author's own headings.
- **Sections a deck hides stay hidden** — a section heading marked `unlisted` or
  `visibility="hidden"` is neither listed in the index nor given an index slide of its own, so
  `show-index` cannot leak the title of a slide the author suppressed.
- **Degenerate decks behave** — no sections at all, a single section, a section as the very first
  block, and an empty trailing section each produce something sensible and are pinned by tests
  rather than left to discover.
- **`slide-level` aware** — the index heading is emitted at the resolved slide level, and levels at
  which "section" is meaningless (`slide-level: 1`, `slide-level: 0`) make `show-index` inert and say
  so in the README.
- **Documented where a user meets it** — `README.md` gains a `show-index` section with the
  frontmatter key, a before/after example, the CSS hooks (`.title-slides-index`,
  `.title-slides-index-current`), the interaction with `title-slides`, and the `slide-level` caveat;
  `example/deck.qmd` grows sections and turns the key on, and a screenshot of a real index slide goes
  beside the existing two.
- **Tests at all three existing layers** — unit tests over the transform (bold on the right entry,
  one index per section, ids, the two flags in all four combinations, the "index heading is not
  carried" case, hidden sections, no sections); a golden case `fixtures/index.qmd` against a
  hand-written `fixtures/index.expected.qmd` with the index slides and bold typed out; and the smoke
  test asserting the rendered deck's index slides, their titles and which entry came out bold.
  Plus one regression golden proving 0.1 fixtures are unchanged.
- **Released and installable without building** — `_extension.yml` at `0.2.0`, `v0.2` tagged
  upstream with `title-slides-0.2.zip` attached, `quarto add gortazar/title-slides@v0.2` verified
  from a clean directory; then the submodule gitlink and `flake.lock` moved here together and
  `scripts/check-pin.sh` green.

## Approach

Units, each one commit, tests first:

1. **U0 — pin and baseline.** `git submodule update --init`, `scripts/check-pin.sh`, and run
   `nix flake check` in `upstream/` before touching anything, so a later red suite is attributable.
   Record the 0.1 outputs of the existing golden fixtures as the "unchanged" baseline.
2. **U1 — the flag.** `show-index` read alongside `title-slides`; the pass runs when either is set
   and each feature is gated on its own key. Unit tests over the four combinations, with the
   still-empty index path a no-op.
3. **U2 — the index, as a pure function.** Collect the sections (respecting hidden ones), build the
   list, embolden the entry for the next one, emit heading plus list, insert before each section
   heading. Ids through the existing uniqueness helper. This is where the bulk of the unit tests go.
4. **U3 — composition with the carry.** Make the ordering explicit and test it: index headings never
   become carried titles; continuations inside a section are unaffected; a deck with both keys is
   checked slide by slide.
5. **U4 — golden and smoke.** `fixtures/index.qmd` + `.expected.qmd`; `example/deck.qmd` given
   sections and `show-index: true`; `tests/expected/deck.outline` updated; `deck-outline.lua`
   extended to report index slides and the bold entry if it does not already surface enough.
   Perturb an expected fixture to confirm the new golden case can fail.
6. **U5 — docs, screenshot, release.** README section and caveats; `_extension.yml` to `0.2.0`;
   screenshot from the rendered example; cut `v0.2` and confirm the tag and the attached zip actually
   landed (the orchestrator's push carries no tag — check `git ls-remote --tags` and the release,
   don't assume); verify both install paths from clean directories; move the gitlink and `flake.lock`
   here together.

## Testing

The three layers 0.1 established, all headless and all already wired into `nix flake check`:

- **Unit** (`tests/unit/index.lua`, under `pandoc lua`) — the transform over hand-built ASTs. Where
  the edge cases live: which entry is bold, how many indexes, ids, hidden sections, no sections, a
  section as the first block, both flags at once.
- **Golden equivalence** — `fixtures/index.qmd` rendered with `show-index: true` against
  `fixtures/index.expected.qmd`, the same deck with the index slides written out by hand. This is the
  acceptance criterion for "an index of the sections, next one in bold". The 0.1 fixtures stay in the
  suite as the no-regression check.
- **Smoke** — `quarto render` of the real `example/deck.qmd`, asserting the section count, the index
  slides, their titles, and that exactly one entry per index slide is `<strong>`.

## Risks / things to verify early

- **The injected index heading is a level-*S* heading, which the carry would otherwise adopt.** The
  single most likely bug in this entry, and it is silent: continuation slides after a section would
  quietly get the index's title. Pin it with a test in U3 before the code looks right.
- **Two generated block kinds now compete for identifiers.** `-cont-<n>` and `-index-<n>` are drawn
  from the same `taken` table; make sure the table is threaded through both, or a deck with several
  sections gets duplicate anchors and a broken reveal menu.
- **Inserting *before* a block, in a walk that appends.** `carry_titles` inserts after the current
  block; the index inserts before the next section heading. Getting this wrong shifts an index onto
  the end of the previous slide instead of onto its own, which renders plausibly and is wrong.
- **The example deck and its expected outline are shared with 0.1's smoke test.** Changing
  `example/deck.qmd` changes `tests/expected/deck.outline`; keep the continuation assertions intact
  rather than replacing them.
- **What the bold survives.** Quarto's revealjs filters have a say in what reaches the HTML; confirm
  the `Strong` (and the span class) actually appear in the rendered slide before building the golden
  fixture around them.
- **`upstream/` is a detached-HEAD submodule checkout**, so a plain `git push` from inside it is a
  silent no-op. Confirm with `git ls-remote origin main` before calling a unit done — the same trap
  recorded in the other ideas' STATUS files.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] "using as title the title of the slides" — what is the index slide's own heading text? Ticking
      this line as-is uses **the document's `title:` from the frontmatter** (the deck's title, which
      is what "the title of the slides" reads as), falling back to a bare index with no heading text
      when the document has no title. Alternatives: a fixed word (`Contents` / `Outline`), the title
      of the section that comes next, or a value configurable through the same frontmatter key. The 
      document's title from the frontmatter or Outline if there's no title.
- [x] Which headings count as "sections"? Ticking this line as-is lists **only headings below the
      slide level** (`#` by default) — Quarto's section slides. The alternative is to index the
      slide-level `##` headings as well (a two-level index, or a flat one of every slide title),
      which changes what the index is for on a deck that uses no `#` at all. 
- [x] Does `show-index: true` work on its own, or only together with `title-slides: true`? Ticking
      this line as-is makes them **independent** — either key switches the filter on, and you can
      have indexes without carried titles. The alternative is `title-slides: true` as a master switch
      and `show-index` as a sub-option (`title-slides: {show-index: true}`), which is tidier
      namespacing but no longer the flat `show-index` key the idea asks for.
- [x] Is there an index slide before the *first* section? Ticking this line as-is injects one before
      **every** section including the first, per the literal "before each section" — even though it
      lands right after the deck's own title slide and can look redundant there.
