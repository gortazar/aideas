#!/usr/bin/env bash
# The compositor smoke test: the real extension, in a real GNOME Shell, against a stub /state.
#
#   ci/smoke-test.sh [--keep]
#
# Builds the bundle, starts two stub servers (a running cycle and an idle box), boots a headless
# Shell on a *private* session bus with the extension and the probe installed, and runs
# ci/smoke-assertions.py against it. Screenshots land in screenshots/.
#
# It does not touch the developer's own desktop: ci/nested-shell.sh isolates XDG_DATA_HOME,
# XDG_CONFIG_HOME and XDG_CACHE_HOME *before* starting the private bus, and then refuses to
# continue if the real dconf database changed while it was configuring the nested session. That
# check is not paranoia — a private bus alone does not stop dconf writes landing in the real
# database, because the dconf service the bus activates reads its path from its own environment.
set -euo pipefail

cd "$(dirname "$0")/.."

# Short, and under /tmp, because $STATE/bus is a Unix socket path — see
# ci/nested-shell.sh. Screenshots are written into the idea folder, not here.
STATE="${AIDEAS_NESTED_STATE:-/tmp/aideas-smoke}"
SCREENSHOTS="$PWD/screenshots"
INTERVAL=10
KEEP=0

[[ "${1:-}" == "--keep" ]] && KEEP=1

RUNNING_PID=""
IDLE_PID=""

cleanup() {
    local status=$?
    for pid in "$RUNNING_PID" "$IDLE_PID"; do
        [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done
    if [[ $KEEP -eq 0 ]]; then
        ci/nested-shell.sh stop --state "$STATE" >/dev/null 2>&1 || true
    else
        echo "nested session left running: source $STATE/env"
    fi
    exit $status
}
trap cleanup EXIT INT TERM

echo "== building the bundle"
make build >/dev/null

echo "== starting the stub /state servers"
mkdir -p "$STATE"

# Each server prints the port it bound to on its first line of stdout, flushed, before serving.
# Waiting for that line is the handshake: when it arrives, the server is listening.
start_stub() {
    local mode="$1" portfile="$STATE/$1.port"
    rm -f "$portfile"
    python3 tests/stub-state-server.py --mode "$mode" \
        >"$portfile" 2>"$STATE/stub-$mode.err" &
    local pid=$!
    for _ in $(seq 1 100); do
        if [[ -s "$portfile" ]]; then
            echo "$pid"
            return 0
        fi
        sleep 0.1
    done
    echo "the $mode stub server never named a port: $(cat "$STATE/stub-$mode.err")" >&2
    return 1
}

RUNNING_PID=$(start_stub running)
RUNNING_PORT=$(head -1 "$STATE/running.port")
IDLE_PID=$(start_stub idle)
IDLE_PORT=$(head -1 "$STATE/idle.port")
echo "   running cycle on 127.0.0.1:$RUNNING_PORT, idle box on 127.0.0.1:$IDLE_PORT"

# A port nothing listens on, for the unreachable case. Chosen by binding and releasing one, so
# it is free right now and almost certainly still free in a moment.
DEAD_PORT=$(python3 -c "
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
")
echo "   nothing listening on 127.0.0.1:$DEAD_PORT"

echo "== booting a nested GNOME Shell"
ci/nested-shell.sh stop --state "$STATE" >/dev/null 2>&1 || true
ci/nested-shell.sh start \
    --extension "build/aideas-shell@patxi.gortazar" \
    --extension ci/probe \
    --state "$STATE"

# shellcheck source=/dev/null
source "$STATE/env"

SCHEMADIR="$XDG_DATA_HOME/gnome-shell/extensions/aideas-shell@patxi.gortazar/schemas"

echo "== configuring the extension inside the nested session"
gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.aideas \
    orchestrator-host "127.0.0.1"
gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.aideas \
    orchestrator-port "$RUNNING_PORT"
gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.aideas \
    poll-interval-seconds "$INTERVAL"
gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.aideas \
    always-show false

mkdir -p "$SCREENSHOTS"

echo "== assertions"
set +e
python3 ci/smoke-assertions.py \
    --running-port "$RUNNING_PORT" \
    --idle-port "$IDLE_PORT" \
    --dead-port "$DEAD_PORT" \
    --schemadir "$SCHEMADIR" \
    --screenshots "$SCREENSHOTS" \
    --interval "$INTERVAL"
STATUS=$?
set -e

echo "== the Shell's own log, for anything aideas said"
grep -iE "aideas|JS ERROR" "$STATE/shell.log" | tail -20 || true

# A JS error from our own code in a real Shell is a failure however well the assertions went:
# an extension that works but logs a stack trace on every unlock is broken.
if grep -q "JS ERROR" "$STATE/shell.log" &&
    grep "JS ERROR" "$STATE/shell.log" | grep -qi "aideas"; then
    echo "FAIL: aideas logged a JS error in the Shell (see $STATE/shell.log)"
    STATUS=1
fi

if [[ $STATUS -eq 0 ]]; then
    echo "== smoke test passed; screenshots in $SCREENSHOTS"
else
    echo "== smoke test FAILED (shell log: $STATE/shell.log)"
fi
exit $STATUS
