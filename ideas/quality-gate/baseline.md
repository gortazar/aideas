# Baseline: what the default quality gate says today

The point of this file is a measurement, not an opinion. A later entry will make the gate
blocking, and it has to choose its thresholds from numbers that were actually observed
rather than from the defaults' reputation — so every row below carries the measured value,
the threshold, whether it passed, and the distance between them in the metric's own units.

All six projects exist in the SonarQube Cloud organisation `gortazar` and all six
repositories are wired up. **One has been analysed so far**: `gortazar_recap`. The other
five are waiting on a fix to the reusable workflow that cannot reach them until this branch
is merged — see *Why five projects have no numbers yet*, below.

## How each section is read

The `Sonar way` gate, read from the organisation on 2026-08-25, is six conditions — all of
them on new code, none on the code the project already has:

| Condition | Threshold |
| --- | --- |
| Security rating on new code | A |
| Reliability rating on new code | A |
| Maintainability rating on new code | A |
| Security hotspots reviewed | 100% |
| Coverage on new code | ≥ 80% |
| Duplicated lines on new code | ≤ 3% |

and beside them, the context a threshold cannot be chosen without:

- total lines of code and the language breakdown Sonar reports;
- the new-code definition in force, and the number of new lines in the period;
- **whether the coverage and duplication conditions were evaluated at all.** Sonar ignores
  both when the new-code period has fewer than 20 new lines. "80% required, 0% measured,
  41 new lines" and "condition ignored, 6 new lines" are opposite findings, and recording
  only the pass/fail would hide which one happened;
- the overall (not new-code) issue counts, as context for what a future blocking gate would
  inherit;
- the analysis date and a link.

Two facts shape when a section can be written at all. The gate is **not computed on a
project's first analysis** — it needs a previous one to define new code against — so every
project needs at least two analyses before it reports anything. And coverage exists only
where it was cheap: Go and Python have it built in, so `recap`, `restore-wss` and `lo-pert`
report real numbers; the GJS projects (`recap-gs`, `gnome-shell-pwgen`, and the extensions
in this repository) have no instrumentation story and will read 0%, or have the condition
skipped, and the section says which.

## What onboarding actually took

Three things had to be done to the projects themselves, none of which is in the plan and all
of which are now in `scripts/ensure-sonar-project.sh` so the next repository does not
rediscover them:

1. **The projects were created through the web API**, not imported in a browser:
   `POST api/projects/create` with `organization=gortazar`, `visibility=public`. The key
   format the plan assumed, `gortazar_<repo-name>`, is right.
2. **Their main branch had to be renamed.** A project created through the API calls its main
   branch `master`. An analysis of `main` then does not fail — it quietly files itself as a
   short-lived *branch* called `main`, which accumulates no measures and whose gate is not
   the project's. recap's first analysis came back green with nothing readable behind it.
3. **They had no new-code period at all**, which is what a UI import would have set to
   "previous version". Without one there is no gate: `api/qualitygates/project_status`
   answers `NONE`, no `new_*` measure is computed, and a second analysis looks exactly like
   a first. Set to `previous_version` on all six, matching the default this entry set out to
   measure.

Automatic Analysis was already off on every project — an API-created project does not get
it, so the conflict the plan anticipated never arose.

## Why five projects have no numbers yet

The reusable workflow's job asked for `pull-requests: read`. Five of the six repositories
(`recap-gs`, `gnome-shell-pwgen`, `restore-wss`, `lo-pert` and `aideas` itself) have their
default workflow token set to *read repository contents*, where that permission is not
merely unset but ungrantable, and GitHub refuses the whole run before any job starts:

> The nested job 'sonar' is requesting 'pull-requests: read', but is only allowed
> 'pull-requests: none'.

`recap` is the one repository whose default is `write`, which is why it was the only one to
run — and a good argument for the plan's insistence on proving one project end to end before
generalising, since the fault was in the shared workflow and showed up in five places at
once.

`sonar.yml` no longer asks for it: pull request decoration is done by the SonarQube Cloud
GitHub App against its own installation token, not by this workflow's. But callers pin
`@v1`, and `v1` only moves when `tag-sonar.yml` runs on `main` — which happens after this
branch is merged. So the five are wired, their projects exist and are configured, and their
first analysis runs on the next push (or `gh run rerun`) after the merge.

## Measured

### gortazar_recap — Go

