# Plan: gnome-tasks 0.3 — make `version-name` and `url` provable

Difficulty estimate: **easy** — one JSON file to correct, one new test file in an existing suite, and
a two-line flake change so the test can see `STATUS.md`. No new behaviour, no release machinery, and
the whole thing is verifiable in one `nix flake check`.

## Context

`src/extension/metadata.json` today reads:

```json
  "url": "https://github.com/patxi/aideas",
  "version-name": "0.1.0"
```

Both lines are wrong, and both are wrong in the same way: nothing ever compared them to anything.

* **`version-name` says `0.1.0`; `STATUS.md` says `version: 0.2`.** It is also not the form this
  repo's versioning rules use — two integer components, `0.2`, not a three-component semantic
  version. The Shell shows `version-name` in the extension list, so an installed copy currently
  misreports which version of the idea it is.
* **`url` points at `https://github.com/patxi/aideas`, an account that does not exist.** It 404s for
  anybody who follows it from the Shell's extension list. This idea has no repository of its own
  (`STATUS.md` → *This idea has no repository of its own*), so the correct target is this repo's path
  to it: `https://github.com/gortazar/aideas/tree/main/ideas/gnome-tasks` — the form
  `ideas/aideas/src/extension/metadata.json` already uses.

The fix is two string edits. **The deliverable is the test that keeps them fixed**: a test under
`tests/unit/` that fails whenever `version-name` and the `version:` header in `STATUS.md` disagree,
so the next bump cannot silently leave the artefact behind. `ideas/aideas/tests/unit/metadata.test.js`
is the nearest model, but it hardcodes its version (`assertEquals(metadata['version-name'], '0.5')`)
and so has to be edited at every bump — exactly the manual step that let this drift happen. This test
reads `STATUS.md` instead.

Assumptions, stated rather than asked:

* **This idea remains in-tree, with no upstream repository and no release.** The entry says so
  outright: the release-side checks the recap-gs and meet entries carry do not apply here. Nothing in
  this entry creates `gortazar/gnome-tasks`, adds a release workflow, or packs an artefact. 0.1 and
  0.2 shipped nothing installable and 0.3 ships nothing installable; `STATUS.md` will say that in
  those words rather than leaving it to be inferred from an absence.
* **Minor update: `version: 0.2` → `0.3`**, set in the same commit that finishes the work, in both
  `STATUS.md` and `metadata.json` — which, once this test exists, is the only state it permits. If
  the generated `## This cycle` block names a different version, that block wins.
* **The test reads `STATUS.md` from the tree, not a copy.** One source of truth; a duplicated version
  string anywhere would be a third thing to drift.
* **Sonar and the pull-request gate are not in scope.** This idea is analysed as part of the
  whole-repo `gortazar_aideas` project and has no repository of its own to gate; the ladder in
  AGENTS.md is about idea repositories.

## Features

* **`version-name` is the idea's current version, in this repo's two-component form.** `0.1.0` →
  `0.3`, matching `STATUS.md`'s `version:` header exactly, set in the commit that finishes the entry.
* **A unit test that fails when the two disagree.** New `tests/unit/metadata.test.js`, in the existing
  suite run by `tests/run.js` and by the flake's `unit` check. It parses `STATUS.md`'s `version:`
  header and `src/extension/metadata.json`, and asserts:
  - `version-name` equals the `version:` header, character for character;
  - both match `^\d+\.\d+$`, so `0.1.0` would fail even if somebody set the header to `0.1.0` too —
    the form is part of the rule, not just the agreement;
  - `STATUS.md` has exactly one `version:` header to read, so a malformed file fails loudly instead
    of silently comparing against `undefined`.
* **The `unit` check can see `STATUS.md`.** `flake.nix`'s `sourceFor` deliberately excludes
  `STATUS.md` and `docs/` so that editing them does not invalidate the build cache. A test that reads
  `STATUS.md` needs it as an input, or it fails in the sandbox and passes locally — the worst of both.
  So the `unit` check gets its own fileset, `sourceFor pkgs` plus `./STATUS.md`; `lint`, `dbus` and
  `bundle` keep the narrow one. The deliberate consequence, recorded in a comment next to it: a
  `STATUS.md`-only edit now re-runs the unit suite, which is the point.
* **`url` points somewhere that exists.** `https://github.com/gortazar/aideas/tree/main/ideas/gnome-tasks`,
  asserted in the same test as an exact string.
