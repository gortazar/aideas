# Baseline: what the default quality gate says today

The point of this file is a measurement, not an opinion. A later entry will make the gate
blocking, and it has to choose its thresholds from numbers that were actually observed
rather than from the defaults' reputation — so every row below carries the measured value,
the threshold, whether it passed, and the distance between them in the metric's own units.

All six projects have been analysed. Read them yourself with `scripts/read-measures.sh`,
which needs no token: every project is public and so is the web API for it.

## The finding

**All six gates pass, and all six pass vacuously.** Every one of them reports 0 new lines,
so Sonar evaluated four conditions — three ratings and hotspots-reviewed — over an empty set
and skipped the two that matter most:

| Project | Gate | New lines | Coverage on new code | Duplication on new code |
| --- | --- | --- | --- | --- |
| `gortazar_recap` | OK | 0 | not evaluated | not evaluated |
| `gortazar_recap-gs` | OK | 0 | not evaluated | not evaluated |
| `gortazar_gnome-shell-pwgen` | OK | 0 | not evaluated | not evaluated |
| `gortazar_restore-wss` | OK | 0 | not evaluated | not evaluated |
| `gortazar_lo-pert` | OK | 0 | not evaluated | not evaluated |
| `gortazar_aideas` | OK | 0 | not evaluated | not evaluated |

That is an artefact of how these six analyses were produced — a second analysis of the same
commit, which is what it takes to get a gate computed at all — but it is also the shape of
the real risk: **Sonar drops the coverage and duplication conditions whenever a period has
fewer than 20 new lines**, and says nothing about having done so. A gate made blocking today
would wave through every small commit without weighing the two things it was made blocking
for, and report `OK` while doing it.

So the numbers a later entry needs are the whole-project ones below, not the gate:

| Project | Lines | Coverage | Duplication | Bugs | Vulns | Smells | Rel / Sec / Maint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `gortazar_aideas` | 8,239 | 0.0% | 1.7% | 3 | 8 | 107 | **E** / **C** / A |
| `gortazar_restore-wss` | 4,557 | **62.4%** | 0.0% | 0 | 0 | 42 | A / A / A |
| `gortazar_recap` | 3,053 | **86.0%** | 3.0% | 0 | 0 | 12 | A / A / A |
| `gortazar_recap-gs` | 1,874 | 0.0% | 0.0% | 2 | 0 | 9 | **E** / A / A |
| `gortazar_lo-pert` | 1,039 | **58.9%** | 0.0% | 1 | 0 | 9 | **C** / A / A |
| `gortazar_gnome-shell-pwgen` | 321 | 0.0% | 0.0% | 0 | 0 | 13 | A / A / A |

**On the 80% coverage threshold**, which is the most consequential number entry 5 has to
choose: the three instrumented projects sit at 86.0%, 62.4% and 58.9%. Only `recap` would
clear 80% today. Applied to new code the number will differ, but 80% is not where two of
these three projects live, and the GJS projects cannot reach it at all.

**On the ratings**, three projects are already below A overall, and every one of those is
worth looking at before treating the rating as a verdict — see their sections.

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

A fourth thing had to be fixed in the workflow itself. It asked for `pull-requests: read`,
and five of the six repositories (`recap-gs`, `gnome-shell-pwgen`, `restore-wss`, `lo-pert`
and `aideas`) cap their workflow token at *read repository contents*, where that permission
is not merely unset but ungrantable. GitHub refused the whole run before any job started:

> The nested job 'sonar' is requesting 'pull-requests: read', but is only allowed
> 'pull-requests: none'.

`recap` is the one repository whose default is `write`, which is why it was the only one
that ran — a good argument for the plan's insistence on proving one project end to end
before generalising, since the fault was in the shared workflow and would otherwise have
surfaced in five places at once. `sonar.yml` no longer asks for it: pull request decoration
is done by the SonarQube Cloud GitHub App against its own installation token, not by this
workflow's.

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

