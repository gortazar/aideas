#!/usr/bin/env bash
# Assert that every project this idea claims to have wired up to the shared Sonar
# workflow is, in fact, still wired up.
#
# The wiring of one project is four separate files in (usually) another repository,
# and nothing else in this repo would notice if one of them went away — a submodule
# pointer moving backwards silently takes the caller workflow and the properties file
# with it, and the badge in the README then points at a project nobody analyses any
# more. So for every project in the table below we check all four:
#
#   1. its caller workflow exists and pins the reusable workflow at @v1;
#   2. it has a sonar-project.properties naming the expected project key;
#   3. every README that carries its badge still carries it;
#   4. baseline.md has a section for it.
#
# Run from anywhere: ./scripts/check-wiring.sh (needs bash and a populated checkout
# of the submodules it names).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
idea_dir="$PWD"
repo_root="$(cd ../.. && pwd)"

# One row per SonarQube Cloud project, fields separated by '|':
#
#   key   | dir | workflow | readmes
#
#   key       the SonarQube Cloud project key (sonar.projectKey)
#   dir       the project's root, relative to this repo's root. '.' is this repo
#             itself; the others are submodule working trees.
#   workflow  the caller workflow, relative to dir
#   readmes   space-separated READMEs carrying this project's badge, relative to
#             this repo's root (not to dir — the two in-repo ideas share a project
#             but live outside its dir)
#
# Rows are added by the unit that actually wires each project up and reads its first
# gate, never in advance: a row here is a claim that the analysis is running.
# gortazar_aideas is wired (sonar-aideas-repo.yml, the root sonar-project.properties and
# both badges) but not listed yet: its workflow only runs once this branch reaches main, so
# there is no analysis to claim. Its row goes in with its first gate reading.
projects=(
    "gortazar_recap|ideas/recap/upstream|.github/workflows/ci.yml|ideas/recap/upstream/README.md"
)

# The reference every caller in another repository must pin. They pin the major tag, not
# a commit, so that a fix to the reusable workflow reaches all of them at once;
# tag-sonar.yml is what keeps v1 pointing at the current sonar.yml.
reusable_ref="gortazar/aideas/.github/workflows/sonar.yml@v1"

# This repository is the exception, and on purpose: sonar.yml lives here, so analysing
# itself through the local path makes it the canary. A change that breaks the reusable
# workflow fails on the commit that made it, rather than reaching five other repositories
# the moment v1 moves.
local_ref="./.github/workflows/sonar.yml"

fail_count=0

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    fail_count=$((fail_count + 1))
}

# grep -F over a whole file, without the exit-status noise `set -e` would make of it.
file_contains() {
    grep -qF -- "$2" "$1" 2>/dev/null
}

check_project() {
    local key="$1" dir="$2" workflow="$3" readmes="$4"
    local project_root="$repo_root/$dir"

    if [ ! -d "$project_root" ] || [ -z "$(ls -A "$project_root" 2>/dev/null)" ]; then
        fail "$key: $dir is missing or empty — run: git submodule update --init $dir"
        return
    fi

    local expected_ref="$reusable_ref"
    [ "$dir" = "." ] && expected_ref="$local_ref"

    local workflow_path="$project_root/$workflow"
    if [ ! -f "$workflow_path" ]; then
        fail "$key: no caller workflow at $dir/$workflow"
    elif ! file_contains "$workflow_path" "$expected_ref"; then
        fail "$key: $dir/$workflow does not call $expected_ref"
    fi

    local props="$project_root/sonar-project.properties"
    if [ ! -f "$props" ]; then
        fail "$key: no sonar-project.properties in $dir"
    elif ! file_contains "$props" "sonar.projectKey=$key"; then
        fail "$key: $dir/sonar-project.properties does not set sonar.projectKey=$key"
    fi

    local readme
    # Unquoted on purpose: the field holds a space-separated list of paths.
    # shellcheck disable=SC2086
    for readme in $readmes; do
        if [ ! -f "$repo_root/$readme" ]; then
            fail "$key: no README at $readme"
        elif ! file_contains "$repo_root/$readme" "project=$key"; then
            fail "$key: $readme carries no badge for $key"
        fi
    done

    if ! file_contains "$idea_dir/baseline.md" "$key"; then
        fail "$key: baseline.md has no section for it"
    fi
}

# The thing being pinned has to be there, and has to be callable. A caller pinned at
# @v1 fails with "workflow was not found" rather than anything about Sonar, so check
# the two ends of that reference here where the message can say what is wrong.
check_shared_workflow() {
    local shared="$repo_root/.github/workflows/sonar.yml"
    local tagger="$repo_root/.github/workflows/tag-sonar.yml"

    if [ ! -f "$shared" ]; then
        fail "no reusable workflow at .github/workflows/sonar.yml"
    elif ! file_contains "$shared" "workflow_call:"; then
        fail ".github/workflows/sonar.yml is not callable (no workflow_call trigger)"
    fi

    # Without this, v1 never moves and never exists in the first place, and every
    # caller in the table above breaks at once.
    if [ ! -f "$tagger" ]; then
        fail "no .github/workflows/tag-sonar.yml — nothing would create or move the v1 tag"
    elif ! file_contains "$tagger" "refs/tags/v1"; then
        fail ".github/workflows/tag-sonar.yml does not push refs/tags/v1"
    fi
}

echo "checking wiring against $repo_root"

check_shared_workflow

for row in "${projects[@]}"; do
    IFS='|' read -r key dir workflow readmes <<<"$row"
    check_project "$key" "$dir" "$workflow" "$readmes"
done

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count wiring problem(s)." >&2
    exit 1
fi

echo "PASS: ${#projects[@]} project(s) wired to sonar.yml"
