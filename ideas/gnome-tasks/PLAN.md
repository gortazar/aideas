# Plan: gnome-tasks 0.2 — say what CI actually reports

Difficulty estimate: easy — no code changes, one file to rewrite in places, and the whole job is
reading evidence (`gh run view`, one `nix flake check`) and making prose match it; the only real
care needed is not replacing one unverified sentence with another.

## Context

The report: `STATUS.md` line 74 says

> This checkout's `origin` is a local bare repo, so `.github/workflows/ci-gnome-tasks.yml` has
> never run

and that is false about this tree. `origin` is `github.com:gortazar/aideas`, and the workflow had
already run on `main` seven times — including on 2026-08-09, the day this entry was declared done —
when the sentence was written on 2026-08-10 from a sandbox clone. `STATUS.md` is the only report
anyone reads to judge an idea, so a sentence describing somebody's clone as though it were the
repository is the one kind of error that cannot be left in it.

The sentence does more damage than a stale fact, because it is load-bearing: it is the stated reason
that **"whether GitHub runners can run a nested headless Shell is still unknown"**, which is in turn
the answer to the last open question in `plans/01-2026-08-28.md`. The workflow carries a
`nested-shell-smoke` job (`continue-on-error: true`) written for exactly that purpose — it boots a
nested Shell with `tools/probe` and prints `VERDICT: a nested headless GNOME Shell runs on this
runner` or its negation. If that job has been running for weeks, the question has a public answer and
nobody read it. So the correction is not "delete a false sentence"; it is **go and get the verdict,
and write down what it says**, whichever way it came out.

Assumptions, stated rather than asked:

- **The unit of truth is a named run, not a count.** "Seven times" was true when the audit was
  written and is already wrong by this push. The correction cites what the workflow runs, what the
  jobs concluded, and the verdict text, each attributed to a run id and date — a form that ages into
  "as of then" rather than into a falsehood.
- **`status: not_started` in the header is correct and must not be "fixed".** The orchestrator
  rewrites it when it queues an entry (`orchestrator/orchestrator.py:1258`), so it describes this
  entry, not the finished work the body describes. The `## Log` line saying `done` is the record.
- **Nothing gets re-verified that was verified on a machine.** `make smoke`'s eleven checks and the
  two experiments stay as claims about 2026-08-09; they get *re-scoped* wording, not a re-run. A
  nested-Shell run from this session would be a long blocking wait that gets interrupted, and its
  result would not make the old sentence any truer.
- **No upstream repository, under any interpretation of this entry.** Not created, not proposed, not
  prepared for. The in-repo arrangement is a real deviation from AGENTS.md and gets recorded in
  `STATUS.md` as one — recording it is not the same as fixing it, and moving the idea is a separate
  decision the audit explicitly left open.
- **Minor update: `version: 0.1` → `0.2`**, as the entry says, set in the same commit that finishes
  the work.

## Features

- **The CI sentence is replaced by what CI reports.** `.github/workflows/ci-gnome-tasks.yml` runs
  path-filtered on every push touching `ideas/gnome-tasks/**`; the blocking `test` job runs
  `nix flake check --print-build-logs` on `ubuntu-latest`. `STATUS.md` says so, names the runs it
  read, and drops both halves of the false claim — the bare-repo remote *and* "has never run".
- **The runner question is answered, or its real reason for being open is given.** The
  `nested-shell-smoke` verdict is taken from the job's own log line and its `nested-shell-log`
  artifact, and stated as the answer to `plans/01-2026-08-28.md`'s last open question. Three
  outcomes, all acceptable, none of them a guess: *yes* (a runner boots a nested Shell — recorded,
  with the job still non-blocking), *no* (recorded with the failing step and the log tail), or *the
  job has never actually executed its verdict step* — for instance because it was added after those
  runs, or because `apt-get` or `nested-shell.sh start` fell over first. In that third case the
  question stays open, but with the true reason: not "the workflow has never run".
- **The run-level green is not read as the job's verdict.** `continue-on-error: true` means the run
  concludes `success` whatever the smoke job did, so the correction quotes the *job's* conclusion and
  its printed verdict, and says explicitly that a green run says nothing about the nested Shell. That
  trap is what made the original sentence survivable for three weeks.
