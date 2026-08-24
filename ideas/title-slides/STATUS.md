status: done
version: 0.2
started_at: 2026-08-16
last_session_id: 498f8809-49e3-4e71-b8bb-3905366ad588
last_run: 2026-08-24T08:17:45+02:00
last_cycle_cost_usd: 15.026146999999996

## Log
- 2026-08-24T08:17:45+02:00 — done ($15.026146999999996)
- 2026-08-16T21:29:26+02:00 — done ($12.985914499999996)


### 2026-08-24 — 0.2 delivered: show-index

Five units, each committed with its tests. What is worth knowing next time:

- **The plan's main worry for this entry did not exist.** It expected an injected index
  heading to be adopted as a carried title unless the passes were ordered carefully. I
  ran the two passes in the opposite order and got an identical result: an index slide is
  always immediately followed by the section heading that clears the carried title, so
  ordering was never what protected us. The carry now ignores generated headings
  explicitly, so the invariant is real rather than incidental — and that test does fail
  when the check is removed.
- **The bold survives.** `Strong` and the `title-slides-index-current` span both reach the
  HTML untouched by Quarto's revealjs filters, so the golden fixture can be written with
  `[**Section**]{.title-slides-index-current}` typed out by hand and compared literally.
  The normaliser strips the marker classes but deliberately not that one.
- **Reveal nests an index slide into the preceding section's vertical stack**, because it
  is a slide-level slide sitting just before the next `#`. The first index, which precedes
  any `#`, is the exception. Harmless under Quarto's default `navigationMode: linear`,
  visible in the overview grid. Documented as a caveat rather than worked around, since
  the plan chose a slide-level heading deliberately.
- **`match($0, re, arr)` is a gawk extension.** The smoke test used it and died with a
  syntax error under the sandbox's awk; rewritten as a plain shell loop.
- **A plain `git push` from the submodule really is a silent no-op.** It printed nothing,
  and `ls-remote` showed main unmoved — the detached HEAD needs `git push origin HEAD:main`.
  The plan warned about this and it still caught me; checking `ls-remote` is what found it.

Difficulty estimate: easy — as forecast for 0.2. Every mechanism the entry needed already
existed from 0.1, and the one subtlety the plan flagged turned out to be structurally
absent (see the log). Medium overall for the idea, going by 0.1.

