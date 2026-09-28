# Every exclusion, what it hides, and why

A quality gate that is green because it stopped looking is worse than one that is red. This
file is the ledger that makes that visible: every `sonar.exclusions`,
`sonar.coverage.exclusions` and `sonar.cpd.exclusions` any repository in this fleet carries,
what it removes from the gate's view, and the reason.

**Adding an exclusion means adding a row here**, in the same pull request as the exclusion
itself. `AGENTS.md` makes that a rule, not a courtesy: an exclusion is only defensible while
someone can see it.

The bar is narrow and specific. An exclusion is justified when Sonar is measuring something
that cannot be true — code no runner can reach, a file in a dialect Sonar does not have an
analyser for — and not when a finding is merely inconvenient. "Blanket exclusion" and "rule
disabled organisation-wide" are never the answer; if the gate itself is wrong, that is an
open question in `PLAN.md`, not a wider glob.

## sonar.coverage.exclusions

Removed from the coverage denominator. Still analysed for bugs, smells and duplication.

| Repository | Pattern | Lines | What it hides | Why |
| --- | --- | ---: | --- | --- |
| `restore-wss` | `src/extension/**` | 308 | The GNOME Shell extension | Runs inside gjs in the compositor's process. No Python coverage run can execute a line of it. |
| `restore-wss` | `src/browser-extension/**` | 52 | The Firefox extension | Runs inside Firefox, same reason. |
| `lo-pert` | `src/lopert/{commands,dialogs,documents,drawing}.py` | 285 | The four UNO-facing modules | Covered for real by `tests/integration`, which installs the built `.oxt` and drives the menu commands — but inside soffice's own Python interpreter, which `coverage.py` is not running in and cannot instrument from outside. They report 0.0% while being exercised. |
| `recap` | `**/testdata/**` | — | SQLite fixtures | Recorded agent state, not code anyone wrote. Excluded from sources outright (below), so also from coverage. |

## sonar.exclusions

Removed from analysis entirely — the strongest form, and the one to justify hardest.

| Repository | Pattern | What it hides | Why |
| --- | --- | --- | --- |
| `recap` | `**/*_test.go` | Go test files | Named as `sonar.tests` instead, via `sonar.test.inclusions`. Go keeps tests beside the code, so without the split every `_test.go` file counts as production code. |
| `recap` | `**/testdata/**` | Three SQLite fixtures | Recorded agent state. The first analysis reported them as 121 lines of "PL/SQL" measured against rules meant for stored procedures; excluding them halved the project's reported smells from 26 to 12. |
| `restore-wss` | `tests/fixtures/**` | Recorded window layouts | Data, not code. |
| `lo-pert` | `spikes/**` | An abandoned design | Kept because the reasoning is worth reading; not code the project maintains. |
| `aideas` (this repo) | `ideas/*/upstream/**` | Every submodule | Each is a separate repository with a SonarQube Cloud project of its own. Counting them here would double-count every line and wreck this project's numbers. |

## sonar.cpd.exclusions

| Repository | Pattern | What it hides | Why |
| --- | --- | --- | --- |
| `aideas` (this repo) | `**/*.min.js` | Minified bundles | Vendored or generated, not written here. |

## Quality profiles

Not an exclusion, but the other half of the same ledger, and it belongs here for the same
reason: a rule that stops reporting is a decision someone has to be able to find.

An exclusion says *do not look at this file*. A profile change says *this rule is wrong about
this whole language*. Reach for the profile when the rule would misfire on every file of that
kind anyone ever writes — the table at the end of `AGENTS.md`'s **Issues: fix them, configure
around them, never re-label them** is the split. Apply it with
`scripts/ensure-quality-profile.sh`, which is idempotent and refuses to modify the
organisation default.

| Profile | Language | Copied from | Rule deactivated | Projects | What it stops reporting |
| --- | --- | --- | --- | --- | --- |
| `GNOME Shell (St) stylesheets` | `css` | `Sonar way` (`AYFtO8KbS-wEfpJs_r1u`) | `css:S4654` — CSS properties should be valid | `gortazar_recap-gs` | `Unknown property "…"` for St-only properties in GNOME Shell stylesheets |

