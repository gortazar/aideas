#!/usr/bin/env bash
# Is the orchestrator release actually there, and does it carry what it claims?
#
#   ideas/orchestrator/scripts/check-release.sh [<version>]
#
# An agent cannot see the result of the workflow that publishes this: the release is created
# after a merge, on a push no agent watches. So this is the one command that says afterwards
# whether `status: done` was telling the truth — the same job
# ideas/quality-gate/scripts/check-release.sh does for that idea.
#
# No token and no clone: everything it reads is public.
set -euo pipefail

REPO="${IDEA_RELEASE_REPO:-gortazar/aideas}"
version="${1:-}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "$version" ]; then
    version="$(sed -n 's/^version:[[:space:]]*//p' STATUS.md | head -1)"
fi
[ -n "$version" ] || { echo "no version: in STATUS.md and none given" >&2; exit 1; }

tag="orchestrator-v${version}"
tarball="orchestrator-${version}.tar.gz"
fail_count=0
fail() { printf 'FAIL: %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }

echo "checking $REPO $tag"

# 1. The release itself.
release="$(curl -fsS "https://api.github.com/repos/${REPO}/releases/tags/${tag}" 2>/dev/null || true)"
if [ -z "$release" ]; then
    echo "FAIL: no release tagged $tag on $REPO" >&2
    echo >&2
    echo "If ideas/orchestrator/STATUS.md says 'done' at $version, the publishing workflow" >&2
    echo "either never fired or never saw that status. Recover with:" >&2
    echo "  gh workflow run release-orchestrator.yml --repo $REPO -f force=true" >&2
    exit 1
fi
echo "  release: $(printf '%s' "$release" | jq -r '.name') published $(printf '%s' "$release" | jq -r '.published_at')"

# 2. Its assets: the code, its checksum, and the installer fetched on its own.
for asset in "$tarball" SHA256SUMS install.sh; do
    if printf '%s' "$release" | jq -e --arg a "$asset" '.assets[] | select(.name == $a)' >/dev/null; then
        echo "  asset: $asset"
    else
        fail "$tag carries no $asset"
    fi
done

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count problem(s)." >&2
    exit 1
fi

asset_url() {
    printf '%s' "$release" | jq -r --arg a "$1" '.assets[] | select(.name == $a) | .browser_download_url'
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL "$(asset_url "$tarball")" -o "$work/$tarball"
curl -fsSL "$(asset_url SHA256SUMS)" -o "$work/SHA256SUMS"

# 3. The checksum matches the bytes actually served. A SHA256SUMS nobody checks is decoration.
published_sum="$(awk '{print $1}' "$work/SHA256SUMS" | head -1)"
actual_sum="$(sha256sum "$work/$tarball" | awk '{print $1}')"
if [ "$published_sum" = "$actual_sum" ]; then
    echo "  sha256 matches: $actual_sum"
else
    fail "SHA256SUMS says $published_sum but the downloaded $tarball is $actual_sum"
fi

# 4. The tarball contains the orchestrator, and it declares this very version. A release
#    tagged v1.6 carrying code that calls itself 1.5 is the failure this exists to catch.
tar -xzf "$work/$tarball" -C "$work"
if [ ! -f "$work/orchestrator/orchestrator.py" ]; then
    fail "$tarball does not contain orchestrator/orchestrator.py"
else
    packed_version="$(sed -n 's/^ORCHESTRATOR_VERSION = "\(.*\)"$/\1/p' "$work/orchestrator/orchestrator.py" | head -1)"
    if [ "$packed_version" = "$version" ]; then
        echo "  the packed orchestrator.py declares $packed_version"
    else
        fail "$tag is tagged $version but its orchestrator.py declares '$packed_version'"
    fi
fi

# 5. The installer is in there too, and is the one published beside it — that is the file the
#    release notes tell people to run.
if [ ! -f "$work/orchestrator/install.sh" ]; then
    fail "$tarball does not contain orchestrator/install.sh"
else
    curl -fsSL "$(asset_url install.sh)" -o "$work/install-asset.sh"
    if cmp -s "$work/install-asset.sh" "$work/orchestrator/install.sh"; then
        echo "  the install.sh asset is the one inside the tarball"
    else
        fail "the install.sh asset differs from the one inside $tarball"
    fi
    if bash -n "$work/orchestrator/install.sh"; then
        echo "  the packed install.sh parses"
    else
        fail "the packed install.sh is not valid bash"
    fi
fi

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count problem(s)." >&2
    exit 1
fi

echo "PASS: $tag is published, verified and installable"
