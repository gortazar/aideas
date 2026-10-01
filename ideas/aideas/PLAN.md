# Plan: aideas — stop a cycle, and open the queue where ideas are written

Difficulty estimate: medium — one of the three buttons already exists, and the second (open the
README in codium) is a dozen lines of `Gio.Subprocess`; the cost is in the third, because "stop the
cycle" is the stop *file*, which is a pause switch that stays until removed, so the extension has to
own a state it has never shown (`Paused`), a second write endpoint, and a wind-down that takes
minutes and looks like nothing happening.

## Context

The entry asks for three buttons:

> Add a button to start a new cycle. Add another button to open codium with the readme so that new
> ideas can be added. Add a button to stop the cycle.

**The first one shipped in 0.4.** `Run a cycle` is in the menu today, with `POST /cycle`, the shared
preflight, the gate vocabulary, the rate limit and `Run anyway`
(`src/lib/menuModel.js:217-270`, `orchestrator/heartbeat_server.py:149`). This entry does not rebuild
it; it adds the two that are missing and makes the three read as one block rather than as three
accretions. Where the existing item has to change at all, it is because a queue that can be *paused*
makes `Run a cycle` say something new — see the `stop-file` gate below.

The two new ones are not symmetrical either:

1. **Open codium with the README.** The queue is `README.md` at the root of this repository, and
   adding an idea means typing a numbered entry under `## Ideas`. Everything about this button is
   *local* to the laptop: it launches an editor on this machine, on a file on this machine. That is
   a different axis from everything the extension has done so far, all of which went over HTTP to a
   box that may not be this computer. The extension therefore has to learn where the repository is
   on *this* machine, and to be honest when it does not know — an editor that silently opens the
   wrong checkout loses the idea you just wrote.

2. **Stop the cycle.** There is exactly one supported way to stop one, and it is a file:

   ```bash
   touch "$IDEAS_REPO_PATH/.orchestrator/stop"    # winds down gracefully, still commits
   rm    "$IDEAS_REPO_PATH/.orchestrator/stop"    # resume — it is a pause switch, not one-shot
   ```

   (`.claude/skills/run-orchestrator/SKILL.md:53-63`.) Three properties of that file shape this
   whole entry:

   - **It is a pause, not a kill.** `stop_requested()` (`orchestrator.py:688-700`) is polled between
     phases and between agents; it sets `stop_reason` once, the cycle winds agents down with
     `agent_grace_seconds`, and it still commits, merges and pushes. So "stopped" is not instant and
     is not violent, and the button must not promise otherwise.
   - **Nothing ever removes it.** No code path in `orchestrator/` deletes the stop file; the only
     writer is a person, and `orchestrator.py status` says
     `PAUSED … remove it to resume` (`orchestrator.py:2199`). A button that creates it and walks
     away pauses the fleet for ever, which reads as "the orchestrator is broken" — the exact failure
     the skill warns about. Whatever this button does, the panel must afterwards *show* that the
     queue is paused and offer the way out.
   - **The panel cannot currently see it.** `GET /state` returns `available`, `running`, `agents`,
     `cycle_started_at`, `lock_age_seconds`, `ideas` and says outright that "nothing about budget,
     schedule or the stop file" is returned (`docs/state-contract.md:79-80`). The preflight knows —
     it refuses with gate `stop-file` and `Paused: .orchestrator/stop exists`
     (`orchestrator.py:2085-2087`) — but that is only visible after you have clicked something. The
     contract has to grow one field.

Assumptions, stated rather than asked:

- **This is version 0.5**, a minor entry. The `README.md` entry does not say which kind of update it
  is, so `AGENTS.md` makes it minor; noted here and in `STATUS.md` as an assumption. Three files
  carry the version and the release workflow asserts they are one string: `STATUS.md`,
  `src/extension/metadata.json` (`version-name`) and `flake.nix` (`packages.default.version`).
- **aideas stays in this repository.** Its original entry says "This project must be done within
  this repo. Do not create an external repo for this", so the submodule layout `AGENTS.md`
  describes does not apply here, and no `upstream/` is created. Releases come from
  `.github/workflows/release-aideas.yml`, which tags itself on merge and is verified afterwards with
  `make check-release`.
