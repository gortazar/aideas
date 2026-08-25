# Plan: quality-gate — one reusable Sonar workflow, six projects, and an honest baseline

Difficulty estimate: medium — the YAML and the wiring are small and boring, but the work spans
seven repositories, depends on a SonarCloud onboarding only a human can do, and its real
deliverable is a measurement (`baseline.md`) that cannot be written until two real analyses
per project have run.

## Context

`AGENTS.md:153-170` already tells every future agent to wire its idea up to
`gortazar/aideas/.github/workflows/sonar.yml@v1`. That workflow does not exist yet, and no
idea repository calls anything like it. This entry makes the sentence true, for the ideas
that already exist, advisory only.

**What there is to analyse.** Seven repositories, of which five are separate and two ideas
live in this one:

| Project | Where | Language | Sonar |
| --- | --- | --- | --- |
| `gortazar/aideas` | this repo — `ideas/aideas/src` (GJS), `ideas/gnome-tasks/src` (GJS), `orchestrator/` (Python) | JS, Python | yes |
| `gortazar/gnome-shell-pwgen` | `ideas/pwgen/upstream` | JS (GJS) | yes |
| `gortazar/recap` | `ideas/recap/upstream` | Go | yes |
| `gortazar/recap-gs` | `ideas/recap-gs/upstream` | JS (GJS) | yes |
| `gortazar/restore-wss` | `ideas/restore-wss/upstream` | Python | yes |
| `gortazar/lo-pert` | `ideas/lo-pert/upstream` | Python | yes |
| `gortazar/title-slides` | `ideas/title-slides/upstream` | Lua | **no — out of scope** |
| `vacas`, `wg` | not created yet | — | out of scope; `AGENTS.md` already covers them |

`aideas` and `gnome-tasks` have no upstream of their own, so they share one Sonar project —
this repo. That is a fact to state, not a problem to solve: there is no per-directory badge in
SonarCloud, so both READMEs carry the same badge with a line saying it covers the whole repo.

**Four facts that shape the design.**

- **Coverage is where every gate will be decided, and no repository produces a coverage report
  today.** Every upstream CI is a single `nix flake check`; nothing writes lcov, `cover.out` or
  Cobertura. A missing report reads as 0% coverage, not as "no opinion" — except that Sonar
  ignores the coverage and duplication conditions until a new-code period has at least 20 new
  lines, so small commits will pass vacuously and larger ones will not. The baseline has to
  record which of those two things actually happened per project, with the new-lines count
  beside it, or entry 5 will choose its threshold from a number that was never really measured.
- **The gate is not computed on a project's first analysis**, and needs a new-code definition.
  So every project needs at least two pushes before `baseline.md` can say anything, which makes
  "wire it, then push a trivial second commit, then read the gate" the actual unit of work.
- **Nothing here can be tagged by an agent.** A caller pinning `@v1` needs a `v1` tag on this
  repo, and the orchestrator pushes with a plain `git push`, which carries no tags. So the tag
  has to be created by a workflow running on this repo after the merge — the same reason
  `release-aideas.yml` creates its own tag.
- **`ci-quality-gate.yml` is already merged and already failing.** It runs `nix flake check` in
  `ideas/quality-gate/`, where there is no flake. First unit fixes that.

**Assumptions, stated rather than asked.** SonarCloud organisation `gortazar`, project keys
`gortazar_<repo-name>` (the default binding produces exactly these); the default `Sonar way`
gate and the default new-code definition, unchanged, because the point of this entry is to find
out what the defaults say; this entry adds **no** coverage instrumentation to any repository
(see the open question) and no `sonar.exclusions` tuning beyond what is needed to stop this repo
analysing its own submodules; version `0.1`; nothing blocking anywhere.

**The grant.** This entry edits, by the entry's explicit instruction, files outside
`ideas/quality-gate/`: `.github/workflows/sonar.yml`, a workflow to tag it, a root
`sonar-project.properties` for this repo's own analysis, `ideas/aideas/README.md` and
`ideas/gnome-tasks/README.md` for their badges, and the five upstream repositories. It does
**not** touch the root `README.md`, `AGENTS.md` (entry 5 rewrites the rules) or anything under
`ideas/title-slides/` — that idea is the entry immediately ahead of this one in the queue and
may still be in flight.

