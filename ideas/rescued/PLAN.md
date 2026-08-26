# Plan: rescued — swept-up work must reach the remote, and the orchestrator must have tests

Difficulty estimate: medium — the behavioural change is around thirty lines in one method, but
the tests have to fake a remote that refuses a push and a submodule living inside a linked
worktree, and this is the one component that cannot be checked by running a cycle and looking.

## Context

Two things sit in this entry and they are the same thing seen twice: work nobody watched goes
missing, and nothing notices.

**The push that is about to start being refused.** `settle_submodules`
(`orchestrator/orchestrator.py:1331`) is the last thing that touches an agent's submodule commits
before `git worktree remove --force` destroys the per-worktree git directory those commits live
in. It commits anything uncommitted, then pushes `HEAD:refs/heads/<default branch>` — straight at
the submodule's `main`. On a repository whose ruleset requires a pull request, that push is
refused. The fallback (`orchestrator.py:1374-1392`) then fetches the objects into
`.git/modules/<path>` and writes `refs/aideas/rescued/<slug>/<sha>`: enough that the gitlink the
parent is about to record does not dangle, and nothing more. That ref is local, it is not a
branch, no remote ever sees it, and it dies with the clone. The WARNING it logs scrolls past in a
cycle that ran at 03:00.

`ideas/quality-gate` is the entry that creates this situation deliberately — its plan says so at
`ideas/quality-gate/PLAN.md:146` and `:249` — so the failure planned for here is not hypothetical
and not distant. It is the next cycle in which a gated repository is swept.

**Why "push after every unit" is not the answer.** `AGENTS.md` tells agents to push their own
repository freely, and `settle_submodules` already skips a commit that is on a remote branch
(`git branch -r --contains`). That covers the disciplined case. The sweep exists for the
undisciplined one: a cycle stopped by its deadline or a signal, mid-unit, holding commits — or
files just swept into a commit by the sweep itself — that by construction were never pushed. A
rescue path that only works when the rescue was not needed is not a rescue path.

**Why the tests belong in the same entry.** Five regressions in this file were each found the hard
way, fixed, verified once against a temporary repository, and the verification thrown away — the
version comment at `orchestrator.py:49-57` is the list: the push retry (1.1), the leftover worktree
directory (1.2), the submodule-pin revert (1.3), unblocking an answered idea (1.4), the missing
release report (1.5). Three of those recurred. The orchestrator is also the one thing here with no
test story at all: every idea gets a CI workflow, and the process that generates them has none.
`.github/workflows/ci-rescued.yml` today is the untouched template — it watches `ideas/rescued/**`
and runs `nix flake check` against a flake that does not exist. It has never run and would fail if
it did.

**What this entry may touch.** `orchestrator/` (the fix, the version, `tests/`, `install.sh`),
`.github/workflows/ci-rescued.yml` and a new `.github/workflows/release-orchestrator.yml`, and
`ideas/rescued/` itself. Nothing else: not `AGENTS.md`, not other ideas' folders, not the idea
repositories' rulesets, which are `quality-gate`'s.

**No upstream, ever.** The orchestrator is what runs the cycles; a submodule of itself would be a
clone that a cycle checks out and replaces underneath the process reading it. The release is
therefore a tag on this repository, carrying a tarball of `orchestrator/`. That shape already
exists twice — `release-aideas.yml` and `release-quality-gate.yml` — and `release_repo()`
(`orchestrator.py:1394`) already handles it: no `upstream.url` in `.gitmodules` means release from
`origin`. See the open question about the tag name, which is not free of consequence here.

## Features

- **A refused push falls to a branch, not to a local ref.** In `settle_submodules`, when
  `HEAD:refs/heads/<default>` is rejected, push `HEAD:refs/heads/agent/<slug>-sweep` before
  treating the work as unpushable. That branch is not the default branch, so no ruleset written by
  quality-gate protects it: the push lands, the objects are on the remote, and the commit can be
  turned into a pull request by a person or by the next cycle's agent. Only when *that* fails does
  the existing local rescue run, unchanged — it is still the right last resort when the remote is
  unreachable or the credentials are gone. Note the slug here is the *idea's* slug, not this
  entry's: a sweep of `ideas/vacas/upstream` pushes `agent/vacas-sweep`.
