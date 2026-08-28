# Plan: restore-wss — settle the open BLOCKER honestly, then audit the rest

Difficulty estimate: easy — the audited finding is one small function in `cli.py` and a paragraph in
`STATUS.md`; what keeps it from trivial is that only *one* issue was audited, so the real work is
enumerating the rest at the exact commit Sonar analysed, and that a fix here still owes a pull
request, a fresh analysis, a version bump and a verified release.

This is a **minor** update: v0.2 → **v0.3**.

## Context

`gortazar_restore-wss` carries an open BLOCKER that `STATUS.md` neither fixes nor documents, while
the entry was closed as `status: done`:

> `python:S3516` — `src/restore_wss/cli.py:224` — "Function returns should not be invariant"

`AGENTS.md` is explicit that this combination is not done: every open BLOCKER is either fixed in the
pull request or written down in `STATUS.md` as a false positive naming the issue key, the rule, the
file and line, and why the analyser is wrong. This idea's `STATUS.md` does neither — it never
mentions Sonar at all, in eleven screens of otherwise scrupulous accounting. That is the gap this
entry closes.

Five facts shape the work.

1. **On the evidence available now, the rule is right and the remedy is a fix.** Line 224 of the
   pinned checkout is `def _list(args) -> int:`, and every one of its three exits — the `--json`
   branch, the "no snapshots yet" branch and the normal listing — is `return 0`. Nothing in the
   function can fail: `SnapshotStore._load_one` answers `None` for a missing *or* torn file and both
   are skipped silently. So the declared `int` is a promise the function never varies, and `main`'s
   `return _list(args)` propagates a constant. This is exactly what S3516 describes.
2. **Unlike `css:S4654`, there is no dialect argument to make.** The recap-gs BLOCKERs were a rule
   applied to a language Sonar cannot parse — St's stylesheet dialect read as CSS — which is why the
   profile remedy was right there. `python:S3516` is a Python rule reading Python. A "the analyser is
   wrong" note would have to argue that *this* function's constant return is meaningful, and the file
   itself contradicts that: `_print_status` and `_print_window_detail` return `None` and their call
   sites supply the `0`. The precedent for the honest shape is four functions up. `AGENTS.md`'s "if
   you are not sure, it is not a false positive" therefore points one way, and the plan below is
   written for the fix — but the verdict is confirmed against the analysed revision before anything
   is edited, not assumed from this paragraph.
3. **The line number is only meaningful at the commit Sonar analysed.** The `upstream` gitlink is
   currently modified in the working tree and the sweep is known to revert pins, so `cli.py:224` here
   and `cli.py:224` there may not be the same function. Step one reads the issue's own
   `component`/`line` and the file at that revision.
