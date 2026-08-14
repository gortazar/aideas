# The `/state` contract

`GET http://<box>:8787/state` is the only thing the aideas panel indicator reads. This
document specifies that response, and `tests/test_state_contract.py` asserts it against
fixture repositories, so the endpoint and the extension cannot drift apart while they live
in one repository.

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
  idea.

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
| `target_version` | `state == ready`   | the version this entry is meant to deliver     |

`state` is a closed vocabulary of five words:

| `state`         | meaning                                                        | typical `note`                              |
|-----------------|----------------------------------------------------------------|---------------------------------------------|
| `running`       | an agent holds this slug in the live cycle                      | `an agent is working on it now`              |
| `ready`         | eligible to be built                                            | `not started`, `in progress`, `minor update -> v0.3`, `finished before — reopens for this entry` |
| `blocked`       | waiting on a human                                              | `2 unanswered questions`, `STATUS.md says blocked` |
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
