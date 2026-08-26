#!/usr/bin/env bash
# Is the release actually there, and does it match the tag callers pin?
#
#   scripts/check-release.sh [<version>]
#
# An agent cannot see the result of the workflow that publishes this: the release is created
# after the merge, on a push no agent watches. So this is the one command that says
# afterwards whether `status: done` was telling the truth — the same job
# ideas/aideas/tools/check-release.sh does for that idea.
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

tag="quality-gate-v${version}"
fail_count=0
fail() { printf 'FAIL: %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }

echo "checking $REPO $tag"

# 1. The moving major tag every caller pins. Without it, six repositories' sonar jobs fail
#    to resolve the workflow at all, which is a louder failure than a missing release.
v1_sha="$(git ls-remote "https://github.com/${REPO}" refs/tags/v1 | awk '{print $1}')"
if [ -z "$v1_sha" ]; then
    fail "no v1 tag on $REPO — every caller pinning @v1 will fail to resolve the workflow"
else
    echo "  v1 -> $v1_sha"
fi

# 2. The release itself.
release="$(curl -fsS "https://api.github.com/repos/${REPO}/releases/tags/${tag}" 2>/dev/null || true)"
if [ -z "$release" ]; then
    fail "no release tagged $tag on $REPO"
    echo
    echo "$fail_count problem(s)." >&2
    exit 1
fi
echo "  release: $(printf '%s' "$release" | jq -r '.name') published $(printf '%s' "$release" | jq -r '.published_at')"

# 3. Its assets. There is nothing to compile here, so the assets *are* the deliverable: the
#    workflow other repositories call, the measurement it was written to produce, the gates
#    that replaced the default and why, the ledger of everything they have been told not to
#    look at, and how to wire an idea up.
for asset in sonar.yml baseline.md gate.md exclusions.md README.md; do
    if printf '%s' "$release" | jq -e --arg a "$asset" '.assets[] | select(.name == $a)' >/dev/null; then
        echo "  asset: $asset"
    else
        fail "$tag carries no $asset"
    fi
done

# 4. The released workflow and the tag callers pin must be the same file. A release whose
#    sonar.yml differs from the one at v1 documents something nobody is running.
if [ -n "$v1_sha" ] && printf '%s' "$release" | jq -e '.assets[] | select(.name == "sonar.yml")' >/dev/null; then
    url="$(printf '%s' "$release" | jq -r '.assets[] | select(.name == "sonar.yml") | .browser_download_url')"
    released="$(mktemp)"
    at_v1="$(mktemp)"
    trap 'rm -f "$released" "$at_v1"' EXIT
    curl -fsSL "$url" -o "$released"
    curl -fsSL "https://raw.githubusercontent.com/${REPO}/v1/.github/workflows/sonar.yml" -o "$at_v1"
    if cmp -s "$released" "$at_v1"; then
        echo "  the released sonar.yml is the one at v1"
    else
        fail "the sonar.yml in $tag differs from the one at v1 — callers run a different file than the release documents"
    fi
fi

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count problem(s)." >&2
    exit 1
fi

echo "PASS: $tag is published and matches v1"
