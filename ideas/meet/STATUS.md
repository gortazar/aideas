status: done
version: 0.1
started_at: 2026-08-28
last_session_id: 259b11be-e715-4112-802e-a582b86d5fb9
last_run: 2026-08-28T10:09:49+02:00
last_cycle_cost_usd: 23.70250049999999

## Log
- 2026-08-28T10:09:49+02:00 — done ($23.70250049999999)


### 2026-08-28 — done (0.1: one click from the top bar into an OpenVidu Meet room)

A button in the GNOME Shell top bar whose menu lists your meeting rooms. Click one and it
opens in your default browser. **Meet next** and **Meet** ship with it as ordinary
entries — renameable, repointable, reorderable, removable — and a preferences window adds
your own.

- **Released**: [v0.1](https://github.com/gortazar/meet/releases/tag/v0.1) from
  [ca3152d](https://github.com/gortazar/meet/commit/ca3152d), the merge of pull request
  [#1](https://github.com/gortazar/meet/pull/1). Both assets published — the packed
  extension and its SHA-256 — and `scripts/check-release.sh` confirms the zip contains
  everything the shell needs and declares the right uuid.
- **Install-verified** from a clean directory, with `HOME` and `XDG_DATA_HOME` redirected so
  it could not touch this machine's session: the published installer downloaded the asset,
  the checksum matched, 13 files landed, and `gnome-extensions enable` succeeded.
- **The published artefact itself was run in a real headless GNOME Shell 46** — not just
  downloaded. The zip whose sha256 is `e1d35d26…`, the one on the release page, passes all
  27 smoke-test checks: the icon is drawn, the menu lists both rooms, clicking **Meet**
  reaches a stub browser with `https://meet.openvidu.io/`, and five enable/disable rounds
  leave no timer behind.
- **126 headless tests** under plain `gjs`, green in `nix flake check` alongside ESLint and
  the packed zip assembled and inspected.
- **Quality gate green** on `main`, all ratings A, 0 bugs, 0 vulnerabilities, 0 code smells,
  0% duplication, and **no open issues of any severity** — the five Sonar found were fixed
  rather than dismissed. `CI` on `main` is green at
  [6fae6b7](https://github.com/gortazar/meet/commit/6fae6b7).

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
      `x-scheme-handler/https`, emptying the rooms leaves a menu that says so, and five
      enable/disable rounds leave no timer behind. The screenshots come from that run.
- [x] U8 — installer and README. `install.sh` fetches the packed zip from the latest
      release and verifies it against the published checksum; the README opens with that
      one command. `packaging.test.js` holds the installer, the README and the release
      workflow against each other. 14 tests. **126 headless tests in all.**
- [x] U9 — the wrapper. `flake.nix` running upstream's checks at the pinned commit,
      `scripts/check-pin.sh`, `scripts/check-release.sh`, `README.md`, and
      `.github/workflows/ci-meet.yml` fixed — it ran `nix flake check` in a directory that
      has no flake.
- [x] U10 — release, and verifying it. `v0.1` tagged and published; the published zip run
      in the nested shell through the new `MEET_INSTALL_ZIP` path (pull request
      [#2](https://github.com/gortazar/meet/pull/2)), and the five Sonar findings fixed
      (pull request [#3](https://github.com/gortazar/meet/pull/3)).

## What "done" covers

Every feature in `PLAN.md`, as amended by the answered open questions: the panel button and
its symbolic icon, the two-room menu built from configurable settings, the launch through
the desktop's own default handler, the visible-and-harmless failure path, the preferences
dialog that can add, edit, reorder and remove entries, review-rules compliance, the headless
suite, the icon tested as an image, the nested-shell smoke test, the reproducible
environment and green CI, the installer, and the wrapper here.

Three pull requests, all merged, all with `check`, `package` and `sonar / Analysis` green.
No open Sonar issue at any severity, so nothing is documented as a false positive — there
was nothing to document.

**The release is `v0.1` = `ca3152d`.** Two follow-ups landed on `main` after it: the
`MEET_INSTALL_ZIP` smoke-test path, which is test tooling and is not in the packed zip at
all, and the Sonar fixes, which are `catch {` in place of `catch (e) { void e; }` and one
`push` in place of three — no behaviour change. Neither is worth moving a published tag for;
both ship with the next version. The `upstream/` gitlink and the `meet-src` flake input
point at `main`'s head, which is where the work is.

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
  launch is `Gio.AppInfo.launch_default_for_uri_async` and nothing spawns a browser. This
  is stated in the extension's own README, because it is the first thing a user will
  notice: a running browser opens a tab.

**One thing was added that the draft plan does not list**: the menu ends with a `Rooms…`
item that opens the preferences. It follows from the configurability answer rather than
extending it — with every room removable, a menu with none left would otherwise be a dead
end, nothing to click and no way from there to the window that would fix it.

**Findings worth keeping, all of the kind that look fine in a diff:**

- `Adw.ExpanderRow.add_suffix` puts widgets on screen in the reverse of the order they were
  added, which had the delete button nearest the room's name. The buttons now go in one
  `Gtk.Box`, which packs in the order written. Found by looking at the nested shell's
  screenshot, not by reading the code.
- A pixel measurement **cannot** tell a working preferences page from a broken one.
  Calibrated by making `fillPreferencesWindow` throw: GNOME's resulting error page scored
  1.63% dark against the real page's 0.42%, so the obvious "did it draw anything" check
  passes on the broken case. What catches it is the log line `Failed to open preferences`,
  emitted by the prefs process — which carries no uuid and so slipped through the existing
  scan. The scan now looks for it, and both directions are verified.
- A synthetic pointer click into the preferences window does not reach GTK clients under
  headless Wayland. Tried and dropped: a click that silently misses is worse than no click.
- **The orchestrator's sweep had pushed a branch literally named `HEAD`** at the rescued
  commit. `github:gortazar/meet` then resolved to it, and the wrapper's first
  `nix flake lock` pinned a commit that was on no real branch. Deleted, and the lock redone
  explicitly against the merge commit; `check-pin.sh` now warns when a pin is not on
  `origin/main`.
- Auto-merge fires the moment checks go green. A commit pushed to a branch after arming it
  misses the merge and silently recreates the branch — which is how the Sonar fixes needed a
  third pull request. Arm it last.
- **The very first `sonar / Analysis` on `main` fails, and it is not a quality problem.**
  The run on `ca3152d` — the release commit — is red. Its gate status is `NONE`, not
  `ERROR`: Sonar computed no gate at all, because a first analysis has no new-code period
  to evaluate against, and the shared workflow reads anything other than `OK` as a failure.
  The next push to `main` computed a gate and went green, and so did the one after it. Worth
  knowing before someone reads that red mark as a verdict on the release; worth raising with
  `ideas/quality-gate` if a second new repository does the same, since the remedy belongs in
  the shared workflow and not here.

Difficulty estimate: easy, as planned — one unit larger than the draft, because the
preferences dialog was added by an answered question.
