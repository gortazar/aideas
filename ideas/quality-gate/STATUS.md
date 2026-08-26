status: done
version: 1.0
started_at: 2026-08-25
last_session_id: 0c56aa7b-8858-406c-8f49-2c49a15d0727
last_run: 2026-08-25T18:44:49+02:00
last_cycle_cost_usd: 12.180309000000001

## Log
- 2026-08-25T18:44:49+02:00 — done ($12.180309000000001)
- 2026-08-25T17:21:00+02:00 — in_progress ($18.3907995)
- 2026-08-25T13:11:09+02:00 — blocked ($3.1778349999999995)




### 2026-08-26 — U7: done at 1.0

**What `done` covers.** Every feature in this entry's `PLAN.md` is delivered and green.

- **The gate blocks**, and it takes all three of these, none of which works alone:
  `sonar.qualitygate.wait=true` so the job's verdict *is* the gate's verdict; a branch
  ruleset requiring both a pull request and that check, because a required check alone lets
  a direct push land and go red afterwards; and no bypass actors.
- **Two custom gates**, created and reconciled from the API, every project assigned and read
  back. `gate.md` justifies 60% rather than 80%, an absent coverage condition rather than a
  0% one, and dropping `Security hotspots reviewed`.
- **Six repositories gated**, each with contexts read off a live run. `gortazar/aideas` is
  ungated on purpose and `check-wiring.sh` asserts that too.
- **`AGENTS.md` rewritten** around the pull request, with a defined ladder for a red gate.
- **`check-wiring.sh` grew three assertions** that can now rot silently — ruleset, gate
  assignment, and pin reachability — and all three were negative-tested by breaking the
  expectation and watching them fail.
- `README.md` rewritten; `exclusions.md` and `gate.md` added to the release assets, with
  `check-release.sh` updated to require them.

**The release publishes on the merge**, as `quality-gate-v1.0`. Confirm it afterwards with
`ideas/quality-gate/scripts/check-release.sh 1.0`, which also checks the released
`sonar.yml` is byte-identical to the one `v1` resolves to. **If the sweep overwrites
`status: done` again** — it did last time, which is why U0 existed — the recovery is
`gh workflow run "Release - quality-gate" --repo gortazar/aideas -f force=true`.

### Two things a reader should not have to discover for themselves

**`fail-on-gate` has not yet blocked anything.** Callers pin `@v1`, and `v1` only moves when
`tag-sonar.yml` runs on `main` after this branch is merged. Every pull request in this entry
was therefore analysed by the *old* workflow, which returns before the gate is known. The
rulesets are live and the gates are live; the *waiting* reaches the five callers one cycle
later. This was predicted in the plan's risks and is not a defect — but it does mean the
wall-clock cost of `sonar.qualitygate.wait` is still unmeasured, and the first entry to run
under it should record it in `gate.md`.

**The orchestrator entry has still not landed**, so `settle_submodules` still pushes rescued
work to `HEAD:refs/heads/main`, which the six gated repositories now reject. Consequences,
read from the code rather than assumed: `submodule_paths()` filters to `ideas/<slug>/`, so
only the built idea's own submodule is affected; the push is skipped entirely when the
commit is already on a remote branch, which the new "push after every unit" rule makes the
normal case; and when it does fail, the objects are rescued into `.git/modules/<path>` under
`refs/aideas/rescued/<slug>/<sha>` with a WARNING rather than being lost. So the failure
mode is "work is somewhere awkward and loudly reported", not "work is gone". The
`ideas/orchestrator` entry is ahead of this one in `README.md` and fixes it properly.

### 2026-08-26 — U6: the rules every agent works by, rewritten around the pull request

`AGENTS.md` last, on purpose, so it describes a flow that has actually been run rather than
one that was planned. What changed:

- **"Push there freely" is gone.** Push access is to *branches*; every idea repository's
  `main` is behind a ruleset with no bypass actors.
