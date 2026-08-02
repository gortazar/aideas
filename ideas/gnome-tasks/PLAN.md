# Plan: gnome-tasks — KDE Activities for Gnome

Difficulty estimate: hard — it is not one program but four (a Shell extension, a session daemon, a
per-app adapter layer, and a browser extension), it depends on window/session information that
Wayland deliberately does not expose, and "which file is this window showing?" has no general
answer on Linux, so a large part of the work is research and per-app special-casing.

## Context

KDE's Activities let a user group applications, documents and settings under a named task, and
switch between tasks so that the desktop is restored to how that task was last left. Plasma
implements this in `kactivitymanagerd`, a session daemon that owns activity state and exposes it
over D-Bus (`org.kde.ActivityManager`), plus KWin rules that bind windows to activities, plus
`KActivities` client APIs that let applications *link resources* (files, URLs) to the current
activity. The UI is a switcher plus a settings module for creating, renaming, stopping and
deleting activities.

Gnome has no equivalent. Workspaces are the nearest primitive, but they are ephemeral, unnamed by
default, hold no application set, and restore nothing across a logout. This idea builds the
missing layer on top of Gnome Shell.

Three properties of Gnome shape the whole design, and are worth stating before the feature list:

1. **The Shell extension runs inside the compositor process.** Anything slow or risky — spawning
   processes, reading `/proc`, writing state files, talking to a browser over native messaging —
   must not happen there, or the desktop stutters and a crash takes the session down. So the
   architecture mirrors Plasma's: a **daemon** (`gnome-tasks-daemon`, owning
   `org.gnome.Tasks` on the session bus) holds all state and does all work; the **extension** is a
   thin top-bar client that additionally provides the one thing only in-process code can do, which
   is Mutter/`Meta` window introspection and placement.
2. **Wayland hides window state from other clients by design.** There is no `wmctrl`, no
   `_NET_CLIENT_LIST`, no cross-client window IDs. Every piece of window knowledge must come from
   inside the compositor (the extension, via `Meta.Window` / `Shell.WindowTracker`) and be handed
   to the daemon over D-Bus. This is why the extension cannot be dropped in favour of a pure
   daemon, and why an X11-only prototype would be a dead end.
3. **Restoring a window is a guess, not a command.** Gnome can launch an app with a file, and
   Mutter can place a window once it appears — but correlating "the window that just appeared"
   with "the launch I requested" needs startup-notification tokens plus heuristics, and some apps
   (single-instance apps, browsers, Electron apps, terminals) will need bespoke handling. The
   design treats per-app support as a **capability tier**, not a boolean.

Assumption (stated rather than asked): the target is a modern Gnome Shell on Wayland — GNOME 45+
ESM extensions, `Extension`/`ExtensionPreferences` base classes — with X11 treated as best-effort.
See Open Questions for the exact version floor.

## Features

- **Top-bar task switcher** — a panel indicator showing the current task's name and icon, with a
  menu listing all tasks, a "create task" entry, and per-task actions (switch, stop, edit,
  delete). Keyboard shortcut to cycle tasks and a shortcut per task, following the KDE model
  where *stopping* a task (closing its apps, keeping its definition) is distinct from *deleting*
  it.
- **Task model with persistent state** — each task has a UUID, name, icon, optional description,
  and a saved *layout*: the list of applications, their documents, their window placement
  (workspace + monitor + geometry + maximised/fullscreen state), and their declared commands.
  Stored as versioned JSON under `~/.local/share/gnome-tasks/tasks/<uuid>.json`, written
  atomically, with the schema documented and migrated on version bumps.
- **Session capture** — while a task is active, the daemon keeps an up-to-date picture of it,
  built from window events the extension forwards: `global.display::window-created`,
  `Shell.AppSystem::app-state-changed`, `Meta.Window` `workspace-changed`, `position-changed`,
  `size-changed`, `unmanaged`. Debounced, so a window drag does not cause a write storm.
- **Session restore on activation** — switching to a task launches everything it remembers:
  applications via `Gio.DesktopAppInfo.launch_uris_async()` with their documents, on the
  workspace/monitor they were on, using a launch context from
  `global.context.get_app_launch_context()` (i.e. carrying an `XDG_ACTIVATION_TOKEN` /
  `DESKTOP_STARTUP_ID`) so new windows can be matched back to the slot that asked for them.
  Windows that cannot be matched by token fall back to matching on app id, then PID, within a
  time window.
- **Deactivation policy** — switching away moves the outgoing task's windows out of sight and
  optionally closes them, asking the app to quit politely (`Meta.Window.delete()`, giving
  unsaved-work dialogs a chance) rather than killing PIDs. The exact default is an open question
  below; the mechanism supports both "hide" and "close" per task.
