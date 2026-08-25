status: done
version: 0.1
started_at: 2026-08-25
last_session_id: 0c56aa7b-8858-406c-8f49-2c49a15d0727
last_run: 2026-08-25T17:21:00+02:00
last_cycle_cost_usd: 18.3907995

## Log
- 2026-08-25T17:21:00+02:00 — in_progress ($18.3907995)
- 2026-08-25T13:11:09+02:00 — blocked ($3.1778349999999995)



### 2026-08-25 — U7: done at 0.1

**What `done` covers.** Every feature in `PLAN.md` is delivered and green:

- `.github/workflows/sonar.yml`, the reusable workflow `AGENTS.md` had been telling every
  idea to call since before it existed — seven inputs, one optional secret, `fetch-depth: 0`,
  coverage as an artifact input, and a missing token skipping loudly instead of failing.
- `.github/workflows/tag-sonar.yml`, which keeps `v1` on the current `sonar.yml`. Verified
  moving: `v1` is at `856feb1` because the last merge touched the workflow.
- Six SonarQube Cloud projects, created and configured from the API by
  `scripts/ensure-sonar-project.sh`, all analysed, all with a computed gate.
- Six repositories calling it, each with its own `sonar-project.properties`; coverage wired
  where the language has it built in (Go, Python).
- Badges in seven READMEs for six projects — `aideas` and `gnome-tasks` share one and say so.
- `baseline.md`, the deliverable this entry exists for: six sections written from real
  analyses, with dates, links, every condition's measured value and threshold, and what the
  numbers do and do not mean.
- `check-wiring.sh` owning all six rows, `read-measures.sh` to re-read the baseline without
  a token, `check-release.sh` to confirm the release afterwards, and a `flake.nix` running
  shellcheck and actionlint over all of it. `ci-quality-gate.yml` is green.
- `README.md`: the five lines that wire an idea up, the inputs, the token, what `v1` means.

**The release publishes on the merge.** `release-quality-gate.yml` is gated on this file
saying `status: done`, so setting it here is what fires it — the same arrangement as
`release-aideas.yml`, and necessary for the same reason: an agent cannot push a tag. It
creates `quality-gate-v0.1` with `sonar.yml`, `baseline.md` and `README.md` as assets, since
there is nothing to compile. **Confirm it afterwards with
`ideas/quality-gate/scripts/check-release.sh`**, which also checks the released `sonar.yml`
is byte-identical to the one `v1` resolves to. Run against the not-yet-published release it
correctly reports the release missing, so its failure path is tested.

**`title-slides` is out of scope and stays out**: SonarQube Cloud does not analyse Lua, and
`baseline.md` says so rather than substituting a different linter. `vacas` and `wg` have no
repository yet.

Nothing is blocked and nothing was left half-built. Two failures on `main` are recorded in
the U6 entry below as explicitly *not* this idea's: `CI - recap` and `CI - aideas` were both
already red before this entry started.

### 2026-08-25 — U6: all six measured, and the gate says something uncomfortable

The merge moved `v1` past the `pull-requests: read` fix, the four red runs were re-run, and
all six projects now have two analyses and a computed gate. `baseline.md` is written from
them, one section each, with the numbers, the dashboard links and what they actually mean.

**All six gates pass, and all six pass vacuously — 0 new lines each**, so Sonar evaluated
three ratings plus hotspots-reviewed over an empty set and silently dropped the coverage and
duplication conditions. That is partly an artefact of how a second analysis of the same
commit is what it takes to get a gate at all, but it is also the real risk: Sonar skips both
conditions whenever a period has under 20 new lines and reports `OK` while doing it.

The numbers a future blocking gate has to be chosen from are the whole-project ones:

