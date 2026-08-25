#!/usr/bin/env bash
# Make sure a SonarQube Cloud project exists for an idea repository, and that it is not
# also being analysed automatically.
#
#   scripts/ensure-sonar-project.sh <repo-name> [<repo-name> ...]
#   scripts/ensure-sonar-project.sh --status <repo-name> [...]
#
# Importing a repository through the SonarQube Cloud UI is a browser step; creating the
# project through the web API is not, so this does it. It is idempotent — a project that
# already exists is reported and left alone.
#
# **Automatic Analysis has to be off.** If a project has it enabled, a CI analysis fails
# with a message about exactly that conflict, and the failure looks like a broken workflow
# rather than a project setting. So this checks the setting and turns it off.
#
# Like scripts/set-repo-secret.sh at the repo root, this takes the *capability* of the
# token without its *value*: the token is read from the machine-local agent env file
# straight into a curl --config on stdin, never into argv (where `ps` would show it), never
# into a file, a log or this script's output.
set -euo pipefail

ENV_FILE="${IDEA_AGENT_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/idea-agent/env}"
ORGANIZATION="${SONAR_ORGANIZATION:-gortazar}"
HOST="https://sonarcloud.io"
# Every repository here uses `main`. A project whose main branch is called something else
# does not fail — it quietly files the analysis as a short-lived *branch* named main, which
# accumulates no measures and whose quality gate is not the project's. That is how the first
# recap analysis came back SUCCESS with nothing to read.
MAIN_BRANCH="${SONAR_MAIN_BRANCH:-main}"
# What a project imported through the SonarQube Cloud UI gets by default. This entry keeps
# the defaults deliberately — the point is to find out what they say, not to tune them —
# but a project created through the API gets no new-code period at all, so the default has
# to be applied by hand.
NEW_CODE_PERIOD="${SONAR_NEW_CODE_PERIOD:-previous_version}"

die() { printf 'ensure-sonar-project: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE — ask the user to add SONAR_TOKEN to it"
command -v jq >/dev/null || die "jq is not on PATH (run inside nix develop)"

token="$(sed -n 's/^SONAR_TOKEN=//p' "$ENV_FILE" | head -1)"
[ -n "$token" ] || die "SONAR_TOKEN is not set in $ENV_FILE.
This script cannot create a credential, only use one. Ask the user to add it."

# All API traffic goes through here so the token has exactly one path out of this script.
# --config - keeps the Authorization header off the command line; --fail-with-body makes an
# HTTP error an exit status while still letting the caller see what Sonar said.
sonar_api() {
    local method="$1" path="$2"
    shift 2
    printf 'header = "Authorization: Bearer %s"\n' "$token" |
        curl --silent --show-error --fail-with-body --config - \
            --request "$method" "$HOST/$path" "$@"
}

project_exists() {
    sonar_api GET "api/components/show?component=$1" >/dev/null 2>&1
}

# The setting is only present once something has set it; absent means off, which is what a
# project created through the API rather than imported from GitHub starts as.
autoscan_enabled() {
    local key="$1" value
    value="$(sonar_api GET "api/settings/values?component=$key&keys=sonar.autoscan.enabled" 2>/dev/null |
        jq -r '.settings[]? | select(.key == "sonar.autoscan.enabled") | .value' || true)"
    [ "$value" = "true" ]
}

main_branch_name() {
    sonar_api GET "api/project_branches/list?project=$1" 2>/dev/null |
        jq -r '.branches[]? | select(.isMain) | .name' || true
}

