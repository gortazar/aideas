#!/usr/bin/env bash
# The two experiments M3 rests on, run against a real compositor.
#
#   tools/experiment-m3.sh [--state DIR] [--app DESKTOP-ID] [--keep]
#
# 1. ACTIVATION TOKENS. Does a window launched through the Shell's own launch context come back
#    carrying the token we issued — i.e. can restore tell *which* launch a window belongs to?
#    Verdict: which matching strategy actually fired (token / app-id / pid / none).
#
# 2. WAYLAND GEOMETRY. Does Mutter honour move_resize_frame() for a Wayland client when an
#    extension asks? Verdict: requested vs applied frame rect, both at launch time and for an
#    already-open window.
#
# 3. CLOSE. Does Meta.Window.delete() actually close a window, so the "close" deactivation policy
#    is implementable?
#
# Everything runs inside a nested headless Shell, so the experiment is repeatable and touches
# nothing on the developer's desktop. Reporting lives in tools/m3-report.py.
set -euo pipefail

STATE="${GNOME_TASKS_NESTED_STATE:-/tmp/gnome-tasks-m3}"
KEEP=0
APP="org.gnome.Calculator.desktop"
WANT_X=200 WANT_Y=150 WANT_W=700 WANT_H=480
WANT_WORKSPACE=2

while [[ $# -gt 0 ]]; do
    case "$1" in
        --state) STATE="$2"; shift 2 ;;
        --app) APP="$2"; shift 2 ;;
        --keep) KEEP=1; shift ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

cleanup() {
    [[ $KEEP -eq 1 ]] && return
    tools/nested-shell.sh stop --state "$STATE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

shell_call() {
    local method="$1"; shift
    gdbus call --session --dest org.gnome.Tasks.Shell \
        --object-path /org/gnome/Tasks/Shell \
        --method "org.gnome.Tasks.Shell.$method" "$@"
}

report() {
    python3 tools/m3-report.py "$STATE" "$1"
}

echo "== building and booting a nested Shell =="
make build >/dev/null
tools/nested-shell.sh stop --state "$STATE" >/dev/null 2>&1 || true
tools/nested-shell.sh start --extension "build/gnome-tasks@patxi.gortazar" --state "$STATE" |
    sed 's/^/   /'
# shellcheck source=/dev/null
source "$STATE/env"
sleep 3

echo
echo "== experiment 1: launch $APP with an activation token and a placement =="
LAUNCH_ID=$(shell_call LaunchApp "$APP" '[]' \
    "{'workspace': <uint32 $WANT_WORKSPACE>, 'geometry': <{'x': <int32 $WANT_X>, 'y': <int32 $WANT_Y>, 'width': <int32 $WANT_W>, 'height': <int32 $WANT_H>}>}" |
    sed "s/[(',)]//g" | tr -d ' ')
echo "   launch id: $LAUNCH_ID"
echo "   requested: workspace $WANT_WORKSPACE, ${WANT_W}x${WANT_H} at +${WANT_X}+${WANT_Y}"

# Poll rather than sleep a fixed amount: a cold app start in a headless session was measured at
# ~30 s, and a fixed wait is how the first version of this experiment concluded "no window appeared".
echo "   waiting for the window (up to 90s)"
WAITED=0
for _ in $(seq 1 45); do
    shell_call ListWindows >"$STATE/windows.txt" 2>/dev/null || true
    if grep -q Calculator "$STATE/windows.txt" 2>/dev/null; then
        echo "   window appeared after ~${WAITED}s"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done
# Let identification and placement settle.
sleep 3
shell_call ListWindows >"$STATE/windows.txt"

echo
echo "== windows now present =="
report windows

WINDOW_ID=$(report window-id)
if [[ -z "$WINDOW_ID" ]]; then
    echo
    echo "VERDICT 1: no window appeared — the app failed to launch in the nested session."
    echo "VERDICT 2: not tested (no window)."
    exit 1
fi

echo
echo "== experiment 1 verdict: did the launch match, and how? =="
report match

echo
echo "== experiment 2: what the compositor did with the placement asked for at launch =="
sleep 2
shell_call GetPlacementReport "$WINDOW_ID" >"$STATE/placement.txt"
report placement

echo
echo "== experiment 2b: placing an already-open window (restore path for a running app) =="
shell_call PlaceWindow "$WINDOW_ID" \
    "{'geometry': <{'x': <int32 40>, 'y': <int32 60>, 'width': <int32 500>, 'height': <int32 400>}>}" |
    sed 's/^/   PlaceWindow returned /'
# A Wayland resize is a negotiation: configure, then the client commits. Give it time before asking
# what happened, or the answer is always "unchanged".
sleep 3
shell_call GetPlacementReport "$WINDOW_ID" >"$STATE/placement2.txt"
report placement2

echo
echo "== experiment 3: does delete() close a window? =="
shell_call CloseWindow "$WINDOW_ID" >/dev/null
sleep 3
shell_call ListWindows >"$STATE/windows-after-close.txt"
if grep -q Calculator "$STATE/windows-after-close.txt"; then
    echo "   VERDICT 3: the window is STILL open — delete() did not close it."
else
    echo "   VERDICT 3: delete() closed the window; the 'close' policy is implementable."
fi

echo
echo "== extension log (last lines) =="
grep -a 'gnome-tasks' "$STATE/shell.log" | tail -6 | sed 's/^/   /' || echo "   (nothing logged)"
