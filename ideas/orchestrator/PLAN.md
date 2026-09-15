# Plan: orchestrator — a failed agent must not read as a quiet one

Difficulty estimate: medium — the code change is small and local (three call sites plus a
classifier), but two of the three failures can only be reproduced by faking the `claude` CLI, so
the work is mostly in a new test fixture and in deciding what a failed cycle leaves behind.

## Context

Three failures from the same cycle, all the same shape: a hard error that the cycle absorbed and
reported as ordinary quiet progress.

**The model limit.** When the account's limit was exhausted, both agents exited in about five
seconds and each wrote a result JSON that said

```json
{"subtype": "success", "is_error": true, "num_turns": 1, "total_cost_usd": 0,
 "result": "You've reached your Fable limit. Switch to another model to continue."}
```

`subtype` and `is_error` disagree, and every reader in `orchestrator.py` believes `subtype`.
`finalize` (`orchestrator.py:1562`) never looks at `is_error` at all: it takes
`total_cost_usd` (`:1616`), writes `status: in_progress` (`:1614`), appends a `— in_progress
($0.0)` line to the idea's STATUS.md and logs `Cycle complete for <slug> (in_progress)`.
`record_usage` (`:785`) logs `$0.0000, 1 turns, 0 permission denials`, which is exactly what a
short honest cycle looks like. With the timer enabled that repeats every five minutes for as long
as the limit lasts, and nothing in the journal, in STATUS.md or in the git log says anything is
wrong. The 19:36 line in this idea's own STATUS.md log — `in_progress ($0.0)` — is one of them.

Writing `in_progress` is not only misleading, it has an effect: for an idea at `not_started` it
sets `started_at` and starts the `stale_idea_after_hours` clock that `pick_ideas` (`:989-994`)
uses to deprioritise, so a run of limit failures can push a never-started idea into the stalled
bucket without a single turn having been taken.

**The dead session id.** `start_agent` (`:1077-1080`) passes `--resume <id>` whenever
`state/sessions/<slug>.id` exists. When that conversation is gone — expired, or the transcript
deleted — `claude` exits immediately with `No conversation found with session ID: <id>` on
stderr. Nothing ever rewrites or deletes that file on failure (the only writer is `:1573`, and it
only ever writes a *new* id), so that idea fails the same way every cycle, forever. Today the
failure is invisible in a different way from the first one: stderr is inherited rather than
captured, no result JSON is written, `load_result` returns `{}`, and the run lands in the existing
"produced no result JSON (agent stopped)" warning (`:794`) — which says the agent was *killed*,
the opposite of what happened.

**The cycle that failed entirely.** `run()` (`:1704-1723`) starts the agents, finalizes each one
and returns 0 unconditionally. A cycle in which every agent died in five seconds exits green,
systemd records a clean run, and the only durable trace is a couple of `$0.0` commits. That is the
top-level version of the same bug.

**What already works and must stay distinguishable.** Two failure modes are already reported and
must not be collapsed into the new one: an agent killed with no result JSON at all (`:788-796`),
and a merge that conflicted (`:1589-1594`). The new classification sits between them — the agent
*did* write a result, and the result says it failed.

**What this entry may touch.** `orchestrator/orchestrator.py`, `orchestrator/tests/` (which this
idea now owns), `ideas/orchestrator/` and, for the version gate, nothing else. No other idea's
folder, no `AGENTS.md`.

## Features

- **One classifier, `agent_failure(result)`, used everywhere a result JSON is read.** It returns
  `None` for a healthy run and a short reason string otherwise. A run has failed when
  `result.get("is_error")` is truthy **or** `result.get("subtype")` is anything but `"success"` —
  `is_error` first, because the observed payload sets both and only `is_error` is right. The
  reason string is the model's own `result` field when there is one: `"You've reached your Fable
  limit. Switch to another model to continue."` is already a plain-English explanation and
  rewriting it would lose information (a different limit, a different model, a future message
  nobody anticipated). An `is_error` with no `result` text falls back to
  `error (subtype=<subtype>, num_turns=<n>)`.
- **`finalize` leaves a failed idea's status alone.** On failure it does not call
  `rewrite_status`: no `status:`, no `started_at`, no `last_run`, no version, so an idea that was
  `not_started` is still `not_started` and the staleness clock has not started. It logs
  `WARNING: <slug>: the agent failed after <n> turn(s): <the model's own result string>`, then
  the one-line consequence `WARNING: <slug>: status left at <current> — nothing was built this
  cycle.`
