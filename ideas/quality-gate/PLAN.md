# Plan: quality-gate — make the gate block, and rewrite how every agent lands a change

Difficulty estimate: hard — the YAML is small again, but this entry changes the rules every
other agent works by, sets repository-level rulesets that can lock a repository's `main`
against all comers if a check context is misspelt, and its own pull requests are the first
test of the flow it introduces.

## Context

`baseline.md` is the evidence this entry was told to choose from, and it says three things
that shape every decision below:

- **All six gates passed vacuously.** 0 new lines each, so Sonar skipped coverage and
  duplication entirely. The baseline measured *whole-project* numbers because there was
  nothing else to measure. This entry produces the first real new-code readings, because a
  pull request analysis has a real diff.
- **80% coverage on new code is not honest here.** Measured overall: `recap` 86.0%,
  `restore-wss` 62.4%, `lo-pert` 58.9%, and 0.0% for the three GJS projects, which have no
  instrumentation story at all. One of six projects clears 80%.
- **Three of six projects rate below A, and every one of those is a false positive**: two
  BLOCKERs for `spacing` in a GNOME Shell stylesheet (St's dialect, not CSS), one for
  `Gio.FileEnumerator.next_file()` read as an unmodified loop variable, one for an assertion
  in a hypothesis property test. A blocking gate that reads those as verdicts is wrong, and
  an agent that meets one mid-cycle needs a defined move that is neither "bypass" nor "stall".

**What blocking actually requires.** A required status check alone does not stop a direct
push to `main` — the push simply lands and the check goes red afterwards. The combination
that stops it is a branch ruleset on `main` with a **pull request** rule *and* a **required
status check**. So: rulesets on the idea repositories, and an `AGENTS.md` that no longer lets
an agent push `main`.

**Which check to require.** Not the SonarQube Cloud App's own check run: these six projects
were created through the web API (`baseline.md`, "What onboarding actually took"), so whether
the GitHub App is installed on each repository is unknown and unfixable from here. What
certainly exists is the caller's own nested job, whose check context is `sonar / Analysis`
(caller job id `sonar`, and `sonar.yml`'s job is `name: Analysis`). That job succeeds today
even when the gate is red, because the scan step returns as soon as the analysis is
submitted. Making it wait and fail is one scanner argument, `sonar.qualitygate.wait=true`,
and it puts the gate behind a context this repo owns.

**Two orderings that cannot be rushed.** Callers pin `@v1`, and `v1` only moves when
`tag-sonar.yml` runs on `main` — after the orchestrator merges this branch. So a ruleset can
require `sonar / Analysis` today, but that check only starts failing on a red gate one cycle
later. Likewise the `AGENTS.md` rewrite governs the *next* cycle's agents; this entry
dogfoods the flow by hand.

**What this entry may touch, by the entry's explicit instruction:** `AGENTS.md`,
`.github/workflows/sonar.yml`, `.github/workflows/release-quality-gate.yml`, the five idea
repositories' `sonar-project.properties` and CI workflows, and the branch protection and
SonarQube Cloud configuration of those repositories. It does **not** touch other idea
folders' files, the root `README.md`, or `orchestrator/` (see the open questions).

**Version.** A major update: `0.1` → `1.0`. **Publish `quality-gate-v0.1` before touching
`STATUS.md`'s `version:` line** — `release-quality-gate.yml` reads the version out of that
file, so bumping first would publish `quality-gate-v1.0` and leave 0.1 missing forever.

## Features

- **`quality-gate-v0.1`, published and verified, before anything else.** The previous entry
  was retired without a release because the orchestrator overwrote `status: done` in the same
  commit that carried it, so the workflow read `not_started`.
  `gh workflow run "Release - quality-gate" --repo gortazar/aideas -f force=true`, then
  `ideas/quality-gate/scripts/check-release.sh 0.1`, which also checks the released
  `sonar.yml` is byte-identical to the one `v1` resolves to. `STATUS.md` records the release
  URL and the date. If the forced run fails, that failure is the entry's first unit of work,
  not a footnote.
- **A blocking gate inside `sonar.yml`, behind an input.** `fail-on-gate`, default `true`,
  adds `-Dsonar.qualitygate.wait=true` so the scanner polls the analysis to completion and
  exits non-zero on a red gate. The job's own check run is then the thing rulesets require.
  Two behaviours are preserved deliberately: a missing `SONAR_TOKEN` still prints one notice
  and **succeeds** (fork pull requests get no secrets, and a repository can be wired before
  its token is set), and the step summary is rewritten — it currently ends "The quality gate
  is advisory: a red gate is reported, not enforced", which will be a lie.
- **Two custom quality gates, created from the API by
  `scripts/ensure-quality-gate.sh`**, idempotent, token read from the machine-local agent env
  file straight into a `curl --config` on stdin — the same discipline as
  `ensure-sonar-project.sh`, never into argv, a file or a log. `api/qualitygates/create`,
  `create_condition`, `select`.

  **`aideas instrumented`** — `gortazar_recap`, `gortazar_restore-wss`, `gortazar_lo-pert`:

  | Condition | Threshold |
  | --- | --- |
  | Reliability rating on new code | A |
  | Security rating on new code | A |
  | Maintainability rating on new code | A |
  | Duplicated lines on new code | ≤ 3% |
  | **Coverage on new code** | **≥ 60%** |

  **`aideas uninstrumented`** — `gortazar_recap-gs`, `gortazar_gnome-shell-pwgen`,
  `gortazar_aideas`: the same four conditions and **no coverage condition at all**.
- **Why 60%, and why no coverage condition on the GJS projects.** Both numbers are chosen
  from `baseline.md` and both are stated in `gate.md` so the next entry can argue with them:
  - The three instrumented projects sit at 86.0%, 62.4% and 58.9% overall. 80% on new code
    is met by one of them today and is structurally unreachable for parts of the other two:
    764 lines of GJS extension inside `restore-wss` that no Python run can reach, and
    `lo-pert`'s `drawing.py`/`documents.py`/`dialogs.py`/`commands.py`, exercised only inside
    soffice's own interpreter. So the first move is not a threshold at all: it is
    `sonar.coverage.exclusions` for code no runner can reach, in each repository's own
    properties file, so the denominator becomes code that *can* be covered.
  - With that denominator, **60% is a floor all three clear today** while still failing a new
    module that arrives with no tests. 80% would block `lo-pert`'s first pull request on
    structure rather than on quality, and a gate that blocks honest work is a gate that gets
    bypassed — which is worse than an advisory one. The number is meant to rise: `gate.md`
    records the new-code coverage of every real pull request so the next raise is evidence
    too, not taste.
  - **The GJS projects get no coverage condition** rather than a 0% one, because a 0%
    threshold reads as "we measured and accepted nothing" when the truth is that there is no
    instrumentation for a gjs suite. An absent condition, with the reason written down, is
    honest; a threshold satisfied by definition is theatre.
  - **`Security hotspots reviewed = 100%` is dropped from both gates**, the one default
    condition deliberately removed. Reviewing a hotspot is a human action in the SonarQube
    Cloud UI; as a blocking condition it makes one hotspot on new code an unfinishable entry,
    and the only way an agent could clear it is to rubber-stamp it through the API. Hotspots
    stay visible and get reported in `STATUS.md` — the same treatment the gate had before
    this entry.
- **`scripts/ensure-branch-ruleset.sh <repo>`, idempotent, one repository per call.** Creates
  or updates a branch ruleset named `main protected` on `~DEFAULT_BRANCH` via
  `gh api repos/{owner}/{repo}/rulesets`, with: a `pull_request` rule at
  `required_approving_review_count: 0` (a solo owner cannot approve their own pull request,
  so any higher number is a permanent deadlock), a `required_status_checks` rule listing the
  repository's real contexts, `non_fast_forward`, `deletion`, `strict_required_status_checks_policy: false`
  (requiring the branch to be up to date turns a two-agent day into a rebase loop), and
  **no bypass actors** — the point is that the gate cannot be waved through. It also sets
  `allow_auto_merge` on the repository, which `gh pr merge --auto` needs.
- **The required contexts are read from a live pull request, not guessed.** A required check
  that is never reported leaves a pull request open forever, so the script takes the contexts
  as arguments and the unit that wires each repository first reads them from
  `gh api repos/{owner}/{repo}/commits/<sha>/check-runs` on a real pull request. Expected:
  `test` (or that repository's CI job name) and `sonar / Analysis`.
- **Five idea repositories gated**: `recap`, `recap-gs`, `gnome-shell-pwgen`, `restore-wss`,
  `lo-pert`. `title-slides` gets the pull-request rule with CI as its only required check —
  Lua has no Sonar project and `baseline.md` says why — so that the `AGENTS.md` rule can be
  one rule rather than two. `gortazar/aideas` is left ungated in this entry; see the open
  questions. `vacas` and `wg` are covered by the `AGENTS.md` rule and the script, at the
  moment their repository is created.
- **`AGENTS.md`'s workflow rules rewritten around the pull request.** The replacement for
  "push freely to your idea's repository":
  1. Never push an idea repository's `main`, and never `--admin`, `--force`, or disable,
     delete or edit a ruleset. If you think the gate is wrong, the answer is a narrow
     documented exclusion or an open question, never a bypass.
  2. Push `agent/<slug>/<YYYY-MM-DD>` and open the pull request **as a draft at the first
     unit**, not at the end: CI and the gate run on drafts, so a problem surfaces in minute
     five rather than minute forty.
  3. **Push after every unit.** Two reasons: the usual one, and because the orchestrator's
     end-of-cycle sweep tries to push rescued submodule work to `main`, which a gated
     repository now rejects — it skips that push entirely if the commit is already on a
     remote branch.
  4. When the work is done: `gh pr ready`, then
     `gh pr merge --auto --squash --delete-branch`. **GitHub does the waiting, not you** —
     that is the answer to the wall-clock problem, and it costs zero turns.
  5. **Check once; never poll.** One `gh pr checks <n>` or
     `gh pr view <n> --json state,mergedAt` late in the session. No `--watch`, no sleep loop:
     they get interrupted and they burn the cycle.
  6. Merged in-session → bump the submodule pointer to the **new `main` commit** and commit
     it with `STATUS.md`. **Never pin a commit that only exists on a branch**: a squash merge
     plus `--delete-branch` orphans it and the gitlink resolves nowhere.
  7. Not merged by session end → `status: in_progress`, and `STATUS.md` names the pull
     request number, its URL and what it is waiting for. The next session's first unit is:
     confirm the merge, bump the pin, verify the release. This is a legitimate end state.
  8. `status: done` now requires: pull request **merged**, gate green, release published and
     **verified** with the idea's own `check-release.sh`. An open pull request is not done.
- **What an agent does when the gate goes red mid-cycle**, as an explicit ladder in
  `AGENTS.md` rather than an unstated hope:
  - **Read what failed** with `ideas/quality-gate/scripts/pr-gate.sh <repo> <pr>`, which
    prints the failing conditions and the new-code issues behind them from
    `api/qualitygates/project_status?pullRequest=N` and `api/issues/search`. No token: every
    project is public.
  - **Real finding → fix it in the same pull request.** This is what the gate is for, and it
    is the expected outcome.
  - **A false positive of a class `baseline.md` already catalogued** — a GNOME Shell
    stylesheet parsed as CSS, an issue in `sonar.tests` sources, coverage of code no runner
    can reach → a *narrow* exclusion in that repository's `sonar-project.properties`, in the
    same pull request, with the reason in the commit message and a row appended to
    `ideas/quality-gate/exclusions.md`. Never a blanket exclusion, never a rule turned off
    organisation-wide.
  - **Cannot be cleared this cycle → land nothing and say so.** Leave the pull request open
    *without* auto-merge, `status: in_progress`, `STATUS.md` naming the condition and the
    measured numbers. If the gate itself is the problem — a threshold no honest change can
    meet — append an `- [ ]` open question in the idea's `PLAN.md` and stop. An entry left
    visibly unfinishable is a result; a stalled agent re-running the same red analysis every
    cycle is not.
- **The release path moves behind the pull request too.** Releases are cut from `main` by
  workflows that trigger on a push to `main`, and the merge of a pull request *is* that push,
  so the trigger is unchanged — what changes is that it fires after the agent may have
  stopped watching. So: `AGENTS.md` requires the release to be verified with the idea's
  `check-release.sh` (next cycle if the merge lands late), and `release-quality-gate.yml`
  keeps its `force` input, which is now documented as the recovery path it turned out to be.
  Its release notes stop saying the gate is advisory.
- **`exclusions.md` and `gate.md`, the two files that keep the gate honest.**
  `exclusions.md`: every exclusion any repository carries, what it hides, and why — so that a
  gate which is green because it stopped looking is visible as such. `gate.md`: the two gates'
  conditions, the reasoning above, and a growing table of real pull-request gate readings
  (project, PR, new lines, new-code coverage, result), which is the evidence the next
  threshold change needs.
- **`check-wiring.sh` grows the three assertions that can now rot silently.** For every
  project in its table: the repository has an active ruleset on its default branch with a
  pull-request rule and `sonar / Analysis` among its required checks; the project is assigned
  to the expected custom gate (`api/qualitygates/get_by_project`); and the wrapper's pinned
  gitlink is an **ancestor of upstream `main`**, which catches the orphaned-branch-commit
  mistake the new flow makes possible. Plus the existing four checks, unchanged.
- **`README.md` rewritten**: the five lines to wire an idea up (now six, with the ruleset
  script), what the two gates are and why their numbers are what they are, the pull-request
  flow an agent follows, and what to do about a red gate. The "The gate is advisory" section
  is replaced, not amended.

## Approach

Units, one commit each, and from U3 onward each upstream change goes through a pull request
in that repository — this entry is the first user of its own rules.

1. **U0 — `quality-gate-v0.1` exists.** Force the release, verify it with `check-release.sh
   0.1`, record it in `STATUS.md`. Nothing else starts until this passes, and `version:` stays
   at `0.1` until U7.
2. **U1 — `fail-on-gate` in `sonar.yml`**, default true, plus the rewritten step summary and
   the preserved no-token skip. `actionlint` is the only check that can run here; the input
   reaches callers only when the merge moves `v1`.
3. **U2 — `ensure-quality-gate.sh` and the two gates.** Create both, assign all six projects,
   verify each assignment by reading it back. Write `gate.md` in the same commit.
4. **U3 — coverage exclusions in the three instrumented repositories**, one pull request each:
   `restore-wss` (the GJS half), `lo-pert` (the UNO modules), `recap` (nothing to exclude —
   confirm and say so). Re-read each project's coverage afterwards and record it in
   `gate.md`: the exclusions are what makes 60% mean something.
5. **U4 — `ensure-branch-ruleset.sh`, and `recap` gated end to end.** One repository first, the
   same discipline that caught the `pull-requests: read` fault last entry: open a throwaway
   pull request, read the real check contexts, create the ruleset, confirm a direct push to
   `main` is now rejected and that a green pull request auto-merges. Only then generalise.
6. **U5 — the remaining four, plus `title-slides`.** Each is one script invocation and one
   verification. Submodule pointers bumped per repository, in the same commit as its row in
   `check-wiring.sh`, and only to commits reachable from `main`.
7. **U6 — `AGENTS.md`, `pr-gate.sh`, `exclusions.md`.** The rules rewrite last among the
   behavioural work, so it describes a flow that has actually been run rather than one that
   was planned.
8. **U7 — `check-wiring.sh`'s new assertions, `README.md`, `release-quality-gate.yml`'s notes
   and asset list (`gate.md` added — `check-release.sh` updated to match), `STATUS.md` at
   `1.0`, and the `quality-gate-v1.0` release.** Verified afterwards with `check-release.sh`,
   which is the only way anyone learns whether it worked.

## Risks / things to verify early

- **A misspelt required context bricks a repository's `main`.** A required check that is never
  reported blocks every merge, with no bypass actor, forever. Read the contexts off a live
  pull request; gate one repository first; keep in mind the recovery is `gh api -X DELETE
  repos/{owner}/{repo}/rulesets/{id}`, which the owner and this agent can both still do
  because a ruleset is repository configuration, not a branch.
- **`required_approving_review_count` above 0 is a permanent deadlock** on a solo account:
  nobody can approve their own pull request.
- **The orchestrator's sweep pushes to `main`.** `settle_submodules` in
  `orchestrator/orchestrator.py` pushes rescued submodule work with
  `HEAD:refs/heads/<default branch>`, which a gated repository will reject; the work then only
  survives as a local rescue ref under `.git/modules/`. It skips the push entirely when the
  commit is already on a remote branch, which is why "push your branch after every unit" is a
  rule and not advice. See the second open question.
- **A gitlink pinned to a branch commit is orphaned by `--squash --delete-branch`.** This is a
  new failure mode the pull-request flow creates, and `check-wiring.sh`'s ancestor check in U7
  exists for it. Until then, bump pins only after observing the merge.
- **`v1` does not move until the merge**, so the blocking behaviour from U1 reaches the five
  callers one cycle after the rulesets do. Expect one cycle in which a pull request is required
  but a red gate still passes, and say so in `STATUS.md` rather than debugging it.
- **A fork pull request has no `SONAR_TOKEN`**, so the job takes the skip path and succeeds:
  the gate is unenforced there by construction. No forks exist today; noted rather than
  solved, because the alternative turns every fork pull request red.
- **`sonar.qualitygate.wait=true` adds wall-clock** — the scanner polls the compute engine
  task before exiting. Measure it on `recap` and record the number; if it is minutes rather
  than seconds it changes the shape of every cycle.
- **Auto-merge must actually trigger the downstream workflows.** A merge attributed to
  `GITHUB_TOKEN` does not trigger other workflows; auto-merge is attributed to the user who
  enabled it, so releases should still fire. Verify on the first release that goes through a
  pull request rather than assuming it.
- **Sonar skips coverage and duplication under 20 new lines**, on pull requests too. Small
  pull requests will pass those two conditions vacuously. That is acceptable and stays
  documented in `gate.md` rather than worked around.
- **Two agents, one gated repository.** Branch names carry the slug and the date, so they do
  not collide; two open pull requests in the same repository will each need the other's merge
  before they are up to date, which is precisely why
  `strict_required_status_checks_policy` stays false.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **Does `gortazar/aideas` itself get the ruleset?** It holds a Sonar project and two
      ideas, so by the entry's wording it qualifies — but it is also the workshop: the
      orchestrator merges each agent's branch and pushes `main` directly every cycle, and a
      pull-request rule there stops every cycle dead until the orchestrator learns to open and
      merge a pull request instead. The plan therefore assumes **no ruleset on `gortazar/aideas`
      in this entry**: its analysis stays reported-not-enforced, and `STATUS.md` records the
      exception. Confirm that, or say to gate it and treat the orchestrator change as part of
      this entry.
- [x] **May this entry change `orchestrator/orchestrator.py`?** ANSWERED: **no** — and you were
      right to ask rather than assume. The fix is real and needed, so it is now its own entry,
      `ideas/orchestrator`, placed *ahead* of this one in `README.md` precisely because gating
      `main` is what breaks the sweep: it should land first. Do not touch `orchestrator/` here,
      and do not rely on "push after every unit" as the mitigation either — if the orchestrator
      entry has not landed when you start, say so in `STATUS.md` and gate the repositories whose
      sweeps do not depend on it.       **May this entry change `orchestrator/orchestrator.py`?** One line in
      `settle_submodules` decides whether end-of-cycle rescued work is pushed to `main` (now
      rejected on every gated repository) or to `agent/<slug>-sweep` (which lands and can be
      turned into a pull request next cycle). It is a small, contained fix to a real breakage
      this entry causes, but `orchestrator/` is outside the idea folder and outside anything
      `AGENTS.md` grants. Plan assumes **not**, and mitigates with the "push after every unit"
      rule instead.
