# The two gates, and why their numbers are what they are

`baseline.md` measured what the default `Sonar way` gate says. This file records what
replaced it, the reasoning behind every threshold, and the readings from real pull requests
that a later change to those thresholds should be argued from.

Both gates are created and reconciled by `scripts/ensure-quality-gate.sh`, which is
idempotent: editing the table in that script and re-running it is how a threshold changes.
`scripts/ensure-quality-gate.sh --status` exits non-zero when the live gates and that script
disagree, and `check-wiring.sh` asserts every project is on the gate it should be.

## aideas instrumented

`gortazar_recap`, `gortazar_restore-wss`, `gortazar_lo-pert` — the three projects with a
coverage report.

| Condition | Threshold |
| --- | --- |
| Reliability rating on new code | A |
| Security rating on new code | A |
| Maintainability rating on new code | A |
| Duplicated lines on new code | ≤ 3% |
| **Coverage on new code** | **≥ 60%** |

## aideas uninstrumented

`gortazar_recap-gs`, `gortazar_gnome-shell-pwgen`, `gortazar_aideas` — the GJS projects, and
this repository, which is mostly GJS.

The same four conditions, and **no coverage condition at all**.

## Why these numbers

### Why 60% and not 80%

`baseline.md` measured the three instrumented projects at **86.0%** (`recap`), **62.4%**
(`restore-wss`) and **58.9%** (`lo-pert`) overall. One of three clears 80% today.

But the first move is not a threshold at all — it is the *denominator*. Both of the projects
below 80% are there for a structural reason, not a testing one:

- `restore-wss` contains 764 lines of GJS extension that no Python coverage run can reach.
- `lo-pert`'s `drawing.py`, `documents.py`, `dialogs.py` and `commands.py` are exercised only
  by `tests/integration`, which runs them inside soffice's own interpreter where coverage
  cannot see them.

So each repository excludes what no runner can reach, in its own `sonar-project.properties`,
and the coverage figure then describes code that *can* be covered. Every one of those
exclusions is listed in `exclusions.md` with what it hides — a gate that is green because it
stopped looking has to be visible as such.

**Measured after the exclusions landed** (`restore-wss` PR #1, `lo-pert` PR #1, both merged
2026-08-26):

| Project | Coverage before | Coverage after | Lines removed from the denominator |
| --- | ---: | ---: | ---: |
| `recap` | 86.0% | 86.0% | 0 — nothing structural to exclude |
| `restore-wss` | 62.4% | **73.6%** | 360 (the two JavaScript halves) |
| `lo-pert` | 58.9% | **98.4%** | 285 (the four UNO-facing modules) |

`recap` was checked and left alone: its 17 uncovered lines are four small files, only one of
which (`internal/render/width_other.go`, behind a `!unix` build tag) is structurally
unreachable, and excluding one line to tidy an 86.0% figure is not worth the precedent.

With that denominator, **60% is a floor all three clear comfortably** while still failing a
new module that arrives with no tests at all. 80% would have blocked `lo-pert`'s first pull
request on structure rather than on quality, and a gate that blocks honest work is a gate
that gets bypassed, which is worse than an advisory one.

The headroom is now large — 73.6% and 98.4% against a 60% floor — which is an argument for
raising it. Deliberately not raised in the same entry that introduced it: the numbers above
are *overall* coverage, and no pull request has yet produced a real **new-code** coverage
reading. The table at the bottom is where that evidence accumulates.

**The number is meant to rise.** The table at the bottom of this file records the new-code
coverage of every real pull request, so the next raise can be argued from evidence rather
than from taste.

### Why the GJS projects get no coverage condition

Not a 0% threshold: a threshold satisfied by definition is theatre, and it reads as "we
measured and accepted nothing" when the truth is that there is no instrumentation story for a
gjs suite. An absent condition, with the reason written down here, is the honest form.

If a GJS coverage story ever appears, the change is one line in
`scripts/ensure-quality-gate.sh` and a row in the table below.

### Why `Security hotspots reviewed = 100%` is dropped

This is the one default condition deliberately removed from both gates.

Reviewing a hotspot is a *human* action in the SonarQube Cloud UI. As a blocking condition,
one hotspot on new code makes an entry unfinishable, and the only way an agent could clear it
is to rubber-stamp it through the API — which is worse than not having the condition, because
it turns a real prompt to think into a reflex.

Hotspots stay visible on the dashboard and get reported in `STATUS.md`, which is the
treatment they had before this entry.

### What the gate still cannot see

**Sonar skips the coverage and duplication conditions entirely when a period has fewer than
20 new lines**, on pull requests as well as branches, and says nothing about having done so.
Every gate reading in `baseline.md` passed that way. A small pull request therefore satisfies
both conditions vacuously, and the gate reports `OK`.

That is documented rather than worked around: there is no Sonar setting for it, and the
alternative — failing small pull requests for lack of evidence — would block exactly the
changes that are safest. `pr-gate.sh` prints the new-line count beside the conditions so the
distinction between "passed" and "not evaluated" is never silent.

## Readings from real pull requests

One row per pull request that reached a gate, so the next threshold change is evidence.
"New lines" under 20 means coverage and duplication were not evaluated.

| Date | Project | PR | New lines | Coverage on new code | Duplication on new code | Result |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 2026-08-26 | `restore-wss` | [#1](https://github.com/gortazar/restore-wss/pull/1) | 0 | not evaluated | not evaluated | OK — 3 rating conditions only |
| 2026-08-26 | `lo-pert` | [#1](https://github.com/gortazar/lo-pert/pull/1) | 0 | not evaluated | not evaluated | OK — 3 rating conditions only |

Both of those are the vacuous case again, and for a reason worth naming: each pull request
changed only `sonar-project.properties`, which is configuration rather than an analysed
source, so the diff contained **no new lines of code at all**. Not one of the five
conditions that could have been evaluated was — the gate returned `OK` on three ratings over
an empty set.

That is two more data points for the same finding `baseline.md` opened with, and the reason
the first row with a real new-code coverage figure matters more than any of them.
