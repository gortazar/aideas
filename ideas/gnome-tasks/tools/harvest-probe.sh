#!/usr/bin/env bash
# Harvest the probe's JSON lines out of the journal.
#
#   tools/harvest-probe.sh [--since "10 min ago"] [out.jsonl]
#
# Writes one JSON object per line. Pipe through jq to answer a specific question, e.g.
#   jq -r 'select(.event=="window-created") | .window.getters.get_wm_class' probe.jsonl
set -euo pipefail

SINCE="today"
if [[ ${1:-} == "--since" ]]; then
    SINCE="$2"
    shift 2
fi
OUT="${1:-}"

harvest() {
    journalctl --user --no-pager --since "$SINCE" -o cat |
        grep -a 'GT-PROBE ' |
        sed -e 's/^.*GT-PROBE //'
}

if [[ -n "$OUT" ]]; then
    harvest >"$OUT"
    echo "wrote $(wc -l <"$OUT") probe lines to $OUT" >&2
else
    harvest
fi
