# Plan: restore-wss — browsers and the tabs inside them

Difficulty estimate: medium — the hard platform work (capture daemon, placement, snapshot, review UI)
already shipped in v0.1, so this is a well-trodden browser-extension + native-messaging bridge; what
keeps it off "easy" is correlating a compositor window with a browser window, snap/Flatpak
confinement of the messaging host, and the distribution question for a browser add-on.

This is a **minor** update: v0.1 → **v0.2**.

## Context

v0.1 restores applications, documents, terminals and the VPN, and places every window back on its
workspace. A browser is the one window it puts back empty-handed: `PLAN.md` for v0.1 deliberately
deferred tabs to this entry and left `session_protocol` and the tier-2 adapter slot open for it
(`docs/app-adapters.md`, `docs/state-schema.md`). This entry fills that slot.

Four things shape the work before any feature list.

1. **Tabs exist nowhere the daemon can read them — reliably.** Firefox writes
   `sessionstore-backups/recovery.jsonlz4` and Chrome writes SNSS `Sessions/Session_*` files, and
   both can be parsed offline (`lz4json`, `chrome-session-dump`). Both are undocumented internal
   formats, written on the browser's own cadence, and neither says which *compositor* window a
   browser window is. They are a genuine fallback and the research must price them, but the
   headline answer is the browser reporting its own state — tier 2 in the existing adapter model.
2. **The browsers already restore themselves.** "Continue where you left off" brings back windows
   and tabs after a crash. What they do *not* do is put window 1 on workspace 3 and window 2 on
   workspace 6, which is precisely what `restore-wss` is for. So the minimum useful outcome is not
   "restore tabs" — it is **the right tabs in the right window on the right workspace**, without
   duplicating what the browser restored on its own.
3. **The sibling project already built one of these.** `ideas/gnome-tasks/browser/` is a working
   Firefox + Chrome extension with a native-messaging host that reports every non-private window's
   tabs (URL, title, pinned, active, debounced 2.5 s) and rebuilds them on demand, skipping windows
   that already show exactly those URLs. Per the answered question in v0.1's plan (option **c**:
   extract the shared core), that code is the starting point rather than a blank file, and the
   research report has to say explicitly whether it is reused, adapted or replaced.
4. **A `tabs` permission is the broadest trust in this whole tool.** Every URL the user visits
   becomes readable by the extension and lands in a snapshot on disk. The v0.1 privacy rules
   (local only, `0700`, exclusions, capture-time redaction) extend to browsing, and private/incognito
   windows are dropped in the extension *and* again in the daemon — the same belt-and-braces
   `gnome-tasks` uses.

Assumptions, stated rather than asked: GNOME 46 / Wayland on the development machine, as in v0.1;
tab *content* state (scroll position, form fields, per-tab back/forward history) is out of scope,
since reading it needs content scripts injected into every page — a much larger permission for a
much smaller return; multi-profile browsers record which profile a window belonged to but restore
into whatever profile the browser opens with if that profile cannot be selected from the command
line. The research report lands at `upstream/docs/browser-extensions-research.md`, which is inside
this idea folder as the entry asks and upstream as `AGENTS.md` requires — the same placement
`docs/similar-tools.md` got in v0.1.

## Features

- **In-depth research report** — `docs/browser-extensions-research.md`, written **first**, from
  reading the actual source and manifests rather than store descriptions, and allowed to change
  everything below it. It must cover, at minimum:
  - *Session managers that could be used as-is*: Tab Session Manager, Tab Stash, Session Buddy,
    OneTab, Tabs Outliner, Sync Tab Groups. For each: licence, whether it is open source, what its
    export format is, and — the deciding question — whether anything **outside the browser** can
    read its state or ask it to restore. A session manager with no machine-readable interface is
    not usable here no matter how good it is, and the report should say so plainly.
  - *Native-messaging bridges that already expose tabs to the desktop*: `brotab` (a CLI plus
    Firefox/Chrome extension that lists, activates and opens tabs — the strongest "use as-is"
    candidate), Tridactyl's native messenger, KDE's **Plasma Browser Integration** (published on
    AMO and the Chrome Web Store, with a D-Bus surface — does it expose tabs, and could a GNOME
    tool speak to it?), and `chrome-gnome-shell`/GNOME Shell integration as the packaging model for
    a host manifest that ships with a desktop app.
  - *Routes that need no extension at all*: Firefox's `recovery.jsonlz4` (mozlz4/lz4json),
    Chrome's SNSS session files (`chrome-session-dump`), Firefox Marionette and Chrome DevTools
    Protocol over `--remote-debugging-port`, and the browsers' own "restore previous session"
    settings. Each with what it gives, what it costs (a debugging port is an unauthenticated
    control channel on localhost), and whether it can identify a *window*.
  - *The sibling extension*: `gnome-tasks/browser/`, read from source, with a recommendation to
    reuse, adapt or replace, and what would have to change for it to serve a reboot rather than a
    task switch.
  - A closing table in the shape of `docs/similar-tools.md`'s section 8 — what `restore-wss` takes
    from each — and a go/no-go stating whether an existing extension is adopted or one is written.