**Why.** GNOME Shell stylesheets are St's dialect, not CSS: the toolkit borrows CSS's syntax
and adds properties of its own — `spacing`, `natural-width`, the `-st-` family. SonarQube
Cloud has no St analyser, so it reaches for the CSS one, which reports every St-only property
as invalid. On `recap-gs` that was two BLOCKER bugs for `spacing` in a 38-line stylesheet —
enough, on their own, to hold a project with no other defect at a reliability rating of **E**.
The rule is not wrong about two lines; it is wrong about the dialect, and it will be wrong
about it on every GJS project with a stylesheet, forever. That is the case this remedy is for.

**What it cost.** Two things, both real:

- **A copied profile does not follow the built-in one.** Sonar updates `Sonar way`; this copy
  keeps the rule set it was copied with on 2026-09-28. One rule off one language is small
  drift, but it is drift, and re-copying is the remedy when it matters — which is why the
  source key is in the table rather than left to be looked up.
- **`css:S4654` no longer catches a genuine property typo** in a real CSS file in an assigned
  project. For `recap-gs` there is no such file: its entire CSS is the one St stylesheet. For
  any project assigned this profile later, that has to be true too, or the profile is the
  wrong remedy for it.

**What it did not cost.** No issue's status was changed. `api/issues/do_transition` and
`api/issues/bulk_change` were not called, and `ensure-quality-profile.sh` does not contain
them. That is checkable rather than asserted, and anyone can check it without a token — a
deactivated rule's findings close as **removed**, where a dismissal would have left
`FALSE-POSITIVE` or `WONTFIX` behind. Checked on 2026-09-28, after the analysis of `main` at
`08528f2`, both keys read `CLOSED` / `REMOVED`, and the project went from 2 bugs and
reliability **E** to 0 bugs and reliability **A**:

```sh
curl -fsS 'https://sonarcloud.io/api/issues/search?componentKeys=gortazar_recap-gs&issues=AaA5xQ_tVAZt5f74MM8u,AaA5xQ_tVAZt5f74MM8v&resolved=true' |
    jq -r '.issues[] | "\(.key) \(.status) \(.resolution)"'
```

**`gortazar_aideas` is eligible and deliberately not assigned.**
`ideas/aideas/src/extension/stylesheet.css` is the fleet's only other GNOME Shell stylesheet
— measured, not assumed: `css=37` of its `ncloc_language_distribution` against `recap-gs`'s
`css=38`, and no other project reports any CSS at all. It uses no St-only property today and
so has no issue. The answered open question makes the opt-out conditional on the project
**saying so in its own README**, and this entry belongs to `recap-gs` and may not write
`aideas`'s. So the row above gains `gortazar_aideas` on the day that project both goes red and
says so — one command, `ensure-quality-profile.sh aideas`, the profile already being in place.

## Considered and rejected

Kept deliberately, so that nobody re-proposes them as obvious:

- **`recap`'s uncovered 17 lines** — `cmd/recap/main.go` (1), `internal/render/width_other.go`
  (1, unreachable on Linux behind a `!unix` build tag), `internal/render/width_unix.go` (12)
  and `internal/session/session.go` (3). Only the build-tagged file is structurally
  unreachable, and excluding one line to tidy an 86.0% figure is not worth the precedent.
- **`restore-wss`'s `src/native-host/` and `daemon.py`** — 0% covered, and both *are*
  reachable from Python. `daemon.py` could be reached by `tests/dbus` if that suite were
  instrumented, and the native messaging host by a test nobody has written. Those are real
  coverage gaps. Excluding them would turn the gate green by making it blind, which is
  exactly the failure this file exists to prevent.
- **`sonar.exclusions=src/stylesheet.css` on `recap-gs`** — which is what this file
  prescribed until 2026-09-28, and it was the wrong call. The two BLOCKER bugs for
  `Unknown property "spacing"` were taken the other way, through a quality profile with
  `css:S4654` deactivated (above), for two reasons the file exclusion could not match.
  **It is the rule that is wrong, not the file**: `spacing` is valid St, so excluding the
  file would record "do not look here" where the truth is "this analyser does not know this
  language" — and the next GJS project with a stylesheet would have to rediscover that.
  **And the exclusion is blunter than the problem**: it would drop the whole stylesheet from
  analysis, including the thirty-odd lines that *are* ordinary CSS and *are* worth checking,
  to silence two. The profile leaves the rest under analysis. Do not re-propose the
  exclusion; if the profile ever stops being right, the answer is a narrower rule set in the
  profile, not a blind spot in the sources.