# A branch of the wrong name is only half the problem: once an analysis has run, there is
# also a short-lived branch sitting on the name we want, and the rename fails while it
# exists. Deleting it loses nothing — a short-lived branch holds no history worth keeping,
# and the next analysis recreates the name as the main branch.
fix_main_branch() {
    local key="$1" current
    current="$(main_branch_name "$key")"
    if [ "$current" = "$MAIN_BRANCH" ]; then
        echo "  main branch: $MAIN_BRANCH"
        return
    fi
    if [ "$status_only" = yes ]; then
        echo "  main branch is '$current', not '$MAIN_BRANCH' — analyses of $MAIN_BRANCH land on a short-lived branch"
        return
    fi
    if sonar_api GET "api/project_branches/list?project=$key" 2>/dev/null |
        jq -e --arg b "$MAIN_BRANCH" '.branches[]? | select(.name == $b and (.isMain | not))' >/dev/null; then
        sonar_api POST "api/project_branches/delete" \
            --data-urlencode "project=$key" \
            --data-urlencode "branch=$MAIN_BRANCH" >/dev/null
        echo "  deleted the short-lived '$MAIN_BRANCH' branch"
    fi
    sonar_api POST "api/project_branches/rename" \
        --data-urlencode "project=$key" \
        --data-urlencode "name=$MAIN_BRANCH" >/dev/null
    echo "  main branch renamed '$current' -> '$MAIN_BRANCH'"
}

# Without a new-code period there is no gate at all: `api/qualitygates/project_status`
# answers NONE, no new_* measure is computed, and two analyses in a row look exactly like
# one. A project imported through the SonarQube Cloud UI gets "previous version" by
# default; one created through api/projects/create gets nothing, which is the difference
# that made recap's first two analyses unreadable.
ensure_new_code_period() {
    local key="$1" current
    current="$(sonar_api GET "api/settings/values?component=$key&keys=sonar.leak.period" 2>/dev/null |
        jq -r '.settings[]? | select(.key == "sonar.leak.period") | .value' || true)"
    if [ "$current" = "$NEW_CODE_PERIOD" ]; then
        echo "  new code: $NEW_CODE_PERIOD"
        return
    fi
    if [ "$status_only" = yes ]; then
        echo "  new code period is '${current:-unset}', not '$NEW_CODE_PERIOD' — no quality gate will be computed"
        return
    fi
    sonar_api POST "api/settings/set" \
        --data-urlencode "component=$key" \
        --data-urlencode "key=sonar.leak.period" \
        --data-urlencode "value=$NEW_CODE_PERIOD" >/dev/null
    echo "  new code period set to '$NEW_CODE_PERIOD' (was '${current:-unset}')"
}

report() {
    local key="$1"
    local ncloc analyses
    ncloc="$(sonar_api GET "api/measures/component?component=$key&metricKeys=ncloc" 2>/dev/null |
        jq -r '.component.measures[]? | select(.metric == "ncloc") | .value' || true)"
    analyses="$(sonar_api GET "api/project_analyses/search?project=$key&ps=1" 2>/dev/null |
        jq -r '.paging.total // 0' || echo 0)"
    printf '    %s: %s analyses, %s lines of code\n' \
        "$key" "${analyses:-0}" "${ncloc:-0}"
    printf '    %s/project/overview?id=%s\n' "$HOST" "$key"
}

status_only=no
if [ "${1:-}" = "--status" ]; then
    status_only=yes
    shift
fi
[ "$#" -gt 0 ] || die "usage: ensure-sonar-project.sh [--status] <repo-name> [...]"

for repo in "$@"; do
    key="${ORGANIZATION}_${repo}"

    if project_exists "$key"; then
        echo "$key: exists"
    elif [ "$status_only" = yes ]; then
        echo "$key: DOES NOT EXIST"
        continue
    else
        # visibility=public so the dashboard and the badge work for anyone, and so the
        # analysis stays free: public projects have no line-of-code allocation.
        sonar_api POST "api/projects/create" \
            --data-urlencode "organization=$ORGANIZATION" \
            --data-urlencode "project=$key" \
            --data-urlencode "name=$repo" \
            --data-urlencode "branch=$MAIN_BRANCH" \
            --data-urlencode "visibility=public" >/dev/null
        echo "$key: created"
    fi

    fix_main_branch "$key"
    ensure_new_code_period "$key"

    if autoscan_enabled "$key"; then
        if [ "$status_only" = yes ]; then
            echo "  Automatic Analysis is ON — a CI analysis will fail with a conflict"
        else
            sonar_api POST "api/settings/set" \
                --data-urlencode "component=$key" \
                --data-urlencode "key=sonar.autoscan.enabled" \
                --data-urlencode "value=false" >/dev/null
            echo "  Automatic Analysis turned off"
        fi
    else
        echo "  Automatic Analysis: off"
    fi

    report "$key"
done
