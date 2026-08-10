status: in_progress
version: 0.1
started_at: 2026-08-10
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

### 2026-08-10
Started against a finished `recap`: its `--json` is schema version 1, documented in
`ideas/recap/README.md`, and this extension is written against exactly that.

## Units
<!-- The honest progress report: one line per unit of work, ticked only once it is
     committed with its tests passing. Refresh this at every unit, not at session end.
     Keep "next" to the single unit being started now. -->
- [x] M1 — skeleton: flake (dev shell, `nix build`, `nix flake check` running lint, the
      headless suite, schema compile and pack validation), `metadata.json` for GNOME 46-50,
      a GSettings schema, an extension that enables and disables cleanly, the shipped
      symbolic icons, and `src/lib/contract.js` — the schema version, recap's six status
      words, their icons and their urgency order. 11 tests.
- [ ] M0 — `recap --json` fixtures + `docs/recap-json-contract.md`
- [ ] M2a — decode and version-check a recap document
- [ ] M2b — row model: projects, sessions, filters, ordering
- [ ] M2c — panel summary: counts and the worst-state-wins icon
- [ ] M2d — error classification: missing binary, garbage, timeout, empty
- [ ] M3 — live subprocess seam: async, timeout, cancellation, stale data
- [ ] M4 — UI: indicator, menu rows, refresh on open, lock/idle suppression
- [ ] M5 — preferences window wired to the GSettings keys
- [ ] M6a — click-through: resume the session in a terminal, in its own directory
- [ ] M6b — leak test: enable/disable repeatedly with nothing left behind
- [ ] M6c — README, screenshots

Difficulty estimate: medium, as planned. recap being finished removes the risk the plan
called biggest; what is left is the compositor-side work (no blocking, nothing leaked) and
proving it in a real shell.

Next: M0 — record `recap --json` fixtures covering every status, an empty result and a
malformed session, and write the contract document naming schema version 1.
