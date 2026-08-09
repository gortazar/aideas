status: done
version: 0.1
started_at: 2026-08-05
last_session_id: f47b1790-b735-4335-86d2-23da85419c6f
last_run: 2026-08-06T17:46:25+02:00
last_cycle_cost_usd: 4.1371225

## Log
- 2026-08-06T17:46:25+02:00 — done ($4.1371225)
- 2026-08-06T14:10:10+02:00 — in_progress ($9.796342500000005)
- 2026-08-06T01:22:08+02:00 — in_progress ($10.139659)
- 2026-08-05T13:26:54+02:00 — in_progress ($8.671821999999997)

## Done

Every feature in `PLAN.md` is delivered, tested and green, and the completion criterion from
the answered open question — push to the remote, checks passing, merge, checks passing again
on `main` — is met for all three changes below.

The behavioural change is **merged upstream and green**. `main` is at
[870d00e](https://github.com/gortazar/gnome-shell-pwgen/commit/870d00e); the idea pins that
commit twice (submodule gitlink and `pwgen-src` flake input) and `nix flake check` is green
against it.

- The extension generates passwords in-process — no `pwgen` binary, no `Gio.Subprocess`, no
  `GLib.spawn*`. Entropy from `crypto.getRandomValues` when GJS provides it, otherwise
  `/dev/urandom` through the async Gio API; rejection sampling for unbiased character choice;
  every enabled class guaranteed and Fisher–Yates-shuffled into place; a hard failure rather
  than a weaker password if entropy cannot be read
  (PR [#1](https://github.com/gortazar/gnome-shell-pwgen/pull/1)).
- A generation in flight is cancelled when the indicator is destroyed, so disabling the
  extension mid-generation no longer resolves into a torn-down menu
  (PR [#3](https://github.com/gortazar/gnome-shell-pwgen/pull/3)).
- The smoke test runs entirely inside a throwaway session of its own
  (PR [#2](https://github.com/gortazar/gnome-shell-pwgen/pull/2)).
- 33 headless unit tests under plain `gjs`, plus grep-level guards against shell-only imports,
  subprocess calls, non-CSPRNG randomness, and CI scripts reading the caller's environment.
- Upstream CI is green on `main`: ESLint, `node --check`, unit tests, `shexli` over the packed
  zip, and a real headless GNOME Shell booting the extension, generating a password and being
  disabled mid-generation on Fedora 40–44 and rawhide (GNOME 46–50).
- This folder: `upstream/` submodule, `flake.nix` (dev shell, unit tests, schema compile,
  upload-zip packaging, `nix build`), `scripts/check-pin.sh` keeping the two pins in step,
  `scripts/screenshot.sh` regenerating `screenshots/` from a nested headless shell,
  `README.md`, and `ci-pwgen.yml` running the pin check plus `nix flake check`.

### Session 2026-08-06

Two defects found and fixed, both by running the extension's own harness rather than reading
it.

1. **`ci/smoke-test.sh` was destructive outside a container.** It installed into
   `$HOME/.local/share/gnome-shell/extensions` and rewrote `org.gnome.shell
   enabled-extensions`. Run on this machine it wrote *through* the symlinks `install.sh`
   leaves there — overwriting the working copy at `~/git/pwgen-gs` — and reduced the live
   session's extension list to this one extension, because dconf is per-user and
   `dbus-run-session` does not isolate it. Both were repaired: the live shell had not yet
   reloaded the list, so the original enabled set was read back out of its in-memory state
   and written again, and the clone was restored with `git checkout`. The script now builds
   its own `HOME` and `XDG_RUNTIME_DIR`, with tests asserting it. Two things that had made it
   unrunnable outside CI went with it: the `/run/systemd/seats` guard now asks logind instead
   of assuming it is unreachable, and the `ENABLED` check accepts builds whose
   `GetExtensionInfo` omits `state`.
2. **Disabling mid-generation used a destroyed menu.** The continuation after the entropy
   read ran into a disposed `St.BoxLayout` — six `Gjs-CRITICAL`s per disable. The indicator
   now holds a `Gio.Cancellable` cancelled from its `::destroy` handler; the cancellable
   reaches Gio, so the read is torn down rather than ignored. `ci/selftest-hook.js` has a
   scenario that disables mid-generation, and the smoke test fails on
   `has been already disposed` — verified to fail without the fix and pass with it.

## Deviations from PLAN.md

- The plan expected `gnome-extensions pack` in `nix flake check`. It is not used: the tool
  ships with `gnome-shell`, whose Nix closure is about a gigabyte to download for one CLI
  invocation. `checks.pack` assembles and verifies the same file set (metadata fields, the
  compiled schema, `lib/generator.js`) via `pwgen-pack`, and the extension's own CI already
  runs `shexli` over that zip.
- ESLint is not a flake check either: the extension pins its own ESLint 9 in
  `upstream/package.json`, and reproducing that version through nixpkgs would risk checking a
  different linter than upstream CI runs. It runs in the dev shell and in upstream CI.

## Deliberately not done

- **Submitting the packed zip to extensions.gnome.org.** That is a publishing decision, not a
  build step, and it is outside what the answered open question defines as done. `nix build`
  produces the zip whenever it is wanted.
- **`ci-pwgen.yml` has never run on GitHub.** It cannot here: this repository's `origin` is a
  local bare repo in the sandbox. Both of its steps were instead verified by hand from a
  clean `--recurse-submodules` clone, most recently at the current pin.
- **The merged upstream branches** (`in-process-generator`, `ci-harness-isolation`,
  `disable-cancels-generation`) still exist on the remote. Deleting branches in someone's
  repository is not this idea's business, and it changes nothing.

## Verified at close

At pin `870d00e`, from this committed tree: `scripts/check-pin.sh` passes (both pins agree),
`nix flake check` runs its three checks green, the headless suite is 33/33, upstream CI is
green on `main` with no open pull requests, and the line references in the extension's
`GNOME_REVIEW_RULES.md` still match the code they cite.

Difficulty estimate: medium, as planned. The generator itself was straightforward. What took
the time was everything shaped by the review rules — async entropy, cancellation on teardown,
headless testability — and two harness bugs that only a real shell could surface.
