# What KDE Activities actually do

gnome-tasks is a port of an idea, so the idea is worth stating precisely rather than from memory.

**Provenance.** Everything below about `kactivitymanagerd` comes from reading its **6.3.5 source**,
fetched as the release tarball (`nix build nixpkgs#kdePackages.kactivitymanagerd.src`) — the D-Bus
interface definitions in `src/common/dbus/`, the state enum in `src/service/Activities.h`, and the
plugin list in `src/service/plugins/`. Those files *are* the interface, so this is a primary source
rather than recollection.

What is **not** verified: nothing here was observed on a running Plasma session, because this machine
has none. Two consequences, both flagged where they arise: statements about KWin's behaviour are read
from KDE's documentation rather than tested, and the *feel* of Activities in use is not something a
header file can tell you. Building the daemon to run it was attempted and abandoned — the KDE closure
is far too large for this environment's network.

## The pieces

| Piece | What it is | The gnome-tasks equivalent |
| --- | --- | --- |
| `kactivitymanagerd` | a session daemon owning all activity state | `gnome-tasks-daemon` |
| `org.kde.ActivityManager.*` | its D-Bus surface, five interfaces | `org.gnome.Tasks`, one interface |
| KWin activity rules | the compositor binds windows to activities | the Shell extension + `org.gnome.Tasks.Shell` |
| `KActivities` client library | apps link their own resources | tier-2 `ReportAppState` |
| activity switcher + KCM | the UI | top-bar switcher + preferences window |

The architecture gnome-tasks copies is exactly this split: a daemon that owns the state, a compositor
component that owns the windows, and clients that report what only they know. It was arrived at for
the same reason KDE arrived at it — the compositor is the only thing that can see windows, and it is
the last place you want to do slow or risky work.

## The lifecycle, which is the borrowed idea

`src/service/Activities.h`:

```cpp
enum State { Invalid = 0, Running = 2, Starting = 3, Stopped = 4, Stopping = 5 };
```

An activity is **added** (it exists, with a name and icon), **started** (its applications are running),
**stopped** (it still exists; its applications are not running) and only separately **removed**. The
D-Bus surface mirrors that with distinct `AddActivity`, `StartActivity`, `StopActivity` and
`RemoveActivity` methods, plus `SetCurrentActivity` for switching.

That stop-vs-remove distinction is the single most important thing gnome-tasks takes from Activities,
and it is why `org.gnome.Tasks` has both `StopTask` and `DeleteTask`, and why the switcher menu treats
clicking the current task as "stop it" rather than "delete it". A task that is stopped keeps its name,
its layout and its commands.

## The D-Bus surface, and what gnome-tasks does with it

### `org.kde.ActivityManager.Activities`

Methods: `CurrentActivity`, `SetCurrentActivity`, `PreviousActivity`, `NextActivity`, `AddActivity`,
`StartActivity`, `StopActivity`, `ActivityState`, `RemoveActivity`, `ListActivities` (twice: with and
without a state filter), `ListActivitiesWithInformation`, `ActivityInformation`, `ActivityName`,
`SetActivityName`, `ActivityDescription`, `SetActivityDescription`, `ActivityIcon`, `SetActivityIcon`.

Signals: `CurrentActivityChanged`, `ActivityAdded`, `ActivityStarted`, `ActivityStopped`,
`ActivityRemoved`, `ActivityChanged`, `ActivityNameChanged`, `ActivityDescriptionChanged`,
`ActivityIconChanged`, `ActivityStateChanged`.

**Adopted.** `org.gnome.Tasks` is deliberately the same shape:
`ListTasks`/`GetTask`/`CreateTask`/`SetTaskProperties`/`DeleteTask`/`ActivateTask`/`StopTask`, with
`TaskAdded`/`TaskRemoved`/`TaskChanged`/`TaskStateChanged`/`CurrentTaskChanged`.

**Changed.** KDE has a getter and a setter *per attribute* (`ActivityName`, `SetActivityName`,
`ActivityIcon`, …); gnome-tasks has one `GetTask` returning the whole document as JSON and one
`SetTaskProperties` taking a dictionary. The reason is that a task carries far more than a name —
a captured layout, commands, per-adapter state — and the document is already a versioned JSON schema
on disk (see [state-schema.md](state-schema.md)). Mirroring it into D-Bus accessors would mean two
schemas to migrate instead of one.

**Dropped.** `PreviousActivity`/`NextActivity` are not on the bus: cycling is a *keyboard* concern, so
it lives in the extension, which knows the display order the user is actually looking at.

### `org.kde.ActivityManager.Resources` — and the surveillance question

