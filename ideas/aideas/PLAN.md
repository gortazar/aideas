# Plan: aideas — two buttons, and the extension's first write

Difficulty estimate: medium — "check now" is half a day of plumbing over machinery that already
exists (`PollScheduler.pollNow()` was written for exactly this), but "run a cycle" makes the
extension *write* for the first time: a new authenticated endpoint that spends real money, whose
launch path differs between the box and the laptop, and whose failure modes are environmental and
therefore invisible to every headless test.

## Context

The entry asks for two menu buttons. They look symmetrical and are not: one is local and cheap,
the other crosses a boundary this extension has never crossed.

1. **Re-check the status on demand.** The panel polls `/state` every 30 s, or every 5 s while the
   menu is open (`scheduler.js:24`), backing off to 5 minutes while the box keeps failing
   (`backoff.js`). Three situations make waiting for the next tick annoying: the box was down and
   the poller is deep in its backoff; you just answered a question in a `PLAN.md` and want to see
   the idea go `ready`; you just started a cycle from the other button. The scheduler already has
   the entry point — `pollNow()`, commented "what a *refresh* action would call"
   (`scheduler.js:132`) — so what is missing is a menu item, an in-flight state to show while the
   request is in the air, and a *visible* answer, because a refresh that changes nothing on screen
   is indistinguishable from a refresh that did nothing.

2. **Run a cycle.** Today a cycle starts one of three ways, none of them from the panel: the
   5-minute `idea-orchestrator.timer` on the box, `systemctl start idea-orchestrator.service`
   (`SETUP.md:87`), or a detached `python3 orchestrator.py` by hand, which is how the orchestrator
   that actually runs in this deployment is launched (`.claude/skills/run-orchestrator/SKILL.md:43`).
   `/state` is read-only and `docs/state-contract.md:3` opens by saying it "is the only thing the
   aideas panel indicator reads". A button changes that sentence: the extension gains a write, to
   an endpoint that does not exist yet, on the only process the laptop can already reach
   (`heartbeat_server.py`).

Three things about that write are load-bearing, and each shapes a feature below:

- **A cycle refuses to start far more often than it starts.** In order: the stop file,
  `allowed_hours`, `max_daily_cost_usd` against today's usage log, the heartbeat gate, the lock
  (`orchestrator.py:1449-1458`). Every one of those returns `0` — success, silently. A button
  whose entire visible effect is "nothing happened, and the panel still says Idle" is worse than no
  button, so the endpoint has to answer *why*, and the menu has to say it.
- **The heartbeat gate fails closed, and it is about this very laptop.** `laptop_is_idle()`
  (`orchestrator.py:704`) asks the heartbeat server whether a Claude Code session is active and
  skips the cycle if it cannot tell. So the honest answer to a click may well be "not while you
  have a Claude Code session open", which is a sentence the menu should be able to show.
- **A spawned cycle inherits the spawner's environment, and the heartbeat server's is wrong for
  it.** `idea-orchestrator.service` exists mostly to set that environment: a `PATH` carrying
  `claude` and `nix`, `ProtectHome` off for `~/.claude` and the SSH key, `KillMode=mixed`,
  `TimeoutStartSec=3600` (`orchestrator/systemd/idea-orchestrator.service`). The heartbeat unit is
  the opposite — `ProtectSystem=strict`, `ProtectHome=yes`, `MemoryMax=128M`, no `PATH` — so a
  cycle `fork()`ed from inside it would start, find no `claude`, and fail every agent. This is the
  same shape as the bug 0.2 existed to fix (`gjs` missing on the runner): the thing launched fine,
  in an environment that could not do the work. The launch must therefore be a *configured
  command* that a deployment owns, not a hard-coded `Popen` that happens to work here.

Assumptions, stated rather than asked:

- **This is version 0.4**, a minor entry: `STATUS.md`, `src/extension/metadata.json`
  (`version-name`) and `flake.nix` (`packages.default.version`), which the release workflow
  asserts are one string.
- **This work may edit `orchestrator/heartbeat_server.py`, `orchestrator/orchestrator.py`,
  `docs/state-contract.md` and `SETUP.md`**, under the grant recorded in `plans/01-2026-08-17.md`
  and used again in 0.2 and 0.3. The systemd units are read but **not** relaxed — see the fourth
  open question. Everything else stays inside `ideas/aideas/`. The root `README.md` is the queue
  and is never touched.
- **Both buttons live in the menu, not in the panel.** One panel button, one click, then the
  actions — the top bar is not the place for a second icon.
