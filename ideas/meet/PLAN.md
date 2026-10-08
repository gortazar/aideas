# Plan: meet — the installed copy says which release it is, and nothing can publish a release that disagrees with its tag

Difficulty estimate: **easy** — one key in one JSON file plus four small guards around it; the only
thing that cannot be honestly proven on this machine is the release workflow's *refusal* path, which
would need a deliberately mismatched tag pushed to a public repository to exercise for real.

This is a **minor** update: `0.3` → **`0.4`**.

## Context

`upstream/src/metadata.json` is fourteen lines and carries `uuid`, `name`, `description`,
`shell-version`, `url` and `settings-schema`. There is **no `version-name`**, so:

- `~/.local/share/gnome-shell/extensions/meet@meet-gs.patxi/metadata.json` — the one file a person
  opens to answer "what am I running" — answers nothing, and the Extensions app shows a blank
  version for the entry;
- `install.sh:69` can only say `meet: installed to $dest`, never *what* it installed;
- `scripts/check-release.sh` unzips the published artefact and checks the uuid inside it
  (`scripts/check-release.sh:104-106`) but has nothing to compare the *version* against, so it
  verifies that a release tagged `v0.3` exists and carries a zip — not that the zip is 0.3;
- `.github/workflows/release.yml` publishes whatever the tag says. `git tag v0.9` on this tree would
  publish a release called v0.9 containing 0.3's code, and every check in the repository would stay
  green.

That last one is the point of the entry. The key on its own is a nicety; the key plus the guards is
a release path that cannot lie about itself.

Unlike the recap-gs entry above it, **`url` here is already correct** —
`https://github.com/gortazar/meet`, the extension's own repository, asserted at
`tests/metadata.test.js:31-33`. There is nothing to fix on that side and this plan does not touch
it.

The arrangement to copy is `ideas/aideas`, as the entry says. Its four guards, and what meet has
today:

| aideas | What it does | meet today |
| --- | --- | --- |
| `tests/unit/metadata.test.js:44-50` | asserts `version-name` equals the idea version, and that there is no `version` key | `tests/metadata.test.js` pins uuid, shell-version, url and the LICENCE — not the version |
| `.github/workflows/release-aideas.yml:89-101` | reads `version-name` and fails the run when it disagrees with the version being released | `release.yml:29-58` packs and publishes; nothing reads `metadata.json` at all |
| `tools/check-release.sh:132-142` | unzips the published asset and reads `version-name` out of it | `ideas/meet/scripts/check-release.sh` already unzips `metadata.json` for the uuid — one comparison short |
| `install.sh:190,205` | prints `aideas: installed 0.5 to …` | `install.sh:69` prints `meet: installed to …` |

Assumptions, stated here rather than asked:

- **`src/metadata.json` is the single upstream place the version is written.** The tag is checked
  against it, `check-release.sh` reads it back out of the published zip, and `install.sh` reports it
  from the unpacked copy. Nothing derives a version from a filename, a flake attribute or a git
  describe; `flake.nix` carries no version today and gains none.
- **The upstream unit test pins a literal, because upstream cannot see `STATUS.md`.** `STATUS.md`
  lives in this workshop repo and the extension lives in `gortazar/meet`; there is no file the
  upstream suite could read to learn the idea version. So the test pins `'0.4'` exactly as
  `ideas/aideas/tests/unit/metadata.test.js:45` pins `'0.5'`, and the **wrapper's `check-pin.sh`** is
  what makes the two repos agree — see the last feature. Two literals, neither of them a place you
  can forget, because each has a check that fails naming the file and the value.
- **`ci/driver/metadata.json` is left alone.** It is the throwaway driver extension the headless
  smoke test injects — never packed, never released, never shown to anyone. The test asserts about
  `src/metadata.json` only.
- **No `version` key.** extensions.gnome.org assigns the integer `version` on upload and rejects one
  set by hand; `version-name` is the free-text one. Its absence is pinned, as aideas does, because
  adding it is an easy slip while editing the same object.
- **`install.sh` keeps reinstalling unconditionally.** Printing the version is what the entry asks
  for; skipping a reinstall when the installed version already matches is a different feature and is
  not invented here.
- **`check-release.sh` stays in the wrapper**, where it already is, rather than moving upstream to
  match aideas's layout. Moving it is churn the entry did not ask for, and the wrapper is where
  `STATUS.md` — the version it defaults to — lives.
- **`v0.3` is not re-cut.** Its published zip has no `version-name` and never will; the new check in
  `check-release.sh` fails against it, correctly (see **Risks**). Published tags do not move.

