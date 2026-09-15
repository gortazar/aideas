#!/usr/bin/env bash
# The upstream sources are pinned twice: as the `upstream/` git submodule (what you
# edit) and as the `pwgen-src` flake input (what `nix flake check` tests). If those
# drift, CI here would happily test a commit nobody is working on, so assert they
# match.
#
# STATUS.md names the pinned commit too, on an "**Upstream pin:**" line. It once named
# a commit from memory that neither pin was at, so that line is checked as well: a
# report that misstates the pin is the drift this script exists to catch.
#
# Run from ideas/pwgen, inside `nix develop` (needs git and jq).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The gitlink recorded for upstream/ is the authoritative submodule pin: it is what
# a fresh clone checks out, whether or not this working tree has the submodule
# populated. Read it from the index rather than the checkout, so a bump that has
# been staged but not yet committed is checked too.
submodule_rev="$(git ls-files -s upstream | awk '$1 == "160000" { print $2 }')"
if [ -z "$submodule_rev" ]; then
    echo "no upstream/ submodule recorded (expected a gitlink at upstream/)" >&2
    exit 1
fi

flake_rev="$(jq -r '.nodes["pwgen-src"].locked.rev' flake.lock)"
if [ -z "$flake_rev" ] || [ "$flake_rev" = "null" ]; then
    echo "flake.lock has no locked rev for the pwgen-src input" >&2
    exit 1
fi

status_rev="$(sed -n 's/^\*\*Upstream pin:\*\*[[:space:]]*`\([0-9a-f]\{40\}\)`.*/\1/p' STATUS.md | head -1)"
if [ -z "$status_rev" ]; then
    echo "STATUS.md has no '**Upstream pin:** \`<40-hex sha>\`' line" >&2
    exit 1
fi

echo "submodule upstream/ -> $submodule_rev"
echo "flake input pwgen-src -> $flake_rev"
echo "STATUS.md says -> $status_rev"

if [ "$submodule_rev" != "$status_rev" ]; then
    cat >&2 <<EOF
FAIL: STATUS.md names $status_rev but upstream/ is pinned at $submodule_rev.

The gitlink is the authority. Correct the "**Upstream pin:**" line in STATUS.md
(or, if the pin itself was moved by mistake, restore it) so the report and the
tree say the same thing.
EOF
    exit 1
fi

if [ "$submodule_rev" != "$flake_rev" ]; then
    cat >&2 <<EOF
FAIL: the two pins disagree.

nix flake check would test $flake_rev while upstream/ is at $submodule_rev.
Point them at the same commit:

  git -C upstream fetch && git -C upstream checkout <rev> && git add upstream
  nix flake lock --override-input pwgen-src github:gortazar/gnome-shell-pwgen/<rev>
EOF
    exit 1
fi

echo "PASS: gitlink, flake.lock and STATUS.md all name $submodule_rev"