Upstream: https://github.com/gortazar/title-slides — released as
[v0.2](https://github.com/gortazar/title-slides/releases/tag/v0.2), submodule pointer and
flake input both at that tagged commit.

## What "done" covers for 0.2

`show-index` is delivered, tested and released. Every feature in the 0.2 entry:

- **`show-index: true`** — read through the same `quarto.metadata.get`-then-`Meta` chain as
  `title-slides`, defaulting to off; the two keys are independent, and either switches the
  filter on.
- **An index slide before every section** — a slide-level heading titled with the deck's
  own `title:` (or `Outline` without one), followed by a bullet list of every section in
  document order.
- **The next section in bold** — wrapped in `Strong` and in a `title-slides-index-current`
  span. Verified in the rendered HTML that both survive Quarto's own revealjs filters.
- **Index slides do not disturb the title carry** — the carry now explicitly ignores
  headings the extension generated, and a test fails if that check is removed.
- **Safe identifiers** — `<section>-index-<n>` from the same uniqueness table as the
  `-cont-<n>` names, so the two kinds cannot collide; index headings are `unlisted`.
- **Hidden sections stay hidden** — `.unlisted` or `visibility="hidden"` sections are
  neither listed nor given an index slide.
- **Degenerate decks** — no sections, one section, a section as the first block, an empty
  trailing section, and the `slide-level: 1`/`0` cases where a deck has no sections at all,
  each pinned by a test.
- **Documented and screenshotted** — README gains the key, an example, the rule, the CSS
  hooks and the caveats; two screenshots of real index slides show the emphasis moving.
- **Released and installable** — `_extension.yml` at 0.2.0, `v0.2` tagged with
  `title-slides-0.2.zip` attached. Verified from clean directories, not assumed:
  `quarto add gortazar/title-slides@v0.2` and the downloaded zip each render a deck with
  both features working.

All of 0.1 still passes unchanged: the three 0.1 golden fixtures are the regression check,
and the example deck kept all four of its continuation slides.

## What "done" covered for 0.1

Every feature in `PLAN.md` is delivered, tested and released:

- **Lua filter extension** — `_extensions/title-slides/`, installable with
  `quarto add gortazar/title-slides@v0.1`.
- **Frontmatter activation** — a no-op unless `title-slides: true`, read through
  `quarto.metadata.get` with a plain `Meta` fallback for bare `pandoc --lua-filter`.
- **Title inheritance across `---`**, **explicit titles winning**, and **`#` clearing the
  carried title** — the contract in `PLAN.md`, encoded test by test.
- **Safe duplicated headings** — `<original>-cont-<n>` identifiers that skip any name
  already used in the document, plus the `title-slides-continuation` class for styling
  and `unlisted`, which keeps continuations out of the table of contents. Confirmed
  against a rendered deck with `toc: true`.
- **Slide-level aware** — `PANDOC_WRITER_OPTIONS.slide_level` first, metadata then 2.
- **Scoped to top-level blocks** — rules inside divs, callouts, columns, notes and
  quotes are left alone.
- **Format coverage** — `revealjs`, per the answered open question.
- **Documented behaviour** — `README.md` opens with the install line and covers the rule,
  the options, screenshots of a real deck and the caveats.
- **Setext warning** — the answered question asked for "document and warn"; both done.
- **Reproducible environment + green CI** — `nix flake check` runs unit, golden and smoke
  tests upstream; the pin check and a wrapper check run here.
- **Release and install without building** — v0.1 is tagged with
  `title-slides-0.1.zip` attached.

Verified from clean directories, not assumed: `quarto add gortazar/title-slides@v0.1`
installs and renders a deck with the titles carried, and the downloaded zip does the same
when unzipped into a project.

Two things the plan left open that were settled by evidence rather than choice, both
recorded in the log below: `slide-level: 0` makes the filter inert (no heading starts a
slide, so there is no title to carry), and Quarto had to be pinned from its own release
because nixpkgs' quarto cannot render at all.


### 2026-08-16 — 0.1 delivered

Built in nine units, each committed with its tests. Notes worth keeping:

- **nixpkgs' quarto (1.10.18) is broken**: it passes pandoc an option
  (`syntax-highlighting`) that the pandoc it is wired to rejects, so `quarto render`
  fails on *any* document, extension or not. The flake therefore takes Quarto from its
  own release tarball, pinned at 1.8.27, and exposes that bundle's pandoc as `pandoc`
  so tests and renders can never be a version apart. This also satisfies the plan's
  "pin the Quarto version in the flake".
- **Quarto shells out to `which`** while probing for R, so the nix build sandbox needs
  `pkgs.which` or every render dies with a stack trace that never mentions your document.
- **`slide-level: 0` leaves the filter inert.** The contract in `PLAN.md` tracks "the most
  recent `Header` of level *S*", and no heading has level 0 — with rules as the only
  slide break there is no slide title to carry. Implemented and documented as such rather
  than inventing a different meaning.
- **The setext trap cannot be seen in the AST.** By filter time it is an ordinary
  `Header`, so `setext.lua` scans the source instead — and scans the document Quarto
  started from, not pandoc's intermediate copy, whose line numbers would not match the
  file the author has to edit.
- **The golden test was checked for being able to fail** by perturbing an expected
  fixture, not just for passing.

### 2026-08-16 — M0 spike findings

Rendered the idea's example under `revealjs` and dumped the AST before and after
filters. Four things settled, with evidence rather than guesswork:

- **Top-level `---` survives to the filter stage** as plain `HorizontalRule`. The
  transform can key on it as planned.
- **Filter-inserted headings really do split slides.** A heading inserted after a rule
  renders as its own `<section id=… class="slide level2">`, and the class put on the
  heading is carried onto the section, so styling/hiding a continuation is possible.
- **The output matches the hand-written deck structurally.** Same `<section>` sequence,
  differing only in the id and the extra class — so the golden-equivalence test in the
  plan is achievable by normalising ids.
- **User filters run before Quarto's own** and Quarto's revealjs filters leave the
  inserted heading alone. No `filters: {post: …}` ordering needed.

Two mechanics worth recording, both feeding later units:

- `slide-level` is **not** in the metadata under Quarto — `quarto.metadata.get` returns
  nil for it. `PANDOC_WRITER_OPTIONS.slide_level` is the authoritative source (2 by
  default, 0 with `slide-level: 0`, 1 with `slide-level: 1`). Under bare
  `pandoc --lua-filter` it is nil, so the fallback chain is writer options → metadata → 2.
- The setext risk is real: `blabla` followed immediately by `---` parses as
  `Header 2 "blabla"`. The rule never reaches the filter, so this has to be detected in
  the source text, not the AST.

## Units
### 0.1
- [x] M0 — spike: confirmed rules survive, inserted headings split slides, ids/classes land
- [x] Extension skeleton + title inheritance across top-level rules, with the metadata switch
- [x] Wrapper here: `upstream` submodule, `flake.nix` consuming it, `scripts/check-pin.sh`,
      root CI running both
- [x] Explicit titles win: `---` followed by its own `##`, and `#` resetting the carried title
- [x] Scoped to top-level blocks: rules inside divs, callouts, columns, quotes untouched
- [x] Unique identifiers, the `title-slides-continuation` class, and TOC exclusion via `unlisted`
- [x] `slide-level` awareness, including `slide-level: 0`
- [x] Warn on setext headings in a `title-slides: true` document
- [x] Golden equivalence tests, smoke test, and a pinned Quarto that renders in the sandbox
- [x] Release workflow, screenshots, example deck; v0.1 published and both install paths
      verified from clean directories

### 0.2 — `show-index`
- [x] U0 — pin and baseline: submodule populated, pins agree, 0.1 suite green before any change
- [x] U1 — `show-index` read alongside `title-slides`, each gating its own feature
- [x] U2 — the index slide itself: sections collected, list built, next section emboldened,
      inserted before each section, unique `-index-<n>` identifiers
- [x] U3 — composition with the carry: generated headings never adopted as a carried title
- [x] U4 — golden case `index.qmd` vs a hand-written expectation, plus index assertions in
      the smoke test and an example deck with sections
- [x] U5 — README, screenshots, `_extension.yml` at 0.2.0, v0.2 released, both install
      paths verified from clean directories, pin moved here

Next: nothing — 0.2 is done. 89 unit tests plus 4 golden cases and the smoke test, all
green in `nix flake check` upstream and at the pinned commit here.
