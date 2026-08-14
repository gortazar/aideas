status: done
version: 0.1
started_at: 2026-08-14T15:31:00+02:00
last_session_id: 35386b06-271b-4df6-8da8-1c51dd289449
last_run: 2026-08-14T16:43:29+02:00
last_cycle_cost_usd: 24.169680999999994

## Log
- 2026-08-14T16:43:29+02:00 — done ($24.169680999999994)
- 2026-08-14T16:13:45+02:00 — in_progress ($19.85455449999999)



Difficulty estimate: **medium**, as PLAN.md said. The GNOME Shell side is well-trodden
(`ideas/gnome-tasks` is an in-repo extension with a gjs test harness to copy), and `/state`
already serves exactly what the menu needs. What has to be invented is the packaging: this
idea has no upstream repo, so its flake, CI, installer and release all live here.

## Units
- [x] **U1 — the contract.** `docs/state-contract.md` specifies the `/state` response as a
      versioned surface: the two body shapes, the six always-present row keys, the two
      conditional ones, and the closed five-word `state` vocabulary.
      `tests/test_state_contract.py` makes it true — 24 tests driving
      `orchestrator.queue_rows()` and `heartbeat_server.orchestrator_state()` over fixture
      repositories built on disk (running cycle, stale lock, corrupt lock, blocked idea,
      duplicate slugs, no `PLAN.md`, no `STATUS.md`, empty queue, unset `IDEAS_REPO_PATH`,
      unparseable queue). All green with stock `python3`, no dependencies.
- [x] **U2 — the flake and the skeleton.** `flake.nix` with three checks — `lint` (eslint,
      offline, built-in rules only), `unit` (the headless gjs suite) and `bundle` (the
      assembled extension validated by `tools/check-bundle.js`) — all three green locally
      under `nix flake check`, plus a `packages.default` that produces the release zip.
      `Makefile`, `tests/harness.js` and `tests/run.js` (both from `ideas/gnome-tasks`),
      `metadata.json` for GNOME 46–50, the GSettings schema, an `extension.js` whose
      `disable()` undoes its `enable()`, and `src/lib/duration.js` — the header line's
      wording — with 11 tests. 17 gjs tests green.
      `.github/workflows/ci-aideas.yml` gained a second job for the contract test, and now
      also triggers on changes to `orchestrator/`.
- [x] **U3a — parsing.** `src/lib/state.js` turns a `/state` body into one of four readings —
      `ok`, `unavailable`, `unreachable`, `unconfigured` — with every field either usable or
      null, and never throws. Unknown `state` words keep their own name and are flagged
      `known: false` rather than dropped; duplicate slugs and slugless rows survive; an
      absurd queue is capped at 200 rows with the remainder counted. 31 tests, including a
      body that is JSON but not `/state` (a wrong port), which reports unreachable rather
      than pretending. 48 gjs tests green.
