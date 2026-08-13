# Plan: recap — install it without a Go toolchain

Difficulty estimate: easy — no new domain logic, just cross-compilation, one release workflow and a
shell script; the only fiddly parts are that this is a monorepo (so tags and "latest release" have to
be namespaced) and that a curl-installer has to be testable without a real release.

## Context

recap 0.1 ships as source. The only documented ways to get a binary are `nix build` and
`go build ./cmd/recap`, both of which assume a toolchain and a checkout. This entry closes that gap:
build the binary in CI, attach it to a GitHub release, and offer a one-line `curl … | sh` install for
people who have neither Nix nor Go.

Three facts about *this* repo shape the work:

1. **`gortazar/aideas` is a public monorepo of many ideas, each independently versioned.** A release
   therefore cannot use a bare `v0.2` tag or the plain `/releases/latest` endpoint — both are
   repo-wide, and the next idea to publish would silently become "the latest recap". Tags are
   namespaced `recap-v<version>` and every lookup filters on that prefix.
2. **The Go module path is `github.com/gortazar/recap`, which is not where the code lives.** So
   `go install github.com/gortazar/recap@latest` cannot work and must not be advertised. Renaming the
   module is out of scope for a minor entry. Local `go build` and the flake remain the from-source
   routes.
3. **The agent building this cannot push, so it cannot cut a release.** Per `AGENTS.md` the
   orchestrator merges and pushes; tags are the user's to push. The workflow is therefore written to
   be verifiable *without* a release (a `workflow_dispatch` dry run that builds and uploads artifacts
   but publishes nothing), and the README says plainly which step a human performs.

Assumptions, stated rather than asked: the binary is published as static per-platform tarballs plus a
`SHA256SUMS` file, with no signing (no key exists here); supported platforms are linux and darwin on
amd64 and arm64 — Windows is out, recap reads `/proc` and unix paths; the installer defaults to
`~/.local/bin` so it never needs `sudo`.

## Features

- **`recap --version`** — prints the version, the commit and the build date, with `dev` as the value
  in an unstamped local build. Not decoration: it is how "did the installer install what it claimed?"
  is answered, and the release smoke test asserts on it. Stamped via `-ldflags -X` from both the
  release script and `flake.nix`.
- **Cross-platform release build** (`tools/release-build.sh`) — one script, run inside `nix develop`
  so CI and a laptop use the same Go, that produces for each of linux/darwin × amd64/arm64:
  `recap_<version>_<os>_<arch>.tar.gz` containing the `recap` binary and `README.md`, plus a single
  `SHA256SUMS` covering all of them. `CGO_ENABLED=0` throughout — the opencode reader's SQLite driver
  is pure Go, which is what makes cross-compiling to four targets a loop rather than a toolchain
  problem. Built with `-trimpath -ldflags "-s -w"` and fixed tar metadata so two runs of the same
  commit produce identical archives.
- **Release workflow** (`.github/workflows/release-recap.yml`) — triggered by pushing a
  `recap-v*` tag, plus `workflow_dispatch` for a dry run. It:
  - **refuses to publish an inconsistent version**: the tag's version must equal `version:` in
    `STATUS.md` and the `version` in `flake.nix`, or the job fails before building. A release whose
    binary reports a different number than its tag is worse than no release.
  - builds via `tools/release-build.sh`, then creates the GitHub release with `gh release create`
    (no third-party actions), attaching every tarball and `SHA256SUMS`, with generated notes.
  - on `workflow_dispatch`, stops after the build and uploads the artifacts to the run instead —
    so the whole path can be exercised on a branch without publishing anything.
  - declares `permissions: contents: write` and nothing else.
