# Limitations

The honest list. Entries marked **confirmed** were observed with `tools/probe/` on GNOME Shell 46
(evidence in [gnome-internals.md](gnome-internals.md)); entries marked **expected** are predicted
from the design and will be confirmed or removed as the milestones land.

This file is a deliverable, not an apology: KDE Activities have the same class of problems, and the
value of gnome-tasks depends on being clear about which 80% works.

## Cannot be restored, ever

* **Shell state inside a terminal** — confirmed. A terminal's value is the running shell, its
  history, its environment and any foreground process. None of that survives closing the window.
  The realistic ceiling is the working directory plus, optionally, a command the user *declared*.
  gnome-tasks will not scrape a terminal's command line and replay it.
* **Unsaved work in any application.** Deactivating with the `close` policy asks each window to
  close politely (`Meta.Window.delete()`), so the app's own "save changes?" dialog gets its say —
  but nothing is saved on the user's behalf.
* **A document that has moved or been deleted** since capture. Restore passes the recorded URI; if
  it no longer resolves, the app decides what to do.

## Recovered only approximately

* **Which document a D-Bus-activated app is showing** — confirmed. GNOME apps launched as
  `--gapplication-service` have no document on their command line (Nautilus:
  `["/usr/bin/nautilus","--gapplication-service"]`), so the answer comes from `/proc/<pid>/fd`,
  the app's own D-Bus interface, or title parsing, in that order of preference. Per the answered
  open question in `PLAN.md` a best-effort heuristic is acceptable here, which means **restore will
  sometimes open the wrong document** for such apps.
* **Documents for applications without an adapter** — by design. An app with no rule in
  `src/lib/adapters/` is restored with no document at all rather than with a guessed one. Which apps
  have rules today is listed in [app-adapters.md](app-adapters.md); the list is short on purpose, and
  adding to it is a small, testable change.
* **Terminal working directory** — confirmed available only via the window title
  (`user@host:/path`), because the window belongs to `gnome-terminal-server` and its PID and cwd
  are the server's, not the shell's. Title formats are per-app and user-configurable, so this is a
  declared per-adapter heuristic, never a global one.
* **A window's size, when the application disagrees** — confirmed, and the good news first:
  `move_resize_frame()` **is** honoured for Wayland clients, exactly, including on a workspace the
  user is not looking at. What cannot be overridden is the app's own minimum size — Calculator
  refuses to be shorter than 491 px — and when a size is refused the accompanying move is dropped
  as well, so the window keeps its old position too.
* **Which launch a new window belongs to** — confirmed weak. The activation token reaches the
  application (it is in the process environment) but is not exposed on the window, so windows are
  matched to launches by application id and timing. With two launches of the same application in
  flight, a window can be attributed to the wrong slot. Every match records the strategy that
  produced it, so this is diagnosable.
* **Monitor identity across a replug** — expected. Saved layouts key monitors by connector name
  plus EDID vendor/product/serial from `org.gnome.Mutter.DisplayConfig`, because Mutter's monitor
  indices renumber. Whether that key is stable on real hardware is unverified.

## Structural, from the platform

* **X11 is not supported.** By decision (see the answered open questions in `PLAN.md`), Wayland
  only. The nested test harness cannot reach its own Xwayland either — confirmed, and not
  investigated further for that reason.
* **The Shell cannot be reloaded in place under Wayland.** Installing or upgrading the extension
  needs a log out and back in. The daemon can be restarted independently, which is one reason all
  the state lives there.
* **Single-instance and Electron apps** — expected. An app that hands a second launch to an
  existing process produces no new window, or a window with no usable activation token, so
  restore cannot tell which slot it belongs to. Per-app handling, and a documented tier.
* **Snap-confined apps are second-class in testing** — confirmed. Snaps only see Wayland sockets
  named `wayland-N`, get a private `/tmp`, and refuse to launch from an arbitrary cgroup, which is
  why Firefox and Electron could not be probed in the nested session yet.

## Deliberately not done

* **Per-task wallpaper, favourites and theming** — out of scope by decision, unlike KDE
  Activities.
* **Publishing on extensions.gnome.org** — not a goal, which is what allows a separate daemon that
  spawns processes at all.
* **Recording commands the user did not declare.** Per-task commands run as transient systemd
  units and are shown before they are ever executed; gnome-tasks does not learn them by watching.
