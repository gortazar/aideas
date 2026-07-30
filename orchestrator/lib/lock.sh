#!/usr/bin/env bash
# Expiring lock over the ideas repo, so a crashed orchestrator run doesn't wedge things
# forever. Uses `mkdir` for atomicity (works on any POSIX filesystem, no flock needed).

LOCK_DIR="${IDEAS_REPO_PATH}/.orchestrator/lock"
LOCK_META="${LOCK_DIR}/meta.json"

acquire_lock() {
  local ttl_minutes="$1"
  # Only the leaf mkdir may be non-recursive (that's what makes it atomic), so ensure the
  # parent exists first — on a fresh clone it doesn't, and the lock could never be taken.
  mkdir -p "$(dirname "${LOCK_DIR}")"
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    echo "{\"acquired_at\": $(date +%s), \"ttl_minutes\": ${ttl_minutes}}" > "${LOCK_META}"
    return 0
  fi

  # Lock exists — check if it's expired.
  if [[ -f "${LOCK_META}" ]]; then
    local acquired_at ttl now age
    acquired_at=$(grep -o '"acquired_at": [0-9]*' "${LOCK_META}" | grep -o '[0-9]*')
    ttl=$(grep -o '"ttl_minutes": [0-9]*' "${LOCK_META}" | grep -o '[0-9]*')
    now=$(date +%s)
    age=$(( (now - acquired_at) / 60 ))
    if (( age > ttl )); then
      echo "Reclaiming stale lock (age ${age}m > ttl ${ttl}m)" >&2
      rm -rf "${LOCK_DIR}"
      mkdir "${LOCK_DIR}"
      echo "{\"acquired_at\": $(date +%s), \"ttl_minutes\": ${ttl_minutes}}" > "${LOCK_META}"
      return 0
    fi
  fi
  return 1
}

release_lock() {
  rm -rf "${LOCK_DIR}"
}

