#!/usr/bin/env bash
# Put a shared credential into an idea repository's Actions secrets, without ever
# revealing it.
#
#   scripts/set-repo-secret.sh <repo> <SECRET_NAME>
#   scripts/set-repo-secret.sh --list
#
# `gortazar` is a User account, not an Organization, so there are no org-level secrets and
# every new idea repository needs its own copy of the same credential. Actions secrets are
# write-only — the API returns a secret's name and dates, never its value — so no repo can
# be used as the source. Something local has to hold the value.
#
# That something is the agent env file, mode 600 and outside every repository and worktree,
# where the heartbeat secret already lives. It is deliberately NOT in the repo tree: build
# agents run with Bash, Read, Glob and Grep, so a credential in the tree is a credential in
# every agent's context, and from there it reaches STATUS.md, commit messages, result JSON
# and session transcripts — none of which are as carefully ignored as *.env is.
#
# This script is how an agent gets the *capability* without the *value*. It prints only the
# secret's name, never its contents, so running it inside an agent session leaks nothing.
#
# The allowlist matters. Without it an agent could name any variable in the env file —
# HEARTBEAT_SHARED_SECRET, say — and push it to a public repository's secret store, which
# is a place you never chose to put it. Only credentials that genuinely belong in an idea
# repository's CI are distributable.
set -euo pipefail

ENV_FILE="${IDEA_AGENT_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/idea-agent/env}"
OWNER="${IDEA_REPO_OWNER:-gortazar}"

# Credentials an idea's own CI legitimately needs.
DISTRIBUTABLE=(SONAR_TOKEN AMO_JWT_ISSUER AMO_JWT_SECRET)

die() { printf 'set-repo-secret: %s\n' "$*" >&2; exit 1; }

# Read one KEY=value line without echoing it. head -1 so a duplicated key cannot silently
# concatenate, and no shell expansion of the value.
read_secret() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

is_distributable() {
  local want="$1" name
  for name in "${DISTRIBUTABLE[@]}"; do [ "$name" = "$want" ] && return 0; done
  return 1
}

if [ "${1:-}" = "--list" ]; then
  [ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE"
  printf 'Distributable credentials (names only, from %s):\n' "$ENV_FILE"
  for name in "${DISTRIBUTABLE[@]}"; do
    if [ -n "$(read_secret "$name")" ]; then
      printf '  %-16s configured\n' "$name"
    else
      printf '  %-16s NOT SET — ask the user to add it\n' "$name"
    fi
  done
  exit 0
fi

REPO="${1:-}"
NAME="${2:-}"
[ -n "$REPO" ] && [ -n "$NAME" ] || die "usage: set-repo-secret.sh <repo> <SECRET_NAME> | --list"
case "$REPO" in */*) ;; *) REPO="$OWNER/$REPO" ;; esac

is_distributable "$NAME" || die "$NAME is not distributable. Allowed: ${DISTRIBUTABLE[*]}
Anything else in the env file is local to this machine on purpose."

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE"
command -v gh >/dev/null || die "gh is not on PATH"

value="$(read_secret "$NAME")"
[ -n "$value" ] || die "$NAME is not set in $ENV_FILE.
Ask the user to add it — this script cannot create a credential, only copy one."

# Through stdin, never argv: a value passed as an argument is visible in `ps` to every
# process on the machine for as long as the call runs.
printf '%s' "$value" | gh secret set "$NAME" --repo "$REPO" >/dev/null \
  || die "could not set $NAME on $REPO (is the gh login authorised for it?)"

# Confirm from GitHub's side rather than trusting the exit status. Names and dates only.
if gh secret list --repo "$REPO" 2>/dev/null | awk '{print $1}' | grep -qx "$NAME"; then
  printf '%s set on %s\n' "$NAME" "$REPO"
else
  die "$NAME does not appear in the secret list for $REPO after setting it"
fi
