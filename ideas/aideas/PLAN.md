# Plan: aideas — a panel indicator for the orchestrator

Difficulty estimate: medium — the GNOME Shell side is a well-trodden path (recap.gs already ships a
polling panel indicator with tests, a smoke test and a release workflow), and `/state` already serves
exactly the data the menu needs; what is new is that this idea lives *in this repo* rather than in an
upstream of its own, so its packaging, CI and release path all have to be invented rather than copied.

## Context

Five facts shape the design:

1. **The data already exists and is already shaped for this.** `orchestrator/heartbeat_server.py`
   serves `GET /state` on the same port 8787 the heartbeat uses, and its docstring says outright that
   it exists "for anything building a UI on top — a shell extension, a status bar". It returns
   `{available, running, agents, cycle_started_at, lock_age_seconds, ideas[]}`, where each idea row
   comes from `orchestrator.queue_rows()` and carries `position`, `slug`, `version`, `state`, `note`,
   `will_run_next`, and — depending on the state — `open_questions` and `target_version`. `state` is
   one of `running`, `ready`, `blocked`, `queued`, `to be planned`. That is precisely the "running /
   ready / blocked with questions" split the idea asks for: **the extension classifies nothing, it
   renders what the orchestrator already decided.** Same rule recap.gs 0.1 works under.
2. **The extension runs on the laptop; the orchestrator runs on the box.** The box is headless and
   VPN-reachable, the laptop is where GNOME Shell is. So "install along with the orchestrator" cannot
   mean "installed by the box's setup" — it means the repo that carries the orchestrator also carries
   the extension, and SETUP.md's **Laptop** section, which today installs the heartbeat hook, installs
   this too, from the same clone, in the same step. See the second and third open questions.
3. **No upstream repo.** The entry overrides AGENTS.md's "every idea lives in its own GitHub
   repository" rule explicitly. So the source lives at `ideas/aideas/extension/`, tests live at
   `ideas/aideas/tests/`, and `ideas/aideas/` has no `upstream` submodule and no pin-check script.
   Everything AGENTS.md asks an upstream to provide — flake, tests, CI, installer, release — has to be
   provided here instead, and the CI is `.github/workflows/ci-aideas.yml`, which already exists and
   runs `nix flake check` in this folder.
4. **`GET /state` is unauthenticated, unlike `POST /heartbeat`.** Reads are protected by the VPN
   binding alone. The extension therefore needs no secret, and the plan does not add one: putting a
   shared secret into a GSettings key, readable by any process in the session, would be a downgrade
   dressed up as security. Plain HTTP over the VPN is what the whole system already assumes.
5. **An extension that polls a host that may be asleep, off-VPN or simply not there is normal.** The
   box is reachable only on VPN and the laptop is off VPN often. "Cannot reach the orchestrator" is an
   ordinary state to render calmly, not an error to shout about — and it must be told apart from "the
   box answered and nothing is running", because those two mean opposite things.

Assumptions, stated rather than asked:

- **The button reflects the *system*, not just a cycle.** The literal reading of the entry is "a
  button when aideas is running", but a blocked idea is exactly the thing you want to see when nothing
  is running — that is the state that will stay stuck until you answer it. So the button is shown when
  a cycle is running **or** any idea is blocked, and hidden otherwise, with a preference to keep it
  always visible. See the first open question, which can overrule this.
- **The menu is read-only.** The entry says "shows"; answering a question means editing `PLAN.md` on
  the box's clone, which is not something a panel menu should do. Rows display, they do not act. See
  the fourth open question.
- **One box.** A single host/port pair in preferences, not a list of orchestrators.
- **`## Finished` entries are not shown.** `/state` does not return them, `orchestrator.py status`
  deliberately does not print them, and this follows both.
- **GNOME Shell 46–50**, matching recap.gs's `metadata.json`, since it is the same desktop.

## Features

- **A panel indicator that appears with the work** — a top-bar button, shown when the orchestrator
  reports a running cycle or any blocked idea and hidden when there is nothing to say, carrying a
  count badge (agents running, or blocked ideas when idle) and a state-specific symbolic icon:
  running, blocked, and unreachable. It never spawns a process — GJS + libsoup only, which is what
  EGO review requires and why `/state` exists in the first place.
