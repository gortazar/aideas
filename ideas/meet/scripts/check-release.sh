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

# Everything below is public, so curl is the first choice and needs no credentials.
#
# It falls back to `gh` because an unauthenticated api.github.com allows 60 requests an hour
# per address, and this script spends several of them per run. Over that limit the API
# answers 403, `curl -f` turns that into a non-zero exit, and the script would report "no
# release tagged v0.2" — which is not what went wrong and sends you looking at the release
# workflow instead of at a rate limit. A just-published release can 404 for a moment too.
# `gh` is authenticated and has its own, far larger, allowance, so a disagreement between
# the two paths is itself informative. Neither path is given a token *by this script*.
fetch_json() { # <api-path>
    curl -fsS "https://api.github.com/$1" 2>/dev/null && return 0
    command -v gh >/dev/null 2>&1 || return 1
    gh api "$1" 2>/dev/null
}

fetch_file() { # <url> <api-path-or-empty> <output> [accept]
    curl -fsSL "$1" -o "$3" 2>/dev/null && return 0
    [ -n "$2" ] || return 1
    command -v gh >/dev/null 2>&1 || return 1
    # Both of these endpoints answer with JSON metadata unless asked for the bytes, and
    # they do not agree on how to ask: a release asset wants octet-stream, a file in the
    # repository wants the raw media type.
    gh api -H "Accept: ${4:-application/octet-stream}" "$2" > "$3" 2>/dev/null
}

echo "checking $REPO $tag"

# 1. The tag. Without it the release workflow never ran at all.
tag_sha="$(git ls-remote "https://github.com/${REPO}" "refs/tags/${tag}" | awk '{print $1}')"
if [ -z "$tag_sha" ]; then
    fail "no ${tag} tag on ${REPO} — the release workflow was never triggered"
else
    echo "  ${tag} -> ${tag_sha}"
fi

# 2. The release itself.
release="$(fetch_json "repos/${REPO}/releases/tags/${tag}" || true)"
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
    asset_id="$(printf '%s' "$release" | jq -r --arg n "$asset" \
        '.assets[] | select(.name == $n) | .id')"
    if fetch_file "https://github.com/${REPO}/releases/download/${tag}/${asset}" \
        "repos/${REPO}/releases/assets/${asset_id}" "${tmp}/${asset}"; then
        listing="$(unzip -l "${tmp}/${asset}" 2>/dev/null || true)"
        for entry in metadata.json extension.js prefs.js LICENSE \
            lib/destinations.js lib/launcher.js lib/menu.js lib/settings.js \
            lib/rooms.js lib/client.js lib/keyring.js lib/secret-store.js \
            icons/openvidu-meet-symbolic.svg schemas/gschemas.compiled; do
            grep -q " ${entry}\$" <<< "$listing" || fail "the published zip is missing ${entry}"
        done
        # The uuid the installer unpacks into has to be the one inside the package, or the
        # shell looks in a directory that does not match what it finds there.
        unzip -p "${tmp}/${asset}" metadata.json > "${tmp}/metadata.json" 2>/dev/null || true
        jq -e --arg u "$UUID" '.uuid == $u' < "${tmp}/metadata.json" >/dev/null 2>&1 ||
            fail "the published zip declares a uuid other than ${UUID}"

        # And the version inside the artefact, which is the one a user actually installs. A
        # tag can say anything and a release title is just text; this asks the bytes. An
        # artefact published before 0.4 has no version-name at all, and failing against
        # those is correct — shipping one is exactly what this check exists to stop.
        inside="$(jq -r '."version-name" // empty' < "${tmp}/metadata.json" 2>/dev/null || true)"
        if [ -z "$inside" ]; then
            fail "the published zip has no version-name, so it cannot say which release it is"
        elif [ "$inside" != "$version" ]; then
            fail "the published zip says version-name ${inside}, but this is ${tag}"
        else
            echo "  the zip says version-name ${inside}"
        fi
        echo "  the zip contains what the shell needs"
    else
        fail "the published asset could not be downloaded"
    fi
else
    echo "  (unzip not on PATH — the asset's contents were not inspected)"
fi

# 5. The installer someone will actually pipe into a shell.
if fetch_file "https://raw.githubusercontent.com/${REPO}/main/install.sh" \
    "repos/${REPO}/contents/install.sh?ref=main" /dev/null \
    "application/vnd.github.raw"; then
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