- **The failure is still recorded where the next agent will read it.** `note_agent_failure`
  appends a `- <timestamp> — failed: <reason>` line to the idea's STATUS.md log, in the shape
  `LOG_ENTRY_RE` already matches, so `rewrite_status` re-gathers it next cycle instead of
  stranding it, and `start_agent`'s last-20-lines briefing (`:1074`) carries it into the next
  agent's `CLAUDE.md`. Same mechanism as 1.6's sweep-branch notice, for the same reason: a log
  line in a 03:00 journal is not a report.
- **The worktree is still cleaned up.** A failed agent's branch is empty, so the existing
  sweep/merge/`worktree remove`/`branch -d` path runs unchanged. Only the status write and the
  "progress" framing change. Leaving worktrees behind on failure would hand 1.2's regression back.
- **`record_usage` stops printing a confident `$0.0000`.** It already special-cases a missing
  result; it now also special-cases a failed one, writing `<phase>-failed` in `usage.csv` instead
  of `<phase>` and logging the reason. This catches the planning pass too: the same limit kills
  `planning_pass` (`:939-964`), which currently commits an idea with no `PLAN.md` and says nothing.
  Same classifier, same wording, both phases.
- **A dead session id falls back to a fresh conversation, in the same cycle.** `start_agent`
  captures each agent's stderr to `state/logs/<slug>-<ts>.err` (today it is inherited and lost).
  After all agents are started, one bounded probe pass — a single `sleep` of
  `early_exit_probe_seconds` (default 5) for the whole set, not per agent — polls each process.
  Any agent that has already exited non-zero with `No conversation found with session ID` in its
  stderr gets `state/sessions/<slug>.id` deleted and is respawned once without `--resume`, with
  `WARNING: <slug>: stored session <id> no longer exists; starting a fresh conversation.` The
  respawn happens at most once per agent per cycle, and only for this signature — an agent that
  died of the model limit is not restarted, because restarting it would just burn another five
  seconds and produce a second identical failure.
- **The probe is bounded and cheap.** One 5-second sleep per cycle regardless of how many agents
  run, no polling loop, and a healthy agent is never waited on: the pass only inspects
  `poll()`. Every one of these failures is instantaneous by nature — the CLI refuses before it
  starts work — so 5 seconds is enough to see them and short enough to cost nothing.
- **A cycle where every agent failed is not a successful cycle.** After the finalize loop, `run()`
  counts failures. All agents failed → one summary line
  `WARNING: cycle failed: all <n> agent(s) failed (<reasons>).` and a **non-zero exit**, so
  `systemctl status` and `systemctl --failed` show it and the journal entry is marked. Some but
  not all failed → the same summary at WARNING level, exit 0, because real work did land. The
  `finally` block (`:1724-1726`) still pushes and releases the lock on every path; the exit code
  is the last thing that changes, never a reason to skip cleanup.
- **`ORCHESTRATOR_VERSION = "1.7"`**, a one-line 1.7 entry appended to the version comment
  (`:49-61`), `version: 1.7` in `ideas/orchestrator/STATUS.md`, and the release published as
  `orchestrator-v1.7` by the existing `release-orchestrator.yml`. `scripts/check-version.sh`
  already asserts the two agree; `scripts/check-release.sh` already reads the version out of
  STATUS.md, so neither script needs editing — both need running.
- **Three new test files in `orchestrator/tests/`, named for the failure.**
  - `test_agent_failure.py` — the classifier against the exact observed payload (`subtype:
    success` **and** `is_error: true`), against a healthy result, against `is_error` with no
    `result` text, and against `{}`; then `finalize` with a failed result: status unchanged,
    `started_at` unchanged, no new `in_progress` log line, a `failed:` log line carrying the
    model's sentence, the worktree gone, the branch gone, and `usage.csv` carrying
    `build-failed`. Plus the distinction test that matters: an agent with **no** result JSON
    still produces the old "agent stopped" warning and not the new one.
  - `test_resume_fallback.py` — a stub `claude` on `PATH` that exits 1 with
    `No conversation found with session ID: <id>` when handed `--resume`, and writes a normal
    success result JSON when not. Asserts the first spawn used `--resume`, the session file was
    deleted, the agent was respawned without `--resume`, the second run's result is the one
    `finalize` reads, and that the stub was invoked exactly twice. A second case: an agent that
    exits fast for a *different* reason (the limit payload) is **not** respawned and its session
    file survives.
  - `test_cycle_outcome.py` — `run()`'s exit code and summary line for all-failed, some-failed
    and none-failed, and that the lock is released and the push attempted in every case.
