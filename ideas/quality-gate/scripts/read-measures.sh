#!/usr/bin/env bash
# Print what baseline.md records, for one project or all of them.
#
#   scripts/read-measures.sh [<repo-name> ...]
#
# The gate, every condition with its measured value and threshold, the new-code period and
# how many new lines are in it, and the whole-project measures that a future blocking gate
# would inherit.
#
# No token: every project here is public, and so is the SonarQube Cloud web API for a public
# project. That is deliberate — the numbers in baseline.md can be re-checked by anyone,
# including a reader who has no access to the organisation.
set -euo pipefail

ORGANIZATION="${SONAR_ORGANIZATION:-gortazar}"
HOST="https://sonarcloud.io"

command -v jq >/dev/null || { echo "jq is not on PATH (run inside nix develop)" >&2; exit 1; }

repos=("$@")
if [ "${#repos[@]}" -eq 0 ]; then
    repos=(recap recap-gs gnome-shell-pwgen restore-wss lo-pert aideas)
fi

# Whole-project, not new-code: what the gate would inherit if it were ever made to judge
# the whole codebase rather than the diff.
overall_metrics=ncloc,ncloc_language_distribution,coverage,duplicated_lines_density,bugs,vulnerabilities,security_hotspots,code_smells,sqale_index,reliability_rating,security_rating,sqale_rating

for repo in "${repos[@]}"; do
    key="${ORGANIZATION}_${repo}"
    echo "=============================================================="
    echo "$key"
    echo "  $HOST/project/overview?id=$key"

    status="$(curl -fsS "$HOST/api/qualitygates/project_status?projectKey=$key" |
        jq -r '.projectStatus.status')"
    echo "  gate: $status"

    if [ "$status" = "NONE" ]; then
        # Not a failure to report — the gate is simply not computed until there is a
        # previous analysis to define new code against.
        echo "  (no gate yet: a project needs a second analysis before one is computed)"
    else
        curl -fsS "$HOST/api/qualitygates/project_status?projectKey=$key" |
            jq -r '.projectStatus |
                "  new-code period: \(.periods[0].mode // "?") since \(.periods[0].date // "?")",
                (.conditions[] |
                  "    \(.status | if . == "OK" then "pass" else "FAIL" end)  \(.metricKey) = \(.actualValue) (\(.comparator) \(.errorThreshold))")'
        # Sonar drops the coverage and duplication conditions when the period has fewer than
        # 20 new lines, and says nothing about having done so. That absence is a finding, so
        # print the new-line count beside the conditions rather than leaving it to be
        # inferred.
        new_lines="$(curl -fsS "$HOST/api/measures/component?component=$key&metricKeys=new_lines" |
            jq -r '.component.measures[]? | select(.metric == "new_lines") | .periods[0].value // "?"')"
        echo "    new lines in period: ${new_lines:-0}"
        case "${new_lines:-0}" in
            ''|*[!0-9]*) ;;
            *) [ "${new_lines:-0}" -lt 20 ] &&
                echo "    -> under 20, so the coverage and duplication conditions were not evaluated" ;;
        esac
    fi

    echo "  whole project:"
    curl -fsS "$HOST/api/measures/component?component=$key&metricKeys=$overall_metrics" |
        jq -r '.component.measures[] | "    \(.metric) = \(.value)"' | sort
done
