# Plan: pwgen — Gnome Shell extension for secure password generation

Difficulty estimate: medium — the generator itself is small, but doing it *correctly* (real CSPRNG
under GJS, unbiased character selection) plus satisfying the extensions.gnome.org review rules and
getting a headless GJS test suite green in CI is where the work is.

## Context

`pwgen` is an existing Gnome Shell extension (upstream: `github.com/gortazar/gnome-shell-pwgen`)
that generates a password and puts it on the clipboard. Today it shells out to the external
`pwgen(1)` binary. The [EGO review
guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) make that a
rejection risk: spawning external programs is only accepted when there is no alternative, the
binary is not guaranteed to be installed on a user's system, and the current call path is a
blocking synchronous spawn on the compositor's main loop.

The change: drop the subprocess entirely and generate passwords in-process, in JavaScript, from a
cryptographically secure random source.

Assumption (stated rather than asked): generated passwords keep parity with what the extension
produces today via `pwgen` — i.e. a secure, non-pronounceable password including symbols. If
reading the upstream source shows different flags in use, match those instead and note it in
`STATUS.md`.

## Features

- **In-process secure password generation** — no `pwgen` binary, no `GLib.spawn*`, no
  `Gio.Subprocess`; the extension has zero runtime dependencies beyond Gnome Shell itself.
- **CSPRNG-backed randomness** — bytes come from the OS entropy pool. Primary source:
  `/dev/urandom` read through `Gio.File` (async, never blocking the main loop). If the targeted
  GJS versions turn out to expose `globalThis.crypto.getRandomValues`, prefer that and keep the
  `/dev/urandom` path as fallback. Never `Math.random()` or `GLib.random_int()` — neither is
  cryptographically secure.
- **Unbiased character selection** — rejection sampling over the charset rather than `byte %
  charset.length`, so no character is more likely than another; covered by a test.
- **Configurable password shape** — length and character classes (lowercase, uppercase, digits,
  symbols), with a guarantee that at least one character from each enabled class appears, and the
  guaranteed characters shuffled into random positions (Fisher–Yates over CSPRNG bytes, not a
  fixed prefix).
- **Clipboard copy** — generated password goes straight to the clipboard via `St.Clipboard`
  (CLIPBOARD selection), with the existing panel/menu UX preserved.
- **Review-rules compliance** — ESM `import` syntax and the modern `Extension`/`ExtensionPreferences`
  base classes; every timeout, signal handler and UI object created in `enable()` torn down in
  `disable()`; no destructive/global monkey-patching left behind; no `eval`, no remote code, no
  bundled binaries; correct `metadata.json` (uuid, `shell-version`, url, GPL-2.0-or-later);
  compiled GSettings schema shipped with the sources.
- **Headless unit test suite** — the generator lives in a Shell-free module (`lib/generator.js`)
  importing only GLib/Gio, so it runs under plain `gjs` in CI with an injectable byte source for
  deterministic tests.
- **Reproducible environment + green CI** — `flake.nix` providing `gjs`, `glib`, ESLint and
  `gnome-extensions`; `nix flake check` runs lint + tests + `gnome-extensions pack` validation;
  `.github/workflows/ci-pwgen.yml` runs it on push and PR for the branch carrying this change.

## Approach

1. **Bring the upstream extension into `ideas/pwgen/`** (see Open Questions) and get it building
   and packing unchanged, so the diff that follows is only about the generator.
2. **Scaffold the environment first**: `flake.nix`, ESLint with the GJS/GNOME config, and the
   test runner wired into `nix flake check`; confirm `ci-pwgen.yml` goes green on the branch
   *before* the behavioural change lands. A red baseline is much harder to debug later.
3. **Write failing tests first** (per `AGENTS.md`): requested length is honoured; output only uses
   characters from the enabled classes; each enabled class is represented; a stubbed byte source
   producing out-of-range values proves rejection sampling rather than modulo bias; a
   chi-square-ish distribution smoke test over many samples; guaranteed characters are not always
   at fixed positions; invalid inputs (length below the number of enabled classes, no classes
   enabled) are rejected explicitly.
4. **Implement `lib/generator.js`**: `randomBytes(n)` (injectable source, defaults to the CSPRNG
   read), `randomIntBelow(n)` with rejection sampling, `shuffle(array)`, `generate({length,
   classes})`.
5. **Rewire `extension.js`** to call the generator and delete the subprocess path, the `pwgen`
   availability check, and any related error handling/notifications that no longer apply.
6. **Audit against the review guidelines** as an explicit pass with the checklist open: session
   modes, `disable()` completeness, no main-loop blocking I/O, metadata correctness, no leftover
   `console.log` noise.
7. **Document**: update `README.md` (nix develop, run tests, build/pack, install locally, publish)
   and add `screenshots/` once it runs.

## Risks / things to verify early

- **GJS entropy API availability** — whether `crypto.getRandomValues` exists depends on the GJS
  version behind the targeted Shell releases. Verify in the spike; the `/dev/urandom` path must
  work regardless, and its failure mode must be "refuse to produce a password", never a silent
  fall back to a weak RNG.
- **Async vs. sync read** — reading `/dev/urandom` synchronously is fast in practice, but review
  prefers async I/O; use the async API and keep the menu responsive.
- **Testing under CI without a display** — the generator module must not import `St`, `Clutter`,
  `Shell` or `resource:///org/gnome/shell/...`, or the headless tests break. Enforce with a lint
  rule or a grep-based check in the test suite.
- **Packing in CI** — `gnome-extensions pack` needs a matching `metadata.json` and compiled
  schemas; treat a pack failure as a test failure so review-blocking mistakes surface in CI.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Where should the code live? The idea links to `github.com/gortazar/gnome-shell-pwgen` (the link *text* says `gortazar/pwgen` — which is correct?), but `AGENTS.md` requires all work to stay inside `ideas/pwgen/`. Should the upstream sources be vendored into `ideas/pwgen/` and developed here, or should this idea clone/fork the upstream repo and push a branch there?
- [ ] What is "done"? Is it enough that this repo's `ci-pwgen.yml` is green on the branch, or does the change also need a pushed branch/PR against the upstream repo (and if so, is push access available), and/or an actual submission to extensions.gnome.org?
- [ ] Is a preferences UI for password length and character classes in scope, or should the extension keep whatever fixed policy it uses today? `AGENTS.md` forbids inventing features, and the upstream source is not reachable from this sandbox to check what already exists.
