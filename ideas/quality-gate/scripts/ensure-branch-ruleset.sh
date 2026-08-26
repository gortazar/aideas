#!/usr/bin/env bash
# Protect one repository's default branch with a pull request and required checks.
#
#   scripts/ensure-branch-ruleset.sh <repo> <context> [<context> ...]
#   scripts/ensure-branch-ruleset.sh --status <repo>
#
# One repository per call, deliberately: this is the script that can lock a repository's
# main against everybody if a check context is misspelt, so there is no bulk mode to run it
# across six of them before noticing.
#
# **The contexts are arguments, not guesses.** A required status check that is never
# reported leaves every pull request open forever, with no bypass actor to rescue it. Read
# them off a live pull request first:
#
#   gh api repos/gortazar/<repo>/commits/<sha>/check-runs --jq '.check_runs[].name'
#
# Recovery, if it goes wrong: a ruleset is repository configuration rather than a branch, so
#
#   gh api -X DELETE repos/gortazar/<repo>/rulesets/<id>
#
# still works for the owner and for this script's own token. `--status` prints the id.
set -euo pipefail

OWNER="${IDEA_REPO_OWNER:-gortazar}"
RULESET_NAME="${RULESET_NAME:-main protected}"

die() { printf 'ensure-branch-ruleset: %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || die "gh is not on PATH"
command -v jq >/dev/null || die "jq is not on PATH (run inside nix develop)"

status_only=no
if [ "${1:-}" = "--status" ]; then
    status_only=yes
    shift
fi

repo="${1:-}"
[ -n "$repo" ] || die "usage: ensure-branch-ruleset.sh [--status] <repo> [<context> ...]"
shift || true
case "$repo" in */*) ;; *) repo="$OWNER/$repo" ;; esac
contexts=("$@")

existing_id="$(gh api "repos/$repo/rulesets" --jq \
    ".[] | select(.name == \"$RULESET_NAME\") | .id" 2>/dev/null || true)"

if [ "$status_only" = yes ]; then
    if [ -z "$existing_id" ]; then
        echo "$repo: no ruleset named '$RULESET_NAME'"
        exit 1
    fi
    gh api "repos/$repo/rulesets/$existing_id" --jq '
        "\(.name) (id \(.id)) enforcement=\(.enforcement) target=\(.target)",
        "  bypass actors: \(if (.bypass_actors | length) == 0 then "none" else (.bypass_actors | length | tostring) end)",
        "  rules: \([.rules[].type] | join(", "))",
        "  required checks: \([.rules[] | select(.type == "required_status_checks")
             | .parameters.required_status_checks[].context] | join(", "))",
        "  approvals required: \([.rules[] | select(.type == "pull_request")
             | .parameters.required_approving_review_count] | join(""))"'
    exit 0
fi

[ "${#contexts[@]}" -gt 0 ] || die "no required check contexts given.
Read them off a live pull request rather than guessing — a context that is never reported
blocks every merge forever:
  gh api repos/$repo/commits/<sha>/check-runs --jq '.check_runs[].name'"

# `gh pr merge --auto` is refused outright unless the repository allows auto-merge, and
# auto-merge is the whole point: it is what lets an agent stop watching.
gh api -X PATCH "repos/$repo" -F allow_auto_merge=true >/dev/null
echo "$repo: auto-merge allowed"

# required_approving_review_count MUST be 0. A solo account cannot approve its own pull
# request, so anything higher is not "stricter", it is a permanent deadlock.
#
# strict_required_status_checks_policy is false on purpose too: requiring the branch to be
# up to date with main turns two open pull requests in one repository into a rebase loop,
# and two agents can be in the same repository on the same day.
#
# No bypass actors at all. The point of the gate is that it cannot be waved through; an
# admin bypass would make it advice with extra steps.
checks_json="$(printf '%s\n' "${contexts[@]}" | jq -R '{context: .}' | jq -s '.')"
payload="$(jq -n \
    --arg name "$RULESET_NAME" \
    --argjson checks "$checks_json" \
    '{
      name: $name,
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        { type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false
          } },
        { type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: false,
            required_status_checks: $checks
          } }
      ]
    }')"

if [ -n "$existing_id" ]; then
    printf '%s' "$payload" |
        gh api -X PUT "repos/$repo/rulesets/$existing_id" --input - >/dev/null
    echo "$repo: updated ruleset '$RULESET_NAME' (id $existing_id)"
else
    existing_id="$(printf '%s' "$payload" |
        gh api -X POST "repos/$repo/rulesets" --input - --jq '.id')"
    echo "$repo: created ruleset '$RULESET_NAME' (id $existing_id)"
fi

echo "$repo: required checks -> ${contexts[*]}"
echo
echo "Read it back with: $0 --status ${repo#"$OWNER"/}"