* **The same dead account is removed from the other two files that ship it.** Beyond the literal
  entry, which names `src/extension/metadata.json` only, `github.com/patxi/aideas` also appears in
  `data/gnome-tasks-daemon.service.in` (`Documentation=`, which `systemctl show` hands to a user) and
  `tools/probe/metadata.json` (test-only, never shipped). Leaving a known-dead URL in an installed
  unit file, in the entry that is about dead URLs, is not defensible. One assertion covers the class:
  no file under `src/`, `data/` or `tools/probe/` mentions `github.com/patxi`. Kept as its own unit so
  it can be dropped without touching the required work.
* **`STATUS.md` says plainly that this idea ships nothing installable.** Not as a footnote inside the
  no-upstream section, but as a statement a reader meets: there is no release, no installable
  artefact and no installer for 0.1, 0.2 or 0.3; `make install` from a checkout is the only way to run
  it; and the reason is that the idea has no repository of its own to tag. Plus the usual 0.3 record —
  what this entry changed, the unit list, the version, the difficulty estimate.

## Approach

Tests first, one commit per unit, never ending a unit in the red window.

1. **U1 — the version test.** Write `tests/unit/metadata.test.js` with the `version-name` assertions,
   add `./STATUS.md` to the `unit` check's fileset, `git add -A && make test-unit` and watch it fail
   against `0.1.0`. Then set `version-name` to `0.2` — today's header value, so the test is green and
   the tree is honest at this commit; the bump to `0.3` is U4's job and the test is what forces the
   two to move together. One commit: test, flake, metadata, `STATUS.md` unit line.
2. **U2 — the url.** Extend the same test with the exact-`url` assertion, see it fail, fix
   `src/extension/metadata.json`, commit.
3. **U3 — the other two occurrences.** The class assertion over `src/`, `data/` and
   `tools/probe/`, then `data/gnome-tasks-daemon.service.in` and `tools/probe/metadata.json`.
4. **U4 — the bump and the record.** `version: 0.3` in `STATUS.md` and `version-name: "0.3"` in
   `metadata.json`, in one commit — splitting them is what the test now refuses. Rewrite the
   `STATUS.md` record for 0.3, including the "ships nothing installable" statement and the
   `## Log` line. Full `git add -A && nix flake check --print-build-logs` before committing.

## Verification

* **The test is falsifiable, and seen to be.** Each assertion is observed failing before its fix
  lands, and U4 ends with one deliberate mutation — set `version-name` to `0.4`, run `make test-unit`,
  confirm red, revert — recorded in `STATUS.md`. A guard nobody has watched fail is a guess.
* **`git add -A && nix flake check --print-build-logs` green** over all four checks. The `git add` is
  not optional: a flake sees only git-tracked files, and a brand-new untracked test is invisible and
  appears to pass.
* **Unit and D-Bus counts re-read** from that run (151 + 56 before this entry; unit goes up by the
  number of new tests) and written into `STATUS.md` rather than carried over.
* **Remote CI checked once**, late: `gh run list --workflow=ci-gnome-tasks.yml --limit 3`. One look,
  no `--watch`, no sleep loop. The agent does not push this repo, so the run for this change may not
  exist yet — if so, say that rather than implying it was read.
* **Nothing outside `ideas/gnome-tasks/` is modified.**

## Risks / things to watch

* **Cache invalidation is the cost, and it is intended.** Adding `STATUS.md` to the `unit` fileset
  means every `STATUS.md` edit — AGENTS.md asks for one per unit — re-runs that check. Scoping it to
  `unit` alone keeps `lint`, `dbus` and `bundle` cached. Do not "fix" this later by dropping the input
  back out; that silently disarms the test in CI while it still passes locally.
* **Parsing `STATUS.md` too cleverly.** The header is a plain `version: 0.2` line at the top. A loose
  regex would also match the word elsewhere in a 260-line document; anchor it, and fail on zero or
  more than one match instead of taking the first.
* **Do not touch the `status:` header.** The orchestrator rewrites it when it queues an entry, and a
  previous entry already had to explain that `not_started` there is not a bug.
* **The three-component form is the trap, not just the mismatch.** Setting `version-name` to `0.2.0`
  would satisfy a naive equality test against a header someone also wrote as `0.2.0`. The format
  assertion exists so the repo's own rule — integers, two components, `0.9` → `0.10` — is what is
  enforced.
* **Scope pressure toward shipping.** An entry about `version-name` invites adding a release workflow,
  a packed zip or an installer, because that is what every other idea has. The entry rules it out and
  so does this plan: the test is the whole deliverable.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->

Nothing here is blocking. The entry settles the two decisions that would otherwise be open — the
target version form, and that no release or upstream repository is in scope — and the remaining
judgement calls (which flake check gets `STATUS.md`, how far the dead-URL fix reaches) are recorded
as assumptions above rather than as questions, because either answer leaves the entry deliverable.
