#!/usr/bin/env bash
# The orchestrator's version is held twice: `ORCHESTRATOR_VERSION` in orchestrator.py, and
# `version:` in this idea's STATUS.md. The release workflow tags `orchestrator-v<STATUS version>`
# and the tarball carries the code's own constant, so if the two drift the release lies about
# what it contains. This asserts they agree — the same job ideas/pwgen/scripts/check-pin.sh
# does for a submodule pin against a flake input.
#
#   ideas/orchestrator/scripts/check-version.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

status_version="$(sed -n 's/^version:[[:space:]]*//p' ideas/orchestrator/STATUS.md | head -1)"
code_version="$(sed -n 's/^ORCHESTRATOR_VERSION = "\(.*\)"$/\1/p' orchestrator/orchestrator.py | head -1)"

[ -n "$status_version" ] || { echo "no version: in ideas/orchestrator/STATUS.md" >&2; exit 1; }
[ -n "$code_version" ] || { echo "no ORCHESTRATOR_VERSION in orchestrator/orchestrator.py" >&2; exit 1; }

echo "STATUS.md version       -> $status_version"
echo "ORCHESTRATOR_VERSION    -> $code_version"

if [ "$status_version" != "$code_version" ]; then
    echo "FAIL: the two versions disagree; the release would be tagged orchestrator-v$status_version" \
         "but carry code declaring $code_version." >&2
    exit 1
fi
echo "PASS: both say $status_version"
