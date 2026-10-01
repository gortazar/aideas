# Plan: orchestrator — `/state` must answer for `origin`, not for the local clone

Difficulty estimate: medium — the git work is a dozen lines and cannot conflict by construction
(`fetch` + `merge --ff-only`), but the entry is really about deciding, writing down and testing
what a GET is allowed to do to a working tree, and it changes a published contract that another
idea's extension and test suite read.

## Context

The GNOME panel showed two ideas as `blocked` for days after their questions had been answered
and pushed. Nothing was wrong with the extension and nothing was wrong with `queue_rows`.

`orchestrator_state()` (`heartbeat_server.py:71`) reads the working tree at `IDEAS_REPO_PATH`:
`README.md`, every `STATUS.md`, every `PLAN.md`, straight off disk. Nothing in that path ever
fetches. The only `git pull` in the system is `Orchestrator.pull()` (`orchestrator.py:863`),
called once at the **start** of a cycle (`:1854`). So the queue the panel renders is whatever the
last cycle left behind, and an answer pushed from the laptop afterwards is invisible until a
cycle happens to run — which, with the timer off, can be days, or never.

The failure has a second face that makes it worse to read. The indicator polls every 60 seconds
and got a **byte-identical** answer every time, which is exactly what a dead refresh looks like.
One bug therefore presents as two: "the data is wrong" and "the panel doesn't update". Both are
the same missing `git fetch`.

`origin/main` is the truth here, not the working tree. The orchestrator pulls before it does
anything, so the honest question for `/state` to answer is **what the next cycle would see**.

Three facts shape the fix:

- **`queue_rows` is path-based.** It opens files under `repo/`, so answering from `origin/main`
  without touching the tree would mean reading blobs (`git show origin/main:README.md`) through a
  rewritten reader. That is a much larger change than the entry asks for, and it would leave the
  endpoint answering about a tree that no cycle is going to build from. Hence fetch-and-merge.
- **`merge --ff-only` cannot conflict.** It either moves `HEAD` along a line origin already has,
  or it declines and changes nothing. There is no `--abort` path, no half-merged tree, no
  `pull()`-style fallback to a real merge. That is why the entry names it specifically.
- **`orchestrator_state()` already knows whether a cycle is running** — it calls `lock_status`
  for the payload, before anything else. A refresh gated on that costs no new machinery.

**A GET that mutates a working tree needs its edges decided, not discovered.** Three cases do
not fast-forward cleanly: a dirty tree, a clone that has genuinely diverged, and a fetch that
fails because the network (or a credential, on a unit with no agent) is not there. Stale data
*shown silently* is the bug being fixed, so serving stale data silently as the fallback would
reproduce it. The fallback is to serve what we have **and say in the payload that it is out of
date**, which is a new field, which is a change to `ideas/aideas/docs/state-contract.md`.

**What this entry may touch.** `orchestrator/orchestrator.py`, `orchestrator/heartbeat_server.py`,
`orchestrator/tests/`, `ideas/orchestrator/`, the `/state` section of `SETUP.md`, and — as the
entry directs — the contract in `ideas/aideas/docs/state-contract.md` together with the single
assertion in `ideas/aideas/tests/test_state_contract.py` that enumerates the top-level keys
(`test_the_available_body_carries_exactly_the_documented_keys`, `:566`). That test is how the
document is kept true; a contract change that leaves it red is not a contract change. **No
extension source is touched** — rendering the new field is the `aideas` idea's work, under its
own entry, and the field is additive precisely so an extension that ignores it keeps working.

## Features

- **`refresh_clone(repo, *, timeout)` in `orchestrator.py`, returning `(ok, reason)`.** All the
  git policy in one function, next to `lock_status` and `cycle_preflight` for the same reason
  those are there: it is shared logic about a repository, and it has to be testable without an
  HTTP server. It refuses in four ways before it ever touches the network and never raises:
  every `git` call is captured, and `subprocess.TimeoutExpired` is caught and turned into a
  reason like everything else.