- **Document tracking, tiered by app** — the plan does not pretend one mechanism covers
  everything. Per-app *adapters* declare what they can do:
  - *Tier 0 — app only.* The window's `Shell.App` / desktop file id is all we know. Restore
    launches the app with no arguments.
  - *Tier 1 — documents.* The open file/URI is recoverable, so restore passes it on the command
    line. Sources, in order of preference: the app's own D-Bus interface where it has one;
    `org.gtk.Application`'s window object path (`_GTK_APPLICATION_ID` /
    `_GTK_WINDOW_OBJECT_PATH`, exposed by `Meta.Window.get_gtk_application_id()` and friends);
    `/proc/<pid>/fd` and `/proc/<pid>/cwd` correlated with the window's PID; the freedesktop
    recent-files store (`~/.local/share/recently-used.xbel`) correlated by app and timestamp; and
    last, title-parsing heuristics declared explicitly per app rather than applied globally.
  - *Tier 2 — full inner state.* Multi-document apps (browser tabs, editor projects, terminal
    tabs) need cooperation from the app itself, via a plugin. Tier 2 apps report their own state
    to the daemon over D-Bus and are restored by handing that state back.
- **Firefox adapter (tier 2)** — a WebExtension plus a native-messaging host that reports, per
  browser window, the open tabs (URL, title, pinned, active) and restores them into a new window
  on task activation. Includes the hard part: correlating a browser window known to the
  WebExtension (`browser.windows` IDs) with a `Meta.Window` known to the compositor, since
  Wayland gives the two sides no shared identifier.
- **Managed commands** — per-task background commands (`docker compose up`, a dev server, an SSH
  tunnel) started on activation and stopped on deactivation. Run as **transient systemd user
  units** (`StartTransientUnit` on `org.freedesktop.systemd1`, one scope per task), so each task
  gets its own cgroup, output lands in the journal, nothing is orphaned when the Shell restarts,
  and stopping a task reliably stops its children. Commands are **declared by the user and shown
  before first run** — never silently harvested from a terminal's command line and replayed.
- **Preferences UI** — a GTK4/libadwaita `ExtensionPreferences` window to manage tasks, edit their
  app/document/command lists, set icons and shortcuts, and control capture behaviour, with an
  exclusion list (apps and paths never recorded) and a global "pause capture" switch.
- **Public D-Bus API** — `org.gnome.Tasks`: list/create/delete/activate tasks, query the current
  task, subscribe to changes, and let cooperating apps and plugins push their own state. This is
  the extension point that makes tier-2 adapters possible without patching gnome-tasks for each
  app, and it deliberately echoes `org.kde.ActivityManager` so the concepts map.
- **Documented Gnome research** — the internals this depends on are written down in the idea
  folder as first-class deliverables, not left as tribal knowledge in the code (see
  *Documentation deliverables*).
- **Reproducible environment + green CI** — `flake.nix` with `gjs`, `glib`, `gtk4`, `libadwaita`,
  ESLint and `gnome-extensions`; `nix flake check` runs lint, headless unit tests and a packing
  check; `.github/workflows/ci-gnome-tasks.yml` runs it path-filtered on push and PR.

## Documentation deliverables

The idea text calls this out explicitly, so these are tracked work items, each written from
verified experiment rather than recollection, with the probe scripts kept in `tools/`:

- `docs/kde-activities.md` — what Plasma actually does: the activity lifecycle (running / stopped
  / deleted), `kactivitymanagerd`'s D-Bus surface, resource linking and scoring, KWin's
  per-activity window rules, and an explicit table of which behaviours this port adopts, drops or
  changes.
- `docs/gnome-internals.md` — the Gnome side: `Shell.AppSystem`, `Shell.WindowTracker`,
  `Meta.Window` / `Meta.Workspace` / `Meta.Display` and which of their properties survive a
  restart; the signals that fire on app launch and window creation, in order, with timings;
  startup notification and `XDG_ACTIVATION_TOKEN`; `Gio.DesktopAppInfo` launching; workspace
  management under the dynamic-workspaces setting; monitor identification via
  `org.gnome.Mutter.DisplayConfig` (connector name + EDID) so a saved layout survives replugging
  a display; and the X11-vs-Wayland differences for each.
- `docs/state-schema.md` — the on-disk task format, versioning and migration rules.
- `docs/app-adapters.md` — the adapter interface, the capability tiers, and how to write a new
  adapter; one worked example per tier.
- `docs/limitations.md` — the honest list of what cannot be restored and why (see *Risks*).

## Approach

Sequenced so that the research that could invalidate the design happens first, and so that every
milestone leaves something usable.

1. **M0 — Spike and document.** Build `tools/probe.js`, a throwaway extension that logs every
   window/app event with all reachable metadata, and run it against a realistic desktop (GTK app,
   Electron app, terminal, Firefox, an X11 app under XWayland). Produce
   `docs/gnome-internals.md` from what it observes. Deliverable: knowledge, plus a go/no-go on
   the tier-1 document sources.
2. **M1 — Skeleton.** Flake, lint, headless test runner, CI green on an empty-but-real extension
   and daemon that do nothing but talk to each other over D-Bus. Getting a red CI later is much
   harder to debug than getting a green one now.
