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


def icon_pixels(png, geometry):
    """The pixels of the panel icon, as (r, g, b) triples.

    Cropped to the St.Icon itself rather than the whole button, so the badge label beside it
    cannot be mistaken for the icon having drawn something.
    """
    from PIL import Image

    with Image.open(png) as image:
        rgb = image.convert("RGB")
        box = (geometry["x"], geometry["y"],
               geometry["x"] + geometry["width"], geometry["y"] + geometry["height"])
        return list(rgb.crop(box).getdata())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--running-port", type=int, required=True)
    parser.add_argument("--idle-port", type=int, required=True)
    parser.add_argument("--all-blocked-port", type=int, required=True)
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
    check(panel.get("icon") == "aideas-bulb-running-symbolic", "it wears the running bulb",
          f"icon={panel.get('icon')}")
    check(panel.get("badge") == "1", "the badge counts the one agent the stub reports",
          f"badge={panel.get('badge')}")
    check(panel.get("accessibleName") == "aideas: cycle running, 1 agent",
          "the accessible name says what is happening", f"{panel.get('accessibleName')}")

    # --- the bulb --------------------------------------------------------------------------
    #
    # The one thing no headless test can check: that a shipped SVG is *recoloured* to the panel
    # foreground rather than blitted as a picture. A currentColor SVG that the shell does not
    # treat as symbolic renders black, which on a dark panel is an invisible button — so this
    # looks at the actual pixels.
    print("\nthe bulb")
    check(panel.get("icon") == "aideas-bulb-running-symbolic",
          "the panel wears this idea's own bulb, not a stock glyph",
          f"icon={panel.get('icon')}")
    icon_file = panel.get("iconFile") or ""
    check(icon_file.endswith("icons/aideas-bulb-running-symbolic.svg"),
          "resolved to the shipped file, so the loader found it",
          f"iconFile={icon_file}")

    geometry = panel.get("iconGeometry") or {}
    check(geometry.get("width", 0) >= 8 and geometry.get("height", 0) >= 8,
          "and it has a real size on the stage",
          f"geometry={geometry}")

    shoot(f"{options.screenshots}/panel-running.png")
    if geometry:
        pixels = icon_pixels(f"{options.screenshots}/panel-running.png", geometry)
        # A missing icon draws nothing: every pixel is the panel's background.
        distinct = len(set(pixels))
        check(distinct > 1, "something is actually drawn where the icon is",
              f"{distinct} distinct colours in the icon's rectangle")

        brightest = max(sum(p) / 3 for p in pixels)
        darkest = min(sum(p) / 3 for p in pixels)
        check(brightest > 140,
              "it is drawn in a light colour, as the panel's foreground is",
              f"brightest pixel {brightest:.0f}/255 — a black bulb means it was blitted, "
              f"not recoloured (darkest {darkest:.0f})")

        # Symbolic means one colour: grey, whatever the theme. A coloured pixel would mean the
        # SVG's own paint survived.
        worst = max(max(p) - min(p) for p in pixels)
        check(worst <= 24, "and in grey, not in a colour of its own",
              f"most saturated pixel spans {worst} between channels")
        running_pixels = pixels
    else:
        running_pixels = None

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
    check(any("does that include their tabs" in text for text in labels),
          "and the questions themselves are listed under it", joined)
    check(any("closed by hand come back" in text for text in labels),
          "both of them", joined)
    check("vacas" in labels, "the ready idea is listed", joined)
    # The quiet section joins the version to the note, so the row reads "v0.4 · behind #3".
    check(any("behind #3" in text for text in labels),
          "the queued idea says what it is behind", joined)
    check("Preferences" in labels, "the menu offers Preferences", joined)

    reactive = [item for item in panel["items"] if item["reactive"]]
    check(len(reactive) == 1 and "Preferences" in reactive[0]["labels"],
          "Preferences is the only item that reacts — rows are read-only",
          f"{len(reactive)} reactive items: {[i['labels'] for i in reactive]}")

    probe("CloseMenu")
    probe("ShootMenu", f"{options.screenshots}/menu-running.png")
    time.sleep(3)
    probe("CloseMenu")

    # --- every idea blocked ------------------------------------------------------------------
    #
    # The state whose whole purpose is to be noticed by a person: no cycle is running, so the
    # button would not be there at all under the old visibility rule.
    print("\nevery idea blocked")
    settings.set("always-show", "false")
    settings.point_at(options.all_blocked_port)
    shown = wait_until(lambda: describe().get("icon") == "aideas-bulb-all-blocked-symbolic", 40,
                       what="the all-blocked bulb")
    panel = describe()
    check(shown is not None, "the bulb changes to the struck-through one",
          f"icon={panel.get('icon')}")
    check(panel.get("visible") is True,
          "and the button is there without a cycle running and without 'always show'",
          json.dumps(panel)[:300])
    check(panel.get("badge") == "3", "badging the three blocked ideas",
          f"badge={panel.get('badge')}")
    check(panel.get("accessibleName") == "aideas: every idea is blocked, 3 waiting for an answer",
          "and saying so in one line", f"{panel.get('accessibleName')}")

    # The pixels, not just the name: a fallback icon would satisfy every check above — it is
    # drawn, light and grey too. What a fallback cannot do is *differ between states*, which is
    # how the earlier version of these bulbs was caught rendering as somebody else's glyph.
    probe("CloseMenu")
    shoot(f"{options.screenshots}/panel-all-blocked.png")
    all_blocked_geometry = describe().get("iconGeometry") or {}
    if running_pixels and all_blocked_geometry:
        blocked_pixels = icon_pixels(
            f"{options.screenshots}/panel-all-blocked.png", all_blocked_geometry)
        check(blocked_pixels != running_pixels,
              "and it is a different drawing from the running bulb, pixel for pixel",
              "identical pixels mean the shell is drawing a fallback icon for both")

    probe("ShootMenu", f"{options.screenshots}/menu-all-blocked.png")
    time.sleep(3)
    labels = menu_labels(describe())
    joined = " | ".join(labels)
    check(sum(1 for text in labels if "unanswered question" in text) >= 1,
          "the menu lists the blocked ideas", joined)
    check(any("+2 more" == text for text in labels),
          "an idea with more questions than fit says how many are not shown", joined)
    check(any("AMO API key" in text for text in labels),
          "another idea's single question is listed in full", joined)
    check(any("STATUS.md says blocked" == text for text in labels),
          "and an idea blocked without questions reads exactly as it always did", joined)
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
    check(panel.get("icon") == "aideas-bulb-blocked-symbolic",
          "and it wears the blocked bulb, because an idea is waiting on an answer",
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
    back = wait_until(lambda: describe().get("icon") == "aideas-bulb-running-symbolic", 40,
                      what="recovery")
    check(back is not None, "and it recovers when the box comes back",
          json.dumps(describe())[:300])

    # --- five enable/disable rounds --------------------------------------------------------
    #
    # One D-Bus call per half-round, each waited on. Disabling and re-enabling inside a single
    # main-loop iteration is not a round: ExtensionManager's bookkeeping ends up out of step
    # with reality and the extension stays down, with nothing logged. A screen lock and the
    # unlock after it are seconds apart, which is what this imitates.
    print("\nfive enable/disable rounds (what every screen lock does)")
    before = served(options.running_port)
    rounds_ok = True
    for round_number in range(1, 6):
        probe("SetEnabled", "false")
        if wait_until(lambda: describe().get("present") is False, 15,
                      what=f"round {round_number}: the button to go") is None:
            rounds_ok = False
            break
        probe("SetEnabled", "true")
        if wait_until(lambda: describe().get("present") is True, 15,
                      what=f"round {round_number}: the button to come back") is None:
            rounds_ok = False
            break
    check(rounds_ok, "five rounds, each leaving and rejoining the panel")

    panel = describe()
    check(panel.get("present") is True, "the button is in the panel after five rounds",
          json.dumps(panel)[:200])
    check(panel.get("instances") == 1, "and there is exactly one of it",
          f"instances={panel.get('instances')}")
    after = wait_until(lambda: served(options.running_port) > before, 30,
                       what="a poll after re-enabling")
    check(after is not None, "it is still polling after five rounds",
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
    check(wait_until(lambda: describe().get("visible"), 30,
                     what="the button after re-enabling") is not None,
          "and it comes back when the extension is enabled again")
    shoot(f"{options.screenshots}/panel-running.png")

    print(f"\n{checks - len(failures)} passed, {len(failures)} failed, {checks} total")
    if failures:
        print("failed:")
        for description in failures:
            print(f"  - {description}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
