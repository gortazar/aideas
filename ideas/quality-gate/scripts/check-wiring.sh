#!/usr/bin/env bash
# Assert that every project this idea claims to have wired up to the shared Sonar
# workflow is, in fact, still wired up.
#
# The wiring of one project is several files in (usually) another repository plus a pile of
# configuration in two web APIs, and nothing else in this repo would notice if any of it went
# away — a submodule pointer moving backwards silently takes the caller workflow and the
# properties file with it, and a ruleset quietly losing its pull-request rule looks exactly
# like a healthy one. So for every project in the table below, all seven:
#
#   1. its caller workflow exists and pins the reusable workflow at @v1;
#   2. it has a sonar-project.properties naming the expected project key;
#   3. every README that carries its badge still carries it;
#   4. baseline.md has a section for it;
#   5. its repository has an active ruleset on the default branch, with a pull_request rule,
#      the right required check, and no bypass actors — or, for the one repository that is
#      ungated on purpose, no ruleset at all;
#   6. the project is assigned to the custom quality gate gate.md says it should be;
#   7. the pinned gitlink is reachable from upstream's main. A squash merge with
#      --delete-branch orphans the branch tip, so a pin taken from it resolves nowhere.
#
# 1-4 are local. 5-7 read public APIs and need no token, though one is used if the
# environment has it — see github_api() for why. --no-network skips them.
#
# Run from anywhere: ./scripts/check-wiring.sh (needs bash, jq, curl and a populated
# checkout of the submodules it names).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
idea_dir="$PWD"
repo_root="$(cd ../.. && pwd)"

# One row per SonarQube Cloud project, fields separated by '|':
#
#   key | dir | workflow | readmes | gate | sonar-context
#
#   key            the SonarQube Cloud project key (sonar.projectKey). The repository name
#                  is this minus the "gortazar_" prefix.
#   dir            the project's root, relative to this repo's root. '.' is this repo
#                  itself; the others are submodule working trees.
#   workflow       the caller workflow, relative to dir
#   readmes        space-separated READMEs carrying this project's badge, relative to this
#                  repo's root (not to dir — the two in-repo ideas share a project but live
#                  outside its dir)
#   gate           the custom quality gate the project must be assigned to
#   sonar-context  the check-run name the branch ruleset must require. **Empty means no
#                  ruleset is expected**, and the absence is then asserted — that is
#                  gortazar_aideas, left ungated on purpose because the orchestrator pushes
#                  its main directly every cycle.
#
# The context is per row and not a constant because it is not guessable: a caller job with
# a `name:` reports "<name> / Analysis". gnome-shell-pwgen is the one that proves it.
#
# Rows are added by the unit that actually wires each project up and reads its first
# gate, never in advance: a row here is a claim that the analysis is running.
projects=(
    "gortazar_aideas|.|.github/workflows/sonar-aideas-repo.yml|ideas/aideas/README.md ideas/gnome-tasks/README.md|aideas uninstrumented|"
    "gortazar_recap|ideas/recap/upstream|.github/workflows/ci.yml|ideas/recap/upstream/README.md|aideas instrumented|sonar / Analysis"
    "gortazar_recap-gs|ideas/recap-gs/upstream|.github/workflows/ci.yml|ideas/recap-gs/upstream/README.md|aideas uninstrumented|sonar / Analysis"
    "gortazar_gnome-shell-pwgen|ideas/pwgen/upstream|.github/workflows/ci.yml|ideas/pwgen/upstream/README.md|aideas uninstrumented|SonarQube Cloud / Analysis"
    "gortazar_restore-wss|ideas/restore-wss/upstream|.github/workflows/ci.yml|ideas/restore-wss/upstream/README.md|aideas instrumented|sonar / Analysis"
    "gortazar_lo-pert|ideas/lo-pert/upstream|.github/workflows/ci.yml|ideas/lo-pert/upstream/README.md|aideas instrumented|sonar / Analysis"
)

# Everything the three network assertions read is public — the repositories, their rulesets
# and the SonarQube Cloud API for a public project — so they need no token and run in CI as
# they do on a laptop. --no-network skips them for an offline checkout, and says it did.
OWNER="${IDEA_REPO_OWNER:-gortazar}"
GITHUB_API="https://api.github.com"
RULESET_NAME="${RULESET_NAME:-main protected}"
SONAR_HOST="https://sonarcloud.io"
use_network=yes
if [ "${1:-}" = "--no-network" ]; then use_network=no; fi

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

# Everything read here is public, so no token is *required* — but unauthenticated
# api.github.com allows 60 requests an hour per IP, and this makes three per project. That
# limit is reachable in one session and is shared between every job on a GitHub-hosted
# runner, and a rate-limited response is indistinguishable from a missing ruleset. So use a
# token when the environment has one, and say so when a call fails.
#
# Through --config on stdin, never argv: a token in a command line is visible in `ps` to
# every process on the machine.
github_api() {
    local token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    if [ -n "$token" ]; then
        printf 'header = "Authorization: Bearer %s"\n' "$token" |
            curl -fsS --config - "$GITHUB_API/$1" 2>/dev/null || true
    else
        curl -fsS "$GITHUB_API/$1" 2>/dev/null || true
    fi
}