- **A menu grouped by state** — three sections in the order that matters when you glance at it:
  **Running** (slug, version, and how long the cycle has been going, from `cycle_started_at`),
  **Blocked** (slug and "N unanswered questions"), **Ready** (slug, its `note` — `minor update ->
  v0.3`, `not started` — with the `will_run_next` row marked as what the next cycle picks). Queued and
  to-be-planned entries render in a fourth, quieter section so the menu is a complete account of the
  queue. Every row's text comes from `state`/`note`/`version` as served; the extension supplies
  grouping and wording, never judgement. Empty sections are omitted, and a queue with nothing in it
  says so in a sentence.
- **A header line for the cycle itself** — "Cycle running for 12 min, 2 agents" or "Idle", plus the
  age of the reading ("updated 8s ago"), so a frozen panel is visibly frozen rather than quietly
  lying.
- **Honest failure states** — `available: false` (the box has no `IDEAS_REPO_PATH`, or the queue could
  not be parsed) shows the server's own `reason` string; a connection refused, DNS failure, timeout or
  non-JSON body shows "orchestrator unreachable" with the host it tried, and the last good reading
  greyed out beneath it with its timestamp. Nothing about the shape of the response is trusted: a
  missing key, a wrong type or a 5 MiB body is handled, not thrown, because a throw in an extension
  damages the whole desktop.
- **Polling that behaves** — every 30 s by default (configurable 10–300 s), 5 s while the menu is
  open, single-flight so a slow reply cannot stack requests, a hard request timeout, exponential
  backoff up to a ceiling while unreachable, and **no polling at all while the screen is locked or the
  session is idle** — a laptop asleep on someone's desk must not wake to talk to a VPN host. The
  scheduler is a pure, injected-clock module, tested without a shell, as in recap.gs.
- **A preferences window** — box host or IP, port (default 8787), poll interval, "always show the
  button", and a **Test connection** button that reports what `/state` said or why it could not be
  reached. The host defaults to empty, and an unconfigured extension says "set the orchestrator
  address in preferences" instead of hammering `localhost`.
- **A documented, tested contract** — `docs/state-contract.md` in this folder specifies the `/state`
  response as the versioned surface it now is, and a Python test drives `orchestrator.queue_rows()`
  over fixture repositories (running cycle, blocked idea, duplicate slugs queued behind each other, an
  idea with no `PLAN.md`) asserting the keys and the `state` vocabulary the extension depends on. That
  test is what stops the two halves drifting apart while they live in one repo — the point of putting
  them in one repo.
- **Headless GJS tests** for parsing, grouping, wording, the failure taxonomy, the badge count, the
  visibility rule and the backoff, with the HTTP seam injected — the whole menu is decided by pure
  functions from a response object, so all of it is testable without a compositor.
- **A compositor smoke test** — the extension is enabled in a nested `dbus-run-session` GNOME Shell
  against a stub `/state` server, the panel is checked, the menu is opened and read back, and five
  enable/disable rounds must leave no timer, no signal and no Soup session behind. `ci/smoke-test.sh`
  in recap.gs's upstream is the model, including the screenshots it produces.
- **Installed with the orchestrator, on the laptop** — `ideas/aideas/install.sh` installs the
  extension into `~/.local/share/gnome-shell/extensions/`, compiles its schema, enables it, and can
  pre-set the box address from `ORCHESTRATOR_HEARTBEAT_URL` if that is already exported, so the one
  value the user must type is one they already have. It works from a clone and from an unpacked
  release zip, is idempotent, and refuses politely on a non-GNOME session.
- **CI and a release** — `.github/workflows/ci-aideas.yml` (already present) runs lint, the GJS tests
  and the contract test through `ideas/aideas/flake.nix`; a release publishes the packaged
  `aideas-shell@…​.shell-extension.zip` so it installs without compiling anything, and this folder's
  `README.md` opens with that one-line install command. Which tag and which repository that release
  comes from is the third open question.

## Approach

Units, each one commit, tests first:

1. **U1 — the contract.** `docs/state-contract.md` plus the Python test over fixture repos. Nothing
   GNOME-side is worth writing before the shape it renders is pinned down.
2. **U2 — the flake and the skeleton.** `flake.nix`, `eslint.config.js`, the test runner, `metadata.json`,
   a stub `extension.js` that enables and disables cleanly, and CI green on it. Small, and it makes
   every later unit committable.
3. **U3 — parsing and grouping.** Pure: a `/state` body in, sections and rows out, including every
   malformed and `available: false` case.
