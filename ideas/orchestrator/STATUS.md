status: in_progress
version: 1.6

## Log

## Units

Six units, one commit each; the suite lands before the change it protects.

- [x] **U1 — `orchestrator/tests/`**: `support.py` (sandboxed git, bare / gated / refusing
      remotes, a superproject with a submodule inside a linked worktree) plus the five ported
      regression suites — repo lock, push retry, worktree setup, gitlink sweep, release check —
      and `test_support.py`, which asserts the fixture layout itself. 38 tests, ~3 s, green
      against the unchanged code. `ci-orchestrator.yml` rewritten to run them on
      `orchestrator/**`. `scripts/check-version.sh` asserts STATUS.md and
      `ORCHESTRATOR_VERSION` agree.
- [ ] **U2 — `test_settle_submodules.py`**: the five cases, including the gated remote; the
      gated case fails against the current code and is U3's specification.
- [ ] **U3 — the fallback branch**, the log ladder and the STATUS.md notice.
- [ ] **U4 — version comment**, `install.sh` tarball / clone-free path.
- [ ] **U5 — `release-orchestrator.yml`** and `scripts/check-release.sh`.
- [ ] **U6 — `status: done`**, then verify the published release.

Next: U2.

Run the suite from the repo root:

    python3 -m unittest discover -s orchestrator/tests -t orchestrator

Note for the wiring: the root `sonar-project.properties` lists `orchestrator` under
`sonar.sources`, so `orchestrator/tests/` is analysed as source rather than as tests. That
file is outside this entry's scope; `gortazar/aideas` is deliberately ungated, so it cannot
block, but a follow-up should add `orchestrator/tests` to `sonar.tests`.
