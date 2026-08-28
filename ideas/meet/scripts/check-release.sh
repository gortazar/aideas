#!/usr/bin/env bash
# Is the release actually there, and can someone install it?
#
#   scripts/check-release.sh [<version>]
#
# An agent cannot see the result of the workflow that publishes this: the release is created
# after the merge, on a tag push that nothing watches. So this is the one command that says
# afterwards whether `status: done` was telling the truth.
#
# No token and no clone: everything it reads is public.
set -euo pipefail

REPO="${MEET_RELEASE_REPO:-gortazar/meet}"
UUID="meet@meet-gs.patxi"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

version="${1:-}"
if [ -z "$version" ]; then
    version="$(sed -n 's/^version:[[:space:]]*//p' STATUS.md | head -1)"
fi
[ -n "$version" ] || { echo "no version: in STATUS.md and none given" >&2; exit 1; }

tag="v${version}"
asset="${UUID}.shell-extension.zip"
fail_count=0
fail() { printf 'FAIL: %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }

echo "checking $REPO $tag"

# 1. The tag. Without it the release workflow never ran at all.
tag_sha="$(git ls-remote "https://github.com/${REPO}" "refs/tags/${tag}" | awk '{print $1}')"
if [ -z "$tag_sha" ]; then
    fail "no ${tag} tag on ${REPO} — the release workflow was never triggered"
else
    echo "  ${tag} -> ${tag_sha}"
fi

# 2. The release itself.
release="$(curl -fsS "https://api.github.com/repos/${REPO}/releases/tags/${tag}" 2>/dev/null || true)"
if [ -z "$release" ]; then
    fail "no release tagged ${tag} on ${REPO}"
    echo
    echo "${fail_count} problem(s)." >&2
    exit 1
fi
echo "  release: $(printf '%s' "$release" | jq -r '.name') published $(printf '%s' "$release" | jq -r '.published_at')"

# 3. Its assets. There is nothing for a user to compile here, so the asset *is* the
#    deliverable: the packed extension, and the checksum install.sh verifies it against.
for want in "$asset" "$asset.sha256"; do
    if printf '%s' "$release" | jq -e --arg n "$want" '.assets[] | select(.name == $n)' >/dev/null; then
        size="$(printf '%s' "$release" | jq -r --arg n "$want" '.assets[] | select(.name == $n) | .size')"
        echo "  asset: ${want} (${size} bytes)"
    else
        fail "the release has no ${want}"
    fi
done

# 4. The asset is what it claims to be. A zip that downloads but does not contain
#    metadata.json is an extension the shell will refuse, and nothing before this point
#    would have noticed.
if command -v unzip >/dev/null 2>&1; then
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    if curl -fsSL "https://github.com/${REPO}/releases/download/${tag}/${asset}" \
        -o "${tmp}/${asset}" 2>/dev/null; then
        listing="$(unzip -l "${tmp}/${asset}" 2>/dev/null || true)"
        for entry in metadata.json extension.js prefs.js LICENSE \
            lib/destinations.js lib/launcher.js lib/menu.js lib/settings.js \
            icons/openvidu-meet-symbolic.svg schemas/gschemas.compiled; do
            grep -q " ${entry}\$" <<< "$listing" || fail "the published zip is missing ${entry}"
        done
        # The uuid the installer unpacks into has to be the one inside the package, or the
        # shell looks in a directory that does not match what it finds there.
        unzip -p "${tmp}/${asset}" metadata.json 2>/dev/null |
            jq -e --arg u "$UUID" '.uuid == $u' >/dev/null ||
            fail "the published zip declares a uuid other than ${UUID}"
        echo "  the zip contains what the shell needs"
    else
        fail "the published asset could not be downloaded"
    fi
else
    echo "  (unzip not on PATH — the asset's contents were not inspected)"
fi

# 5. The installer someone will actually pipe into a shell.
if curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/install.sh" -o /dev/null 2>/dev/null; then
    echo "  install.sh is reachable on main"
else
    fail "install.sh is not reachable at the URL the README tells people to curl"
fi

echo
if [ "$fail_count" -gt 0 ]; then
    echo "${fail_count} problem(s)." >&2
    exit 1
fi
echo "release ${tag} is published and installable"
