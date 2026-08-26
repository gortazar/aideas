# quality-gate

One SonarQube Cloud analysis, called by every idea, so that a change which worsens the
codebase **cannot** land.

There is nothing to install. What this idea ships is:

- [`.github/workflows/sonar.yml`](../../.github/workflows/sonar.yml) — the reusable workflow
  every idea calls. It waits for the analysis to finish and **fails on a red gate**.
- **A branch ruleset on every idea repository**: a pull request is required, that job's
  check must pass, and there are no bypass actors.
- [`gate.md`](gate.md) — the two custom quality gates, and why their thresholds are what
  they are. The file to argue with.
- [`exclusions.md`](exclusions.md) — every exclusion any repository carries and what it
  hides, so a gate that is green because it stopped looking stays visible as such.
- [`baseline.md`](baseline.md) — what the *default* gate said about each project before any
  of this, measured rather than assumed.

The rules an agent follows are in [`AGENTS.md`](../../AGENTS.md) under **Landing a change
upstream**, including what to do when the gate goes red.

## Wire an idea up

Add this job to the idea's own CI workflow, beside its existing `check`/`test` job — not
inside it, so a red gate cannot be mistaken for a failing test suite:

```yaml
  sonar:
    uses: gortazar/aideas/.github/workflows/sonar.yml@v1
    secrets:
      SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

**Do not give that job a `name:`.** Its check-run context becomes `<name> / Analysis` rather
than `sonar / Analysis`, and the branch ruleset requires the context by exact string.
`gnome-shell-pwgen` has one, which is why its ruleset requires
`SonarQube Cloud / Analysis` — a mismatch here leaves a `main` nobody can merge to, with no
bypass actor to undo it.

And a `sonar-project.properties` beside it:

```properties
sonar.projectKey=gortazar_<repo-name>
sonar.organization=gortazar
sonar.sources=src
sonar.tests=tests
```

That is the whole wiring. `sonar.sources`, `sonar.tests` and any exclusions live in the
properties file, version-controlled beside the code they describe, rather than as workflow
inputs.

Trigger it on `push` to `main` and on `pull_request`. Limiting the push trigger to `main`
is deliberate: otherwise a branch is analysed twice, once as a branch and once as its pull
request.

A repository being wired for the first time needs three more commands, none of which needs
a browser. Run them from the repository root, in this order:

```sh
scripts/set-repo-secret.sh <repo> SONAR_TOKEN
ideas/quality-gate/scripts/ensure-sonar-project.sh <repo>
ideas/quality-gate/scripts/ensure-quality-gate.sh          # assigns it to the right gate
ideas/quality-gate/scripts/ensure-branch-ruleset.sh <repo> <check> [<check> ...]
```

`ensure-sonar-project.sh` is idempotent and does three things a UI import would have done
for you: creates the project, renames its main branch to `main` (an API-created project
calls it `master`, and an analysis of `main` then files itself as a short-lived branch that
accumulates no measures), and sets the new-code period — without which there is no quality
gate at all.

`ensure-quality-gate.sh` reconciles both custom gates and their project assignments from the
table at the top of the script; add the new repository to that table first.
`--status` exits non-zero if the live gates disagree with it.

**`ensure-branch-ruleset.sh` goes last, and its check contexts are arguments because they
are not guessable.** Read them off a live pull request before running it:

```sh
gh api repos/gortazar/<repo>/commits/<sha>/check-runs --jq '.check_runs[].name'
```

A required check that is never reported blocks every merge forever, and there is no bypass
actor to rescue it. If it happens anyway, a ruleset is repository configuration rather than
a branch, so `gh api -X DELETE repos/gortazar/<repo>/rulesets/<id>` still works —
`ensure-branch-ruleset.sh --status <repo>` prints the id.

### Inputs, for the cases the five lines above do not cover

| Input | Default | What it is for |
| --- | --- | --- |
| `project-key` | `gortazar_<repo-name>` | A project key that is not the repository name |
| `organization` | `gortazar` | The SonarQube Cloud organization |
| `extra-args` | *(empty)* | Extra `-Dsonar.*` arguments |
| `coverage-artifact` | *(empty)* | Artifact uploaded earlier in the same run holding a coverage report |
| `coverage-path` | `.` | Where to unpack it |
| `working-directory` | `.` | `sonar.projectBaseDir` — where the properties file lives |
| `runs-on` | `ubuntu-latest` | Runner label |
| `fail-on-gate` | `true` | Wait for the analysis and fail on a red gate. Turn it off only while onboarding a repository, and say why — with it off, this job's check says nothing about the gate, and any ruleset requiring it is decoration. |

Coverage is an input rather than something the workflow produces. The repositories here
have four different test runners, three of them inside a Nix sandbox; a workflow that knew
how to drive all of them would be the one nobody dares change. A repository that starts
measuring coverage uploads the report as an artifact and names it here — two lines in its
caller, none in `sonar.yml`.

## The token

The analysis needs `SONAR_TOKEN`, a SonarQube Cloud user token. One token works for every
project in the organisation, but GitHub Actions secrets are per-repository and write-only —
they cannot be read back or copied from one repository to another — and `gortazar` is a
user account, not an organisation, so there are no account-level secrets to share either.
Each analysed repository therefore holds its own copy of the same value, distributed by the
script at this repo's root, which reads it from the machine-local agent env file and prints
only the secret's name:

```sh
scripts/set-repo-secret.sh <repo> SONAR_TOKEN   # from the repository root
scripts/set-repo-secret.sh --list               # which credentials exist, without values
```

**Never read, echo or write the value** — not into a file, a commit message, `STATUS.md` or
a log. `ideas/quality-gate/scripts/ensure-sonar-project.sh` follows the same rule for the
SonarQube Cloud side, taking the token from the same env file straight into a `curl --config`
on stdin: never into argv, where `ps` would show it to every process on the machine.

**A run without the token is skipped, not failed.** Pull requests from forks get no secrets
at all, and a repository can be wired up before its token is set. The job prints one notice
saying the analysis was skipped and why, and succeeds. An advisory gate that turned every
fork pull request red would be switched off within a week.

## What `v1` means

Callers pin `@v1`, a moving major tag. `.github/workflows/tag-sonar.yml` force-moves it to
every push to `main` that touches `sonar.yml`, the way published actions maintain their own
major tag, so a fix reaches all callers without any of them being edited.

The tag is maintained by a workflow rather than pushed by hand because it cannot be pushed
by hand: agents work in worktrees they may not push, and the orchestrator merges their
branches with a plain `git push`, which carries no tags.

`git ls-remote --tags https://github.com/gortazar/aideas v1` says where it points.