Methods: `RegisterResourceEvent(application, windowId, uri, event)`, `RegisterResourceMimetype`,
`RegisterResourceTitle`.

This is how Plasma learns which documents belong to an activity: applications *tell it*, per window,
as the user opens and closes things. `ResourcesScoring` then keeps usage statistics in an SQLite
database under `~/.local/share/kactivitymanagerd/resources/`, and exposes `DeleteStatsForResource`,
`DeleteRecentStats` and `DeleteEarlierStats` — an interface whose existence says plainly that KDE
knew it was building something users would want to erase.

**Changed, and deliberately.** gnome-tasks does not have a scoring database, a usage history, or a
notion of how *often* a document was used. It records what a task has open *now*, overwriting it, and
it recovers that from outside the application (`/proc`, window titles, adapters — see
[app-adapters.md](app-adapters.md)) rather than asking applications to report every document they
touch. Reasons:

* Nothing on GNOME reports resources the way `KActivities`-aware KDE apps do, so the mechanism has no
  suppliers.
* A rolling history is a much bigger privacy surface than a current snapshot. What gnome-tasks offers
  instead is a global capture switch and an exclusion list, both persisted, both in the preferences
  window — and no history to delete because none is kept.

`RegisterResourceEvent` taking a `windowId` is worth noting for a different reason: on X11 that is
enough to tie a document to a window. Under Wayland there is no cross-client window id at all, which
is exactly the problem [gnome-internals.md](gnome-internals.md) documents and the reason gnome-tasks
correlates browser windows by *title*.

### `org.kde.ActivityManager.ResourcesLinking`

`LinkResourceToActivity`, `UnlinkResourceFromActivity`, `IsResourceLinkedToActivity`, plus signals.

**Dropped for now.** Explicitly pinning a file to an activity, independent of whether it is open, is a
genuinely nice feature — and it is not the same feature as "restore what I had open", which is what
this idea is about. It is not in `PLAN.md`, so it is not built; the D-Bus surface has room for it.

### `org.kde.ActivityManager.Features` and `.Application`

Plugin capability discovery and the daemon's own lifecycle. gnome-tasks has no plugin system to
discover: its adapters are compiled in and listed in [app-adapters.md](app-adapters.md), and tier-2
adapters register by calling `ReportAppState` rather than by being loaded.

## Where state lives

| | KDE | gnome-tasks |
| --- | --- | --- |
| activity/task list | `kactivitymanagerdrc`, keys `activities`, `runningActivities`, `currentActivity` | one JSON file per task under `~/.local/share/gnome-tasks/tasks/`, plus `state.json` |
| usage statistics | SQLite under `~/.local/share/kactivitymanagerd/resources/` | none, by choice |
| plugin settings | `kactivitymanagerd-pluginsrc` | none |

One file per task rather than one list is a small but deliberate difference: a corrupt or
half-written document then costs one task instead of all of them, which
[state-schema.md](state-schema.md) covers.

## Plugins, and what they say about scope

`src/service/plugins/` in 6.3.5: `activitytemplates`, `globalshortcuts`, `krunner`,
`libreoffice-spy`, `recentlyused-eventspy`, `runapplication`, `sqlite`.

Two are informative. **`runapplication`** is KDE's equivalent of gnome-tasks' per-task commands —
"run this when the activity starts" is evidently a want that survives contact with users.
**`libreoffice-spy`** is a plugin whose entire job is to watch one application because it does not
report its own documents; it is the same shape as this project's per-app adapters, and a good reminder
that the long tail is per-app work in every implementation of this idea.

## Adopt, change, drop — the summary table

| KDE behaviour | gnome-tasks |
| --- | --- |
| daemon owns state, compositor owns windows | **adopted**, for the same reasons |
| stopped ≠ removed | **adopted**, and load-bearing |
| name, icon, description per activity | **adopted** |
| switch by D-Bus, by switcher, by shortcut | **adopted** (shortcut is per task, plus cycle bindings) |
| applications report their own documents | **changed**: recovered from outside where possible, reported only by tier-2 adapters |
| usage scoring and history in SQLite | **dropped**: a snapshot instead, with a capture switch and exclusions |
| explicit resource linking | **dropped for now**, out of scope in `PLAN.md` |
| per-activity wallpaper and favourites | **dropped**, out of scope by decision |
| activity templates | **dropped** |
| per-activity window rules in the compositor | **changed**: no rule system; the daemon places windows through the extension, and a saved layout carries workspace, geometry and monitor |
| "run this on start" plugin | **adopted**, as commands in transient systemd scopes with a confirm-before-first-run rule KDE does not have |
