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

REPO="${TITLE_SLIDES_RELEASE_REPO:-gortazar/title-slides}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

version="${1:-}"
if [ -z "$version" ]; then
    version="$(sed -n 's/^version:[[:space:]]*//p' STATUS.md | head -1)"
fi
[ -n "$version" ] || { echo "no version: in STATUS.md and none given" >&2; exit 1; }

tag="v${version}"
asset="title-slides-${version}.zip"
fail_count=0
fail() { printf 'FAIL: %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }

echo "checking $REPO $tag"

# 1. The tag. Without it the release workflow never ran at all — the orchestrator's push
#    carries no tag, so the workflow has to have created its own.
tag_sha="$(git ls-remote "https://github.com/${REPO}" "refs/tags/${tag}" | awk '{print $1}' | head -1)"
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

# 3. Its asset. There is nothing to compile here, so the zip *is* the deliverable: the
#    extension staged exactly as `quarto add` installs it.
if printf '%s' "$release" | jq -e --arg n "$asset" '.assets[] | select(.name == $n)' >/dev/null; then
    size="$(printf '%s' "$release" | jq -r --arg n "$asset" '.assets[] | select(.name == $n) | .size')"
    echo "  asset: ${asset} (${size} bytes)"
else
    fail "the release has no ${asset}"
fi

# 4. The asset is what it claims to be. A zip that downloads but unpacks to the wrong
#    directory name is an extension Quarto cannot resolve `filters: [title-slides]`
#    against — which is exactly how this idea's 0.3 bug report started.
if command -v unzip >/dev/null 2>&1; then
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    if curl -fsSL "https://github.com/${REPO}/releases/download/${tag}/${asset}" \
        -o "${tmp}/${asset}" 2>/dev/null; then
        listing="$(unzip -Z1 "${tmp}/${asset}" 2>/dev/null || true)"
        for entry in _extensions/title-slides/_extension.yml \
            _extensions/title-slides/title-slides.lua \
            _extensions/title-slides/setext.lua; do
            grep -qx "${entry}" <<< "$listing" || fail "the published zip is missing ${entry}"
        done
        # The version a user sees in `quarto list extensions` has to be the one whose
        # documentation they are reading. Quarto wants three components in _extension.yml
        # where this idea's version and its tag have two, so `0.6` ships as `0.6.0`.
        declared="$(unzip -p "${tmp}/${asset}" _extensions/title-slides/_extension.yml 2>/dev/null |
            sed -n 's/^version:[[:space:]]*//p' | head -1)"
        if [ "$declared" != "$version" ] && [ "$declared" != "${version}.0" ]; then
            fail "the published zip declares version ${declared:-none}, not ${version}"
        fi
        echo "  the zip unpacks to _extensions/title-slides/ and declares ${declared}"
    else
        fail "the published asset could not be downloaded"
    fi
else
    echo "  (unzip not on PATH — the asset's contents were not inspected)"
fi

# 5. The command the README tells people to run. `quarto add <owner>/<repo>@<tag>` resolves
#    against the tag rather than the release asset, so it is a separate thing to be sure of.
if curl -fsSL -o /dev/null "https://codeload.github.com/${REPO}/tar.gz/refs/tags/${tag}" 2>/dev/null; then
    echo "  quarto add ${REPO}@${tag} has a tarball to fetch"
else
    fail "no source tarball for ${tag} — quarto add ${REPO}@${tag} would fail"
fi

echo
if [ "$fail_count" -gt 0 ]; then
    echo "${fail_count} problem(s)." >&2
    exit 1
fi
echo "release ${tag} is published and installable"
