status: in_progress
version: 0.1
started_at: 2026-08-25
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

### 2026-08-25 — U2: the reusable workflow and the tag that carries it

`.github/workflows/sonar.yml` is the workflow `AGENTS.md` has been telling every idea to
call since before it existed. `workflow_call`, seven inputs, one optional secret;
`SonarSource/sonarqube-scan-action@v8.2.1` (the `sonarcloud-github-action` it replaced is
deprecated); `fetch-depth: 0`, because Sonar attributes new code by git blame and against
a shallow clone every line looks new. `SONAR_HOST_URL` is deliberately unset — the action
targets SonarQube Cloud when it has no host.

An absent `SONAR_TOKEN` prints one notice and succeeds. Fork pull requests get no secrets
at all, and a repository can be wired before its token is set; an advisory gate that
turned those red would be switched off within a week.

`.github/workflows/tag-sonar.yml` force-moves `v1` to any push to `main` touching
`sonar.yml`. Callers pin the major tag, so a fix reaches all six without editing any of
them — and no agent has to push a tag from a worktree, which would never arrive.

`check-wiring.sh` now asserts both ends of that reference: `sonar.yml` exists and has a
`workflow_call` trigger, `tag-sonar.yml` exists and pushes `refs/tags/v1`. Verified by
hiding `sonar.yml` and watching the check fail. actionlint is clean on both files.

Nothing calls it yet, and nothing can: `@v1` does not exist until this branch is merged
and `tag-sonar.yml` runs on `main`.

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
- [x] U2 — `.github/workflows/sonar.yml` (reusable) and `tag-sonar.yml` (moves `v1`)
- [ ] U3 — wire `gortazar/recap` end to end, read its gate
- [ ] U4 — this repo's own Sonar project, submodule exclusions, badges in `aideas`/`gnome-tasks`
- [ ] U5 — `gnome-shell-pwgen`, `recap-gs`, `restore-wss`, `lo-pert`
- [ ] U6 — `baseline.md` from the real analyses
- [ ] U7 — idea `README.md`, `v1` tag, `quality-gate-v0.1` release

Next: U3 — wire `gortazar/recap` to it and read the first real gate.
