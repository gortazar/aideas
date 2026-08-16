#!/usr/bin/env bash
# ci/release-plan.sh, driven against stubbed releases lists.
#
#   ci/release-test.sh
#
# No network, no GitHub, no artefact build: fixture JSON in, a decision out. This is the part
# of the release the v0.1 workflow got wrong and had no way to test, and it is what makes the
# fix checkable from a worktree — before the merge that is the only place it runs for real.
set -euo pipefail

cd "$(dirname "$0")/.."

PLAN="ci/release-plan.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

pass=0
fail=0

check() {
    local description="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        echo "  ok   $description"
        pass=$((pass + 1))
    else
        echo "  FAIL $description"
        echo "       expected: $expected"
        echo "       actual:   $actual"
        fail=$((fail + 1))
    fi
}

# Two artefacts that differ, and a way to name the sha of either.
printf 'the extension, version 0.2\n' >"$WORK/new.zip"
printf 'the extension, version 0.1\n' >"$WORK/old.zip"
sha_of() { sha256sum "$1" | cut -d' ' -f1; }
NEW_SHA=$(sha_of "$WORK/new.zip")
OLD_SHA=$(sha_of "$WORK/old.zip")

# A fetcher the plan can use instead of curl: maps a fake URL to a local file.
cat >"$WORK/fetch" <<'FETCH'
#!/bin/sh
# usage: fetch URL DEST — the URL's basename names a file in the same directory as this script
set -eu
src="$(dirname "$0")/$(basename "$1")"
[ -f "$src" ] || exit 1
cp "$src" "$2"
FETCH
chmod +x "$WORK/fetch"
cp "$WORK/old.zip" "$WORK/old-release.zip"

releases() {
    printf '%s' "$1" >"$WORK/releases.json"
    echo "$WORK/releases.json"
}

# Run the plan and return its stdout as a single space-separated line, so a whole decision can
# be compared in one assertion.
plan() {
    "$PLAN" "$@" 2>>"$WORK/reasoning.log" | tr '\n' ' ' | sed 's/ $//'
}

ASSET='aideas-shell@patxi.gortazar.shell-extension.zip'

echo "== an entry that is not finished"
list=$(releases '[]')
check "not done: nothing is published" \
    "publish=no tag= reason=status is 'in_progress', not 'done'" \
    "$(plan --version 0.2 --status in_progress --releases "$list" --artefact "$WORK/new.zip")"

echo
echo "== the first release of a version"
check "an empty releases list publishes v0.2" \
    "publish=yes tag=aideas-shell-v0.2 reason=first release of 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip")"

list=$(releases "[{\"tag_name\": \"aideas-shell-v0.1\", \"assets\": [
    {\"name\": \"$ASSET\", \"digest\": \"sha256:$OLD_SHA\",
     \"browser_download_url\": \"https://example.invalid/old-release.zip\"}]}]")
check "a previous version's release does not block a new version" \
    "publish=yes tag=aideas-shell-v0.2 reason=first release of 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip")"

echo
echo "== the artefact is already published"
list=$(releases "[{\"tag_name\": \"aideas-shell-v0.2\", \"assets\": [
    {\"name\": \"$ASSET\", \"digest\": \"sha256:$NEW_SHA\",
     \"browser_download_url\": \"https://example.invalid/new.zip\"}]}]")
check "identical bytes publish nothing, and say which release has them" \
    "publish=no tag= reason=the artefact is byte-identical to aideas-shell-v0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip")"

echo
echo "== a second artefact at the same version"
check "the tag gains a suffix, so every artefact keeps its own" \
    "publish=yes tag=aideas-shell-v0.2-2 reason=a further artefact at version 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/old.zip")"

