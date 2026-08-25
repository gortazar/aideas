# Plan: title-slides 0.3.1 — `show-index: true` that shows no index

Difficulty estimate: medium — the code change is small and local, but it turns on a contract decision
(what an index means in a deck with no `#` sections) and it rewrites tests that currently pin
"no sections, no index slide" as *correct* behaviour.

## Context

The report: **the index is never shown, although `show-index: true` is set in the frontmatter.** No
error, no warning — the deck renders, and the index simply is not there.

The leading hypothesis is not a defect in the index code at all but the contract it was written to.
`insert_indexes` calls `sections_of`, which collects headings with `level < slide_level` — `#`
headings when slides start at `##` — and returns the blocks unchanged when there are none. The deck
this reporter renders is almost certainly `tests/T4-funciones.qmd`, the same one that drove 0.3: it
sets `show-index: true` and `title-slides: true` in good faith and contains **fourteen `##` headings
and not a single `#`**. So it has no sections, no index is inserted, and 0.3 shipped a test asserting
exactly that:

> **`show-index` on a deck with no sections is pinned** by this fixture: no index slide, no warning,
> no crash, for a document that sets the key in good faith.

That test passes. The user is still looking at a deck with no index. That gap — between a pinned
"correct" behaviour and a document that asked for a feature and got silence — is the bug this entry
fixes. The README's troubleshooting already says "if `show-index: true` produces no index slides, the
deck probably has no sections"; documentation that explains away a silent no-op is not the same as
the feature working.

Candidate causes, in the order U0 should eliminate them. Only the first is a design question; the
rest are cheap and would each change the entry's centre of gravity if true:

1. **The deck has no `#` sections**, so the feature is structurally inert. Expected to be the answer,
   given the fixture already in the suite. Fix is semantic, below.
2. **A stale install.** `show-index` did not exist before 0.2. A user still on the v0.1 zip — and
   this reporter's previous issue *was* an installation problem — sees the key ignored with no error
   whatsoever, which matches the report word for word. `quarto list extensions` prints the installed
   version; the troubleshooting section must say to check it.
3. **The key is not where the filter looks.** `show-index` nested under `format: revealjs:` rather
   than at the top level, or written `show-index:true` with no space after the colon (as the report
   itself spells it), which YAML does not read as a mapping key at all.
4. **The index is generated but never reachable.** 0.2 recorded that reveal nests an index slide into
   the preceding section's vertical stack. Under a non-linear `navigation-mode`, or with the
   `unlisted` class that every generated heading carries, a slide can exist in the HTML and never be
   seen. Every test we have inspects the AST or the HTML source; none of them asserts that the slide
   is on the path a viewer actually walks. If this is the cause, the fix is placement, not semantics.
5. **All sections hidden.** Every `#` marked `.unlisted` or `visibility="hidden"`, or `slide-level: 1`
   / `0`, under which the extension defines no sections at all.

The fix this plan assumes, stated rather than asked: **`show-index: true` must never silently produce
nothing.** Concretely, when a deck has no visible sections, the index falls back to listing the
deck's *slide-level* headings — the `##`s — as a single index slide at the top of the deck, an
agenda. Before every slide would double a fourteen-slide deck; before every section is meaningless
when there are none. A deck that does have sections keeps 0.2's behaviour byte for byte, so the
fallback is reachable only from the case that today produces silence. Where even that finds nothing
to list — a deck with no headings at all — the filter warns, naming the key and the reason, through
the same `quarto.log.warning` path the setext check uses.

Further assumptions:

- **This is 0.3.1, as the idea asks.** Worth saying plainly once: by semver this is a behaviour
  change, not a bug fix, since output that was pinned as correct becomes different output. The entry
  proceeds as a patch on the reporter's instruction, and the release notes describe the new
  behaviour rather than burying it.