- **The decision table for "when may a GET move the tree".** Written here, repeated in the
  contract, and asserted case by case in `orchestrator/tests/test_state_refresh.py`:

  | situation | what `/state` does | `refresh.state` and `reason` |
  | --- | --- | --- |
  | clean clone, `origin` ahead | `fetch`, then `merge --ff-only` | `current` |
  | clean clone, already level | `fetch`, merge is a no-op | `current` |
  | a cycle is running | nothing at all | `stale` — `a cycle is running; the clone is refreshed at the start of each cycle` |
  | refreshed moments ago | nothing — the rate limit | `current` (that is what the window means) |
  | tracked files modified | nothing | `stale` — `the working tree has uncommitted changes` |
  | `HEAD` detached, or no upstream branch | nothing | `stale` — `no upstream branch is configured` |
  | not a git clone | nothing | `stale` — `<path> is not a git clone` |
  | `fetch` fails or times out | nothing lands | `stale` — `could not reach origin: <git's first line>` |
  | clone has diverged | `fetch` succeeds, `merge --ff-only` declines | `stale` — `this clone has diverged from <upstream>; it needs a person` |

  Two of those deserve their reasoning spelled out, because they are the ones a reader will
  second-guess. **Dirty is measured on tracked files only** —
  `git status --porcelain --untracked-files=no --ignore-submodules=all` — because a
  fast-forward of the superproject cannot clobber an untracked file (git refuses the checkout
  outright, which lands in the "declined" row) and does not touch a submodule's working tree,
  only its gitlink. Counting submodule state would make the real box's tree permanently dirty,
  since a gitlink left behind by a cycle is an everyday state, and the refresh would then never
  run. **A diverged clone is never resolved here.** `pull()` has a merge fallback because a
  cycle has a lock, a commit and a push to follow it; a GET has none of those, so it declines and
  says so, every poll, until someone looks.
- **The refresh runs before the queue is read, and only when nothing is running.**
  `orchestrator_state()` reads the lock first (it already does), and attempts a refresh only when
  `running` is false — then calls `queue_rows`, so a single request reflects what was just
  fetched. This is the whole bug: an idea whose `- [ ]` was ticked and pushed from the laptop
  becomes `ready` on the next poll instead of on the next cycle.
- **Rate-limited, in the module-state style `POST /cycle` already uses.** At most one fetch per
  `ORCHESTRATOR_STATE_REFRESH_SECONDS` (default **120**): the panel polls every 60 s, so at most
  every other poll shells out, and a push shows up within about two minutes. The window is
  measured with `time.monotonic()` — a wall clock that steps backwards over NTP or a suspend
  would otherwise freeze the refresh for as long as the step — with an injectable `now` so the
  tests do not sleep. A *failed* attempt restarts the clock exactly as a successful one does: a
  box with no network must not fetch on every single poll.
- **The fetch is bounded and non-interactive.** `subprocess.run(..., timeout=...)`, default
  **5 s** (`ORCHESTRATOR_STATE_FETCH_TIMEOUT_SECONDS`), with `GIT_TERMINAL_PROMPT=0`,
  `GIT_ASKPASS=true` and `GIT_SSH_COMMAND` carrying `-o BatchMode=yes` in the child's
  environment. The server is a single-threaded `HTTPServer`: anything that blocks in a handler
  blocks `POST /heartbeat` too, and a heartbeat the laptop could not deliver reads as "the laptop
  is idle", which is a gate on starting cycles. A credential prompt on a unit with no terminal
  would block forever; this makes that case a 5-second failure with a sentence.
