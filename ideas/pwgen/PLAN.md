# Plan: pwgen — close the five audit gaps against AGENTS.md

Difficulty estimate: medium — no single piece is hard, and most of the plumbing already exists in
`recap-gs` to copy from; what makes it medium is that five separate deliverables each have to land
through the upstream pull-request gate, and two of them (a published release, an installer) are only
done once verified against the live release from a clean directory.

## Context

`pwgen` shipped its 0.1 entry on 2026-08-06, before several of the rules now in `AGENTS.md` existed.
A fleet audit found five confirmed gaps. Three are missing deliverables the rules acquired later
(release, installer, upstream `flake.nix`); two are `STATUS.md` telling readers things that are not
true of the tree.

Verified while writing this plan:

- `https://api.github.com/repos/gortazar/gnome-shell-pwgen/releases` returns an empty list. There is
  no release and no tag, so the `v0.1` `STATUS.md` implies has never existed.
- `upstream/install.sh` runs `./compile-schemas.sh` and symlinks the checkout into
  `~/.local/share/gnome-shell/extensions/`. That is clone-and-build; `AGENTS.md` says it does not
  count as an installation method.
- There is no `upstream/flake.nix`. The flake is `ideas/pwgen/flake.nix`, written when the wrapper was
  where the environment lived; `AGENTS.md` now requires one in the idea's own repository.
- `flake.lock` locks `pwgen-src` at `57b3bf6a64fd4a8109dbe4e6eae1430545a41aa5`, while `STATUS.md`
  names `870d00e` twice as the pinned commit.
- `STATUS.md` says "`ci-pwgen.yml` has never run on GitHub. It cannot here: this repository's `origin`
  is a local bare repo in the sandbox." Origin is `github.com:gortazar/aideas` and the workflow has
  run at least five times.

Two things follow from that last one. The sentence is not just stale, it is the kind of claim that
*explains away* a missing check, so the whole file needs re-reading for others of the same shape —
that is the fifth gap's second half.

Assumptions, stated rather than asked:

- **The curl installer, not extensions.gnome.org, is this entry's installation path.** The entry says
  so explicitly. Submitting to EGO stays out of scope and stays recorded in `STATUS.md` as a
  publishing decision, not a build step.
- **The wrapper keeps a `flake.nix`.** `AGENTS.md` allows "a `flake.nix` that consumes the submodule"
  in the idea folder, and `recap-gs` is the model: upstream owns the checks, the wrapper re-exports
  them so `ci-pwgen.yml` runs upstream's real checks at the pinned commit rather than a second copy
  that drifts.
- **The existing symlink installer is kept, moved, not deleted.** It is how the extension is developed
  against a live session; `recap-gs` keeps the same thing at `scripts/install-local.sh`.
- **This entry is a minor update**, so it finishes at `version: 0.2` with a `v0.2` release. What to do
  about the `v0.1` that was never published is the open question below.

## Features

- **A release workflow in `gortazar/gnome-shell-pwgen`** — `.github/workflows/release.yml`, running the
  test suite and then publishing a GitHub release carrying
  `pwgen-generator@pwgen-gs.patxi.shell-extension.zip` and its `.sha256`. It triggers on a pushed
  `v*` tag *and* on `workflow_dispatch` with a version input, in which case **it creates the tag
  itself** — an agent that cannot push a tag must still be able to cut a release. Release notes open
  with the install one-liner.
- **The tag and the extension agree** — `metadata.json` gains `version-name`, and the workflow refuses
  to publish when the tag does not match it. A release whose asset describes a different version than
  the notes is the failure mode this exists to prevent.
- **A `curl`-able installer upstream** — `install.sh` becomes the recap-gs-shaped installer: downloads
  the asset for `latest` (or `VERSION=v0.2`) from GitHub releases, verifies it against the published
  checksum, unpacks into `${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/<uuid>`,
  recompiles the schema if `glib-compile-schemas` is present, and tries `gnome-extensions enable`,
  saying what to do on Wayland when that cannot work yet. No root, nothing built, nothing outside the
  extensions directory touched.
- **The old installer keeps working, under its real name** — the symlink-a-checkout script moves to
  `scripts/install-local.sh`, and every reference to it follows: `README.md`, the comment in
  `ci/smoke-test.sh`, and `tests/ci-scripts-test.js`.
- **Upstream `README.md` opens with the install command** — the one-line `curl … | sh` before any
  development instruction, with the local-checkout path demoted to a development section.
- **`flake.nix` in the extension repository** — dev shell (`gjs`, `glib.dev`, `nodejs`, `python3`,
  `zip`, `jq`, the `pwgen-pack` helper), `checks` for the headless unit suite, a `--strict` schema
  compile and the packed zip's contents, and `packages.default` producing the uploadable zip. This is
  a move of what `ideas/pwgen/flake.nix` already does, minus the `pwgen-src` indirection, since
  upstream can read its own tree.
- **The wrapper flake becomes a consumer** — `ideas/pwgen/flake.nix` takes `pwgen-src` as a *flake*
  input and re-exports `checks` and `packages.default` from it, so `nix flake check` here runs
  upstream's own checks at the pinned commit and there is exactly one definition of them.
  `scripts/check-pin.sh` keeps working unchanged: the input name stays `pwgen-src`.
- **`scripts/check-release.sh` in the wrapper** — the command that answers "is the release actually
  there", which `AGENTS.md` makes a precondition for `status: done`: the release exists for the
  version in `STATUS.md`, it carries the zip and the checksum, the checksum matches the downloaded
  asset, and the zip contains `metadata.json`, `extension.js`, `prefs.js`, `lib/generator.js` and
  `schemas/gschemas.compiled`. No token, no clone.