- **This work may edit `orchestrator/heartbeat_server.py`, `orchestrator/orchestrator.py`,
  `docs/state-contract.md` and `SETUP.md`**, under the grant recorded in `plans/01-2026-08-17.md`
  and used in every entry since. The systemd units are read, not relaxed. The root `README.md` is
  the queue and is never edited by this work — the whole point of the codium button is that a
  *person* edits it.
- **`Run a cycle` keeps its behaviour.** Its answered questions still hold: open when the box has no
  secret, one click, `Run anyway` after a refusal at `allowed-hours` or `heartbeat` only, never at
  `stop-file`, `budget` or `lock`. A paused queue refuses at `stop-file`, and that refusal must
  continue **not** to be overridable — the way to run a cycle while paused is to resume, visibly.
- **Three items, one block, in the order start / stop / open.** They live in the existing action
  block above Preferences, with `Check now` first as it is today. No second panel icon.
- **Rows stay read-only** (the v0.1 answered question). Nothing here makes an idea row clickable.
- **The contract only grows.** `/state` gains one key; `/stop` is a new path, and a box that does
  not serve it answers 404, which the extension reads as "this box is older than this extension"
  rather than as a failure of the click, exactly as `/cycle` already does.

## Features

- **A "Stop the cycle" item that winds the current cycle down.** In the action block, beneath
  `Run a cycle`. It `POST`s to a new endpoint which creates `.orchestrator/stop`, and it reads
  `Stopping…` until `/state` reports `running: false` — the wind-down takes as long as the agents
  take to reach their next check, so an item that flicked back to idle immediately would be lying.
  When no cycle is running the same item is `Pause the queue`: the file does the same thing, but
  what it stops is the *next* cycle, and the label should say which of the two just happened.
- **A "Resume" item, because the stop file is a pause switch.** While `.orchestrator/stop` exists
  the menu shows `Paused — .orchestrator/stop exists` and the stop item is replaced by
  `Resume the queue`, which removes the file. This is the half that keeps the button from being a
  trap: nothing in the orchestrator ever deletes that file, so the panel that created it is the
  right place to offer its removal.
- **The panel says `Paused` without being clicked.** `GET /state` gains `paused` (bool) — the one
  fact the panel cannot deduce and the one the preflight already reads. The header line becomes
  `Idle — paused` / `Cycle running for 12 min, 2 agents — stopping`, and `Run a cycle` goes
  insensitive with `the queue is paused` beneath it rather than being clicked to find out.
- **`POST /stop`, and its `resume`.** New in `heartbeat_server.py`, next to `/cycle` and sharing its
  authorisation (`_authorized()`, the secret in the JSON body, open when the box has none) and its
  answer shape: `{"paused": true|false, "changed": bool, "reason": "…"}`. `changed: false` with a
  reason is how "it was already paused" comes back — a 200, not an error, as with the gates.
  The file write itself is one function in `orchestrator.py` (`set_paused(repo, paused)`), so the
  server never builds that path by hand and the test suite can assert the file, not the string.
- **Stopping is a write about *safety*, so it is never rate-limited into uselessness.** `/cycle`'s
  30 s limit exists because a launch costs money; a second stop costs nothing and the one situation
  where someone hammers the button is the one where they most want it to work. `/stop` is
  idempotent and unlimited; `resume` is the same call with `{"resume": true}`.
- **An "Add an idea" item that opens the queue in codium.** Third in the block. It launches the
  editor on the repository with `README.md` open **at the end of the `## Ideas` list**, which is
  where a new entry goes — `codium <repo> --goto <repo>/README.md:<line>`, the line found by reading
  the local file for the last entry before `## Finished`. Opening at line 1 would be correct and
  useless.
- **The extension learns where the repository is, and says so when it does not.** A new
  `repo-path` GSettings key and a preferences field, empty by default. The item is insensitive with
  `set the repository path in preferences` when it is empty, and with `<path>/README.md does not
  exist` when the path is wrong — never a silent no-op, and never a guess at `~/aideas`. The menu
  item's detail line names the path it will open, so opening the wrong checkout is a thing you can
  see before you click rather than after you have typed an idea into it.
- **codium is found, not assumed.** An `editor-command` key, empty by default, meaning "look for
  one": `codium`, then `vscodium`, then the Flatpak `com.vscodium.codium`. If none is found the item
  is insensitive and says so, naming the preference that fixes it. Set the key and it is used
  verbatim (`shlex`-style splitting, the repo and the file appended), which is also how someone who
  wants a different editor gets one without this plan inventing an editor-agnostic abstraction.
