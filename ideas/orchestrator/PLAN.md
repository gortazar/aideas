# Plan: orchestrator — rescued work must reach the remote, and the orchestrator must have tests

Difficulty estimate: medium — the behavioural change is perhaps thirty lines in one method, but
the tests around it have to fake a repository that refuses a push and a submodule living inside a
linked worktree, and this is the one component that cannot be tested by running a cycle and
looking.

## Context

Two things sit in this entry, and they are the same thing seen twice: work that nobody watched
goes missing, and nothing notices.

**The push that will start being refused.** `settle_submodules`
(`orchestrator/orchestrator.py:1331`) is the last thing that touches an agent's submodule commits
before `git worktree remove --force` destroys the per-worktree git directory they live in. It
commits anything uncommitted, then pushes `HEAD:refs/heads/<default branch>` — straight to the
submodule's `main`. On a repository whose ruleset requires a pull request, that push is refused.
The fallback then fetches the objects into `.git/modules/<path>` and writes
`refs/aideas/rescued/<slug>/<sha>`: enough to stop the gitlink the parent is about to record from
dangling, and nothing more. That ref is local, it is not a branch, no remote ever sees it, and it
dies with the clone. The warning it logs scrolls past in a cycle nobody watched.

`ideas/quality-gate` is the entry that creates this situation, deliberately, and its second
answered open question says so: the fix is this entry's, it should land first, and gating the
idea repositories is what breaks the sweep. So the failure this plans for is not hypothetical and
not far off — it is next cycle.

**Why "push after every unit" is not the answer.** `AGENTS.md` will tell agents to push their
branch after every unit, and `settle_submodules` already skips a commit that is on a remote
branch (`git branch -r --contains`). That covers the disciplined case. The sweep exists for the
undisciplined one: a cycle stopped by its deadline or a signal, mid-unit, with commits — or
uncommitted files just swept into a commit — that by construction were never pushed. A rescue
path that only works when the rescue was not needed is not a rescue path.

**Why the tests, in the same entry.** Five regressions in this file were each found the hard way,
fixed, verified once against a temporary repository, and the verification thrown away — the
version comment at `orchestrator.py:49-57` is the list: the push retry (1.1), the leftover
worktree directory (1.2), the submodule-pin revert (1.3), unblocking an answered idea (1.4), the
missing-release report (1.5). Three of those recurred. The orchestrator is also the one thing here
with no test story at all: every idea gets a CI workflow, and the process that creates them has
none. `ideas/orchestrator/` today holds a `STATUS.md` and nothing else, and
`.github/workflows/ci-orchestrator.yml` is the untouched template — it watches `ideas/orchestrator/**`
and runs `nix flake check` against a flake that does not exist. It has never run and would fail if
it did.

**What this entry may touch.** `orchestrator/` (the fix, the version, and the new `tests/`),
`.github/workflows/ci-orchestrator.yml` and a new `.github/workflows/release-orchestrator.yml`,
and `ideas/orchestrator/` itself. Nothing else: not `AGENTS.md`, not other ideas' folders, not the
idea repositories' settings, which are `quality-gate`'s.

**No upstream, ever.** The orchestrator is what runs the cycles; a submodule of itself would be a
clone that a cycle checks out and replaces underneath the process reading it. The release is a
`orchestrator-v1.6` tag on this repository. That shape already exists twice — `release-aideas.yml`
and `release-quality-gate.yml` — and `release_repo()`/`verify_release()` (`orchestrator.py:1394`,
`:1412`) already handle it: no `upstream.url` in `.gitmodules` means release from `origin`, with
the slug required in the tag, so `orchestrator-v1.6` satisfies the check and `aideas-shell-v1.6`
could not.

## Features

