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
- **`recap-gs`'s `src/stylesheet.css`** — two BLOCKER bugs for `Unknown property "spacing"`,
  which is a real St property in GNOME Shell's own stylesheet dialect, not CSS. A genuine
  false positive, catalogued in `baseline.md` — but the gate judges *new* code, so it costs
  nothing until someone edits that file. If it ever does block a pull request, the narrow
  answer is `sonar.exclusions=src/stylesheet.css` with a row here, not a disabled rule.
