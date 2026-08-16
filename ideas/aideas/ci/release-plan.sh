#!/usr/bin/env bash
# Decide whether to publish a release, and under which tag.
#
#   ci/release-plan.sh --version 0.2 --status done \
#                      --releases releases.json --artefact build/…zip \
#                      [--metadata-version 0.2] [--fetch ./fetcher]
#
# Prints `key=value` lines on stdout — `publish`, `tag`, `reason` — for a workflow to append to
# $GITHUB_OUTPUT, and its reasoning on stderr. Exits non-zero only when something is wrong
# enough that the run should fail; "do not publish" is a normal answer with exit 0.
#
# This is the part of the release the v0.1 workflow got wrong and could not test, so it is a
# script with a test rather than a few lines of YAML: ci/release-test.sh drives it against
# stubbed releases lists, and needs no network and no GitHub.
#
# The rules, each settled by an answered question in PLAN.md:
#
#   * publish only when the idea says `status: done` — releases mark finished entries
#   * never publish bytes that are already published: compare the built artefact against the
#     newest existing release's asset, and say so when they match
#   * one immutable tag per published artefact: `aideas-shell-v<version>` the first time, then
#     `aideas-shell-v<version>-2`, `-3`, … so "newest first" stays true for the installer
set -euo pipefail

TAG_PREFIX="aideas-shell-v"
ASSET_SUFFIX=".shell-extension.zip"

VERSION=""
STATUS=""
RELEASES=""
ARTEFACT=""
METADATA_VERSION=""
FETCH=""

die() { printf 'release-plan: %s\n' "$*" >&2; exit 2; }
note() { printf '  %s\n' "$*" >&2; }

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:?}"; shift 2 ;;
        --status) STATUS="${2:?}"; shift 2 ;;
        --releases) RELEASES="${2:?}"; shift 2 ;;
        --artefact) ARTEFACT="${2:?}"; shift 2 ;;
        --metadata-version) METADATA_VERSION="${2:?}"; shift 2 ;;
        --fetch) FETCH="${2:?}"; shift 2 ;;
        -h | --help) sed -n '2,25p' "$0"; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[ -n "$VERSION" ] || die "--version is required"
[ -n "$RELEASES" ] || die "--releases is required"
[ -f "$RELEASES" ] || die "no such releases file: $RELEASES"
[ -n "$ARTEFACT" ] || die "--artefact is required"
[ -f "$ARTEFACT" ] || die "no such artefact: $ARTEFACT"

case "$VERSION" in
    [0-9]*.[0-9]*) ;;
    *) die "version '$VERSION' is not major.minor" ;;
esac

# A version that disagrees with what the artefact says it is would publish a zip under a tag
# that contradicts its own metadata.json. Fail the run rather than release that.
if [ -n "$METADATA_VERSION" ] && [ "$METADATA_VERSION" != "$VERSION" ]; then
    die "STATUS.md says version $VERSION but metadata.json says $METADATA_VERSION.
Bump both, or neither — a release whose tag and manifest disagree cannot be diagnosed later."
fi

decide() {
    printf '%s\n' "$1"
}

# --- is this a finished entry? ----------------------------------------------------------------

if [ "$STATUS" != "done" ]; then
    note "the idea is '$STATUS', not 'done' — releases are published when an entry is finished"
    decide "publish=no"
    decide "tag="
    decide "reason=status is '$STATUS', not 'done'"
    exit 0
fi

# --- what is already published? ---------------------------------------------------------------
#
# The releases list is used as given, newest first, which is the order the API returns and the
# order install.sh relies on. Only this idea's tags count: a repository that releases several
# things will have others in the list.

