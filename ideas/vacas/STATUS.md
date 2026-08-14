status: in_progress
version: 0.1
started_at: 2026-08-14
last_session_id: 2aab31b6-ac0c-4cab-8c08-70e5c1cbc553
last_run: 2026-08-14T20:02:19+02:00
last_cycle_cost_usd: 20.04429199999999

## Log
- 2026-08-14T20:02:19+02:00 — in_progress ($20.04429199999999)

2026-08-14 (later) — U7 to U11 done and U12 all but the release itself. The extension is
complete and green: 100 tests plus 5 Playwright specs, `web-ext lint` clean, `nix flake
check` green. **Blocked on one thing only:** signing. There is no release, because release
Firefox refuses an unsigned add-on and this repository has no AMO API key — see the new
question in PLAN.md. Everything around the release is built and tested: the workflow signs
and publishes on a `v*` tag, and `install.sh` was run end to end against a locally built
asset (it correctly refused the unsigned build, and installed a signature-bearing one into
a sandbox profile).

2026-08-14 — U1 and U2 done. The research risk the plan called the biggest one turned out
to be surmountable: rentalia.com answers 403 to curl and to headless Chromium, but
Playwright's Firefox gets a 200, so the listing and search pages were captured for real
and are committed as fixtures. The success panel (`div.sentMessage`) is already in the
page, hidden by `ng-hide` — so "the enquiry was sent" is observable without ever sending
one, which is what the second open question asked for. There is no `<form>` element on the
page at all, so capture must be a capture-phase click, never a `submit` listener.

## Units
- [x] U1 — research and fixtures: listing, listing-sent, listing-restyled,
      listing-redesigned, search-results captured and scrubbed; `docs/rentalia-research.md`
      written from them.
- [x] U2 — skeleton: MV3 manifest with rentalia as an *optional* host permission, event
      page, popup, `flake.nix`, upstream CI, `web-ext lint` clean, Playwright specs
      guarding the fixtures. `nix flake check` green here and upstream.
- [x] U3 — identity and dates, pure: reference and locale from any URL shape, date
      normalisation to ISO, the dedup key, and the exact/overlap/reference-only rule.
- [x] U4 — the store over `storage.local`, with a schema version, a migration path, quota
      reporting and de-duplicating import.
- [x] U5 — the versioned site profile and form detection, against the fixtures. Two
      failure fixtures: a restyle the fallback chains survive, and a redesign they must not.
- [x] U6 — two-phase capture: stage on press, commit on `div.sentMessage`, discard on a
      visible validation error or on timeout. 13 behaviours under test.
- [x] U7 — the toolbar toggle: optional permission requested from the popup's click
      handler, content script registered dynamically, permission handed back on switch-off,
      revocation from about:addons believed. 9 behaviours under test.
- [x] U8 — passive alerts: markers on search cards and a dismissible listing banner, worded
      by exact / overlap / reference-only. No send interruption, per the fourth answer.
- [x] U9 — the popup: history newest first, free-text search, per-record delete, clear,
      JSON export and de-duplicating import.
- [x] U10 — profile health checked on every page, not only at a send; the badge warns and
      the popup names the parts that stopped matching; a page understood again clears it.
- [x] U11 — live verification of the profile against the real site, recorded in
      `docs/manual-verification.md` with the human checklist for the half no script can do.
- [~] U12 — packaging done and tested; the **release is blocked** on AMO credentials.
      Built: the signing/release workflow, `install.sh` (verified end to end against a
      local asset, both the refuse-unsigned and the install paths), README opening with the
      install command, screenshots from the real code, `nix build` producing the `.xpi`.
      Missing: `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`, and therefore the `v0.1` tag.

Next: nothing — blocked. The new question in `PLAN.md` asks for the AMO API key. Once the
two secrets exist in github.com/gortazar/vacas, U12 is: set the tag `v0.1`, let the
workflow sign and publish, then install the published asset in a clean Firefox profile and
set `status: done`.

## Notes
- Upstream: https://github.com/gortazar/vacas — pinned at 13062a9. 100 tests passing
  (`npm test`), 5 Playwright specs, `web-ext lint` clean, `nix flake check` green.
- The live check on 2026-08-14 found the profile reading a real listing by every *primary*
  strategy. The search page could not be re-checked: Cloudflare rate-limits repeated loads
  and answered 403. That is recorded as blocked rather than as a failure.
- One thing this session could not do: `.gitmodules` still has no entry for
  `ideas/vacas/upstream`. The gitlink is committed and correct, but editing that file needs
  approval, so a fresh clone cannot resolve the submodule until three lines are added:
  `[submodule "ideas/vacas/upstream"]`, `path = ideas/vacas/upstream`,
  `url = https://github.com/gortazar/vacas.git`.
- Difficulty estimate: **hard**, and the remaining hardness is entirely the AMO account.
  The research is done, the DOM turned out to be legible, and the extension is finished.