- **A refused push falls to a branch, not to a local ref.** In `settle_submodules`, when
  `HEAD:refs/heads/<default>` is rejected, push `HEAD:refs/heads/agent/<slug>-sweep` before
  considering the work unpushable. That branch is not the default branch, so no ruleset written by
  `ensure-branch-ruleset.sh` protects it: the push lands, the objects are on the remote, and the
  commit can be turned into a pull request by hand or by next cycle's agent. Only when *that*
  fails too does the existing local rescue run, unchanged — it is still the right last resort when
  the remote is unreachable or the credentials are gone.
- **The ladder is ordered and each rung is logged as what it is.** Already on a remote branch →
  nothing to do. Direct push accepted → `pushed <path> to origin/<branch>`. Direct push refused,
  branch push accepted → a WARNING naming the branch and what has to happen to it. Both refused →
  the existing rescue WARNING, with its "resolve this before the next cycle" wording kept. The
  distinction matters when reading a log a week later: "refused because gated" and "refused
  because the token expired" currently produce the same line.
- **Loud enough to survive the cycle that produced it.** A log line is not loud: nobody reads the
  journal of a cycle that ran at 03:00. So the sweep-branch case also appends a line to
  `ideas/<slug>/STATUS.md` naming the submodule path, the branch, the sha and the one command that
  resolves it (`gh pr create --head agent/<slug>-sweep`). `start_agent` (`orchestrator.py:1047-1053`)
  builds each agent's `CLAUDE.md` from `AGENTS.md` + `PLAN.md` + the **last 20 lines of
  STATUS.md**, so the next cycle's agent for that idea reads the notice as part of its briefing,
  in the one place it cannot skip. That is the mechanism that makes "the next cycle can turn it
  into a pull request" true rather than aspirational.
- **`orchestrator/tests/`, plain `python3 -m unittest`, stdlib only.** Run from the repo root as
  `python3 -m unittest discover -s orchestrator/tests -t orchestrator`. No pytest, no nix, no
  network: the orchestrator itself is stdlib-only and its systemd unit hardcodes
  `/usr/bin/python3`, so the suite must pass on a stock interpreter or it is testing a different
  program. A `tests/support.py` provides the fixtures every case needs — a temporary repo
  (`git init -b main`, identity and `GIT_CONFIG_GLOBAL` forced into the tmpdir so the machine's
  config cannot change a result), a bare remote, a bare remote **with a `pre-receive` hook that
  rejects updates to `refs/heads/main`** (which is how a ruleset is simulated without a network),
  and a superproject with a submodule checked out inside a linked worktree.
- **The five thrown-away suites, ported and kept.** Named for the regression, so a failure says
  which one came back:
  - `test_repo_lock.py` — `RepoLock`: a second cycle cannot acquire a held lock, a lock past its
    TTL is reclaimed by `_reclaim_if_stale`, the renew loop keeps a live lock alive, and `lost()`
    is true after another token overwrites the metadata.
  - `test_push_retry.py` — `push_if_ahead`: nothing pending is a no-op, a rejected push merges and
    retries, retries are bounded by `attempts`, and a genuine conflict abandons immediately rather
    than spinning.
  - `test_worktree_setup.py` — `clear_worktree`/`start_agent`: a leftover plain directory is
    removed, read-only files inside it do not stop the removal, and a `worktree add` that fails
    raises `AgentSetupError` naming the real fault instead of dying later on a missing `PLAN.md`.
  - `test_gitlink_sweep.py` — `sweep_repo`/`sync_submodule_checkouts`: the superproject sweep does
    **not** revert a submodule pin an agent advanced (the 1.3 regression), and a clone whose
    checkout is behind the index is brought forward rather than left to re-infect the next
    worktree.
  - `test_release_check.py` — `verify_release`: a tag ending in the version satisfies it, a tag
    from a different idea in the same repository does not (`aideas-shell-v0.4` cannot satisfy
    quality-gate 0.4), and no version at all is silence, not a warning.