4. **U4 — visibility and the badge**, as a pure function of the same parsed state.
5. **U5 — the panel button and menu**, wired to U3/U4 with a stubbed fetcher.
6. **U6 — the HTTP client**: libsoup, timeout, single-flight, backoff, last-good retention.
7. **U7 — the scheduler**: interval, menu-open rate, lock/idle suppression, injected clock.
8. **U8 — preferences** and the GSettings schema, including *Test connection*.
9. **U9 — the real shell**: the smoke test, screenshots, and one recorded by-hand run against the real
   box on VPN, noted in `STATUS.md`. This feature is only true if the real orchestrator lights it up.
10. **U10 — packaging**: `install.sh`, the release workflow, `README.md` opening with the install
    command, the SETUP.md pointer (subject to the second open question), `version: 0.1`, `status: done`,
    and the published artefact verified from a clean directory.

## Risks / things to verify early

- **`/state` may be slower than it looks.** It reads `README.md`, every `STATUS.md` and every
  `PLAN.md` on each request, on a box that is also running agents. Measure it before settling the poll
  interval; if it is slow, the fix belongs on the server (a cache) and is a change outside this
  folder — see the second open question.
- **`available: false` is the likely everyday state.** `IDEAS_REPO_PATH` is set in
  `/etc/idea-agent.env` for the *orchestrator* unit; whether `idea-heartbeat.service` — the process
  that actually serves `/state` — has it in its environment must be checked on the real box first. If
  it does not, the extension shows the server's reason and the fix is a one-line unit change, again
  outside this folder.
- **The nested-shell smoke test writes to the real session if it is careless.** recap.gs's smoke test
  is the model precisely because it is already known to work; reuse its isolation rather than
  reinventing it, and keep it off `$HOME`/dconf.
- **`lock_age_seconds` is the only liveness signal.** A killed cycle leaves a stale lock; `running`
  already accounts for the TTL, so the extension must not second-guess it — but it should show the
  age, because a reading whose age is climbing is the visible symptom of a box that stopped renewing.
- **Living in the queue's own repo is a hazard.** A `git push` from an agent building this idea and
  the orchestrator's own commits are the same repo; keep every change inside `ideas/aideas/` (plus the
  two files the open questions cover) and never touch `README.md`, which is the queue.
- **An extension that polls a host on a VPN can hang the shell's main loop** if the request is
  synchronous. Everything is async with a timeout, and the smoke test checks the shell stays
  responsive while the stub server refuses to answer.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] **When should the button be visible?** The entry says "a button when aideas is running", which
      read literally means it disappears whenever no cycle is active — and with it the blocked and
      ready lists, which are most useful precisely when nothing is running. The plan assumes: visible
      when a cycle is running **or** at least one idea is blocked, hidden otherwise, with an
      "always show" preference. The alternatives are (b) strictly only while a cycle runs, or
      (c) always visible, with the icon carrying the state. Ticking this line as-is chooses the first.
- [ ] **May this work edit `SETUP.md` and `orchestrator/`?** AGENTS.md forbids working outside the
      idea folder, but "the extension must install along with the orchestrator" needs at least a
      pointer in SETUP.md's **Laptop** section, and two of the risks above (a `/state` cache,
      `IDEAS_REPO_PATH` in `idea-heartbeat.service`) would be one-line fixes there. The plan assumes:
      SETUP.md may gain a short subsection, `orchestrator/` is read-only and anything needed there is
      raised as a new question instead. Ticking this line as-is chooses that.
- [ ] **Where does the release come from, with no upstream repo?** AGENTS.md requires a release with
      built artefacts and an install path that compiles nothing, but this idea has no repository of
      its own to release from. The options: (a) tag this repo `aideas-shell-v0.1` and publish the zip
      from a workflow here — which means a second file outside the idea folder,
      `.github/workflows/release-aideas.yml`; (b) publish to extensions.gnome.org and let that be the
      install channel; (c) both, with EGO as the user-facing route and the tag as the reproducible
      one. The plan assumes (a), because EGO review is a multi-week loop and this extension is useless
      to anyone without an orchestrator box of their own. Ticking this line as-is chooses (a).
- [ ] **Should a menu row do anything when clicked?** The plan says no: rows display, and answering a
      blocked idea means editing `PLAN.md` on the box. Cheap alternatives if wanted: open the idea's
      folder on GitHub in a browser, or copy the slug to the clipboard. Ticking this line as-is keeps
      the menu read-only.