- **Install script** (`ideas/recap/install.sh`) — POSIX `sh`, `set -eu`, no bashisms, safe to pipe:
  - detects OS and arch from `uname`, mapping `x86_64`→`amd64` and `aarch64`/`arm64`→`arm64`, and on
    anything else exits with a message naming the Nix and from-source alternatives rather than
    installing a binary that cannot run.
  - resolves the newest `recap-v*` release through the GitHub API, filtered by prefix; `RECAP_VERSION`
    pins an exact version and is also the documented escape hatch from the API's unauthenticated rate
    limit.
  - checks for `curl` and `tar` up front, downloads the tarball and `SHA256SUMS` into a `mktemp -d`
    cleaned up by a `trap`, and **verifies the checksum before extracting** (`sha256sum`, falling back
    to `shasum -a 256`). A mismatch aborts with nothing installed.
  - installs with `install -m 755` into `$RECAP_INSTALL_DIR` (default `$HOME/.local/bin`, created if
    absent), then prints the resolved version and path, and warns with the exact `export PATH=…` line
    if that directory is not on `PATH`. Re-running upgrades in place.
  - takes `RECAP_BASE_URL` and `RECAP_API_URL` overrides. These exist for the tests: pointed at
    `file://` URLs they let the whole script run against a fake release with no network, which is the
    only way a curl-installer gets a test suite at all.
- **Tests for the shipping path, not just the code** — a `tools/install_test.sh` that builds a fake
  release in a temp directory and drives `install.sh` against it over `file://`, asserting: happy path
  installs a runnable binary whose `--version` matches; a corrupted `SHA256SUMS` aborts and leaves the
  target directory untouched; an unsupported arch fails with the alternatives message; a custom
  `RECAP_INSTALL_DIR` is honoured; the `PATH` warning fires only when it should. Plus a
  `release-build.sh` test asserting four tarballs, a `SHA256SUMS` that verifies, and a `recap` binary
  inside each archive.
- **CI wiring** — `nix flake check` gains a lint check running `shellcheck` and `sh -n` over
  `install.sh` and the release scripts, and runs `tools/install_test.sh` (which needs no network, only
  `curl`, `tar` and coreutils). The heavier four-target cross-build test runs as a step in
  `ci-recap.yml` under `nix develop`, not inside the flake sandbox, because a `buildGoModule` check
  has no module cache for four `GOOS`/`GOARCH` pairs.
- **Post-publish smoke test** — after a real release, a matrix job on `ubuntu-latest` and
  `macos-latest` runs the published one-liner against the release just created and asserts
  `recap --version` prints that version. This is also the only coverage the darwin/arm64 artifact
  gets, since it is cross-compiled and never runs here otherwise.
- **README: specific installation instructions** — the current three-line `## Install` section is
  replaced by one that says exactly what to run:
  - the `curl -fsSL …/install.sh | sh` one-liner, with the read-it-first variant
    (`curl -fsSL … -o install.sh`, read, `sh install.sh`) given equal billing, because piping a
    script from the internet into a shell deserves that courtesy;
  - a table of `RECAP_VERSION` and `RECAP_INSTALL_DIR`, what the script verifies, and — honestly —
    what the checksum does *not* protect against, since the checksums are served from the same repo as
    the binary: it detects a corrupted download, not a compromised release;
  - Nix: `nix profile install 'github:gortazar/aideas?dir=ideas/recap'` and the equivalent `nix run`,
    with the `?dir=` subdirectory syntax spelled out because this is a monorepo;
  - from source: clone and `go build ./cmd/recap`, plus a note that `go install` by module path does
    not work here and why;
  - a supported-platform table, `recap --version` as the verification step, and uninstall (`rm` the
    binary, and where the cache and config live).
- **README: how a release is cut** — under Development: bump `version:` in `STATUS.md` and
  `flake.nix`, commit, `git tag recap-v0.2 && git push origin recap-v0.2`, what the workflow then
  does, how to dry-run it first, and the two settings that can make it fail (repo Actions token
  restricted to read-only; the tag not matching the recorded version).

## Approach

Units, each one commit, tests first:

1. **U1 — `--version`.** Flag and output shape, tested in `internal/cli` against an injected version
   variable; `-ldflags -X` wired into `flake.nix` so `nix build` stamps it too.
