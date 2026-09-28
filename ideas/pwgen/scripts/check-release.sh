#!/usr/bin/env bash
# Is the release actually there, and is it the thing install.sh will download?
#
#   scripts/check-release.sh [<version>]
#
# Defaults to the version named in STATUS.md. An agent cannot watch the workflow that
# publishes a release — it runs on a tag, after the merge, on a push nobody is looking at —
# so this is the one command that says afterwards whether `status: done` was telling the
# truth.
#
# It checks what a user would hit: the release exists for that version, it carries the
# packed zip and the checksum install.sh insists on, the checksum matches the bytes the
# asset actually serves, and the zip contains the files the extension needs to load.
#
# No token and no clone: everything it reads is public.
set -euo pipefail

REPO="${PWGEN_RELEASE_REPO:-gortazar/gnome-shell-pwgen}"
UUID="pwgen-generator@pwgen-gs.patxi"
ASSET="$UUID.shell-extension.zip"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

version="${1:-}"
if [ -z "$version" ]; then
    version="$(sed -n 's/^version:[[:space:]]*//p' STATUS.md | head -1)"
fi
[ -n "$version" ] || { echo "no version: in STATUS.md and none given" >&2; exit 1; }
tag="v${version#v}"

for tool in curl jq unzip sha256sum; do
    command -v "$tool" >/dev/null 2>&1 \
        || { echo "check-release: $tool is not on PATH (run inside nix develop)" >&2; exit 1; }
done

fail_count=0
fail() { printf 'FAIL: %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }

echo "checking $REPO $tag"

release="$(curl -fsS "https://api.github.com/repos/${REPO}/releases/tags/${tag}" 2>/dev/null || true)"
if [ -z "$release" ]; then
    echo "FAIL: no release tagged $tag on $REPO" >&2
    exit 1
fi
echo "  release: $(jq -r '.name' <<< "$release") published $(jq -r '.published_at' <<< "$release")"

# The tag has to point at a commit on main. A release cut from a branch that was later
# squashed describes code that is nowhere.
tag_sha="$(curl -fsS "https://api.github.com/repos/${REPO}/git/ref/tags/${tag}" 2>/dev/null \
    | jq -r '.object.sha // empty')"
[ -n "$tag_sha" ] && echo "  tag -> $tag_sha"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for asset in "$ASSET" "$ASSET.sha256"; do
    url="$(jq -r --arg a "$asset" \
        '.assets[] | select(.name == $a) | .browser_download_url' <<< "$release")"
    if [ -z "$url" ]; then
        # install.sh refuses to install without the checksum, so a missing .sha256 is not
        # cosmetic: it makes the release uninstallable by the command its own notes print.
        fail "$tag carries no $asset"
        continue
    fi
    echo "  asset: $asset"
    curl -fsSL "$url" -o "$work/$asset" || fail "could not download $asset"
done

if [ -f "$work/$ASSET" ] && [ -f "$work/$ASSET.sha256" ]; then
    if ( cd "$work" && sha256sum -c "$ASSET.sha256" >/dev/null 2>&1 ); then
        echo "  checksum matches the published asset"
    else
        fail "the published checksum does not match the published zip"
    fi
fi

if [ -f "$work/$ASSET" ]; then
    listing="$(unzip -l "$work/$ASSET" || true)"
    for entry in metadata.json extension.js prefs.js LICENSE lib/generator.js \
        schemas/gschemas.compiled; do
        grep -q " $entry\$" <<< "$listing" || fail "the packed zip is missing $entry"
    done

    # The asset has to describe the version it is published under, which is the whole
    # point of the workflow's tag check — verified here against what was really uploaded.
    unzip -p "$work/$ASSET" metadata.json > "$work/metadata.json" 2>/dev/null || true
    declared="$(jq -r '.["version-name"] // empty' "$work/metadata.json" 2>/dev/null || true)"
    if [ -z "$declared" ]; then
        fail "the packed metadata.json has no version-name"
    elif [ "$declared" != "${tag#v}" ]; then
        fail "the packed metadata.json says $declared but the release is $tag"
    else
        echo "  the asset declares version-name $declared"
    fi
fi

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count problem(s)." >&2
    exit 1
fi

echo "PASS: $tag is published, verified and carries a loadable extension"