- **Browser state in the snapshot** — the schema gains a per-window `browser` block: browser
  family and version, profile identity, the browser's own window id, and an ordered tab list of
  `{url, title, pinned, active, group}`. Versioned and migrated per `docs/state-schema.md`'s
  existing rules; a v0.1 snapshot stays readable, and a snapshot with no `browser` block restores
  exactly as it does today.
- **The tab reporter** — whatever the research chooses: a WebExtension (Firefox + Chromium-family
  from one `background.js`, as the sibling does) plus a native-messaging host that forwards to the
  existing `org.gnome.RestoreWss` daemon, or an adapter that speaks to a third-party extension
  already installed. Reports are debounced and rate-limited like every other capture path, and the
  daemon treats a browser that is not running, not extended, or silent as "no browser data" rather
  than an error.
- **Window ↔ browser-window correlation** — the crux, and the thing that decides whether this
  feature is useful. A `Meta.Window` with `wm_class` `firefox` has to be matched to the browser's
  own window id so the tab set is attached to the right workspace slot. Signals available: the
  active tab's title against the window title (Firefox and Chrome both title windows after the
  active tab), window count and creation order, focus order, and any window-identifying hint the
  extension can offer. The match carries a **confidence**, low confidence goes to the review step,
  and a window that cannot be matched degrades to "a browser window on this workspace, tabs
  unknown" — never to a wrong tab set.
- **Restore, without duplicating what the browser already did** — restore places browser windows on
  their recorded workspace and monitor like any other window, then reconciles tabs: a window whose
  URL set already matches is left alone, a window missing from the browser's own restore is created
  with its tabs (order, pinned state and active tab preserved where the API allows), and tabs are
  never appended blindly. Re-running `restore-wss restore` is idempotent for browsers exactly as it
  is for everything else. Restore waits a bounded time for the browser and its extension to come up,
  and reports what it gave up on.
- **Privacy and exclusions for browsing data** — private/incognito windows are never captured; the
  existing `config.toml` gains URL-pattern and domain exclusions and a switch to store titles only,
  URLs only, or neither (window shape but no content); browser capture can be turned off entirely
  while the rest of `restore-wss` keeps working. `docs/limitations.md` states what a `tabs`
  permission means in one paragraph a non-specialist can act on.
- **Review and CLI integration** — `status`, `list` and `diff` report browser windows and tab counts
  (and `--json` carries the block); the GTK/libadwaita review window lists each browser window with
  its tab count, a preview of the first few titles, and a skip toggle, using the widgets v0.1
  already has rather than a new UI.
- **Installation that covers the browser half** — `install.sh` and `make install` place the
  native-messaging host manifests for each supported browser in the right per-browser directory,
  including the snap and Flatpak paths where those are what is installed, and print the exact
  steps to load or install the extension. The v0.2 release carries the packaged extension
  (`.zip`/`.xpi` per browser) as a release asset alongside the existing ones.
- **Tests and green CI** — unit tests over committed fixtures: native-messaging frames (including a
  truncated one and an oversized one), tab-set diffing and dedupe, correlation scoring against
  recorded window/tab pairs, schema migration from a v0.1 snapshot, and URL redaction. The
  extension's pure logic is tested headless in the existing JS runner; the browser itself is a
  manual smoke test whose result is recorded in `STATUS.md`. `nix flake check` green upstream and
  here, plus the pin check.
- **README and docs updated, honestly** — a browser section in the README with a screenshot of a
  real restore that puts two browser windows with different tabs on two workspaces, plus updates to
  `docs/state-schema.md`, `docs/app-adapters.md` (tier 2 is real now, with the browser as its worked
  example) and `docs/limitations.md`.

