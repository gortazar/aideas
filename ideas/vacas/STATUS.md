status: in_progress
version: 0.1
started_at: 2026-08-14
last_session_id: 2aab31b6-ac0c-4cab-8c08-70e5c1cbc553
last_run: 2026-08-14T20:02:19+02:00
last_cycle_cost_usd: 20.04429199999999

## Log
- 2026-08-14T20:02:19+02:00 — in_progress ($20.04429199999999)


2026-08-14 — U1 and U2 done. The research risk the plan called the biggest one turned out
to be surmountable: rentalia.com answers 403 to curl and to headless Chromium, but
Playwright's Firefox gets a 200, so the listing and search pages were captured for real
and are committed as fixtures. The success panel (`div.sentMessage`) is already in the
page, hidden by `ng-hide` — so "the enquiry was sent" is observable without ever sending
one, which is what the second open question asked for. There is no `<form>` element on the
page at all, so capture must be a capture-phase click, never a `submit` listener.

## Units
- [x] U1 — research and fixtures: listing, listing-sent, listing-mangled, search-results
      captured and scrubbed; `docs/rentalia-research.md` written from them.
- [x] U2 — skeleton: MV3 manifest with rentalia as an *optional* host permission, event
      page, popup, `flake.nix`, upstream CI, `web-ext lint` clean, Playwright specs
      guarding the fixtures. `nix flake check` green here and upstream.
- [x] U3 — identity and dates, pure: reference and locale from any URL shape, date
      normalisation to ISO, the dedup key, and the exact/overlap/reference-only rule.
- [x] U4 — the store over `storage.local`, with a schema version, a migration path, quota
      reporting and de-duplicating import.
- [x] U5 — the versioned site profile and form detection, against the fixtures. Two
      failure fixtures now: a restyle the fallback chains survive, and a redesign they
      must not.
- [x] U6 — two-phase capture: stage on press, commit on `div.sentMessage`, discard on a
      visible validation error or on timeout. 13 behaviours under test.
- [ ] U7 — the toolbar toggle, optional permission request, dynamic script registration.
- [ ] U8 — passive alerts: search-card markers and the listing banner (no send interruption
      — the fourth open question chose markers only).
- [ ] U9 — the popup: history, search, delete, export/import.
- [ ] U10 — profile-mismatch reporting and the warning badge.
- [ ] U11 — manual verification against the live site, recorded.
- [ ] U12 — packaging, signed release, install path.

Next: U7 — the toolbar toggle, the optional permission request and dynamic
content-script registration.

## Notes
- Upstream: https://github.com/gortazar/vacas — pinned at dda0dd6, 58 tests passing
  (`npm test`) plus 5 Playwright specs against the fixtures.
- Difficulty estimate: still **hard**, but the reason has changed. The research is done and
  the DOM turned out to be legible; what remains hard is U12, which needs AMO signing
  credentials (`AMO_JWT_ISSUER` / `AMO_JWT_SECRET`) in the upstream repository's secrets.
  Nobody can create those from here.
