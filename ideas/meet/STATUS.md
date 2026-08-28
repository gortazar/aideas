status: in_progress
version: 0.1
started_at: 2026-08-28
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

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
- [ ] U2 — the destinations model: the two defaults, their order, and the https-only rule
- [ ] U3 — the launcher, with an injected AppInfo seam
- [ ] U4 — the symbolic panel icon, tested as an image
- [ ] U5 — settings schema and the preferences window (add / edit / remove entries)
- [ ] U6 — the panel button and its menu
- [ ] U7 — the nested-shell smoke test and screenshots
- [ ] U8 — installer, README, wrapper glue and the v0.1 release

Next: U2 — `src/lib/destinations.js`, with a test pinning the two default entries, their
order, and that every URL is absolute and `https:`.

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
