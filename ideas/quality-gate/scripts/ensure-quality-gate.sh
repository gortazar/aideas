#!/usr/bin/env bash
# Create the two custom quality gates, and put every project behind the right one.
#
#   scripts/ensure-quality-gate.sh            create/reconcile both gates, assign all projects
#   scripts/ensure-quality-gate.sh --status   report what is there, change nothing
#
# Idempotent: a gate that already exists is reconciled condition by condition, so running
# this after editing the table below is how a threshold gets changed. Nothing is assumed
# about the starting state — a gate the SonarQube Cloud UI created with default conditions
# converges to the table just as an empty one does.
#
# Why two gates and why these numbers is in gate.md, which is the file to argue with. This
# script is only the mechanism.
#
# Same token discipline as ensure-sonar-project.sh and the repo's set-repo-secret.sh: the
# value is read from the machine-local agent env file straight into a `curl --config` on
# stdin, never into argv (where `ps` shows it to every process on the machine), never into a
# file, a log or this script's output.
set -euo pipefail

ENV_FILE="${IDEA_AGENT_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/idea-agent/env}"
ORGANIZATION="${SONAR_ORGANIZATION:-gortazar}"
HOST="https://sonarcloud.io"

# --- what the gates are -----------------------------------------------------------------
#
# Conditions are "<metric> <op> <error>", where op is the *failing* comparison: Sonar stores
# "fail when the measure is GT 1" for "rating must be A". Ratings are 1=A .. 5=E.
#
# Four conditions are common to both gates. Security hotspots reviewed is deliberately not
# among them: see gate.md.
COMMON_CONDITIONS=(
    "new_reliability_rating GT 1"
    "new_security_rating GT 1"
    "new_maintainability_rating GT 1"
    "new_duplicated_lines_density GT 3"
)

INSTRUMENTED_GATE="aideas instrumented"
INSTRUMENTED_CONDITIONS=("${COMMON_CONDITIONS[@]}" "new_coverage LT 60")
INSTRUMENTED_PROJECTS=(recap restore-wss lo-pert)

# No coverage condition at all, rather than one set to 0. A 0% threshold reads as "we
# measured and accepted nothing"; the truth is that there is no instrumentation story for a
# gjs suite, and an absent condition with the reason written down is the honest form of that.
UNINSTRUMENTED_GATE="aideas uninstrumented"
UNINSTRUMENTED_CONDITIONS=("${COMMON_CONDITIONS[@]}")
UNINSTRUMENTED_PROJECTS=(recap-gs gnome-shell-pwgen aideas)

# --- plumbing ---------------------------------------------------------------------------

