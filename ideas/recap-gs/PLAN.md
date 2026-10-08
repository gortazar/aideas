# Plan: recap.gs — say which version is installed, and point at the right repository

Difficulty estimate: easy — two keys in one JSON file, plus four small checks that stop them going
stale; the only thing that cannot be proven on this machine is the release workflow's *refusal*
path, which needs a tag push to exercise for real.

This is a **minor** update: v0.4 → **v0.5**.

## Context

`src/metadata.json` is nine lines long and two of them are wrong:

```json
  "url": "https://github.com/gortazar/aideas",
```

…and there is no `version-name` at all. Both are user-visible on an installed machine:

1. **Nothing on disk says which release the code came from.** `~/.local/share/gnome-shell/
   extensions/recap@recap-gs.patxi/metadata.json` is the one file a person looks at to answer "what
   am I running", and today it answers nothing. GNOME Shell shows `version-name` in the Extensions
   app; without it the entry is blank. `install.sh` cannot say what it just installed, and an
   installer cannot tell whether a reinstall would change anything — it unconditionally
   `rm -rf`s the directory and unpacks over it (`install.sh:59-61`).
2. **`url` names this workshop, not the extension.** That key is the extension's homepage in the
   Extensions app and on extensions.gnome.org, so a user following it to report a bug lands in
   `gortazar/aideas`, which is where the *plans* live and where their issue does not belong. It must
   be `https://github.com/gortazar/recap-gs`.

The remedy is already built and in use one folder away, and the entry says to copy it rather than
invent a second arrangement. The four pieces of `ideas/aideas`:

| aideas | What it does | recap-gs today |
| --- | --- | --- |
| `tests/unit/metadata.test.js:44` | asserts `version-name` equals the idea version | `tests/metadata.test.js` exists, asserts uuid/schema/shell-version — not the version, not the url |
| `.github/workflows/release-aideas.yml:89-102` | refuses to publish when the tag and `version-name` disagree | `.github/workflows/release.yml:31-35` has a step *named* "Check the tag against metadata.json" that reads `metadata.json` nowhere — it checks the tag is non-empty and nothing else |
| `tools/check-release.sh:132-142` | unzips the published asset and reads `version-name` out of it | **no `check-release.sh` of any kind exists** |
| `install.sh:190,205` | prints `installed 0.5 to …` | prints `installed to $dest`, no version |

So this entry adds the two keys and the four checks that keep them true.

Assumptions, stated rather than asked:

- **`src/metadata.json` is the single place the version is written upstream.** The tag is checked
  against it, `check-release.sh` reads it out of the published zip, `install.sh` reports it from the
  unpacked copy, and the packer refuses to build a zip without it. Nothing derives a version from a
  filename, a flake attribute or a git tag — `flake.nix` carries no version today and gains none.
- **The two literals that necessarily remain are both *checked*, not remembered.** The unit test
  pins `0.5` as a literal, exactly as aideas does; `STATUS.md` here carries `version: 0.5` because
  `AGENTS.md` requires it. Neither is a place you can forget, because the suite fails naming the
  file and the value, and `scripts/check-pin.sh` fails when `STATUS.md` and the pinned
  `metadata.json` disagree. "One line to edit" is the goal; "the build tells you the second one is
  stale, by name" is how it is kept.
- **`ci/driver/metadata.json:6` keeps its `gortazar/aideas` url.** That is the throwaway driver
  extension the headless smoke test injects; it is never packed, never released and never shown to
  anyone. The unit test asserts about `src/metadata.json` only, and widening it would fail on a file
  whose url is irrelevant.
- **No `version` key.** extensions.gnome.org assigns the integer `version` on upload and rejects one
  set by hand; `version-name` is the free-text one. The test pins its absence, as aideas's does.
- **`install.sh` keeps reinstalling unconditionally.** Printing the version is what the entry asks
  for; skipping a reinstall when the installed version already matches is a different feature and is
  not invented here.

## Features