### gortazar_restore-wss — Python and GJS

[Dashboard](https://sonarcloud.io/project/overview?id=gortazar_restore-wss) ·
analysed 2026-08-25 16:33 UTC, second analysis, commit `4f286a9` ·
new-code period `previous_version`, 0 new lines, gate **OK** vacuously.

| Measure | Value |
| --- | --- |
| Lines of code | 4,557 |
| Languages | Python 3,793 (83%), JS 764 (17%) |
| Coverage | **62.4%** — `pytest --cov` over `tests/unit` |
| Duplicated lines | 0.0% |
| Bugs / Vulnerabilities / Hotspots | 0 / 0 / 0 |
| Code smells | 42 |
| Technical debt | 335 min |
| Reliability / Security / Maintainability | A / A / A |

The cleanest project of the six on every rating, and the one that shows what the coverage
threshold really costs: **62.4% against 80%**. The gap is not a few uncovered functions, it
is the 764 lines of GJS extension that no Python coverage run can reach, plus `tests/dbus`
being left out of the instrumented run because it needs a session bus. Both are choices this
entry made and documented, not accidents — but a blocking 80% would fail this project for
them.

### gortazar_recap-gs — GJS

[Dashboard](https://sonarcloud.io/project/overview?id=gortazar_recap-gs) ·
analysed 2026-08-25 16:33 UTC, second analysis, commit `351d134` ·
new-code period `previous_version`, 0 new lines, gate **OK** vacuously.

| Measure | Value |
| --- | --- |
| Lines of code | 1,874 |
| Languages | JS 1,741 (93%), XML 95, CSS 38 |
| Coverage | 0.0% — no instrumentation for a gjs suite |
| Duplicated lines | 0.0% |
| Bugs / Vulnerabilities / Hotspots | **2** / 0 / 0 |
| Code smells | 9 |
| Technical debt | 60 min |
| Reliability / Security / Maintainability | **E** / A / A |

**Both bugs are the same false positive, and both are BLOCKER**, which is what drags
reliability to E:

> `src/stylesheet.css:5` — Unknown property "spacing"
> `src/stylesheet.css:13` — Unknown property "spacing"

`spacing` is a real St property: GNOME Shell's stylesheets are not CSS, they are St's own
dialect, and Sonar has no analyser for that. This is the concrete answer to the question the
plan raised about GJS. It is not the JavaScript that confuses Sonar — `imports.gi.*` and
`resource:///` imports produced no findings at all across three GJS projects — it is the
**stylesheet**, and it is enough on its own to give a healthy project the worst reliability
rating there is.

Worth knowing before entry 5 decides anything: an E rating here means nothing about the
code, and a blocking gate that read it as a verdict would be wrong twice over.

### gortazar_lo-pert — Python

[Dashboard](https://sonarcloud.io/project/overview?id=gortazar_lo-pert) ·
analysed 2026-08-25 16:33 UTC, second analysis, commit `06df0ba` ·
new-code period `previous_version`, 0 new lines, gate **OK** vacuously.

| Measure | Value |
| --- | --- |
| Lines of code | 1,039 |
| Languages | Python 1,039 (100%) |
| Coverage | **58.9%** — `pytest --cov` over `tests/unit` |
| Duplicated lines | 0.0% |
| Bugs / Vulnerabilities / Hotspots | **1** / 0 / 0 |
| Code smells | 9 |
| Technical debt | 53 min |
| Reliability / Security / Maintainability | **C** / A / A |

The single bug is in a **test file**, not in the code:

> `tests/unit/test_properties.py:142` — Replace this assertion to not have the same actual
> and expected expression.

Sonar reports issues in `sonar.tests` sources as well as in `sonar.sources`, and they count
towards the project's rating. That is a fact worth carrying into entry 5: "reliability C"
here describes an assertion in a hypothesis property test.

The 58.9% is the lowest of the three instrumented projects, and for a structural reason:
everything in `drawing.py`, `documents.py`, `dialogs.py` and `commands.py` is exercised only
by `tests/integration`, which runs inside soffice's own Python interpreter where coverage
cannot see it. The pure core is well covered; the UNO half reads as zero.

### gortazar_gnome-shell-pwgen — GJS

[Dashboard](https://sonarcloud.io/project/overview?id=gortazar_gnome-shell-pwgen) ·
analysed 2026-08-25 16:33 UTC, second analysis, commit `57b3bf6` ·
new-code period `previous_version`, 0 new lines, gate **OK** vacuously.

| Measure | Value |
| --- | --- |
| Lines of code | 321 |
| Languages | JS 321 (100%) |
| Coverage | 0.0% — no instrumentation for a gjs suite |
| Duplicated lines | 0.0% |
| Bugs / Vulnerabilities / Hotspots | 0 / 0 / 0 |
| Code smells | 13 |
| Technical debt | 65 min |
| Reliability / Security / Maintainability | A / A / A |

The smallest project and the cleanest: 321 lines of GJS from `extension.js`, `prefs.js` and
`lib/generator.js` (540 physical lines, so a third is blanks and comments), with nothing
against it but 13 smells. No GJS false positives here — this extension has no stylesheet,
which is exactly what distinguishes it from `recap-gs`.

### gortazar_aideas — this repository

[Dashboard](https://sonarcloud.io/project/overview?id=gortazar_aideas) ·
analysed 2026-08-25 15:21 UTC, second analysis, commit `856feb1` ·
new-code period `previous_version`, 0 new lines, gate **OK** vacuously.

Two ideas share this project — `aideas` and `gnome-tasks` are both built here — along with
the orchestrator and the in-repo tools. `ideas/*/upstream` is excluded: each of those is a
separate repository with a project of its own.

| Measure | Value |
| --- | --- |
| Lines of code | 8,239 |
| Languages | JS 5,727 (70%), Python 1,742 (21%), **shell 662 (8%)**, XML 71, CSS 37 |
| Coverage | 0.0% — no report; the suites are gjs and unittest |
| Duplicated lines | 1.7% |
| Bugs / Vulnerabilities / Hotspots | **3** / **8** / 0 |
| Code smells | 107 |
| Technical debt | 626 min |
| Reliability / Security / Maintainability | **E** / **C** / A |

The largest project and the only one with vulnerabilities. **Sonar analyses shell scripts**
— 662 lines of them here — which the plan did not anticipate and which accounts for half the
security findings. What the 8 vulnerabilities and 3 bugs actually are:

| Where | Finding | Reading |
| --- | --- | --- |
| `orchestrator/install.sh:165,168` | clear-text protocol (×2, minor) | real, and deliberate — a localhost heartbeat URL |
| `orchestrator/install.sh:193`, `ideas/aideas/tools/check-release.sh:49` | `curl` not enforcing HTTPS | real, worth fixing: add `--proto '=https'` |
| `ideas/gnome-tasks/src/lib/commands.js:19`, `task.js:59` | pseudorandom number generator | real but harmless — ids, not secrets |
| `ideas/gnome-tasks/tools/m3-report.py:19,46` | path constructed from CLI arguments | a developer tool, not shipped code |
| `orchestrator/orchestrator.py:206,743` | regex operator precedence not explicit (×2, bugs) | worth a look; cheap to fix either way |
| `ideas/gnome-tasks/src/lib/taskStore.js:115` | **BLOCKER** — `'enumerator' is not modified in this loop` | false positive: `Gio.FileEnumerator.next_file()` advances internal state Sonar cannot see |

So the E reliability rating is one GJS false positive again, and the C security rating is
two `curl` invocations. Neither is a reason to spend an entry on old debt — the gate judges
new code — but both are the sort of thing a reader of the badge will assume means something
worse than it does.

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
