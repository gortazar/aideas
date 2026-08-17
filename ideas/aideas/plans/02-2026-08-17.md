# Plan: aideas — a release workflow that actually publishes the extension

Difficulty estimate: medium — the change itself is small (one workflow, one installer branch, a
version bump), but the thing being built can only be fully exercised by a push to `main`, which is
precisely how the current workflow shipped broken and stayed broken unnoticed for two days.

## Context

This entry exists because the release path built in v0.1 does not work. Four facts, all checked
against the repository and the GitHub API rather than assumed:

1. **The workflow has run exactly once, and it failed.** `.github/workflows/release-aideas.yml`
   ran on the push to `main` that merged v0.1 (2026-08-14T14:43Z) and failed at the **"Pack the
   extension"** step; every step after it was skipped. It has not run since — the path filter is
   `ideas/aideas/**`, and nothing in the folder has changed on `main` since that merge.
2. **The cause is in the workflow, not in the extension.** The job installs only `zip` and
   `libglib2.0-bin` and then runs `make pack`, but `pack` depends on `check-bundle`, which runs
   `gjs -m tools/check-bundle.js` (Makefile:65-76). `gjs` is not on a stock `ubuntu-latest`
   runner. The comment above that step — "the whole gnome-shell closure stays out of this job" —
   is right about `gnome-shell` and wrong about `gjs`. `flake.nix` already has a
   `packages.default` that builds the identical zip *with* gjs, which is the fix.
3. **So the v0.1 release was made by hand**, on 2026-08-16T20:41Z by `gortazar`, and it does not
   look like what the workflow would have produced: different title, different notes, and its
   checksum asset is `SHA256SUMS`, not `<zip>.sha256`. That matters, because `install.sh:118`
   fetches `"$URL.sha256"`, gets a 404, and — by design, since an absent checksum is not an
   error — installs **without verifying anything**. The one release that exists is the one shape
   the installer cannot check.
4. **Nobody was told.** An agent cannot push this repo, so the workflow's first real run happens
   after a merge that no agent sees the result of. A red X on the Actions tab is the only signal,
   and it was missed. Anything this plan builds has to be verifiable *before* the merge, from a
   worktree, or it will fail the same way.

Assumptions, stated rather than asked:

- **"Every time changes are made" means every change that alters the packed artefact.** A change
  to `STATUS.md`, `PLAN.md`, `plans/`, `docs/`, `screenshots/` or the test suite does not produce
  a release; a change to `src/`, `schemas/`, `metadata.json`, or the build rules that assemble
  them does. Otherwise every status update publishes a byte-identical zip under a new tag.
- **`install.sh` itself is not part of the artefact.** It is fetched raw from `main`, so a change
  to it is live immediately and needs no release. It stays outside the trigger paths.
- **This work may edit `.github/workflows/release-aideas.yml` and `install.sh`.** The second
  answered question of `plans/01-2026-08-17.md` grants this idea, and only this idea, work outside
  the idea folder; the release workflow was built under that grant and is where the bug is.
- **The version goes to 0.2** (the entry says minor), in `STATUS.md`, in
  `src/extension/metadata.json` (`version-name`) and in `flake.nix`'s `packages.default.version`,
  which is still hardcoded `"0.1"`.
- **Tags are never moved or deleted.** A published release is a fact; the workflow only ever adds.
- **One box, one channel.** Releases stay in this repo under the `aideas-shell-v*` prefix, as the
  third answered question of the v0.1 plan settled. Nothing here goes to extensions.gnome.org.

## Features

- **A release job that can actually build the artefact.** The pack step becomes `nix build` — the
  same `packages.default` derivation `nix flake check` already validates — instead of apt-installed
  `zip` plus a `make pack` that silently needs `gjs`. The zip that gets uploaded is then, by
  construction, the zip CI checked, and the failure mode of v0.1 (a build tool missing from the
  runner) cannot recur for any tool the flake declares.
- **The release runs the tests it is releasing.** `nix flake check` (lint, unit, http, bundle) and
  the `/state` contract test run in the same job, before anything is published. A release that
  fails its own suite is worse than no release, and with releases now firing on ordinary pushes
  this is the only thing standing between a bad commit and an installable bad extension.