- **The reporter's deck is the acceptance test.** `tests/fixtures/real-deck/T4-funciones.qmd` is
  already upstream and already rendered by `nix flake check`. Its expected outline moves from
  fourteen slides to fifteen, and that diff *is* the proof the bug is fixed.
- **No new frontmatter key.** An `index-level:` option is the obvious alternative and is left in Open
  Questions; a key the reporter would have had to know about does not fix a silent no-op.

## Features

- **`show-index: true` always does something visible.** A deck that sets the key gets an index or a
  warning explaining why it cannot have one. Silence is no longer a possible outcome.
- **An agenda for a section-less deck** — one index slide at the top, listing every slide-level
  heading in document order, titled from the deck's own `title:` exactly as today's index is.
- **The reporter's deck shows its index** — the real-deck fixture's pinned outline gains the slide,
  with the fourteen accented titles listed on it, and the test fails if the index disappears again.
- **Decks with sections are untouched** — the 0.2 index behaviour is unchanged, asserted by the
  existing golden fixtures passing byte-identically rather than by inspection.
- **Duplicate headings on the agenda stay distinct** — `Definición` twice and `Parámetros por
  defecto` three times are listed as they are written, and the generated heading's identifier comes
  from the same `taken_identifiers` table, so it cannot collide with anything in the deck.
