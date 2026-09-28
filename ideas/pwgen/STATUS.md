status: done
version: 0.2
started_at: 2026-08-05
last_session_id: 71441f5d-4d9c-4778-a852-01fc02eb428d
last_run: 2026-09-15T20:13:40+02:00
last_cycle_cost_usd: 1.3024194999999998

## Log
- 2026-09-15T20:13:40+02:00 — in_progress ($1.3024194999999998)
- 2026-09-15T18:39:37+02:00 — in_progress ($3.7621322500000005)
- 2026-08-06T17:46:25+02:00 — done ($4.1371225)
- 2026-08-06T14:10:10+02:00 — in_progress ($9.796342500000005)
- 2026-08-06T01:22:08+02:00 — in_progress ($10.139659)
- 2026-08-05T13:26:54+02:00 — in_progress ($8.671821999999997)

## Pin

**Upstream pin:** `dd8d83b04da9caee95f4c5230b7609a312d317d3`

That is the commit the `upstream/` gitlink, the `pwgen-src` input in `flake.lock` and this
line all name, and `scripts/check-pin.sh` fails if any of the three drift apart. It is the
tip of `main` on `gortazar/gnome-shell-pwgen` — the squash merge of pull request
[#6](https://github.com/gortazar/gnome-shell-pwgen/pull/6) — and it is the commit the `v0.2`
tag points at, checked with `merge-base --is-ancestor` rather than assumed.

## 0.2 — done (2026-09-28)

The entry closed the five audit gaps. What "done" covers:

1. **A release exists.** [`v0.2`](https://github.com/gortazar/gnome-shell-pwgen/releases/tag/v0.2),
   published 2026-09-28 by the new `release.yml`, carrying
   `pwgen-generator@pwgen-gs.patxi.shell-extension.zip` and its `.sha256`.
2. **The extension installs without compiling**, by the one-line `curl … | sh` at the top of
   both READMEs, verified against the published release from a clean directory.
3. **`flake.nix` lives in the extension's own repository**, and this wrapper consumes it
   instead of keeping a second copy of the checks.
4. **The pins agree**, and `check-pin.sh` now also checks the commit this file names, so
   gap 4 cannot recur silently.
5. **This file asserts only what the tree shows.** The two false sentences are gone; what
   replaced them is below, with the evidence beside each claim.

All seven units landed.

| Unit | What it delivered |
| --- | --- |
| U1 | `STATUS.md` honesty pass; `check-pin.sh` asserts the pin this file names |
| U2 | `flake.nix` upstream (PRs [#4](https://github.com/gortazar/gnome-shell-pwgen/pull/4), [#5](https://github.com/gortazar/gnome-shell-pwgen/pull/5)) |
| U3 | the wrapper flake became a consumer; pin bumped |
| U4 | the downloading `install.sh`, with the references to `scripts/install-local.sh` fixed (PR [#6](https://github.com/gortazar/gnome-shell-pwgen/pull/6)) |
| U5 | `release.yml`, `version-name` in `metadata.json`, `scripts/check-release.sh` here |
| U6 | `v0.2` published and verified, and the installer run for real against it |
| U7 | `version: 0.2`, the wrapper `README.md`, the pin at merged `main`, `status: done` |

### Verified at close (2026-09-28)

Every line here is the output of a command run against this committed tree, not a
recollection.

- **`scripts/check-release.sh 0.2` → PASS.** The release exists, carries both assets, the
  published checksum matches the downloaded bytes, the zip holds `metadata.json`,
  `extension.js`, `prefs.js`, `LICENSE`, `lib/generator.js` and `schemas/gschemas.compiled`,
  and the packed `metadata.json` declares `version-name 0.2`. The `v0.2` tag points at
  `dd8d83b`, the pinned commit.
- **The install command was executed**, not read: `curl -fsSL …/main/install.sh | sh` in an
  empty directory under a sealed environment (`env -i`, throwaway `HOME`, `XDG_DATA_HOME`,
  `XDG_CONFIG_HOME` and `PREFIX`). It printed `checksum ok`, unpacked the seven expected
  files, wrote nothing outside `PREFIX` except a dconf cache inside the throwaway home, and
  the installed `metadata.json` says `0.2`.
- **`scripts/check-pin.sh` → PASS** at `dd8d83b`.
- **`nix flake check` here → green**, running upstream's three checks at the pinned commit;
  the suite is **48/48** (33 from 0.1, plus nine installer tests and six release tests).
- **`nix build` here → the packed zip**, nine files.
- **Upstream CI on pull request #6: every required check passed** — ESLint and syntax, the
  unit tests, the EGO package lint, GNOME Shell on Fedora 40–44 and rawhide, and
  `SonarQube Cloud / Analysis`. The merge was by auto-merge after those checks, not by any
  bypass; `main` is behind a ruleset with no bypass actors.
- **The release run** (36409410557) ran `nix flake check`, the tag/`version-name` comparison,
  the pack and the publish, all green.
- **SonarQube Cloud: the gate is `OK` and no BLOCKER is open** under either severity model
  (`severities=BLOCKER` and `impactSeverities=BLOCKER` both return none). The highest open
  finding is CRITICAL / HIGH-maintainability: twelve issues, two `javascript:S2004`
  (function nesting) in `lib/generator.js` and ten `shelldre` style findings in `ci/`. All
  predate this entry, and the gate judges new code.

### Two defects the new tests found

Both were in the first draft of the installer, and neither is visible by reading it:

1. **`glib-compile-schemas` over a directory with no `.gschema.xml` removes the
   `gschemas.compiled` that is already there** ("No schema files found: removed existing
   output file"). The installer recompiles the schema on the way in, so an asset packed
   without the schema source would have been installed unloadable, silently — the script
   ignores the tool's exit status on purpose. The recompile is now guarded on the source
   being present, and a test covers exactly that asset shape.
2. **A failed download deleted the existing install.** The first draft cleared the
   destination before unpacking, so anyone whose download failed lost a working extension.
   The asset is now staged beside the download and swapped in only after verification, and a
   test installs a fake "previous install" and asserts it survives a failed run.

### What the previous revision of this file got wrong

Kept here because the entry existed to correct it:

- It named `870d00e` as the pin twice; the gitlink and `flake.lock` were at `57b3bf6`.
- It said "`ci-pwgen.yml` has never run on GitHub. It cannot here: this repository's `origin`
  is a local bare repo in the sandbox." Both halves were false: `origin` is
  `git@github.com:gortazar/aideas.git` and the workflow had run on every push touching this
  folder. That sentence mattered more than the others because it *explained away* a missing
  check rather than reporting one.
- It said every line reference in `GNOME_REVIEW_RULES.md` still matched the code. Three did
  not, and were fixed upstream: the Promise wrapper (now `lib/generator.js:61`), the two
  logging calls (`extension.js:136` and `:150`) and the hardcoded grey (`:164`).
- It implied a `v0.1` release. None existed. Per the answered open question in `PLAN.md`,
  none was manufactured after the fact: **0.1 never had a release, and `v0.2` is this
  extension's first.**

## 0.1 — what shipped (closed 2026-08-06)

Merged upstream through PRs [#1](https://github.com/gortazar/gnome-shell-pwgen/pull/1),
[#2](https://github.com/gortazar/gnome-shell-pwgen/pull/2) and
[#3](https://github.com/gortazar/gnome-shell-pwgen/pull/3):

- Passwords generated in-process — no `pwgen` binary, no `Gio.Subprocess`, no `GLib.spawn*`.
  Entropy from `crypto.getRandomValues` when GJS provides it, otherwise `/dev/urandom`
  through the async Gio API; rejection sampling for unbiased character choice; every enabled
  class guaranteed and Fisher–Yates-shuffled into place; a hard failure rather than a weaker
  password if entropy cannot be read.
- A generation in flight is cancelled when the indicator is destroyed, so disabling the
  extension mid-generation no longer resolves into a torn-down menu.
- The smoke test runs entirely inside a throwaway session of its own, after it was found to
  write through the local installer's symlinks into a real working copy and to rewrite the
  live session's extension list.
- 33 headless unit tests under plain `gjs`, plus grep-level guards against shell-only
  imports, subprocess calls, non-CSPRNG randomness, and CI scripts reading the caller's
  environment.
- Upstream CI: ESLint, `node --check`, unit tests, `shexli` over the packed zip, and a real
  headless GNOME Shell booting the extension on Fedora 40–44 and rawhide (GNOME 46–50).

## Deviations from PLAN.md

- **The plan's unit order did not survive the cycle boundary, and the result is on `main`
  either way.** The 2026-09-15 session was stopped mid-U4; the orchestrator's sweep merged
  the open pull request and opened a second one (#5) carrying the uncommitted rename of
  `install.sh` to `scripts/install-local.sh`. So that rename reached `main` before the
  installer that replaces it, leaving the upstream README pointing at a file that did not
  exist for thirteen days. U4 in this session repaired it.
- **`gnome-extensions pack` is still not a flake check**, for the reason recorded in 0.1: the
  tool ships with `gnome-shell`, about a gigabyte of closure for one CLI invocation.
  `checks.pack` assembles and inspects the same file set, and upstream CI runs `shexli` over
  that zip.
- **ESLint is still not a flake check**: the extension pins its own ESLint 9 in
  `package.json`, and reproducing that version through nixpkgs would check a different
  linter than upstream CI runs. It runs in the dev shell and in upstream CI.
- **`install.sh` is not in `sonar.sources`.** It is shipped code and arguably should be, but
  `sonar.sources` names the extension's JavaScript, and adding a POSIX `sh` script would
  bring in `shelldre:S7688` ("use `[[` instead of `[`"), which is wrong about `#!/bin/sh` as
  a matter of language rather than of these lines. That is a quality-profile question, not
  something to settle inside this entry; left as an observation rather than a silent change.

## Deliberately not done

- **Submitting the packed zip to extensions.gnome.org.** A publishing decision, not a build
  step; the installation path for this entry is the `curl` installer, as the entry says.
  `nix build` produces the zip whenever it is wanted.
- **Deleting the merged upstream branches** (`in-process-generator`, `ci-harness-isolation`,
  `disable-cancels-generation`, and the sweep's `agent/pwgen-sweep`). Removing branches in
  someone's repository is not this idea's business.
- **Touching the copy installed in the developer's own session.**
  `~/.local/share/gnome-shell/extensions/pwgen-generator@pwgen-gs.patxi` is an older build
  there — its description still mentions the `pwgen` binary. Updating it is the user's call;
  `curl -fsSL …/install.sh | sh` is now the way.
