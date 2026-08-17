---
name: run-orchestrator
description: Operate the idea-builder orchestrator in this repo — run or stop a cycle, read what it is doing, and interpret the README queue, idea states, versions and blocking questions. Use whenever asked to run a cycle, check what the orchestrator is doing, unblock an idea, or add/interpret an entry in the ideas list.
---

# Running the orchestrator

The orchestrator builds ideas from `README.md` one cycle at a time. A cycle plans any idea
that has no plan, then gives up to `parallel_agents` ideas to `claude -p` agents working in
their own git worktrees, and finally merges, commits and pushes what they produced.

`orchestrator/orchestrator.py`'s docstring is the authoritative spec. This is how to drive
it.

## Look before you run

```bash
python3 orchestrator/orchestrator.py status
```

Read-only, needs no environment, and tells you the heartbeat state, the orchestrator
version, the budget, and every entry in the queue with its version and state. **Always run
this first** — it answers "what would a cycle do" without spending anything.

One inaccuracy to know: it snapshots *before* the planning pass, so an idea showing
`needs planning` may well be planned and built in the same cycle. Its "would build"
line only counts ideas that already have a plan.

## Run a cycle

Two environment variables, and a heartbeat server that must be reachable:

```bash
D=~/aideas-sandbox                     # a durable clone, NOT the session scratchpad
export IDEAS_REPO_PATH="$D/repo"
export ORCHESTRATOR_HEARTBEAT_SELF_URL="http://127.0.0.1:8833"

# The heartbeat receiver must be up, or every cycle refuses to start (see below).
HEARTBEAT_STATE_PATH="$D/heartbeat.json" HEARTBEAT_BIND_IP=127.0.0.1 \
  HEARTBEAT_PORT=8833 IDEAS_REPO_PATH="$D/repo" \
  setsid python3 "$D/repo/orchestrator/heartbeat_server.py" >/dev/null 2>&1 </dev/null &

setsid python3 "$D/repo/orchestrator/orchestrator.py" > "$D/cycle.log" 2>&1 </dev/null &
```

`setsid` matters. A cycle runs up to `max_cycle_minutes` (45 by default); launched as a
child of your shell it dies when the session does, and a cycle killed mid-planning loses
that plan entirely. Detached, it finishes and pushes on its own.

Run against a **durable directory**, never the session scratchpad — a cleared scratchpad
has taken a running cycle with it more than once.

## Stop a cycle

```bash
touch "$IDEAS_REPO_PATH/.orchestrator/stop"    # winds down gracefully, still commits
rm    "$IDEAS_REPO_PATH/.orchestrator/stop"    # resume — it is a pause switch, not one-shot
```

It is never necessary to kill anything. Agents get SIGTERM plus `agent_grace_seconds`, and
the cycle still commits, merges and pushes their work. `systemctl stop` and the deadline
take the same path. **Leaving the stop file in place pauses every future cycle**, which
reads as "the orchestrator is broken" — remove it when you are done.

## Why a cycle refuses to start

In the order it checks: the stop file; `allowed_hours`; `max_daily_cost_usd` against
today's rows in `.orchestrator/usage.log`; the heartbeat; the lock.

The heartbeat gate **fails closed** — if the server is unreachable the orchestrator cannot
tell whether you are working, so it skips the cycle. A dead heartbeat server therefore
looks exactly like "nothing to do". Check it first when cycles stop happening.

## Reading the queue

`## Ideas` is the work queue; `## Finished` is a record and is never scheduled. Position is
priority. Each entry links its folder as `ideas/<slug>/` — the trailing slash is optional
and the link *text* is ignored; the folder in the URL identifies the idea.

**A folder may appear more than once.** Each entry is a separate piece of work, done one at
a time in list order, and two agents never share a folder. When an entry finishes it moves
to `## Finished` stamped with the date and version, the previous `PLAN.md` is archived
under `ideas/<slug>/plans/`, and a fresh plan is drafted for the next entry — while the
agent keeps its session, so it still remembers the code it wrote.

Each idea carries a `version:` in its `STATUS.md`, starting at `0.1`. Later entries say
`minor` or `major` anywhere in the text and bump on completion; an entry saying neither is
treated as minor.

### What each state means

| State | Meaning | What unblocks it |
| --- | --- | --- |
| `to be planned` | no `PLAN.md` yet | nothing — the next cycle plans it |
| `ready` | plan exists, no open questions | nothing — the next cycle builds it |
| `blocked` | unticked `- [ ]` under `## Open Questions` | answer them |
| `queued` | a later entry for a folder already in flight | the entry ahead finishing |
| `running` | an agent holds it right now | — |

An idea is only finished when its agent sets `status: done`; the orchestrator preserves
that and stops scheduling it. Prose saying "this is complete" does nothing.

## Answering a blocked idea

Edit that idea's `PLAN.md`: change `- [ ]` to `- [x]` and write the answer inline on the
same line. Leave answered questions in place — they are the record, and they stay in the
agent's context because `CLAUDE.md` is rebuilt from `PLAN.md` every cycle.

Only an unticked `- [ ]` blocks. A question written as prose is invisible.

Good planners state what ticking a line unchanged means, so a question can often be
answered with a tick and no prose.

## Things that will otherwise surprise you

- **Pushing while a cycle runs is fine.** The cycle's own push is rejected, but it then
  merges your commits and pushes again, still holding the lock. Only a genuine conflict —
  the same lines edited on both sides — stops it, and it says so loudly and keeps its work
  locally for a person to resolve.
- **Agents cannot run `rm -rf` headlessly.** Claude Code refuses destructive filesystem
  commands regardless of `--allowed-tools`. Denials naming `rm`/`rmdir` are that, not a
  misconfiguration; agents work around them and finish.
- **Cost caps are approximate.** `max_cycle_cost_usd` is per agent and overshoots — a cap
  of $0.40 has finished at $0.59. The daily gate only decides whether to *start* a cycle.
- **The ledger is local.** `.orchestrator/usage.log` is gitignored, so a rebuilt clone
  starts the day's spend at zero and the daily cap under-counts.
- **A killed agent still reports.** A SIGTERMed `claude -p` writes its result JSON, so its
  cost and session survive; only SIGKILL loses them, and the session id is then recovered
  from the transcript.

## When something looks wrong

```bash
curl -s "$ORCHESTRATOR_HEARTBEAT_SELF_URL/state" | python3 -m json.tool  # live view
git -C "$IDEAS_REPO_PATH" worktree list         # leftover worktrees = a killed cycle
git -C "$IDEAS_REPO_PATH" branch --list 'agent/*'   # leftover branches = a conflicted merge
```

A leftover `agent/<slug>` branch means its merge conflicted and the work was kept rather
than discarded — inspect it before deleting. The next cycle rebuilds its own worktrees, so
stale ones are safe to remove.