- **New tests for the change itself**, in `test_settle_submodules.py`: uncommitted work in the
  submodule is committed; a commit already on a remote branch is left alone; a plain remote gets
  the direct push; a remote whose hook refuses `main` gets `agent/<slug>-sweep` and the STATUS.md
  notice; a remote that refuses everything falls to the local rescue ref and warns. The refusing
  remote is the case that would otherwise only ever be observed in production, on a real gated
  repository, after the work was lost.
- **`ci-orchestrator.yml` replaced, not amended.** The template's `nix flake check` in
  `ideas/orchestrator` goes; the job becomes `actions/checkout@v4` and one `python3 -m unittest`
  invocation on `ubuntu-latest`, triggered on pushes and pull requests touching `orchestrator/**`,
  `ideas/orchestrator/**` or the workflow itself. It watches `orchestrator/**` because that is
  where the code under test lives — the generated template only ever watched the idea folder,
  which is why it could not have caught anything.
- **`ORCHESTRATOR_VERSION` to `1.6`**, with its one-line entry appended to the version comment at
  the top of the file, matching `version: 1.6` in `STATUS.md`. The release workflow asserts the
  two agree rather than trusting them.
- **`release-orchestrator.yml`, self-tagging, publishing a tarball of `orchestrator/`.** Modelled
  on `release-quality-gate.yml`: `status: done` in `ideas/orchestrator/STATUS.md` (or `force`), the
  test suite run again in the release job because a release that fails its own suite is worse than
  no release, then `orchestrator-1.6.tar.gz` + `SHA256SUMS` + `install.sh` uploaded under the tag
  `orchestrator-v1.6`, created by `gh release create --target "$GITHUB_SHA"`. **The workflow makes
  its own tag** — the orchestrator pushes with a plain `git push`, which carries no tags, and no
  agent may push this repo at all.
- **`install.sh` can install from the tarball.** Today it dies unless it is sitting inside a git
  clone that already contains `orchestrator/orchestrator.py` (`install.sh:63-68`), because it
  derives the repo from its own location. A tarball install has the code in one place and the
  clone it operates on in another, so `--repo` stops meaning "where the code is" and starts
  meaning only "which clone to run cycles against": the units get an explicit path to the unpacked
  `orchestrator.py`, and the `.git` check stays on `--repo`, where it belongs — the orchestrator
  genuinely does need a clone to commit and push to. See the open question about how far this goes.
- **`ideas/orchestrator/scripts/check-release.sh`**, the same shape as
  `ideas/quality-gate/scripts/check-release.sh`: no token, no clone, everything public. Asserts the
  release exists under `orchestrator-v<version>`, carries the tarball and its checksum, that the
  checksum matches the downloaded bytes, and that the tarball's `orchestrator.py` declares the same
  `ORCHESTRATOR_VERSION`. This is the only way anyone learns whether the release worked, since it
  is published on a push no agent watches.

## Approach

One commit per unit; the test suite lands before the change it protects.

1. **U1 — `orchestrator/tests/` with `support.py` and the five ported suites**, and
   `ci-orchestrator.yml` rewritten to run them. Green against the *current* code: a ported test
   that needs the new behaviour to pass is not a port. This is the unit that proves the harness
   can build a temporary repo, a bare remote and a submodule-in-a-worktree at all.
2. **U2 — `test_settle_submodules.py`**, including the refusing-remote case, still against the
   current code: the gated case fails here, and that failing test is the specification for U3.
3. **U3 — the fallback branch, the log ladder and the STATUS.md notice.** U2 goes green.
4. **U4 — `ORCHESTRATOR_VERSION = "1.6"`, the version comment, `install.sh`'s tarball path.**
5. **U5 — `release-orchestrator.yml` and `scripts/check-release.sh`.**
6. **U6 — `STATUS.md` to `status: done` at `1.6`**, then verify the published release with
   `scripts/check-release.sh` — next cycle if the merge lands late, which `AGENTS.md` now allows
   as a legitimate end state.

## Risks / things to verify early

