# quality-gate

One SonarQube Cloud analysis, called by every idea, so that a change which worsens the
codebase is visible before it lands.

There is nothing to install: what this idea ships is a reusable GitHub Actions workflow at
[`.github/workflows/sonar.yml`](../../.github/workflows/sonar.yml) in this repository, and
the measured [`baseline.md`](baseline.md) that says what the default gate actually says
about each project today.

## Wire an idea up

Add this job to the idea's own CI workflow, beside its existing `check`/`test` job — not
inside it, so a red gate cannot be mistaken for a failing test suite:

```yaml
  sonar:
    uses: gortazar/aideas/.github/workflows/sonar.yml@v1
    secrets:
      SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

and a `sonar-project.properties` beside it:

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

A repository being wired for the first time also needs its SonarQube Cloud project to exist
and its token to be set. Both are one command each and neither needs a browser:

```sh
scripts/set-repo-secret.sh <repo> SONAR_TOKEN            # from the repository root
ideas/quality-gate/scripts/ensure-sonar-project.sh <repo>
```

`ensure-sonar-project.sh` is idempotent and does three things a UI import would have done
for you: creates the project, renames its main branch to `main` (an API-created project
calls it `master`, and an analysis of `main` then files itself as a short-lived branch that
accumulates no measures), and sets the new-code period — without which there is no quality
gate at all.

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

## The gate is advisory

The gate is Sonar's **Clean as You Code** model: it judges *new* code, not the code you
inherited, so there is no point spending an entry paying down old debt to make it green.

Today a red gate is information to report, not a failure that stops anything. The entry
that makes it blocking is the one that will choose the thresholds, and it will choose them
from [`baseline.md`](baseline.md) — which is why that file records measured values and the
distance to each threshold in the metric's own units, rather than just pass or fail.

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
./scripts/read-measures.sh          # every project's gate and measures, no token needed
./scripts/check-release.sh          # is quality-gate-v<version> published, and does it match v1
./scripts/ensure-sonar-project.sh <repo>   # create and configure a project for a new repository
```

`scripts/check-wiring.sh` walks a table of every project this idea claims to have wired up
and checks, for each, that its caller workflow exists and pins `@v1`, that its
`sonar-project.properties` names the expected key, that every README carrying its badge
still carries it, and that `baseline.md` has a section for it. It reads the submodule
working trees, so it fails when a submodule pointer moves backwards and takes the wiring
with it.