- **No stop button this entry.** The asymmetry is deliberate: stopping is `touch .orchestrator/stop`
  and is a *pause* that stays until removed (`SKILL.md:56-63`), which is a state the menu would then
  have to own. The entry asks for two buttons; this plan ships two.
- **Rows stay read-only.** The v0.1 answered question is about idea rows, and it holds: nothing here
  makes a row clickable. `menuItems.js:9-11` says "the only item that does anything when clicked is
  `preferences`" — that comment becomes a list of three.
- **The contract only grows.** `/state` is untouched. `/cycle` is a new path; a box that does not
  serve it answers 404, and the extension must read that as "this box is older than this
  extension" rather than as a failure of the click.

## Features

- **A "Check now" item that reports what it did.** A reactive item in its own block above
  Preferences. Clicking it calls `PollScheduler.pollNow()`, which already cancels the pending
  timer, single-flights against a poll in the air, and reschedules from the new reading — so a
  click also *resets the backoff*, which is the main reason to want it after the box has been down.
  While the request is out the item reads `Checking…` and is insensitive; when it lands the header's
  own `updated 2 s ago` is the answer, and if it failed the failure message appears where failures
  always appear. **The menu stays open** across the click: closing it would hide the very line the
  click was for.
- **A "Run a cycle" item that either starts one or says why not.** Same block. It `POST`s to the
  new endpoint and shows the outcome inline: `Cycle starting…` while the request is out, then
  either the cycle appearing in the header within seconds, or one line saying what refused it —
  `Paused: .orchestrator/stop exists`, `Outside allowed_hours (23:00-08:00 Europe/Madrid)`,
  `Daily budget spent ($12.40 of $10.00)`, `A Claude Code session is active on this laptop`,
  `A cycle is already running`. Those are the orchestrator's own gates, in the orchestrator's own
  order, worded for someone reading a menu.
- **The item is insensitive when clicking it could not possibly work**, with the reason as its
  detail line: while a cycle is running (the header already says so), while the reading is
  `unreachable` or `unconfigured` (there is nothing to post to), and while a post of its own is in
  flight. An `unavailable` box is *reachable*, so the item stays live there — a box that cannot read
  its queue can still be told to try a cycle, and the answer will be honest either way.
- **`POST /cycle`, which decides before it spawns.** New in `heartbeat_server.py`. It runs the same
  gates `Orchestrator.run()` runs, from **one implementation in `orchestrator.py`** (a
  `cycle_preflight(repo)` that the run path also calls, so the two cannot drift), and only spawns
  when they all pass. The response is small and total:
  `{"started": true, "reason": null}` or `{"started": false, "reason": "…", "gate": "stop-file"}`.
  `started: true` means *launched*, never *finished*: the cycle re-checks its own gates and may
  still exit, so the extension confirms by watching `/state` rather than by believing the reply.
- **The preflight never talks to itself over HTTP.** `laptop_is_idle()` reaches the heartbeat server
  by URL (`orchestrator.py:709`), and `heartbeat_server.py` is a single-threaded `HTTPServer` — a
  handler that called it would block on its own socket, time out after 3 s and fail closed, so the
  button would report "can't tell whether the laptop is busy" *every single time*. The preflight
  reads the heartbeat state file directly instead, which is the same data from the same place
  (`load_state()` is already in that file) and needs no second thread.
- **The launch command belongs to the deployment.** The server spawns
  `ORCHESTRATOR_CYCLE_COMMAND` if it is set, and otherwise a detached
  `python3 orchestrator.py run` (`start_new_session=True`, output to the journal, environment
  explicit) — which is exactly how a cycle is launched in this deployment today. A box running the
  hardened heartbeat unit sets the variable to `systemctl start idea-orchestrator.service` (or its
  `--user` form) so that systemd, not the sandboxed server, provides the cycle's `PATH`, its home
  directory and its timeouts. `SETUP.md` gets both forms and the reason.
- **The endpoint refuses to run a cycle it knows will fail on `claude`.** Before spawning the
  default command, the preflight resolves the `claude` binary on the `PATH` the child would get,
  and refuses with `claude is not on the orchestrator's PATH` if it is not there. A cycle that
  starts and fails every agent costs a real cycle's worth of time and says nothing; this is the
  cheapest possible guard against the exact failure 0.2 was about.
- **The write is authenticated the way this system already authenticates writes.**
  `POST /cycle` checks `HEARTBEAT_SHARED_SECRET` through the existing `_authorized()` path, the
  secret travelling in the JSON body as `POST /heartbeat`'s already does. The extension gains an
  `orchestrator-secret` GSettings key and a password-style field in preferences; when the box has
  no secret configured it behaves as `/heartbeat` does today and accepts — subject to the first
  open question, which is the one place this plan does not assume.