- **A submodule inside a linked worktree is fiddly to construct.** `.git` there is a file pointing
  into `.git/worktrees/<wt>/modules/<path>`, which is exactly the layout `settle_submodules` reads
  back (`orchestrator.py:1376-1380`). If the fixture cannot reproduce it, the tests test nothing;
  build that fixture first, in U1, and assert on the layout itself.
- **`pre-receive` hooks need the bare repo to allow them.** The hook file must be executable and
  the test must confirm it actually refuses — a hook that silently does not run turns the most
  important test into a tautology. Assert the direct push fails *before* asserting the fallback
  succeeded.
- **`agent/<slug>-sweep` accumulates.** Nothing deletes it. A repository that sweeps for weeks
  grows a branch per idea that may be stale, merged or abandoned; the notice in STATUS.md is what
  is supposed to prevent that, and it depends on someone reading it. See the open questions on
  naming and on reuse.
- **The gitlink still points at a commit that is not on `main`.** The parent records the pin either
  way, and `quality-gate`'s planned `check-wiring.sh` ancestor assertion will report it — correctly:
  it *is* work that has not landed. That is the loud signal working, not a bug, but it means a
  sweep leaves a repository in a state that a wiring check calls wrong until the pull request
  merges.
- **`git branch -r --contains` reads remote-tracking refs, which can be stale** in a fresh worktree
  checkout. The worst case is a redundant push of a commit the remote already has, which succeeds
  trivially — noted rather than fixed, because a `fetch` here costs network on every submodule of
  every agent at the end of every cycle.
- **Do not assert on the sandbox.** No test may depend on DNS, the system locale, the clock beyond
  monotonic deltas, or the machine's git config: the locale bug that silently disabled the budget
  gate in the shell version is exactly the class of thing a test that reads the ambient environment
  fails to catch.
- **The suite has to stay fast.** It runs on every push touching `orchestrator/`, and it shells out
  to git constantly. Keep it under a minute; if a case needs a real sleep for the lock's renew
  loop, shrink the interval rather than waiting.
- **The release job runs after a merge nobody watches**, and `orchestrator-v1.6` is a new tag
  namespace on a repository that already publishes `aideas-shell-v*` and `quality-gate-v*`.
  Confirm the tag pattern collides with neither before publishing, and check the result with
  `check-release.sh` rather than assuming.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **Should the sweep open the pull request itself?** The entry asks it to push and to say so
      loudly, which is what the plan above does. But `gh` is on the orchestrator's PATH and one
      `gh pr create --draft --head agent/<slug>-sweep` would remove the human step entirely. The
      plan assumes **not** — it puts a network call and a GitHub credential into the wind-down
      path, which runs under a deadline and after a signal, and a failure there is one more thing
      that can go wrong while work is unsaved. Say if you would rather it did. It does the PR.
- [x] **One sweep branch per idea, or one per cycle?** `agent/<slug>-sweep` is what the entry
      suggests and it is stable and easy to find, but a second sweep before the first is turned
      into a pull request either force-pushes over unmerged rescued work or is refused as a
      non-fast-forward. The plan assumes a **plain (non-forced) push to `agent/<slug>-sweep`**,
      falling back to `agent/<slug>-sweep-<YYYY-MM-DD>` when that is refused — never `--force`, on
      the grounds that losing rescued work to the rescue mechanism is the worst possible outcome.
      Confirm, or name the scheme you want. 
- [x] **How far does the "install without a clone" requirement go?** The tarball plus a rewritten
      `install.sh` gets the code onto a machine without cloning this repository, but the
      orchestrator still needs a git clone at `--repo` to commit and push each cycle, so the
      installer cannot be clone-free end to end — it would have to clone for the user. The plan
      assumes **the tarball removes the need to clone in order to *install*, and `--repo` remains
      required** (with a clear error naming it). Confirm, or say the installer should clone the
      ideas repo itself when `--repo` is absent. THe installer clone the repo if --repo is absent.
