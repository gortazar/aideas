# Plan: title-slides — a real deck that fails to render, turned into a test

Difficulty estimate: medium — the change is probably small, but the root cause is not yet known: the
error comes from Quarto's *filter resolution*, before a single line of this extension runs, so the
first unit is diagnosis rather than code. The fixture also drags real-world baggage in with it (a
missing logo asset, `embed-resources`, accented duplicate headings, a 0.2 key on what may be a 0.1
install), and each of those can fail a render for reasons that have nothing to do with the bug.

## Context

A real lecture deck — `ideas/title-slides/tests/T4-funciones.qmd`, 236 lines, CC-licensed, in Spanish
— fails to preview with:

```
Could not run /…/Material/title-slides as a JSON filter.
Please make sure the file exists and is executable.
Did you intend 'title-slides' as a Lua filter in an extension?
```

Read that message carefully, because it says exactly one thing: **Quarto did not recognise
`title-slides` as an installed extension**, so it fell back to treating the `filters:` entry as a
path to an executable, resolved it against the document's directory, and failed. The extension's own
code never ran. Whatever is broken is in *installation, discovery or packaging*, not in
`title-slides.lua`.

The document's frontmatter is otherwise ordinary:

```yaml
filters:
    - title-slides
show-index: true
title-slides: true
format:
    revealjs:
        theme: sky
        logo: codigus.png
        slide-number: c/t
        toc: false
        embed-resources: true
```

Three things about the document itself are worth knowing before designing a test around it:

- **It has no top-level `---` and no `#`.** Fourteen `##` headings, nothing else. So both features are
  structurally inert on it: nothing to carry, no sections to index. This deck is a test that the
  extension *renders cleanly and changes nothing*, which is precisely the case a user hits first.
- **It repeats headings, including across case.** `## Definición` twice, `## Parámetros por defecto`
  three times (one with a trailing space), and `## Retorno de Valores` / `## Retorno de valores`
  differing only in a capital. Quarto derives slide ids from heading text, so this deck already
  contains duplicate anchors before the extension touches it — exactly the terrain
  `taken_identifiers` was written for.
- **It references `codigus.png`, which we do not have**, and asks for `embed-resources: true`.

Where the repo stands, checked rather than assumed: `STATUS.md` and `plans/02-2026-08-24.md` say 0.2
shipped `show-index` and that the pin moved here, but the `upstream/` working tree in this checkout is
at **0.1** — `_extension.yml` reads `0.1.0`, `title-slides.lua` contains no `show-index`, and
`README.md` still installs `@v0.1`. Either the submodule is not at the pinned commit or the pin never
moved. This has to be settled first, because it decides which code is being fixed — and because
"user's document sets a 0.2 key" is itself a candidate explanation for confusion, though not for
*this* error.

Candidate root causes, in the order they should be eliminated (U0 does this):

1. **Not installed at all in that directory.** The commonest reading of the message. The deck lives in
   an Insync/OneDrive tree; Quarto walks up from the document looking for `_extensions/`, and if the
   user ran `quarto add` somewhere else, or in a parent that is not the render root, discovery fails.
   If this is it, the fix is documentation and a much better troubleshooting section, not code.
2. **Installed under a name that does not match `title-slides`.** If the attached release zip unpacks
   with a versioned top-level directory, the extension lands as `_extensions/title-slides-0.2/` and
   `filters: [title-slides]` cannot resolve it. This produces *precisely* the reported message and is
   fully our fault. Test by installing from the published v0.2 zip into a clean directory and looking
   at the resulting path.
3. **The path.** `OneDrive Biz/Asignaturas/LP/Módulo II - Python/Material` has spaces and non-ASCII in
   it. Reproduce under a directory with the same shape before ruling it out.
4. **`_extension.yml` not being read as a contribution** — wrong key, wrong filename, `quarto-required`
   excluding the user's Quarto. Cheap to check, cheapest to rule out.

Assumptions stated rather than asked:

- **The fixture goes upstream verbatim**, byte-for-byte as it failed, under
  `tests/fixtures/real-deck/T4-funciones.qmd` with a `README`/`LICENSE` note naming Francisco Gortázar
  as author and the CC licence. Editing the frontmatter to make it convenient would throw away the
  only thing that makes it valuable: it is the file that broke.
- **A placeholder `codigus.png` ships beside it**, a few-hundred-byte image, so the frontmatter can
  stay untouched and the render still resolves the logo. The alternative — deleting the `logo:` line —
  edits the evidence.
- **This is a patch release, 0.2.1**, unless U0 shows the fix changes rendering behaviour, in which
  case it is 0.3. Additive documentation and a new test do not move a minor version.
- **The idea's `tests/` copy stays** where it is as the source of record; upstream gets a copy, since
  the extension's suite must be runnable from a clone of the extension alone.

## Features

- **The failing deck is a test upstream** — `T4-funciones.qmd` lives in the extension's own repo,
  attributed and licensed, and `nix flake check` renders it. The bug cannot come back unnoticed.
- **The test renders it the way a user does** — into a clean temp directory holding `_extensions/`
  exactly as `quarto add` installs it, with `filters: [title-slides]` resolved by name, not by path.
  The reported failure was a resolution failure, so a test that bypasses resolution would pass while
  the user still cannot render.
- **The render is asserted, not just exit-code-checked** — the produced HTML has the fourteen slides
  the document has, in order, with their titles (accents intact), and the extension has added and
  removed nothing, since this deck has no rule to carry across and no section to index.
- **A no-op deck is proven to be a no-op** — the same document rendered with and without the filter
  produces the same slide outline. That is the strongest available statement of "the extension works
  as expected" for a document that asks for both features and structurally needs neither.
- **Duplicate and case-colliding headings survive** — `Definición` twice, `Parámetros por defecto`
  three times, `Retorno de Valores` vs `Retorno de valores`: the deck keeps distinct slides with
  distinct ids and the extension does not make the collisions worse.
- **The root cause is fixed at its source** — whichever of the four candidates U0 confirms: a packaging
  fix if the installed directory name is wrong, a discovery fix if the path is at fault, and in every
  case the install path is verified from a clean directory rather than assumed.
- **An installation test that would have caught it** — install from the published release artefact
  into an empty directory, assert the extension lands at a path whose final component is
  `title-slides`, and render a one-slide deck through it. This is the check that turns "verified once
  by hand" into something CI repeats.
- **Troubleshooting in the README** — the exact error text from this report, quoted, with what it
  means (Quarto did not find the extension, not "the filter is broken"), how to check
  (`quarto list extensions`, where `_extensions/` must sit relative to the document), and the fix.
  Whatever the root cause, this message will be someone's first encounter with the extension failing.
- **`show-index` on a deck with no sections is explicitly pinned** by this fixture — no index slide,
  no warning, no crash — for a document that sets the key in good faith.
- **Released and installable** — `_extension.yml` bumped, tag cut upstream with the zip attached and
  *verified present*, both install paths re-checked from clean directories, then the submodule gitlink
  and `flake.lock` moved here together with `scripts/check-pin.sh` green.

## Approach

Units, each one commit, tests first:

1. **U0 — reconcile the pin, then reproduce.** `git submodule update --init`, `scripts/check-pin.sh`,
   and establish whether `upstream/` is at 0.1 or 0.2 and which commit this repo pins; get the suite
   green before touching anything. Then reproduce the user's failure deliberately, walking the four
   candidates above: render `T4-funciones.qmd` with no `_extensions/` present (expect the reported
   message verbatim — that alone tells us what the message means), with a correct flat install, with
   an owner-scoped `_extensions/gortazar/title-slides/`, from the published v0.2 zip, and from a
   directory whose name has spaces and an accent. Write down which combinations fail. **No fix is
   designed before this unit finishes**; everything after it depends on the answer.
2. **U1 — the fixture, as a failing test.** Add `T4-funciones.qmd`, the placeholder logo and the
   attribution/licence note upstream; add a render test that fails today for the reason U0 identified
   and passes once fixed. If U0 shows the extension itself is blameless and the cause was a missing
   install, this test still lands — it becomes the regression net for the packaging test in U2.