- **The ladder is ordered and each rung logs what it is.** Already on a remote branch → nothing to
  do. Direct push accepted → `pushed <path> to origin/<branch>`. Direct push refused, branch push
  accepted → a WARNING naming the branch, the sha, and what has to happen to it. Both refused →
  the existing rescue WARNING with its "resolve this before the next cycle" wording kept. The
  distinction matters when reading a log a week later: "refused because gated" and "refused
  because the token expired" currently produce the same line.
- **Loud enough to outlive the cycle that produced it.** A log line is not loud. So the
  sweep-branch case also appends a line to `ideas/<slug>/STATUS.md` naming the submodule path, the
  branch, the sha and the one command that resolves it (`gh pr create --head agent/<slug>-sweep`).
  `start_agent` (`orchestrator.py:1047-1053`) builds each agent's `CLAUDE.md` from `AGENTS.md` +
  `PLAN.md` + the **last 20 lines of STATUS.md**, so the next cycle's agent for that idea reads the
  notice as part of its briefing, in the one place it cannot skip. That is what makes "the next
  cycle can turn it into a pull request" true rather than aspirational.
- **`orchestrator/tests/`, plain `python3 -m unittest`, stdlib only.** Run from the repo root as
  `python3 -m unittest discover -s orchestrator/tests -t orchestrator`. No pytest, no nix, no
  network: the orchestrator is stdlib-only and its systemd unit hardcodes `/usr/bin/python3`, so
  the suite must pass on a stock interpreter or it is testing a different program. A
  `tests/support.py` carries the fixtures every case needs — a temporary repo (`git init -b main`,
  identity and `GIT_CONFIG_GLOBAL` forced into the tmpdir so the machine's config cannot change a
  result), a bare remote, a bare remote **with a `pre-receive` hook that rejects updates to
  `refs/heads/main`** (which is how a ruleset is simulated without a network), and a superproject
  whose submodule is checked out inside a linked worktree.
- **The five thrown-away suites, ported and kept.** Named for the regression, so a failure says
  which one came back:
  - `test_repo_lock.py` — `RepoLock` (`orchestrator.py:339`, `:375`): a second cycle cannot acquire
    a held lock, a lock past its TTL is reclaimed by `_reclaim_if_stale`, the renew loop keeps a
    live lock alive, and `lost()` is true once another token overwrites the metadata.
  - `test_push_retry.py` — `push_if_ahead` (`:826`): nothing pending is a no-op, a rejected push
    merges and retries, retries are bounded by `attempts`, and a genuine conflict abandons instead
    of spinning.
  - `test_worktree_setup.py` — `clear_worktree`/`start_agent` (`:985`, `:1010`): a leftover plain
    directory is removed, read-only files inside it do not stop the removal, and a failing
    `worktree add` raises `AgentSetupError` naming the real fault rather than dying later on a
    missing `PLAN.md`.
  - `test_gitlink_sweep.py` — `sweep_repo`/`sync_submodule_checkouts` (`:1284`, `:1307`): the
    superproject sweep does **not** revert a submodule pin an agent advanced (the 1.3 regression),
    and a clone whose checkout is behind the index is brought forward rather than left to re-infect
    the next worktree.
  - `test_release_check.py` — `verify_release` (`:1412`): a tag ending in the version satisfies it,
    a tag from a different idea in the same repository does not (`aideas-shell-v0.4` cannot satisfy
    quality-gate 0.4), and no version at all is silence, not a warning.
- **New tests for the change itself**, in `test_settle_submodules.py`: uncommitted work in the
  submodule is committed; a commit already on a remote branch is left alone; a plain remote gets
  the direct push; a remote whose hook refuses `main` gets `agent/<slug>-sweep` plus the STATUS.md
  notice; a remote that refuses everything falls to the local rescue ref and warns. The refusing
  remote is the case that would otherwise only ever be observed in production, on a real gated
  repository, after the work was lost.
- **`ci-rescued.yml` replaced, not amended.** The template's `nix flake check` in `ideas/rescued`
  goes; the job becomes `actions/checkout@v4` and one `python3 -m unittest` invocation on
  `ubuntu-latest`, triggered on pushes and pull requests touching `orchestrator/**`,
  `ideas/rescued/**` or the workflow itself. It has to watch `orchestrator/**` because that is
  where the code under test lives — the generated template only ever watched the idea folder,
  which is why it could not have caught anything.
