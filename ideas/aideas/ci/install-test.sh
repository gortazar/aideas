#!/usr/bin/env bash
# Run install.sh for real, from a clean directory, against the packed artefact.
#
#   ci/install-test.sh
#
# "An installer that was never executed is a guess." This executes it three ways — from a local
# zip, over HTTP from a served release asset (with a checksum), and through the GitHub releases
# API answered by a stub — and checks what landed on disk, that a second run is idempotent, and
# that --uninstall leaves nothing behind.
#
# Everything happens under a throwaway XDG_DATA_HOME, so the developer's real extensions
# directory is never touched. The one thing it cannot do is enable the extension, which needs a
# session; ci/smoke-test.sh covers that.
set -euo pipefail

cd "$(dirname "$0")/.."

UUID="aideas-shell@patxi.gortazar"

# --- isolation ---------------------------------------------------------------------------------
#
# XDG_DATA_HOME keeps the installed files out of the real extensions directory. Keeping the
# *settings* out of the real dconf database takes more than XDG_CONFIG_HOME, because the write is
# performed by the dconf service on the session bus, and that service uses the environment *it*
# was started with — so exporting XDG_CONFIG_HOME here and calling gsettings still writes the
# test's orchestrator address into the developer's own desktop. (It did, twice, before this
# block existed.) A private bus, started after the environment is switched, is what works; the
# same trap and the same fix as ci/nested-shell.sh.
#
# So: set up the environment, then re-exec under our own bus.
if [[ -z "${AIDEAS_INSTALL_TEST_WORK:-}" ]]; then
    command -v dbus-run-session >/dev/null 2>&1 ||
        { echo "dbus-run-session is required; run inside 'nix develop'." >&2; exit 2; }

    work=$(mktemp -d)
    real_dconf="${XDG_CONFIG_HOME:-$HOME/.config}/dconf/user"
    export AIDEAS_INSTALL_TEST_WORK="$work"
    export AIDEAS_REAL_DCONF="$real_dconf"
    export AIDEAS_REAL_DCONF_BEFORE="absent"
    [[ -f "$real_dconf" ]] &&
        export AIDEAS_REAL_DCONF_BEFORE="$(stat -c '%Y %s %i' "$real_dconf")"

    export XDG_DATA_HOME="$work/data"
    export XDG_CONFIG_HOME="$work/config"
    export XDG_CACHE_HOME="$work/cache"
    mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"

    exec dbus-run-session -- "$0" "$@"
fi

WORK="$AIDEAS_INSTALL_TEST_WORK"
REAL_DCONF="$AIDEAS_REAL_DCONF"
REAL_DCONF_BEFORE="$AIDEAS_REAL_DCONF_BEFORE"
EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"

