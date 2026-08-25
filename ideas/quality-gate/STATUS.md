status: blocked
version: 0.1
started_at: 2026-08-25
last_session_id: 0c56aa7b-8858-406c-8f49-2c49a15d0727
last_run: 2026-08-25T13:11:09+02:00
last_cycle_cost_usd: 3.1778349999999995

## Log
- 2026-08-25T13:11:09+02:00 — blocked ($3.1778349999999995)


### 2026-08-25 — Blocked on the SonarQube Cloud token; docs written meanwhile

**U3 onwards cannot start.** Everything after U2 needs an analysis to have run, and no
analysis can run: no repository has a `SONAR_TOKEN`, and GitHub Actions secrets cannot be
copied from one repository to another. A new open question in `PLAN.md` answers the two
questions the first answer came back with, and asks for the one thing still missing.

What I could establish without a token, so the next session does not re-derive it:

- The SonarQube Cloud organisation `gortazar` **exists**, and holds one project,
  `gortazar_casaos` — which confirms the plan's assumption that the key format is
  `gortazar_<repo-name>`.
- None of this entry's six projects exist in it yet.
- None of the six repositories has any Actions secret set at all (`gh secret list` is empty
  for each), so the token is not yet in `aideas` either.
- `gortazar` is a GitHub **User**, not an Organization, so there is no account-level secret
  to share one copy of the token from. Each repository needs its own copy.

Written while blocked, because neither needs a measurement:

- `README.md` — the five lines that wire an idea up, the input table, what the token is and
  why every repository holds its own, what `v1` means and how it moves, and the anonymous
  API calls that re-read the baseline. This is the "installation" for a reusable workflow;
  there is no binary to ship.
- `baseline.md` — the method, and the two sections that are already final: `title-slides`
  is out of scope because SonarQube Cloud does not analyse Lua, and `vacas`/`wg` have no
  repository yet. The six measured sections are deliberately absent rather than stubbed:
  `check-wiring.sh` treats a section here as evidence the analysis ran, so a placeholder
  would be a lie it could not catch.

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
- [x] U1 — `flake.nix` + `scripts/check-wiring.sh` (empty table) + `ci-quality-gate.yml` green
- [x] U2 — `.github/workflows/sonar.yml` (reusable) and `tag-sonar.yml` (moves `v1`)
- [ ] U3 — wire `gortazar/recap` end to end, read its gate
- [ ] U4 — this repo's own Sonar project, submodule exclusions, badges in `aideas`/`gnome-tasks`
- [ ] U5 — `gnome-shell-pwgen`, `recap-gs`, `restore-wss`, `lo-pert`
- [ ] U6 — `baseline.md` from the real analyses (method and out-of-scope sections written;
      the six measured sections need an analysis)
- [ ] U7 — `v1` tag, `quality-gate-v0.1` release (idea `README.md` written)

Next: **blocked.** U3 — wire `gortazar/recap`, push twice, read its gate — needs a
`SONAR_TOKEN` in that repository. See the third open question in `PLAN.md`: the only thing
missing is the token value, and with it U3-U7 are one session's work.