- **`ORCHESTRATOR_VERSION` to `1.6`** (`orchestrator.py:57`, today `1.5`), with its one-line entry
  appended to the version comment above it, matching `version: 1.6` in `ideas/rescued/STATUS.md`
  — which is scaffolded at `0.1` and must be set, since the entry names 1.6 and the release
  workflow derives the tag from that field. The release job asserts the two agree rather than
  trusting them.
- **A self-tagging release workflow publishing a tarball of `orchestrator/`.** Modelled on
  `release-quality-gate.yml`: `status: done` in `ideas/rescued/STATUS.md` (or the `force` input),
  the test suite run again in the release job because a release that fails its own suite is worse
  than no release, then `orchestrator-1.6.tar.gz` + `SHA256SUMS` + `install.sh` uploaded under the
  tag, created by `gh release create --target "$GITHUB_SHA"`. **The workflow makes its own tag** —
  the orchestrator merges agent branches with a plain `git push`, which carries no tags, and no
  agent may push this repo at all.
- **`install.sh` installs from the tarball.** Today it dies unless it sits inside a git clone that
  already contains `orchestrator/orchestrator.py` (`install.sh:63-68`), because it derives the repo
  from its own location. A tarball install has the code in one place and the clone it operates on
  in another, so `--repo` stops meaning "where the code is" and means only "which clone to run
  cycles against": the units get an explicit path to the unpacked `orchestrator.py`, and the
  `.git` check stays on `--repo`, where it belongs — the orchestrator genuinely does need a clone
  to commit and push to.
- **`ideas/rescued/scripts/check-release.sh`**, the same shape as
  `ideas/quality-gate/scripts/check-release.sh`: no token, no clone, everything public. Asserts the
  release exists, carries the tarball and its checksum, that the checksum matches the downloaded
  bytes, and that the tarball's `orchestrator.py` declares the same `ORCHESTRATOR_VERSION`. This is
  the only way anyone learns whether the release worked, since it is published on a push nobody
  watches.

## Approach

One commit per unit; the tests land before the change they protect.

1. **U1 — `orchestrator/tests/` with `support.py` and the five ported suites**, and
   `ci-rescued.yml` rewritten to run them. Green against the *current* code: a ported test that
   needs the new behaviour to pass is not a port. This is the unit that proves the harness can
   build a temporary repo, a bare remote and a submodule-inside-a-worktree at all.
2. **U2 — `test_settle_submodules.py`**, including the refusing-remote case, still against the
   current code: the gated case fails here, and that failing test is the specification for U3.
3. **U3 — the fallback branch, the log ladder and the STATUS.md notice.** U2 goes green.
4. **U4 — `ORCHESTRATOR_VERSION = "1.6"`, the version comment, `install.sh`'s tarball path.**
5. **U5 — the release workflow and `scripts/check-release.sh`.**
6. **U6 — `STATUS.md` to `status: done` at `1.6`**, then verify the published release with
   `scripts/check-release.sh` — next cycle if the merge lands late.

## Risks / things to verify early

- **A submodule inside a linked worktree is fiddly to construct.** `.git` there is a file pointing
  into `.git/worktrees/<wt>/modules/<path>`, which is exactly the layout `settle_submodules` reads
  back (`orchestrator.py:1376-1380`). If the fixture cannot reproduce it, the tests test nothing.
  Build that fixture first, in U1, and assert on the layout itself.
- **A `pre-receive` hook that does not run turns the most important test into a tautology.** The
  hook must be executable, and the test must assert the direct push *fails* before asserting the
  fallback succeeded.
- **`agent/<slug>-sweep` accumulates.** Nothing deletes it. A repository swept for weeks grows a
  branch per idea that may be stale, merged or abandoned; the STATUS.md notice is what is meant to
  prevent that, and it depends on someone reading it. See the open questions on naming and reuse.
- **The gitlink still points at a commit that is not on `main`.** The parent records the pin either
  way, and quality-gate's planned `check-wiring.sh` ancestor assertion will report it — correctly:
  it *is* work that has not landed. That is the loud signal working, not a bug, but it means a
  sweep leaves the repository in a state a wiring check calls wrong until the pull request merges.
