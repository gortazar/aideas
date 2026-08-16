status: in_progress
version: 0.1
started_at: 2026-08-14T15:31:00+02:00
last_session_id: 35386b06-271b-4df6-8da8-1c51dd289449
last_run: 2026-08-14T16:43:29+02:00
last_cycle_cost_usd: 24.169680999999994

## Log
- 2026-08-14T16:43:29+02:00 — done ($24.169680999999994)
- 2026-08-14T16:13:45+02:00 — in_progress ($19.85455449999999)



Difficulty estimate: **medium**, as PLAN.md said — the change is small, but the thing being
built can only be fully exercised by a push to `main`, which is exactly how the v0.1 workflow
shipped broken and stayed broken for two days without anyone being told.

## This entry (0.2) — a release workflow that actually publishes

- [x] **U1 — a reproducible pack.** `make pack` now fixes all three sources of variation: it
      stamps every file with `SOURCE_DATE_EPOCH` (defaulting to 315532800, the zip epoch and
      what nixpkgs' stdenv exports), feeds `zip` a `LC_ALL=C sort`ed file list instead of
      letting `zip -r` walk readdir order, and passes `-X -D` so no uid, gid, extended
      timestamp or directory entry is stored. `ci/pack-test.sh` (6 checks) packs twice from a
      clean build and asserts one SHA-256, asserts the stored date is the epoch and the entry
      order is sorted, asserts a different `SOURCE_DATE_EPOCH` really changes the artefact, and
      compares `make pack` against `nix build`.
      It caught what it was written for, and then two more: **modes** (zip records unix mode
      bits, so umask 002 here and 022 in a sandbox pack identical files differently) and
      **timezone** (a zip entry's timestamp is stored as local time with no zone, so the same
      epoch became 00:00 in the sandbox and 01:00 on this CET laptop). All three are fixed and
      `nix build` now produces the artefact `make pack` does, byte for byte. 0.1's
      "byte-identical" claim had held only by coincidence of matching mtimes.
- [x] **U2 — the decision, as a tested script.** `ci/release-plan.sh` decides — from the
      version, the status, the releases list and the built artefact — whether to publish and
      under which tag, printing `publish`/`tag`/`reason` for a workflow to consume and its
      reasoning on stderr. It publishes only when `status: done`; refuses when `STATUS.md` and
      `metadata.json` disagree about the version; compares the built artefact against the
      newest published one by the API's `digest`, falling back to downloading it; and names the
      tag `aideas-shell-v<version>`, then `-2`, `-3` as artefacts change within a version.
      `ci/release-test.sh` drives it over fixture JSON — **19 checks**, no network, no GitHub:
      not-done, empty list, first release of a version, identical bytes, second and third
      artefacts at one version, other ideas' tags in the list, a release with no digest, a
      failed download, a tag with no zip asset, disagreeing versions, and four kinds of bad
      input. Also run against the **real** releases list from the GitHub API, where it read the
      live `digest` and correctly proposed `aideas-shell-v0.1-2` for the reproducible rebuild.
- [x] **U3 — the checksum fallback.** `install.sh` now accepts both layouts that exist:
      `<asset>.sha256`, which the release workflow uploads, and `SHA256SUMS`, which the v0.1
      release and the other ideas in this repo publish. It matches the asset by both the
      percent-encoded name from the URL and the plain one written inside the file, falls back
      to the single `.shell-extension.zip` line when a sums file names it differently, and
      treats a malformed or unrelated sums file as *no* checksum rather than as a mismatch. A
      checksum that is present and wrong still refuses to install.
      **Proved against the live release**: `./install.sh` with no arguments now prints
      `checksum verified against SHA256SUMS` for `aideas-shell-v0.1` — the release that until
      now installed unverified. `ci/install-test.sh` grew from 27 checks to **37**, covering
      the fallback, a wrong digest, a sums file that does not mention our asset, the encoded
      name, no checksum at all, and a releases list carrying suffixed tags.
- [ ] U4 — the workflow rewritten around `nix build`, the flake checks and `release-plan.sh`.
- [ ] U5 — `tools/check-release.sh`, run against the existing v0.1 release.
- [ ] U6 — the bump to 0.2, the README section, and `status: done`.

Next: U4 — the workflow rewritten.

### What the failed run actually said

Checked rather than assumed, and one correction to PLAN.md's account:

- The workflow has run **three** times, not once. The 2026-08-14 run (the v0.1 merge) failed;
  two later runs — 2026-08-16T23:17Z and 23:21Z, on pushes that touched `ideas/aideas/**` —
  **succeeded by publishing nothing**, because by then `STATUS.md` said `not_started` and the
  job's own gate refused. So the path filter is not why it went quiet; the `status: done` gate
  is. That gate is being kept (the first answered question), so this stays true.
- The failure is exactly what PLAN.md says:
  `make: gjs: No such file or directory` / `make: *** [Makefile:66: check-bundle] Error 127`.
  `pack` depends on `check-bundle`, which runs `gjs`, which a stock runner does not have.
- The v0.1 release was made by hand by `gortazar` on 2026-08-16T20:41Z. Its assets are the zip
  (32 670 bytes, `sha256:53606c5a…`) and **`SHA256SUMS`** — not `<zip>.sha256`, which is what
  `install.sh` asks for and gets a 404 for, so it installs without verifying anything.

## What 0.1 covered

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

**How the release actually went.** The claim below was written before the merge and was wrong in two ways, which is what this entry exists to fix: the workflow could not build the artefact at all, and `make pack` and `nix build` were only byte-identical by coincidence of matching mtimes (U1 makes it true by construction). The original note read:

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
