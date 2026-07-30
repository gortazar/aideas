#!/usr/bin/env bash
# Installed as a Claude Code hook (see claude-settings/hooks.json).
# Reads the hook JSON payload from stdin, extracts the session id, and pushes a
# heartbeat to the orchestrator over VPN. Fails silently and fast — a heartbeat
# miss just means the orchestrator waits one more staleness window, it must
# never block or slow down your actual Claude Code session.

set -euo pipefail

: "${ORCHESTRATOR_HEARTBEAT_URL:?set this to http://<orchestrator-vpn-ip>:8787/heartbeat}"
EVENT_NAME="${1:-unknown}"

payload="$(cat)"
session_id="$(printf '%s' "$payload" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"

body=$(cat <<EOF
{"event": "${EVENT_NAME}", "session_id": "${session_id}", "secret": "${ORCHESTRATOR_HEARTBEAT_SECRET:-}"}
EOF
)

curl --silent --max-time 2 --request POST \
  --header "Content-Type: application/json" \
  --data "${body}" \
  "${ORCHESTRATOR_HEARTBEAT_URL}" >/dev/null 2>&1 || true

exit 0