## Features

- **`.github/workflows/sonar.yml`, one reusable workflow every idea calls.** `workflow_call`
  with `inputs`: `project-key` (default: `gortazar_` + this repository's name), `organization`
  (default `gortazar`), `extra-args`, `coverage-artifact` and `coverage-path` (both empty by
  default), `working-directory`, `runs-on`. One secret, `SONAR_TOKEN`, declared `required: false`
  so the skip path below is reachable. Checkout is `fetch-depth: 0`, because Sonar attributes
  new code by git blame and a shallow clone silently makes "new code" wrong. The scan step is
  `SonarSource/sonarqube-scan-action` (the `sonarcloud-github-action` it replaced is deprecated),
  pinned to a release tag, with `GITHUB_TOKEN` passed so pull-request decoration works.
- **A missing token skips, loudly, instead of failing red.** Pull requests from forks get no
  secrets, and a repository can be wired before its token is set. When `SONAR_TOKEN` is empty the
  job prints one sentence saying the analysis was skipped and why, and succeeds. An advisory gate
  that turns every fork PR red would get switched off within a week.
- **Coverage is an input, not a guess.** When `coverage-artifact` is set the workflow downloads
  that artifact from the calling run and unpacks it where `coverage-path` says, before scanning.
  So a repository that starts producing coverage later only adds two lines to its caller — the
  reusable workflow never learns how to run four different test suites, and never runs `nix` at
  all.
- **A `v1` tag this repo maintains itself.** `.github/workflows/tag-sonar.yml` runs on pushes to
  `main` that touch `sonar.yml` and force-moves the `v1` tag to that commit with the automatic
  `GITHUB_TOKEN` (`contents: write`), the way actions publish their own major tags. Callers pin
  `@v1` and get the current workflow; nobody has to push a tag from a worktree, which would not
  arrive.
- **Each supported repository calls it from its own CI, on push to `main` and on every pull
  request.** A `sonar` job beside the existing `check`/`test` job — not inside it, so a red gate
  cannot be confused with a failing test suite — plus a `sonar-project.properties` naming the
  project key, `sonar.sources`, `sonar.tests` and the exclusions that repository needs. Push
  analysis is limited to `main` so a branch is not analysed twice, once as a branch and once as
  its pull request.
- **This repo analyses itself, excluding its submodules.** A root `sonar-project.properties`
  with `sonar.sources` covering `ideas/aideas/src`, `ideas/gnome-tasks/src`, `orchestrator/` and
  the in-repo tools, `sonar.tests` covering their test trees, and
  `sonar.exclusions=ideas/*/upstream/**` — those directories are other projects, and counting
  them here would both double-count and wreck this project's numbers. Its caller is a new
  `.github/workflows/sonar-aideas-repo.yml`.
- **A badge in every supported idea's README**, immediately under the title: the standard
  `api/project_badges/measure?...&metric=alert_status` image linking to the project's dashboard.
  Seven READMEs, six projects: `ideas/aideas/README.md` and `ideas/gnome-tasks/README.md` carry
  the same repo-level badge, with one line saying so.
- **`ideas/quality-gate/baseline.md` — the deliverable this entry is really for.** One section
  per project, and in each a table with a row for every `Sonar way` condition — new bugs, new
  vulnerabilities, maintainability rating on new code, security hotspots reviewed, coverage on
  new code, duplicated lines on new code — carrying: measured value, threshold, pass/fail, and
  the distance in the metric's own units ("0% coverage, 80% required, 0 of 41 new lines
  covered"). Beside each project: total lines of code, the language breakdown Sonar reports, the
  new-code definition in force, the number of new lines in the period, whether the coverage and
  duplication conditions were ignored for being under 20 new lines, and the overall (not
  new-code) issue counts as context for what a future blocking gate would inherit. Numbers are
  read from the real analyses, each with the analysis date and a link.
- **`title-slides` is recorded as out of scope, with the reason.** Its own section in
  `baseline.md`: Lua is not among the languages SonarQube Cloud analyses, so there is no project,
  no badge and no substitute tool. `vacas` and `wg` get one line each: no repository yet, wired
  by `AGENTS.md` when they are built.
- **`ideas/quality-gate/scripts/check-wiring.sh`, so the wrapper cannot rot.** For every project
  in a table it owns: the caller workflow exists and pins `@v1`, a `sonar-project.properties`
  exists with a matching project key, the README carries the badge, and `baseline.md` has a
  section for it. It reads the submodule working trees, so it fails when a submodule pointer
  moves back and takes the wiring with it.
- **`ideas/quality-gate/flake.nix` running that script plus `actionlint`** over `sonar.yml`,
  `tag-sonar.yml` and the caller workflows, and `shellcheck` over the script — which is what
  makes the already-merged `ci-quality-gate.yml` green.
- **`ideas/quality-gate/README.md`**: how an idea wires itself up (the five lines to paste), what
  the token is and where it lives, what `v1` means and how it moves, and how to re-read the
  baseline. This is the "installation" for a reusable workflow — there is no binary to ship.

## Approach

Units, one commit each, tests (or the check script) first:

1. **U1 — the wrapper builds.** `flake.nix`, `scripts/check-wiring.sh` against an empty table,
   `actionlint`/`shellcheck` checks. `ci-quality-gate.yml` goes green.
2. **U2 — `sonar.yml` and `tag-sonar.yml`.** Inputs, the skip path, the coverage download, the
   tag mover. Nothing calls it yet; `actionlint` is the only check that can run before the merge.
3. **U3 — `recap` end to end.** Go, one `sonar-project.properties`, the simplest test bed.
   Wire it, push, push again, read the gate, and only then generalise. If the token, the project
   binding or `@v1` resolution is wrong, it is wrong here, in one repository.
4. **U4 — this repo's own project**, with the submodule exclusions, plus the badges in
   `ideas/aideas/README.md` and `ideas/gnome-tasks/README.md`.
5. **U5 — the remaining four**: `gnome-shell-pwgen`, `recap-gs`, `restore-wss`, `lo-pert`. Each
   is: properties, caller job, badge, push, second push. Submodule pointers bumped here in the
   same commit as each repository's row in `check-wiring.sh`.
6. **U6 — `baseline.md`**, written from the real analyses, with dates and links, including the
   `title-slides` and not-yet-created sections.
7. **U7 — the paperwork.** `README.md` for the idea folder, `STATUS.md` at `0.1` recording every
   gate result verbatim (red gates are information this entry must report, not hide), and the
   release: the `v1` tag plus a `quality-gate-v0.1` release on this repo carrying `sonar.yml` and
   `baseline.md` as assets, since there is no artefact to compile.

## Risks / things to verify early

- **The SonarCloud onboarding is a human step and it blocks U3 onwards.** Creating the
  organisation, installing the SonarCloud GitHub App on the `gortazar` account, binding six
  repositories and issuing a token all happen in a browser. Everything up to U2 is doable
  without it; nothing after U3 is. Hence the first open question.
- **Automatic Analysis and CI analysis conflict.** If a project gets onboarded with Automatic
  Analysis on, the CI scan fails with a message about exactly that. Turning it off is part of
  onboarding each project, and worth checking on the first red run rather than debugging the
  workflow.
- **`@v1` does not exist until after the merge.** Every caller wired in U3-U5 will fail its first
  run if `tag-sonar.yml` has not yet created the tag. Verify the tag exists (`git ls-remote
  --tags`) before wiring anything, and expect one round trip through the orchestrator's push.
- **A submodule push is a silent no-op from a detached HEAD.** Each upstream is checked out
  detached; push `HEAD:main` and confirm with `ls-remote` before believing the wiring landed,
  and bump the pointer in the same commit so the work is not invisible from here.
- **Five submodule pointers moving at once will conflict** if another agent is in one of those
  folders. Bump each pointer in its own commit, to the commit that was actually pushed, so a
  conflict is resolved by taking the newer gitlink rather than by re-deriving the whole change.
- **The gate needs two analyses and a new-code definition**, so a project that has only been
  analysed once reports nothing and would land in `baseline.md` as a hole. Budget the second
  push per repository.
- **Coverage will read 0% or be skipped, and those are different answers.** Record which one
  happened, with the new-lines count. "80% required, 0% measured" and "condition ignored, 6 new
  lines" tell entry 5 opposite things.
- **GJS is not ordinary JavaScript.** Sonar will parse `imports.gi.*` and `resource:///` imports
  as plain JS and may produce a crop of nonsense findings. Count them in the baseline rather
  than suppressing them — whether GJS needs its own rule set is precisely the kind of evidence
  entry 5 is asking for.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **How does a SonarQube Cloud token reach the six repositories?** Only a human can create
      the SonarCloud organisation, install its GitHub App on the `gortazar` account, bind the
      projects and issue a token — no part of that is reachable from an agent. Once the token
      value exists the agent can distribute it (`gh secret set SONAR_TOKEN --repo gortazar/<repo>`
      for each, if the `gh` login in this environment has admin on them; otherwise you set six
      secrets by hand). Please either (a) do the onboarding and say the token is in place, naming
      the organisation key and confirming the project keys are `gortazar_<repo-name>`, or (b) say
      to use SonarCloud's *Automatic Analysis* instead, which needs no token and no workflow but
      cannot take a coverage report — and which contradicts the entry's explicit request for a
      reusable workflow, so the workflow would ship unused until a token appears. I will store the token in the aideas repo. 
      Can you push it to any other repo from there? Do I need to add each repo to sonar cloud manually?
- [x] **Should this entry add coverage reporting where it is cheap, or leave every coverage
      number unmeasured?** No repository emits a coverage report today, so the 80%-on-new-code
      condition would be recorded as "0% / ignored" everywhere and entry 5 would be choosing its
      most consequential threshold from an absence. Cheap: `go test -coverprofile` in `recap`,
      `pytest --cov` in `restore-wss` and `lo-pert` — three repositories, though getting the
      report *out* of a `nix flake check` sandbox and into the scan is real work in each. Not
      cheap, arguably not possible: the GJS suites (`pwgen`, `recap-gs`, `aideas`,
      `gnome-tasks`), which have no instrumentation story. The plan as written assumes **no
      coverage work this entry** and a baseline that says so plainly; the alternative is to
      instrument the three easy ones and let the baseline show real numbers for Go and Python
      against no numbers for GJS. No coverage for now.
- [ ] **Answering your two questions, and the one thing I still need.** (a) *Can I push the token
      from `aideas` to the other repositories?* No. GitHub Actions secrets are write-only: the
      REST API returns a secret's name and dates but never its value, so nothing running here or
      in a workflow can read it back out of `gortazar/aideas` to copy it elsewhere. And
      `gortazar` is a **User** account, not an Organization (`gh api users/gortazar` says
      `"type": "User"`), so there are no account-level secrets to share one copy from either.
      A secret in `aideas` alone would only ever analyse `aideas`; the other five repositories'
      `sonar` jobs would take the skip path on every run. (b) *Do I need to add each repo to
      SonarQube Cloud manually?* Probably not — once I have the token I can create all six
      projects through the web API (`POST api/projects/create` with
      `organization=gortazar&project=gortazar_<repo>&visibility=public`), and turn off Automatic
      Analysis per project, which otherwise makes the CI scan fail with a conflict. What I cannot
      do from here is anything in GitHub's own settings: if the SonarCloud GitHub App is
      installed on *selected repositories* rather than all of them, the six need adding to its
      repository access in the browser. I checked what I could without a token: the organisation
      `gortazar` exists, one project (`gortazar_casaos`) is in it and confirms the key format is
      `gortazar_<repo-name>`, none of our six projects exist yet, and none of the six
      repositories has any secret set.
      **So the concrete ask is just the token value.** Paste it here (or in the next session) and
      I will run `gh secret set SONAR_TOKEN --repo gortazar/<repo>` for all six — the `gh` login
      in this environment is `gortazar` with `repo` scope, which is enough — create the projects,
      and wire, push and read the gates. The token is never written into any file in any
      repository. If you would rather not hand it over, set it by hand in `gortazar/recap`,
      `gortazar/recap-gs`, `gortazar/gnome-shell-pwgen`, `gortazar/restore-wss`,
      `gortazar/lo-pert` and `gortazar/aideas`, and say so — I do not need to see the value to
      use it, only to distribute it.
