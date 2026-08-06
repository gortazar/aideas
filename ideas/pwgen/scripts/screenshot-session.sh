#!/usr/bin/env bash
# Runs inside dbus-run-session, started by scripts/screenshot.sh. Boots the nested
# shell and waits for the appended hook to drive the extension and write the PNGs.
# The captures happen inside the shell (see scripts/screenshot-hook.js), so there is
# nothing to do here but supervise and report.
# Expects $UUID, $LOG and $PWGEN_SCREENSHOT_DIR in the environment.
set -euo pipefail

: "${UUID:?}" "${LOG:?}" "${PWGEN_SCREENSHOT_DIR:?}"

SHELL_BUS=(--session --dest org.gnome.Shell --object-path /org/gnome/Shell)
shell_up() { gdbus introspect "${SHELL_BUS[@]}" >/dev/null 2>&1; }

# metadata.json lists only verified shell versions, so a newer shell would report
# OUT_OF_DATE and never run the extension.
gsettings set org.gnome.shell disable-extension-version-validation true
gsettings set org.gnome.shell enabled-extensions "['$UUID']"

# --no-x11: a container or sandbox may have no writable /tmp/.X11-unix, and
# Xwayland failing to start takes the whole shell down. Nothing here needs X.
gnome-shell --headless --no-x11 --virtual-monitor 1280x720 >"$LOG" 2>&1 &
SHELL_PID=$!

cleanup() {
    kill "$SHELL_PID" 2>/dev/null || return 0
    for _ in $(seq 1 10); do
        kill -0 "$SHELL_PID" 2>/dev/null || return 0
        sleep 1
    done
    kill -9 "$SHELL_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
    shell_up && break
    kill -0 "$SHELL_PID" 2>/dev/null || { echo "shell exited during startup" >&2; exit 1; }
    sleep 1
done
shell_up || { echo "shell never took its bus name" >&2; exit 1; }

info=$(gdbus call "${SHELL_BUS[@]}" \
    --method org.gnome.Shell.Extensions.GetExtensionInfo "$UUID")
echo "extension info: $info"
# GetExtensionInfo reports differently across builds: some include 'state' (1 is
# ENABLED), others only the 'enabled' boolean plus an 'error' string. Accept either
# rather than assuming the shape of one distribution's shell.
state=$(sed -n "s/.*'state': <\([0-9.]*\)>.*/\1/p" <<<"$info")
error=$(sed -n "s/.*'error': <'\([^']*\)'>.*/\1/p" <<<"$info")
case "$state" in
    1|1.0)
        echo "extension state: ENABLED"
        ;;
    "")
        if [[ "$info" == *"'enabled': <true>"* ]] && [ -z "$error" ]; then
            echo "extension state: enabled (no 'state' field in this shell build)"
        else
            echo "extension is not enabled: ${error:-no state and enabled is not true}" >&2
            exit 1
        fi
        ;;
    *)
        echo "extension is not enabled (state=$state) ${error}" >&2
        exit 1
        ;;
esac

# The hook works through menu -> generate -> shoot -> preferences -> shoot, with
# waits for layout and window mapping in between, so allow it a while.
for _ in $(seq 1 60); do
    grep -qE "PWGEN_SCREENSHOT result=(done|threw|no-)" "$LOG" && break
    kill -0 "$SHELL_PID" 2>/dev/null || { echo "shell died mid-capture" >&2; exit 1; }
    sleep 1
done

sed -n 's/.*PWGEN_SCREENSHOT \(result=.*\)/  hook: \1/p' "$LOG"
if ! grep -q "PWGEN_SCREENSHOT result=done" "$LOG"; then
    echo "the hook did not finish; see the shell log" >&2
    exit 1
fi

for shot in menu.png preferences.png; do
    [ -s "$PWGEN_SCREENSHOT_DIR/$shot" ] || {
        echo "missing or empty screenshot: $shot" >&2
        exit 1
    }
done
