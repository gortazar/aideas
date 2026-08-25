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
projects=(
)

# The reference every caller must pin. Callers pin the major tag, not a commit, so
# that a fix to the reusable workflow reaches all six projects at once; tag-sonar.yml
# is what keeps v1 pointing at the current sonar.yml.
reusable_ref="gortazar/aideas/.github/workflows/sonar.yml@v1"

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

    local workflow_path="$project_root/$workflow"
    if [ ! -f "$workflow_path" ]; then
        fail "$key: no caller workflow at $dir/$workflow"
    elif ! file_contains "$workflow_path" "$reusable_ref"; then
        fail "$key: $dir/$workflow does not call $reusable_ref"
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

echo "checking wiring against $repo_root"

for row in "${projects[@]}"; do
    IFS='|' read -r key dir workflow readmes <<<"$row"
    check_project "$key" "$dir" "$workflow" "$readmes"
done

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count wiring problem(s)." >&2
    exit 1
fi

echo "PASS: ${#projects[@]} project(s) wired to $reusable_ref"
