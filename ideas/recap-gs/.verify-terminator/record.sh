#!/bin/sh
# U4 recorder: stands where `claude` would, and writes down the two things that can be
# wrong independently — the directory the terminal started in, and whether the whole
# command line survived (if -x took only one argument, $1 and $2 would be empty).
RECORD_FILE="$1"
shift
{
    echo "cwd=$(pwd)"
    echo "argc=$#"
    for a in "$@"; do echo "arg=$a"; done
} > "$RECORD_FILE"
sleep 6