2. **U2 — `tools/release-build.sh`** plus its test and the shellcheck/`sh -n` check in `flake.nix`.
   Produces `dist/` locally; verified by running it for one fake version.
3. **U3 — `install.sh`** with the `file://` seams, and `tools/install_test.sh` covering the cases
   listed above. Written against a fake release built by U2's script, so U2 comes first.
4. **U4 — `release-recap.yml`**: version-consistency guard, build, `gh release create`, plus the
   `workflow_dispatch` dry-run path. Guard logic extracted into a small script so it can be tested
   without a workflow run.
5. **U5 — post-publish install smoke job** on ubuntu + macos.
6. **U6 — README** install, uninstall, platform table and release-cutting sections; `ci-recap.yml`
   updated with the cross-build step.
7. **U7 — version bump to `0.2`** in `STATUS.md` (and `flake.nix`), `status: done`, with `STATUS.md`
   recording that the release workflow's publishing half is unverified until a human pushes the first
   tag.

## Risks / things to verify early

- **No release exists yet, and the agent cannot create one.** Everything up to `gh release create` is
  verifiable in-cycle (dry run, artifacts, installer against a fake release); the published path is
  not. Do not claim it is. `STATUS.md` must say so, the way 0.1 said `--smart` had never made a live
  API call.
- **`/releases/latest` is repo-wide.** Verify the prefix-filtered API query returns the right release
  when other ideas eventually publish; the installer must fail with a clear message, not install a
  `pwgen` tarball, if no `recap-v*` release exists at all.
- **Unauthenticated GitHub API rate limit (60/hour/IP).** A rate-limited response must produce a
  message pointing at `RECAP_VERSION`, not an unhelpful parse error on an error body.
- **The repo has no `LICENSE`.** The tarball therefore ships the binary and `README.md` only.
  Publishing binaries from an unlicensed repo is worth a note to the user; adding a license is the
  user's call, not this entry's.
- **`vendorHash` in `flake.nix`.** Nothing here should change `go.sum`, but if it does, the hash must
  be updated in the same commit or `nix flake check` breaks for everyone.
- **Darwin is cross-compiled blind.** Until the macos smoke job runs against a real release, the
  darwin artifacts are "built" and not "known to work".

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] Should recap's releases live in this monorepo as `recap-v<version>` tags and GitHub releases on
      `gortazar/aideas` — the whole plan above assumes so, since it is the only thing an agent can do
      unaided — or does recap get its own `gortazar/recap` repo, which the Go module path already
      implies and which would make `go install`, the install URL and "latest release" all simpler? A
      separate repo needs a repo created and a cross-repo token added as a secret, neither of which
      the agent can do, and it changes every URL in the workflow, the installer and the README, so it
      is worth one line now rather than a rewrite later. Ticking this line as-is confirms the
      monorepo.
      **ANSWER: its own repo.** `https://github.com/gortazar/recap` already exists — public and
      empty, created for this. Use it; the Go module path already says `github.com/gortazar/recap`,
      and the monorepo option would have left that a lie.
      **No cross-repo token is needed, and none will be added.** That requirement only applies when
      a workflow in one repo acts on another: a workflow in `gortazar/aideas` cannot release into
      `gortazar/recap`. Put the release workflow *in `gortazar/recap`*, where the automatic
      `GITHUB_TOKEN` can tag, release and upload its own artefacts. Choosing the separate repo
      removes the token requirement rather than creating it.
      Pushing is not a problem either: you run as a user whose SSH key already has push access to
      `gortazar/recap`, so `git push` works without any secret.
      For getting the code across, follow what `pwgen` does: the source of truth becomes
      `gortazar/recap`, and `ideas/recap/` keeps it as a submodule at `ideas/recap/upstream` next to
      this idea's `PLAN.md`, `STATUS.md` and flake wrapper. Seeding it with a fresh initial commit is
      fine — the development history stays here in `aideas` and does not need replaying.
