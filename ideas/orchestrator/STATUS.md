status: in_progress
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
- [ ] **U3 — the fallback branch**, the log ladder and the STATUS.md notice.
- [ ] **U4 — version comment**, `install.sh` tarball / clone-free path.
- [ ] **U5 — `release-orchestrator.yml`** and `scripts/check-release.sh`.
- [ ] **U6 — `status: done`**, then verify the published release.

Next: U3 — the fallback branch, the log ladder and the STATUS.md notice, which turns
those 5 red cases green.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator

Note for the wiring: the root `sonar-project.properties` lists `orchestrator` under
`sonar.sources`, so `orchestrator/tests/` is analysed as source rather than as tests. That
file is outside this entry's scope; `gortazar/aideas` is deliberately ungated, so it cannot
block, but a follow-up should add `orchestrator/tests` to `sonar.tests`.
