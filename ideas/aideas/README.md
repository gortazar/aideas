# aideas — the orchestrator's state in the GNOME top bar

A panel indicator that shows what the idea-builder orchestrator is doing. A button appears
while a cycle is running; its menu lists which ideas are **running**, which are **ready** to be
built next, and which are **blocked** waiting for you to answer a question.

```sh
curl -fsSL https://raw.githubusercontent.com/gortazar/aideas/main/ideas/aideas/install.sh | sh
```

Then set the box's address — or export `ORCHESTRATOR_HEARTBEAT_URL` before installing, as the
laptop already does for the heartbeat hook, and the installer fills it in for you:

```sh
gnome-extensions prefs aideas-shell@patxi.gortazar
```

![the menu, reading a live orchestrator](screenshots/menu-live-orchestrator.png)

That screenshot is the extension reading the orchestrator that was building it at the time:
`aideas` running for 10 minutes, three ideas blocked on unanswered questions, and a second
`restore-wss` entry queued behind the first.

![preferences](screenshots/preferences.png)

## What it shows, and what it decides

Nothing. **The orchestrator classifies every idea; the extension renders what it is told.** It
reads `GET http://<box>:8787/state` — the endpoint `orchestrator/heartbeat_server.py` already
serves — and each row's words come from the `state` and `note` it returns.
[`docs/state-contract.md`](docs/state-contract.md) specifies that response, and
`tests/test_state_contract.py` asserts it against fixture repositories, so the two halves
cannot drift apart while they live in one repo.

| The menu | Where it comes from |
| --- | --- |
| `Cycle running for 12 min, 2 agents` / `Idle` | `running`, `agents`, `cycle_started_at` |
| `updated 8 s ago · lock renewed 42 s ago` | when the reading was taken, and `lock_age_seconds` |
| **Running** — slug, version, how long the cycle has run | rows with `state: running` |
| **Blocked** — slug, `2 unanswered questions` | rows with `state: blocked` |
| **Ready** — slug, `minor update -> v0.3`, with the next one marked | rows with `state: ready` |
| **Also in the queue** — `behind #1`, `no PLAN.md yet` | `queued`, `to be planned`, anything new |

Rows are read-only: answering a blocked idea means editing its `PLAN.md` on the box, which is
not something a panel menu should do.

The button is visible **only while a cycle is running**. Turn on *always show the button* if
you would rather see blocked ideas without a cycle running. If contact is lost while a cycle
was running, the button stays for five minutes wearing an "unreachable" icon, with the last
good reading dated beneath it — one dropped poll on a VPN should not blink the panel out.

## Behaviour worth knowing

- **It sends nothing and spawns nothing.** GJS and libsoup only, which is what the GNOME
  Extensions review guidelines require and why `/state` exists at all.
- **Polling pauses completely** while the session is locked (GNOME disables the extension) or
  idle (Mutter's idle monitor). A laptop asleep on a desk does not wake up to talk to a VPN
  host. Every 30 s otherwise, configurable 10–300 s, 5 s while the menu is open, backing off to
  five minutes while the box is unreachable.
- **"Cannot reach the orchestrator" is an ordinary state**, rendered calmly — and kept distinct
  from "the box answered and cannot read its queue", because those mean opposite things.
- **No secret is stored.** `GET /state` is unauthenticated and protected by the server binding
  to a VPN address, which is what the rest of the system already assumes.

## Diagnosing a setup

```sh
gjs -m tools/probe-state.js <host> [port]
```

Reads `/state` with the extension's own transport, client and wording, and prints what *Test
connection* would say, what the panel would look like, and the whole menu. If this disagrees
with the panel, one of them is wrong.

```
[ok] Connected to 127.0.0.1:8833
        cycle running, 1 agent · 5 ideas queued · 3 ideas blocked
```

## Working on it

The source lives here rather than in an upstream repository of its own: the README entry says
to build it in this repo, so this folder carries what an upstream normally would — the flake,
the tests, the installer and the release workflow.

```sh
nix develop           # gjs, glib, gtk4, libadwaita, eslint, python3, dbus
make help             # every target
make check            # lint + unit + http + contract + bundle — what CI runs
nix flake check       # the same four checks in the sandbox
```

| Test | What it covers | Needs |
| --- | --- | --- |
| `make test-unit` | 205 tests: parsing, grouping, wording, visibility, badge, backoff, scheduler | plain gjs |
| `make test-http` | 16 tests: the real libsoup transport against a stub server on loopback | gjs, python3 |
| `make test-contract` | 24 tests: `/state` driven over fixture repositories | stock python3 |
| `make check-bundle` | the assembled extension loads: metadata, imports, compiled schema | gjs, glib |
| `make smoke` | 39 checks in a nested headless GNOME Shell, plus screenshots | a GNOME machine |
| `make test-install` | 27 checks: `install.sh` run for real, from a clean directory | dbus, zip |

`make smoke` and `make test-install` both isolate `XDG_CONFIG_HOME` and run on a private
session bus. That is not decoration: dconf writes are performed by a service that reads *its
own* environment, so without it a test session rewrites the real desktop's settings.

```
src/lib/          pure, Shell-free, tested headlessly — state, menu, scheduler, transport
src/extension/    what runs inside gnome-shell: indicator, prefs, idle watcher
ci/               the smoke test, its probe extension, the installer test
docs/             the /state contract
tools/            probe-state.js, check-bundle.js
```

The release is a tag on this repository, `aideas-shell-v<version>`, published by
[`.github/workflows/release-aideas.yml`](../../.github/workflows/release-aideas.yml) when
`STATUS.md` says the idea is done. The workflow creates its own tag, because a tag made in a
worktree would never survive the orchestrator's plain `git push`.
