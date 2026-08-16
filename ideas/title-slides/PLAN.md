# Plan: title-slides — carry the last `##` title onto untitled continuation slides

Difficulty estimate: medium — the transform itself is a short Lua filter over the top-level block
list, but getting it right across slide formats, keeping the duplicated headings from breaking ids
and navigation, and proving "equivalent to the hand-written version" in reproducible CI is most of
the work.

## Context

In a Quarto presentation, slides are delimited two ways: a heading at the slide level (`##` by
default; `#` makes a section slide), or a horizontal rule `---`, which is how you get a slide with
no title. Splitting into slides happens in pandoc's *writer*, so by the time slides exist the
filter stage is over — but the `---` is still visible in the AST as a `HorizontalRule`, which is
what this extension keys on.

The result today is that long sections force a choice: repeat `## Introduction` by hand on every
continuation slide, or let the continuation slides render with no title at all. `title-slides`
removes the choice: with `title-slides: true` in the frontmatter, every slide started by a `---`
inherits the last `##` seen, until a new `##` appears.

The transform, stated precisely (this is the contract the tests encode):

- Let *S* be the slide level (`slide-level` metadata if set, otherwise 2).
- Walk the **top-level** block list in order, tracking `current` = the most recent `Header` of
  level *S*. A `Header` of level `< S` (a section slide) clears `current`.
- For each top-level `HorizontalRule`: if the next block is a `Header` of level `<= S`, leave it
  alone — the slide already has its own title. Otherwise, if `current` is set and some content
  follows, insert a copy of `current` immediately after the rule.
- The copy keeps the heading's inline content and level, gets a fresh unique identifier so it does
  not collide with the original, and is tagged with a class so it can be styled or hidden.

Assumptions stated rather than asked (the ones with real design weight are in *Open Questions*):
the primary target is `revealjs`, since that is where `---` slide breaks and `##` titles behave as
the idea describes; horizontal rules nested inside divs, columns or callouts are content, not slide
breaks, and are ignored.

## Features

- **Lua filter extension** — `_extensions/title-slides/` with `_extension.yml` contributing
  `title-slides.lua`, installable with `quarto add <owner>/title-slides` and usable by adding
  `title-slides` to the document's `filters:`.
- **Frontmatter activation** — the filter is a no-op unless `title-slides: true` is present in the
  document (or project) metadata, so installing the extension never changes an existing render.
  Read via `quarto.metadata.get`, falling back to plain `Meta` so the filter also works under bare
  `pandoc --lua-filter`.
- **Title inheritance across `---`** — the rule above: the last `##` becomes the default title of
  every following untitled slide, and stops at the next `##`.
- **Explicit titles always win** — a `---` followed by its own `##` (or a `#` section slide) is
  untouched, and a `#` resets the carried title so a section's title never leaks into the next.
- **Safe duplicated headings** — inserted headings get derived-but-unique identifiers
  (`introduction`, `introduction-cont-1`, …), carry a `title-slides-continuation` class, and are
  marked so they do not appear in a table of contents or Quarto listing. Cross-references to the
  original heading keep pointing at the original slide.
- **Slide-level aware** — honours a non-default `slide-level`, including `slide-level: 0` where
  rules are the only slide break.
- **Scoped to top-level blocks** — rules inside `:::` divs, `.columns`, callouts, speaker notes or
  block quotes are left as ordinary horizontal rules.
- **Format coverage** — verified on `revealjs`; `beamer` and `pptx` covered to whatever extent the
  spike in M0 shows is meaningful (see *Open Questions* on which formats are in scope).
- **Documented behaviour** — `README.md` with the install line, the before/after example from the
  idea, the exact rule, the options, and the known caveats (setext headings, nested rules).
- **Reproducible environment + green CI** — `flake.nix` providing `quarto`, `pandoc` and a test
  runner; `nix flake check` runs the unit and golden tests; CI on push and PR upstream, plus the
  path-filtered pin check in this repo.
- **Release and install without building** — every finished entry tags `v<version>` upstream with
  the packaged `_extensions/` archive attached, installable as
  `quarto add <owner>/title-slides@v<version>`. That is this ecosystem's own channel, so no
  `curl | sh` installer is needed; `README.md` opens with the `quarto add` line.

