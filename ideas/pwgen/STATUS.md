status: in_progress
version: 0.1
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

**Upstream pin:** `db1fbe5a5eff8a401fb29c02d4c8ff445fdfa4fd`

That is the commit the `upstream/` gitlink and the `pwgen-src` input in `flake.lock` point at,
and `scripts/check-pin.sh` fails if this line, the gitlink and the lock ever name three
different things. It is the tip of `main` on `gortazar/gnome-shell-pwgen`, the merge of pull
request [#5](https://github.com/gortazar/gnome-shell-pwgen/pull/5), and it is an ancestor of
`origin/main` rather than a commit living only on a branch.

## Current entry: close the five audit gaps (0.1 → 0.2)

Difficulty estimate: medium, as planned. Seven units.

| Unit | What it delivers | State |
| --- | --- | --- |
| U1 | `STATUS.md` says only what the tree shows; `check-pin.sh` asserts the pin this file names | **done** |
| U2 | `flake.nix` in the extension repository, checks and package under their existing names | **done**, merged (PR [#4](https://github.com/gortazar/gnome-shell-pwgen/pull/4), PR [#5](https://github.com/gortazar/gnome-shell-pwgen/pull/5)) |
| U3 | wrapper `flake.nix` consumes upstream's flake; pin bumped to `db1fbe5` | **done** (this commit) |
| U4 | `curl`-able `install.sh` upstream; the references to the moved local installer follow | next |
| U5 | `release.yml` upstream (tag push or dispatch, self-tagging), `version-name` in `metadata.json`, `scripts/check-release.sh` here | — |
| U6 | `v0.2` published by the workflow, verified with `check-release.sh` and a clean-directory install | — |
| U7 | `version: 0.2`, wrapper `README.md`, pin at merged `main`, `status: done` | — |

### What landed upstream between sessions

The 2026-09-15 cycle ended mid-unit, and the orchestrator's sweep carried the work the rest
of the way: draft pull request #4 (`flake.nix`, the three review-rule line fixes) was merged,
and the sweep opened and merged #5 with what was still uncommitted — the rename of
`install.sh` to `scripts/install-local.sh`. Upstream CI is green on `main` at `db1fbe5`
(run 34996814981).

That rename landed **without** the rest of U4. `README.md` upstream still tells people to run
`./install.sh`, which no longer exists, and there is no downloading installer in its place.
Repairing that is U4, this session's next unit, and until it lands the extension's own README
is wrong about how to install it.

### U3, verified (2026-09-28)

- `ideas/pwgen/flake.nix` no longer defines checks of its own. It takes `pwgen-src` as a
  *flake* input and re-exports `checks` and `packages.default` from it, so there is one
  definition of the checks and it lives beside the code.
- `nix flake check` here: three checks green at the pinned commit, the suite 33/33.
- `scripts/check-pin.sh`: gitlink, `flake.lock` and this file all name `db1fbe5`.

**Releases:** none exist yet. `https://api.github.com/repos/gortazar/gnome-shell-pwgen/releases`
returned an empty list on 2026-09-15, and there are no tags. The open question in `PLAN.md`
was answered (b): **0.1 never had a release and none will be manufactured after the fact.**
The first release of this extension is `v0.2`, cut in U6 from a `main` that carries the
release workflow.

### Corrected in U1

Claims the previous revision of this file made that the tree did not support:

- **The pin.** It named `870d00e` twice; the gitlink and `flake.lock` were both at `57b3bf6`
  (the Sonar wiring landed on `main` after 0.1 closed). Now quoted above and asserted by
  `check-pin.sh`.
- **"`ci-pwgen.yml` has never run on GitHub … `origin` is a local bare repo in the sandbox."**
  False on both counts. `origin` is `git@github.com:gortazar/aideas.git`, and
  `.github/workflows/ci-pwgen.yml` has run on every push touching this folder: the last run
  on `main` (2026-09-02, run 33618555932) was green. Two earlier failures (2026-08-16,
  2026-08-25) were the checkout step failing on *another* idea's submodule URL, not this
  idea's checks.
- **"The line references in the extension's `GNOME_REVIEW_RULES.md` still match the code they
  cite."** Eleven of fourteen do. Three are stale: the "local Promise wrapper
  (`extension.js:26`)" is `lib/generator.js:61` (`readUrandom`); the two logging calls cited
  as `:106` and `:120` are at `extension.js:136` and `:150`; the hardcoded grey cited as
  `:134` is at `:164`. Fixed upstream in this entry's pull request, since the file lives
  there.
- **"`v0.1`" as a release.** Implied, never published. See **Releases** above.

### Re-verified in U1 (2026-09-15)

- `gjs -m tests/run.js` in `upstream/` at the pin: **33/33 passed**.
- Upstream CI on `main`: the weekly scheduled run of 2026-09-14 (34840727321) and the push
  run for the pinned commit (32863901626) both succeeded.
- No open pull requests on `gortazar/gnome-shell-pwgen`; #1–#3 are merged.
- No open BLOCKER issues on the Sonar project `gortazar_gnome-shell-pwgen`. Thirteen open
  issues, none above CRITICAL: two `javascript:S2004` (nesting depth) in `lib/generator.js`,
  eleven `shelldre` style findings in `ci/`. All predate this entry; the gate judges new code.
- `scripts/check-pin.sh`: both pins at `57b3bf6`.

## 0.1 — what shipped (closed 2026-08-06)

Merged upstream through PRs [#1](https://github.com/gortazar/gnome-shell-pwgen/pull/1),
[#2](https://github.com/gortazar/gnome-shell-pwgen/pull/2) and
[#3](https://github.com/gortazar/gnome-shell-pwgen/pull/3):

- The extension generates passwords in-process — no `pwgen` binary, no `Gio.Subprocess`, no
  `GLib.spawn*`. Entropy from `crypto.getRandomValues` when GJS provides it, otherwise
  `/dev/urandom` through the async Gio API; rejection sampling for unbiased character choice;
  every enabled class guaranteed and Fisher–Yates-shuffled into place; a hard failure rather
  than a weaker password if entropy cannot be read.
- A generation in flight is cancelled when the indicator is destroyed, so disabling the
  extension mid-generation no longer resolves into a torn-down menu.
- The smoke test runs entirely inside a throwaway session of its own, after it was found to
  write through `install.sh`'s symlinks into a real working copy and to rewrite the live
  session's extension list.
- 33 headless unit tests under plain `gjs`, plus grep-level guards against shell-only imports,
  subprocess calls, non-CSPRNG randomness, and CI scripts reading the caller's environment.
- Upstream CI: ESLint, `node --check`, unit tests, `shexli` over the packed zip, and a real
  headless GNOME Shell booting the extension on Fedora 40–44 and rawhide (GNOME 46–50).
- This folder: `upstream/` submodule, `flake.nix` (dev shell, unit tests, schema compile,
  upload-zip packaging), `scripts/check-pin.sh`, `scripts/screenshot.sh`, `README.md`, and
  `ci-pwgen.yml` running the pin check plus `nix flake check`.

What 0.1 did **not** ship, and this entry adds: a release, a non-building installer, and a
`flake.nix` in the extension's own repository.

## Deviations from PLAN.md

- The 0.1 plan expected `gnome-extensions pack` in `nix flake check`. It is not used: the tool
  ships with `gnome-shell`, whose Nix closure is about a gigabyte to download for one CLI
  invocation. `checks.pack` assembles and verifies the same file set (metadata fields, the
  compiled schema, `lib/generator.js`) via `pwgen-pack`, and the extension's own CI runs
  `shexli` over that zip.
- ESLint is not a flake check either: the extension pins its own ESLint 9 in
  `upstream/package.json`, and reproducing that version through nixpkgs would risk checking a
  different linter than upstream CI runs. It runs in the dev shell and in upstream CI.

## Deliberately not done

- **Submitting the packed zip to extensions.gnome.org.** A publishing decision, not a build
  step; the installation path for this entry is the `curl` installer. `nix build` produces the
  zip whenever it is wanted.
- **Deleting the merged upstream branches** (`in-process-generator`, `ci-harness-isolation`,
  `disable-cancels-generation`). They still exist on the remote; removing branches in someone's
  repository is not this idea's business.