## Features

- **`src/metadata.json` carries `version-name`, and it is the current version** — `"0.4"` for this
  entry, so an installed tree answers "which release is this" from the file a person already looks
  at, and the Extensions app shows it.
- **A unit test pins the key to the idea version** — `tests/metadata.test.js` gains cases asserting
  `version-name === '0.4'`, that it has the two-component `0.4` shape this repo's versioning rules
  use (`/^\d+\.\d+$/`, so `0.4.0` or `v0.4` fail here rather than at tag time), and that there is no
  `version` key. A bump that edits `STATUS.md` and forgets the manifest fails the suite by name.
- **The release workflow refuses a tag that disagrees with the manifest** — a step before the pack
  compares `${GITHUB_REF_NAME#v}` against `jq -r '."version-name"' src/metadata.json`, printing both
  values and failing with a one-line reason when they differ. `git tag v0.9` on a tree that says
  `0.4` publishes nothing. This is the guard the entry is actually about: not the key, but that
  **no release can exist whose artefact disagrees with the tag it was cut from**.
- **The suite asserts that the guard is there** — `tests/packaging.test.js` already has a *release
  workflow* suite that reads `release.yml` and asserts what it must do
  (`tests/packaging.test.js:87-109`). It gains a case requiring the workflow to mention
  `version-name` and to fail on a mismatch, in the shape `ideas/pwgen/upstream/tests/release-test.js:78-84`
  uses. A workflow edit that quietly drops the comparison is then a red test, not a silent
  regression — which matters, because the comparison itself only ever runs on a tag push.
- **`check-release.sh` reads the version from inside the published zip** — it already downloads the
  asset and unzips `metadata.json` to check the uuid; it gains the sibling assertion that
  `."version-name"` equals the version it was asked about. A tag can say anything and the release
  title is just text: this asks the bytes a user would install.
- **`install.sh` says what it installed** — `meet: installed 0.4 to <dest>`, read from the unpacked
  `metadata.json`, falling back to `unknown version` rather than failing when the key is absent, so
  `VERSION=v0.3 ./install.sh` against the older release still works.
- **The two repositories' versions cannot disagree** — `ideas/meet/scripts/check-pin.sh` gains a
  third assertion beside the two pins it already compares: `STATUS.md`'s `version:` equals
  `version-name` in **the pinned commit's** `src/metadata.json`, read with
  `git -C upstream show "$pin:src/metadata.json"` rather than from the working tree, so a pin
  pointing somewhere else cannot pass on a file that happens to be checked out. `ci-meet.yml` runs
  this script on every push already (`.github/workflows/ci-meet.yml:50-52`), so a `STATUS.md`
  claiming a version the released code does not carry turns this repo's CI red.
- **Shipped** — `v0.4` tagged and released from upstream's own workflow, confirmed once with
  `scripts/check-release.sh`, and the published asset install-verified from a clean directory with
  `HOME` and `XDG_DATA_HOME` redirected, as 0.1–0.3 each were. This time the verification has
  something specific to look at: the installed `metadata.json` says `version-name` `0.4`, and the
  installer's own last line says `0.4` too.

**Deliberately not in scope**, so the omission is a decision rather than an oversight:

- **The packer's required-field loop** (`flake.nix:36-41`) does not gain `version-name`. recap-gs's
  plan adds it there because it has no other packing-time guard; here the release workflow's
  comparison runs *before* `nix build`, and `jq -r` on a missing key yields `null`, which can never
  equal a tag — so a zip without the key cannot be published either way. A second check that can
  only fire on a path already closed is noise.
- **`workflow_dispatch` on the release workflow.** aideas and pwgen have one; meet's releases have
  been cut by tag push three times without trouble, and adding an input is a feature the entry does
  not ask for.

## Approach

Units, one commit each, tests first. The pull request opens as a **draft at U1** on
`agent/meet/<date>` and every unit is pushed as it lands.

1. **U1 — the key and the test that pins it.** Failing cases in `tests/metadata.test.js` for
   `version-name === '0.4'`, its shape, and the absence of `version`; then the one line in
   `src/metadata.json`. Both in the same commit — the red window is the minute between writing the
   assertion and adding the key, because a suite that cannot pass is not a state to be swept into a
   commit.