query() {
    python3 -c '
import json, re, sys

path, prefix, suffix, want = sys.argv[1:5]
with open(path) as handle:
    try:
        releases = json.load(handle)
    except json.JSONDecodeError as exc:
        print(f"UNPARSEABLE {exc}", file=sys.stderr)
        raise SystemExit(3)

if not isinstance(releases, list):
    print("UNPARSEABLE not a list", file=sys.stderr)
    raise SystemExit(3)

ours = [r for r in releases
        if isinstance(r, dict) and str(r.get("tag_name", "")).startswith(prefix)]

def asset_of(release):
    for asset in release.get("assets") or []:
        if str(asset.get("name", "")).endswith(suffix):
            return asset
    return None

if want == "tags":
    print("\n".join(r["tag_name"] for r in ours))
elif want == "newest-digest":
    # Newest first, as the API returns them. The digest is compared to the built artefact; an
    # asset without one falls back to a download.
    for release in ours:
        asset = asset_of(release)
        if asset is None:
            continue
        tag = str(release.get("tag_name", ""))
        digest = str(asset.get("digest") or "")
        url = str(asset.get("browser_download_url") or "")
        print("\t".join([tag, digest, url]))
        break
' "$1" "$TAG_PREFIX" "$ASSET_SUFFIX" "$2"
}

if ! EXISTING_TAGS=$(query "$RELEASES" tags); then
    die "could not read $RELEASES as a releases list"
fi

NEWEST=$(query "$RELEASES" newest-digest)
NEWEST_TAG=$(printf '%s' "$NEWEST" | cut -f1)
NEWEST_DIGEST=$(printf '%s' "$NEWEST" | cut -f2)
NEWEST_URL=$(printf '%s' "$NEWEST" | cut -f3)

ARTEFACT_SHA=$(sha256sum "$ARTEFACT" | cut -d' ' -f1)
note "built artefact: sha256:$ARTEFACT_SHA"

if [ -z "$NEWEST_TAG" ]; then
    note "no $TAG_PREFIX release with a $ASSET_SUFFIX asset has ever been published"
else
    note "newest published: $NEWEST_TAG"
fi

# --- are these bytes already published? --------------------------------------------------------

published_sha=""
if [ -n "$NEWEST_TAG" ]; then
    case "$NEWEST_DIGEST" in
        sha256:*) published_sha="${NEWEST_DIGEST#sha256:}" ;;
        *)
            # No digest in the API's reply: fetch the asset and hash it. --fetch keeps this
            # testable — the test passes a stub that copies a local file.
            if [ -n "$NEWEST_URL" ]; then
                downloaded=$(mktemp)
                # shellcheck disable=SC2064
                trap "rm -f '$downloaded'" EXIT
                fetcher=${FETCH:-}
                if [ -z "$fetcher" ]; then
                    if curl -fsSL --retry 2 -o "$downloaded" "$NEWEST_URL"; then
                        published_sha=$(sha256sum "$downloaded" | cut -d' ' -f1)
                    else
                        note "could not download $NEWEST_URL — treating it as unknown"
                    fi
                elif "$fetcher" "$NEWEST_URL" "$downloaded"; then
                    published_sha=$(sha256sum "$downloaded" | cut -d' ' -f1)
                else
                    note "the fetcher failed for $NEWEST_URL — treating it as unknown"
                fi
            fi
            ;;
    esac
fi

if [ -n "$published_sha" ]; then
    note "published artefact: sha256:$published_sha"
    if [ "$published_sha" = "$ARTEFACT_SHA" ]; then
        note "identical — there is nothing new to publish"
        decide "publish=no"
        decide "tag="
        decide "reason=the artefact is byte-identical to $NEWEST_TAG"
        exit 0
    fi
    note "different — this is a new artefact"
elif [ -n "$NEWEST_TAG" ]; then
    # Publishing an extra release is recoverable; skipping one silently is not.
    note "could not establish what $NEWEST_TAG contains — assuming this artefact is new"
fi

# --- which tag? ---------------------------------------------------------------------------------

base="$TAG_PREFIX$VERSION"
tag="$base"
suffix=2
while printf '%s\n' "$EXISTING_TAGS" | grep -qx "$tag"; do
    tag="$base-$suffix"
    suffix=$((suffix + 1))
    [ "$suffix" -gt 100 ] && die "more than 100 releases at version $VERSION — refusing to guess"
done

if [ "$tag" = "$base" ]; then
    note "publishing the first release of $VERSION as $tag"
    decide "publish=yes"
    decide "tag=$tag"
    decide "reason=first release of $VERSION"
else
    note "$base is taken by an earlier artefact; publishing as $tag"
    decide "publish=yes"
    decide "tag=$tag"
    decide "reason=a further artefact at version $VERSION"
fi