- **The index is asserted to be reachable, not merely present** — the render test checks where the
  index `<section>` sits in the HTML (top level, not nested inside another slide's vertical stack)
  and that nothing renders it hidden. This is the assertion that would have caught candidate 4, and
  the one class of failure our AST-level tests structurally cannot see.
- **Diagnosis for the causes that are not ours** — README troubleshooting gains: check the installed
  version with `quarto list extensions` (the key does nothing before 0.2), keep `show-index` at the
  top level of the frontmatter and not inside `format:`, and the `show-index:true` spacing trap.
- **Hidden headings stay hidden in the fallback** — `.unlisted` and `visibility="hidden"` slide-level
  headings are left off the agenda, the same rule the section index already follows.
- **The degenerate cases are re-pinned deliberately** — no headings at all, one slide, `slide-level: 1`
  and `slide-level: 0`, and a deck with both features on: each gets an updated expectation written
  as a decision, not as a test edited until it passed.
- **Released and installable** — `_extension.yml` at 0.3.1, tag cut upstream with the zip attached
  and verified present, both install paths re-checked from clean directories by rendering the real
  deck, then the gitlink and `flake.lock` moved here together with `scripts/check-pin.sh` green.

## Approach

Units, each one commit, tests first:

1. **U0 — pin, baseline, reproduce.** `git submodule update --init`, `scripts/check-pin.sh`, full
   suite green before any change; the sweep has reverted this gitlink once already. Then reproduce:
   render the real deck as the user does and confirm no index appears; walk candidates 2–5 above
   deliberately (a v0.1 install, the key under `format:`, the no-space spelling, a hidden-sections
   deck, `slide-level: 1`) and write down which produce this exact symptom. **No fix is designed
   before this unit finishes.** If candidate 4 turns out to be live — the index in the HTML but
   unreachable — the rest of the plan is placement work and the fallback below is a separate concern.
2. **U1 — the failing test.** Update the real-deck expected outline to the fifteen slides it *should*
   have and add the reachability assertions; add unit fixtures for a section-less deck with and
   without a title. Both fail. Commit them failing is not an option under the suite's own rules, so
   this unit lands with U2 if that is what keeping CI green requires — but the expectation is written
   before the implementation either way.
3. **U2 — the fallback.** `sections_of` returning empty becomes a branch, not an early return:
   collect slide-level headings by the same visibility rule, build one index slide, insert it before
   the first block. Keep `insert_indexes` a pure function over top-level blocks so the unit tests can
   drive it directly. Ordering against the carry matters — the agenda heading sits at the slide level
   and must be `title-slides-index`-classed so `is_generated` keeps the carry from adopting it; add
   the test that fails when that class is removed.
4. **U3 — the warning, and the cases that stay silent.** A deck that sets the key and has no heading
   to list warns once with the reason. Re-pin every degenerate case listed in Features, and confirm
   each new test can fail by perturbing its expectation.
5. **U4 — docs and release.** README: what the index lists in a deck without sections, the agenda
   example, and the three troubleshooting entries from U0; bump `_extension.yml` to 0.3.1; cut the
   tag and confirm the tag *and its asset* landed (`git ls-remote --tags`, then look at the release —
   the orchestrator's push carries no tag, so the workflow has to tag itself); verify both install
   paths from clean directories against the real deck; move the gitlink and `flake.lock` here
   together and check the remote CI run, not just the local one.

## Testing

- **Real deck** (`tests/run-real-deck.sh`, existing) — the acceptance test. Outline goes to fifteen
  slides with the agenda first; the filter-off run still gives fourteen, so the equivalence assertion
  there has to be restated as "the extension adds exactly the index" rather than "adds nothing".
- **Reachability** (new, folded into the same script) — the index `<section>` is a direct child of
  the slides container, carries no hiding class or inline `display:none`, and appears before the
  first content slide. Cheap string/structure assertions on the HTML; no browser.
- **Unit** — the fallback as a pure transform: section-less deck, no headings, hidden headings only,
  `slide-level: 1`/`0`, both features on together, and the `is_generated` guard.
- **Golden** — `index.qmd` and the other three fixtures must pass **byte-identically**; a diff there
  means the fallback leaked into the sectioned path and is a finding, not a fixture to update.
- **Smoke and install** — unchanged, both still run; the install test is the one that catches the
  stale-install cause going forward.

## Risks / things to verify early

- **The pin.** `scripts/check-pin.sh` before anything else; `STATUS.md` claiming 0.3 is not evidence
  that the gitlink points at it.
- **Re-pinning a test to make it pass is exactly what a broken fix looks like.** The real-deck outline
  changes in this entry by design, so every other expectation must be defended: if a golden fixture
  needs touching, that is a bug in the change, not a chore.
- **The agenda could be adopted as a carried title.** Same trap 0.2 flagged; it is currently
  structurally impossible because a section heading always follows an index, and the fallback breaks
  that — the agenda is followed by an ordinary `##`. The `is_generated` check is now load-bearing.
  Test that it fails when removed.
- **A fifteenth slide changes `slide-number: c/t`** and every in-deck link that counts slides. Worth
  a sentence in the README rather than a surprise.
- **Candidate 4 would invalidate the fix.** If index slides are generated but unreachable, adding one
  more generated slide changes nothing the user can see. Settle reachability in U0, on the sectioned
  example deck, before building the fallback.
- **`upstream/` is a detached-HEAD submodule** — `git push origin HEAD:main` and confirm with
  `git ls-remote origin main` before calling a unit done; a plain push prints nothing and does nothing.
- **The release workflow must create its own tag**; the orchestrator's push carries none.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] Where does the agenda go in a section-less deck? Ticking this line as-is puts **one index slide
      at the very top of the deck**, listing every slide, with nothing emboldened since no single
      slide is "next". The alternative — an index before *every* slide, mirroring the section rule —
      turns a fourteen-slide deck into twenty-eight and is rejected unless the reporter wants it. 
      In a section-less deck no agenda is inserted.
- [x] Should the fallback be automatic, or an opt-in `index-level: 2` key? Ticking this line as-is
      makes it **automatic**, on the grounds that a key the user would have to discover does not fix
      a silent no-op. An explicit key is the cleaner semver story and could still be added later as
      the way to index a level other than the default.
- [x] Is the reporter's deck really `T4-funciones.qmd`? Ticking this line as-is **assumes it is** and
      treats that fixture's outline as the acceptance criterion. If the failing deck does have `#`
      sections, candidate 4 (generated but unreachable) becomes the likely cause and U0's findings
      redirect the entry.
