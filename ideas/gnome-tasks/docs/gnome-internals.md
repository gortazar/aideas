# GNOME internals gnome-tasks depends on

Everything here was observed, not remembered. The instrument is `tools/probe/` (a research-only
extension) driven by `tools/nested-shell.sh` + `tools/probe-scenario.sh`; the raw harvest is
committed as `probe-data/nested-session.jsonl` so every claim below can be re-checked, and
re-generated with:

```console
$ tools/nested-shell.sh start --extension tools/probe --state /tmp/gtn
$ tools/probe-scenario.sh --state /tmp/gtn --out docs/probe-data/nested-session.jsonl
$ tools/nested-shell.sh stop --state /tmp/gtn
```

Platform under test: **GNOME Shell 46.0, gjs 1.80.2, Wayland, Ubuntu 24.04**. Where a claim is
version-sensitive it says so. Where something was *not* established, it is listed in
[Still unknown](#still-unknown) rather than guessed at.

## Session shape

| Fact | Value observed |
| --- | --- |
| `Config.PACKAGE_VERSION` | `46.0` |
| Extension module system | ESM (`import`), `Extension`/`ExtensionPreferences` base classes |
| `Meta.prefs_get_dynamic_workspaces()` | honours `org.gnome.mutter dynamic-workspaces` |
| Monitor identity from `Main.layoutManager.monitors` | index, x/y/width/height, `geometry_scale` — **no connector name** |
| `global.display.get_monitor_connector()` | **does not exist** on Shell 46 (throws) |
| `global.display.is_monitor_builtin()` | **does not exist** on Shell 46 |
| `org.gnome.Mutter.DisplayConfig.GetCurrentState` | connector + vendor + product + serial per monitor |

Consequence for M3: **monitor identity must come from DisplayConfig over D-Bus, not from Mutter's
monitor indices**, which renumber when displays are replugged. In the headless test session the
virtual monitor reports connector `Meta-0`, vendor `MetaVendor`, product `MetaVirtualMonitor`,
serial `0x00` — enough to prove the shape of the data, not enough to prove EDID stability on real
hardware, which stays on the M3 checklist.

## What a window tells you

Full records are in `probe-data/nested-session.jsonl`. A representative GTK4 window
(`gnome-text-editor notes.txt`), sampled 1 s after creation:

| Getter | Value | Use to gnome-tasks |
| --- | --- | --- |
| `get_id()` | `763757057` | opaque, per-session; **not** stable across a restart |
| `get_stable_sequence()` | `4` | per-session ordinal, also not persistable |
| `get_title()` | `notes.txt (~/.cache/gnome-tasks-probe/docs) - Text Editor` | last-resort document hint |
| `get_wm_class()` | `org.gnome.TextEditor` | app matching |
| `get_pid()` | `267684` | the key to `/proc` |
| `get_gtk_application_id()` | `org.gnome.TextEditor` | app matching, GTK apps only |
| `get_gtk_unique_bus_name()` | `:1.16` | lets the daemon call the app back over D-Bus |
| `get_gtk_application_object_path()` | `/org/gnome/TextEditor` | ditto |
| `get_gtk_window_object_path()` | `/org/gnome/TextEditor/window/1` | per-window identity *within* the app |
| `get_sandboxed_app_id()` | `null` | non-null for Flatpak; snaps are not sandboxed this way |
| `get_startup_id()` | `null` | see [Launch matching](#launch-matching) |
| `get_client_type()` | `0` = `Meta.WindowClientType.WAYLAND` | XWayland vs native |
| `get_maximized()` | `0` (bitmask) | layout capture |
| `is_client_decorated()` | `true` | CSD, so frame rect == buffer rect |
| `is_always_on_top()` | **no such method** on Shell 46 | use `notify::above` instead |

`Shell.WindowTracker.get_default().get_window_app(win)` yields the tier-0 answer, and it is a
good one: id `org.gnome.TextEditor.desktop`, name, `state`, `get_pids()`, and — critically for
restore — `get_app_info().get_filename()` (`/usr/share/applications/org.gnome.TextEditor.desktop`)
and `get_commandline()` (`gnome-text-editor %U`).

### Two facts that constrain the whole capture design

**1. At `window-created`, the window does not know what app it is.** For all four windows probed,
`get_wm_class()` was `null` at `window-created` time and `Shell.WindowTracker` returned the
synthetic app id `window:1`, `window:2`, … . The real app id (`org.gnome.TextEditor.desktop`)
appears later, and `Shell.AppSystem::app-state-changed` fires *twice* per launch as a result:
first for the synthetic `window:N` app, then for the real desktop app.

```
app-state-changed  window:1                      state=2 (RUNNING) n_windows=1
app-state-changed  window:1                      state=0 (STOPPED) n_windows=0
app-state-changed  org.gnome.TextEditor.desktop  state=2 (RUNNING) n_windows=1
```

So capture must never record what it learns at `window-created`; it has to wait for the window to
be identified, and it must ignore `window:N` app ids entirely.

**2. Geometry is `0x0` until the client commits a buffer.** `get_frame_rect()` and
`get_buffer_rect()` both return `{x: 0, y: 0, width: 0, height: 0}` at creation and stay zero
through the `notify::title` and `notify::gtk-window-object-path` notifications. Real geometry
arrives with the first `position-changed`/`size-changed`, and the delay is not predictable:

| Window | Delay from `window-created` to first non-zero frame rect |
| --- | --- |
| `gnome-terminal-server` | 52 ms |
| `org.gnome.Nautilus` | 1102 ms |
| `org.gnome.TextEditor` | 1277 ms |
| `org.gnome.Calculator` | 1325 ms |

A fixed settle delay would therefore be wrong for either the fast or the slow case. Capture is
**signal-driven**: subscribe to `position-changed`/`size-changed` and treat a zero rect as
"not known yet", never as "a window at the origin with no size".

Signal order observed per launch, for GTK4 apps:

```
window-created                     (no wm_class, no app, no geometry)
notify::title                      ("Loading…" or the app name)
notify::gtk-window-object-path     (GTK D-Bus identity appears)
notify::maximized-horizontally
position-changed / size-changed    (first real geometry, 52–1325 ms in)
notify::title                      (final title, e.g. the document name)
```

## Document recovery, tier by tier

The go/no-go this milestone exists for. Findings per source:

| Source | Verdict | Evidence |
| --- | --- | --- |
| `/proc/<pid>/cmdline` | **Good, when it applies** | `gnome-text-editor` shows `["/usr/bin/gnome-text-editor","/home/…/notes.txt"]` — the document, verbatim |
| `/proc/<pid>/cmdline` for D-Bus-activated apps | **Useless** | Nautilus shows `["/usr/bin/nautilus","--gapplication-service"]`; the document is not there |
| `/proc/<pid>/fd` | **Sometimes** | Nautilus holds an fd on the directory it is showing (`…/docs/project`); `gnome-text-editor` holds none — GTK reads the file and closes it |
| `/proc/<pid>/cwd` | **Only meaningful for terminals** | text editor and calculator inherit the *launcher's* cwd; `gnome-terminal-server` reports `/home/patxi`, i.e. the server's, not the shell's |
| Window title | **Weak but real** | `notes.txt (~/.cache/gnome-tasks-probe/docs) - Text Editor` contains file and directory; per-app parsing only, never global |
| `org.gtk.Application` window object path | **Identity, not documents** | gives `/org/gnome/TextEditor/window/1` — a handle to call the app, not the open file |
| `recently-used.xbel` | **Not yet established** | nothing was written during the probe session; needs a longer, more realistic run |

Which makes the tier assignment concrete:

* **Tier 1 is viable** for apps launched with their document as an argument and still running as
  that process — `/proc/<pid>/cmdline` is the workhorse, and it is exact rather than heuristic.
* **D-Bus-activated apps** (`--gapplication-service`, the GNOME default) defeat cmdline, so they
  need either `/proc/<pid>/fd` (works for Nautilus), the app's own D-Bus interface, or title
  parsing. This is the case that justifies per-app adapters rather than one mechanism.
* **The terminal problem is confirmed**: the window belongs to `gnome-terminal-server`, whose PID
  and cwd have nothing to do with the shell running inside the tab. The *title* did carry the
  shell's working directory (`patxi@host:/tmp/…/gnome-tasks`), so the realistic ceiling is
  title-derived cwd, which is exactly the "good to have" the plan allows.

## Launch matching

Answered by `tools/experiment-m3.sh`, which launches an app through the Shell's own launch context
inside a nested session and reports which correlation strategy fired.

**The activation token is delivered to the application but is not visible on its window.** The
launch context issues one — the child process really does receive
`XDG_ACTIVATION_TOKEN=4a8d3a4a-fbed-4d0b-802a-fe6e46847b44`, confirmed by reading
`/proc/<pid>/environ` — yet `Meta.Window.get_startup_id()` on the resulting window is `null`. So the
one strategy that would be *exact* is unavailable through that API, and matching falls back to
"a window of the right application appeared while we were waiting for one", which is a guess.

```
matched launch=launch-1 strategy=app-id
  token issued to app:  '4a8d3a4a-fbed-4d0b-802a-fe6e46847b44'
  token seen on window: null
```

The consequence is bounded but real: with two launches of the *same* application in flight, the
windows can be attributed to the wrong slot. `src/lib/launchMatcher.js` therefore labels every match
with the strategy that produced it, and the label is logged, so a bad restore is diagnosable rather
than mysterious.

Not yet tried, and the obvious next thing: `Meta.StartupNotification` — present on GNOME 46 as
`meta_startup_notification_get_sequences()`, `meta_startup_notification_create_launcher()` and
`meta_startup_sequence_get_application_id()`. Mutter clearly tracks sequences internally (it issued
the token); whether a sequence can be tied to the window that consumed it is the question.

Two other timing facts came out of the same experiment:

* **A cold application start can take far longer than expected.** Calculator's first window took
  **~24–30 s** to appear in a headless nested session. A launch timeout of 15 s — the first value
  used here — expires before the window exists, and the window then arrives unplaced. The timeout is
  now 90 s.
* **Matching must be driven by signals, not timers.** Since identification arrives as a property
  change at an unpredictable time, the extension attempts a match on `notify::wm-class`,
  `notify::title` and `notify::gtk-window-object-path`, with a few timers only as a backstop.

## Window placement

This was flagged in `PLAN.md` as "the single biggest assumption in M3". The matrix in
`tools/experiment-geometry.py`, run against a real nested Shell:

| Requested | Applied | Position | Size |
| --- | --- | --- | --- |
| 600x600 at +300+200 | 600x600 at +300+200 | honoured | honoured |
| 400x300 at +50+50 | 400x491 at +300+200 | **ignored** | clamped |
| 800x700 at +0+0 | 800x700 at +0+0 | honoured | honoured |
| move only, to +400+300 | 360x503 at +400+300 | honoured | honoured |
| 640x620 at +120+90, window on an **inactive** workspace | 640x620 at +120+90 | honoured | honoured |

**Verdict: Mutter honours `move_resize_frame()` for Wayland clients from an extension.** Position and
size both stick, exactly, and it works for a window on a workspace the user is not looking at — so
restore does not have to switch workspaces to place windows.

Two caveats, both from the second row:

1. **The application's own size constraints win.** Calculator refuses to be shorter than 491 px, so
   `400x300` came back as `400x491`. That is the app, not the compositor, and there is nothing to be
   done about it.
2. **When the size is refused, the move is dropped too.** The window stayed at its previous position
   rather than moving to `+50+50`. So a placement that asks for an impossible size loses the position
   as well; asking for a plausible size matters more than it looks.

### Measuring this correctly is a trap

A Wayland geometry change is a negotiation: Mutter sends a configure event, the client acknowledges
it and commits a new buffer, and only *then* does `get_frame_rect()` change. Reading the frame
immediately after `move_resize_frame()` returns the **old** rect, which makes every placement look
refused — the conclusion this project drew twice before separating the request from the verdict.
`placeWindow()` now records what it asked for, and `GetPlacementReport` computes the verdict when
asked, which is necessarily later. A `0x0` frame is reported as "no verdict yet" rather than as a
failure.

`Meta.Window.delete()` closes a window (verified), so the `close` deactivation policy is
implementable without killing processes.

## The test harness, and four traps in it

`tools/nested-shell.sh` boots a real `gnome-shell --headless --virtual-monitor 1280x800` on a
private D-Bus session. It works on this machine, GNOME Shell 46, with no physical display — which
is the basis for the CI answer in [testing.md](testing.md). Four things cost real time to find,
all of them "process X inherits environment from process Y, not from you":

1. **dconf writes escape into the developer's real settings.** dconf writes are performed by the
   dconf *service*, which the bus activates, and that service reads `XDG_CONFIG_HOME` from **its
   own** environment. Start the private bus before exporting the isolated `XDG_*` and every
   `gsettings set` meant for the nested session rewrites `~/.config/dconf/user` — in our case
   overwriting a live desktop's `enabled-extensions`. The script now exports the isolated
   environment first *and* asserts afterwards that the real database is untouched, aborting if it
   is not.
2. **D-Bus-activated apps inherit the bus daemon's environment.** `gnome-terminal` failed with
   `StartServiceByName … exited with status 8` until the bus activation environment was populated
   with `dbus-update-activation-environment`. The underlying complaint was
   `Non UTF-8 locale (ANSI_X3.4-1968) is not supported!` — `gnome-terminal-server` refuses to
   start under `LC_ALL=C`, which automation environments set routinely.
3. **snapd only lets confined apps see `wayland-N` sockets.** With `--wayland-display gt-nested-0`
   every snap (firefox, codium, libreoffice on Ubuntu) silently fails to connect, because
   snapd's apparmor profile permits `$XDG_RUNTIME_DIR/wayland-[0-9]*` and nothing else. The
   nested display is now called `wayland-9`. Snaps also get a private `/tmp`, so probe documents
   have to live under `$HOME`, not in the state directory.
4. **X11 clients cannot reach the nested Xwayland.** Mutter logs
   `Using public X11 display :2` and creates the socket, but `xdpyinfo` and `xclock` hang
   connecting to it even with the matching `.mutter-Xwaylandauth` file. Not chased further: X11
   is out of scope for gnome-tasks by decision, so this is a harness limitation, not a product
   one.

## Still unknown

Tracked here so nothing gets quietly assumed later:

* Whether `move_resize_frame()` from an extension is honoured for Wayland clients — **the single
  biggest assumption in M3**, untested so far because the probe deliberately only observes.
* Whether an activation token issued via `global.context.get_app_launch_context()` comes back on
  the new window (see [Launch matching](#launch-matching)).
* Firefox and Electron window metadata. Both refused to start in the nested session on this
  machine: snap firefox exits with
  `/user.slice/… is not a snap cgroup for tag snap.firefox.firefox` (snapd's cgroup tracking
  rejects being launched from an arbitrary scope), and snap codium starts but produces no Wayland
  window. Probing these needs a non-snap build, a Flatpak, or a real login session — required
  before M6, not before M4.
* `recently-used.xbel` behaviour under real use.
* Whether EDID identity from DisplayConfig is stable across replugging on real hardware.