- **A rate limit, because a panel is a thing that can get stuck.** The endpoint refuses a second
  launch within a short window (`cycle just launched, wait 30 s`) and the extension refuses to have
  two posts outstanding. The lock already makes a duplicate cycle harmless on the box; this keeps a
  double-click, or a wedged extension, from filling the journal with launches.
- **Both buttons are model decisions, not widget decisions.** `menuItems.js` gains `action` items
  carrying `action`, `label`, `detail` and `sensitive`; `menuModel.js` decides their wording and
  sensitivity from the reading, the in-flight state and the last action outcome; `indicator.js`
  gains one widget case that wires `activate` to a callback. So "the item is insensitive while a
  cycle runs" and "the refusal reason shows under the item" are assertions about whole menus in a
  headless test, exactly as every other menu behaviour is.
- **Transport learns to POST, and stays as paranoid as it is about GET.** `soupTransport.js` gains a
  method with a body and the same two deadlines, and a `cycleClient.js` maps the outcome to fixed
  English phrases from `GError` codes and HTTP statuses — never from GLib messages, which are
  localised. `404` is worded as its own case (`this box does not support starting cycles`), because
  that is what an un-updated box looks like and it is not the user's mistake.
- **A cycle that was asked for and did not appear is said out loud.** After a successful post the
  extension polls briskly for a bounded window and, if `/state` never reports `running: true`,
  shows `The cycle exited without starting — check the journal on the box`. This is the honest
  reading of `started: true` and it is also the only way the user learns about a refusal the
  preflight could not predict.
- **The contract documents the second endpoint.** `docs/state-contract.md` stops being "the `/state`
  contract" in scope: it gains a `POST /cycle` section — request shape, the response's two fields,
  the gate vocabulary, the 401/404/429 statuses, the rate limit — and its opening sentence is
  corrected, since the extension now writes. `tests/test_state_contract.py` covers the preflight
  over fixture repositories: a stop file present, an hour outside the window, a spent budget, a held
  lock, a fresh heartbeat, and the all-clear — pure Python, no spawn, no network.
- **Nothing spawns in a test.** The spawn is one injected callable in `heartbeat_server.py`, so the
  contract tests assert *that a launch was requested with the right command and environment*, and
  the one real spawn is exercised by hand against this repo's own orchestrator and recorded in
  `STATUS.md`.
- **Verified where it has to be.** The smoke test's stub server (`tests/stub-state-server.py`) gains
  `POST /cycle` and a request log; the nested-shell test activates both items in a real GNOME Shell
  and asserts the request arrived, the menu stayed open, the item went insensitive and the refusal
  line rendered — plus screenshots of the two new items, live and insensitive.

## Approach

Units, each one commit, tests first:

1. **U1 — the preflight, in `orchestrator.py`.** `cycle_preflight(repo)` returning a gate name and a
   sentence, factored out of `run()` so the run path calls it too and the two orders cannot drift.
   No HTTP: the heartbeat is read from its state file. Contract tests over fixture repositories.
2. **U2 — `POST /cycle`.** Authorisation through the existing path, the preflight, the injected
   spawn, the rate limit, the response shape. `docs/state-contract.md` in the same commit. Still
   nothing in the extension: the endpoint must be right before anything calls it.
3. **U3 — POST in the transport.** `soupTransport.js` grows a body and a method; `cycleClient.js`
   maps codes and statuses to phrases; `tests/http` covers 200 both ways, 401, 404, 429, a
   non-JSON body, a timeout and a refused connection against the stub server.
4. **U4 — the items, as data.** `menuItems.js` action items, `menuModel.js` wording and
   sensitivity, unit tests comparing whole menus: idle, running, unreachable, unconfigured,
   in-flight, and each refusal reason.
5. **U5 — the widgets.** `indicator.js`'s action case, keeping the menu open on activate, wiring
   `pollNow()` and the cycle post; `prefs.js` and the schema gain the secret.
6. **U6 — the compositor.** Activating both items in the nested shell against the stub, asserting
   the requests, the insensitive states and the rendered refusal; screenshots. The unit that can
   fail in a way no other can.
7. **U7 — the bump and the docs.** 0.4 in the three files, `README.md` on what the two items do and
   what the secret is for, `SETUP.md` on `ORCHESTRATOR_CYCLE_COMMAND` and the sandbox, and
   `STATUS.md` recording what was run and what it printed — including one real cycle launched from
   the panel, which is this entry's only end-to-end proof.

## Risks / things to verify early