- **The launch is a `Gio.Subprocess`, detached and unwatched.** The editor outlives the menu; the
  extension neither waits for it nor keeps a handle. A failure to spawn is reported in the item's
  detail line from the `GError` code, never from its message — GLib messages are localised, which
  this extension has been careful about since v0.1 and which `soupTransport.js` documents.
- **Every one of the three items is a model decision, not a widget decision.** `menuModel.js` grows
  the stop/resume/open cases with their labels, detail lines and sensitivity; `menuItems.js` emits
  them as `action` items; `indicator.js` gains no new widget type — the `action` case from 0.4
  already replaces the item's `activate` *method* so that **the menu stays open**, which matters
  more here than it did for `Run a cycle`: `Stopping…` is the whole feedback.
- **A stop that did not take is said out loud.** After a successful `POST /stop` the extension polls
  briskly for a bounded window; if `/state` still reports `running: true` when it expires the item
  says `Still winding down — agents finish their step first`, which is the truth rather than a
  timeout dressed as a failure. The file is on disk either way, and the header keeps saying
  `Paused`.
- **The contract documents all of it.** `docs/state-contract.md` gains `paused` in the `/state`
  body and a `POST /stop` section — request shape, response fields, statuses, idempotency, and the
  sentence that the stop file persists across cycles and across reboots.
  `tests/test_state_contract.py` covers `paused` over fixture repositories, and a new
  `tests/test_stop_endpoint.py` covers the endpoint with the filesystem, asserting the file is
  created, removed, idempotent in both directions and refused without the secret when one is set.
- **Verified where it has to be.** The smoke test's stub server gains `POST /stop` and `paused` in
  `/state`; the nested-shell test activates the stop item, asserts the request, the `Stopping…`
  label, the menu staying open, the `Paused` header on the next reading and the `Resume` item
  replacing the stop item — plus a screenshot of the paused menu. The codium item is activated
  against a stub editor script on `PATH`, asserting the argv it was given, since a real VSCodium
  cannot be installed into a nested headless shell.

## Approach

Units, each one commit, tests first:

1. **U1 — `paused` in `/state`.** `orchestrator_state()` reports it; `docs/state-contract.md` and
   `tests/test_state_contract.py` in the same commit; `state.js` carries it into the reading, with
   an old box (no key) reading as `false`. Nothing visible yet.
2. **U2 — `set_paused()` and `POST /stop`.** The file write in `orchestrator.py`, the endpoint in
   `heartbeat_server.py` on the existing authorisation path, the response shape, idempotency both
   ways, 404 for an unknown path. `tests/test_stop_endpoint.py`. Contract section in the same
   commit.
3. **U3 — the client.** `stopClient.js` beside `cycleClient.js`, sharing `soupTransport.post()`:
   one attempt to `{paused, changed, reason}`, never rejecting, refusing two outstanding posts,
   and the same code-to-phrase mapping including 404 as `this box does not support stopping
   cycles`. `tests/http` against the stub in six modes.
4. **U4 — the stop/resume item, as data.** `menuModel.js` decides the label from `paused` and
   `running`, the detail from the in-flight state and the last outcome, the sensitivity; the header
   gains `— paused` and `— stopping`; `Run a cycle` goes insensitive while paused, with
   `Run anyway` asserted absent at the `stop-file` gate. Unit tests comparing whole menus.
5. **U5 — the wiring for stop.** `extension.js` connects the item to the client, keeps the
   in-flight state, polls briskly after a stop and produces the "still winding down" sentence.
6. **U6 — the editor launcher.** `editorLauncher.js`: discovery, argv construction, the README line
   for the end of `## Ideas`, and the failure phrases — pure enough to unit-test with an injected
   "does this binary exist" and an injected spawn, so nothing launches in a test. `repo-path` and
   `editor-command` in the schema and `prefs.js`.
7. **U7 — the compositor.** Stop, resume and open activated in the nested shell against the stub
   server and a stub editor on `PATH`; the paused header; screenshots.
8. **U8 — the bump and the docs.** 0.5 in the three files, `README.md` on what the three items do
   and on the two new preferences, `SETUP.md` on the stop file as a pause the panel can now both set
   and clear, and `STATUS.md` recording what was run and what it printed — including one real stop
   and resume against this repository's own orchestrator.

