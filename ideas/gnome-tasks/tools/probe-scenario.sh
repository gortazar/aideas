#!/usr/bin/env bash
# Drive a realistic desktop inside a nested Shell and harvest what the probe saw.
#
#   tools/nested-shell.sh start --extension tools/probe --state /tmp/gtn
#   tools/probe-scenario.sh --state /tmp/gtn --out docs/probe-data/session.jsonl
#
# One app per capability question, chosen to cover the client types that behave differently:
#
#   gnome-text-editor  GTK4/libadwaita, opened with a document  -> is the document recoverable?
#   gnome-calculator   GTK4, no document at all                 -> the tier-0 baseline
#   nautilus           GTK4, document is a directory
#   gnome-terminal     client/server split: the window belongs to a server process, so the
#                      window PID is not the shell's PID                 -> the terminal problem
#   xterm / xclock     XWayland, i.e. an X11 client seen through Mutter
#   firefox            multi-document, no per-window document on the command line
#   codium             Electron, single-instance, opened with a folder
#   libreoffice        snap-confined, single-instance, opened with a document
#
# Apps that are not installed are skipped and reported, so the harvest says what it covers.
set -euo pipefail

STATE="${GNOME_TASKS_NESTED_STATE:-/tmp/gnome-tasks-nested}"
OUT=""
SETTLE=6

while [[ $# -gt 0 ]]; do
    case "$1" in
        --state) STATE="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --settle) SETTLE="$2"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

[[ -f "$STATE/env" ]] || { echo "no nested session at $STATE — run tools/nested-shell.sh start" >&2; exit 1; }
# shellcheck source=/dev/null
source "$STATE/env"

# Under $HOME, not under $STATE: snap-confined apps (firefox, codium, libreoffice on Ubuntu)
# get a private /tmp, so a document in /tmp/... simply does not exist as far as they are
# concerned — and the app then opens an empty window, which looks exactly like "the document
# could not be recovered". Scratch state for those apps has to live here too.
DOCS="$HOME/.cache/gnome-tasks-probe/docs"
SCRATCH="$HOME/.cache/gnome-tasks-probe/scratch"
rm -rf "$SCRATCH"
mkdir -p "$DOCS/project" "$SCRATCH"
printf 'gnome-tasks probe document\nsecond line\n' >"$DOCS/notes.txt"
printf '# probe project\n' >"$DOCS/project/README.md"

skipped=()

launch_desktop() {
    local desktop="$1"; shift
    local path
    for dir in /usr/share/applications /var/lib/snapd/desktop/applications \
               "$HOME/.local/share/applications"; do
        if [[ -f "$dir/$desktop" ]]; then path="$dir/$desktop"; break; fi
    done
    if [[ -z "${path:-}" ]]; then skipped+=("$desktop"); return 0; fi
    echo "launching $desktop $*" >&2
    # gio launch goes through GDesktopAppInfo, i.e. the same path the daemon will use, so the
    # startup-notification behaviour observed here is the behaviour that matters.
    gio launch "$path" "$@" >/dev/null 2>&1 || echo "  (launch reported failure)" >&2
    sleep "$SETTLE"
}

launch_exec() {
    local binary="$1"; shift
    if ! command -v "$binary" >/dev/null; then skipped+=("$binary"); return 0; fi
    echo "launching $binary $*" >&2
    setsid "$binary" "$@" >/dev/null 2>&1 &
    sleep "$SETTLE"
}

launch_desktop org.gnome.TextEditor.desktop "$DOCS/notes.txt"
launch_desktop org.gnome.Calculator.desktop
launch_desktop org.gnome.Nautilus.desktop "$DOCS/project"
launch_desktop org.gnome.Terminal.desktop
# xterm's -e takes a command, not a shell line, so the shell has to be explicit. X11 clients
# additionally need the nested Xwayland to be reachable, which it currently is not — see
# docs/gnome-internals.md; X11 is out of scope for gnome-tasks anyway.
launch_exec xterm -e sh -c 'cd /tmp && exec sleep 600'
launch_exec xclock

# Browsers and Electron apps hand a second launch to the instance that is already running —
# which, on a developer machine, is the developer's own browser on their own desktop. --no-remote
# (not --new-instance, which is not enough) is what forces a separate instance into the nested
# session; without it this scenario opens tabs in the user's real browser.
if command -v firefox >/dev/null; then
    echo "launching firefox (isolated profile, --no-remote)" >&2
    setsid firefox --no-remote --profile "$SCRATCH/ff-profile" \
        "https://example.com/" >/dev/null 2>&1 &
    sleep $((SETTLE * 3))
else
    skipped+=("firefox")
fi

if command -v codium >/dev/null; then
    echo "launching codium (isolated user-data-dir)" >&2
    setsid codium --user-data-dir "$SCRATCH/codium" --extensions-dir "$SCRATCH/codium-ext" \
        --new-window "$DOCS/project" >/dev/null 2>&1 &
    sleep $((SETTLE * 3))
else
    skipped+=("codium")
fi

if command -v libreoffice >/dev/null; then
    echo "launching libreoffice writer" >&2
    setsid libreoffice -env:UserInstallation="file://$SCRATCH/lo" \
        --writer "$DOCS/notes.txt" >/dev/null 2>&1 &
    sleep $((SETTLE * 4))
else
    skipped+=("libreoffice")
fi

echo "settling" >&2
sleep "$SETTLE"

if [[ ${#skipped[@]} -gt 0 ]]; then
    echo "SKIPPED (not installed): ${skipped[*]}" >&2
fi

harvest() {
    grep -a 'GT-PROBE ' "$STATE/shell.log" | sed -e 's/^.*GT-PROBE //'
}

if [[ -n "$OUT" ]]; then
    mkdir -p "$(dirname "$OUT")"
    harvest >"$OUT"
    echo "wrote $(wc -l <"$OUT") probe records to $OUT" >&2
else
    harvest
fi