- A new **Landing a change upstream** section: eight numbered rules. Branch as
  `agent/<slug>/<YYYY-MM-DD>`, draft pull request at the *first* unit rather than the last,
  push after every unit, then `gh pr ready` and
  `gh pr merge --auto --squash --delete-branch` — **GitHub does the waiting, not you**,
  which is the answer to the wall-clock problem and costs zero turns. Check once, never
  poll. Bump the pin to the **new `main` commit**, never to a branch tip a squash merge
  orphans. And: a pull request still open at session end is `status: in_progress` with its
  number and URL in `STATUS.md` — **a legitimate end state**, not a failure.
- **A red gate has a defined ladder**, not a hope: read it with `pr-gate.sh`; fix a real
  finding in the same pull request; give a catalogued false positive a narrow exclusion plus
  a row in `exclusions.md`, in the same pull request; or land nothing and say which
  condition and what the numbers were. Bypassing is not on the ladder, and the rules say so
  in as many words.
- `status: done` now requires the pull request **merged**.
- The Shipping section stops calling the gate advisory and says it blocks.
- A three-command checklist for a brand-new idea repository — secret, project, ruleset — with
  the ruleset last and the warning to read its contexts off a live pull request, since
  `gnome-shell-pwgen` proved they are not guessable.

`scripts/pr-gate.sh <repo> <pr>` prints every condition with its measured value and
threshold, the new-code issues behind the failing ones, and the ladder. It needs no token.
Tested both ways: on `recap` #1 it reports the gate green, three conditions evaluated and
**"under 20 new lines, so Sonar did not evaluate coverage or duplication at all"**; on a
pull request that does not exist it explains the three reasons that happens and exits 1.
Its output is also the first independent confirmation that the custom gate is really in
force — `new_security_hotspots_reviewed` is absent from the conditions, which is exactly the
condition `ensure-quality-gate.sh` drops.

`exclusions.md` was written in U3, when the first two exclusions needed it.

### 2026-08-26 — U4 and U5: six repositories gated, and the loop proven end to end

`scripts/ensure-branch-ruleset.sh <repo> <context>...` creates or updates a `main protected`
ruleset on `~DEFAULT_BRANCH`: a `pull_request` rule at **0 required approvals** (a solo owner
cannot approve their own pull request, so anything higher is a permanent deadlock), a
`required_status_checks` rule, `non_fast_forward`, `deletion`,
`strict_required_status_checks_policy: false` (requiring the branch to be up to date turns
two open pull requests in one repository into a rebase loop), and **no bypass actors at
all**. It also sets `allow_auto_merge`, which `gh pr merge --auto` refuses to work without.
One repository per call, deliberately: this is the script that can lock a `main` against
everybody, so there is no bulk mode.

**recap first, end to end, and all three steps verified:**

1. Contexts read off a live pull request — `test`, `coverage`, `sonar / Analysis` — not
   guessed.
2. **A direct push to `main` is rejected**: `GH013: Repository rule violations found ...
   Changes must be made through a pull request ... 3 of 3 required status checks are
   expected`, and `main` did not move.