- **The pins and `STATUS.md` say the same commit** — the file stops naming a commit from memory: it
  quotes the pin, and `scripts/check-pin.sh` grows a third assertion, that the commit `STATUS.md`
  names is the one in the gitlink. That is what stops gap 4 recurring the next time `main` moves.
- **A `STATUS.md` that only asserts what it can show** — the two false sentences about `origin` and
  about `ci-pwgen.yml` are corrected, and every remaining claim in the file is re-checked against the
  tree and either re-verified, rewritten, or dropped. Specifically: the unit-test count, "upstream CI
  is green on `main`", "no open pull requests", the `GNOME_REVIEW_RULES.md` line references, the
  deviations list (it says `nix flake check` has three checks and why `gnome-extensions pack` is not
  one), and the three "deliberately not done" items — of which the EGO one survives as a scope
  decision and the `ci-pwgen.yml` one does not survive at all.
- **The wrapper `README.md` follows** — its "Build and release" section currently says releasing means
  uploading the zip to extensions.gnome.org by hand. After this entry, releasing is a tag.

## Approach

Units, one commit each, upstream work in draft pull requests opened at the first commit:

1. **U1 — `STATUS.md` honesty pass.** Run `scripts/check-pin.sh` first (the sweep can revert a
   submodule pin, so the gitlink is the authority, not what the file remembers). Correct the pin, the
   `origin` sentence and the `ci-pwgen.yml` sentence, and go through the rest of the file claim by
   claim. This is first because it is what misleads a reader *today* and it depends on nothing else.
2. **U2 — `flake.nix` upstream.** Move it, keep the outputs' names, prove `nix flake check` and
   `nix build` green from a clean clone of the branch. Upstream CI stays as it is: apt/dnf-based jobs
   that boot a real shell are not something to rewrite here.
3. **U3 — the wrapper consumes it.** Only after U2 has *merged* and the pin has been bumped to that
   commit — a wrapper pointing at a commit with no flake outputs cannot evaluate. Bump the gitlink and
   `flake.lock` together, `check-pin.sh`, then confirm `ci-pwgen.yml` is green on the real remote
   rather than assuming it.
4. **U4 — the installer.** `install.sh` rewritten, old one to `scripts/install-local.sh`, references
   and README updated. It cannot be run end-to-end yet — there is no release to fetch — so it lands
   with its failure path tested (missing asset, missing `unzip`, checksum mismatch) and is verified
   for real in U6.
5. **U5 — the release workflow** plus `version-name` in `metadata.json`, and `scripts/check-release.sh`
   in the wrapper. Both are dead code until a tag exists; the workflow's own syntax and the tag/version
   check are what this unit can prove.
6. **U6 — cut the first release.** Tag once U2/U4/U5 are on `main`, let the workflow publish, then:
   `scripts/check-release.sh`, and `install.sh` run from a clean directory against the published asset,
   with the output recorded in `STATUS.md`. An installer that was never executed is a guess.
7. **U7 — finish the entry.** `version: 0.2`, `v0.2` released and verified the same way, wrapper
   `README.md` updated, the submodule pointer committed at the merged `main`, `status: done` only once
   `check-release.sh` passes for 0.2 and no BLOCKER is open on the Sonar project.

## Risks / things to verify early

- **A tag on a commit that predates the workflow does nothing.** GitHub takes workflow files from the
  triggering ref, so `v0.1` cannot be tagged at `57b3bf6`: the release must be cut from a `main` that
  already contains `release.yml`. This is why U6 comes after U5 and not before, and it constrains the
  answer to the open question below.
- **The pin bump in U3 is ordering-sensitive.** `git -C upstream` on a submodule is not safe to run
  blind — initialise it first, and never let a checkout there land on the agent branch. `check-pin.sh`
  before and after.
- **`main` upstream is behind a ruleset with no bypass.** Everything here lands by pull request with
  the gate green. Read the check contexts off a live PR rather than guessing them, and if the quality
  gate goes red, `ideas/quality-gate/scripts/pr-gate.sh` first — fix or narrowly exclude, never
  re-label.
- **Verify the release from outside the sandbox's assumptions.** `check-release.sh` reads the public
  API, and the install verification must run in a throwaway directory with a throwaway `PREFIX`, not
  against the live session's extensions directory. `ci/smoke-test.sh` has already, once, written
  through those symlinks into a real working copy.
- **Check the remote, not the local run.** `gh run list` / `gh pr checks` once, late — not a polling
  loop — before believing anything is green.
- **Two releases in one entry, if the open question is answered that way,** means the `v0.1` asset and
  the `v0.2` asset are built from nearly the same tree. The notes must say which is which honestly
  rather than implying `v0.1` is the August 6th extension.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] **Should `v0.1` be published at all, or only `v0.2`?** The entry says to publish the `v0.1`
      `STATUS.md` claims, but that tag can only be cut from a `main` that already carries this entry's
      release workflow, installer and flake — so a `v0.1` release published now would contain 0.2's
      work and would not be the extension as it stood on 2026-08-06. The alternatives are (a) publish
      `v0.1` anyway, from current `main`, with notes saying plainly that it is the 0.1 extension plus
      the packaging that was missing, then `v0.2` at the end of the entry; or (b) publish only `v0.2`
      and correct `STATUS.md` to say that 0.1 never had a release rather than manufacturing one after
      the fact. Ticking this line as-is chooses (a), which is what the entry text asks for and which
      has the side benefit of exercising the whole release path once before the entry's own release
      depends on it.