## Risks / things to verify early

- **The pause outliving its click is the real hazard of this entry.** The failure mode is not a
  crash: it is a fleet that quietly builds nothing for a week because a button created a file and
  nothing ever showed it again. `paused` in `/state` (U1) is therefore the *first* unit, not a
  decoration on the last one, and the panel must show the state even with the menu closed.
- **`Stopping…` has no upper bound that this extension controls.** An agent is checked between
  phases and between agents, and `agent_grace_seconds` follows the SIGTERM; a cycle can legitimately
  take minutes to wind down. Decide the brisk-polling window against `.agent-config.yml`'s actual
  values rather than picking 45 s because `/cycle` did.
- **Resuming does not revive the cycle you stopped.** `request_stop()` sets `stop_reason` once and
  `stop_requested()` stays true for the life of that process, so removing the file mid-wind-down
  lets the *next* cycle start and does not call the current one back. The wording must not imply
  otherwise; the smoke test should cover stop-then-resume-while-running so the sentence is asserted.
- **A local write from an extension is a new class of action.** Everything before this went over
  HTTP; `editorLauncher.js` spawns a process in the user's session. Keep it to the configured or
  discovered argv with no shell, and never interpolate the repo path into a string that a shell
  will parse.
- **The repository the panel opens may not be the repository the box builds.** If the orchestrator
  is on another machine, `repo-path` points at a clone whose `README.md` may be behind, and an idea
  typed into a stale checkout is an idea that reaches nobody. The detail line naming the path is the
  cheap mitigation; the second open question asks whether more is wanted.
- **`codium` may be a Flatpak, and a Flatpak's file arguments are sandboxed.** `--goto` on a path
  outside the Flatpak's permitted filesystem can open an empty window. Verify against whatever this
  laptop actually has before the smoke test is written, and if the Flatpak form cannot open the file
  reliably, say so in `README.md` rather than shipping a button that opens a blank editor.
- **An unauthenticated stop is a cheap denial of service on the VPN.** It is the same socket and the
  same posture as `/cycle`, whose answered question chose "open when no secret is configured", and
  pausing is reversible where spending is not — but it is worth one honest line in `README.md`
  rather than silence.
- **Old box, new extension and the reverse.** A box without `/stop` or without `paused` must produce
  a clear sentence and a menu that still works; an old extension against a new box simply never
  posts. Both directions get a test.
- **Nothing outside `ideas/aideas/`, `orchestrator/` and `SETUP.md`.** In particular the root
  `README.md` is not edited by this work.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **Should "stop" leave the queue paused until someone resumes it, or only stop the cycle that
      is running?** The plan assumes the first, because that is what the stop file *is*: a pause
      switch nothing ever clears, so the button creates it, the panel then shows `Paused` and offers
      `Resume the queue`. The alternative is a one-shot stop — the extension creates the file, waits
      for `running: false`, and removes it again — which matches the words "stop the cycle" more
      literally and needs no resume item, at the cost of a panel that must stay alive through the
      wind-down to clean up after itself (a screen lock, a logout or a crash mid-wind-down would
      leave the fleet paused with nothing on screen saying so), and of losing the ability to pause
      the queue while nothing is running at all.
- [x] **When the orchestrator is on another machine, should "Add an idea" still open the local
      checkout?** The plan assumes yes, with the path named in the menu item so it is visible before
      the click: the extension has no way to edit a file on the box, and a local clone is what a
      person would edit anyway before pushing. The alternative is to make the item insensitive
      unless the configured host is this machine (`localhost`, `127.0.0.1` or this host's own
      address) — safer against typing an idea into a stale clone that never gets pushed, and it
      disables the button entirely in the deployment where the box is remote, which is the one
      `SETUP.md` describes as normal.
- [x] **Should a paused queue change the panel icon, or only the menu?** The plan assumes the menu
      only: the header reads `Idle — paused`, the items say the rest, and no new artwork ships. The
      alternative is a fifth bulb — 0.3 shipped four symbolic bulbs and an `allBlocked` variant
      precisely so that a state worth noticing is visible without opening the menu, and "paused"
      is arguably that state — at the cost of a new SVG on the 16px grid, its recolouring verified
      in a real compositor, and one more icon to tell apart at panel size from the struck-through
      all-blocked bulb it would resemble.