## Approach

1. **M0 — Spike.** Render the idea's example by hand under `revealjs` and `beamer`, dump the AST
   (`pandoc -t native`) before and after Quarto's own filters, and confirm: rules survive to the
   filter stage, filter-inserted headings really do split slides, and what Quarto's revealjs
   filters do with headings. Settles the format-scope question with evidence rather than guesswork.
2. **M1 — Skeleton.** Repo, `flake.nix`, extension layout, test runner, CI green on a filter that
   does nothing. A no-op filter that installs and renders is already a checkpoint worth having.
3. **M2 — The transform.** Tests first, over the contract above: inheritance, reset on `##` and
   `#`, explicit titles preserved, nested rules ignored, trailing rule, document with no `##` yet.
4. **M3 — Identifiers and navigation.** Unique ids, continuation class, TOC/listing exclusion,
   cross-reference behaviour.
5. **M4 — Format coverage and options.** `slide-level`, whichever extra formats M0 justified, and
   any option the answered open questions call for.
6. **M5 — Ship.** README with screenshots of a rendered deck, release workflow, verified
   `quarto add` from a clean directory.

## Testing

Three layers, all runnable headless:

- **Unit** — the transform is a pure function over a block list, exercised under `pandoc lua` with
  hand-built AST fixtures. Fast, and where the edge cases live.
- **Golden equivalence** — the idea's own acceptance criterion: render `fixtures/<case>.qmd` (with
  `title-slides: true`) and `fixtures/<case>.expected.qmd` (the same deck with the titles typed out
  by hand, no filter) and assert the two outputs match after normalising ids and generated
  boilerplate. This is what makes "must be equivalent to" a test rather than a claim.
- **Smoke** — `quarto render` of a real deck to `revealjs` (and each other supported format),
  asserting the expected number of `<section>` elements and their titles.

## Risks / things to verify early

- **`---` directly under a text line is a setext heading, not a rule.** In the idea's example,
  `blabla` followed immediately by `---` parses as a level-2 heading *titled* "blabla" — the rule
  never reaches the filter. A blank line before `---` is required. This affects whether the sample
  works verbatim; see *Open Questions*.
- **Filter ordering.** User filters run before Quarto's built-ins by default. If Quarto's revealjs
  filters transform headings in a way that conflicts, the extension may need to declare itself
  after `quarto`. M0 answers this.
- **Duplicate ids.** Copying a heading naively yields repeated anchors, which breaks in-deck links
  and the reveal menu. Handled in M3, but it is the most likely source of subtle breakage.
- **Beamer.** A continuation frame with a repeated title is conventional there, but frame
  splitting, `allowframebreaks` and the `(cont.)` convention differ enough from revealjs that
  beamer support may be more than a free side effect.
- **Quarto version churn.** `quarto.metadata.get` and extension layout are stable but not frozen;
  pin the Quarto version in the flake and state the minimum supported version in the README.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Which output formats must this support? The example's frontmatter says `type: pdf`, but Quarto's key is `format:`, and plain `pdf` is an article, not a deck — `---` creates no slide there. Is the real target `revealjs` only, `beamer` (i.e. `format: beamer`) as well, or both plus `pptx`?
- [ ] Activating the extension needs two things in the document: `filters: [title-slides]` (or a project-level `filters:` entry) to load it, and `title-slides: true` to switch it on. Is requiring both acceptable, or should the extension instead ship a custom *format* (e.g. `format: title-slides-revealjs`) so that one key is enough?
- [ ] Should the inherited title be marked as a continuation — `Introduction (cont.)`, a configurable suffix, or nothing at all (the literal reading of the idea)? Should the marker default differ per format, given beamer's `(cont.)` convention?
- [ ] How does a user opt a single slide out of inheriting the title, when the whole point of `---` is that it takes no heading? Options: an empty `##`, a `{.no-title}` attribute on the rule, or nothing — no escape hatch in the first version.
- [ ] The idea's example has `blabla` immediately followed by `---`, which markdown parses as a setext heading, so it will not behave as the example implies. Should the extension just document "leave a blank line before `---`", or actively warn (or even reinterpret) when it detects a level-2 setext heading in a `title-slides: true` document?