die() { printf 'ensure-quality-gate: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE — ask the user to add SONAR_TOKEN to it"
command -v jq >/dev/null || die "jq is not on PATH (run inside nix develop)"

token="$(sed -n 's/^SONAR_TOKEN=//p' "$ENV_FILE" | head -1)"
[ -n "$token" ] || die "SONAR_TOKEN is not set in $ENV_FILE.
This script cannot create a credential, only use one. Ask the user to add it."

status_only=no
[ "${1:-}" = "--status" ] && status_only=yes

fail_count=0
fail() { printf 'FAIL: %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }

# All API traffic goes through here, so the token has exactly one path out of this script.
sonar_api() {
    local method="$1" path="$2"
    shift 2
    printf 'header = "Authorization: Bearer %s"\n' "$token" |
        curl --silent --show-error --fail-with-body --config - \
            --request "$method" "$HOST/$path" "$@"
}

gate_id() {
    sonar_api GET "api/qualitygates/show?organization=$ORGANIZATION&name=$(printf '%s' "$1" | jq -sRr @uri)" \
        2>/dev/null | jq -r '.id // empty' || true
}

gate_json() {
    sonar_api GET "api/qualitygates/show?organization=$ORGANIZATION&name=$(printf '%s' "$1" | jq -sRr @uri)"
}

# Bring one gate's conditions to exactly the wanted set: drop anything not wanted or wanted
# differently, then add what is missing. Doing it in that order means a changed threshold is
# a delete plus a create rather than a special case.
reconcile_conditions() {
    local name="$1" id="$2"
    shift 2
    local wanted=("$@")
    local existing
    existing="$(gate_json "$name" | jq -r '.conditions[]? | "\(.id) \(.metric) \(.op) \(.error)"')"

    local line cid metric op error spec keep
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        read -r cid metric op error <<<"$line"
        spec="$metric $op $error"
        keep=no
        for want in "${wanted[@]}"; do [ "$want" = "$spec" ] && keep=yes; done
        if [ "$keep" = no ]; then
            if [ "$status_only" = yes ]; then
                echo "    would remove: $spec"
            else
                sonar_api POST "api/qualitygates/delete_condition" \
                    --data-urlencode "organization=$ORGANIZATION" \
                    --data-urlencode "id=$cid" >/dev/null
                echo "    removed: $spec"
            fi
        fi
    done <<<"$existing"

    for want in "${wanted[@]}"; do
        read -r metric op error <<<"$want"
        if printf '%s\n' "$existing" | grep -qF -- " $metric $op $error"; then
            echo "    ok: $want"
            continue
        fi
        if [ "$status_only" = yes ]; then
            echo "    would add: $want"
        else
            sonar_api POST "api/qualitygates/create_condition" \
                --data-urlencode "organization=$ORGANIZATION" \
                --data-urlencode "gateId=$id" \
                --data-urlencode "metric=$metric" \
                --data-urlencode "op=$op" \
                --data-urlencode "error=$error" >/dev/null
            echo "    added: $want"
        fi
    done
}

# Sets GATE_ID rather than printing it: this function's stdout is the progress report, and
# mixing an identifier into it is how you end up assigning projects to a gate called
# "created (id 42)".
GATE_ID=""
ensure_gate() {
    local name="$1"
    shift
    GATE_ID="$(gate_id "$name")"
    if [ -z "$GATE_ID" ]; then
        if [ "$status_only" = yes ]; then
            # --status is a check, not just a report: something has to exit non-zero when
            # the gates are not what this file says they are.
            fail "'$name' does not exist"
            return 1
        fi
        GATE_ID="$(sonar_api POST "api/qualitygates/create" \
            --data-urlencode "organization=$ORGANIZATION" \
            --data-urlencode "name=$name" | jq -r '.id')"
        [ -n "$GATE_ID" ] && [ "$GATE_ID" != null ] || die "could not create the gate '$name'"
        echo "  '$name': created (id $GATE_ID)"
    else
        echo "  '$name': exists (id $GATE_ID)"
    fi
    reconcile_conditions "$name" "$GATE_ID" "$@"
}

# Assign, then read back from get_by_project rather than trusting the exit status: a project
# silently left on "Sonar way" is the failure mode that would make this whole entry a no-op.
assign() {
    local gate_name="$1" id="$2"
    shift 2
    local repo key current
    for repo in "$@"; do
        key="${ORGANIZATION}_${repo}"
        current="$(sonar_api GET "api/qualitygates/get_by_project?organization=$ORGANIZATION&project=$key" \
            2>/dev/null | jq -r '.qualityGate.name // empty' || true)"
        if [ "$current" = "$gate_name" ]; then
            echo "    $key -> '$gate_name'"
            continue
        fi
        if [ "$status_only" = yes ]; then
            echo "    $key is on '${current:-none}', not '$gate_name'"
            continue
        fi
        local before="${current:-none}"
        sonar_api POST "api/qualitygates/select" \
            --data-urlencode "organization=$ORGANIZATION" \
            --data-urlencode "gateId=$id" \
            --data-urlencode "projectKey=$key" >/dev/null
        current="$(sonar_api GET "api/qualitygates/get_by_project?organization=$ORGANIZATION&project=$key" \
            2>/dev/null | jq -r '.qualityGate.name // empty' || true)"
        if [ "$current" = "$gate_name" ]; then
            echo "    $key: '$before' -> '$gate_name' (confirmed)"
        else
            fail "$key is on '${current:-none}' after selecting '$gate_name'"
        fi
    done
}

echo "organization: $ORGANIZATION"

if ensure_gate "$INSTRUMENTED_GATE" "${INSTRUMENTED_CONDITIONS[@]}"; then
    assign "$INSTRUMENTED_GATE" "$GATE_ID" "${INSTRUMENTED_PROJECTS[@]}"
fi

if ensure_gate "$UNINSTRUMENTED_GATE" "${UNINSTRUMENTED_CONDITIONS[@]}"; then
    assign "$UNINSTRUMENTED_GATE" "$GATE_ID" "${UNINSTRUMENTED_PROJECTS[@]}"
fi

if [ "$fail_count" -gt 0 ]; then
    echo
    echo "$fail_count problem(s)." >&2
    exit 1
fi
echo "PASS: both gates reconciled and every project assigned"
