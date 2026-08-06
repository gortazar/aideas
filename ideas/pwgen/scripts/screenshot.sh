#!/usr/bin/env bash
# Regenerates screenshots/ from the sources in upstream/.
#
# Everything happens in a throwaway GNOME Shell: a nested headless compositor with
# its own session bus, virtual monitor and HOME. Your own session is never touched
# -- no extension is installed into it, nothing is enabled in it, and it is not the
# thing being photographed.
#
# Requires gnome-shell, glib-compile-schemas, dbus-run-session and gdbus, i.e. a
# machine with GNOME available. `nix develop` does not provide gnome-shell (the
# closure is about a gigabyte), so this runs against the system one.
#
# Usage: scripts/screenshot.sh [--keep-log]
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
IDEA_DIR="$PWD"
SRC="$IDEA_DIR/upstream"
SHOTS="$IDEA_DIR/screenshots"
UUID="pwgen-generator@pwgen-gs.patxi"

keep_log=""
[ "${1:-}" = "--keep-log" ] && keep_log=1

for tool in gnome-shell glib-compile-schemas dbus-run-session gdbus; do
    command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }
done
[ -f "$SRC/extension.js" ] || {
    echo "upstream/ is empty — run: git submodule update --init" >&2
    exit 1
}
if [ "$(id -u)" = 0 ]; then
    echo "refusing to run as root: mutter will not start" >&2
    exit 1
fi

WORK="$(mktemp -d)"
LOG="$WORK/shell.log"
export HOME="$WORK/home"
export XDG_RUNTIME_DIR="$WORK/run"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export LC_ALL=C
cleanup() {
    local status=$?
    if [ -n "$keep_log" ] && [ -f "$LOG" ]; then
        cp "$LOG" "$IDEA_DIR/screenshot-shell.log"
        echo "shell log kept at $IDEA_DIR/screenshot-shell.log"
    fi
    # Tidying up must not decide the exit status. The document portal mounts a
    # FUSE filesystem at $XDG_RUNTIME_DIR/doc that rm cannot remove, and session
    # services outliving the shell can recreate directories under $HOME while rm
    # walks it. Neither means the capture failed; what is left is a dir in /tmp.
    fusermount -u "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
    rm -rf "$WORK" 2>/dev/null || true
    return $status
}
trap cleanup EXIT

say() { printf '\n=== %s\n' "$*"; }

say "GNOME Shell version"
gnome-shell --version

say "Installing the extension into the throwaway session"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR/schemas" "$EXT_DIR/lib"
cp "$SRC/extension.js" "$SRC/prefs.js" "$SRC/metadata.json" "$EXT_DIR/"
cp "$SRC"/lib/*.js "$EXT_DIR/lib/"
cp "$SRC"/schemas/*.gschema.xml "$EXT_DIR/schemas/"
glib-compile-schemas "$EXT_DIR/schemas"
cat "$IDEA_DIR/scripts/screenshot-hook.js" >> "$EXT_DIR/extension.js"

mkdir -p "$SHOTS"
export UUID LOG PWGEN_SCREENSHOT=1 PWGEN_SCREENSHOT_DIR="$SHOTS"

say "Running the nested shell"
dbus-run-session -- "$IDEA_DIR/scripts/screenshot-session.sh"

say "Done"
ls -la "$SHOTS"