- **`support.py` gains a fake-CLI fixture**, `stub_claude(dir, script)`, which writes an
  executable `claude` into a tmpdir, prepends it to `PATH` for the test's lifetime through the
  existing `GitSandbox` env restore (`support.py:181`), and records each invocation's argv to a
  file so a test can assert on what was passed. Stdlib only, no network, no sleep longer than the
  probe under test — which the tests shrink via `early_exit_probe_seconds`.

## Approach

One commit per unit; the tests for each behaviour land with or before the behaviour.

1. **U1 — `stub_claude` in `support.py` and `test_agent_failure.py`**, red where it must be: the
   classifier tests are new code, the `finalize` tests fail against 1.6 and are the specification
   for U2. Extend `test_support.py` so the fixture itself is asserted — a stub that is not on
   `PATH`, or not executable, turns every test below it into a tautology.
2. **U2 — `agent_failure`, `finalize`, `note_agent_failure`, `record_usage`.** U1 goes green.
3. **U3 — `test_resume_fallback.py`**, then stderr capture, the probe pass and the one respawn.
4. **U4 — `test_cycle_outcome.py`**, then the failure count, the summary line and the exit code.
5. **U5 — `ORCHESTRATOR_VERSION = "1.7"`** and the version-comment entry; `check-version.sh` run.
6. **U6 — `status: done` at 1.7**, whole suite green under `env -i` with `LC_ALL=C` and a
   comma-decimal locale, then `scripts/check-release.sh` once the release workflow has fired —
   next cycle if the push lands late.

## Risks / things to verify early

- **`is_error` may not be the only shape.** The payload recorded here is one sample from one
  limit. Treating `subtype != "success"` as a failure as well is the hedge; treating a *missing*
  `is_error` key as failure is not, and must not be — an older CLI that omits it would turn every
  healthy cycle into a failure. Test `{}` and a result with neither key explicitly.
- **Do not let the classifier swallow real work.** A resumed agent that did hours of work and then
  hit the limit on its last turn would also be classified failed — and its commits are already in
  the worktree, so the merge must still run. The status write is the only thing skipped. Assert
  this with a failed result *and* a commit in the worktree.
- **The stub `claude` must actually be the one that runs.** `PATH` manipulation inside a test that
  also shells out to `git` is easy to get subtly wrong; assert the invocation log exists before
  asserting anything about its contents.
- **Exit codes are a contract with systemd.** A non-zero exit marks the unit failed; a timer-driven
  unit that exits non-zero on every cycle for the duration of a model limit will accumulate failed
  states, which is the point — but confirm the unit has no `Restart=` that would turn that into a
  restart loop before shipping it.
- **The 5-second probe must not become a wait.** Never `process.wait(timeout=…)` per agent: with
  `parallel_agents` > 1 that multiplies, and a blocking wait in the start path is what the
  deadline logic exists to avoid. One sleep, then `poll()`.
- **Do not assert on the sandbox.** No DNS, no locale, no wall clock beyond monotonic deltas, no
  real `claude`, no real model limit. The stub is the only way any of this is reproducible.
- **`check-release.sh` for 1.6 has still never been run** (see the "Not verified from inside this
  session" section of STATUS.md). Run it first, before anything here: if the 1.6 release never
  published, that is a pre-existing problem this entry inherits, and the recovery is
  `gh workflow run release-orchestrator.yml --repo gortazar/aideas -f force=true`.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] **Should a cycle in which every agent failed exit non-zero?** The plan assumes **yes** — it
      is the only signal that reaches someone who is not reading the journal, and "a hard stop
      looks like quiet non-progress" is the whole complaint. The cost is that a multi-hour model
      limit leaves a trail of failed timer runs in `systemctl --failed`, which some would call
      noise. Say if you would rather it stayed 0 and relied on the WARNING line alone.
- [ ] **Should a model-limit failure stop the timer from retrying every five minutes?** The entry
      asks only that it be reported, and the plan does only that: the next cycle tries again and
      fails again, now loudly. The alternative is a backoff — write the stop file, or record a
      "not before <time>" marker that `cycle_preflight` honours, so an exhausted account is not
      retried twelve times an hour. That is a behaviour change beyond reporting, so it is left
      out; say if you want it in this entry rather than a later one.
- [ ] **When an agent fails, should its stored session id be kept?** The plan keeps it for every
      failure except the dead-session one (which deletes it, since it is provably useless), so a
      limit failure resumes the same conversation once the limit lifts and nothing is thrown away.
      The risk is that the id belongs to a conversation that never really started — but the
      dead-session fallback added here now recovers from exactly that, so keeping it is safe.
      Confirm, or say a failed agent should always start fresh.