| Project | Lines | Coverage | Dup | Bugs | Vulns | Smells | Rel/Sec/Maint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `aideas` | 8,239 | 0.0% | 1.7% | 3 | 8 | 107 | E / C / A |
| `restore-wss` | 4,557 | 62.4% | 0.0% | 0 | 0 | 42 | A / A / A |
| `recap` | 3,053 | 86.0% | 3.0% | 0 | 0 | 12 | A / A / A |
| `recap-gs` | 1,874 | 0.0% | 0.0% | 2 | 0 | 9 | E / A / A |
| `lo-pert` | 1,039 | 58.9% | 0.0% | 1 | 0 | 9 | C / A / A |
| `gnome-shell-pwgen` | 321 | 0.0% | 0.0% | 0 | 0 | 13 | A / A / A |

**Only `recap` clears the 80% coverage threshold.** The other two instrumented projects sit
at 62.4% and 58.9%, and the three GJS projects cannot be instrumented at all.

**Every rating below A is worth discounting**, which is the other thing entry 5 needs to
know. `recap-gs` is E because Sonar reports `spacing` in `src/stylesheet.css` as an unknown
CSS property, twice, at BLOCKER — GNOME Shell stylesheets are St's dialect, not CSS. This
repository is E for one GJS false positive too (`Gio.FileEnumerator.next_file()` read as a
loop variable that is never modified) and C for two `curl` calls that do not enforce HTTPS.
`lo-pert` is C for an assertion in a hypothesis property test — Sonar rates issues in
`sonar.tests` sources alongside production ones. The plan's GJS worry turned out to be
misplaced in one direction and right in another: `imports.gi.*` and `resource:///` produced
no findings at all across three GJS projects, but the **stylesheet** did.

Also unanticipated: **Sonar analyses shell scripts** — 662 lines of them in this repository,
and half its security findings.

`scripts/read-measures.sh` prints all of the above for any project, without a token, so the
baseline can be re-checked by anyone.

`check-wiring.sh` now owns all six rows and passes, which needed the `recap-gs` and
`lo-pert` pins bumping. Both were *already* drifted before this entry — gitlink and flake
input at different commits, so `check-pin.sh` was failing in both wrappers — and both now
agree, verified with `nix flake check` in each wrapper rather than assumed.

Two pre-existing failures on `main` that are not this idea's and were not touched:
`CI - recap` has been red since 2026-08-24 on the same `ideas/vacas/upstream` gitlink that
broke `ci-quality-gate.yml`, and `CI - aideas` fails a state-contract test
(`test_status_blocked_is_blocked_without_a_question_count`, `'ready' != 'blocked'`) that
started failing before this session.

### 2026-08-25 — U3, U4 and U5: six projects created, six repositories wired, one measured

The token arrived, so the whole of U3-U5 was doable. All six SonarQube Cloud projects now
exist, all six repositories call the shared workflow, and `gortazar_recap` has a real gate
reading in `baseline.md`. The other five are wired but not yet analysed — see the last
section below, which is the one thing this session could not finish and why.

**Onboarding took three steps the plan did not know about**, all now encoded in
`scripts/ensure-sonar-project.sh` so no future repository rediscovers them. The script reads
the token from the machine-local agent env file straight into a `curl --config` on stdin, the
same discipline as `scripts/set-repo-secret.sh`: never into argv, a file, a log or its own
output.

1. Projects created with `POST api/projects/create` — no browser step needed, and the key
   format `gortazar_<repo-name>` was right.
2. **Their main branch is called `master`.** An analysis of `main` then does not fail: it
   files itself as a short-lived *branch* named `main`, which accumulates no measures and
   whose gate is not the project's. recap's first analysis came back green with nothing
   readable behind it.
3. **They have no new-code period.** Without one there is no gate at all — `project_status`
   answers `NONE` and no `new_*` measure is computed, so two analyses look exactly like one.
   Set to `previous_version` on all six, the default a UI import would have given.

Automatic Analysis was off everywhere already; the conflict the plan anticipated never arose.