4. **Only this one issue was audited, and the baseline says the project was clean.**
   `ideas/quality-gate/baseline.md` records `gortazar_restore-wss` at commit `4f286a9`, analysed
   2026-08-25, with **0 bugs** and reliability **A** — the cleanest of the six projects. An open
   `python:S3516` is inconsistent with that snapshot, which means either a later analysis introduced
   it (v0.2's browser work is the obvious candidate) or the audit read clean-code *impact* severities
   where the baseline read the legacy `bugs` measure. Both readings are queried, because "how many
   BLOCKERs are open" has two answers under MQR and the entry has to satisfy the stricter one.
5. **No issue's status may change.** The token can call `api/issues/do_transition` and
   `api/issues/bulk_change`; this entry must not, and must not ask the fleet scripts to either. The
   machine-checkable evidence of that is what the issue resolves *as* after the fix: `FIXED`, not
   `FALSE-POSITIVE` or `WONTFIX`.

Assumptions, stated rather than asked: the change is a real (if small) code change, so v0.3 ships a
release on the normal terms — the doubt recap-gs's plan raises about releasing a documentation-only
version does not apply unless the verdict flips to branch B below. Nothing about `restore-wss`'s
behaviour changes for a user: `restore-wss list` prints the same lines and still exits 0. The v0.1
and v0.2 "built but not verified" lists are inherited as they stand; this entry is not the one that
re-runs `tools/smoke-nested.sh` or installs the add-on into a real Firefox, and it must not quietly
claim otherwise.

## Features

- **A full BLOCKER audit of the project, not just the one issue handed over** —
  `api/issues/search?componentKeys=gortazar_restore-wss&resolved=false` read twice, once with
  `severities=BLOCKER` (legacy) and once with `impactSeverities=BLOCKER` (MQR), plus the same query
  with no severity filter to know the whole shape. Recorded as a table in `STATUS.md`: issue key,
  rule, component, line, severity under both models, and the analysis date and commit the reading
  came from. Read-only; `read-measures.sh` and `curl --config -` with the token off argv, in the
  house style.
- **A written verdict on `python:S3516`, in the file it concerns and in `STATUS.md`** — one of two
  branches, chosen from the code at the analysed revision and not from convenience:
  - **A — fix it (expected).** `_list` stops pretending to compute an exit code: it becomes
    `def _list(args) -> None`, its three `return 0`s become plain `return`/fall-through, and
    `main`'s `list` arm becomes `_list(args)` followed by `return 0` — the shape `status` already
    uses two arms above. Any test asserting the return value of `main(["list"])` keeps asserting
    `0`, because `main`'s contract does not change. A one-line comment says why the function returns
    nothing, so the next reader does not "restore" the invariant `int`.
  - **B — document it.** Only if the code at that revision genuinely varies its return and the issue
    is stale or misplaced. Then `STATUS.md` carries the issue key, `python:S3516`, the file and line,
    and the specific reason the analyser is wrong — and the reason has to survive being read by
    someone who disagrees. No profile change and no `sonar.exclusions` for a rule that is right about
    the language; those remedies are for rules that are wrong about a technology.
- **Whatever else the audit finds, dispatched by the same rules** — each further BLOCKER gets fixed
  in this pull request, or documented in `STATUS.md` as a false positive with its own reasoning, or
  (only where a rule is systematically wrong for the technology) sent to the profile route with a row
  in `ideas/quality-gate/exclusions.md`. Non-BLOCKER issues are *listed* in `STATUS.md` so the next
  entry knows what is there, and left alone: they do not gate `done` and this is a minor update.
- **A fresh analysis, because nothing closes without one** — the fix lands through a pull request on
  `gortazar/restore-wss` with the gate green on the way in (`pr-gate.sh` read, not guessed), and the
  merge analysis of `main` is what closes the issue. The diff is a handful of lines, so the coverage
  and duplication conditions will very likely be skipped for having fewer than 20 new lines; the
  entry records that this is what happened rather than reporting a vacuous pass as a win.
- **Verified with numbers** — after that analysis: both BLOCKER queries return 0, `bugs` and
  `reliability_rating` read back (expected 0 / **A**), and the `python:S3516` issue's own record shows
  `status: CLOSED`, `resolution: FIXED`. That last line is the evidence that the gate was cleared by
  changing code and not by changing a label.
- **`STATUS.md` finally mentions Sonar** — a v0.3 section carrying the audit table, the verdict and
  its reasoning, the before/after measures, the dashboard link, and the analysed commit. Written so
  that `AGENTS.md`'s "documented BLOCKER" requirement is met by the text itself for anything left
  open, and so a reader can tell fixed from documented at a glance.
- **`ideas/quality-gate/baseline.md` corrected where it is now stale** — the `gortazar_restore-wss`
  section states 0 bugs and A/A/A at `4f286a9`; it gains a dated note with the reading taken here
  (before and after), because the baseline is a record of what was measured and a later measurement
  belongs beside it. A rewrite of the section is not in scope.
- **v0.3 released and verified** — version bumped in the one place upstream keeps it, the tag pushed
  **from the upstream repo** so its own tag-triggered `release.yml` fires (a tag arriving with the
  orchestrator's push does not), `ideas/quality-gate/scripts/check-release.sh` confirming the assets,
  the `upstream` gitlink advanced and `ideas/restore-wss/scripts/check-pin.sh` green, and
  `install.sh` run once from a clean directory with `XDG_DATA_HOME` redirected. `nix flake check`
  green upstream and here, and the remote CI run checked with `gh run list` rather than inferred from
  a local pass.

## Approach

Ordered so the verdict is settled before any prose is written around it, and so the paperwork
describes what happened rather than what was planned.

1. **S0 — read.** `check-pin.sh` first (the pin may have been reverted). Then the issue list, both
   severity models, and `cli.py` at the analysed revision. Output: the verdict, branch A or B, with
   the quoted code that decides it.
2. **S1 — fix (or write the note).** The `_list` change plus test adjustments, or branch B's
   `STATUS.md` paragraph. Anything else the audit surfaced at BLOCKER goes in the same commit series,
   one commit per finding.
3. **S2 — pull request and gate.** Open early, `pr-gate.sh` read before merging, merge, then wait for
   the `main` analysis and re-read the issue and the measures. If the numbers do not come back clean,
   stop and say so with the values — do not reach for a dismissal.
4. **S3 — paperwork.** `STATUS.md` (audit table, verdict, numbers, link), `baseline.md`'s dated note,
   `exclusions.md` only if a remedy there was actually used.
5. **S4 — release.** Bump, tag from upstream, verify the release, bump the pin, verify the pin, run
   the installer from a clean directory, then set `version: 0.3` and `status: done`.

## Risks / things to verify early

- **The pin may not be what `STATUS.md` claims.** Known fleet behaviour, and it decides whether
  `cli.py:224` is the function this plan describes. `check-pin.sh` before anything else.
- **The sweep overwrites `status: done`** — as it already has here (`status: not_started`,
  `version: 0.2`, with three `done` lines in the log). Trust `check-release.sh` and `check-pin.sh`
  over the header, and recover a release that never fired with the workflow's `force` input.
- **Two answers to "how many BLOCKERs".** Legacy severity and MQR impact severity disagree on
  Python rules like this one; querying only one of them is how an entry declares itself clean while a
  BLOCKER is open under the other model. Query both, record both.
- **A tiny diff makes the gate pass vacuously.** Fewer than 20 new lines and Sonar silently drops the
  coverage and duplication conditions — the exact artefact `baseline.md` was written to warn about.
  Report the skip; do not present it as coverage.
- **The temptation this entry exists to resist.** The cheapest path to `status: done` is a paragraph
  calling S3516 a false positive because CLI functions "conventionally" return exit codes. The same
  file already shows that convention does not require it. If the fix turns out harder than expected,
  the honest outcome is `in_progress` with the finding written down — not a note that reclassifies a
  correct finding.
- **Releasing needs the tag to originate upstream, and workflow-file edits need an SSH push URL.**
  No workflow change is expected here, but the release path is the one that has bitten this fleet
  before; verify with `ls-remote` that the submodule push actually landed before tagging.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Which shape should the fix take? (a) `_list` returns `None` and `main` supplies the `0` —
      no user-visible change, matches `_print_status` two arms above, and is the recommendation; or
      (b) `list` gains a real non-zero exit for the case it currently hides — a snapshot file that
      exists but will not parse is today reported as "no snapshots yet", which is arguably a genuine
      gap worth an exit code and a printed warning. (b) fixes the rule *and* a small honesty bug, but
      it changes documented CLI behaviour in an entry billed as a minor cleanup.
- [ ] If the audit turns up further BLOCKERs that are real but not small — something needing a
      behaviour change or a new test surface rather than a line edit — does this entry grow to fix
      them, or does it land the audited fix plus a written account of the rest and stop at
      `in_progress`? Growing keeps the project's BLOCKER count at zero; stopping keeps a minor update
      minor and leaves a scoped entry for the queue.
