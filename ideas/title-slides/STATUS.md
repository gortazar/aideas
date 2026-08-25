status: in_progress
version: 0.4
started_at: 2026-08-16
last_session_id: 498f8809-49e3-4e71-b8bb-3905366ad588
last_run: 2026-08-25T11:01:20+02:00
last_cycle_cost_usd: 13.913596000000002

## Log

### 2026-08-25 — 0.5, U0: pin, baseline and the before picture

Pin intact (gitlink and `flake.lock` both at `e15b38a`), 0.4 green before any change: 104
unit tests, 4 golden cases, smoke, real-deck and install.

Recorded what the three decks do **today**, from real renders rather than from reading the
goldens, so the 0.5 diff is measured against evidence:

- **The reporter's deck** — 14 slides, no index, and 0.4's warning that it has no section
  headings.
- **`tests/fixtures/index.qmd`** — three `#` sections, an index before each, listing
  `Beginnings | Middles | Ends`.
- **`example/deck.qmd`** — two `#` sections, an index before each, four continuations.

The deck's fourteen `##` headings, which decide the new index's contents:

```
Definición, Definición, Llamado, Retorno de Valores, Retorno de valores,
Argumentos nombrados, Argumentos nombrados, Parámetros por defecto,
Parámetros por defecto (trailing space), Parámetros por defecto,
Parámetros opcionales, Parámetros opcionales, Paso de funciones a funciones,
Funciones lambda
```

Two things this settles for the answered "collapse identical consecutive titles" rule:
`Retorno de Valores` and `Retorno de valores` differ only in case and so are **two**
entries, and one `Parámetros por defecto` carries a trailing space, so whether the run of
three collapses depends on pandoc stripping it. Both are checked in U2 rather than assumed.

- 2026-08-25T11:01:20+02:00 — done ($13.913596000000002)
- 2026-08-24T18:26:27+02:00 — done ($13.305927500000001)
- 2026-08-24T08:17:45+02:00 — done ($15.026146999999996)
- 2026-08-16T21:29:26+02:00 — done ($12.985914499999996)


### 2026-08-25 — 0.4 delivered: show-index explains itself

