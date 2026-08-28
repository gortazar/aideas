status: in_progress
version: 0.1
started_at: 2026-08-28
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

## Units
- [x] U1 — reproducible environment and a green pipeline before any behaviour.
      `gortazar/meet` created and added here as the `upstream/` submodule. `flake.nix`
      exposes three checks — ESLint, the headless gjs suite, and the packed
      `.shell-extension.zip` assembled and inspected. `SONAR_TOKEN` set, `gortazar_meet`
      created and put on the **aideas uninstrumented** quality gate (the GJS one, with no
      coverage condition) rather than the org default `Sonar way`, whose 80%
      coverage-on-new-code condition no gjs project can meet.
- [x] U2 — the destinations model. `src/lib/destinations.js`: the two shipped rooms as
      ordinary frozen entries, and the rule that a destination is a label plus an absolute
      `https:` URL with a host. Nothing throws — a row broken by hand in dconf costs you
      that row, not the menu. 22 tests.
- [x] U3 — the launcher. `src/lib/launcher.js` over an injected launch seam, so the three
      failure states that cannot be arranged headlessly — a handler that refuses, a seam
      that raises on the calling frame, a machine with no browser — all have tests.
      `open()` never throws and never rejects. 15 tests.
- [x] U4 — the symbolic panel icon. An **original drawing** echoing the logo's arrangement
      (two overlapping bubbles, a play triangle), since the mark may not be vendored.
      Rasterised through the same GdkPixbuf/librsvg pair the shell draws it with and
      checked pixel by pixel. Both pixel assertions verified by mutation. 12 tests.
- [x] U5 — configurable destinations. A GSettings `a(ss)` whose schema default is the two
      rooms; `lib/settings.js`, `lib/editing.js` (what add / remove / move / restore *do*,
      as pure functions) and `prefs.js` (the Adwaita window, holding the working list so a
      half-typed address is not erased under the cursor). The schema is compiled under
      `--strict` in the suite and its default read back and held against the code's. Plus
      `hygiene.test.js`. 46 tests.
- [x] U6 — the panel button and its menu. `extension.js` wires U2–U5 together;
      `lib/menu.js` holds the menu's shape so the empty state is a test case. Teardown is
      asserted, not trusted. 12 tests.
- [x] U7 — the nested-shell smoke test. `ci/smoke-test.sh`: **27 checks, all passing on
      GNOME Shell 46.** The icon is *drawn* (12.6% inked; a missing icon measures 0.0%,
      verified by mutation), clicking a room really reaches a stub browser registered for
      `x-scheme-handler/https` and it records `https://meet.openvidu.io/`, emptying the
      rooms leaves a menu that says so, and five enable/disable rounds leave no timer
      behind. Screenshots taken from that run.
- [x] U8 — installer and README. `install.sh` fetches the packed zip from the latest
      release and verifies it against the published checksum; the README opens with that
      one command. `packaging.test.js` holds the installer, the README and the release
      workflow against each other. 14 tests. **126 headless tests in all, green.**
- [x] U9 — the wrapper. `flake.nix` running upstream's checks at the pinned commit,
      `scripts/check-pin.sh`, `scripts/check-release.sh`, `README.md`, and
      `.github/workflows/ci-meet.yml` fixed (it ran `nix flake check` in a directory with
      no flake).

**Pull request [#1](https://github.com/gortazar/meet/pull/1) is merged**
([ca3152d](https://github.com/gortazar/meet/commit/ca3152d)), with `check`, `package` and
`sonar / Analysis` green and the quality gate OK on 2175 new lines. The `upstream/` gitlink
and the `meet-src` flake input both name that commit, which is on `origin/main`.

Next: confirm the `v0.1` release workflow published its assets
(`scripts/check-release.sh`), then verify the installer from a clean directory against the
published zip. Until both are done this is `in_progress`, because a release nobody
downloaded is a guess.

## Notes

**The answered open questions changed the plan in three places**, and the units above
reflect the answers rather than the original draft:

- The OpenVidu logo **may not be vendored**. There is no remote fetch, no bundled PNG and
  no `scripts/refresh-logo.sh`; the panel carries an **original symbolic icon** drawn to
  resemble the logo's arrangement — overlapping speech bubbles with a play triangle — in
  the single colour GTK recolours symbolic icons with.
- The two URLs **must be configurable**, with a preferences dialog that can add entries.
  That made the schema and preferences a unit of its own, which the draft plan did not
  have, and the menu is built from settings rather than from a constant.
- "A new browser window" is satisfied by whatever the **default handler** does, so the
  launch is `Gio.AppInfo.launch_default_for_uri_async` and nothing spawns a browser.

**One thing was added that the draft plan does not list**: the menu ends with a `Rooms…`
item that opens the preferences. It follows from the configurability answer rather than
extending it — with every room removable, a menu with none left would otherwise be a dead
end, nothing to click and no way from there to the window that would fix it.

**Two findings from the nested shell are recorded in the code**, because both are the kind
of thing that looks fine in a diff:

- `Adw.ExpanderRow.add_suffix` puts widgets on screen in the reverse of the order they were
  added, which had the delete button nearest the room's name. The buttons now go in one
  `Gtk.Box`.
- A pixel measurement **cannot** tell a working preferences page from a broken one.
  Calibrated by making `fillPreferencesWindow` throw: GNOME's resulting error page scored
  1.63% dark against the real page's 0.42%, so the obvious "did it draw anything" check
  passes on the broken case. What catches it is the log line `Failed to open preferences`,
  emitted by the prefs process, which carries no uuid and so slipped through the existing
  scan. The scan now looks for it, and both directions are verified.

A synthetic pointer click into the preferences window was tried and dropped: it does not
reach GTK clients under headless Wayland, and a click that silently misses is worse than no
click. The preferences window's own construction is covered by the 46 tests on
`lib/editing.js` and `lib/settings.js`, and its failure to build is covered by the log scan
above.

Difficulty estimate: easy, as planned — one unit larger than the draft, because the
preferences dialog was added by an answered question.