SERVER_PID=""
cleanup() {
    [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

pass=0
fail=0
check() {
    if eval "$2"; then
        echo "  ok   $1"
        pass=$((pass + 1))
    else
        echo "  FAIL $1"
        echo "       condition: $2"
        fail=$((fail + 1))
    fi
}

echo "== packing the artefact"
for tool in zip unzip gsettings glib-compile-schemas python3; do
    command -v "$tool" >/dev/null 2>&1 ||
        { echo "$tool is not on PATH; run this inside 'nix develop'." >&2; exit 2; }
done
make pack >/dev/null
ZIP="build/$UUID.shell-extension.zip"
[[ -f "$ZIP" ]] || { echo "no artefact at $ZIP" >&2; exit 1; }
echo "   $ZIP ($(stat -c%s "$ZIP") bytes)"

# --- 1. from a local zip ---------------------------------------------------------------------
echo
echo "== from a local zip, into an empty XDG_DATA_HOME"
./install.sh --zip "$ZIP" --no-enable >"$WORK/local.log" 2>&1 ||
    { cat "$WORK/local.log"; echo "install.sh failed" >&2; exit 1; }

check "the extension directory exists" "[[ -d '$EXT_DIR' ]]"
check "extension.js is installed" "[[ -f '$EXT_DIR/extension.js' ]]"
check "prefs.js is installed" "[[ -f '$EXT_DIR/prefs.js' ]]"
check "the lib/ modules came along" "[[ -f '$EXT_DIR/lib/state.js' ]]"
check "the stylesheet came along" "[[ -f '$EXT_DIR/stylesheet.css' ]]"
check "the schema source is there" \
    "[[ -f '$EXT_DIR/schemas/org.gnome.shell.extensions.aideas.gschema.xml' ]]"
check "the schema was compiled" "[[ -f '$EXT_DIR/schemas/gschemas.compiled' ]]"
check "metadata names this uuid" "grep -q '$UUID' '$EXT_DIR/metadata.json'"
check "it reports the version it installed" "grep -q 'installed 0.1' '$WORK/local.log'"

# The settings have to be readable through the installed schema — that is what the panel and
# the preferences window both do first.
check "gsettings can read the installed schema" \
    "gsettings --schemadir '$EXT_DIR/schemas' get org.gnome.shell.extensions.aideas orchestrator-port | grep -q 8787"

# --- 2. idempotence and stale files -----------------------------------------------------------
echo
echo "== a second run is idempotent, and clears what a previous version left"
touch "$EXT_DIR/stale-from-an-older-version.js"
./install.sh --zip "$ZIP" --no-enable >"$WORK/again.log" 2>&1
check "still installed" "[[ -f '$EXT_DIR/extension.js' ]]"
check "the stale file is gone" "[[ ! -f '$EXT_DIR/stale-from-an-older-version.js' ]]"

# --- 3. the address pre-set from the environment -----------------------------------------------
echo
echo "== ORCHESTRATOR_HEARTBEAT_URL fills in the address"
rm -rf "$EXT_DIR"
dconf reset -f /org/gnome/shell/extensions/aideas/ 2>/dev/null || true
ORCHESTRATOR_HEARTBEAT_URL="http://10.8.0.1:8899/heartbeat" \
    ./install.sh --zip "$ZIP" --no-enable >"$WORK/env.log" 2>&1
host=$(gsettings --schemadir "$EXT_DIR/schemas" get org.gnome.shell.extensions.aideas orchestrator-host)
port=$(gsettings --schemadir "$EXT_DIR/schemas" get org.gnome.shell.extensions.aideas orchestrator-port)
check "the host came from the heartbeat URL" "[[ \"$host\" == \"'10.8.0.1'\" ]]"
check "so did the port" "[[ \"$port\" == '8899' ]]"

echo
echo "== a host you chose is never overwritten"
gsettings --schemadir "$EXT_DIR/schemas" set org.gnome.shell.extensions.aideas \
    orchestrator-host "my-own-box"
ORCHESTRATOR_HEARTBEAT_URL="http://10.8.0.1:8899/heartbeat" \
    ./install.sh --zip "$ZIP" --no-enable >>"$WORK/env.log" 2>&1
host=$(gsettings --schemadir "$EXT_DIR/schemas" get org.gnome.shell.extensions.aideas orchestrator-host)
check "the setting survived a re-install" "[[ \"$host\" == \"'my-own-box'\" ]]"

# --- 4. over HTTP, the way a user gets it ------------------------------------------------------
echo
echo "== over HTTP, from a served release asset with a checksum"
SERVE="$WORK/serve"
mkdir -p "$SERVE"
cp "$ZIP" "$SERVE/$UUID.shell-extension.zip"
(cd "$SERVE" && sha256sum "$UUID.shell-extension.zip" >"$UUID.shell-extension.zip.sha256")

# -u because the port is read out of this log: with stdout redirected to a file, Python buffers
# the "Serving HTTP on ... port N" line and the wait below times out on an empty file.
python3 -u -m http.server 0 --bind 127.0.0.1 --directory "$SERVE" >"$WORK/http.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
    PORT=$(sed -n 's/.*port \([0-9]*\).*/\1/p' "$WORK/http.log" | head -1)
    [[ -n "${PORT:-}" ]] && break
    sleep 0.2
done
[[ -n "${PORT:-}" ]] || { cat "$WORK/http.log"; echo "no http server" >&2; exit 1; }

rm -rf "$EXT_DIR"
./install.sh --url "http://127.0.0.1:$PORT/$UUID.shell-extension.zip" --no-enable \
    >"$WORK/http-install.log" 2>&1 || { cat "$WORK/http-install.log"; exit 1; }
check "downloaded and installed" "[[ -f '$EXT_DIR/extension.js' ]]"
check "the checksum was verified" "grep -q 'checksum verified' '$WORK/http-install.log'"

echo
echo "== a corrupted download is refused"
printf 'not a zip at all' >"$SERVE/broken.shell-extension.zip"
rm -rf "$EXT_DIR"
if ./install.sh --url "http://127.0.0.1:$PORT/broken.shell-extension.zip" --no-enable \
    >"$WORK/broken.log" 2>&1; then
    check "a corrupt artefact is rejected" "false"
else
    check "a corrupt artefact is rejected" "grep -q 'not a valid zip' '$WORK/broken.log'"
    check "and nothing was installed" "[[ ! -d '$EXT_DIR' ]]"
fi

echo
echo "== a zip that is some other extension is refused"
OTHER="$WORK/other"
mkdir -p "$OTHER"
unzip -qo "$ZIP" -d "$OTHER"
sed -i 's/"uuid": *"[^"]*"/"uuid": "someone-elses@example.com"/' "$OTHER/metadata.json"
(cd "$OTHER" && zip -qr "$SERVE/other.shell-extension.zip" .)
rm -rf "$EXT_DIR"
if ./install.sh --url "http://127.0.0.1:$PORT/other.shell-extension.zip" --no-enable \
    >"$WORK/other.log" 2>&1; then
    check "the wrong extension is rejected" "false"
else
    check "the wrong extension is rejected" "grep -q 'is not $UUID' '$WORK/other.log'"
fi

# --- 5. the releases API path -------------------------------------------------------------------
echo
echo "== the default path: asking the GitHub releases API"
mkdir -p "$SERVE/repos/gortazar/aideas"
cat >"$SERVE/repos/gortazar/aideas/releases" <<JSON
[
  {"tag_name": "some-other-idea-v9.9", "assets": [
    {"browser_download_url": "http://127.0.0.1:$PORT/download/some-other-idea-v9.9/other.zip"}]},
  {"tag_name": "aideas-shell-v0.1", "assets": [
    {"browser_download_url": "http://127.0.0.1:$PORT/aideas-shell-v0.1/$UUID.shell-extension.zip"}]}
]
JSON
mkdir -p "$SERVE/aideas-shell-v0.1"
cp "$ZIP" "$SERVE/aideas-shell-v0.1/$UUID.shell-extension.zip"

rm -rf "$EXT_DIR"
# The installer's API endpoint is derived from $OWNER_REPO; point its whole base at the stub.
sed "s|https://api.github.com|http://127.0.0.1:$PORT|" install.sh >"$WORK/install-stubbed.sh"
chmod +x "$WORK/install-stubbed.sh"
"$WORK/install-stubbed.sh" --no-enable >"$WORK/api.log" 2>&1 ||
    { cat "$WORK/api.log"; echo "the API path failed" >&2; exit 1; }
check "found the release asset through the API" "[[ -f '$EXT_DIR/extension.js' ]]"
check "and picked the aideas-shell tag, not another idea's release" \
    "grep -q 'aideas-shell-v0.1' '$WORK/api.log'"

# --- 6. uninstall --------------------------------------------------------------------------------
echo
echo "== uninstall leaves nothing behind"
./install.sh --uninstall >"$WORK/uninstall.log" 2>&1
check "the extension directory is gone" "[[ ! -d '$EXT_DIR' ]]"

# --- 7. a non-GNOME session ----------------------------------------------------------------------
echo
echo "== a non-GNOME session is refused politely"
if XDG_CURRENT_DESKTOP=KDE ./install.sh --zip "$ZIP" --no-enable >"$WORK/kde.log" 2>&1; then
    check "refuses on KDE" "false"
else
    check "refuses on KDE" "grep -q 'your session is KDE' '$WORK/kde.log'"
    check "and installs nothing" "[[ ! -d '$EXT_DIR' ]]"
fi

# --- 8. and none of it touched the real desktop ----------------------------------------------
echo
echo "== the developer's own dconf database is untouched"
REAL_DCONF_AFTER="absent"
[[ -f "$REAL_DCONF" ]] && REAL_DCONF_AFTER=$(stat -c '%Y %s %i' "$REAL_DCONF")
check "the real dconf database did not change" \
    "[[ '$REAL_DCONF_BEFORE' == '$REAL_DCONF_AFTER' ]]"
check "the settings went to the throwaway database instead" \
    "[[ -f '$XDG_CONFIG_HOME/dconf/user' ]]"

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