- **`src/metadata.json` carries `version-name`, and it is the current version** — `"0.5"` for this
  entry, so an installed tree answers "which release is this" from the file a person already looks
  at, and the Extensions app shows it.
- **`src/metadata.json`'s `url` points at `gortazar/recap-gs`** — the extension's own repository, so
  the homepage link and the bug a user is about to file both arrive where the code is.
- **One test pins both, so neither drifts alone** — `tests/metadata.test.js` gains a case asserting
  `version-name` equals the idea version and `url` equals the repository URL exactly, plus that
  there is no `version` key. The same test, as the entry requires: a future edit cannot fix one
  field while quietly breaking the other.
- **The packer refuses a manifest without `version-name`** — `version-name` joins the
  required-and-non-empty field loop in `flake.nix`'s `packExtension` (`flake.nix:39-44`), so
  `nix build` and the `pack` check both fail rather than producing a zip that installs with no
  version in it. This is the check that covers the case the unit test cannot: a zip assembled from
  something other than the tree the suite ran against.
- **The release workflow refuses a tag that disagrees with the manifest** — the step at
  `.github/workflows/release.yml:31-35` stops being a no-op: it reads `version-name` and fails the
  run, printing both values, unless it equals `${GITHUB_REF_NAME#v}`. `git tag v0.5` on a tree that
  says `0.4` publishes nothing, instead of publishing a release whose asset contradicts its own tag.
- **`tools/check-release.sh` verifies the published artefact, not the tag** — new, upstream, in the
  shape of `ideas/aideas/tools/check-release.sh`: the newest `v*` release exists, carries the
  `recap@recap-gs.patxi.shell-extension.zip` asset, downloads, matches the digest GitHub reports and
  the published `.sha256` — and, the point of the entry, **unzips `metadata.json` and reads
  `version-name` out of it**, comparing it against the working tree's. A tag can say anything; this
  asks the bytes a user would install. It is read-only, unauthenticated, runnable from anywhere, and
  **tells a rate-limited API apart from a missing release**, which is a failure this fleet has
  already been fooled by once.
- **`install.sh` says what it installed** — `recap-gs: installed 0.5 to <dest>`, read from the
  unpacked `metadata.json`, falling back to `unknown version` rather than failing the install if the
  key is somehow absent (an older release installed with `VERSION=v0.4` must still work).
- **The wrapper's two versions cannot disagree** — `ideas/recap-gs/scripts/check-pin.sh` gains a
  third assertion beside the two pins it already compares: `STATUS.md`'s `version:` equals the
  pinned submodule's `src/metadata.json` `version-name`. A `STATUS.md` claiming a version the
  released code does not carry is exactly the drift this entry exists to end, and this repo's
  `ci-recap-gs.yml` already runs the script on every push.
- **Shipped** — README updated where it describes installing, `v0.5` tagged and released from
  upstream's own workflow, the release confirmed with the new `check-release.sh`, and the published
  asset install-verified from a clean directory with `XDG_DATA_HOME` redirected, as 0.1–0.4 each
  were. The install-verification now has something specific to look at: the installed
  `metadata.json` says `version-name` `0.5` and the recap-gs url.

## Approach

Units, each one commit, tests first. The pull request opens as a **draft at U1** and every unit is
pushed to `agent/recap-gs/<date>` as it lands.

1. **U1 — the two keys and the test that pins them.** A failing case in `tests/metadata.test.js`
   asserting `version-name === '0.5'`, `url === 'https://github.com/gortazar/recap-gs'` and
   `metadata.version === undefined`; then the two lines in `src/metadata.json`. Red window measured
   in minutes — the manifest edit lands in the same commit, because a suite that cannot pass is not
   a state to be swept into a commit.
2. **U2 — the packer requires it.** `version-name` added to the jq field loop in `packExtension`, so
   the `pack` check and `nix build` both refuse a manifest without it. Verified by running
   `nix flake check` once with the key temporarily removed, so the new failure is observed rather
   than assumed. The `url` is deliberately *not* asserted a second time here — one owner per field,
   and the test owns the url.
