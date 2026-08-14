#!/usr/bin/env python3
"""The compositor smoke test's assertions, run inside a nested GNOME Shell session.

Called by ci/smoke-test.sh, which has already built the bundle, started two stub /state servers
(one reporting a running cycle, one an idle box with a blocked idea), booted a headless Shell on
a private bus with the extension and the probe installed, and exported that session's
environment. This script drives the probe over gdbus and checks what a user would see.

What it proves that no headless test can:

  * the extension loads into a real Shell and builds a real panel button
  * the button is visible while a cycle is running, with the right icon, badge and a11y name
  * the menu opens and reads back as the sections and rows the model asked for, with every row
    inert and Preferences the only thing that reacts
  * the button disappears when the cycle stops — the answered open question — and "always show"
    brings it back with the idle wording
  * a box that goes away leaves the button up briefly with the unreachable icon and the last
    good reading beneath it, then the menu says so
  * five enable/disable rounds leave one button and no timer: the stub's request count stops
    dead after the last disable, which is what a leaked timer would disturb
  * screenshots, for README.md

Moving between states is done by pointing the extension's port setting at one stub or the other,
or at a port with nothing on it. Nothing here restarts the Shell.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROBE = ("gdbus", "call", "--session",
         "--dest", "org.gnome.AideasProbe",
         "--object-path", "/org/gnome/AideasProbe",
         "--method")

SCHEMA = "org.gnome.shell.extensions.aideas"

failures = []
checks = 0


def check(condition, description, detail=""):
    global checks
    checks += 1
    if condition:
        print(f"  ok   {description}")
    else:
        print(f"  FAIL {description}")
        if detail:
            print(f"       {detail}")
        failures.append(description)
    return bool(condition)


def probe(method, *args):
    """Call a probe method and return its single string return value."""
    result = subprocess.run([*PROBE, f"org.gnome.AideasProbe.{method}", *args],
                            capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"{method} failed: {result.stderr.strip()}")
    out = result.stdout.strip()
    # gdbus prints ('the value',); the payload is JSON or a short word.
    if out.startswith("('") and out.endswith("',)"):
        return out[2:-3].encode().decode("unicode_escape")
    return out


def describe():
    return json.loads(probe("Describe"))


def served(port):
    """How many /state reads that stub has answered."""
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/requests", timeout=10) as response:
        return json.load(response)["count"]


class Settings:
    """The extension's own GSettings, in the nested session's dconf."""

    def __init__(self, schemadir):
        self.schemadir = schemadir

    def set(self, key, value):
        subprocess.run(["gsettings", "--schemadir", self.schemadir, "set", SCHEMA, key, value],
                       check=True, capture_output=True, text=True)

    def point_at(self, port):
        self.set("orchestrator-port", str(port))


def wait_until(predicate, seconds=25, interval=0.4, what="condition"):
    """Poll until the predicate returns something truthy. The Shell is asynchronous."""
    deadline = time.time() + seconds
    last = None
    while time.time() < deadline:
        try:
            last = predicate()
        except Exception as exc:  # noqa: BLE001 — a probe not up yet is an ordinary wait
            last = exc
        else:
            if last:
                return last
        time.sleep(interval)
    print(f"       gave up after {seconds} s waiting for {what}; last: {last!r}")
    return None


def menu_labels(panel):
    """Every menu label, flattened — the menu as a person reads it, top to bottom."""
    return [text for item in panel["items"] for text in item["labels"]]


def shoot(path):
    """Screenshot, then wait: the probe returns before the PNG is written."""
    probe("Screenshot", path)
    time.sleep(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--running-port", type=int, required=True)
    parser.add_argument("--idle-port", type=int, required=True)
    parser.add_argument("--dead-port", type=int, required=True,
                        help="a port with nothing listening on it")
    parser.add_argument("--schemadir", required=True)
    parser.add_argument("--screenshots", required=True)
    parser.add_argument("--interval", type=int, default=10,
                        help="the poll interval the session was configured with")
    options = parser.parse_args()
    settings = Settings(options.schemadir)

    print("the probe")
    if not check(wait_until(lambda: probe("Describe") != "", 40, what="the probe") is not None,
                 "the probe answers on the session bus"):
        return 1

    # --- a running cycle -------------------------------------------------------------------
    print("\na running cycle")
    wait_until(lambda: describe().get("visible"), 40, what="the panel button")
    panel = describe()

    check(panel.get("present") is True, "the extension put a button in the panel")
    check(panel.get("visible") is True, "the button is visible while a cycle is running",
          json.dumps(panel)[:400])
    check(panel.get("instances") == 1, "exactly one button",
          f"instances={panel.get('instances')}")
    check(panel.get("icon") == "system-run-symbolic", "it wears the running icon",
          f"icon={panel.get('icon')}")
    check(panel.get("badge") == "1", "the badge counts the one agent the stub reports",
          f"badge={panel.get('badge')}")
    check(panel.get("accessibleName") == "aideas: cycle running, 1 agent",
          "the accessible name says what is happening", f"{panel.get('accessibleName')}")

    # --- the menu --------------------------------------------------------------------------
    print("\nthe menu")
    check(probe("OpenMenu") == "ok", "the menu opens")
    panel = describe()
    check(panel.get("menuOpen") is True, "and reports itself open")

    labels = menu_labels(panel)
    joined = " | ".join(labels)
    check(any(text.startswith("Cycle running for") for text in labels),
          "the header says how long the cycle has been going", joined)
    for expected in ("Running", "Blocked", "Ready", "Also in the queue"):
        check(expected in labels, f"there is a {expected!r} section", joined)
    check("aideas" in labels, "the running idea is listed", joined)
    check("restore-wss" in labels, "the blocked idea is listed", joined)
    check("2 unanswered questions" in labels,
          "the blocked idea says how many questions, in the orchestrator's words", joined)
    check("vacas" in labels, "the ready idea is listed", joined)
    check("behind #3" in labels, "the queued idea says what it is behind", joined)
    check("Preferences" in labels, "the menu offers Preferences", joined)

    reactive = [item for item in panel["items"] if item["reactive"]]
    check(len(reactive) == 1 and "Preferences" in reactive[0]["labels"],
          "Preferences is the only item that reacts — rows are read-only",
          f"{len(reactive)} reactive items: {[i['labels'] for i in reactive]}")

    probe("CloseMenu")
    probe("ShootMenu", f"{options.screenshots}/menu-running.png")
    time.sleep(3)
    probe("CloseMenu")

    # --- the button follows the cycle ------------------------------------------------------
    print("\nthe button follows the cycle (the answered open question)")
    settings.point_at(options.idle_port)
    hidden = wait_until(lambda: describe().get("visible") is False, 40,
                        what="the button to go away when the cycle stops")
    check(hidden is not None, "an idle box takes the button out of the panel",
          json.dumps(describe())[:300])

    print("\n'always show the button'")
    settings.set("always-show", "true")
    shown = wait_until(lambda: describe().get("visible") is True, 25,
                       what="the button under always-show")
    panel = describe()
    check(shown is not None, "the preference brings it back while idle", json.dumps(panel)[:300])
    check(panel.get("icon") == "dialog-question-symbolic",
          "and it wears the blocked icon, because an idea is waiting on an answer",
          f"icon={panel.get('icon')}")
    check(panel.get("badge") == "1", "with the count of blocked ideas",
          f"badge={panel.get('badge')}")

    probe("ShootMenu", f"{options.screenshots}/menu-idle-blocked.png")
    time.sleep(3)
    panel = describe()
    labels = menu_labels(panel)
    check("Idle" in labels, "the header says Idle", " | ".join(labels))
    check("minor update -> v0.2" in labels,
          "the ready row shows the note the orchestrator served", " | ".join(labels))
    probe("CloseMenu")

    # --- a box that goes away ---------------------------------------------------------------
    print("\na box that cannot be reached")
    settings.point_at(options.dead_port)
    unreachable = wait_until(
        lambda: describe().get("icon") == "network-offline-symbolic", 40,
        what="the unreachable icon")
    panel = describe()
    check(unreachable is not None, "the icon says the box cannot be reached",
          f"icon={panel.get('icon')}")

    probe("OpenMenu")
    labels = menu_labels(describe())
    check("Orchestrator unreachable" in labels,
          "the menu says so plainly", " | ".join(labels))
    check(any("connection refused" in text for text in labels),
          "and why, in a phrase that does not change with the locale", " | ".join(labels))
    check(any(text.startswith("last good reading") for text in labels),
          "with the last good reading dated beneath it", " | ".join(labels))
    probe("CloseMenu")

    settings.set("always-show", "false")
    settings.point_at(options.running_port)
    back = wait_until(lambda: describe().get("icon") == "system-run-symbolic", 40,
                      what="recovery")
    check(back is not None, "and it recovers when the box comes back",
          json.dumps(describe())[:300])

    # --- five enable/disable rounds --------------------------------------------------------
    print("\nfive enable/disable rounds")
    before = served(options.running_port)
    check(probe("Cycle", "5").startswith("ok"), "five rounds ran without an error")
    wait_until(lambda: describe().get("present"), 30, what="the button after cycling")
    panel = describe()
    check(panel.get("present") is True, "the button is back in the panel")
    check(panel.get("instances") == 1, "and there is exactly one of it",
          f"instances={panel.get('instances')}")
    after = wait_until(lambda: served(options.running_port) > before, 30,
                       what="a poll after re-enabling")
    check(after is not None, "it is still polling after being re-enabled",
          f"served {before} before the rounds")

    # --- nothing left behind ---------------------------------------------------------------
    print("\nnothing left behind by a disable")
    probe("SetEnabled", "false")
    gone = wait_until(lambda: describe().get("present") is False, 20,
                      what="the button to leave the panel")
    check(gone is not None, "the button leaves the panel when the extension is disabled",
          json.dumps(describe())[:200])

    quiet_start = served(options.running_port)
    quiet_seconds = options.interval + 5
    time.sleep(quiet_seconds)
    quiet_end = served(options.running_port)
    check(quiet_end == quiet_start,
          "a disabled extension makes no further requests — no timer survived",
          f"{quiet_start} -> {quiet_end} over {quiet_seconds} s")

    probe("SetEnabled", "true")
    wait_until(lambda: describe().get("visible"), 30, what="the button after re-enabling")
    shoot(f"{options.screenshots}/panel-running.png")

    print(f"\n{checks - len(failures)} passed, {len(failures)} failed, {checks} total")
    if failures:
        print("failed:")
        for description in failures:
            print(f"  - {description}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
