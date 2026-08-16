status: in_progress
version: 0.1
started_at: 2026-08-16
last_session_id:
last_run: 2026-08-16

Difficulty estimate: medium — unchanged. The spike (M0) removed most of the uncertainty:
the mechanism works exactly as the plan assumed, so what is left is edge cases,
identifiers and shipping.

Upstream: https://github.com/gortazar/title-slides (submodule at `upstream/`, pointer
committed).

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

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
<!-- The honest progress report: one line per unit of work, ticked only once it is
     committed with its tests passing. Refresh this at every unit, not at session end.
     Keep "next" to the single unit being started now. -->
- [x] M0 — spike: confirmed rules survive, inserted headings split slides, ids/classes land
- [x] Extension skeleton + title inheritance across top-level rules, with the metadata
      switch (5 unit tests, `nix flake check` green upstream)
- [x] Wrapper here: `upstream` submodule, `flake.nix` consuming it, `scripts/check-pin.sh`,
      root CI running both
- [ ] Explicit titles win: `---` followed by its own `##`, and `#` resetting the carried title
- [ ] Scoped to top-level blocks: rules inside divs, callouts, columns, quotes untouched
- [ ] Unique identifiers and the `title-slides-continuation` class
- [ ] Keep continuations out of the table of contents
- [ ] `slide-level` awareness, including `slide-level: 0`
- [ ] Warn on setext headings in a `title-slides: true` document
- [ ] Golden equivalence tests (filtered vs. hand-written deck)
- [ ] Smoke test: `quarto render` to revealjs, asserting sections and titles
- [ ] README screenshots, release workflow, verified `quarto add` from a clean directory

Next: explicit titles win — a `---` that already has its own `##` is left alone, and a
`#` section slide clears the carried title.
