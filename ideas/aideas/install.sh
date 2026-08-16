#!/bin/sh
# Install the aideas GNOME Shell extension, without compiling anything.
#
#   curl -fsSL https://raw.githubusercontent.com/gortazar/aideas/main/ideas/aideas/install.sh | sh
#
# Downloads the packed extension from the latest aideas-shell release, installs it under
# ~/.local/share/gnome-shell/extensions/, compiles its settings schema, enables it, and — if
# ORCHESTRATOR_HEARTBEAT_URL is exported — fills in the orchestrator's address from it, so the
# one value you would otherwise have to type is one you already have.
#
# Options, all optional:
#   --zip PATH     install this local .shell-extension.zip instead of downloading
#   --url URL      download from here instead of asking GitHub for the latest release
#   --no-enable    install but do not enable
#   --uninstall    remove the extension and stop
#
# POSIX sh on purpose: this is the first thing a new machine runs, and it should not care
# which shell is installed.
set -eu

OWNER_REPO="${AIDEAS_REPO:-gortazar/aideas}"
UUID="aideas-shell@patxi.gortazar"
SCHEMA="org.gnome.shell.extensions.aideas"
TAG_PREFIX="aideas-shell-v"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

ZIP=""
URL=""
ENABLE=yes

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { printf 'aideas: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --zip) ZIP="${2:?--zip needs a path}"; shift 2 ;;
        --url) URL="${2:?--url needs a URL}"; shift 2 ;;
        --no-enable) ENABLE=no; shift ;;
        --uninstall) UNINSTALL=yes; shift ;;
        -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

need() {
    command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"
}

# The digest for our asset out of a SHA256SUMS file, or nothing.
#
# The name in the URL is percent-encoded (`aideas-shell%40patxi…`) while the name inside
# SHA256SUMS is not, so both spellings are tried. Failing that, a sums file listing exactly one
# `.shell-extension.zip` is unambiguous enough to use — a release publishes one extension.
checksum_from_sums() {
    sums="$1"
    encoded="${2##*/}"
    plain=$(printf '%s' "$encoded" | sed 's/%40/@/g; s/%2[bB]/+/g')

    found=$(awk -v a="$encoded" -v b="$plain" '$2 == a || $2 == b { print $1; exit }' "$sums")
    if [ -z "$found" ] &&
        [ "$(grep -c '\.shell-extension\.zip$' "$sums" 2>/dev/null || echo 0)" = "1" ]; then
        found=$(awk '/\.shell-extension\.zip$/ { print $1; exit }' "$sums")
    fi
    printf '%s' "$found"
}

# --- uninstall -------------------------------------------------------------------------------

if [ "${UNINSTALL:-no}" = yes ]; then
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions disable "$UUID" 2>/dev/null || true
    fi
    rm -rf "$EXT_DIR"
    say "aideas: removed $EXT_DIR"
    say "Your settings are kept; 'dconf reset -f /org/gnome/shell/extensions/aideas/' clears them."
    exit 0
fi

# --- is this even a GNOME machine? -----------------------------------------------------------
#
# Refusing politely beats installing something that can never run. A missing session is fine —
# installing over SSH before logging in is a reasonable thing to do — but a session that is
# demonstrably not GNOME is not.

if [ -n "${XDG_CURRENT_DESKTOP:-}" ]; then
    case "$XDG_CURRENT_DESKTOP" in
        *GNOME* | *gnome* | *Unity*) ;;
        *)
            die "this is a GNOME Shell extension and your session is $XDG_CURRENT_DESKTOP.
Nothing was installed. If you know what you are doing, unset XDG_CURRENT_DESKTOP and re-run."
            ;;
    esac
fi

if ! command -v gnome-shell >/dev/null 2>&1 && [ -z "${AIDEAS_ALLOW_NO_SHELL:-}" ]; then
    warn "aideas: gnome-shell is not on PATH — installing anyway, but nothing will load it."
fi

need unzip

# --- get the zip -----------------------------------------------------------------------------

WORK=$(mktemp -d)
# shellcheck disable=SC2064 # $WORK is expanded now on purpose: the trap must know the path.
trap "rm -rf '$WORK'" EXIT INT TERM

if [ -n "$ZIP" ]; then
    [ -f "$ZIP" ] || die "no such file: $ZIP"
    cp "$ZIP" "$WORK/extension.zip"
    say "aideas: installing from $ZIP"
else
    need curl
    if [ -z "$URL" ]; then
        say "aideas: looking for the latest $TAG_PREFIX release of $OWNER_REPO"
        # The releases list, newest first. Picking the newest tag with our prefix keeps this
        # working in a repository that releases several things: /releases/latest would happily
        # hand back some other idea's release.
        API="https://api.github.com/repos/$OWNER_REPO/releases?per_page=50"
        URL=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API" |
            tr ',{' '\n\n' |
            grep '"browser_download_url"' |
            sed 's/.*"browser_download_url": *"//; s/".*//' |
            grep "/$TAG_PREFIX" |
            grep '\.shell-extension\.zip$' |
            head -1) || true
        [ -n "$URL" ] || die "no $TAG_PREFIX release with a .shell-extension.zip asset found.