- **Every remaining sentence about the environment is re-scoped or removed.** A full read of the file
  against the tree, fixing anything that describes a checkout, a machine or a sandbox as though it
  described the repository. Known candidates, each resolved one way or the other with a reason:
  - "Firefox and Chrome are snap-confined on **this machine**" — the verification gap is real and
    stays; the excuse gets a date and a named machine instead of a "this" that follows the reader.
  - "hiding `/dev/dri` needs a user namespace **this sandbox** forbids" and the two local
    GPU-less approximation attempts — a fact about one sandbox, kept only if the CI verdict does not
    already make it moot.
  - "Nobody has installed this into a real session", the connector-name gap, and the dconf note at
    the end — checked and expected to stand: they are about the world, not about a clone.
- **The numeric and "all green" claims are re-earned or attributed.** `flake.nix` exposes `lint`,
  `unit`, `dbus` and `bundle`; "151 unit + 56 D-Bus, all green" is a claim about the tree, so it is
  re-measured from one `nix flake check` run in this session and corrected if the counts moved. Same
  for the feature table's `all green` row.
- **The twelve-feature references point at a file that exists.** `PLAN.md` is now this document;
  the twelve features it credits live in `plans/01-2026-08-28.md`. Every `PLAN.md` reference in
  `STATUS.md` that means *the original plan* is retargeted there, so the report's central table stops
  citing a plan about itself.
- **The same false sentence elsewhere is reported, not fixed.** `ideas/pwgen/STATUS.md:86-87`
  carries it from the same era and is being fixed under its own entry; `ideas/gnome-tasks/docs/
  testing.md:27` says "On GitHub runners: not yet known", which is the same claim one file over
  inside this idea (see Open Questions for whether this entry corrects it). Whatever is found and not
  touched is named in `STATUS.md` with file and line, so the next reader does not have to re-find it.
- **The no-upstream deviation is on the record.** One short paragraph: this idea has no repository of
  its own, its source and CI therefore live in `gortazar/aideas`, AGENTS.md expects otherwise, its
  Sonar coverage is the whole-repo `gortazar_aideas` project (as `README.md` already says), nothing
  in the original entry authorised the arrangement, and moving it is not this entry's decision.
- **Version 0.2, with a log line**, and a difficulty estimate for *this* entry that does not
  overwrite the `hard` estimate the build earned.

## Approach

Small units, one commit each, evidence gathered before prose is written.

1. **U0 — get the facts, write nothing.** `git remote -v` (is `origin` the GitHub remote today?),
   then `gh run list --workflow=ci-gnome-tasks.yml --branch main --limit 30
   --json databaseId,headSha,conclusion,createdAt,event`. For the runs that matter,
   `gh run view <id> --json jobs` for per-job conclusions, `gh run view <id> --log-failed` or
   `--job <smoke-job-id>` piped to `grep -a VERDICT`, and `gh run download <id> -n nested-shell-log`
   for the probe records. Check whether the smoke job even existed at each run's SHA with
   `git show <sha>:.github/workflows/ci-gnome-tasks.yml`. One pass, no `--watch`, no polling loop.
   Deliverable: a list of run ids with conclusions and verdict lines, quoted in the commit message
   of U1 so the sentence has a traceable source.
2. **U1 — the correction.** Rewrite the `Whether GitHub runners can run a nested headless Shell`
   bullet from U0's evidence, and move it out of `## What is built but not verified` if the verdict
   answers it. Nothing else in the file changes in this commit, so the diff that fixes the reported
   line is readable on its own.
3. **U2 — the full-file audit.** Read `STATUS.md` top to bottom against the tree, resolve each
   candidate above, retarget the `PLAN.md` references to `plans/01-2026-08-28.md`, and add the
   "found elsewhere" note and the no-upstream paragraph. Every changed sentence traceable to
   something in the tree or to a command run this session.
4. **U3 — re-earn the numbers.** `git add -A && nix flake check --print-build-logs` once (the
   `git add` is not optional — a flake sees only tracked files), read the unit and D-Bus counts out
   of the logs, and correct line 41 and the feature table if they moved. If a check is red, that is a
   finding for `STATUS.md`, not something to hide.
