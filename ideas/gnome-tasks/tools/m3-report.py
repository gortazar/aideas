#!/usr/bin/env python3
"""Turn the raw D-Bus output collected by experiment-m3.sh into verdicts.

    m3-report.py <state-dir> <step>

Steps: windows | match | placement | placement2

Kept as a file rather than inline in the shell script because the reporting needs real string
formatting, and quoting Python inside a shell string is how the first version of this broke.
"""
import json
import re
import sys


def unwrap(path):
    """gdbus prints ('<payload>',) with the payload's quotes backslash-escaped."""
    try:
        raw = open(path, errors="replace").read().strip()
    except FileNotFoundError:
        return None
    if raw.startswith("('") and raw.endswith("',)"):
        raw = raw[2:-3]
    raw = raw.replace('\\"', '"').replace("\\'", "'")
    if not raw or raw == "null":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"   could not parse {path}: {error}")
        return None


def windows(state):
    data = unwrap(f"{state}/windows.txt")
    if not data:
        print("   no windows reported")
        return
    for w in data["windows"]:
        print(f'   {w["appId"]:<34} id={w["id"]:<12} startupId={w["startupId"]!r}')
        print(f'     geometry={w["geometry"]} workspace={w["workspaceIndex"]} '
              f'maximized={w["maximized"]} client={w["clientType"]}')


def match(state):
    text = open(f"{state}/shell.log", errors="replace").read()
    found = re.findall(r"gnome-tasks: launch-matched (\{.*?\})\s*$", text, re.MULTILINE)

    if not found:
        print("   VERDICT 1: NO MATCH — the window was never correlated to the launch.")
        print("   (restore would not know which window belongs to which slot)")
        return

    strategies = set()
    for raw in found:
        info = json.loads(raw)
        strategies.add(info.get("strategy"))
        print(f'   matched launch={info.get("launchId")} strategy={info.get("strategy")}')
        print(f'     token issued to app: {info.get("token")!r}')
        print(f'     token seen on window: {info.get("windowStartupId")!r}')

    if "token" in strategies:
        print("   VERDICT 1: activation tokens WORK — a launched window is identified exactly.")
    else:
        print(f"   VERDICT 1: the token did NOT come back on the window; matching fell back to "
              f"{sorted(strategies)}, which is a guess.")


def placement(state, name="placement.txt", label="2"):
    report = unwrap(f"{state}/{name}")
    if not report:
        print("   no placement report — the placement was never applied")
        print(f"   VERDICT {label}: NOT TESTED")
        return

    print(f'   workspace: {report.get("workspace")}')
    geometry = report.get("geometry")
    if not geometry:
        print(f"   VERDICT {label}: no geometry was requested")
        return

    print(f'   requested: {geometry["requested"]}')
    print(f'   applied:   {geometry.get("applied")}')
    if geometry.get("honoured") is None:
        print(f'   VERDICT {label}: UNKNOWN — {geometry.get("reason", "no verdict yet")}')
    elif geometry["honoured"]:
        print(f"   VERDICT {label}: Mutter HONOURS move_resize_frame() for this Wayland client.")
    else:
        print(f"   VERDICT {label}: geometry NOT honoured — placement degrades to workspace+monitor.")


def calculator_window_id(state):
    data = unwrap(f"{state}/windows.txt")
    if not data:
        return ""
    for w in data["windows"]:
        if w["appId"].startswith("org.gnome.Calculator"):
            return w["id"]
    return ""


if __name__ == "__main__":
    state, step = sys.argv[1], sys.argv[2]
    if step == "windows":
        windows(state)
    elif step == "match":
        match(state)
    elif step == "placement":
        placement(state)
    elif step == "placement2":
        placement(state, "placement2.txt", "2b")
    elif step == "window-id":
        print(calculator_window_id(state))
    else:
        sys.exit(f"unknown step: {step}")