Check https://github.com/$OWNER_REPO/releases, or pass --url."
    fi
    say "aideas: downloading $URL"
    curl -fsSL --retry 3 -o "$WORK/extension.zip" "$URL" ||
        die "could not download $URL"

    # A checksum, if the release published one. Two shapes are accepted, because two exist:
    # `<asset>.sha256`, which the release workflow uploads, and `SHA256SUMS`, which the v0.1
    # release and the other ideas in this repo publish. Asking only for the first is what made
    # the one release that exists install without verifying anything.
    #
    # An absent checksum is not an error — the structural checks below still refuse anything
    # that is not this extension — but a checksum that is present and wrong stops the install.
    expected=""
    from=""
    if curl -fsSL --retry 2 -o "$WORK/asset.sha256" "$URL.sha256" 2>/dev/null; then
        expected=$(cut -d' ' -f1 <"$WORK/asset.sha256")
        from="${URL##*/}.sha256"
    elif curl -fsSL --retry 2 -o "$WORK/SHA256SUMS" "${URL%/*}/SHA256SUMS" 2>/dev/null; then
        expected=$(checksum_from_sums "$WORK/SHA256SUMS" "$URL")
        from="SHA256SUMS"
    fi

    case "$expected" in
        # A sha256 and nothing else. Anything shorter, longer or non-hex means the file was
        # not what it looked like, and is treated as no checksum at all rather than as a
        # mismatch — refusing to install over a malformed sums file would be a poor trade.
        [0-9a-fA-F][0-9a-fA-F]*)
            if [ "${#expected}" -ne 64 ]; then
                warn "aideas: $from does not hold a sha256 — installing without verifying"
                expected=""
            fi
            ;;
        *)
            [ -n "$expected" ] && warn "aideas: could not read a checksum from $from"
            expected=""
            ;;
    esac

    if [ -n "$expected" ] && command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$WORK/extension.zip" | cut -d' ' -f1)
        [ "$expected" = "$actual" ] ||
            die "checksum mismatch: $from says $expected, the download is $actual.
Refusing to install."
        say "aideas: checksum verified against $from"
    elif [ -z "$expected" ]; then
        say "aideas: no checksum published for this release — installing unverified"
    fi
fi

# --- verify it is what it claims to be -------------------------------------------------------

unzip -tqq "$WORK/extension.zip" >/dev/null 2>&1 || die "that file is not a valid zip"

mkdir -p "$WORK/bundle"
unzip -qo "$WORK/extension.zip" -d "$WORK/bundle"

[ -f "$WORK/bundle/metadata.json" ] || die "no metadata.json in the zip — not an extension"
[ -f "$WORK/bundle/extension.js" ] || die "no extension.js in the zip"
grep -q "\"$UUID\"" "$WORK/bundle/metadata.json" ||
    die "that zip is not $UUID. Refusing to install it."

VERSION=$(sed -n 's/.*"version-name" *: *"\([^"]*\)".*/\1/p' "$WORK/bundle/metadata.json")

# --- install ---------------------------------------------------------------------------------
#
# Replacing the directory wholesale, rather than copying over it, is what makes a re-run
# idempotent: a file dropped from a later version does not linger.

mkdir -p "$(dirname "$EXT_DIR")"
rm -rf "$EXT_DIR"
mv "$WORK/bundle" "$EXT_DIR"

if [ -d "$EXT_DIR/schemas" ] && command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas "$EXT_DIR/schemas"
fi

say "aideas: installed ${VERSION:-unknown version} to $EXT_DIR"

# --- pre-set the address ---------------------------------------------------------------------
#
# The laptop that talks to the orchestrator already exports ORCHESTRATOR_HEARTBEAT_URL for the
# heartbeat hook (see SETUP.md). Its host is the same host /state is on, so there is no reason
# to make anyone type it twice. Only ever fills in an *empty* setting: a value you chose is
# never overwritten.

settings_get() {
    gsettings --schemadir "$EXT_DIR/schemas" get "$SCHEMA" "$1" 2>/dev/null || echo ""
}

if command -v gsettings >/dev/null 2>&1 && [ -d "$EXT_DIR/schemas" ]; then
    current=$(settings_get orchestrator-host)
    if [ "$current" = "''" ] && [ -n "${ORCHESTRATOR_HEARTBEAT_URL:-}" ]; then
        # http://10.8.0.1:8787/heartbeat -> host 10.8.0.1, port 8787
        rest=${ORCHESTRATOR_HEARTBEAT_URL#*://}
        hostport=${rest%%/*}
        host=${hostport%%:*}
        port=${hostport#"$host"}
        port=${port#:}
        if [ -n "$host" ]; then
            gsettings --schemadir "$EXT_DIR/schemas" set "$SCHEMA" orchestrator-host "$host"
            say "aideas: orchestrator host set to $host, from ORCHESTRATOR_HEARTBEAT_URL"
            case "$port" in
                '' | *[!0-9]*) ;;
                *)
                    gsettings --schemadir "$EXT_DIR/schemas" set "$SCHEMA" orchestrator-port "$port"
                    say "aideas: orchestrator port set to $port"
                    ;;
            esac
        fi
    fi
fi

# --- enable ----------------------------------------------------------------------------------

if [ "$ENABLE" = yes ] && command -v gnome-extensions >/dev/null 2>&1; then
    if gnome-extensions enable "$UUID" 2>/dev/null; then
        say "aideas: enabled"
    else
        warn "aideas: could not enable it yet (no session on this bus?)."
        warn "        Run: gnome-extensions enable $UUID"
    fi
fi

say ""
say "Done. On Wayland the Shell has to be restarted to load new extension code:"
say "  log out and back in (X11: Alt+F2, r, Enter)."
say ""
if [ -z "${ORCHESTRATOR_HEARTBEAT_URL:-}" ]; then
    say "Then set the orchestrator's address:"
    say "  gnome-extensions prefs $UUID"
else
    say "Then check it can reach the box: gnome-extensions prefs $UUID -> Test connection"
fi
