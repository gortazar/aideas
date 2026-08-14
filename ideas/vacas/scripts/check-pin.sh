#!/usr/bin/env bash
# The upstream sources are pinned twice: as the `upstream/` git submodule (what you edit)
# and as the `vacas-src` flake input (what `nix flake check` tests). If those drift, CI
# here would happily test a commit nobody is working on, so assert they match.
#
# Run from ideas/vacas, inside `nix develop` (needs git and jq).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The gitlink recorded for upstream/ is the authoritative submodule pin: it is what a
# fresh clone checks out, whether or not this working tree has the submodule populated.
# Read it from the index, so a bump staged but not yet committed is checked too.
submodule_rev="$(git ls-files -s upstream | awk '$1 == "160000" { print $2 }')"
if [ -z "$submodule_rev" ]; then
    echo "no upstream/ submodule recorded (expected a gitlink at upstream/)" >&2
    exit 1
fi

flake_rev="$(jq -r '.nodes["vacas-src"].locked.rev' flake.lock)"
if [ -z "$flake_rev" ] || [ "$flake_rev" = "null" ]; then
    echo "flake.lock has no locked rev for the vacas-src input" >&2
    exit 1
fi

echo "submodule upstream/ -> $submodule_rev"
echo "flake input vacas-src -> $flake_rev"

if [ "$submodule_rev" != "$flake_rev" ]; then
    cat >&2 <<EOF
FAIL: the two pins disagree.

nix flake check would test $flake_rev while upstream/ is at $submodule_rev.
Point them at the same commit:

  git -C upstream fetch && git -C upstream checkout <rev> && git add upstream
  nix flake lock --override-input vacas-src github:gortazar/vacas/<rev>
EOF
    exit 1
fi

echo "PASS: both pins are at $submodule_rev"
