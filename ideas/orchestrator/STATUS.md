status: done
version: 1.6
started_at: 2026-09-15T18:39:34+02:00
last_session_id: c42e4c48-8bfe-49f0-accb-f4d4d5588837
last_run: 2026-09-15T19:36:05+02:00
last_cycle_cost_usd: 0.0

## Log
- 2026-09-15T19:36:05+02:00 — in_progress ($0.0)
- 2026-09-15T18:39:34+02:00 — in_progress ($5.172212999999999)



## Units

Six units, one commit each; the suite lands before the change it protects.

- [x] **U1 — `orchestrator/tests/`**: `support.py` (sandboxed git, bare / gated / refusing
      remotes, a superproject with a submodule inside a linked worktree) plus the five ported
      regression suites — repo lock, push retry, worktree setup, gitlink sweep, release check —
      and `test_support.py`, which asserts the fixture layout itself. 38 tests, ~3 s, green
      against the unchanged code. `ci-orchestrator.yml` rewritten to run them on
      `orchestrator/**`. `scripts/check-version.sh` asserts STATUS.md and
      `ORCHESTRATOR_VERSION` agree.
- [x] **U2 — `test_settle_submodules.py`**: 14 cases over the whole ladder — loose work is
      committed, a commit already on a remote branch is left alone, a plain remote takes the
      direct push, a gated remote falls to `agent/demo-sweep` with a STATUS.md notice, a
      diverged second sweep goes to a dated branch rather than force-pushing, and a remote
      that refuses everything falls to the local rescue ref. **Committed red on purpose:** 9
      pass against the unchanged code and the 5 gated-remote cases fail, which is U3's
      specification.
- [x] **U3 — the fallback branch**, the log ladder and the STATUS.md notice. All 52 tests
      green. `settle_submodules` now splits into `push_or_rescue` (rungs 2-4),
      `push_sweep_branch` (plain push to `agent/<slug>-sweep`, then a dated branch, never
      `--force`) and `note_sweep_branch` (the STATUS.md notice, written into the agent's
      worktree copy so it reaches the superproject through the branch merge).
- [x] **U4 — version comment and `install.sh`.** The 1.6 entry in the version comment now
      covers this entry's work. `install.sh` separates *where the code is* (beside the
      script — a clone's `orchestrator/` or an unpacked tarball) from *which clone to run
      cycles against* (`--repo`), and clones the ideas repo into `~/aideas` when `--repo`
      is absent and there is no clone around the script. 8 new tests drive it through
      `ORCHESTRATOR_INSTALL_DRY_RUN`, which resolves both directories, prints them and
      stops before anything touches systemd. 60 tests green.
- [x] **U5 — `release-orchestrator.yml` and `scripts/check-release.sh`.** The workflow
      gates on `status: done` (or the `force` input), asserts the two versions agree, runs
      the suite again, then self-tags `orchestrator-v1.6` with `gh release create --target`
      and uploads `orchestrator-1.6.tar.gz`, `SHA256SUMS` and `install.sh`.
      `check-release.sh` needs no token: it downloads the tarball, checks the published
      checksum against the bytes actually served, and asserts the packed `orchestrator.py`
      declares 1.6. A 61st test packs the real tarball with `tar` and installs from it.
      `ideas/orchestrator/README.md` opens with the install command.
- [x] **U6 — `status: done` at 1.6.** 61 tests green, including under `env -i` with
      `LC_ALL=C`, `HOME=/nonexistent` and an antipodean `TZ`, and again under a
      comma-decimal locale — the class of ambient dependency that silently disabled the
      budget gate in the shell version.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator

## What `done` covers

Every feature in this entry's `PLAN.md` is delivered, tested and committed.

- **A refused push falls to a branch, not to a local ref.** `settle_submodules` is now a
  four-rung ladder — already on a remote branch, the default branch, `agent/<slug>-sweep`,
  the local rescue ref — and each rung logs what it is, so "refused because the repository
  is gated" and "refused because the credentials expired" no longer read alike.
- **Never `--force`.** The sweep branch is pushed plain; a diverged second sweep goes to
  `agent/<slug>-sweep-<YYYY-MM-DD>`. Losing rescued work to the rescue mechanism is the one
  outcome worse than the bug this fixes.
- **The notice reaches the next agent.** `note_sweep_branch` appends the path, branch, sha
  and `gh pr create` line to the idea's STATUS.md in the agent's worktree, so it arrives in
  the superproject by the same route as the agent's own work, and `start_agent` puts it in
  the next cycle's briefing — it is in the last 20 lines, which is what that reads.
- **61 tests, stdlib only, no network**, run by `ci-orchestrator.yml` on `orchestrator/**`.
  The five thrown-away suites are ported and named for their regression, so a failure says
  which one came back.
- **Released**: `orchestrator-v1.6`, a tarball of `orchestrator/` plus `SHA256SUMS` and
  `install.sh`, self-tagged by `release-orchestrator.yml`.
- **Installable without a clone**: `install.sh` separates the code (beside itself) from
  `--repo` (the clone to run cycles against), and clones the ideas repo into `~/aideas` when
  `--repo` is absent.

## Not verified from inside this session

**The release has not been checked with `scripts/check-release.sh` yet, because it cannot
exist yet.** An agent may not push this repository; the release workflow fires on the push
the orchestrator makes *after* this cycle ends, reading the `status: done` above. The entry
is marked done because the alternative guarantees no release at all — the workflow's gate
would read `in_progress` and publish nothing, which is the failure mode recorded against
earlier entries.

**First thing to run next**, and the recovery if it fails:

    ideas/orchestrator/scripts/check-release.sh
    gh workflow run release-orchestrator.yml --repo gortazar/aideas -f force=true

The orchestrator's own `verify_release()` also checks this seconds after the push and will
append an HTML comment here if no `orchestrator-v1.6` release exists. Being seconds early is
expected; being absent an hour later is not.

CI for this entry has likewise never run remotely — the same reason. The suite is green
locally on `/usr/bin/python3` 3.12 in a clean environment, which is the interpreter the
systemd unit uses.

## Follow-ups, deliberately not done here

The root `sonar-project.properties` lists `orchestrator` under `sonar.sources`, so
`orchestrator/tests/` is analysed as production code rather than as tests. That file is
outside this entry's scope, and `gortazar/aideas` is deliberately ungated so it cannot
block; a follow-up should add `orchestrator/tests` to `sonar.tests`.

`agent/<slug>-sweep` branches accumulate: nothing deletes them, and a sweep leaves the
gitlink pointing at a commit that is not on the default branch until someone opens the pull
request. That is the loud signal working as designed, and the STATUS.md notice is what is
meant to get it acted on — but it depends on someone reading it.
