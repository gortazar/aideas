#!/usr/bin/env bash
# Is the release really there, and is it the one this tree describes?
#
#   tools/check-release.sh [--version 0.2] [--repo gortazar/aideas]
#
# Asks GitHub for the newest `aideas-shell-v*` release, downloads its artefact, and checks that
# it exists, carries its checksums, matches its published digest, and is the version STATUS.md
# claims. Read-only, unauthenticated, and safe to run from anywhere.
#
# This exists because of how the release path can fail silently. An agent cannot push this repo,
# so the workflow's first real run happens after a merge no agent sees the result of; a red X on
# the Actions tab was the only signal last time, and it was missed for two days. This is the one
# command that answers "did it actually publish?" — for a person, for the next cycle, or for
# whoever is reading STATUS.md.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${AIDEAS_REPO:-gortazar/aideas}"
TAG_PREFIX="aideas-shell-v"
ZIP_SUFFIX=".shell-extension.zip"
VERSION=""

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:?}"; shift 2 ;;
        --repo) REPO="${2:?}"; shift 2 ;;
        -h | --help) sed -n '2,14p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

[ -n "$VERSION" ] || VERSION=$(sed -n 's/^version:[[:space:]]*//p' STATUS.md | head -1)
[ -n "$VERSION" ] || { echo "no version: in STATUS.md, and no --version given" >&2; exit 2; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

pass=0
fail=0
warn=0
ok() { printf '  ok    %s\n' "$*"; pass=$((pass + 1)); }
bad() { printf '  FAIL  %s\n' "$*"; fail=$((fail + 1)); }
caution() { printf '  warn  %s\n' "$*"; warn=$((warn + 1)); }

echo "checking the newest $TAG_PREFIX release of $REPO, against version $VERSION"
echo

curl -fsSL -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/releases?per_page=50" >"$WORK/releases.json" || {
    echo "could not reach the GitHub API" >&2
    exit 1
}

# The newest release under our prefix, with its assets — the API returns newest first, which is
# the same order install.sh relies on.
python3 - "$WORK/releases.json" "$TAG_PREFIX" "$ZIP_SUFFIX" >"$WORK/newest" <<'PY'
import json, sys

path, prefix, suffix = sys.argv[1:4]
releases = json.load(open(path))
ours = [r for r in releases if str(r.get("tag_name", "")).startswith(prefix)]
if not ours:
    raise SystemExit(0)

release = ours[0]
assets = {a["name"]: a for a in release.get("assets") or []}
zips = [name for name in assets if name.endswith(suffix)]

print(release["tag_name"])
print(release.get("createdAt") or release.get("created_at") or "")
print(zips[0] if zips else "")
print(assets[zips[0]].get("browser_download_url", "") if zips else "")
print(assets[zips[0]].get("digest", "") if zips else "")
print(" ".join(sorted(assets)))
PY

if [ ! -s "$WORK/newest" ]; then
    bad "no $TAG_PREFIX release exists at all"
    echo
    echo "If a release was expected, the workflow either did not run or did not publish."
    echo "Look at: https://github.com/$REPO/actions/workflows/release-aideas.yml"
    exit 1
fi

TAG=$(sed -n 1p "$WORK/newest")
CREATED=$(sed -n 2p "$WORK/newest")
ZIP_NAME=$(sed -n 3p "$WORK/newest")
ZIP_URL=$(sed -n 4p "$WORK/newest")
DIGEST=$(sed -n 5p "$WORK/newest")
ASSETS=$(sed -n 6p "$WORK/newest")

echo "newest release: $TAG${CREATED:+  (created $CREATED)}"
echo "assets: $ASSETS"
echo

# --- the tag says the version this tree says ---------------------------------------------------
#
# `aideas-shell-v0.2` and `aideas-shell-v0.2-2` are both releases of 0.2: a suffixed tag is a
# later artefact at the same version, which is the scheme install.sh's "newest first" relies on.
case "$TAG" in
    "$TAG_PREFIX$VERSION" | "$TAG_PREFIX$VERSION-"*)
        ok "the newest release is version $VERSION, as STATUS.md says" ;;
    *)
        bad "the newest release is $TAG, but STATUS.md says version $VERSION"
        echo "        (either the release for $VERSION has not published yet, or a later"
        echo "         version was released and this tree is behind)" ;;
esac

# --- the artefact ------------------------------------------------------------------------------

if [ -z "$ZIP_NAME" ]; then
    bad "the release carries no $ZIP_SUFFIX asset — there is nothing to install"
else
    ok "it carries $ZIP_NAME"

    if curl -fsSL --retry 2 -o "$WORK/asset.zip" "$ZIP_URL"; then
        ok "the artefact downloads"
        actual=$(sha256sum "$WORK/asset.zip" | cut -d' ' -f1)

        case "$DIGEST" in
            sha256:*)
                if [ "${DIGEST#sha256:}" = "$actual" ]; then
                    ok "it matches the digest GitHub reports"
                else
                    bad "it does NOT match the digest GitHub reports (${DIGEST#sha256:} vs $actual)"
                fi ;;
            *) caution "GitHub reported no digest for the asset" ;;
        esac

        # The version inside the artefact, which is what a user actually installs.
        if unzip -p "$WORK/asset.zip" metadata.json >"$WORK/metadata.json" 2>/dev/null; then
            inside=$(sed -n 's/.*"version-name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
                "$WORK/metadata.json" | head -1)
            if [ "$inside" = "$VERSION" ]; then
                ok "the artefact's metadata.json says version-name $inside"
            else
                bad "the artefact says version-name $inside, but the tag and STATUS.md say $VERSION"
            fi
        else
            bad "the artefact has no metadata.json — it is not a Shell extension"
        fi

        # --- the checksums a user would verify against ---------------------------------------
        base="${ZIP_URL%/*}"
        checksums=0

        if curl -fsSL --retry 2 -o "$WORK/asset.sha256" "$ZIP_URL.sha256" 2>/dev/null; then
            checksums=$((checksums + 1))
            if [ "$(cut -d' ' -f1 <"$WORK/asset.sha256")" = "$actual" ]; then
                ok "<asset>.sha256 is published and correct"
            else
                bad "<asset>.sha256 is published and WRONG"
            fi
        else
            caution "no <asset>.sha256 — install.sh asks for this one first"
        fi

        if curl -fsSL --retry 2 -o "$WORK/SHA256SUMS" "$base/SHA256SUMS" 2>/dev/null; then
            checksums=$((checksums + 1))
            if grep -q "$actual" "$WORK/SHA256SUMS"; then
                ok "SHA256SUMS is published and correct"
            else
                bad "SHA256SUMS is published and does not list this artefact's digest"
            fi
        else
            caution "no SHA256SUMS"
        fi

        [ "$checksums" -eq 0 ] &&
            bad "no checksum of any kind — install.sh would install this unverified"
    else
        bad "the artefact does not download from $ZIP_URL"
    fi
fi

echo
printf '%s passed, %s failed, %s warned\n' "$pass" "$fail" "$warn"
if [ "$fail" -gt 0 ]; then
    echo
    echo "The release is not what this tree describes. Actions:"
    echo "  https://github.com/$REPO/actions/workflows/release-aideas.yml"
    exit 1
fi
echo "The published release is installable and is what this tree describes."
