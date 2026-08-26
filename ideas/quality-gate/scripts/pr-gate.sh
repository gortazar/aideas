#!/usr/bin/env bash
# Why is the quality gate red on this pull request?
#
#   scripts/pr-gate.sh <repo> <pr-number>
#
# Prints every condition with its measured value and threshold, marking the ones that
# failed, and then the actual new-code issues behind them — file, line, rule and message —
# so the next move is a decision rather than a hunt through the dashboard.
#
# No token: every project in this fleet is public, and so is the SonarQube Cloud web API for
# a public project. This runs from a laptop, from CI, or from an agent with no credentials.
#
# What to do with what it prints is in AGENTS.md, and it is a ladder, not a menu:
#
#   1. A real finding      -> fix it in this same pull request. This is the expected case.
#   2. A catalogued false  -> a *narrow* exclusion in this repository's
#      positive               sonar-project.properties, in this same pull request, with the
#                             reason in the commit message and a row in exclusions.md.
#   3. Neither, this cycle -> land nothing. Leave the pull request open without auto-merge,
#                             status: in_progress, and say in STATUS.md which condition and
#                             what the measured numbers were.
#
# Bypassing the gate is not on the ladder.
set -euo pipefail

ORGANIZATION="${SONAR_ORGANIZATION:-gortazar}"
HOST="https://sonarcloud.io"

die() { printf 'pr-gate: %s\n' "$*" >&2; exit 1; }
command -v jq >/dev/null || die "jq is not on PATH (run inside nix develop)"

repo="${1:-}"
pr="${2:-}"
[ -n "$repo" ] && [ -n "$pr" ] || die "usage: pr-gate.sh <repo> <pr-number>"
repo="${repo##*/}"
key="${ORGANIZATION}_${repo}"

echo "$key pull request #$pr"
echo "  $HOST/summary/new_code?id=$key&pullRequest=$pr"
echo

status_json="$(curl -fsS "$HOST/api/qualitygates/project_status?projectKey=$key&pullRequest=$pr" 2>/dev/null || true)"
[ -n "$status_json" ] || die "no analysis for $key pull request #$pr.
Either the scan has not finished, or the sonar job was skipped (no SONAR_TOKEN — a pull
request from a fork gets no secrets), or the pull request number is wrong."

status="$(printf '%s' "$status_json" | jq -r '.projectStatus.status')"
echo "gate: $status"

printf '%s' "$status_json" | jq -r '
    .projectStatus.conditions[]? |
    "  \(if .status == "OK" then "pass" else "FAIL" end)  \(.metricKey) = \(.actualValue) (fails when \(.comparator) \(.errorThreshold))"'

# Which conditions were not evaluated at all is as important as which failed: Sonar drops
# coverage and duplication below 20 new lines and says nothing about it, so a gate can be
# green because it looked at almost nothing. See gate.md.
new_lines="$(curl -fsS "$HOST/api/measures/component?component=$key&pullRequest=$pr&metricKeys=new_lines" 2>/dev/null |
    jq -r '.component.measures[]? | select(.metric == "new_lines") | (.periods[0].value // .period.value // .value)' || true)"
echo "  new lines in this pull request: ${new_lines:-0}"
case "${new_lines:-0}" in
    ''|*[!0-9]*) ;;
    *) [ "${new_lines:-0}" -lt 20 ] &&
        echo "  -> under 20, so Sonar did not evaluate coverage or duplication at all" ;;
esac

if [ "$status" = "OK" ]; then
    echo
    echo "Nothing to do: the gate is green."
    exit 0
fi

echo
echo "new-code issues on this pull request:"
issues="$(curl -fsS "$HOST/api/issues/search?componentKeys=$key&pullRequest=$pr&resolved=false&inNewCodePeriod=true&ps=100" 2>/dev/null || true)"
count="$(printf '%s' "$issues" | jq -r '.total // 0')"
if [ "${count:-0}" = 0 ]; then
    echo "  none — the failing condition is a measurement (coverage or duplication),"
    echo "  not an issue. Add tests, or reduce the duplicated block."
else
    printf '%s' "$issues" | jq -r '
        .issues[] |
        "  [\(.severity // .impacts[0].severity // "?") \(.type // .impacts[0].softwareQuality // "?")] " +
        "\(.component | sub("^[^:]*:"; "")):\(.line // 0)\n      \(.message)\n      rule: \(.rule)"'
fi

cat <<EOF

Next, in order:
  1. A real finding? Fix it in this pull request.
  2. A false positive of a class ideas/quality-gate/baseline.md already catalogues — a
     GNOME Shell stylesheet parsed as CSS, an issue in a sonar.tests source, coverage of
     code no runner can reach? Add a *narrow* exclusion to $repo's
     sonar-project.properties in this pull request, with the reason in the commit message
     and a row in ideas/quality-gate/exclusions.md.
  3. Neither, not this cycle? Land nothing. Leave this pull request open without
     auto-merge, set status: in_progress, and name the condition and the numbers in
     STATUS.md. If the gate itself is what is wrong, append an open question to the idea's
     PLAN.md and stop.
EOF