Released as [v0.4](https://github.com/gortazar/title-slides/releases/tag/v0.4).

**The entry shipped a warning, not the agenda the plan describes.** The plan's centrepiece
was a fallback index listing the deck's `##` headings, with the real deck growing from
fourteen slides to fifteen. Its own first open question was answered *"In a section-less
deck no agenda is inserted"*, which removes that fallback and everything hanging off it —
the fifteenth slide, the agenda's identifiers, its hidden-heading rule, and the second
question about making the fallback opt-in. What remained of the report was that the deck
asked for a feature and got **silence**, and that is what was fixed: `show-index: true`
with nothing to index now warns, naming the key and giving the reason, and inserts nothing.

Note on the version: the plan's prose calls this 0.3.1, but `CLAUDE.md`'s versioning rule
uses two integer components and its cycle block named 0.4 as the version to set, so this
shipped as 0.4 / `_extension.yml` 0.4.0 / tag `v0.4`.

Worth keeping:

- **The warning distinguishes three causes**, because they send the author to different
  places: no `#` headings at all, every `#` hidden, or a `slide-level` that leaves no
  heading below it. A single generic message would have been nearly as unhelpful as
  silence.
- **`quarto render --quiet` suppresses the warning** along with everything else, so the
  real-deck test renders without it. Anyone debugging "nothing happened" has to drop
  `--quiet` to see why.
- **The sectioned path is provably untouched**: all four golden fixtures still match byte
  for byte, which is the check the plan asked for.
- **Fourteen tests go red if the warning is removed** — verified by removing it.

### 2026-08-25 — 0.3.1/0.4, U0: reproduced, and the plan redirected

Pin was intact this time (gitlink and `flake.lock` both at `1ba5baa`), 0.3 suite green
before any change.

**Reproduced the report exactly.** The reporter's deck renders, `show-index: true` is set,
and there is no index slide, no warning and no error. It has fourteen `##` headings and
zero `#`, so it has no sections and the feature is structurally inert on it. Candidate 1.

Walked the other candidates rather than assuming, and two of the plan's guesses were wrong:

| candidate | verdict |
| --- | --- |
| 1 — the deck has no `#` sections | **confirmed, this is the reporter's deck** |
| 2 — a stale v0.1 install | **reproduces the symptom word for word**: key ignored, total silence. `quarto list extensions` reports `0.1.0`, which is the diagnostic |
| 3a — key nested under `format: revealjs:` | **not a failure mode at all** — it works, Quarto folds format metadata into the document metadata. The plan's advice to keep the key top-level would have been wrong |
| 3b — `show-index:true` with no space | fails loudly with a YAML parse error, so it cannot be this report |
| 4 — generated but unreachable | **dead.** Index slides render and are reachable by their own URL fragment, emphasis correct, including the ones reveal nests into the preceding vertical stack. The only `display: none` in the output is Quarto's hidden footer template |
| 5 — all sections hidden, or `slide-level: 1` | reproduces the same silence, so it belongs to the same fix |

**Candidate 4 being dead is what matters most**: the feature works, and the entry stays a
semantics-and-diagnostics change rather than becoming placement work.

**The plan's proposed fix is rejected by its own answered question.** The plan is built
around a fallback agenda listing the `##` headings, and says the real-deck outline should
grow from fourteen slides to fifteen. The answer to the first open question says instead:
*"In a section-less deck no agenda is inserted."* So no agenda is built, the real-deck
outline stays at fourteen, and the second question (automatic vs. an `index-level:` key)
is moot — there is no fallback to make automatic.

What survives the answer is the part that made this a bug report: **silence**. So
`show-index: true` on a deck with nothing to index now warns, naming the key and the
reason, and inserts nothing. Every other feature bullet in the entry that depended on the
agenda — its identifiers, its hidden-heading rule, the fifteenth slide — falls away with it.



### 2026-08-24 — 0.3 delivered: the real deck as a test

Released as [v0.3](https://github.com/gortazar/title-slides/releases/tag/v0.3). What this
entry actually settled, beyond the fixture:

- **The bug was never in the extension.** See the U0 diagnosis below: the reported message
  is what Quarto prints when it cannot find the extension at all, and it never found it
  because `_extensions/` was not beside the document. So the deliverable is a fixture, an
  installation test and a troubleshooting section — not a code change. The filter is
  unchanged by this entry apart from the version in `_extension.yml`.
- **The install test is not vacuous.** Packaging the extension under a versioned directory
  name makes it land as `_extensions/title-slides-0.2/`, and the assertion fires — Quarto
  keeps whatever directory name the archive carries. That is candidate 2 from the plan,
  now permanently guarded even though it was not what happened here.
- **`quarto list extensions` writes its table to stderr**, so a test grepping its stdout
  sees nothing and "passes" or fails for the wrong reason. Fold stderr in.
- **The install test cannot live in `nix flake check`** — the build sandbox has no network.
  It runs as its own CI step, and skips loudly rather than quietly when offline. Confirmed
  from the CI log that it really ran rather than skipping.
- **The real deck renders hermetically** inside the nix sandbox despite
  `embed-resources: true`, which the plan flagged as a risk. No network needed.
- **A 115-byte placeholder satisfies `logo:`** and embeds without the missing-resource
  warning, so the frontmatter stayed untouched.

### 2026-08-24 — 0.3, U0: the reported failure, diagnosed

**The pin here really was stale, and it was the sweep that did it.** `flake.lock` named the
0.2 commit `7c60db8` while the `upstream/` gitlink named the 0.1 commit `77e5b51`. The
culprit is commit `09235d9` "title-slides: automated build cycle (progress)" — the
orchestrator's end-of-cycle sweep — which reverted the gitlink while leaving `STATUS.md`
saying 0.2. `scripts/check-pin.sh` caught it, which is exactly what it is for. Restored the
gitlink to `7c60db8`; both pins agree and the 0.2 suite (89 unit tests, golden, smoke) is
green before any change.

**Root cause of the user's failure: the extension was not installed in the directory that
matters.** Reproduced each candidate against the real deck:

| set-up | result |
| --- | --- |
| no `_extensions/` at all | **the reported message, verbatim** |
| `_extensions/gortazar/title-slides/` beside the document | renders fine |
| the same, from a directory named `…/Módulo II - Python/Material` | renders fine |
| `_extensions/` in the document's **parent** directory | **the reported message** |
| the same, with a `_quarto.yml` project root at the parent | **the reported message** |
| `quarto-required` excluding the running Quarto | a different, clear error |

So **Quarto looks for `_extensions/` next to the document and does not search upwards** —
not the parent, not even the project root. The user had the folder, just not in the folder
holding `T4-funciones.qmd`; `quarto add` had been run somewhere else in the OneDrive tree.
`quarto list extensions`, run in the document's own directory, says
"No extensions are installed in this directory" and is the diagnostic to document.

Eliminated with evidence, not assumed: the installed directory name is right
(`_extensions/gortazar/title-slides`, resolved by `filters: [title-slides]`), spaces and
accents in the path are harmless, and a `quarto-required` mismatch produces its own
explicit message rather than this one. **The extension's own code is blameless**, so this
entry is a fixture, an installation test and troubleshooting docs rather than a code fix.

The deck itself renders to its 14 slides with the accents intact, and the extension adds
and removes nothing: it has no top-level `---` to carry a title across and no `#` section
to index, so both features are structurally inert on it. The only complaint is the missing
`codigus.png`, a warning rather than an error.



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

## What "done" covers for 0.4

- **`show-index: true` is never silent.** A deck that sets it either gets index slides or a
  warning naming the key and explaining why it cannot have any.
- **No agenda is invented** for a section-less deck — the answered decision. The document
  is returned exactly as it arrived.
- **The reason is specific** — no section headings, all sections hidden, or a `slide-level`
  of 1 or 0 — and it is emitted once per document, not once per slide.
- **The reporter's deck is the acceptance test**: `tests/fixtures/real-deck/` renders to
  its fourteen slides with accents and distinct identifiers intact, injects nothing, and
  now emits the explanation. The test asserts the warning as well as the outline.
- **Decks with sections are untouched** — all four golden fixtures match byte for byte, and
  the smoke test's two index slides are unchanged.
- **The degenerate cases are re-pinned as decisions** — no sections, no headings at all,
  one heading, hidden sections, `slide-level` 1 and 0, a `#` nested in a div, and both
  features on together: each asserts the warning rather than merely tolerating it.
- **Diagnosis for the causes that are not ours** — README troubleshooting covers checking
  the installed version with `quarto list extensions` (no warning at all means an install
  older than 0.4), the `--quiet` trap, and the `show-index:true` spacing trap. It also
  records the two candidates the plan guessed at that turned out to be wrong.
- **Released and installable** — `_extension.yml` at 0.4.0, `v0.4` tagged with
  `title-slides-0.4.zip` attached and verified present. Both install paths re-checked from
  clean directories: the reporter's deck warns and stays at fourteen slides, and a
  sectioned deck still gets its index slides with no warning.

104 unit tests, 4 golden cases, the smoke test, the real-deck test and the install test.

## What "done" covers for 0.3

The 0.3 entry is delivered, tested and released. Every feature it listed:

- **The failing deck is a test upstream** — `tests/fixtures/real-deck/T4-funciones.qmd`,
  byte for byte as it failed, attributed to Francisco Gortázar under CC-BY-4.0 per its own
  frontmatter, with a 115-byte `codigus.png` placeholder so the frontmatter stayed
  untouched. `nix flake check` renders it.
- **The test renders it the way a user does** — into a temp directory holding
  `_extensions/gortazar/title-slides/`, with the filter resolved by name, never by path.
- **The render is asserted** — the 14 slides in order with their accented titles, from a
  pinned expected outline. Confirmed it fails when the expectation is perturbed.
- **A no-op deck is proven to be a no-op** — the same deck with the filter switched off
  gives the same outline, and no continuation or index marker appears in the output.
- **Duplicate and case-colliding headings survive** — 14 slides, 14 distinct identifiers,
  despite `Definición` twice, `Parámetros por defecto` three times and
  `Retorno de Valores` against `Retorno de valores`.
- **The root cause is addressed at its source** — which U0 established is *where the
  extension was installed*, not the extension. Hence documentation, plus a test that
  asserts the installed layout instead of trusting it.
- **An installation test that would have caught it** — installs the published release into
  an empty directory, asserts something lands at a path ending in `title-slides`, that
  `quarto list extensions` reports it, and that a document naming the filter renders with
  the title carried. Proven to fail on a versioned directory name.
- **Troubleshooting in the README** — the error quoted verbatim, what it means, how to
  check with `quarto list extensions` from the document's directory, the fix, and the two
  candidates ruled out by experiment.
- **`show-index` on a deck with no sections is pinned** by this fixture: no index slide, no
  warning, no crash, for a document that sets the key in good faith.
- **Released and installable** — `_extension.yml` at 0.3.0, v0.3 tagged with
  `title-slides-0.3.zip` attached and verified present. Both install paths re-checked from
  clean directories by rendering *the real deck* through them; the gitlink and `flake.lock`
  moved here together with `scripts/check-pin.sh` green.

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

### 0.3 — the real deck as a test
- [x] U0 — pin reconciled (the sweep had reverted it), 0.2 baseline green, and the
      reported failure reproduced and diagnosed: `_extensions/` must sit beside the document
- [x] U1 — the fixture upstream, attributed and licensed, with the render test (U3's
      assertions folded in: outline, accents, no-op proof, identifier uniqueness)
- [x] U2 — the installation test: installs the published release into an empty directory
      and asserts what lands; runs as its own CI step, skips loudly without a network
- [x] U3 — folded into U1, plus confirmation that both new tests can fail
- [x] U4 — README troubleshooting, `_extension.yml` at 0.3.0, v0.3 released, both install
      paths verified from clean directories against the real deck, pin moved here

### 0.4 — `show-index: true` that showed no index
- [x] U0 — pin verified intact, 0.3 baseline green, report reproduced and every candidate
      walked: the deck simply has no sections, and two of the plan's guesses were wrong
- [x] U1/U2 — the decision implemented: warn, naming the key and the reason, and insert
      nothing; the degenerate cases re-pinned to assert the warning
- [x] U3 — the real deck as the acceptance test: fourteen slides, no index, an explanation
- [x] U4 — README, `_extension.yml` at 0.4.0, v0.4 released, both install paths verified
      from clean directories, pin moved here

Next: nothing — 0.4 is done. 104 unit tests, 4 golden cases, the smoke test, the real-deck
test and the install test, all green.

Previously: 0.3 was done. 89 unit tests, 4 golden cases, the smoke test, the real-deck
test and the install test, all green.

Previously: 0.2 was done at 89 unit tests plus 4 golden cases and the smoke test, all
green in `nix flake check` upstream and at the pinned commit here.
