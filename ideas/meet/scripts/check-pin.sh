#!/usr/bin/env bash
# The extension's sources are pinned twice here: as the `upstream/` git submodule (what you
# edit and push) and as the `meet-src` flake input (what `nix flake check` runs the tests
# of). If those drift apart, CI here happily tests a commit nobody is working on, so assert
# they match.
#
# Run from ideas/meet, inside `nix develop` (needs git and jq).
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

flake_rev="$(jq -r '.nodes["meet-src"].locked.rev' flake.lock)"
if [ -z "$flake_rev" ] || [ "$flake_rev" = "null" ]; then
    echo "flake.lock has no locked rev for the meet-src input" >&2
    exit 1
fi

echo "submodule upstream/  -> $submodule_rev"
echo "flake input meet-src -> $flake_rev"

if [ "$submodule_rev" != "$flake_rev" ]; then
    cat >&2 <<EOF
FAIL: the two pins disagree.

nix flake check would test $flake_rev while upstream/ is at $submodule_rev.
Point them at the same commit:

  git -C upstream fetch && git -C upstream checkout <rev> && git add upstream
  nix flake lock --override-input meet-src github:gortazar/meet/<rev>
EOF
    exit 1
fi

# A pin that only exists on a branch is a pin that stops resolving the moment the branch is
# deleted — which is exactly what a squash merge with --delete-branch does. This is the
# check that catches it before it is committed rather than after.
if [ -d upstream/.git ] || [ -f upstream/.git ]; then
    if git -C upstream rev-parse --verify --quiet origin/main >/dev/null; then
        if ! git -C upstream merge-base --is-ancestor "$submodule_rev" origin/main; then
            echo "WARNING: $submodule_rev is not on origin/main." >&2
            echo "  Fine while the pull request is open; a squash merge will orphan it." >&2
        fi
    fi
fi

# And the third thing that can drift: STATUS.md says which version this idea is at, and the
# extension's own manifest says which version its code is. Those are two files in two
# repositories, and nothing else compares them — the upstream suite pins a literal because
# it cannot see STATUS.md, which lives here.
#
# Read out of the *pinned commit* rather than the working tree. A populated submodule can be
# checked out anywhere, so reading the file on disk would let a pin at one commit pass on a
# manifest from another.
status_version="$(sed -n 's/^version:[[:space:]]*//p' STATUS.md | head -1)"
if [ -z "$status_version" ]; then
    echo "STATUS.md has no version: line" >&2
    exit 1
fi

if [ -d upstream/.git ] || [ -f upstream/.git ]; then
    manifest_version="$(git -C upstream show "${submodule_rev}:src/metadata.json" 2>/dev/null |
        jq -r '."version-name" // empty' || true)"
    if [ -z "$manifest_version" ]; then
        # Every release from 0.4 carries the key. Before it, none did, so a pin at an older
        # commit is a statement about history rather than a fault.
        echo "NOTE: the pinned commit's metadata.json has no version-name (pre-0.4)."
    elif [ "$manifest_version" != "$status_version" ]; then
        cat >&2 <<EOF
FAIL: STATUS.md and the pinned extension disagree about the version.

  STATUS.md             -> $status_version
  pinned metadata.json  -> $manifest_version

One of them is wrong. If the release is out, bump STATUS.md; if STATUS.md is right, the pin
is at the wrong commit.
EOF
        exit 1
    else
        echo "version $status_version         -> STATUS.md and the pinned metadata.json agree"
    fi
fi

echo "OK: both pins are $submodule_rev"