## Approach

Sequenced so the research that can invalidate the design comes first, and so each milestone is a
unit that can be committed on its own.

1. **B0 — Research.** `docs/browser-extensions-research.md` and its go/no-go. Nothing else starts
   until this is written and its conclusions are reflected here in `STATUS.md`.
2. **B1 — Schema.** The `browser` block, migration from v0.1 snapshots, `status`/`diff`/`--json`
   showing it. Testable with fixtures and no browser at all.
3. **B2 — Capture.** The extension (or adapter), the native-messaging host, the daemon endpoint,
   debouncing, private-window exclusion. Deliverable: a real snapshot on this machine containing
   real tabs.
4. **B3 — Correlation.** Match browser windows to `Meta.Window`s, with confidence and the
   degrade-to-unknown path. Fixtures recorded in B2.
5. **B4 — Restore.** Placement plus tab reconciliation, idempotency, the bounded wait.
6. **B5 — Review, exclusions, installer, docs, screenshot, the v0.2 release** and a re-run of
   `tools/smoke-nested.sh` — which v0.1's `STATUS.md` flags as not having been re-run since M3, and
   which this entry should clear rather than inherit.

## Risks / things to verify early

- **Snap Firefox.** v0.1 found the machine's Firefox, LibreOffice and Codium are snaps, and that
  snapd refused to launch confined apps into the nested Shell. Snap Firefox reads native-messaging
  hosts from `~/snap/firefox/common/.mozilla/native-messaging-hosts/`, not the usual path, and the
  confinement may block the host binary outright. Verify this on day one of B2 — if the bridge
  cannot run at all, the fallback (`recovery.jsonlz4` + placement only) becomes the plan, not a
  footnote.
- **Unsigned add-ons do not persist in release Firefox.** A temporary add-on is forgotten on
  restart, which is fatal for a tool whose whole point is surviving a reboot. This is what the
  distribution open question below is about, and it is a hard blocker for the Firefox half.
- **Correlation may simply be ambiguous** with several windows of the same browser showing similar
  titles — the same failure mode `docs/limitations.md` already records for terminal tabs. Design the
  review step so a wrong match is correctable, and say so in the docs rather than pretending.
- **A tab set is a moving target.** The browser restores its own windows while `restore-wss` is
  placing them; reconciliation runs against a session that is still settling. Bounded waits and
  "leave it alone if it already matches" are the defence.
- **Chrome's extension id is generated at load time**, and the host manifest has to name it — an
  install step that cannot be fully automated for an unpacked extension. Document it; the sibling
  project hit the same wall.
- **Scope creep into a session manager.** Named sessions, tab search and history are other people's
  products. This entry restores what was open at power-off, nothing more.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] Which browsers must be supported? Firefox only (what is installed here, as a snap), or also
      the Chromium family (Chrome/Chromium/Brave/Edge)? One `background.js` can serve both, but each
      browser adds its own host-manifest path, packaging, install instructions and manual testing. Just Firefox 
- [x] How is the browser extension distributed? Options: (a) publish signed to addons.mozilla.org
      and the Chrome Web Store — the only way an add-on survives a restart in release Firefox, but
      it needs developer accounts, a one-off Chrome Web Store fee and review latency; (b) unsigned,
      loaded locally, as `gnome-tasks` chose — which conflicts with this repo's "installs without
      compiling" rule and, in Firefox, with add-on persistence; (c) ship a signed `.xpi` as a
      release asset via AMO's self-distribution signing, and unpacked for Chrome. Which? c
- [x] If the research finds an existing third-party extension that does the job (e.g. `brotab`), is
      depending on it acceptable — the user installs and trusts an add-on with the `tabs` permission
      that this project does not control and cannot fix — or should `restore-wss` own the extension
      code even where an off-the-shelf one would work? every extension needs to be reviewed first by me before adding it as a dependency.
- [x] Should the browser's own "restore previous session" stay on, with `restore-wss` only placing
      windows and reconciling differences, or should `restore-wss` turn it off and own tab
      restoration entirely? Leaving it on preserves per-tab history and scroll position that no
      extension can restore, but makes duplicate-tab avoidance a race; taking it over is
      deterministic but loses that state. on