Each finished entry also ships a `quality-gate-v<version>` release carrying `sonar.yml`,
`baseline.md` and this file — the artefacts themselves, since there is nothing to compile.
`scripts/check-release.sh` says whether it is really there and whether the released
`sonar.yml` is the same file `v1` resolves to; it needs no token and no clone.

## The gate blocks

The gate is Sonar's **Clean as You Code** model: it judges *new* code, not the code you
inherited, so there is no point spending an entry paying down old debt to make it green.

Three things together are what make it block, and none of them works alone:

1. `sonar.qualitygate.wait=true` in the scan, so the job waits for the analysis to finish
   and exits non-zero on a red gate. Without it the scan returns as soon as the report is
   uploaded and the job is green whatever the gate says.
2. A **branch ruleset** on each repository's `main` requiring both a pull request *and* that
   job's check. A required check alone does not stop a direct push — the push lands and the
   check goes red afterwards.
3. **No bypass actors.** A gate an admin can wave through is advice with extra steps.

Two gates, not one, because three of the projects have no coverage story at all — see
[`gate.md`](gate.md) for the conditions and the reasoning behind every threshold.

### When it goes red

```sh
./scripts/pr-gate.sh <repo> <pr-number>
```

prints every condition with its measured value and threshold, and the new-code issues behind
the failing ones. No token needed. Then, in order: **fix a real finding** in the same pull
request; give a false positive already catalogued in [`baseline.md`](baseline.md) a *narrow*
exclusion plus a row in [`exclusions.md`](exclusions.md), in the same pull request; or
**land nothing** and say in `STATUS.md` which condition failed and what the numbers were.
Bypassing is not on the list. The full ladder is in [`AGENTS.md`](../../AGENTS.md).

### What it still cannot see

Sonar skips the coverage and duplication conditions entirely when a pull request has fewer
than **20 new lines**, and says nothing about having done so. Every gate reading in
`baseline.md` passed that way. `pr-gate.sh` prints the new-line count beside the conditions
so "passed" and "not evaluated" are never confused.

A pull request from a fork gets no secrets, so the analysis is skipped and the job succeeds.
The gate is unenforced there by construction; failing instead would only stop fork pull
requests from ever merging.

## Re-reading the baseline

The dashboards are public, and so is the web API, so the numbers in `baseline.md` can be
re-read without a token:

```sh
curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=gortazar_recap" | jq
curl -s "https://sonarcloud.io/api/measures/component?component=gortazar_recap&metricKeys=ncloc,coverage,new_coverage,new_lines,bugs,vulnerabilities,code_smells" | jq
```

The gate is not computed on a project's first analysis — it needs a previous one to define
new code against — so a project that has only ever been analysed once reports nothing.

## Checking the wiring has not rotted

```sh
nix develop        # actionlint, shellcheck, curl, jq
nix flake check    # shellcheck over scripts/
nix run .#lint     # actionlint over the workflows this idea owns, then check-wiring.sh
```

```sh
./scripts/read-measures.sh                  # every project's gate and measures
./scripts/pr-gate.sh <repo> <pr>            # why is the gate red on this pull request
./scripts/check-release.sh                  # is quality-gate-v<version> published, and does it match v1
./scripts/ensure-quality-gate.sh --status   # do the live gates match gate.md
./scripts/ensure-branch-ruleset.sh --status <repo>
```

None of those needs a token.

`scripts/check-wiring.sh` walks a table of every project this idea claims to have wired up
and asserts seven things for each:

1. its caller workflow exists and pins `@v1` — or, for this repository, the local path;
2. its `sonar-project.properties` names the expected project key;
3. every README carrying its badge still carries it;
4. `baseline.md` has a section for it;
5. its repository has an **active ruleset** on the default branch, with a pull-request rule,
   the right required check and **no bypass actors** — or, for `gortazar/aideas`, which is
   ungated on purpose, no ruleset at all;
6. the project is assigned to the **custom quality gate** `gate.md` says it should be;
7. the **pinned gitlink is reachable from upstream's `main`** — a squash merge with
   `--delete-branch` orphans the branch tip, and a pin taken from it resolves nowhere.

1-4 are local; it reads the submodule working trees, so it fails when a pointer moves
backwards and takes the wiring with it. 5-7 read public APIs and need no token, though
`GH_TOKEN` is used if set, because unauthenticated `api.github.com` allows 60 requests an
hour and a rate-limited response looks exactly like a missing ruleset. `--no-network` skips
them and says it did.
