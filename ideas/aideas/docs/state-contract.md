# The orchestrator's HTTP contract

Two endpoints the aideas panel uses: `GET /state`, which is everything it *reads*, and
`POST /cycle`, which is the one thing it *writes*. This document specifies both, and
`tests/test_state_contract.py`, `tests/test_cycle_preflight.py` and
`tests/test_cycle_endpoint.py` assert them against fixture repositories, so the endpoints and
the extension cannot drift apart while they live in one repository.

Until 0.3 this document opened by saying `/state` was "the only thing the aideas panel
indicator reads", which was true and is still true of reading. The panel now also asks for a
cycle to be started.

The endpoint is served by `orchestrator/heartbeat_server.py` (`orchestrator_state()`), and
every per-idea row comes from `orchestrator.queue_rows()` — the same function
`orchestrator.py status` prints from. **The extension classifies nothing.** It renders
`state` and `note` as served; when the vocabulary below grows, the extension gains a case,
it does not gain a judgement.

## Transport

- Plain HTTP, unauthenticated. Reads are protected by the server binding to a VPN address
  (`HEARTBEAT_BIND_IP`), which is what the rest of the system already assumes; `POST
  /heartbeat`'s shared secret does not apply to `GET`.
- Always `200` with `Content-Type: application/json` when the path is `/state`. Failure is
  reported *inside* the body via `available: false`, never as a status code. A non-200 is
  therefore a bug or a different server, and the extension treats it as unreachable.