[Dashboard](https://sonarcloud.io/project/overview?id=gortazar_recap) ·
analysed 2026-08-25 15:14 UTC, third analysis, commit `984f66a` ·
new-code period `previous_version`, reference the analysis of 2026-08-25 14:59 UTC.

**Gate: OK.** Four conditions evaluated, two not:

| Condition | Measured | Threshold | Result | Distance |
| --- | --- | --- | --- | --- |
| Security rating on new code | A | A | pass | at the threshold |
| Reliability rating on new code | A | A | pass | at the threshold |
| Maintainability rating on new code | A | A | pass | at the threshold |
| Security hotspots reviewed | 100% | 100% | pass | no hotspots to review |
| Coverage on new code | **not evaluated** | ≥ 80% | — | 0 new lines, condition skipped |
| Duplicated lines on new code | **not evaluated** | ≤ 3% | — | 0 new lines, condition skipped |

**The gate passed vacuously**, and this is the single most important number in this file:
the period had **0 new lines**. Sonar drops the coverage and duplication conditions when a
period has fewer than 20 new lines, so they were not weighed at all — the four that remain
are ratings over an empty set. A gate made blocking today would wave through any commit that
touches fewer than 20 lines without measuring the two things it was made blocking for.

The whole-project numbers, which is where the real information is:

| Measure | Value |
| --- | --- |
| Lines of code | 3,053 |
| Languages | Go 3,053 (100%) |
| Coverage | **86.0%** (1,670 lines to cover) |
| Duplicated lines | 3.0% |
| Bugs | 0 |
| Vulnerabilities | 0 |
| Security hotspots | 0 |
| Code smells | 12 |
| Technical debt | 196 min |
| Reliability / Security / Maintainability | A / A / A |

**86% overall coverage against an 80% threshold on new code** is the answer to the question
entry 5 has to settle. For a Go project with `go test -coverprofile` already wired, 80% on
new code is roughly where the project already sits — demanding, but not a step change. Note
this is *overall* coverage: new-code coverage on a real commit will differ, and no such
commit has been analysed yet.

Two things this analysis found that the plan did not anticipate:

- **121 lines of "PL/SQL"** in the first analysis: the three SQLite fixtures under
  `internal/opencode/testdata`, counted as production code and measured against rules meant
  for stored procedures. Fixed by excluding `**/testdata/**`, which also took duplication
  from 3.6% to 3.0% and code smells from 26 to 12 — over half of recap's reported debt was
  in files nobody wrote by hand.
- **Duplication sits at exactly the threshold.** 3.0% overall against a ≤ 3% condition on
  new code. Nothing failing, but no margin either.

### Wired, awaiting a first analysis

Each of these has a project in SonarQube Cloud with its main branch and new-code period set,
a `sonar-project.properties`, a `sonar` job in its CI pinned at `@v1`, and a badge in its
README. None has run, for the reason in *Why five projects have no numbers yet*.

| Project | Language | Coverage wired | Notes |
| --- | --- | --- | --- |
| `gortazar_aideas` | JS (GJS), Python | no | Covers this whole repository: `ideas/aideas/src`, `ideas/gnome-tasks/src`, `ideas/gnome-tasks/browser`, the in-repo tools and `orchestrator/`, with `ideas/*/upstream` excluded. Two ideas, one project, one badge in two READMEs. |
| `gortazar_recap-gs` | JS (GJS) | no | No instrumentation story for a gjs suite. |
| `gortazar_gnome-shell-pwgen` | JS (GJS) | no | Flat repository, so `sonar.sources` names files rather than a directory. |
| `gortazar_restore-wss` | Python, JS (GJS) | yes — `pytest --cov` over `tests/unit` | `tests/dbus` left out: it needs a session bus. |
| `gortazar_lo-pert` | Python | yes — `pytest --cov` over `tests/unit` | `tests/integration` left out: its code runs inside soffice's own interpreter. |

The GJS question the plan raised — whether Sonar produces a crop of nonsense findings on
`imports.gi.*` and `resource:///` imports — is unanswered until these run, and is exactly
the evidence entry 5 asked for.

## Out of scope

### title-slides — Lua

No project, no badge, no substitute tool. Lua is not among the languages SonarQube Cloud
analyses, and `AGENTS.md` is explicit that an unsupported language is a reason to skip this
deliverable and say so, not a reason to invent a different linter and call it the same
thing. `ideas/title-slides/` is untouched by this entry.

If SonarQube Cloud ever adds Lua, wiring `title-slides` up is the same five lines as
everything else.

### vacas, wg

No repository exists yet. `AGENTS.md` already requires a SonarQube Cloud analysis of every
idea whose language is supported, so each will be wired up by the entry that creates it —
there is nothing for this entry to measure.