5. **U4 — version, log, and the run this push causes.** `version: 0.2`, a `## Log` line, this
   entry's own difficulty estimate. Then, once pushed, check the run this change itself triggers
   (`gh run list --workflow=ci-gnome-tasks.yml --limit 1`, one look) — it is the freshest evidence
   for the sentence just written, and if its smoke job contradicts U1, U1 is wrong and gets amended.

## Verification

There is no code here, so "tested" means every assertion has a source:

- **A claim-to-evidence checklist** covering the whole of `STATUS.md`: each sentence that asserts
  something about the tree, the CI or the environment, paired with the command whose output it came
  from, and a date for anything that was true on a machine on a day. Anything left unpaired is either
  cut or rewritten as an explicit unknown.
- **The correction is falsifiable**: the run ids, job conclusions and verdict text are quoted, so a
  reader can re-run `gh run view <id>` and disagree.
- **`nix flake check` green** at the end of U3, and the remote run for this push checked once at U4
  — not the local run alone.
- **Nothing outside `ideas/gnome-tasks/` is modified.** `ideas/pwgen/`, `README.md` and `AGENTS.md`
  are off-limits by AGENTS.md and by this entry; the pwgen occurrence is reported in prose only.

## Risks / things to watch

- **Replacing a false sentence with an unchecked one.** The obvious failure mode is to write "CI runs
  and passes, and the nested Shell works on runners" because it sounds like the happy ending. If the
  smoke job failed, or never reached its verdict step, that is what goes in the file.
- **`continue-on-error` hides the answer in plain sight.** The run is green either way; only the
  job's conclusion and its log carry the verdict. Read both.
- **The workflow at the run's SHA is not the workflow in the tree today.** The seven runs may predate
  the smoke job, and asserting otherwise would repeat the original mistake in the other direction.
- **90-day log and artifact retention.** Runs from 2026-08-09 are inside the window on 2026-08-28,
  but only just for the oldest of them; capture what U0 finds into the commit message rather than
  relying on the logs still being there next month.
- **Editing `STATUS.md` triggers CI but not the checks.** `flake.nix` deliberately excludes
  `STATUS.md` and `docs/` from the check inputs, so the path filter fires the workflow while the
  `test` job replays cached results. A green run on a docs-only push is not fresh evidence that the
  suites pass; U3's local `nix flake check` is.
- **`gh` needs the sandbox's credentials to see the runs at all.** If it cannot reach
  `gortazar/aideas`, the entry cannot be finished honestly — that is a blocking open question, not a
  licence to guess the verdict from the audit's summary.
- **The sweep and the header.** Do not touch `status:`; do not read `not_started` as a bug to fix.
  Also do not assume `STATUS.md`'s prose about a pin or a version matches the tree — this file is
  being audited precisely because it drifted once.
- **Scope pressure.** An answered "runners can boot a nested Shell" invites making the smoke job
  blocking, or moving `make smoke` into CI. Both are new work for a new entry; this one corrects the
  record.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Does this entry also correct `docs/testing.md`, which says "On GitHub runners: not yet known"
      and "Until that job has run, window capture/restore is verified by hand"? Ticking this line
      as-is fixes it here: it is the same claim as line 74, inside this same idea, and leaving it
      would have `STATUS.md` and `docs/testing.md` contradicting each other on the file's central
      correction. The alternative reading is literal — the entry names `STATUS.md`, and the
      "say so rather than fixing it" instruction covers every other occurrence, including this one,
      leaving `docs/testing.md` for a follow-up entry.
- [ ] Does a documentation-only entry on an idea with no repository of its own ship a release?
      AGENTS.md says every finished entry ships one, tagged `v<version>` from the idea's own
      repository; this idea has none and must not get one, and 0.1 shipped none either. Ticking this
      line as-is finishes 0.2 with **no release**, recording that reason in `STATUS.md`. The
      alternative follows the `orchestrator` precedent — a tag on this repository
      (`gnome-tasks-v0.2`) carrying the packed `.shell-extension.zip` — which means adding a release
      workflow to a repository this idea does not own, and is a bigger change than the entry
      describes.