2. **U2 — the release gate.** A step in `.github/workflows/release.yml`, before the pack, comparing
   the tag to the manifest; plus the `tests/packaging.test.js` case that asserts the step exists.
   Both branches of the comparison are run by hand with the two values substituted and what was run
   is recorded in `STATUS.md` — a tag push is the only way to exercise the real refusal, and this
   plan does not pretend otherwise (see **Risks**). **Set an SSH push URL on the submodule remote
   before this unit**: the `gh` OAuth token cannot push a file under `.github/workflows/`.
3. **U3 — `check-release.sh` reads the zip's version.** In the wrapper, beside the uuid check it
   already does. Exercised immediately against the *existing* `v0.3` release, where it must **fail**
   — 0.3's artefact has no `version-name` — which is the only honest way to see the new assertion
   work before `v0.4` exists. The observed output goes in `STATUS.md`.
4. **U4 — `install.sh` reports the version.** `version-name` read from the unpacked `metadata.json`
   with `sed`, as `ideas/aideas/install.sh:190` does, used in the final line with an `unknown
   version` fallback; a `tests/packaging.test.js` case asserting the installer reads the key; and
   the README's install section updated to say what the output now tells you.
5. **U5 — `v0.4`: ship it.** `version: 0.4` in `STATUS.md`, the pull request made ready and
   auto-merged (armed **last**, after the final push), the merge confirmed, `v0.4` tagged so
   upstream's workflow publishes, `scripts/check-release.sh` run **once**, and the published asset
   install-verified from a clean directory. Then, in one commit here: the submodule pointer and the
   `meet-src` flake input bumped to the new `main` commit, the `check-pin.sh` version assertion
   added, and `STATUS.md` written. **The `check-pin.sh` change lands in this unit, not earlier** —
   it compares `STATUS.md` against the *pinned* manifest, so adding it before the pin moves would
   leave this repo's CI red for four units.

## Risks / things to verify early

- **The refusal path cannot be honestly tested without a bad tag.** Pushing `v0.4` proves only that
  a *matching* tag publishes. Pushing a deliberately mismatched one to prove the other branch leaves
  junk on a public repository for the sake of one assertion. The plan: run the comparison locally
  with both inputs, record both outcomes, and say plainly in `STATUS.md` that the live refusal was
  not exercised. The thing worth avoiding is a `STATUS.md` implying it was.
- **`check-release.sh` must fail against `v0.3`, and that is the check working.** The temptation
  when U3's new assertion goes red is to make it lenient — skip the comparison when the key is
  absent. Do not: a published zip with no `version-name` is exactly what this entry exists to stop
  shipping again. `v0.3` is simply an older release, and `check-release.sh` is always run for the
  version `STATUS.md` names.
- **Run `check-release.sh` once, late, and never in a loop.** The tag workflow takes a minute or two
  to publish, and the unauthenticated API runs out of its 60-an-hour allowance quietly; both have
  already fooled this idea once into reporting a missing release that was there. The script's `gh`
  fallback (`scripts/check-release.sh:38-42`) exists for the second case.
- **The workflow file needs an SSH push.** U2 touches `.github/workflows/`, which the `gh` OAuth
  token lacks the scope for; the push fails with an error that reads like a repository permissions
  problem. Set the submodule remote's push URL to SSH before U2 and verify with `git ls-remote`.
- **Where the new code is analysed.** The upstream change is a few lines of YAML, one JSON key and
  three test cases; the `check-release.sh` and `check-pin.sh` edits are in **this** repo and are
  analysed by the workshop's own Sonar project, not meet's. Expect the shell scripts to be what the
  gate looks hardest at. If either goes red, the `AGENTS.md` ladder applies: read it with
  `pr-gate.sh`, fix it in the same pull request.
- **The nested shell is not re-run, deliberately.** No widget, model or launched URL changes. What
  could break is the Shell refusing to load a malformed manifest, and JSON validity is already
  covered without a compositor: the suite parses the file (`tests/util.js` `readJSON`) and the packer
  runs `jq -e` over it on every `nix flake check` (`flake.nix:36-43`).
- **The install-verification should check the version, not the file count.** 0.1–0.3 each verified
  "17 files land"; for this entry that proves nothing. The checks that matter are
  `grep version-name` in the installed `metadata.json` and the installer's own last line.

## Open Questions

None. Every choice the entry leaves open — where the version is written, that the upstream test pins
a literal while `check-pin.sh` ties it to `STATUS.md`, the untouched driver manifest and `url`, the
packer loop left alone, and the reinstall behaviour `install.sh` keeps — is recorded as an
assumption or a scope decision above, because each is cheap to reverse and none of them blocks the
work.