- **A new `refresh` object on the available body**, and only there — the unavailable shape still
  promises nothing but `reason`, which an existing contract test asserts:

  ```json
  "refresh": {
    "state": "stale",
    "reason": "could not reach origin: ssh: Could not resolve hostname github.com",
    "checked_at": 1759300000.0,
    "age_seconds": 412
  }
  ```

  `state` is a closed two-word vocabulary, `current` or `stale`. `current` means a fetch
  succeeded within the refresh window and the clone is at `origin`'s commit; `stale` means
  everything else, with `reason` a sentence meant to be shown verbatim. A third word for "never
  checked" was considered and rejected: a box with no remote is genuinely serving data it cannot
  vouch for, and the reason says which case it is — one fewer branch for every consumer.
  `checked_at` is unix seconds of the last **successful** refresh or `null`, and `age_seconds`
  its integer age or `null`, mirroring `cycle_started_at` / `lock_age_seconds` exactly so the
  extension has no new idiom to learn. `reason` is `null` when `state` is `current`.
- **`orchestrator.py status` prints the same line**, because `/state` and the status command have
  been one implementation since 1.4 and splitting them is how they drift. One line under the
  header when the state is `stale`: `WARNING: this clone may be behind origin — <reason>`.
- **`orchestrator/tests/test_state_refresh.py`**, over real repositories built by `support.py`'s
  `init_repo` / `bare_remote` / `seed_remote`. Stdlib and a stock `git`, no network: `origin` is
  a bare repo on disk, and the sandbox already forces `protocol.file.allow`. It covers every row
  of the table above, plus the three that are about behaviour rather than git:
  - **the bug itself** — a repo whose `PLAN.md` has an unticked question, the answer pushed to
    `origin` by a second clone, and the *next* `/state` call returning that idea as `ready`
    without a cycle having run;
  - **the rate limit** — two calls inside the window fetch once, a call past it fetches again,
    and the window is honoured even when the first attempt failed;
  - **a running lock means the tree is not touched at all** — asserted on the commit sha, not
    just on the payload, because "did not mutate" is the claim that matters.
  The timeout is asserted with a stub `git` first on `PATH` that sleeps, in the manner
  `stub_claude` already established, so a hanging remote is proved to be abandoned rather than
  waited on.
- **The contract records it.** `ideas/aideas/docs/state-contract.md` gains `refresh` in the
  available-body key table, a `### Freshness` section carrying the decision table and the
  two-word vocabulary, and a sentence in "What the extension must not assume": `stale` is an
  ordinary state, not an error, and a consumer that ignores the key is still correct — the body
  is the same body it always was. The exact-keys test in `ideas/aideas/tests/` gains `refresh`
  and one assertion on its shape.