rate_limit_hint="(if this is unexpected, it may be the unauthenticated GitHub API rate limit:
       set GH_TOKEN and re-run)"

# A ruleset that has quietly lost its pull-request rule, or that requires a check nobody
# reports any more, looks exactly like a healthy one from here. So read it back.
check_ruleset() {
    local key="$1" repo="$2" context="$3"
    local rulesets id detail

    rulesets="$(github_api "repos/$OWNER/$repo/rulesets")"
    if [ -z "$rulesets" ]; then
        fail "$key: could not read $OWNER/$repo's rulesets $rate_limit_hint"
        return
    fi
    id="$(printf '%s' "$rulesets" |
        jq -r --arg n "$RULESET_NAME" '.[] | select(.name == $n and .enforcement == "active") | .id' | head -1)"

    if [ -z "$context" ]; then
        # Ungated on purpose. Assert the absence, so that turning it on by accident — which
        # would stop every orchestrator cycle dead — cannot happen unnoticed.
        #
        # An `if`, not `[ ... ] && fail`: under `set -e` a false test as the last command of
        # an AND-list takes the whole script down, silently and with no output at all.
        if [ -n "$id" ]; then
            fail "$key: $OWNER/$repo has a '$RULESET_NAME' ruleset, but is meant to be ungated"
        fi
        return
    fi

    if [ -z "$id" ]; then
        fail "$key: $OWNER/$repo has no active ruleset named '$RULESET_NAME'"
        return
    fi

    detail="$(github_api "repos/$OWNER/$repo/rulesets/$id")"
    if [ -z "$detail" ]; then
        fail "$key: could not read ruleset $id on $OWNER/$repo $rate_limit_hint"
        return
    fi
    printf '%s' "$detail" | jq -e '.rules[] | select(.type == "pull_request")' >/dev/null ||
        fail "$key: $OWNER/$repo's ruleset has no pull_request rule — main can still be pushed"
    printf '%s' "$detail" |
        jq -e --arg c "$context" '.rules[] | select(.type == "required_status_checks")
            | .parameters.required_status_checks[] | select(.context == $c)' >/dev/null ||
        fail "$key: $OWNER/$repo's ruleset does not require '$context' — a red gate would not block the merge"
    printf '%s' "$detail" | jq -e '(.bypass_actors | length) == 0' >/dev/null ||
        fail "$key: $OWNER/$repo's ruleset has bypass actors — the gate can be waved through"
}

# A project silently left on the default "Sonar way" gate would pass a coverage condition
# this fleet does not use and fail one it does. gate.md says which gate each belongs to.
check_gate() {
    local key="$1" want="$2" got
    got="$(curl -fsS "$SONAR_HOST/api/qualitygates/get_by_project?organization=$OWNER&project=$key" \
        2>/dev/null | jq -r '.qualityGate.name // empty' || true)"
    if [ -z "$got" ]; then
        fail "$key: could not read which quality gate it is assigned to"
    elif [ "$got" != "$want" ]; then
        fail "$key: is on quality gate '$got', expected '$want'"
    fi
}

# The failure mode the pull-request flow introduced: `--squash --delete-branch` orphans the
# branch tip, so a pin taken from it resolves nowhere once the branch is gone. Asked of
# GitHub rather than of git, because CI clones submodules shallow and has no origin/main to
# compare against.
check_pin_is_on_main() {
    local key="$1" repo="$2" dir="$3" pin status
    pin="$(git -C "$repo_root" ls-files -s "$dir" | awk '$1 == "160000" { print $2 }')"
    if [ -z "$pin" ]; then
        fail "$key: no gitlink recorded for $dir"
        return
    fi
    status="$(github_api "repos/$OWNER/$repo/compare/$pin...main" |
        jq -r '.status // empty' || true)"
    case "$status" in
        behind | identical) ;;
        "") fail "$key: could not compare the pinned commit ${pin:0:8} against $OWNER/$repo's main $rate_limit_hint" ;;
        *) fail "$key: the pinned commit ${pin:0:8} is '$status' relative to main — not reachable from it.
       A squash merge with --delete-branch orphans the branch tip; pin the merge commit instead." ;;
    esac
}

check_project() {
    local key="$1" dir="$2" workflow="$3" readmes="$4" gate="$5" context="$6"
    local project_root="$repo_root/$dir"
    local repo="${key#"$OWNER"_}"

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

    if [ "$use_network" = yes ]; then
        check_ruleset "$key" "$repo" "$context"
        check_gate "$key" "$gate"
        # Only a submodule has a gitlink to orphan.
        if [ "$dir" != "." ]; then
            check_pin_is_on_main "$key" "$repo" "$dir"
        fi
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
if [ "$use_network" = yes ]; then
    echo "  including the ruleset, quality-gate and pin-reachability checks (no token needed)"
else
    echo "  --no-network: NOT checking rulesets, quality gates or pin reachability"
fi

check_shared_workflow

for row in "${projects[@]}"; do
    IFS='|' read -r key dir workflow readmes gate context <<<"$row"
    check_project "$key" "$dir" "$workflow" "$readmes" "$gate" "$context"
done

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count wiring problem(s)." >&2
    exit 1
fi

echo "PASS: ${#projects[@]} project(s) wired to sonar.yml"