3. **U3 — the release gate.** `.github/workflows/release.yml`'s misleading step rewritten to compare
   `${GITHUB_REF_NAME#v}` against `jq -r '."version-name"' src/metadata.json`, failing with both
   values printed and a one-line reason. Both branches of the comparison are run by hand with the
   two values substituted, and what was run is recorded — a tag push is the only way to exercise the
   real refusal, and this plan does not pretend otherwise (see **Risks**).
4. **U4 — `tools/check-release.sh`.** New script, `set -euo pipefail`, shellcheck-clean, parsing the
   releases API with `jq` (not python3 — the dev shell has jq already and `check-pin.sh` uses it,
   and it keeps an interpreter out of a directory holding a downloaded artefact). Version from
   `src/metadata.json` by default, `--version` and `--repo` to override. `unzip` and `curl` added to
   the dev shell, which has neither today, so the script runs inside `nix develop`.
5. **U5 — `install.sh` prints the version, and the README says it does.** `version-name` read from
   the unpacked `metadata.json` with `sed`, as aideas does, and used in the final line. README's
   install section gains the one line about what the output now tells you and where the installed
   version is recorded.
6. **U6 — `v0.5`: ship it.** Version set in `STATUS.md`, the pull request made ready and
   auto-merged (armed **last**, after the final push), the merge confirmed, `v0.5` tagged and
   released by upstream's own workflow, `tools/check-release.sh` run once against the published
   release, install-verified from a clean directory, then — in one commit here — the submodule
   pointer and the `recap-gs-src` flake input bumped to the new `main` commit, the `check-pin.sh`
   version assertion added, and `STATUS.md` written. **The `check-pin.sh` change lands here, not
   earlier**: it compares `STATUS.md` against the *pinned* manifest, so adding it before the pin
   moves would leave this repo's own CI red for several units.

## Risks / things to verify early

- **The release gate's refusal path cannot be honestly tested without a bad tag.** Pushing `v0.5`
  proves only that a *matching* tag publishes. Deliberately pushing a mismatched tag to prove the
  other branch leaves a junk tag on a public repository for the sake of one assertion. The plan: run
  the comparison locally with both inputs, record both outcomes in `STATUS.md`, and say plainly that
  the live refusal was not exercised. The thing worth avoiding is a `STATUS.md` implying it was.
- **`check-release.sh` run too soon reads as "no release exists".** The tag workflow takes a minute
  or two to publish, and an unauthenticated API that has run out of rate limit returns a body with
  no releases in it — which the aideas script would report as `no aideas-shell-v release exists at
  all`. This one must distinguish the two: check the HTTP status and the rate-limit headers, and say
  "rate limited" rather than "missing". Run it **once**, late, and never in a loop.
- **U3 edits a file under `.github/workflows/`**, which the `gh` OAuth token cannot push: the
  submodule's remote needs an SSH push URL set before that unit, or the push fails with a scope
  error that reads like a permissions problem with the repository.
- **A new shell script is new code for the quality gate**, and 0.3 recorded that the new-code gate
  has never been exercised by a real change here (0.4 then found a genuine bug with it). Expect
  `check-release.sh` to be the thing Sonar looks hardest at. If it goes red, the `AGENTS.md` ladder
  applies: read it with `pr-gate.sh`, fix it in the same pull request.
- **`version-name` must not become `version`.** Adding an integer `version` key is how an EGO upload
  gets rejected, and it is an easy slip while editing the same object. The test asserts its absence
  for that reason, and that assertion is as much the point of U1 as the other two.
- **The installed-version check is the one the install-verification should actually make.** 0.1–0.4
  each verified "32 files land"; for this entry the file count proves nothing. The check that
  matters is `grep version-name` and `grep url` in the installed `metadata.json`.

## Open Questions

None. Every choice the entry leaves open — where the version is written, what the test pins, the
untouched driver manifest, and the reinstall behaviour `install.sh` keeps — is recorded as an
assumption under **Context** rather than as a question, because each is cheap to reverse and none
of them blocks the work.