- **`SETUP.md` says what refreshing needs from the box.** Two sentences in the `/state` part: the
  unit serving `/state` must be able to **write** the clone (the hardened
  `orchestrator/systemd/idea-heartbeat.service` has `ProtectSystem=strict`, so it needs
  `ReadWritePaths=$IDEAS_REPO_PATH` — the installer's user unit already can), and `git fetch`
  must work non-interactively as that user. When either is untrue the panel says so in words
  instead of going quietly stale, which is the whole point, but it is worth fixing on the box.
- **`ORCHESTRATOR_VERSION = "1.8"`**, its one-line entry in the version comment, `version: 1.8`
  in `STATUS.md`, and the `orchestrator-v1.8` release published by the existing
  `release-orchestrator.yml`. `scripts/check-version.sh` and `scripts/check-release.sh` read the
  version rather than hardcoding it, so neither needs editing — both need running.

## Approach

One commit per unit; the tests for each behaviour land with or before the behaviour it describes.

1. **U1 — confirm 1.7 actually shipped.** `ideas/orchestrator/scripts/check-release.sh`; if it
   reports nothing, `gh workflow run release-orchestrator.yml --repo gortazar/aideas -f
   force=true` and check once, never poll. Recorded in `STATUS.md` in the same commit. 1.7 ended
   with this unverifiable from inside its own session, so it is the first thing this one does.
2. **U2 — `refresh_clone()` and `test_state_refresh.py`'s git cases.** Every row of the decision
   table, the function, and nothing about HTTP.
3. **U3 — `orchestrator_state()` refreshes.** The lock gate, the rate limit, the ordering before
   `queue_rows`, and the end-to-end test that an answered question becomes `ready` without a
   cycle.
4. **U4 — the `refresh` field.** `state`, `reason`, `checked_at`, `age_seconds`; a stale reason
   for each declined case; `available: false` still carrying nothing but `reason`; the status
   command's warning line.
5. **U5 — the contract.** `state-contract.md`, and the two assertions in
   `ideas/aideas/tests/test_state_contract.py` that the new key touches. Both the orchestrator
   suite and the aideas suite green.
6. **U6 — `SETUP.md` and the hardened unit's comment**, including `ReadWritePaths`.
7. **U7 — `ORCHESTRATOR_VERSION = "1.8"`**, the version-comment entry, `version: 1.8`,
   `check-version.sh`, then `status: done` with the whole suite green under `env -i` with
   `LC_ALL=C`, `HOME=/nonexistent`, an antipodean `TZ` and nothing on `PATH` but `/usr/bin` and
   `/bin`. `check-release.sh` for 1.8 next cycle, since the release fires on the push that
   follows this one.

## Risks / things to verify early

- **A GET that writes is the whole hazard of this entry.** Every refusal path must be proved to
  leave the tree byte-identical, not merely to report failure: the dirty, diverged, running-cycle
  and no-upstream tests all assert on `rev-parse HEAD` before and after, and on `git status`
  output being unchanged.
- **The fetch blocks the heartbeat.** One `HTTPServer` thread serves `/state`, `/status`,
  `/heartbeat` and `/cycle`, so a 5-second fetch is 5 seconds in which the laptop's heartbeat POST
  waits — and a heartbeat that does not land looks like an idle laptop, which is a gate on
  starting a cycle. Keep the timeout small and the window at 120 s. If this turns out to bite in
  practice the remedy is a background refresh that the GET kicks but never waits on, serving
  `stale` until it lands; that is a bigger change than the entry asks for and belongs to its own
  entry, not to a quiet widening of this one.
- **`merge --ff-only` is not the only way to fail.** An untracked file in the way of an incoming
  path makes git refuse the checkout; `origin/main` may not exist under that name on a clone whose
  upstream is something else. Resolve the upstream through `@{u}` rather than hardcoding
  `origin/main`, and treat every non-zero exit as "declined, serve stale", never as an exception.
- **Credentials in a systemd unit.** A user unit started at login has no ssh-agent, so an SSH
  `origin` with a passphrase-protected key cannot fetch, ever. That must be a 5-second
  `stale` with a readable reason — not a hang, and not a crash — and `SETUP.md` must say it. Check
  what the real box's `origin` URL is before assuming https.
- **The contract test is in another idea's folder.** Editing `ideas/aideas/tests/` is outside the
  usual rule, and is done here only because this entry explicitly carries the contract change and
  the test is the contract's enforcement. One key, one assertion, no extension source, and
  `ci-aideas.yml` green before the entry is finished. Anything beyond that is the `aideas` idea's.
- **Do not assert on the sandbox.** No network, no DNS, no real `origin`, no wall-clock
  assumptions beyond monotonic deltas: every remote in the suite is a bare repository on disk and
  every clock the tests care about is injected.
- **The window is a knob, not a config key.** `ORCHESTRATOR_STATE_REFRESH_SECONDS` and
  `ORCHESTRATOR_STATE_FETCH_TIMEOUT_SECONDS` are environment variables on the serving unit,
  matching `ORCHESTRATOR_CYCLE_MIN_SECONDS`, not `.agent-config.yml` entries — the config file is
  read by cycles, these are read by the server. There is deliberately no off switch: a box that
  cannot fetch already degrades to a named `stale`, which is better than a silent opt-out.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->

None blocking. The three cases the entry asked to have decided — a dirty tree, a diverged clone, a
failed fetch — are decided in the table under **Features** rather than asked about, and the
defaults chosen without being asked are stated so they can be overruled in a later entry: a 120 s
refresh window, a 5 s fetch timeout, a two-word `refresh.state` vocabulary, and no change to any
extension source.