- **Triggered by changes to the extension, not to its paperwork.** The `push` filter narrows from
  `ideas/aideas/**` to the shipped inputs — `src/**`, `Makefile`, `flake.nix`,
  `tools/check-bundle.js`, and the workflow file itself — on `main` only, with `workflow_dispatch`
  kept for publishing by hand.
- **A guard that turns "changed" into a fact about content.** Before publishing, the job compares
  the freshly built artefact against the asset of the newest existing `aideas-shell-v*` release; if
  the contents are identical it publishes nothing and says so. A re-run, a merge that touches a
  shipped file without changing it, or a manual dispatch is therefore harmless rather than a
  duplicate release.
- **A reproducible zip, so that comparison means something.** `make pack` normalises entry order
  and timestamps (`SOURCE_DATE_EPOCH`, `zip -X`), and a test packs twice and asserts one SHA-256.
  Today the "byte-identical to `nix build`" claim in `STATUS.md` holds only because both builds
  happened to see the same mtimes; a content check that compares zip bytes would otherwise report
  a change on every run and release forever.
- **A tag scheme where "newest wins" stays true.** The first release of a version is
  `aideas-shell-v<version>`; a later artefact change at the same version becomes
  `aideas-shell-v<version>-2`, `-3`, and so on. `install.sh` takes the first
  `.shell-extension.zip` under an `aideas-shell-v` tag from the releases list, newest first, so
  every one of these is reachable and the latest is what a fresh install gets.
- **Assets the install script can verify.** Every release carries three files: the zip,
  `<zip>.sha256` — the exact name `install.sh` asks for — and `SHA256SUMS`, which is what the
  hand-made v0.1 release and the other ideas in this repo publish. `install.sh` gains a fallback
  to `SHA256SUMS`, so the checksum is verified rather than silently skipped, including against the
  release that already exists. A checksum that is present and wrong still refuses to install; a
  release with neither file is still installable, because the structural uuid check remains.
- **The decision is a tested script, not YAML.** `ci/release-plan.sh` decides — from the version
  files, the releases list and the built artefact — whether to publish and under which tag, and
  prints its reasoning. `ci/release-test.sh` drives it against a stubbed releases API over fixture
  version files: first release of a version, second change at the same version, an unchanged
  artefact, a version that disagrees with `metadata.json`, an empty releases list, and a releases
  list containing another idea's tags. This is the part the v0.1 workflow got wrong and could not
  test, and it is what makes the fix checkable from a worktree.
- **Version consistency enforced, not documented.** One step asserts `STATUS.md`'s `version:`,
  `metadata.json`'s `version-name` and `flake.nix`'s `packages.default.version` are the same
  string, and fails the run when they are not. The existing "check the artefact is the version it
  claims" step stays and now compares against that agreed value.
- **The installer verified against a release-shaped source.** `ci/install-test.sh` (27 checks
  today) gains cases for the `SHA256SUMS` fallback, for a `SHA256SUMS` whose digest is wrong, and
  for a stub releases list carrying the suffixed tags, so the installer is exercised against
  exactly the asset layout the workflow now produces.
- **A post-merge check anyone can run in one command.** `tools/check-release.sh` asks the GitHub
  API for the newest `aideas-shell-v*` release and asserts it has the three assets, that the
  version matches `STATUS.md`, and that the zip's checksum matches its published digest. It is how
  "the release is really there" gets confirmed after the merge — by a person, by the next cycle, or
  by whoever reads `STATUS.md` — without anyone having to remember to open the Actions tab.
- **v0.2 published, and the README saying how.** The release this entry is about, produced by the
  workflow from the merge commit, plus a short section in `ideas/aideas/README.md` on what triggers
  a release, what it contains, and how to re-run it by hand.

## Approach

Units, each one commit, tests first:

1. **U1 — reproducible pack.** Normalise `make pack`; a test that packs twice and compares
   SHA-256, and that `nix build` agrees. Nothing downstream is trustworthy until the artefact is a
   function of the source alone.