- No caching headers, no compression, no streaming. The body is small: about 120 bytes per
  idea, and bounded rather than estimated — a blocked idea additionally carries its questions,
  capped at 5 × 200 characters, so no row exceeds roughly 1 KiB however long a `PLAN.md`
  question is. See [`open_question_texts`](#open_question_texts).

## Body

Two shapes, told apart by `available`.

### Unavailable

```json
{ "available": false, "reason": "IDEAS_REPO_PATH is not set" }
```

`reason` is a human sentence, meant to be shown verbatim. It is emitted when:

| `reason`                                | cause                                                       |
|-----------------------------------------|-------------------------------------------------------------|
| `IDEAS_REPO_PATH is not set`            | the serving unit has no repo path in its environment        |
| `orchestrator module could not be imported` | `orchestrator.py` failed to import next to the server   |
| `could not read the queue: <exc>`       | `README.md`, a `STATUS.md` or the config could not be parsed |

No other key is guaranteed on this shape. **`reason` itself is not guaranteed** — a future
cause could omit it — so a consumer substitutes its own wording when it is missing.

### Available

```json
{
  "available": true,
  "running": true,
  "agents": ["aideas", "vacas"],
  "cycle_started_at": 1755180000.0,
  "lock_age_seconds": 42,
  "ideas": [ ...rows... ]
}
```

| key                | type                | meaning                                                                                                |
|--------------------|---------------------|--------------------------------------------------------------------------------------------------------|
| `available`        | `true`              | the queue was read; the rest of the keys are present                                                    |
| `running`          | bool                | a cycle is alive — the lock was renewed within its TTL. **The one authority on "is it running".**       |
| `agents`           | array of slug       | what that cycle currently holds. Empty when `running` is false. Length is the agent count.              |
| `cycle_started_at` | unix seconds, or `null` | when the lock was acquired. `null` when nothing is running, or when the lock has no `acquired_at`.  |
| `lock_age_seconds` | int, or `null`      | seconds since the lock was last renewed. `null` when there is no readable lock. Present **even when `running` is false** — a climbing age on a dead cycle is the visible symptom of a box that stopped renewing. |
| `ideas`            | array of row        | one row per `## Ideas` entry in `README.md`, in queue order. May be empty.                              |

`running`, `agents` and `cycle_started_at` all come from one write of the lock's
`meta.json`, which a live cycle rewrites every `lock_renew_seconds`. That is deliberate: a
reader can never see liveness without seeing what it is working on.

`## Finished` entries are **not** returned. Neither is anything about budget, schedule or
the stop file.

### A row

```json
{
  "position": 3,
  "slug": "aideas",
  "version": "0.1",
  "state": "ready",
  "note": "minor update -> v0.3",
  "will_run_next": true,
  "target_version": "0.3"
}
```

Always present, for every row:

| key             | type   | meaning                                                                       |
|-----------------|--------|-------------------------------------------------------------------------------|
| `position`      | int ≥1 | 1-based index in the queue, matching the number printed in `README.md`         |
| `slug`          | string | the idea folder; lowercase letters, digits and hyphens. **Not unique** — see below |
| `version`       | string | `major.minor` from the idea's `STATUS.md`, defaulting to `0.1`                 |
| `state`         | string | one of the five words below                                                   |
| `note`          | string | a human phrase qualifying the state, meant to be shown verbatim. May be empty  |
| `will_run_next` | bool   | this row is one the next cycle would pick up                                  |

Conditionally present, and **absent rather than null** when they do not apply:

| key              | present when       | meaning                                       |
|------------------|--------------------|-----------------------------------------------|
| `open_questions` | `state == blocked` because `PLAN.md` has unticked questions | how many. ≥1 |
| `open_question_texts` | exactly when `open_questions` is | the questions themselves — see below |
| `target_version` | `state == ready`   | the version this entry is meant to deliver     |

### `open_question_texts`

An array of one-line strings: the unanswered questions of that idea's `## Open Questions`
section, in file order. Present exactly when `open_questions` is — a row blocked because its
`STATUS.md` says so carries neither.

Both come from one reader (`open_question_lines()`, of which `count_open_questions()` returns
the length), so the count and the texts can never disagree about what is being waited on.

Each string is **already folded and bounded by the server**, because a `PLAN.md` question is
unbounded prose and `/state` is polled every few seconds:

- the `- [ ]` and any leading whitespace are gone;
- lines the question was wrapped across are joined into one, whitespace collapsed;
- markdown emphasis (`*`, `**`, backticks) is stripped, since it renders as literal characters
  in a menu. Underscores are **not** stripped — they are usually part of an identifier;
- anything longer than **200 characters** is cut at a word boundary and ends with `…`;
- at most **5** questions are sent per idea, however many `open_questions` reports. A reader
  showing fewer than the count can say "+n more" from the difference.

So a blocked row is bounded at roughly 1 KiB, which is the per-row bound that replaces this
document's older "about 120 bytes per idea" estimate.

A consumer must still not trust the array: it comes from a file an agent wrote. Treat a missing
key, a null, a non-array, a non-string member and an empty string as "no texts", and do not
assume `length == open_questions`.

`state` is a closed vocabulary of five words:

| `state`         | meaning                                                        | typical `note`                              |
|-----------------|----------------------------------------------------------------|---------------------------------------------|
| `running`       | an agent holds this slug in the live cycle                      | `an agent is working on it now`              |
| `ready`         | eligible to be built                                            | `not started`, `in progress`, `minor update -> v0.3`, `finished before — reopens for this entry`, `questions answered; unblocks next cycle` |
| `blocked`       | waiting on a human — always an unticked `- [ ]` in `PLAN.md`    | `2 unanswered questions`                     |
| `queued`        | a second entry for a slug that appears earlier in the queue      | `behind #1`                                  |
| `to be planned` | no `PLAN.md` yet                                                | `no PLAN.md yet`                             |

Note the space in `to be planned`: it is prose, not an identifier.

Row invariants a consumer may rely on, each covered by a test:

- **`slug` is not a key.** One folder may hold several queued entries; the second and later
  ones come back as `queued` with `note: behind #<position of the first>`. `position` is
  the only unique field, and it is what a UI must key rows by.
- **`state == running` for exactly the slugs in `agents`**, whatever the files say — a
  `STATUS.md` only records where the *last* cycle got to. This applies to *every* entry of
  a running slug, not just its first: a slug with two queued entries that is currently
  being built returns two `running` rows, so the same slug can legitimately appear twice
  inside a Running section.
- **`will_run_next` is true only on `ready` rows, and only when `running` is false**, for
  at most `parallel_agents` rows. A running cycle returns no `will_run_next` at all.
- **A `blocked` row never has `will_run_next`.** Blocked is the state that stays put until
  someone answers it, which is why it is worth surfacing when nothing is running.
- **`blocked` comes from the questions, never from `STATUS.md` alone.** Until orchestrator
  1.4 a `status: blocked` file produced a `blocked` row noted `STATUS.md says blocked`, and
  nothing ever cleared that flag — so an idea whose question had been answered stayed
  unbuildable and the row asserted it as a fact. Such a row is now `ready`, noted
  `questions answered; unblocks next cycle`. An idea with an unticked `- [ ]` is still
  `blocked` with its count, which is the case that must not be swallowed.

## What the extension must not assume

The endpoint reads `README.md` and every `STATUS.md` and `PLAN.md` on each request, on a
box that is also running agents, so:

- **Latency is not bounded.** Every request carries a client-side timeout.
- **The shape is not trusted.** A missing key, a wrong type, a duplicate slug, an
  oversized body and a non-JSON body are each handled, not thrown: an unhandled throw in a
  GNOME Shell extension damages the whole session. Unknown `state` values render as
  themselves rather than being dropped.
- **`available: false` is an ordinary state**, not an error, and is distinct from being
  unable to reach the box at all. Those two mean opposite things — one is a configured box
  telling you something, the other is silence — and the UI says which.

## Versioning this contract

Additive changes (a new key, a new `state` word, a new `reason`) are expected and must not
break a consumer. If a key's meaning or type ever has to change, `/state` gains a
`contract` integer and this document gains a section; until then its absence means 1.


## `POST /cycle`

Asks the box to start a cycle now. New in 0.4; a box that does not serve it answers **404**,
which a client must read as "this box is older than this extension" rather than as a failure of
the request.

### Request

```json
{ "secret": "…", "override": false }
```

| key | meaning |
|-----|---------|
| `secret` | the shared secret, as `POST /heartbeat` sends it. Required only when the box has `HEARTBEAT_SHARED_SECRET` set; when it does not, any request is accepted, exactly as `/heartbeat` behaves |
| `override` | optional. `true` skips the two gates about *when* it is convenient to build — `allowed_hours` and the laptop heartbeat — and **never** the stop file, the daily budget or the lock |

### Response

Always JSON, and always the same three keys:

```json
{ "started": true,  "gate": null,        "reason": null }
{ "started": false, "gate": "stop-file", "reason": "Paused: .orchestrator/stop exists" }
```

`reason` is a sentence written to be shown to a person. `gate` is a word for a program to branch
on. **`started: true` means launched, never finished**: the cycle re-applies these same gates
itself and may still exit, so a client confirms by watching `/state`, not by believing this
reply. A successful reply additionally carries `command`, the argv that was started.

| `gate` | when | typical `reason` |
|--------|------|------------------|
| `stop-file` | `.orchestrator/stop` exists | `Paused: .orchestrator/stop exists` |
| `allowed-hours` | outside the configured window | `Outside allowed_hours (23:00-08:00 Europe/Madrid)` |
| `budget` | today's spend is at or over `max_daily_cost_usd`, or that value is unparseable | `Daily budget spent ($12.40 of $10)` |
| `heartbeat` | a Claude Code session is active on the laptop, or the heartbeat cannot be read at all | `A Claude Code session is active on this laptop` / `Cannot tell whether …` |
| `lock` | a cycle is already running | `A cycle is already running` |
| `claude` | the default launch would find no `claude` on its `PATH` | `claude is not on the orchestrator's PATH` |
| `spawn` | the launch itself failed | `could not start a cycle: …` |
| `server` | this box cannot do it at all — no `IDEAS_REPO_PATH`, or the orchestrator module would not import | `IDEAS_REPO_PATH is not set` |
| `rate-limit` | a cycle was launched moments ago | `a cycle was just launched, wait 24 s` |

The gates are applied **in the order `Orchestrator.run()` applies them**, from one
implementation (`cycle_preflight()`), so a refusal names a gate that a timer-fired cycle would
really have hit. `count`-style vocabulary growth is expected: a client shows `reason` verbatim
and treats an unknown `gate` as "refused, for the reason given".

### Statuses

| status | meaning |
|--------|---------|
| `200` | the request was understood. Read `started` — a gate saying no is a normal answer, not an error |
| `401` | the box has a shared secret and the request did not match it |
| `404` | this box does not serve `/cycle`: it predates 0.4 |
| `429` | rate-limited. The body is the usual shape, with `gate: "rate-limit"` |

### The rate limit

At most one launch per `ORCHESTRATOR_CYCLE_MIN_SECONDS` (default 30). The lock already makes a
duplicate cycle harmless; this is about a double-click, or a wedged panel, not filling the
journal with launches. A *refused* request does not start that clock — only a launch does.

### What starts

`ORCHESTRATOR_CYCLE_COMMAND` if it is set, split as a shell word list; otherwise a detached
`python3 orchestrator.py run` from the server's own directory, which is how the orchestrator
running in this deployment is launched by hand today.

A box whose heartbeat receiver is sandboxed **must** set it — `idea-heartbeat.service` has
`ProtectSystem=strict`, `ProtectHome=yes`, `MemoryMax=128M` and no `PATH` carrying `claude`, so
a cycle `fork()`ed from inside it would start, find no `claude`, and fail every agent. Pointing
it at `systemctl start idea-orchestrator.service` makes systemd supply the cycle's environment
instead. `SETUP.md` has both forms.
