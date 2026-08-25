# Baseline: what the default quality gate says today

The point of this file is a measurement, not an opinion. A later entry will make the gate
blocking, and it has to choose its thresholds from numbers that were actually observed
rather than from the defaults' reputation — so every row below carries the measured value,
the threshold, whether it passed, and the distance between them in the metric's own units.

**Nothing here is filled in yet.** No project has been analysed: the SonarQube Cloud
organisation `gortazar` exists, but none of the six projects have been imported and no
repository holds a `SONAR_TOKEN`. See `STATUS.md` and the open question in `PLAN.md`.

## How each section is read

Per project, the six `Sonar way` conditions:

| Condition | Threshold |
| --- | --- |
| New bugs | 0 |
| New vulnerabilities | 0 |
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
project needs at least two pushes before it reports anything. And **no repository here
produces a coverage report**, by the decision recorded in this entry's second open
question, so every coverage number will be either 0% or ignored, and the section says which.

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
