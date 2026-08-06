#!/usr/bin/env python3
"""How much window geometry control does an extension actually have under Wayland?

    tools/nested-shell.sh start --extension build/gnome-tasks@patxi.gortazar --state /tmp/gtp
    source /tmp/gtp/env
    tools/experiment-geometry.py

M3's biggest assumption is that Mutter honours move_resize_frame() for Wayland clients. The answer
turns out to be "partly", and which part matters: a size within the app's own limits is honoured, a
size outside them is clamped by the app, and position needs separating from size because the two
behave differently. This walks a matrix and prints what actually happened.

Runs against whatever nested session the environment points at, so it never touches the developer's
desktop. Needs org.gnome.Tasks.Shell on that bus, i.e. the real extension loaded.
"""
import json
import subprocess
import sys
import time

DEST = "org.gnome.Tasks.Shell"
PATH = "/org/gnome/Tasks/Shell"
APP = "org.gnome.Calculator.desktop"


def call(method, *args):
    result = subprocess.run(
        ["gdbus", "call", "--session", "--dest", DEST, "--object-path", PATH,
         "--method", f"{DEST}.{method}", *args],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{method} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def unwrap_json(reply):
    """gdbus prints ('<json>',) with inner quotes escaped."""
    if reply.startswith("('") and reply.endswith("',)"):
        reply = reply[2:-3]
    reply = reply.replace('\\"', '"').replace("\\'", "'")
    return json.loads(reply) if reply and reply != "null" else None


def windows():
    return unwrap_json(call("ListWindows"))["windows"]


def geometry_variant(x, y, width, height):
    return ("{'geometry': <{"
            f"'x': <int32 {x}>, 'y': <int32 {y}>, "
            f"'width': <int32 {width}>, 'height': <int32 {height}>"
            "}>}")


def find_calculator():
    for window in windows():
        if "Calculator" in window["appId"]:
            return window
    return None


def wait_for_calculator(timeout=120):
    """Wait for a Calculator window that has committed a buffer.

    A window with geometry None exists but has not been drawn yet (docs/gnome-internals.md); asking
    it to move at that point measures nothing.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        window = find_calculator()
        if window and window["geometry"]:
            return window
        time.sleep(2)
    return None


def place_and_measure(window_id, x, y, width, height, settle=2.5):
    call("PlaceWindow", window_id, geometry_variant(x, y, width, height))
    time.sleep(settle)
    report = unwrap_json(call("GetPlacementReport", window_id))
    return report["geometry"]


def describe(label, requested, geometry):
    applied = geometry.get("applied") or {}
    moved = (applied.get("x"), applied.get("y")) == (requested[0], requested[1])
    sized = (applied.get("width"), applied.get("height")) == (requested[2], requested[3])
    print(f"  {label}")
    print(f"    requested x={requested[0]} y={requested[1]} "
          f"{requested[2]}x{requested[3]}")
    print(f"    applied   x={applied.get('x')} y={applied.get('y')} "
          f"{applied.get('width')}x{applied.get('height')}")
    print(f"    position honoured: {moved}    size honoured: {sized}")
    return moved, sized


def main():
    print("== ensuring a Calculator window exists on the active workspace ==")
    window = find_calculator()
    if not window:
        call("LaunchApp", APP, "[]", "{}")
    window = wait_for_calculator()
    if not window:
        sys.exit("no Calculator window with geometry appeared; is the nested session healthy?")

    window_id = window["id"]
    print(f"   window {window_id} on workspace {window['workspaceIndex']}, "
          f"geometry {window['geometry']}")

    # Calculator is a GTK app with a minimum size, which is the point of the matrix: an app's own
    # constraints and the compositor's willingness are different things, and a single measurement
    # cannot tell them apart.
    matrix = [
        ("generous size, offset position", (300, 200, 600, 600)),
        ("below the app's minimum height", (50, 50, 400, 300)),
        ("large size at the origin", (0, 0, 800, 700)),
        ("move only (size left as-is)", (400, 300,
                                         window["geometry"]["width"],
                                         window["geometry"]["height"])),
    ]

    print("\n== on the ACTIVE workspace ==")
    results = []
    for label, requested in matrix:
        geometry = place_and_measure(window_id, *requested)
        results.append((label,) + describe(label, requested, geometry))

    print("\n== on an INACTIVE workspace ==")
    # A window the user cannot see may not get a configure event until it is shown, which would make
    # restore-then-switch behave differently from switch-then-restore.
    call("PlaceWindow", window_id, "{'workspace': <uint32 3>}")
    time.sleep(2)
    moved_window = find_calculator()
    print(f"   window is now on workspace {moved_window['workspaceIndex']}")
    geometry = place_and_measure(window_id, 120, 90, 640, 620)
    inactive = describe("resize while on another workspace", (120, 90, 640, 620), geometry)

    print("\n== verdict ==")
    any_position = any(moved for _, moved, _ in results)
    any_size = any(sized for _, _, sized in results)
    print(f"   position control on the active workspace: "
          f"{'WORKS' if any_position else 'DOES NOT WORK'}")
    print(f"   size control on the active workspace:     "
          f"{'WORKS (within the app’s own limits)' if any_size else 'DOES NOT WORK'}")
    print(f"   on an inactive workspace: position={inactive[0]} size={inactive[1]}")


if __name__ == "__main__":
    main()
