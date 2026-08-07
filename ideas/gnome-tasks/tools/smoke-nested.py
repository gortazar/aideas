#!/usr/bin/env python3
"""End-to-end smoke test: the real extension and the real daemon, in a real compositor.

    tools/nested-shell.sh start --extension build/gnome-tasks@patxi.gortazar --state /tmp/gts
    source /tmp/gts/env
    GNOME_TASKS_DATA_DIR=/tmp/gts/tasks gjs -m src/daemon/main.js &
    tools/smoke-nested.py

The unit and D-Bus suites cover the logic and the protocol; this covers the thing they cannot — that
the two processes, plus Mutter, plus a real application, actually produce the behaviour the idea is
about:

    a task remembers the app you opened, switching away closes it, switching back brings it back.

Prints a verdict per step and exits non-zero if any of them failed.
"""
import json
import os
import subprocess
import sys
import time

APP = "org.gnome.Calculator.desktop"
DOCUMENT_APP = "org.gnome.TextEditor.desktop"
DOCUMENT_DIR = os.path.expanduser("~/.cache/gnome-tasks-smoke")
DOCUMENT = os.path.join(DOCUMENT_DIR, "notes.txt")

failures = []


def gdbus(dest, path, iface, method, *args):
    result = subprocess.run(
        ["gdbus", "call", "--session", "--dest", dest, "--object-path", path,
         "--method", f"{iface}.{method}", *args],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{method} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def tasks(method, *args):
    return gdbus("org.gnome.Tasks", "/org/gnome/Tasks", "org.gnome.Tasks", method, *args)


def shell(method, *args):
    return gdbus("org.gnome.Tasks.Shell", "/org/gnome/Tasks/Shell",
                 "org.gnome.Tasks.Shell", method, *args)


def unwrap_string(reply):
    """('value',) -> value"""
    if reply.startswith("('") and reply.endswith("',)"):
        return reply[2:-3]
    return reply.strip("(),'")


def unwrap_json(reply):
    # gdbus prints the payload with every escape intact, and GetTask's payload is pretty-printed
    # JSON — so \n has to be decoded too, not just \".
    raw = unwrap_string(reply).encode("utf-8", "surrogateescape").decode("unicode_escape")
    return json.loads(raw) if raw and raw != "null" else None


def current_task():
    reply = gdbus("org.gnome.Tasks", "/org/gnome/Tasks",
                  "org.freedesktop.DBus.Properties", "Get",
                  "org.gnome.Tasks", "CurrentTask")
    # (<'uuid'>,)
    return reply.strip("(),").strip("<>").strip("'")


def windows_of(app_fragment):
    data = unwrap_json(shell("ListWindows"))
    return [w for w in data["windows"] if app_fragment in w["appId"]]


def calculator_windows():
    return windows_of("Calculator")


def wait_for(predicate, what, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(2)
    print(f"   TIMED OUT waiting for {what} ({timeout}s)")
    return False


def check(label, ok):
    print(f"   {'PASS' if ok else 'FAIL'}: {label}")
    if not ok:
        failures.append(label)


def main():
    print("== step 1: the daemon and the extension can see each other ==")
    print(f"   daemon: {unwrap_string(tasks('Ping', 'hello'))}")
    print(f"   shell:  {unwrap_string(shell('Ping', 'hello'))}")

    print("\n== step 2: create a task that closes its windows on switch-away ==")
    work = unwrap_string(tasks("CreateTask", "Work", "folder-symbolic"))
    other = unwrap_string(tasks("CreateTask", "Other", ""))
    tasks("SetTaskProperties", work, "{'deactivate-policy': <'close'>}")
    print(f"   Work={work}\n   Other={other}")

    tasks("ActivateTask", work)
    time.sleep(2)
    check("Work is the current task", current_task() == work)

    print("\n== step 3: the user opens an application while Work is current ==")
    shell("LaunchApp", APP, "[]", "{}")
    ok = wait_for(lambda: bool(calculator_windows()), "the Calculator window")
    check("Calculator opened in the nested session", ok)

    print("\n== step 4: the daemon captures it into Work, without being asked ==")
    # Capture is debounced ~2s after the compositor reports the change.
    captured = wait_for(
        lambda: any(app["appId"] == APP
                    for app in (unwrap_json(tasks("GetTask", work)) or {}).get("apps", [])),
        "Work to remember the Calculator", timeout=40)
    check("Work remembers the application the user opened", captured)

    document = unwrap_json(tasks("GetTask", work)) or {}
    for app in document.get("apps", []):
        print(f"   remembered: {app['appId']} at {app['placement'].get('geometry')} "
              f"on workspace {app['placement'].get('workspace')}")

    print("\n== step 5: switching away applies the close policy ==")
    tasks("ActivateTask", other)
    closed = wait_for(lambda: not calculator_windows(), "the Calculator to close", timeout=40)
    check("switching away closed Work's windows", closed)

    print("\n== step 6: switching back restores what Work remembered ==")
    tasks("ActivateTask", work)
    restored = wait_for(lambda: bool(calculator_windows()),
                        "the Calculator to come back", timeout=90)
    check("switching back relaunched the application", restored)

    if restored:
        window = calculator_windows()[0]
        remembered = document["apps"][0]["placement"]
        print(f"   remembered geometry: {remembered.get('geometry')}")
        print(f"   restored geometry:   {window['geometry']}")

    print("\n== step 7: a document is remembered and reopened (tier 1) ==")
    os.makedirs(DOCUMENT_DIR, exist_ok=True)
    with open(DOCUMENT, "w") as handle:
        handle.write("a document restored by gnome-tasks\n")

    docs_task = unwrap_string(tasks("CreateTask", "Documents", ""))
    tasks("SetTaskProperties", docs_task, "{'deactivate-policy': <'close'>}")
    tasks("ActivateTask", docs_task)
    time.sleep(2)

    shell("LaunchApp", DOCUMENT_APP, f"['file://{DOCUMENT}']", "{}")
    opened = wait_for(lambda: bool(windows_of("TextEditor")), "the text editor")
    check("the text editor opened with the document", opened)

    remembered = wait_for(
        lambda: any(app.get("documents")
                    for app in (unwrap_json(tasks("GetTask", docs_task)) or {}).get("apps", [])),
        "the document to be captured", timeout=40)
    check("the document was captured from the application's command line", remembered)

    captured = unwrap_json(tasks("GetTask", docs_task)) or {}
    for app in captured.get("apps", []):
        print(f"   remembered: {app['appId']} documents={app['documents']}")

    tasks("ActivateTask", other)
    wait_for(lambda: not windows_of("TextEditor"), "the editor to close", timeout=40)

    tasks("ActivateTask", docs_task)
    back = wait_for(lambda: bool(windows_of("TextEditor")), "the editor to come back", timeout=90)
    check("the editor was relaunched", back)
    if back:
        title = windows_of("TextEditor")[0]["title"]
        print(f"   restored window title: {title}")
        check("the restored window shows the same document", "notes.txt" in title)

    for window in windows_of("TextEditor"):
        shell("CloseWindow", window["id"])
    tasks("StopTask", docs_task)
    tasks("DeleteTask", docs_task)

    print("\n== step 8: the preferences window builds against the live daemon ==")
    # The preferences process only exists inside a GNOME session, so this is the only place it can be
    # exercised at all. It needs a display, which the nested session has.
    preview = subprocess.run(
        ["gjs", "-m", "tools/prefs-preview.js"],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "GNOME_TASKS_PREVIEW_SECONDS": "3"})
    output = preview.stdout + preview.stderr
    print("   " + output.strip().replace("\n", "\n   "))
    check("the preferences window built without errors",
          preview.returncode == 0 and "preferences window built" in output)
    check("the preferences window saw the daemon's tasks", "daemon available: true" in output)

    print("\n== cleanup ==")
    for window in calculator_windows():
        shell("CloseWindow", window["id"])
    tasks("StopTask", work)
    tasks("DeleteTask", work)
    tasks("DeleteTask", other)
    try:
        os.remove(DOCUMENT)
        os.rmdir(DOCUMENT_DIR)
    except OSError:
        pass
    print("   tasks deleted")

    print("\n== verdict ==")
    if failures:
        print(f"   {len(failures)} step(s) failed: {failures}")
        sys.exit(1)
    print("   the whole loop works: remember (including the open document), close on switch-away,")
    print("   restore on switch-back with the same document and geometry")


if __name__ == "__main__":
    main()