**recap's gate: OK, and vacuously so.** 0 new lines in the period, so Sonar skipped the
coverage and duplication conditions entirely — a blocking gate today would wave through any
commit under 20 lines without weighing the two things it exists for. The useful numbers are
whole-project: 3,053 lines of Go, **86.0% coverage**, duplication **3.0% against a 3%
threshold**, 0 bugs, 0 vulnerabilities, 12 code smells, A/A/A. Coverage is real, not assumed:
a `coverage` job runs `go test -coverprofile` and hands `cover.out` to the scan as an
artifact.

Two findings worth having: the first analysis counted 121 lines of "PL/SQL" — the SQLite
fixtures under `internal/opencode/testdata` — as production code, and excluding them halved
the reported code smells from 26 to 12 and took duplication from 3.6% to 3.0%.

**The one thing that is not finished: five projects have no numbers.** The reusable
workflow's job asked for `pull-requests: read`, and five of the six repositories have their
default workflow token set to *read repository contents*, where that permission is
ungrantable. GitHub refuses the run before any job starts: *"The nested job 'sonar' is
requesting 'pull-requests: read', but is only allowed 'pull-requests: none'."* `recap` is the
only repository whose default is `write`, which is why it was the only one that ran — and a
good argument for the plan's insistence on proving one project end to end first.

`sonar.yml` no longer asks for it (the SonarQube Cloud GitHub App decorates pull requests
with its own token, not this one). But callers pin `@v1`, and `v1` only moves when
`tag-sonar.yml` runs on `main`, which is after this branch is merged. **So `recap-gs`,
`gnome-shell-pwgen`, `restore-wss` and `lo-pert` currently have a red CI run**, and the next
session's first job is `gh run rerun` on each of the four plus a first analysis of this
repository's own project.

`ci-quality-gate.yml` was also failing on `main`, for an unrelated reason found on the way:
`submodules: recursive` aborts with *"No url found for submodule path
'ideas/vacas/upstream'"* — a gitlink in the index with no `.gitmodules` entry, belonging to
another idea. It now initialises exactly the submodules `.gitmodules` declares.

`release-quality-gate.yml` is written and lints clean, gated on `status: done` so it
publishes nothing until the entry is finished. It creates its own tag, as it must —
`quality-gate-v<version>`, with `sonar.yml`, `baseline.md` and the idea's `README.md` as
assets, since there is nothing to compile.

The Python coverage command was run locally rather than assumed: `restore-wss` reports
**73.6%** over 247 unit tests, and writes a `coverage.xml` whose paths resolve against the
workspace the same way in the scan job as in the coverage job. `lo-pert` uses the identical
pattern.

Submodule pointers: bumped for `recap`, `gnome-shell-pwgen` and `restore-wss`, where the
commit pushed is the only one ahead of the pin, each with its `flake.lock` in the same commit
so `check-pin.sh` stays green. **Not** bumped for `recap-gs` and `lo-pert`: their upstreams
had already moved several commits ahead of the pin, and dragging another idea's untested work
into its wrapper is that idea's call, not this one's. Their wiring is pushed and live
upstream regardless.

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
- [x] U3 — wire `gortazar/recap` end to end, read its gate (OK, vacuously — 0 new lines)
- [x] U4 — this repo's own Sonar project, submodule exclusions, badges in `aideas`/`gnome-tasks`
      (wired; its first analysis runs after the merge)
- [x] U5 — `gnome-shell-pwgen`, `recap-gs`, `restore-wss`, `lo-pert` wired and pushed
      (their first analyses run after the merge moves `v1`)
- [x] U6 — `baseline.md` written from six real analyses, plus `read-measures.sh` to re-read
      them; `check-wiring.sh` owns all six rows and passes
- [x] U7 — `quality-gate-v0.1` release: `release-quality-gate.yml` fires on the merge that
      carries `status: done`; `scripts/check-release.sh` confirms it afterwards

Next: nothing — the entry is finished at 0.1. The one follow-up for whoever makes the gate
blocking is in `baseline.md`: all six gates pass vacuously at 0 new lines, and only `recap`
clears 80% coverage.