2. **U2 — `ci/release-plan.sh` and its test**, against a stubbed releases API. Pure decision
   logic: publish or not, and the tag. No GitHub, no network.
3. **U3 — the checksum fallback in `install.sh`**, with the `SHA256SUMS` cases added to
   `ci/install-test.sh`. Verified against the v0.1 asset layout that is live right now.
4. **U4 — the workflow rewritten** around `nix build`, the flake checks, the narrowed paths, the
   consistency check and `release-plan.sh`. Reviewed against the failed run's step list so every
   step that failed or was skipped has a reason to pass now.
5. **U5 — `tools/check-release.sh`**, run against the *existing* v0.1 release to prove it reports
   truthfully before it is ever pointed at v0.2.
6. **U6 — the bump and the docs.** `version: 0.2` in `STATUS.md`, `version-name` in
   `metadata.json`, the flake's version, the README section, and `status: done` only once the
   evidence in `STATUS.md` says which of these ran and what they printed.

## Risks / things to verify early

- **The first real run still happens after the merge.** Everything above is arranged so that the
  only untested thing left is GitHub's own behaviour: `nix build` in Actions, and `gh release
  create` with three assets. `ci/release-plan.sh` and `ci/install-test.sh` cover the logic; if the
  run still fails, `tools/check-release.sh` is what says so out loud.
- **A push to `main` mid-build publishes work in progress.** The orchestrator merges an agent's
  branch every cycle, so "release on every change" will fire while a later entry is half-built.
  The tests-must-pass gate keeps it *working*, not *finished*. The first open question decides
  whether that is wanted.
- **`nix build` on a cold runner is slow** — several minutes, no cache. Acceptable for a job that
  runs on extension changes only; if it is not, the fallback is apt plus `gjs` explicitly
  installed, which is the same fix with a worse guarantee.
- **The v0.1 release cannot be repaired from here.** No agent can add a `.zip.sha256` to it, which
  is why the fix belongs in `install.sh` as a fallback rather than in a re-upload.
- **Do not widen the trigger back out.** With `ideas/aideas/**` as the path filter, the commit that
  sets `status: done` in `STATUS.md` would itself trigger a release build — harmless with the
  content guard, but it makes every status edit run a Nix build for nothing.
- **Never touch `README.md` at the repo root** — it is the queue — and keep everything else inside
  `ideas/aideas/`, plus the two files named in the assumptions above.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **Should a change merged while the idea is still `in_progress` publish a release?** The entry
      says "every time changes are made", and the plan assumes yes: any push to `main` that changes
      the packed artefact and passes the full suite publishes, so the newest release is always the
      newest working extension. The alternative is to keep the v0.1 gate — publish only when
      `STATUS.md` says `status: done` — which means the release is always a finished entry, at the
      cost of "every change" not being literally true, since the orchestrator merges mid-build work
      to `main` every cycle. Ticking this line as-is chooses publishing on every green change. No, releases
      are made when the task is done.
- [x] **When the artefact changes but the version does not, what should the release be called?**
      The plan assumes a suffixed tag — `aideas-shell-v0.2-2`, `-3` — so every published artefact
      keeps its own immutable tag and the installer's "newest first" rule picks the right one. The
      alternatives are (b) replace the assets on the existing `aideas-shell-v0.2` release in place,
      which keeps one release per version but makes a tag mean two different zips over time, or
      (c) publish nothing until the version is bumped, which makes releases per-entry again.
      Ticking this line as-is chooses the suffixed tag. Suffixed tag.
- [x] **What counts as proof that the release exists, given no agent can publish one?** AGENTS.md
      requires downloading the published asset and running the installer from a clean directory
      before an entry is done, but the release is created by the workflow *after* the merge, which
      is after the last cycle ends. The plan assumes: `ci/install-test.sh` against the locally built
      artefact through a stubbed releases API is the pre-merge proof, `tools/check-release.sh`
      is the post-merge one, and `STATUS.md` records both plus what to do if the run went red.
      Ticking this line as-is accepts that; the alternative is that this entry stays `in_progress`
      until someone confirms `aideas-shell-v0.2` is downloadable.