3. **M2 — Task model and switcher.** Create/rename/delete tasks, persist them, switch between
   them from the top bar. Restore *applications only*, no placement, no documents. This is the
   first genuinely useful version.
4. **M3 — Placement.** Capture and restore workspace, monitor and geometry, including
   launch-to-window matching via activation tokens and the fallback heuristics. Handle dynamic
   workspaces and monitor sets that changed since capture.
5. **M4 — Documents (tier 1).** The adapter framework plus adapters for a handful of common apps,
   chosen from what M0 showed to be tractable.
6. **M5 — Commands.** Transient systemd units, per-task lifecycle, journal integration, plus the
   confirmation UX before a stored command ever runs.
7. **M6 — Firefox (tier 2).** WebExtension, native-messaging host, window correlation, restore.
8. **M7 — Polish.** Preferences UI, shortcuts, icons, screenshots, README, `docs/limitations.md`.

Testing, per the repo's tests-first rule, splits three ways: the state model, schema migration,
adapter selection, layout matching and monitor remapping are pure logic in Shell-free modules
runnable under plain `gjs` in CI; the daemon's D-Bus surface is tested against a private bus with
`dbus-run-session`; and window capture/restore is tested as a smoke test in a nested headless
Gnome Shell, which is the piece most likely to prove impractical in CI and is flagged as a risk
rather than assumed.

## Risks / things to verify early

- **Wayland geometry control.** Whether Mutter will honour `move_resize_frame()` for Wayland
  clients from an extension, for all client types, is the single biggest assumption in M3. If it
  only holds for XWayland, placement degrades to workspace + monitor and `docs/limitations.md`
  says so.
- **Single-instance and Electron apps.** Apps that hand a second launch to an existing process
  produce no new window, or a window with no usable startup token. Expect per-app handling.
- **Terminals.** A terminal's *value* is the shell state inside it, which cannot be restored.
  Restoring the working directory and optionally re-running a declared command is the realistic
  ceiling.
- **Browser window correlation.** If no reliable link between a WebExtension window ID and a
  `Meta.Window` exists, the fallback is coarser: restore all of a task's tabs into one new window
  and accept losing the per-window split.
- **extensions.gnome.org review rules conflict.** EGO's guidelines are hostile to exactly what
  this extension needs — spawning processes and running user-supplied commands. Keeping all
  spawning in the separately-installed daemon (the extension only makes D-Bus calls) is the
  mitigation, but whether EGO publication is even a goal is an open question below.
- **Privacy.** Recording which documents a user opens is a surveillance-shaped feature; KDE hit
  the same problem and answered it with explicit resource-scoring controls. Default here is
  capture-on, exclusion lists available, everything local, nothing recorded while capture is
  paused — but the default itself is worth confirming.
- **Shell restarts and version churn.** The daemon must survive the extension going away
  (`Alt+F2 r`, crash, upgrade) without losing task state, and Gnome's extension API breaks
  between major releases; the extension side must stay as thin as possible for that reason too.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Which Gnome Shell versions and session types must be supported? The plan assumes GNOME 45+ (ESM extensions) on Wayland with X11 best-effort — is X11 support actually required, and is there a specific version to target (e.g. whatever ships on the development machine)?
- [ ] Is publishing to extensions.gnome.org a goal? It constrains the design hard (no subprocess spawning from the extension, review-driven release cadence, no bundled daemon), whereas a self-installed extension + daemon has no such limits.
- [ ] What should happen to a task's windows when the user switches away — leave them running but hidden on a parked workspace (fast, memory-hungry), or close them politely and reopen on return (slow, risks unsaved-work prompts)? Per-task setting with which default?
- [ ] Should the task layout be captured continuously and saved automatically on switch-away (KDE-like, "it just remembers"), or should the user explicitly "save layout", with the automatic snapshot only as a suggestion? This changes the whole UX and the amount of state churn.
- [ ] Where do per-task commands come from: only ones the user types into the preferences UI, or should gnome-tasks also try to detect long-running foreground commands in a task's terminals and offer to remember them? The latter is a much bigger and more invasive feature.
- [ ] Is the Firefox WebExtension in scope for this idea's "done", and if so does it need to be signed and distributed via addons.mozilla.org, or is a locally-loaded unsigned extension acceptable? Should Chrome/Chromium get the same treatment, or is Firefox the only browser in scope?
- [ ] How much scope does "restore the file it opened" carry for apps that expose nothing? Is a best-effort heuristic (recent-files store, `/proc` inspection, title parsing) acceptable when it will sometimes restore the wrong document, or should such apps be restored with no document at all and reported as tier 0?
- [ ] How far should per-task theming go? KDE Activities carry a wallpaper and per-activity favourites; this plan currently carries only a name and icon. Is per-task wallpaper/favourites wanted, or explicitly out of scope?
- [ ] Can CI run a nested headless Gnome Shell on the available GitHub runners? If not, is a unit-tests-plus-lint CI acceptable, with window capture/restore verified only manually and recorded in `STATUS.md`?