list=$(releases "[{\"tag_name\": \"aideas-shell-v0.2-2\", \"assets\": [
    {\"name\": \"$ASSET\", \"digest\": \"sha256:$OLD_SHA\"}]},
  {\"tag_name\": \"aideas-shell-v0.2\", \"assets\": [
    {\"name\": \"$ASSET\", \"digest\": \"sha256:$NEW_SHA\"}]}]")
printf 'a third artefact\n' >"$WORK/third.zip"
check "and keeps counting" \
    "publish=yes tag=aideas-shell-v0.2-3 reason=a further artefact at version 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/third.zip")"

check "the newest release is the one compared, not the base tag" \
    "publish=no tag= reason=the artefact is byte-identical to aideas-shell-v0.2-2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/old.zip")"

echo
echo "== other ideas' releases are none of our business"
list=$(releases "[{\"tag_name\": \"recap-v1.2\", \"assets\": [
    {\"name\": \"recap-x86_64\", \"digest\": \"sha256:$NEW_SHA\"}]},
  {\"tag_name\": \"pwgen-v0.3\", \"assets\": [
    {\"name\": \"pwgen$ASSET\", \"digest\": \"sha256:$NEW_SHA\"}]}]")
check "a list with no aideas-shell release publishes the first one" \
    "publish=yes tag=aideas-shell-v0.2 reason=first release of 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip")"

list=$(releases "[{\"tag_name\": \"recap-v1.2\", \"assets\": [
    {\"name\": \"recap-x86_64\", \"digest\": \"sha256:$NEW_SHA\"}]},
  {\"tag_name\": \"aideas-shell-v0.2\", \"assets\": [
    {\"name\": \"$ASSET\", \"digest\": \"sha256:$NEW_SHA\"}]}]")
check "another idea's newer release does not hide ours" \
    "publish=no tag= reason=the artefact is byte-identical to aideas-shell-v0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip")"

echo
echo "== a release with no digest is downloaded and hashed"
list=$(releases "[{\"tag_name\": \"aideas-shell-v0.2\", \"assets\": [
    {\"name\": \"$ASSET\",
     \"browser_download_url\": \"https://example.invalid/old-release.zip\"}]}]")
check "identical after downloading: nothing to publish" \
    "publish=no tag= reason=the artefact is byte-identical to aideas-shell-v0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/old.zip" \
        --fetch "$WORK/fetch")"
check "different after downloading: a suffixed tag" \
    "publish=yes tag=aideas-shell-v0.2-2 reason=a further artefact at version 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip" \
        --fetch "$WORK/fetch")"

echo
echo "== when the published bytes cannot be established"
list=$(releases "[{\"tag_name\": \"aideas-shell-v0.2\", \"assets\": [
    {\"name\": \"$ASSET\",
     \"browser_download_url\": \"https://example.invalid/gone.zip\"}]}]")
check "a failed download publishes rather than skipping silently" \
    "publish=yes tag=aideas-shell-v0.2-2 reason=a further artefact at version 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip" \
        --fetch "$WORK/fetch")"

echo
echo "== a release whose assets are not ours"
list=$(releases "[{\"tag_name\": \"aideas-shell-v0.1\", \"assets\": [
    {\"name\": \"SHA256SUMS\", \"digest\": \"sha256:$OLD_SHA\"}]}]")
check "a tag with no .shell-extension.zip is not the newest artefact" \
    "publish=yes tag=aideas-shell-v0.2 reason=first release of 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip")"

echo
echo "== versions that do not agree"
list=$(releases '[]')
if "$PLAN" --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip" \
    --metadata-version 0.1 >"$WORK/out" 2>"$WORK/err"; then
    check "a version that disagrees with metadata.json fails the run" "non-zero exit" "exit 0"
else
    check "a version that disagrees with metadata.json fails the run" "reported" \
        "$(grep -q 'STATUS.md says version 0.2 but metadata.json says 0.1' "$WORK/err" &&
            echo reported || echo "missing: $(cat "$WORK/err")")"
fi
check "agreeing versions are fine" \
    "publish=yes tag=aideas-shell-v0.2 reason=first release of 0.2" \
    "$(plan --version 0.2 --status done --releases "$list" --artefact "$WORK/new.zip" \
        --metadata-version 0.2)"

echo
echo "== bad input fails loudly rather than publishing something wrong"
for args in \
    "--version 0.2 --status done --releases /nonexistent.json --artefact $WORK/new.zip" \
    "--version 0.2 --status done --releases $list --artefact /nonexistent.zip" \
    "--version nonsense --status done --releases $list --artefact $WORK/new.zip"; do
    # shellcheck disable=SC2086
    if "$PLAN" $args >/dev/null 2>&1; then
        check "refused: $args" "non-zero exit" "exit 0"
    else
        check "refused: ${args%% --status*} …" "non-zero exit" "non-zero exit"
    fi
done

printf 'not json at all' >"$WORK/broken.json"
if "$PLAN" --version 0.2 --status done --releases "$WORK/broken.json" \
    --artefact "$WORK/new.zip" >/dev/null 2>&1; then
    check "an unparseable releases list fails the run" "non-zero exit" "exit 0"
else
    check "an unparseable releases list fails the run" "non-zero exit" "non-zero exit"
fi

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