- **`git branch -r --contains` reads remote-tracking refs, which can be stale** in a fresh worktree
  checkout. Worst case is a redundant push of a commit the remote already has, which succeeds
  trivially — noted rather than fixed, because a `fetch` here costs network on every submodule of
  every agent at the end of every cycle.
- **Do not assert on the sandbox.** No test may depend on DNS, the system locale, the clock beyond
  monotonic deltas, or the machine's git config: the locale bug that silently disabled the budget
  gate in the shell version (`orchestrator.py:27-30`) is exactly the class of thing a test that
  reads the ambient environment fails to catch.
- **The suite has to stay fast.** It runs on every push touching `orchestrator/` and shells out to
  git constantly. Keep it under a minute; if a case needs a real sleep for the lock's renew loop,
  shrink the interval rather than waiting.
- **The release job runs after a merge nobody watches.** Confirm the tag pattern collides with
  neither `aideas-shell-v*` nor `quality-gate-v*` before publishing, and check the result with
  `check-release.sh` rather than assuming.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] **Which folder owns this entry — `ideas/rescued/` or `ideas/orchestrator/`?** README entry 3
      links to `ideas/orchestrator`, and `ideas/orchestrator/PLAN.md` already holds a plan for this
      same text, with `STATUS.md` at `version: 1.6`. But `ideas/rescued/` was scaffolded (its
      `STATUS.md` at `0.1` and `.github/workflows/ci-rescued.yml`) and is where this plan was
      asked for. Two folders, two plans, one entry: the second one built would duplicate the work
      or collide with it. This plan assumes **`ideas/rescued/` is the live folder**, that
      `ideas/orchestrator/` is a leftover to be removed or left dormant by a person, and that the
      README link should be repointed at `ideas/rescued`. Say which way round it goes — an agent
      must not edit README.md or another idea's folder, so only you can settle it.
- [ ] **What is the release tag?** The entry says `orchestrator-v1.6`. With slug `rescued` that
      breaks `verify_release` (`orchestrator.py:1444`): with no upstream in `.gitmodules` the tag
      must contain the *slug*, and `"rescued" not in "orchestrator-v1.6"`, so every retire of this
      entry logs "no release whose tag ends in v1.6" and writes that claim into `STATUS.md`.
      `rescued-v1.6` satisfies the check but contradicts the entry and names the wrong thing — what
      ships is the orchestrator. The plan assumes **`orchestrator-v1.6` as the entry says**, with
      the spurious warning accepted and recorded in `STATUS.md` rather than papered over by
      loosening the check. Confirm, or name the tag you want.
- [ ] **Should the sweep open the pull request itself?** The entry asks it to push and say so
      loudly, which is what the plan does. But `gh` is on the orchestrator's PATH and one
      `gh pr create --draft --head agent/<slug>-sweep` would remove the human step entirely. The
      plan assumes **not** — it would put a network call and a GitHub credential into the wind-down
      path, which runs under a deadline and after a signal, and a failure there is one more thing
      that can go wrong while work is still unsaved. Say if you would rather it did.
- [ ] **One sweep branch per idea, or one per cycle?** `agent/<slug>-sweep` is stable and easy to
      find, but a second sweep before the first is turned into a pull request either force-pushes
      over unmerged rescued work or is refused as a non-fast-forward. The plan assumes a **plain
      (non-forced) push to `agent/<slug>-sweep`, falling back to `agent/<slug>-sweep-<YYYY-MM-DD>`
      when that is refused** — never `--force`, on the grounds that losing rescued work to the
      rescue mechanism is the worst possible outcome. Confirm, or name the scheme you want.
- [ ] **How far does "install without a clone" go?** The tarball plus a rewritten `install.sh` gets
      the code onto a machine without cloning this repository, but the orchestrator still needs a
      git clone at `--repo` to commit and push each cycle, so the installer cannot be clone-free
      end to end unless it clones for the user. The plan assumes **the tarball removes the need to
      clone in order to *install*, and `--repo` stays required**, with a clear error naming it.
      Confirm, or say the installer should clone the ideas repo itself when `--repo` is absent.
