#!/usr/bin/env bash
# Is the release artefact a function of the source alone?
#
#   ci/pack-test.sh
#
# Packs twice, from a clean build each time, and asserts one SHA-256. Then — when nix is
# available and the source is committed — asserts that `nix build` produces the same bytes.
#
# This matters beyond tidiness. The release workflow decides whether to publish by comparing
# the artefact it just built against the asset of the newest release: if the zip carried build
# timestamps, every run would look like a change and publish a byte-different copy of the same
# extension forever. "Reproducible" is what makes "unchanged" a fact about content.
set -euo pipefail

cd "$(dirname "$0")/.."

UUID="aideas-shell@patxi.gortazar"
ZIP="build/$UUID.shell-extension.zip"

pass=0
fail=0
check() {
    if eval "$2"; then
        echo "  ok   $1"
        pass=$((pass + 1))
    else
        echo "  FAIL $1"
        [ -n "${3:-}" ] && echo "       $3"
        fail=$((fail + 1))
    fi
}

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

echo "== packing twice, from a clean build each time"
make clean >/dev/null
make pack >/dev/null
first=$(sha_of "$ZIP")
echo "   $first"

# A different second, a different mtime on every copied file: exactly what a naive zip records.
sleep 1.1
make clean >/dev/null
make pack >/dev/null
second=$(sha_of "$ZIP")
echo "   $second"

check "two packs, one checksum" "[[ '$first' == '$second' ]]" \
    "the artefact is not a function of the source alone"

echo
echo "== the zip records no build time"
# 1980-01-01 is the zip epoch, and what SOURCE_DATE_EPOCH defaults to here and in nixpkgs.
dates=$(unzip -l "$ZIP" | awk 'NR>3 && NF>=4 {print $2}' | sort -u | grep -v '^$' || true)
check "every entry carries the same fixed date" \
    "[[ \$(printf '%s\n' \"\$dates\" | wc -l) -eq 1 ]]" \
    "dates found: $(printf '%s ' $dates)"
check "and that date is the reproducible-builds epoch" \
    "[[ '$(printf '%s' "$dates")' == '1980-01-01' ]]" \
    "got: $dates"

echo
echo "== entry order is fixed, not readdir order"
order=$(unzip -Z1 "$ZIP")
sorted=$(printf '%s\n' "$order" | LC_ALL=C sort)
check "names are stored in sorted order" "[[ '$order' == '$sorted' ]]"

echo
echo "== SOURCE_DATE_EPOCH is honoured"
make clean >/dev/null
SOURCE_DATE_EPOCH=1000000000 make pack >/dev/null
epoch_sha=$(sha_of "$ZIP")
check "a different epoch gives a different artefact" "[[ '$epoch_sha' != '$first' ]]" \
    "the setting is being ignored"
other_date=$(unzip -l "$ZIP" | awk 'NR>3 && NF>=4 {print $2}' | sort -u | grep -v '^$' | head -1)
check "and that epoch is what is stored" "[[ '$other_date' == '2001-09-09' ]]" \
    "got: $other_date"

# Back to the default for the comparison below.
make clean >/dev/null
make pack >/dev/null

echo
echo "== nix build agrees"
if ! command -v nix >/dev/null 2>&1; then
    echo "  skip nix is not on PATH"
elif [[ -n "$(git status --porcelain -- src Makefile flake.nix tools 2>/dev/null)" ]]; then
    # A flake only ever sees git-tracked content, so an uncommitted change would make the two
    # differ for a reason that has nothing to do with reproducibility.
    echo "  skip src/, Makefile, flake.nix or tools/ has uncommitted changes"
else
    nix ${NIX_FLAGS:---extra-experimental-features 'nix-command flakes'} \
        build --no-link --print-out-paths .#packages."$(nix ${NIX_FLAGS:---extra-experimental-features 'nix-command flakes'} eval --raw --impure --expr 'builtins.currentSystem')".default \
        >"$PWD/build/nix-out-path" 2>/dev/null || {
        echo "  FAIL nix build failed"
        fail=$((fail + 1))
    }
    if [[ -s build/nix-out-path ]]; then
        nix_zip="$(cat build/nix-out-path)/$UUID.shell-extension.zip"
        check "nix build produces the same bytes as make pack" \
            "[[ '$(sha_of "$nix_zip")' == '$(sha_of "$ZIP")' ]]" \
            "nix: $(sha_of "$nix_zip")  make: $(sha_of "$ZIP")"
    fi
fi

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
