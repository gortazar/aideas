# Plan: title-slides 0.6 — the two things the docs never said

Difficulty estimate: easy — two paragraphs of prose, no filter code touched, and both gaps are
verifiable by grep before and after. The only real work is the release discipline a completed entry
still owes: PR through the gate, `v0.6` tagged with its asset, pin moved.

## Context

A fleet audit found two documentation gaps. Neither is a defect in the extension, and neither
changes a single line of Lua. Minor update, so 0.5 → **0.6**.

**Gap 1 — the Sonar exemption is recorded in the wrong idea's files.** `AGENTS.md` says an
unsupported language is a reason to skip the SonarQube Cloud deliverable **and say so in
`STATUS.md`** — the idea's own `STATUS.md`. Lua is the named example there, and `title-slides` is
the idea it names. But this idea's `STATUS.md` does not contain the word Sonar, or Lua, or any
mention of the analysis. The exemption exists only in `ideas/quality-gate/STATUS.md`
("`title-slides` | `test` — no Sonar project, because Lua") and `ideas/quality-gate/baseline.md`
(its "Out of scope" section). Someone reading this idea alone cannot tell whether the analysis was
skipped deliberately or forgotten.

The rule is **contemporaneous with this idea's last entry** — the quality-gate entries that wrote
it into `AGENTS.md` are 2026-08-25 and 2026-08-26, and 0.5 shipped 2026-08-25 — so this is an
omission against a live rule, not a rule applied backwards. That is worth stating in the entry
itself, because "was the rule even in force?" is the first thing a future reader will ask.

**Gap 2 — the README never says how to build.** Its `## Development` section lists `nix develop`,
the five test scripts and `nix flake check`. The words *build*, *package* and `nix build` appear
nowhere in the file. Meanwhile `flake.nix` exposes `packages.default` — a derivation named
`title-slides-extension` that copies `_extensions/` into `$out` — and `.github/workflows/release.yml`
ships the release asset with exactly `nix build .#default`, then `cp -rL result/_extensions dist/`
and a `zip -r`. So the build exists, is the one the release uses, and is undocumented.
`AGENTS.md`'s per-idea deliverables ask the README for "how to enter the environment
(`nix develop`), run tests **and build**".

Assumptions, stated once rather than asked:

- **The documented build is the release's build, verbatim.** `nix build .#default` plus the two
  lines that turn `result/` into `title-slides-<version>.zip`, with a sentence saying `release.yml`
  runs precisely this. Documenting a *different* recipe that happens to work would recreate the gap
  in a new form: the point is that a reader can reproduce the published asset.
- **It goes in `## Development`**, as the entry asks, not in a new top-level section. The install
  line at the top of the README stays the user's path; building is a contributor's path and belongs
  where the test runners already are.
- **No code, no CI job, no new test target.** `nix flake check` deliberately does not build
  `packages.default` today; making it do so is a change to the build, not documentation of it, and
  is out of scope. The build is verified by running it (see Testing), not by adding a check.
- **No substitute linter.** `AGENTS.md` is explicit that an unsupported language is a reason to
  skip the analysis, "not a reason to invent a substitute linter and call it the same thing".
  Adding luacheck or selene under the banner of closing gap 1 would be the wrong fix, and it is
  named here so it does not get invented mid-cycle.

## Features

- **`STATUS.md` records the Sonar exemption where the rule asks for it** — a standing section in
  this idea's `STATUS.md`, not a line buried in one cycle's log, so it survives the next entry and
  answers the question for anyone reading only this idea.
- **Lua is named as the reason.** SonarQube Cloud does not analyse Lua; the extension is a Lua
  filter; therefore there is no Sonar project, no badge and no `sonar / Analysis` check for this
  repository, by the `AGENTS.md` rule rather than by omission.
- **The note points at the evidence rather than restating it** — `ideas/quality-gate/baseline.md`'s
  "Out of scope" section and `ideas/quality-gate/STATUS.md`'s check-context table, which is where
  the fleet-wide record lives. It also records the consequence that is easy to misread as a defect:
  this repository's branch ruleset requires **`test` only**, where every other idea repository also
  requires a Sonar check. Verified against the live ruleset, not copied from the other idea's prose.
- **The note states its own expiry condition** — if SonarQube Cloud ever adds Lua, wiring this
  repository up is the ordinary three commands, and the exemption stops applying. A skip with no
  stated condition for un-skipping is indistinguishable from neglect.
- **The date question is settled in writing** — the rule predates the omission, so this is recorded
  as a real gap closed, not as a retroactive tidy-up.
- **The README documents the build** — `nix build .#default`, what it produces (a `result/` symlink
  containing `_extensions/title-slides/`, the extension exactly as `quarto add` installs it), and
  the two further lines that make `title-slides-<version>.zip`.
- **The docs name the release as the same command** — one sentence tying the snippet to
  `.github/workflows/release.yml`, so the next person to change one knows the other exists.
- **The reproduction is checked, not asserted** — the locally built zip is compared against the
  published `title-slides-0.5.zip` asset, and the README only claims what that comparison supports.
- **The Development section still reads as one list** — `nix develop`, the five runners,
  `nix flake check`, then the build, in the order a contributor meets them.
- **Released and installable** — `_extension.yml` at 0.6.0, `v0.6` tagged upstream with
  `title-slides-0.6.zip` attached and verified present, the three `@v0.5` install lines in the
  README moved to `@v0.6`, both install paths re-checked from clean directories, then the gitlink
  and `flake.lock` moved here together with `scripts/check-pin.sh` green.
