#!/usr/bin/env bash
# The extension's sources are pinned twice here: as the `upstream/` git submodule (what you
# edit and push) and as the `recap-gs-src` flake input (what `nix flake check` runs the
# tests of). If those drift apart, CI here happily tests a commit nobody is working on, so
# assert they match.
#
# Run from ideas/recap-gs, inside `nix develop` (needs git and jq).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The gitlink recorded for upstream/ is the authoritative submodule pin: it is what a fresh
# clone checks out, whether or not this working tree has the submodule populated. Read it
# from the index rather than the checkout, so a bump that has been staged but not committed
# is checked too.
submodule_rev="$(git ls-files -s upstream | awk '$1 == "160000" { print $2 }')"
if [ -z "$submodule_rev" ]; then
    echo "no upstream/ submodule recorded (expected a gitlink at upstream/)" >&2
    exit 1
fi

flake_rev="$(jq -r '.nodes["recap-gs-src"].locked.rev' flake.lock)"
if [ -z "$flake_rev" ] || [ "$flake_rev" = "null" ]; then
    echo "flake.lock has no locked rev for the recap-gs-src input" >&2
    exit 1
fi

echo "submodule upstream/    -> $submodule_rev"
echo "flake input recap-gs-src -> $flake_rev"

if [ "$submodule_rev" != "$flake_rev" ]; then
    cat >&2 <<EOF
FAIL: the two pins disagree.

nix flake check would test $flake_rev while upstream/ is at $submodule_rev.
Point them at the same commit:

  git -C upstream fetch && git -C upstream checkout <rev> && git add upstream
  nix flake lock --override-input recap-gs-src github:gortazar/recap-gs/<rev>
EOF
    exit 1
fi

echo "OK: both pins are $submodule_rev"

# The third thing that can drift, and the one this wrapper could not see until 0.5: the
# version. STATUS.md is what anyone reads to learn which release this idea is at, and
# src/metadata.json is what the released code actually says about itself. A STATUS.md
# claiming a version the pinned code does not carry is exactly the gap 0.5 exists to close,
# so assert it here rather than trusting that two files were edited together.
#
# Read from the *index*, like the gitlink above, so a pin staged but not committed is
# checked too — and from the submodule's own content, which is only there once it is
# populated. An unpopulated submodule is not a failure of this check; it is a different one,
# already reported by the gitlink read above.
status_version="$(sed -n 's/^version:[[:space:]]*//p' STATUS.md | head -1)"
if [ -z "$status_version" ]; then
    echo "STATUS.md has no version: line" >&2
    exit 1
fi

if [ ! -f upstream/src/metadata.json ]; then
    echo "NOTE: upstream/ is not populated, so the version could not be checked" >&2
    echo "      run: git submodule update --init upstream" >&2
    exit 0
fi

pinned_version="$(jq -r '."version-name" // empty' upstream/src/metadata.json)"
if [ -z "$pinned_version" ]; then
    cat >&2 <<EOF
FAIL: the pinned upstream/src/metadata.json has no version-name.

Nothing in the released artefact would say which version it is. The packer refuses to
build a zip without it, so a pin this old predates that check — bump it.
EOF
    exit 1
fi

echo "STATUS.md version     -> $status_version"
echo "pinned metadata.json  -> $pinned_version"

if [ "$status_version" != "$pinned_version" ]; then
    cat >&2 <<EOF
FAIL: the versions disagree.

STATUS.md says this idea is at $status_version, but the pinned code says it is
$pinned_version. One of them is wrong, and the released artefact believes the second.

Either bump STATUS.md's version:, or move the pin to the commit that carries the
version STATUS.md claims.
EOF
    exit 1
fi

echo "OK: STATUS.md and the pinned metadata.json both say $status_version"