3. **A green pull request auto-merges**: [recap #1](https://github.com/gortazar/recap/pull/1)
   merged itself at 09:48 UTC while this session did something else. `gh pr merge --auto`
   was set once, checked once. No polling, no `--watch`.

Then the other five. Every set of contexts was read from a real run rather than assumed, and
that caught the trap the plan warned about:

| Repository | Required checks |
| --- | --- |
| `recap` | `test`, `coverage`, `sonar / Analysis` |
| `recap-gs` | `check`, `package`, `sonar / Analysis` |
| `restore-wss` | `check`, `coverage`, `sonar / Analysis` |
| `lo-pert` | `nix flake check`, `coverage`, `sonar / Analysis` |
| `gnome-shell-pwgen` | 3 lint/test jobs, 5 GNOME Shell legs, **`SonarQube Cloud / Analysis`** |
| `title-slides` | `test` — no Sonar project, because Lua |

**`gnome-shell-pwgen` does not report `sonar / Analysis`.** Its caller job carries
`name: SonarQube Cloud`, so the context is `SonarQube Cloud / Analysis`. Requiring the
former across all six — which is exactly what the plan's own expectation said — would have
left that repository's `main` unmergeable forever, with no bypass actor to undo it.

Two judgement calls worth recording. `gnome-shell-pwgen`'s **`GNOME Shell (fedora:rawhide)`
leg is deliberately not required**: it is `continue-on-error` upstream precisely because
rawhide breaks for unrelated reasons, and requiring it would hand a merge veto to Fedora's
development branch. The five stable legs are required. And **`SonarCloud Code Analysis`**,
the SonarQube Cloud GitHub App's own check, is reported on every repository but required on
none — which repositories the App is installed on is not knowable from here, and a check
that stops being reported is a `main` nobody can merge to.

**`gortazar/aideas` is deliberately left ungated**, per the first answered open question: the
orchestrator pushes `main` here directly every cycle, and a pull-request rule would stop
every cycle dead until the orchestrator learns to open and merge one itself. Its analysis
stays reported-not-enforced. `--status aideas` confirms there is no ruleset.

Recovery, if a context is ever wrong: `gh api -X DELETE repos/{owner}/{repo}/rulesets/{id}`
still works, because a ruleset is repository configuration rather than a branch. `--status`
prints the id.

Pins bumped for all three merged pull requests, each to the **new `main` commit** and each
checked with `merge-base --is-ancestor` — a squash merge with `--delete-branch` orphans the
branch tip, and a gitlink pointing at it resolves nowhere.

### 2026-08-26 — U3: the exclusions that make 60% mean something

Three repositories, and the entry's first use of its own pull-request rule. Both changes
went through a pull request in their own repository, with `gh pr merge --auto --squash
--delete-branch` doing the waiting — merged 09:40 UTC, and the pins bumped afterwards to the
**new `main` commits**, never to the branch tips a squash merge orphans.

The exclusions were chosen from measured per-file coverage rather than from the plan's
guess, and they are `sonar.coverage.exclusions` only — every excluded file is still analysed
for bugs, smells and duplication:

| Project | Excluded | Lines | Coverage before | after |
| --- | --- | ---: | ---: | ---: |
| [`restore-wss` #1](https://github.com/gortazar/restore-wss/pull/1) | `src/extension/**`, `src/browser-extension/**` | 360 | 62.4% | **73.6%** |
| [`lo-pert` #1](https://github.com/gortazar/lo-pert/pull/1) | the four UNO-facing modules | 285 | 58.9% | **98.4%** |
| `recap` | nothing | 0 | 86.0% | 86.0% |

`recap` was checked and deliberately left alone: 17 uncovered lines across four small files,
only one structurally unreachable (a `!unix` build tag), and excluding one line to tidy an
86.0% figure is not worth the precedent.

Two things were **not** excluded although they read 0%, and `exclusions.md` says why under
*Considered and rejected*: `restore-wss`'s `daemon.py` and native messaging host are both
reachable from Python, so they are genuine coverage gaps rather than structural ones.
Excluding them would turn the gate green by making it blind.

`exclusions.md` is the ledger that keeps this honest — every exclusion any repository
carries, what it hides, and why, with the rule that adding one means adding a row in the
same pull request.

**Both pull-request gates were vacuous, and instructively so.** Each diff touched only
`sonar-project.properties`, which is configuration rather than an analysed source, so
neither had a single new line of code: three rating conditions evaluated over an empty set,
coverage and duplication skipped, `OK`. Recorded as the first two rows of `gate.md`'s
readings table.

Also learned, by reading the contexts off a live pull request exactly as the plan insists:
`restore-wss` reports `check`, `coverage` and `sonar / Analysis`, and `lo-pert` reports
`nix flake check`, `coverage` and `sonar / Analysis` — but `gnome-shell-pwgen` will report
**`SonarQube Cloud / Analysis`**, because its caller job carries a `name:`. Guessing
`sonar / Analysis` for all six would have locked that repository's `main` against everybody.
A fourth context exists on every repository too, `SonarCloud Code Analysis`, from the
SonarQube Cloud GitHub App; it is deliberately not required, since which repositories the
App is installed on is not knowable from here.

### 2026-08-26 — U2: two custom gates, live and assigned

`scripts/ensure-quality-gate.sh` creates both gates from the API and reconciles them
condition by condition, so editing the table in the script and re-running it is how a
threshold changes. `--status` is a check rather than a report: it exits non-zero when the
live gates disagree with the script, which is what U7 will wire into `check-wiring.sh`.

Both created and all six projects assigned, each **verified by reading
`get_by_project` back** rather than trusting the exit status — a project silently left on
`Sonar way` would have made this entry a no-op:

- **`aideas instrumented`** (id 159028) — `recap`, `restore-wss`, `lo-pert`: reliability,
  security and maintainability A on new code, duplication ≤ 3%, **coverage ≥ 60%**.
- **`aideas uninstrumented`** (id 159029) — `recap-gs`, `gnome-shell-pwgen`, `aideas`: the
  same four, and no coverage condition at all.

Re-running `--status` afterwards reports every condition `ok` and every project on the right
gate, so it is idempotent in fact and not just in intent.

`gate.md` carries the reasoning, and is the file to argue with: why 60% rather than 80%
(only `recap` clears 80% today, and the other two are short for structural reasons —
764 lines of GJS inside `restore-wss`, and `lo-pert`'s UNO modules that only run inside
soffice's interpreter — so the exclusions in U3 come first and the threshold second); why an
absent coverage condition rather than a 0% one; and why `Security hotspots reviewed = 100%`
is the one default deliberately dropped, since clearing it is a human action in the UI and an
agent could only satisfy it by rubber-stamping. It also records what the gate still cannot
see: under 20 new lines Sonar skips coverage and duplication silently, which is how every
reading in `baseline.md` came back green.

### 2026-08-26 — U1: sonar.yml waits for the gate and fails on red

`fail-on-gate`, a new boolean input defaulting to `true`, adds
`-Dsonar.qualitygate.wait=true` to the scanner. Without it the scan exits as soon as the
report is uploaded, long before the compute engine has decided anything, and the job goes
green whatever the gate says — which is exactly why every gate has looked green so far.
With it, "`sonar / Analysis` passed" and "the gate is green" become the same statement, and
that is the one a branch ruleset can require.

Two behaviours preserved on purpose:

- **A missing `SONAR_TOKEN` still prints one notice and succeeds.** Its wording no longer
  says the gate is advisory, because it will not be; it now says no analysis ran, so no gate
  was evaluated, and that the job succeeding is not evidence anything passed. On a fork pull
  request the gate is unenforced by construction — GitHub gives the run no secret — and
  failing instead would not close that hole, only stop fork pull requests from ever merging.
- **The step summary is rewritten and now runs on `always()`**, because it matters most when
  the gate is red. On red it names `pr-gate.sh`, and states the three permitted moves: fix
  it here, add a narrow catalogued exclusion here, or land nothing. Not bypass.

`release-quality-gate.yml`'s notes stop saying the gate is advisory too. actionlint is clean
on all five workflows and `check-wiring.sh` still passes.

The input reaches the five callers only when the merge moves `v1`, so expect one cycle in
which a pull request is required but a red gate still passes.

### 2026-08-26 — U0: quality-gate-v0.1 finally exists

The 0.1 entry set `status: done` and the orchestrator's sweep then wrote `not_started` back
into the same `STATUS.md` in the commit it merged, so `release-quality-gate.yml` read
`not_started` and published nothing. Recovered with the `force` input the workflow already
had:

```sh
gh workflow run "Release - quality-gate" --repo gortazar/aideas -f force=true
ideas/quality-gate/scripts/check-release.sh 0.1
```

**[quality-gate-v0.1](https://github.com/gortazar/aideas/releases/tag/quality-gate-v0.1),
published 2026-08-26 09:30 UTC.** `check-release.sh 0.1` passes: all three assets present
(`sonar.yml`, `baseline.md`, `README.md`) and the released `sonar.yml` byte-identical to the
one `v1` resolves to (`856feb1`). `version:` stays at `0.1` until this entry finishes, so
that a bump cannot publish `1.0` and leave 0.1 missing forever.

**The orchestrator entry has not landed.** `ideas/orchestrator` is `not_started`, so
`settle_submodules` still pushes rescued work to `HEAD:refs/heads/main`, which a gated
repository rejects. Reading it rather than assuming: `submodule_paths()` filters to
`ideas/<slug>/`, so a sweep only ever touches the submodule of the idea being built — gating
`gortazar/recap` degrades the **recap** idea's sweep and nothing else. And the degradation is
bounded: the push failure falls through to rescuing the objects into
`.git/modules/<path>` under `refs/aideas/rescued/<slug>/<sha>` with a WARNING, so work is not
lost, only left somewhere awkward. Which repositories that makes it safe to gate is settled
in U4/U5 and recorded there.

### 2026-08-25 — U7: done at 0.1

**What `done` covers.** Every feature in `PLAN.md` is delivered and green:

- `.github/workflows/sonar.yml`, the reusable workflow `AGENTS.md` had been telling every
  idea to call since before it existed — seven inputs, one optional secret, `fetch-depth: 0`,
  coverage as an artifact input, and a missing token skipping loudly instead of failing.
- `.github/workflows/tag-sonar.yml`, which keeps `v1` on the current `sonar.yml`. Verified
  moving: `v1` is at `856feb1` because the last merge touched the workflow.
- Six SonarQube Cloud projects, created and configured from the API by
  `scripts/ensure-sonar-project.sh`, all analysed, all with a computed gate.
- Six repositories calling it, each with its own `sonar-project.properties`; coverage wired
  where the language has it built in (Go, Python).
- Badges in seven READMEs for six projects — `aideas` and `gnome-tasks` share one and say so.
- `baseline.md`, the deliverable this entry exists for: six sections written from real
  analyses, with dates, links, every condition's measured value and threshold, and what the
  numbers do and do not mean.
- `check-wiring.sh` owning all six rows, `read-measures.sh` to re-read the baseline without
  a token, `check-release.sh` to confirm the release afterwards, and a `flake.nix` running
  shellcheck and actionlint over all of it. `ci-quality-gate.yml` is green.
- `README.md`: the five lines that wire an idea up, the inputs, the token, what `v1` means.

**The release publishes on the merge.** `release-quality-gate.yml` is gated on this file
saying `status: done`, so setting it here is what fires it — the same arrangement as
`release-aideas.yml`, and necessary for the same reason: an agent cannot push a tag. It
creates `quality-gate-v0.1` with `sonar.yml`, `baseline.md` and `README.md` as assets, since
there is nothing to compile. **Confirm it afterwards with
`ideas/quality-gate/scripts/check-release.sh`**, which also checks the released `sonar.yml`
is byte-identical to the one `v1` resolves to. Run against the not-yet-published release it
correctly reports the release missing, so its failure path is tested.

**`title-slides` is out of scope and stays out**: SonarQube Cloud does not analyse Lua, and
`baseline.md` says so rather than substituting a different linter. `vacas` and `wg` have no
repository yet.

Nothing is blocked and nothing was left half-built. Two failures on `main` are recorded in
the U6 entry below as explicitly *not* this idea's: `CI - recap` and `CI - aideas` were both
already red before this entry started.

### 2026-08-25 — U6: all six measured, and the gate says something uncomfortable

The merge moved `v1` past the `pull-requests: read` fix, the four red runs were re-run, and
all six projects now have two analyses and a computed gate. `baseline.md` is written from
them, one section each, with the numbers, the dashboard links and what they actually mean.

**All six gates pass, and all six pass vacuously — 0 new lines each**, so Sonar evaluated
three ratings plus hotspots-reviewed over an empty set and silently dropped the coverage and
duplication conditions. That is partly an artefact of how a second analysis of the same
commit is what it takes to get a gate at all, but it is also the real risk: Sonar skips both
conditions whenever a period has under 20 new lines and reports `OK` while doing it.

The numbers a future blocking gate has to be chosen from are the whole-project ones:

| Project | Lines | Coverage | Dup | Bugs | Vulns | Smells | Rel/Sec/Maint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `aideas` | 8,239 | 0.0% | 1.7% | 3 | 8 | 107 | E / C / A |
| `restore-wss` | 4,557 | 62.4% | 0.0% | 0 | 0 | 42 | A / A / A |
| `recap` | 3,053 | 86.0% | 3.0% | 0 | 0 | 12 | A / A / A |
| `recap-gs` | 1,874 | 0.0% | 0.0% | 2 | 0 | 9 | E / A / A |
| `lo-pert` | 1,039 | 58.9% | 0.0% | 1 | 0 | 9 | C / A / A |
| `gnome-shell-pwgen` | 321 | 0.0% | 0.0% | 0 | 0 | 13 | A / A / A |

**Only `recap` clears the 80% coverage threshold.** The other two instrumented projects sit
at 62.4% and 58.9%, and the three GJS projects cannot be instrumented at all.

**Every rating below A is worth discounting**, which is the other thing entry 5 needs to
know. `recap-gs` is E because Sonar reports `spacing` in `src/stylesheet.css` as an unknown
CSS property, twice, at BLOCKER — GNOME Shell stylesheets are St's dialect, not CSS. This
repository is E for one GJS false positive too (`Gio.FileEnumerator.next_file()` read as a
loop variable that is never modified) and C for two `curl` calls that do not enforce HTTPS.
`lo-pert` is C for an assertion in a hypothesis property test — Sonar rates issues in
`sonar.tests` sources alongside production ones. The plan's GJS worry turned out to be
misplaced in one direction and right in another: `imports.gi.*` and `resource:///` produced
no findings at all across three GJS projects, but the **stylesheet** did.

Also unanticipated: **Sonar analyses shell scripts** — 662 lines of them in this repository,
and half its security findings.

`scripts/read-measures.sh` prints all of the above for any project, without a token, so the
baseline can be re-checked by anyone.

`check-wiring.sh` now owns all six rows and passes, which needed the `recap-gs` and
`lo-pert` pins bumping. Both were *already* drifted before this entry — gitlink and flake
input at different commits, so `check-pin.sh` was failing in both wrappers — and both now
agree, verified with `nix flake check` in each wrapper rather than assumed.

Two pre-existing failures on `main` that are not this idea's and were not touched:
`CI - recap` has been red since 2026-08-24 on the same `ideas/vacas/upstream` gitlink that
broke `ci-quality-gate.yml`, and `CI - aideas` fails a state-contract test
(`test_status_blocked_is_blocked_without_a_question_count`, `'ready' != 'blocked'`) that
started failing before this session.

### 2026-08-25 — U3, U4 and U5: six projects created, six repositories wired, one measured

The token arrived, so the whole of U3-U5 was doable. All six SonarQube Cloud projects now
exist, all six repositories call the shared workflow, and `gortazar_recap` has a real gate
reading in `baseline.md`. The other five are wired but not yet analysed — see the last
section below, which is the one thing this session could not finish and why.

**Onboarding took three steps the plan did not know about**, all now encoded in
`scripts/ensure-sonar-project.sh` so no future repository rediscovers them. The script reads
the token from the machine-local agent env file straight into a `curl --config` on stdin, the
same discipline as `scripts/set-repo-secret.sh`: never into argv, a file, a log or its own
output.

1. Projects created with `POST api/projects/create` — no browser step needed, and the key
   format `gortazar_<repo-name>` was right.
2. **Their main branch is called `master`.** An analysis of `main` then does not fail: it
   files itself as a short-lived *branch* named `main`, which accumulates no measures and
   whose gate is not the project's. recap's first analysis came back green with nothing
   readable behind it.
3. **They have no new-code period.** Without one there is no gate at all — `project_status`
   answers `NONE` and no `new_*` measure is computed, so two analyses look exactly like one.
   Set to `previous_version` on all six, the default a UI import would have given.

Automatic Analysis was off everywhere already; the conflict the plan anticipated never arose.

**recap's gate: OK, and vacuously so.** 0 new lines in the period, so Sonar skipped the
coverage and duplication conditions entirely — a blocking gate today would wave through any
commit under 20 lines without weighing the two things it exists for. The useful numbers are
whole-project: 3,053 lines of Go, **86.0% coverage**, duplication **3.0% against a 3%
threshold**, 0 bugs, 0 vulnerabilities, 12 code smells, A/A/A. Coverage is real, not assumed:
a `coverage` job runs `go test -coverprofile` and hands `cover.out` to the scan as an
artifact.

Two findings worth having: the first analysis counted 121 lines of "PL/SQL" — the SQLite
fixtures under `internal/opencode/testdata` — as production code, and excluding them halved
the reported code smells from 26 to 12 and took duplication from 3.6% to 3.0%.

**The one thing that is not finished: five projects have no numbers.** The reusable
workflow's job asked for `pull-requests: read`, and five of the six repositories have their
default workflow token set to *read repository contents*, where that permission is
ungrantable. GitHub refuses the run before any job starts: *"The nested job 'sonar' is
requesting 'pull-requests: read', but is only allowed 'pull-requests: none'."* `recap` is the
only repository whose default is `write`, which is why it was the only one that ran — and a
good argument for the plan's insistence on proving one project end to end first.

`sonar.yml` no longer asks for it (the SonarQube Cloud GitHub App decorates pull requests
with its own token, not this one). But callers pin `@v1`, and `v1` only moves when
`tag-sonar.yml` runs on `main`, which is after this branch is merged. **So `recap-gs`,
`gnome-shell-pwgen`, `restore-wss` and `lo-pert` currently have a red CI run**, and the next
session's first job is `gh run rerun` on each of the four plus a first analysis of this
repository's own project.

`ci-quality-gate.yml` was also failing on `main`, for an unrelated reason found on the way:
`submodules: recursive` aborts with *"No url found for submodule path
'ideas/vacas/upstream'"* — a gitlink in the index with no `.gitmodules` entry, belonging to
another idea. It now initialises exactly the submodules `.gitmodules` declares.

`release-quality-gate.yml` is written and lints clean, gated on `status: done` so it
publishes nothing until the entry is finished. It creates its own tag, as it must —
`quality-gate-v<version>`, with `sonar.yml`, `baseline.md` and the idea's `README.md` as
assets, since there is nothing to compile.

The Python coverage command was run locally rather than assumed: `restore-wss` reports
**73.6%** over 247 unit tests, and writes a `coverage.xml` whose paths resolve against the
workspace the same way in the scan job as in the coverage job. `lo-pert` uses the identical
pattern.

Submodule pointers: bumped for `recap`, `gnome-shell-pwgen` and `restore-wss`, where the
commit pushed is the only one ahead of the pin, each with its `flake.lock` in the same commit
so `check-pin.sh` stays green. **Not** bumped for `recap-gs` and `lo-pert`: their upstreams
had already moved several commits ahead of the pin, and dragging another idea's untested work
into its wrapper is that idea's call, not this one's. Their wiring is pushed and live
upstream regardless.

### 2026-08-25 — Blocked on the SonarQube Cloud token; docs written meanwhile

**U3 onwards cannot start.** Everything after U2 needs an analysis to have run, and no
analysis can run: no repository has a `SONAR_TOKEN`, and GitHub Actions secrets cannot be
copied from one repository to another. A new open question in `PLAN.md` answers the two
questions the first answer came back with, and asks for the one thing still missing.

What I could establish without a token, so the next session does not re-derive it:

- The SonarQube Cloud organisation `gortazar` **exists**, and holds one project,
  `gortazar_casaos` — which confirms the plan's assumption that the key format is
  `gortazar_<repo-name>`.
- None of this entry's six projects exist in it yet.
- None of the six repositories has any Actions secret set at all (`gh secret list` is empty
  for each), so the token is not yet in `aideas` either.
- `gortazar` is a GitHub **User**, not an Organization, so there is no account-level secret
  to share one copy of the token from. Each repository needs its own copy.

Written while blocked, because neither needs a measurement:

- `README.md` — the five lines that wire an idea up, the input table, what the token is and
  why every repository holds its own, what `v1` means and how it moves, and the anonymous
  API calls that re-read the baseline. This is the "installation" for a reusable workflow;
  there is no binary to ship.
- `baseline.md` — the method, and the two sections that are already final: `title-slides`
  is out of scope because SonarQube Cloud does not analyse Lua, and `vacas`/`wg` have no
  repository yet. The six measured sections are deliberately absent rather than stubbed:
  `check-wiring.sh` treats a section here as evidence the analysis ran, so a placeholder
  would be a lie it could not catch.

### 2026-08-25 — U2: the reusable workflow and the tag that carries it

`.github/workflows/sonar.yml` is the workflow `AGENTS.md` has been telling every idea to
call since before it existed. `workflow_call`, seven inputs, one optional secret;
`SonarSource/sonarqube-scan-action@v8.2.1` (the `sonarcloud-github-action` it replaced is
deprecated); `fetch-depth: 0`, because Sonar attributes new code by git blame and against
a shallow clone every line looks new. `SONAR_HOST_URL` is deliberately unset — the action
targets SonarQube Cloud when it has no host.

An absent `SONAR_TOKEN` prints one notice and succeeds. Fork pull requests get no secrets
at all, and a repository can be wired before its token is set; an advisory gate that
turned those red would be switched off within a week.

`.github/workflows/tag-sonar.yml` force-moves `v1` to any push to `main` touching
`sonar.yml`. Callers pin the major tag, so a fix reaches all six without editing any of
them — and no agent has to push a tag from a worktree, which would never arrive.

`check-wiring.sh` now asserts both ends of that reference: `sonar.yml` exists and has a
`workflow_call` trigger, `tag-sonar.yml` exists and pushes `refs/tags/v1`. Verified by
hiding `sonar.yml` and watching the check fail. actionlint is clean on both files.

Nothing calls it yet, and nothing can: `@v1` does not exist until this branch is merged
and `tag-sonar.yml` runs on `main`.

### 2026-08-25 — U1: the wrapper builds

`ideas/quality-gate/` now has a `flake.nix` and `scripts/check-wiring.sh`, and
`ci-quality-gate.yml` — which had been failing since it was merged, because it ran
`nix flake check` in a directory with no flake — runs them.

The idea's deliverable lives at the repo root, not in this folder, which shapes the
flake: `nix flake check` shellchecks `scripts/` inside the sandbox, and `nix run .#lint`
runs actionlint over the workflows this idea owns plus `check-wiring.sh` over the whole
checkout, because both read files above `ideas/quality-gate/` that a sandboxed check
cannot see. CI runs both, and now checks out submodules, since five of the six projects'
wiring lives in submodule working trees.

`check-wiring.sh` owns an empty project table so far: a row in it is a claim that a
project's analysis is actually running, so rows are added by the unit that wires each
project up and reads its first gate, not in advance.

## Units
<!-- This entry: make the gate blocking, and rewrite how every agent lands a change. -->
- [x] U0 — `quality-gate-v0.1` published and verified (the 0.1 entry's missing release)
- [x] U1 — `fail-on-gate` in `sonar.yml`, plus the rewritten step summary
- [x] U2 — `ensure-quality-gate.sh` and the two custom gates; `gate.md`
- [x] U3 — coverage exclusions in the three instrumented repositories, one PR each
- [x] U4 — `ensure-branch-ruleset.sh`, and `recap` gated end to end
- [x] U5 — the remaining four, plus `title-slides`
- [x] U6 — `AGENTS.md`, `pr-gate.sh`, `exclusions.md`
- [x] U7 — `check-wiring.sh`'s new assertions, `README.md`, the release at `1.0`

Next: nothing — the entry is finished at 1.0. The follow-up for whoever comes next is in
`gate.md`: no pull request has yet produced a real new-code coverage reading, and the 60%
floor is meant to rise once one does.

<details><summary>The 0.1 entry's units, all delivered</summary>

- [x] U1 — `flake.nix` + `scripts/check-wiring.sh` (empty table) + `ci-quality-gate.yml` green
- [x] U2 — `.github/workflows/sonar.yml` (reusable) and `tag-sonar.yml` (moves `v1`)
- [x] U3 — wire `gortazar/recap` end to end, read its gate (OK, vacuously — 0 new lines)
- [x] U4 — this repo's own Sonar project, submodule exclusions, badges in `aideas`/`gnome-tasks`
      (wired; its first analysis runs after the merge)
- [x] U5 — `gnome-shell-pwgen`, `recap-gs`, `restore-wss`, `lo-pert` wired and pushed
      (their first analyses run after the merge moves `v1`)
- [x] U6 — `baseline.md` written from six real analyses, plus `read-measures.sh` to re-read
      them; `check-wiring.sh` owns all six rows and passes
- [x] U7 — `quality-gate-v0.1` release: `release-quality-gate.yml` fires on the merge that
      carries `status: done`; `scripts/check-release.sh` confirms it afterwards


</details>