- **The filter is provably untouched** — `git diff` for the entry covers `README.md`,
  `_extension.yml` and nothing under `_extensions/title-slides/*.lua`; all 114 unit tests, 4 golden
  cases, the smoke, real-deck and install tests pass unchanged.

## Approach

Units, one commit each:

1. **U0 — pin, baseline, and both gaps re-confirmed against the tree.**
   `git submodule update --init` (never `git -C` into an empty submodule), `scripts/check-pin.sh`,
   then the full 0.5 suite green before any change — the sweep has reverted this gitlink once
   already and `STATUS.md` saying 0.5 is not evidence. Then verify the audit rather than trusting
   it: grep the README for `build`/`package`/`nix build`, grep `STATUS.md` for `[Ss]onar`/`Lua`,
   read the live branch ruleset on `gortazar/title-slides` for its required contexts, and confirm
   `nix build .#default` succeeds and what it leaves in `result/`. If any of the four disagrees
   with this plan, say so in `STATUS.md` before writing the fix.
2. **U1 — the `STATUS.md` note, here.** No upstream change, no PR, no gate: this is the cheapest
   half and it closes the rule violation immediately. A standing section with the exemption, the
   reason, the pointers, the ruleset consequence and the expiry condition.
3. **U2 — the README build docs, upstream.** Branch `agent/title-slides/<date>`, draft PR opened at
   this first upstream unit, not at the end. Write the snippet from `release.yml`, run every command
   in it, then compare the resulting zip with the published 0.5 asset and fix the prose to match
   whatever the comparison actually shows.
4. **U3 — release.** `_extension.yml` to 0.6.0 and the three `@v0.5` lines to `@v0.6` in the same
   commit; merge through the gate (PR required, `test` must pass, no bypass actors); confirm the
   tag **and its asset** landed — the workflow tags itself, the orchestrator's push carries no tag;
   verify both install paths from clean directories; move the gitlink and `flake.lock` here
   together; check the remote CI run, not just the local one.

## Testing

- **Nothing new to test, everything to re-run.** 114 unit tests, 4 golden cases, smoke, real-deck
  and install, all green at the end as at the start. Four byte-identical goldens are the proof that
  a documentation entry stayed a documentation entry.
- **The documented build is executed.** Every line of the new snippet is run in a clean checkout,
  in order, and the README says only what those runs produced.
- **The zip is compared with the published one.** Build 0.5's asset locally from the pinned commit
  and diff its file list (and, where reproducible, its contents) against the downloaded
  `title-slides-0.5.zip`. If they differ, the difference is documented rather than papered over.
- **Both greps flip.** `build`/`nix build` absent → present in the README; `Sonar`/`Lua` absent →
  present in `STATUS.md`. Cheap, and it is exactly the check the audit ran.
- **The diff is inspected for code.** `git diff --stat` on the upstream branch must show
  `README.md` and `_extension.yml` only.
- **Install paths from clean directories** — `quarto add gortazar/title-slides@v0.6` and the
  downloaded zip, each rendering the real deck: 28 slides, 14 index slides, 9 entries, no warning.

## Risks / things to verify early

- **The pin.** `scripts/check-pin.sh` before anything else, and `git submodule update --init`
  before any `git -C ideas/title-slides/upstream …` — on an empty submodule that command operates
  on the parent repo and detaches the agent's branch.
- **`upstream/` is a detached-HEAD submodule.** `git push origin HEAD:main` (or the branch), and
  confirm with `git ls-remote` before believing anything landed; a plain `git push` prints nothing
  and does nothing.
- **The gate applies to a docs PR too.** `main` needs a pull request and a green `test`; there are
  no bypass actors and none may be created. A README typo that breaks a test is still a red gate.
- **`status: done` is overwritten by the sweep**, so a release gated on it never fires — run
  `check-release.sh` and, if the workflow did not run, recover with its `force` input rather than
  assuming the tag will do it.
- **The release workflow must create its own tag.** The orchestrator's push carries none, and
  agents cannot push tags.
- **Bumping `_extension.yml` for a docs-only change is deliberate**, so that
  `quarto list extensions` reports a version matching the README the user is reading. It also means
  the published 0.6 artefact differs from 0.5 by exactly one line — worth checking, since a zip
  that differs by more than that means something else changed.
- **Do not close gap 1 with a tool.** The correct output is a sentence in `STATUS.md`. Adding a Lua
  linter, a badge, or an empty Sonar project would each violate the rule this entry exists to obey.
- **Do not close gap 2 by changing the build.** If `nix build .#default` turns out to be broken or
  to produce something other than what `release.yml` ships, that is a finding for `STATUS.md` and
  possibly its own entry — not a repair smuggled into a documentation change.
- **Three `@v0.5` strings, not one.** README lines 11, 249 and 302. Missing one leaves the
  troubleshooting section telling users to install the previous release.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] Does a documentation-only entry cut a real release? Ticking this line as-is says **yes**:
      `_extension.yml` goes to 0.6.0, `v0.6` is tagged with `title-slides-0.6.zip` attached, and
      the README's install lines follow — which is what `AGENTS.md` requires ("`status: done` with
      no release for that version is not done") and keeps the version a user sees in
      `quarto list extensions` matching the documentation they are reading. The alternative is to
      bump `version:` in `STATUS.md` only and ship no tag, on the grounds that the extension's
      behaviour is byte-for-byte unchanged and a release that changes one version string is noise
      in the release list.
