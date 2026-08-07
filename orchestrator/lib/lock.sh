#!/usr/bin/env bash
# Expiring lock over the ideas repo, so a crashed orchestrator run doesn't wedge things
# forever. Uses `mkdir` for atomicity (works on any POSIX filesystem, no flock needed).
#
# The lock is *renewed* while the cycle runs rather than being trusted for its whole TTL.
# The old scheme timed out from when the lock was taken, so "held" only meant "taken
# recently" — a cycle that stalled kept the lock looking valid for the full TTL, and one
# that outlived the TTL kept working while other cycles were free to reclaim it. A
# suspended laptop showed this at its worst: a cycle held the lock for 17 hours against a
# 60-minute TTL, because a userspace deadline check cannot fire while the process is
# frozen. Renewal inverts it — "held" now means "something was alive within the last TTL",
# which stays true across suspends, crashes and kill -9 alike.

LOCK_DIR="${IDEAS_REPO_PATH}/.orchestrator/lock"
LOCK_META="${LOCK_DIR}/meta.json"
LOCK_LOST_FLAG="${IDEAS_REPO_PATH}/.orchestrator/lock-lost"
LOCK_TOKEN=""
LOCK_RENEWER_PID=""

_lock_token_in_meta() {
  grep -o '"token": "[^"]*"' "${LOCK_META}" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/'
}

_write_lock_meta() {
  local now
  now=$(date +%s)
  # Write-then-rename so a reader never sees a half-written file.
  cat > "${LOCK_META}.tmp" <<EOF
{"token": "${LOCK_TOKEN}", "acquired_at": ${LOCK_ACQUIRED_AT}, "renewed_at": ${now}, "ttl_minutes": ${LOCK_TTL_MINUTES}, "pid": $$}
EOF
  mv "${LOCK_META}.tmp" "${LOCK_META}"
}

# Refreshes renewed_at until the cycle ends — or until someone else's token appears in the
# lock, which means this cycle was declared dead and reclaimed while it was stalled. It
# then raises the lost-lock flag instead of stamping over the new holder's lock.
_lock_renewer() {
  local interval="$1"
  while sleep "${interval}"; do
    [[ -f "${LOCK_META}" ]] || { : > "${LOCK_LOST_FLAG}"; return 0; }
    if [[ "$(_lock_token_in_meta)" != "${LOCK_TOKEN}" ]]; then
      : > "${LOCK_LOST_FLAG}"
      return 0
    fi
    _write_lock_meta
  done
}

# acquire_lock <ttl_minutes> [renew_seconds]
acquire_lock() {
  LOCK_TTL_MINUTES="$1"
  local renew_seconds="${2:-30}"
  # Only the leaf mkdir may be non-recursive (that's what makes it atomic), so ensure the
  # parent exists first — on a fresh clone it doesn't, and the lock could never be taken.
  mkdir -p "$(dirname "${LOCK_DIR}")"
  rm -f "${LOCK_LOST_FLAG}"
  LOCK_TOKEN="$(hostname)-$$-$(date +%s%N)"
  LOCK_ACQUIRED_AT=$(date +%s)

  if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
    # Lock exists — reclaim it only if nothing has renewed it within the TTL.
    local renewed_at ttl now age
    renewed_at=$(grep -o '"renewed_at": [0-9]*' "${LOCK_META}" 2>/dev/null | grep -o '[0-9]*')
    # A lock written by the pre-renewal version has no renewed_at; fall back to when it
    # was taken so an old lock left behind by an upgrade still ages out.
    [[ -n "${renewed_at}" ]] || renewed_at=$(grep -o '"acquired_at": [0-9]*' "${LOCK_META}" 2>/dev/null | grep -o '[0-9]*')
    ttl=$(grep -o '"ttl_minutes": [0-9]*' "${LOCK_META}" 2>/dev/null | grep -o '[0-9]*')
    [[ -n "${ttl}" ]] || ttl="${LOCK_TTL_MINUTES}"
    now=$(date +%s)
    if [[ -z "${renewed_at}" ]]; then
      # Meta unreadable: treat as abandoned rather than wedging forever on a corrupt file.
      echo "Reclaiming lock with unreadable metadata" >&2
      rm -rf "${LOCK_DIR}"
      mkdir "${LOCK_DIR}" || return 1
    else
      age=$(( (now - renewed_at) / 60 ))
      if (( age <= ttl )); then
        return 1
      fi
      echo "Reclaiming stale lock (no renewal for ${age}m > ttl ${ttl}m)" >&2
      rm -rf "${LOCK_DIR}"
      mkdir "${LOCK_DIR}" || return 1
    fi
  fi

  _write_lock_meta
  _lock_renewer "${renew_seconds}" &
  LOCK_RENEWER_PID=$!
  return 0
}

# True once this cycle's lock has been reclaimed by someone else.
lock_lost() { [[ -f "${LOCK_LOST_FLAG}" ]]; }

release_lock() {
  [[ -n "${LOCK_RENEWER_PID}" ]] && kill "${LOCK_RENEWER_PID}" 2>/dev/null
  LOCK_RENEWER_PID=""
  # Never delete a lock that is no longer ours — after a reclaim it belongs to a live
  # cycle, and removing it would hand the repo to a third one.
  if [[ -z "${LOCK_TOKEN}" || "$(_lock_token_in_meta)" == "${LOCK_TOKEN}" ]]; then
    rm -rf "${LOCK_DIR}"
  fi
  rm -f "${LOCK_LOST_FLAG}"
}