- **The sandbox is the whole risk of this entry.** A cycle spawned from inside
  `idea-heartbeat.service` inherits `ProtectHome=yes`, no `claude` on `PATH` and a 128 MB memory
  cap. Nothing headless can see this, and the failure looks like "the cycle ran and everything
  broke". The configured command plus the `claude`-on-`PATH` check are the mitigation; the
  documentation is the rest of it.
- **The self-HTTP deadlock is real and silent.** Settle U1's "read the state file, never call
  yourself" before anything else, and add the test that would have caught it: a preflight that
  passes the heartbeat gate while no server is listening at all.
- **A menu item that closes the menu makes both buttons useless.** GNOME's default is for an
  activated item to dismiss the popup; both of these exist to show what happened. Verify the
  keep-open path in U5 and in the compositor, not by reading the docs.
- **Activating an item from the probe may not work.** v0.1 could not press a button in the
  *preferences* window because that is a separate Wayland client; a menu item lives in the shell's
  own process, so the probe should be able to activate it directly. If it cannot, the fallback is to
  assert the item's presence, label and sensitivity from the actor tree and cover activation
  headlessly — but that would leave the click itself unproven, so it is worth finding out in U6's
  first hour.
- **This button spends money.** Wording matters more than usual: `Run a cycle` must not look like
  `Refresh`, and the two items should not sit adjacent without the running/insensitive state being
  obvious. The screenshots are the check.
- **An unauthenticated write on the VPN is a different security posture from an unauthenticated
  read.** Reading the queue and spending the day's Claude budget are not the same exposure, even on
  the same socket. The first open question is exactly this and nothing in U2 is written until it
  is answered.
- **A secret in GSettings is readable by anything in the user's session.** It is the same secret the
  laptop's heartbeat hook already holds in its environment, so this adds no new class of exposure —
  but it is worth one honest line in `README.md` rather than a claim of secrecy.
- **Old box, new extension and the reverse.** A box without `/cycle` must produce a clear sentence,
  not a broken menu; an old extension against a new box simply never posts. Both directions get a
  test.
- **Do not touch the root `README.md`**, and keep the orchestrator edits to the files named in the
  assumptions.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] **Should `POST /cycle` accept a request when no `HEARTBEAT_SHARED_SECRET` is configured?**
      `POST /heartbeat` does — `_authorized()` returns true when the secret is empty
      (`heartbeat_server.py:97-100`) — and this deployment runs without one, so the plan assumes
      `/cycle` behaves identically: authenticated when a secret is set, open when it is not.
      Ticking this line unchanged chooses that. The alternative is to fail closed on this one path
      (refuse with `no shared secret is configured on the box` until one is set), on the grounds
      that starting a paid cycle is a bigger deal than recording a heartbeat, at the cost of the
      button not working in the current setup until `HEARTBEAT_SHARED_SECRET` is added to the
      heartbeat server's environment and to the extension's preferences.
- [ ] **Should "Run a cycle" be able to override the gates?** The plan assumes **not**: the button
      asks for a cycle under exactly the rules a timer-fired cycle obeys, and its whole value when
      refused is naming the gate — so a cycle outside `allowed_hours`, over budget, or with a
      Claude Code session open on the laptop is reported, not forced. The alternative is a second,
      deliberately awkward action (a `Run anyway` item that appears only after a refusal, or a
      modifier-click) that skips the hours and heartbeat gates but never the stop file, the budget
      or the lock. That is a real convenience — "I am at the laptop, I want it to build now" is the
      likeliest reason to click at all — and a real way to spend money outside the window that was
      set on purpose.
- [ ] **Should clicking "Run a cycle" ask for confirmation first?** The plan assumes one click
      starts it, with the running state and the outcome line as the feedback, because that is the
      GNOME idiom and a confirmation dialogue from a panel menu is heavy. The alternative is a
      two-step in the menu itself — the item becoming `Really run a cycle?` for a few seconds
      before it will fire — which costs one click and removes the mis-click that launches a cycle
      and up to `max_cycle_cost_usd` per agent.
- [ ] **May this entry change `orchestrator/systemd/idea-heartbeat.service`?** The plan assumes
      **no**: the units are read, not relaxed, and the box instead sets
      `ORCHESTRATOR_CYCLE_COMMAND` to a `systemctl start idea-orchestrator.service` so systemd
      supplies the cycle's environment — which means a non-root service user needs a polkit rule or
      the `--user` units, and `SETUP.md` will say so. The alternative is to make the heartbeat unit
      able to spawn cycles itself (`ProtectHome` off, a `PATH` with `claude`, a higher memory cap),
      which makes the button work out of the box on a fresh install and widens the sandbox of the
      one process that listens on the network.
