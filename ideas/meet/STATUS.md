status: in_progress
version: 0.1
started_at: 2026-08-28
last_session_id: 259b11be-e715-4112-802e-a582b86d5fb9
last_run: 2026-08-28T09:44:44+02:00
last_cycle_cost_usd: 0.0

## Log
- 2026-08-28T09:44:44+02:00 — in_progress ($0.0)


## Units
- [x] U1 — reproducible environment and a green pipeline before any behaviour.
      `gortazar/meet` created, added here as the `upstream/` submodule. `flake.nix`
      exposes three checks — ESLint, the headless gjs suite, and the packed
      `.shell-extension.zip` assembled and inspected — all green locally. CI runs them
      on push and pull request and calls `gortazar/aideas` `sonar.yml@v1`.
      `SONAR_TOKEN` set, `gortazar_meet` created and put on the **aideas
      uninstrumented** quality gate (the GJS one, with no coverage condition), not the
      org default `Sonar way`, whose 80% coverage-on-new-code condition no gjs project
      can meet. Draft pull request
      [#1](https://github.com/gortazar/meet/pull/1) open.
- [x] U2 — the destinations model. `src/lib/destinations.js`: the two shipped rooms as
      ordinary frozen entries, and the rule that a destination is a label plus an
      absolute `https:` URL with a host. Nothing throws — a row broken by hand in dconf
      costs you that row, not the menu. 22 tests.
- [x] U3 — the launcher. `src/lib/launcher.js` over an injected launch seam, so the
      three failure states that cannot be arranged headlessly — a handler that refuses, a
      seam that raises on the calling frame, a machine with no browser — all have tests.
      `open()` never throws and never rejects. 15 tests.
- [x] U4 — the symbolic panel icon. An **original drawing** echoing the logo's
      arrangement (two overlapping bubbles, a play triangle), since the mark may not be
      vendored. Rasterised through the same GdkPixbuf/librsvg pair the shell draws it
      with and checked pixel by pixel: it decodes at 16 and 32, something is drawn and it
      is not a block, the play triangle is a hole, the two bubbles stay apart. Both pixel
      assertions verified by mutation. 12 tests.
- [x] U5 — configurable destinations. A GSettings `a(ss)` whose schema default is the two
      rooms; `lib/settings.js` (the only file that knows the stored form),
      `lib/editing.js` (what add / remove / move / restore *do*, as pure functions), and
      `prefs.js` (the Adwaita window, holding the working list so a half-typed address
      is not erased under the cursor). The schema is compiled under `--strict` in the
      suite and its default read back and held against the code's. Plus
      `hygiene.test.js`. 46 tests. **100 in all, green under `nix flake check`.**
- [ ] U6 — the panel button and its menu
- [ ] U7 — the nested-shell smoke test and screenshots
- [ ] U8 — installer, README, wrapper glue and the v0.1 release

Next: U6 — `extension.js`: the panel button carrying the symbolic icon, a menu built from
the stored destinations, and a `disable()` that gives back every widget, signal and menu
item it took.

`main` on `gortazar/meet` is protected by the `main protected` ruleset: a pull request,
and `check`, `package` and `sonar / Analysis` all green, with no bypass actors.

## Notes

**The answered open questions changed the plan in three places**, and the units above
reflect the answers rather than the original draft:

- The OpenVidu logo **may not be vendored**. There is no remote fetch, no bundled PNG and
  no `scripts/refresh-logo.sh`; the panel carries an **original symbolic icon** drawn to
  resemble the logo's arrangement — overlapping speech bubbles with a play triangle — in
  the single colour GTK recolours symbolic icons with.
- The two URLs **must be configurable**, with a preferences dialog that can add entries.
  That makes U5 (schema + preferences) a unit of its own, which the draft plan did not
  have, and the menu is built from settings rather than from a constant.
- "A new browser window" is satisfied by whatever the **default handler** does, so the
  launch is `Gio.AppInfo.launch_default_for_uri_async` and nothing spawns a browser.

Difficulty estimate: easy, as planned — but one unit larger than the draft, because the
preferences dialog is now in scope.