- [x] **U3b — grouping and wording.** `src/lib/menuModel.js` turns a reading into the whole
      menu as data: the header line (`Cycle running for 12 min, 2 agents` / `Idle`, with the
      age of the reading and the lock's last renewal), four sections in glance order
      (Running, Blocked, Ready, Also in the queue) with empty ones omitted, per-row wording
      taken from `note` as served, the `will_run_next` row marked, an empty queue said in a
      sentence, and the failure messages — with `unavailable` and `unreachable` deliberately
      worded apart. When an attempt fails, the last good reading is shown beneath it marked
      stale and dated rather than the menu emptying itself. 36 tests, clock injected. 84 gjs
      tests green.
- [x] **U4 — visibility and the badge.** `src/lib/indicatorModel.js` decides the button as a
      pure function of the reading: visible only while a cycle is running (the answered
      question), with the "always show" preference overriding; six state icons, all stock
      symbolic names so the extension ships no assets; a badge counting agents while running
      and blocked ideas while idle, absent rather than zero; and an accessible name carrying
      the panel's whole meaning. 21 tests. 105 gjs tests green.
- [x] **U5 — the panel button and menu.** `src/lib/menuItems.js` flattens a built menu into
      the exact item sequence, separators and all — a failure message leads, a healthy reading
      leads with the cycle line, empty sections are gone, and `Preferences` is the only item
      that does anything when clicked (rows are read-only, per the answered question). 15
      tests, so menu layout is pinned without a compositor. `src/extension/indicator.js` is
      the `PanelMenu.Button` that walks that list creating one widget per descriptor, with a
      badge, an accessible name and a `destroy()` that disconnects what it connected;
      `stylesheet.css` nudges the Shell's own styling without inventing colours;
      `extension.js` adds it to the panel and redraws on the `always-show` key. 118 gjs tests
      green, and the bundle check caught the one real bug in this unit — extension-side
      imports must be bundle-relative (`./lib/…`), the convention `ideas/gnome-tasks` uses.
- [x] **U6 — the HTTP client.** `src/lib/address.js` turns what someone typed into a URL
      (a pasted `http://box:8787/heartbeat` and a bare `box` both work, IPv6 gets bracketed,
      nothing configured gives null so nothing is polled); `src/lib/backoff.js` stretches the
      interval 30→60→120→240→300 s while unreachable and snaps back on success;
      `src/lib/stateClient.js` owns single-flight (a second read joins the one in the air),
      last-good retention with its timestamp, the failure count, and the HTTP-reply-to-reading
      rules — non-200, non-JSON, empty and oversized bodies each become an unreachable reading
      rather than a throw, and `read()` never rejects. `src/lib/soupTransport.js` is the real
      libsoup 3 transport: async only, with its own cancellable deadline because Soup's timeout
      does not bound a server that accepts and then thinks.
      48 unit tests plus a new **integration suite** (`tests/http`, a fifth flake check) that
      drives the real transport against `tests/stub-state-server.py` on loopback — hermetic in
      the Nix sandbox. It caught both of this unit's real bugs: a GError's `domain` is a numeric
      quark, so string matching never matched and every failure read "the request failed"; and a
      single-threaded stub server makes concurrent requests look like timeouts. 166 unit + 16
      http tests green.
- [x] **U7 — the scheduler, and the extension wired up.** `src/lib/scheduler.js` decides when
      to poll against an injected timer seam: one timer ever (the classic extension leak), the
      next poll scheduled only after the previous one finishes so a slow box cannot accumulate
      requests, 5 s while the menu is open — beating the backoff, since that is when somebody
      is watching it retry — the backoff otherwise, an interval change re-timing what is
      already pending, and nothing at all while suppressed, resuming with an immediate read
      because the reading is as old as the sleep. 28 tests, every wait asserted rather than
      lived through.
      `src/extension/extension.js` now assembles the real thing: transport, client, scheduler,
      indicator and `src/extension/idleWatcher.js` (Mutter's idle monitor), with `disable()`
      undoing all of it. Screen-lock suppression needs no code — the extension declares no
      `session-modes`, so GNOME disables it on lock, which stops the polling outright.
      194 unit + 16 http tests green; five flake checks green.
- [x] **U8 — preferences.** `src/lib/testConnection.js` words the outcome of a test read,
      pure and tested (11 tests): it separates the three failures that need different fixes —
      nothing answered (wrong address, error), something answered but not `/state` (wrong port,
      error), and the box answered saying it cannot read its queue (right address, so a
      *warning* rather than an error) — and on success summarises the queue as proof it is the
      right box, not just a box. `src/extension/prefs.js` is the Adw window: host (a pasted
      heartbeat URL works, since the value is normalised where it is used), port, poll interval,
      "always show the button", and a Test button that uses the same transport, client and
      wording the panel does, so it fails in exactly the ways the panel will. 205 unit + 16 http
      tests green.
- [x] **U9a — the compositor smoke test.** `ci/smoke-test.sh` builds the bundle, starts two
      stub `/state` servers (a running cycle and an idle box), boots a headless GNOME Shell on a
      private bus with the extension and `ci/probe/` installed, and runs `ci/smoke-assertions.py`
      against it: **39 checks, all passing.** It proves in a real Shell what no headless test
      can — the button appears with the right icon, badge and accessible name; the menu opens
      and reads back as the four sections with the orchestrator's own wording; every row is
      inert and Preferences is the only item that reacts; the button *leaves* when the cycle
      stops and "always show" brings it back wearing the blocked icon; a box that goes away
      leaves it up with the unreachable icon and the last good reading dated beneath; five
      enable/disable rounds leave exactly one button; and a disabled extension makes no further
      requests — the stub's request counter is what proves no timer survived. Screenshots in
      `screenshots/`. `ci/nested-shell.sh` comes from `ideas/gnome-tasks`, keeping its dconf
      leak guard.
- [x] **U9b — run against a live orchestrator.** `tools/probe-state.js` reads `/state` with the
      extension's own transport, client and wording modules and prints what "Test connection"
      would say, what the panel would look like, and the whole menu — a real diagnostic, and how
      the connection test is verified end to end without a compositor. Recorded runs:
      * **The live orchestrator serving this repo** (`127.0.0.1:8833`): `[ok] Connected to
        127.0.0.1:8833 — cycle running, 1 agent · 5 ideas queued · 3 ideas blocked`, and the
        menu listed this very cycle (`Running / aideas / v0.1 · running for 14 min`), the three
        blocked ideas with their question counts, and `restore-wss / v0.1 · behind #1`. The
        extension was also run against it inside the nested Shell —
        `screenshots/menu-live-orchestrator.png` is that menu, showing aideas watching itself.
      * **The box `gx10-e7da` over Tailscale** (`100.97.242.26:8787`): `[error] Could not reach
        100.97.242.26:8787 — connection refused`, rendered as the unreachable icon and message.
      * A name that does not resolve: `host not found`. Both failures came back in English on a
        laptop whose GLib speaks Spanish, which is the point of mapping error codes.
      Also verified in the nested Shell: the **preferences window** builds and shows all five
      controls with live values (`screenshots/preferences.png`).
- [x] **U10 — packaging.** `install.sh` (POSIX sh) finds the newest `aideas-shell-v*` release
      through the GitHub API — not `/releases/latest`, which in a repo that releases several
      things would hand back another idea's asset — downloads the zip, verifies its checksum
      when the release published one, refuses anything that is not a valid zip or not this
      uuid, installs it, compiles the schema, enables it, and fills in the box's address from
      `ORCHESTRATOR_HEARTBEAT_URL` when the setting is still empty. It replaces the directory
      wholesale, so a re-run is idempotent and a file dropped in a later version does not
      linger; `--uninstall`, `--zip`, `--url` and `--no-enable` are there too, and a non-GNOME
      session is refused politely.
      `ci/install-test.sh` **runs it, 27 checks**: from a local zip, over HTTP with a checksum,
      through a stubbed releases API, twice for idempotence, with a corrupt artefact, with a zip
      claiming another uuid, and on a faked KDE session — then checks the developer's own dconf
      database did not change.
      `make pack` now zips the validated bundle instead of asking `gnome-extensions pack` to
      assemble it again from different rules (that target was broken: it resolved `--schema`
      against the source directory and never expanded its glob). `nix build` produces the
      byte-identical artefact, and the release job needs only `zip` and `glib-compile-schemas`.
      `.github/workflows/release-aideas.yml` publishes it. `README.md` opens with the install
      command and carries the screenshots; `SETUP.md` gained a **Laptop** subsection pointing at
      it, including the two box-side settings that decide whether `/state` works.

Next: nothing — every unit is done. See **What "done" covers** below.

## What "done" covers

Every feature in `PLAN.md`, each with tests, and all four suites green:

| Suite | What it covers | Count |
| --- | --- | --- |
| `make test-unit` | parsing, grouping, wording, visibility, badge, backoff, scheduler, test-connection | **205** |
| `make test-http` | the real libsoup transport against a stub server on loopback | **16** |
| `make test-contract` | `/state` driven over fixture repositories, keeping the two halves in step | **24** |
| `make smoke` | the extension in a nested headless GNOME Shell, plus screenshots | **39** |
| `make test-install` | `install.sh` executed for real from a clean directory | **27** |
| `nix flake check` | lint, unit, http and the assembled bundle | 4 checks |

| Feature in PLAN.md | Where |
| --- | --- |
| A panel indicator that appears with the work | `src/lib/indicatorModel.js`, `src/extension/indicator.js` — visible only while a cycle runs, six stock symbolic icons, agent/blocked badge |
| A menu grouped by state | `src/lib/menuModel.js`, `menuItems.js` — Running, Blocked, Ready, Also in the queue; empty sections omitted; `will_run_next` marked; read-only rows |
| A header line for the cycle itself | `Cycle running for 12 min, 2 agents` / `Idle`, with the age of the reading and the lock's last renewal |
| Honest failure states | four readings in `src/lib/state.js`; `unavailable` and `unreachable` worded apart; last good reading kept and dated |
| Polling that behaves | `src/lib/scheduler.js` + `backoff.js` + `stateClient.js` — one timer, single-flight, 5 s while the menu is open, backoff to 5 min, nothing while locked or idle |
| A preferences window | `src/extension/prefs.js` — host, port, interval, always-show, and a Test button that names the real fault |
| A documented, tested contract | `docs/state-contract.md` + `tests/test_state_contract.py` |
| Headless GJS tests | `tests/unit/` — 205, no compositor, no network |
| A compositor smoke test | `ci/smoke-test.sh` + `ci/probe/` — 39 checks, screenshots, five enable/disable rounds, and a request counter proving no timer survives a disable |
| Installed with the orchestrator, on the laptop | `install.sh`, verified by `ci/install-test.sh`; pointed at from `SETUP.md`'s Laptop section |
| CI and a release | `.github/workflows/ci-aideas.yml` (contract + flake checks), `release-aideas.yml` (tag, release, asset, checksum) |

**The one thing that finishes itself.** The release for `v0.1` publishes when this work reaches
`main`: `release-aideas.yml` runs on push, reads `version: 0.1` and `status: done` from this
file, and creates the `aideas-shell-v0.1` tag and release itself. It has to work that way —
the orchestrator pushes with a plain `git push`, which does not carry tags, so a tag created in
this worktree would never reach GitHub. An agent may not push this repo, so I could not publish
the release myself, and therefore could not download the *published* asset. What was verified
instead, and is as close as this can get: the artefact `release-aideas.yml` will upload is the
one `make pack` and `nix build` both produce (byte-identical, 32 670 bytes), and `install.sh`
was executed against exactly that zip from a clean directory — over HTTP, with a checksum, and
through a stubbed releases API. If the release has not appeared after this merges, run the
workflow by hand from the Actions tab; nothing else is outstanding.

## Notes for later units

- **One behaviour found while pinning the contract, now documented and tested:** every
  entry of a *running* slug comes back as `running`, not just the first. `queue_rows`
  checks the agent list before the duplicate check and never adds a running slug to its
  seen set. So the Running section must tolerate the same slug appearing twice, and rows
  must be keyed by `position` — `slug` is not unique.
- **`lock_age_seconds` survives a dead cycle** (`running: false`, non-null age), which is
  exactly the signal for a box that stopped renewing. `cycle_started_at` does *not*: it is
  null unless the cycle is live.
- **The contract test is not a flake check, deliberately.** The flake's root is this folder,
  and `tests/test_state_contract.py` imports the orchestrator from two directories up, which
  a flake cannot see. It runs as its own CI job and as `make test-contract`, needing nothing
  but a stock `python3` — which is what it is designed for, since it can then also be run on
  the box itself. PLAN.md said "the contract test through flake.nix"; this is the one
  documented deviation from it.
- **One decision the answered question did not cover, taken in U4:** what the button does
  when a poll fails while a cycle was running a moment ago. Strictly hiding it would blink the
  panel out on every VPN hiccup, and would make the "unreachable" icon PLAN.md lists
  unreachable in practice — it could only ever be seen with "always show" on. So a good
  reading keeps the button up for 5 minutes after contact is lost, wearing the unreachable
  icon and the count it last knew. Still "only while a cycle is running", just not forgetting
  between two readings. A box that answers `available: false` does **not** borrow from the
  past: it is talking to us, and what it says is that it cannot read its queue.
- **Failure reasons must come from GError codes, never messages.** GLib messages are
  localised — on this laptop a refused connection says "Conexión rehusada" — so the transport
  maps `error.matches(Gio.IOErrorEnum, ...)` and `Gio.ResolverError` to fixed English phrases.
  `error.domain` is a *numeric quark* (195 for Gio, 468 for the resolver), not a name.
- **Three things only a real compositor said**, each now fixed and guarded:
  1. A backtick inside a template literal holding D-Bus XML ends the string. `ci/` is now in the
     flake's lint fileset, where eslint reports that in a second — the compositor took a
     four-minute run to say only that the probe never reached the bus.
  2. `St.Label` owns an internal `Clutter.Text` with the same string, so a naive actor walk
     reports every menu label twice.
  3. **Disabling and re-enabling an extension inside one main-loop iteration is not a round.**
     `ExtensionManager`'s bookkeeping ends up out of step with reality and the extension stays
     down with nothing logged. The smoke test drives each half-round as its own call and waits,
     which is what a screen lock and its unlock actually look like.
- **The orchestrator box is not currently serving `/state`.** On `gx10-e7da`,
  `idea-heartbeat.service` and `idea-agent.timer` are both `inactive` and nothing listens on
  8787; the orchestrator that is actually running cycles is on this laptop, serving `/state` on
  **127.0.0.1:8833** (`HEARTBEAT_PORT=8833`, `HEARTBEAT_BIND_IP=127.0.0.1`). So the port
  default of 8787 is right per SETUP.md but will not match this deployment, and the risk
  PLAN.md raised about `IDEAS_REPO_PATH` in the serving unit could not be checked on the box —
  the local server has it set, and `/state` there is `available: true`. Worth a line in
  SETUP.md rather than a change to the extension.
- **A virtual-pointer click could not press a button in the preferences window** (a separate
  Wayland client): motion and press/release spaced across main-loop iterations moved the
  pointer but the window closed rather than activating anything. Dropped rather than left in as
  dead test code — `tools/probe-state.js` verifies that code path headlessly instead, which is
  better anyway because it is also useful to a person diagnosing a real setup.
- The answered open questions settle: the button is visible **only while a cycle is
  running**; this work may edit `SETUP.md` and `orchestrator/`; the release is a tag on
  this repo (`aideas-shell-v0.1`) published by `.github/workflows/release-aideas.yml`; menu
  rows stay read-only.
