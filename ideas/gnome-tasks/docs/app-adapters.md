# Application adapters

"Which document is this window showing?" has no general answer on Linux. gnome-tasks therefore does
not have *a* mechanism; it has a registry of narrow, declared ones, and an application with no
adapter gets no documents at all. Guessing for an unknown application would restore the wrong file,
which is worse than restoring none.

Everything here was chosen from what the M0 probe actually observed — see
[gnome-internals.md](gnome-internals.md#document-recovery-tier-by-tier).

## The tiers

| Tier | Means | Restore does |
| --- | --- | --- |
| 0 | the application, and nothing about its contents | launches it with no arguments |
| 1 | the open file or folder is recoverable *from outside* the application | launches it with those URIs |
| 2 | full inner state, which only the application knows (browser tabs, editor projects, terminal tabs) | hands the state back to a cooperating plugin (M6) |

A tier is a property of the *adapter*, not of the application: the same app can be tier 1 when
launched with a file and tier 0 when D-Bus activated, which is exactly what the probe found for GNOME
apps.

## The interface

An adapter is a plain object in `src/lib/adapters/index.js`:

```js
{
    id: 'command-line',
    tier: 1,
    describes: 'the files an application was launched with, read from its command line — …',
    matches: record => COMMAND_LINE_APPS.has(record.appId),
    documents: (record, info) => [/* file:// or other URIs */],
}
```

* `record` is the window record from `src/lib/windowModel.js`: app id, title, pid, geometry, GTK
  object paths, and so on.
* `info` is what `src/daemon/procReader.js` gathered about the process: `cmdline`, `cwd`, `files`
  (interesting open file descriptors), `directories` (those that are directories), `home`, and either
  an `exists(path)` function or a precomputed `existing` list.
* `documents` returns URIs. Returning `[]` is always acceptable and always safe.

Adapters are **pure**. They never touch the file system, spawn anything or call D-Bus — that is why
every rule below has unit tests, and why the rules can be reasoned about without a compositor. The
first adapter matching a window wins, so specific adapters are listed before general ones.

To add one: append it to `ADAPTERS`, before `command-line` if it is app-specific, and add a suite to
`tests/unit/adapters.test.js`. The `describeAdapters()` test enforces that every adapter says what it
does, so this document cannot silently go stale.

## The adapters that exist

### `command-line` (tier 1) — one worked example

The workhorse, and exact when it applies. `gnome-text-editor ~/notes.txt` has the document right
there in `/proc/<pid>/cmdline`:

```js
documentsFor(window, {
    cmdline: ['/usr/bin/gnome-text-editor', '/home/u/notes.txt'],
    cwd: '/home/u',
}) // -> ['file:///home/u/notes.txt']
```

Rules, each with a test:

* flags (`-x`, `--long`) are skipped;
* URIs are passed through unchanged, so `sftp://` survives;
* relative arguments are resolved against the process's working directory;
* a path that no longer exists is dropped — restoring a deleted file achieves nothing;
* duplicates are collapsed;
* **the app-state filter does not apply here.** A file the user explicitly opened is a document
  wherever it lives, including `/tmp`.

It applies only to an explicit list of applications. Running it on everything would misread a
`--profile` directory or a "URL to open in the running instance" as a document.

Its blind spot is the GNOME default: an app launched through D-Bus activation shows
`['/usr/bin/gnome-text-editor', '--gapplication-service']` and this adapter correctly returns
nothing.

### `nautilus` (tier 1) — when the command line is useless

Nautilus is always D-Bus activated, so its arguments say nothing — but it holds a file descriptor
open on the directory it is showing, which the probe confirmed. This adapter takes the directory
descriptors and filters out the app's own state (`~/.local/share/nautilus/…`, `~/.cache/…`, `/tmp`,
`/run`). Unlike the command-line case, these paths are *incidental*, so filtering is right.

### `terminal` (tier 1, best effort) — the honest one

A terminal window belongs to `gnome-terminal-server`, whose pid and working directory have nothing to
do with the shell inside the tab. The only external trace of the shell's directory is the window
title, in the conventional `user@host:/path` form, so that is what this parses — expanding `~`, and
returning nothing at all when the title is not that shape (`vim notes.txt`, `htop`).

This is explicitly a heuristic on a user-configurable string. It recovers the *directory*; the shell
state inside the terminal cannot be recovered by anyone (see
[limitations.md](limitations.md)).

### `app-only` (tier 0) — the fallback

Matches everything, returns nothing. Reached by every application without a rule, and the reason an
unfamiliar app is restored empty rather than wrongly.

## Tier 2: browsers

A browser is the case tier 1 cannot touch. Its command line says nothing, its "documents" are tabs it
never writes to disk, and the interesting state is per *window*. So the browser reports itself:

```
browser extension  --(native messaging)-->  host  --(D-Bus)-->  org.gnome.Tasks.ReportAppState
org.gnome.Tasks.RestoreAppState  --(D-Bus)-->  host  --(native messaging)-->  browser extension
```

* `browser/` is the WebExtension — one `background.js` for both browsers, two manifests. It reports
  every normal window's tabs (URL, title, pinned, active), debounced 2.5 s, and rebuilds them on
  request.
* `src/native-host/gnome-tasks-browser-host.js` is the bridge. Native messaging is *browser*-initiated
  and speaks 4-byte-length-prefixed JSON on stdin/stdout, so the host lives as long as the browser
  keeps the port open, forwards reports to the daemon, and subscribes to `RestoreAppState` for the
  other direction.
* `src/lib/browserState.js` holds every rule about the payload, pure and unit tested: what a report
  must look like, which tabs are worth keeping, and the window correlation below.

**Private windows are never recorded**, and the report is dropped twice over — the extension filters
incognito windows, and the daemon filters them again on the way in. Internal pages (`about:`,
`chrome://`, `moz-extension://`) are not documents either.

### Window correlation, and where it gives up

`PLAN.md` calls this the hard part, and it is: a WebExtension window id and a `Meta.Window` share no
identifier, and Wayland offers no way to invent one. What they *do* share is the title — a browser
window's title is its active tab's title plus the browser's suffix. So `correlateBrowserWindows()`
matches `"Example — Mozilla Firefox"` to the browser window whose active tab is `"Example"`, claiming
each browser window at most once.

When that fails — duplicate titles, an empty title, a browser whose suffix format differs — the
window simply has no `browserWindowId`, and **the per-window split is lost**: restore reopens the
tabs, but the geometry that belonged to a specific browser window cannot be reattached to it. That is
the documented degradation from `PLAN.md`, chosen over guessing.

### What is not built yet in tier 2

* Placing the browser windows *after* the browser has rebuilt them. The daemon asks the browser to
  recreate windows and the browser decides where they land; re-correlating the new windows by title
  and then placing them is the obvious next step and is not done.
* Any tier-2 adapter other than a browser. `ReportAppState` takes an adapter id and refuses unknown
  ones, so adding an editor or a terminal multiplexer means extending `BROWSER_ADAPTERS` and giving
  it a state shape.

## What is not built yet
* **The freedesktop recent-files store** (`~/.local/share/recently-used.xbel`) as a source. The probe
  saw nothing written during its runs, so its usefulness is unverified rather than assumed.
* **`Meta.Window.get_gtk_window_object_path()` as a document source.** It identifies a window well
  enough to call the app back over D-Bus, but `org.gtk.Application` exposes no "what are you
  showing?" method — so it is an identity, not a document.
