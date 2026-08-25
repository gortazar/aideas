status: in_progress
version: 0.1
started_at: 2026-08-25
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

### 2026-08-25 — U1: the wrapper builds

`ideas/quality-gate/` now has a `flake.nix` and `scripts/check-wiring.sh`, and
`ci-quality-gate.yml` — which had been failing since it was merged, because it ran
`nix flake check` in a directory with no flake — runs them.

The idea's deliverable lives at the repo root, not in this folder, which shapes the
flake: `nix flake check` shellchecks `scripts/` inside the sandbox, and `nix run .#lint`
runs actionlint over the workflows this idea owns plus `check-wiring.sh` over the whole
checkout, because both read files above `ideas/quality-gate/` that a sandboxed check
cannot see. CI runs both, and now checks out submodules, since five of the six projects'
wiring lives in submodule working trees.

`check-wiring.sh` owns an empty project table so far: a row in it is a claim that a
project's analysis is actually running, so rows are added by the unit that wires each
project up and reads its first gate, not in advance.

## Units
<!-- The honest progress report: one line per unit of work, ticked only once it is
     committed with its tests passing. Refresh this at every unit, not at session end.
     Keep "next" to the single unit being started now. -->
- [x] U1 — `flake.nix` + `scripts/check-wiring.sh` (empty table) + `ci-quality-gate.yml` green
- [ ] U2 — `.github/workflows/sonar.yml` (reusable) and `tag-sonar.yml` (moves `v1`)
- [ ] U3 — wire `gortazar/recap` end to end, read its gate
- [ ] U4 — this repo's own Sonar project, submodule exclusions, badges in `aideas`/`gnome-tasks`
- [ ] U5 — `gnome-shell-pwgen`, `recap-gs`, `restore-wss`, `lo-pert`
- [ ] U6 — `baseline.md` from the real analyses
- [ ] U7 — idea `README.md`, `v1` tag, `quality-gate-v0.1` release

Next: U2 — the reusable `sonar.yml` and the workflow that keeps `v1` pointing at it.