3. **U2 — the fix and the installation test.** Whatever U0 found: correct the packaging or discovery,
   and add the clean-directory install check to the suite so the shape of what `quarto add` produces
   is asserted rather than trusted.
4. **U3 — assertions on the render.** Extend `deck-outline.lua` (or add a small reader beside it) to
   dump this deck's slide sequence and titles; pin it as an expected outline; add the
   filter-on/filter-off equivalence run. Confirm the new test can fail by perturbing the expectation.
5. **U4 — docs and release.** README troubleshooting section with the quoted error; note the fixture's
   provenance and licence; bump `_extension.yml`; cut the tag and confirm the tag and its asset really
   landed (`git ls-remote --tags`, then look at the release — the orchestrator's push carries no tag);
   verify both install paths from clean directories; move the gitlink and `flake.lock` here together.

## Testing

The three layers already wired into `nix flake check`, plus one new one:

- **Render** (new, `tests/run-real-deck.sh`) — `T4-funciones.qmd` into a temp directory laid out as
  `quarto add` leaves it, asserting the slide outline, the titles with their accents, and that the
  filter-on and filter-off outlines agree.
- **Install** (new, folded into the same script or its own) — install from the release artefact into
  an empty directory, assert the extension's directory name, render through it. Needs network, so it
  is guarded: skipped with a clear message when unavailable, never silently passing.
- **Golden and unit** — unchanged, as the no-regression check. The existing fixtures must still pass
  byte-identically; a fix to packaging should not touch the AST at all, and if it does, that is a
  finding.
- **Smoke** — unchanged.

## Risks / things to verify early

- **The stale `upstream/` checkout.** The tree here is at 0.1 while STATUS claims 0.2 shipped. Building
  on the wrong base wastes the whole entry — settle it in the first ten minutes of U0.
- **`embed-resources: true` needs no network, but the nix check sandbox has none.** Confirm this deck
  renders inside `nix flake check` and not merely in a dev shell; if reveal's assets need fetching,
  the render test has to be structured like the install test, with an explicit skip rather than a
  mystery failure.
- **A missing `logo:` may fail the render on its own**, which would look like the extension's fault.
  Verify the placeholder actually satisfies it before writing assertions around it.
- **The document's duplicate headings mean Quarto emits duplicate-id warnings of its own.** Do not
  chase them as a bug and do not let `set -e` plus a `--strict`-ish flag turn them into a failure that
  masks the real assertion.
- **A test that renders by path would pass while the user still fails.** The bug is name resolution;
  keep every new test going through `filters: [title-slides]` from an installed `_extensions/`.
- **The fixture is someone's teaching material.** Attribution and licence file land in the same commit
  as the `.qmd`, not later.
- **`upstream/` is a detached-HEAD submodule**, so a plain `git push` inside it is a silent no-op —
  push `HEAD:main` and confirm with `git ls-remote origin main` before calling a unit done.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Which licence does the fixture carry? The idea text says **CC-BY-SA-4.0**; the document's own
      frontmatter says `license: CC-BY-4.0`. Both permit redistribution with attribution, so the test
      lands either way — but the `LICENSE` note shipped beside it should say the right one. Ticking
      this line as-is takes the **document's own frontmatter, CC-BY-4.0**, as authoritative and notes
      the author's name from it.
- [ ] Was the extension actually installed in that directory when the render failed? Ticking this line
      as-is assumes **it was** (so there is a packaging or discovery bug to find, and U0 will identify
      which). If it was not, the entry's centre of gravity moves to the troubleshooting docs and the
      installation test, and the "fix" is that the extension can no longer be silently half-installed.
- [ ] Does the fixture render under `pptx` too? The document's frontmatter carries a commented-out
      `pptx` block with a `reference-doc:`. Ticking this line as-is tests **revealjs only**, matching
      0.1's answered format question and leaving the commented block as the historical artefact it is.
