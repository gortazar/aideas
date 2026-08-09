# Plan: recap.gs — agent statuses in the Gnome Shell top bar

Difficulty estimate: medium — the extension itself is a small, conventional panel-menu widget, but it
depends on an interface that does not exist yet (`recap --json`), and getting data into GJS without
blocking the compositor, while staying inside the extensions.gnome.org review rules, is the real work.

## Context

`recap` (idea 5) answers "what were my agents doing?" from a terminal. This idea puts the same answer
one glance away: an indicator in the Gnome Shell top bar that shows how many agent sessions are alive
and, on click, the same per-project list with its status icons.

Three facts shape the design:

1. **This idea is downstream of recap and cannot start before it.** The idea text says so explicitly.
   The contract is already named in recap's plan: `recap --json` is "treated as a public interface and
   versioned", and `recap-gs` is its stated consumer. So this extension owns *no* parsing, *no*
   transcript reading and *no* status rules — duplicating the classification logic in GJS would
   guarantee the panel and the terminal eventually disagree about the same session.
2. **A Shell extension runs inside the compositor process.** Everything it does that takes time —
   spawning recap, reading its output, waiting for it — must be asynchronous. A synchronous spawn on a
   timer is a frozen desktop every time it runs slowly, and it is one of the things EGO reviewers look
   for.
3. **Shelling out is exactly what the sibling idea is removing.** `ideas/pwgen` exists because calling
   an external binary from an extension is a review-rejection risk: the binary is not guaranteed to be
   installed. Here the dependency is intrinsic — the extension has no purpose without recap — but it
   changes the requirements: recap's absence must be a *designed state* of the UI, not an error, and
   the alternative transports (a D-Bus service published by recap, or a JSON status file recap writes)
   should be considered before settling on spawning. See Open Questions.

Assumptions, stated rather than asked: the extension targets the Gnome Shell version on this machine
and the current EGO-supported releases; it displays only what recap reports, adding no analysis of its
own; and it never launches, resumes, or otherwise writes to an agent session in v1.

## Features

- **Top-bar indicator with an at-a-glance state** — a single panel button whose icon and short label
  summarise the fleet: how many sessions are running, and whether any is awaiting input. The
  worst/most-urgent state wins, so "one session is blocked on a question" is visible without opening
  anything.
- **Popup menu listing the tasks** — one row per project, mirroring recap's terminal output: status
  icon, project name, agent name (`Claude Code` / `opencode`), and the one-sentence recap, elided to
  the menu width with the full text as a tooltip. Rows are ordered by recency, as recap orders them.
- **Shared status vocabulary** — the same five states recap defines (🟢 running, 🟡 awaiting input,
  ⚪ idle, 🔴 interrupted, ✅ finished), rendered as themed symbolic icons rather than emoji so they
  follow the user's icon theme and light/dark preference. The mapping lives in one table; recap remains
  the sole authority on which state a session is in.
- **Asynchronous, non-blocking data source** — recap is invoked through `Gio.Subprocess` with
  `communicate_utf8_async`, never a synchronous spawn and never blocking I/O on the main loop. A run
  that overruns its timeout is cancelled via `Gio.Cancellable` and the previous data is kept, so a slow
  or hung recap degrades to stale-but-labelled data instead of a stuck Shell.
- **Polling with a considerate schedule** — refresh on a configurable interval (default order of
  30 s), immediately when the menu is opened, and never while the screen is locked or the session is
  idle; the timer is a `GLib.timeout_add_seconds` source that is created in `enable()` and removed in
  `disable()`.
- **Graceful degradation when recap is missing or incompatible** — recap not installed, not on `PATH`,
  failing, or emitting a JSON schema version this extension does not understand each produce a distinct,
  actionable menu message (and a neutral indicator), never a stack trace, never a notification storm.
  The extension is installable and harmless without recap present.
- **Click-through to the session** — activating a row opens that project in a terminal (or copies the
  resume command to the clipboard), so the panel is a way *back into* the work and not just a readout.
  Which of the two is the default is an open question; both are cheap.
- **Preferences UI** — an `ExtensionPreferences`/Adwaita window for: refresh interval, path to the
  `recap` binary, which recap filters to pass (`--since`, `--agent`, project roots), whether to show
  the count in the panel, and whether finished/idle sessions are listed or hidden.
- **Review-rules compliance** — ESM imports and the modern `Extension`/`ExtensionPreferences` base
  classes; every timer, signal handler, subprocess, cancellable and UI object created in `enable()`
  destroyed in `disable()` (verified by a leak test that enables/disables repeatedly); no global
  monkey-patching; no `eval`; no bundled binaries; correct `metadata.json` with a compiled GSettings
  schema shipped alongside.
- **Headless unit test suite** — the parts that can be tested without a compositor (JSON decoding,
  schema-version check, status→icon mapping, row-model construction, summary/count derivation, error
  classification) live in Shell-free modules importing only GLib/Gio, run under plain `gjs` against
  committed `recap --json` fixtures, with the subprocess behind an injectable seam so tests cover the
  missing-binary, garbage-output, timeout and empty-list paths.
- **Reproducible environment + green CI** — `flake.nix` providing `gjs`, `glib`, ESLint and
  `gnome-extensions`; `nix flake check` running lint, the unit suite and `gnome-extensions pack`
  validation; `.github/workflows/ci-recap-gs.yml` running it path-filtered on push and PR.
- **README with real screenshots** — `nix develop`, run tests, build/pack, install locally, and the
  publish path to extensions.gnome.org, plus screenshots of the panel indicator, the open menu and the
  preferences window under `screenshots/`.

## Approach

Nothing here can begin until the first open question below is answered — recap needs a shipped,
versioned `--json` schema to build against. Once it exists:

1. **M0 — Pin the contract.** Record a set of `recap --json` fixtures covering every status, an empty
   result, and a malformed session; commit them and write `docs/recap-json-contract.md` naming the
   schema version this extension supports. These fixtures are the boundary between the two ideas.
2. **M1 — Skeleton.** Flake, ESLint, test runner, CI green, and an extension that enables, shows a
   static panel icon and disables cleanly. Baseline green before any behaviour lands.
3. **M2 — Data layer against fixtures only.** Decode, version-check, map to a row model, classify
   errors — pure functions, tests first, no Shell imports.
4. **M3 — Live subprocess seam.** Async invocation, timeout, cancellation, stale-data handling; the
   fake seam stays for tests.
5. **M4 — UI.** Panel indicator, menu rows, icon theming, refresh on menu open, lock/idle suppression.
6. **M5 — Preferences** and the GSettings schema wired to the data layer.
7. **M6 — Click-through action, leak test, README, screenshots, pack validation.**

Per the repo's tests-first rule: every unit above starts with a failing test; UI behaviour that needs a
compositor is exercised in a nested Shell session by hand and recorded in `STATUS.md`, not faked in CI.

## Risks / things to verify early

- **Recap's schema is not final.** Building the UI against a moving target wastes work. Mitigation: the
  fixtures in M0 pin a named version, the extension refuses unknown major versions loudly, and the
  contract doc is updated by whoever changes recap.
- **Transport choice may be wrong.** Spawning a process every 30 s from the compositor is defensible
  but not free, and EGO reviewers are wary of external-binary calls. A D-Bus service or a
  recap-maintained status file would be cheaper per refresh and reviewer-friendlier — but each adds a
  daemon or a writer to recap, which its plan deliberately avoids ("recap needs no daemon; it is a
  *reader*"). Settle this before M3, not after.
- **Icon set under an icon theme.** Five distinguishable, always-present symbolic icons may not exist
  in every theme; shipping our own SVGs may be necessary and affects packing and review.
- **Locked/idle suppression.** Polling while the screen is locked wastes battery and is a review smell;
  verify the session-mode and idle-monitor APIs behave as expected on the target Shell version.
- **Emoji versus symbolic mismatch.** Recap's terminal output is emoji; the panel will be symbolic. The
  two must clearly mean the same thing — document the mapping in both READMEs.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **Blocking dependency.** Idea 5 (`recap`) is `not_started` and its own plan still has unanswered
      questions, including which language it is written in. This idea's text says it "can't be started
      until recap has a clear API". Confirm: should `recap-gs` stay blocked until `recap --json` is
      implemented and its schema documented, or should it start now against a hand-written mock schema
      that recap is then obliged to match? Recap now implemented completely and working.
- [x] How should the extension get data from recap: spawn `recap --json` on a timer, consume a D-Bus
      service that recap publishes, or read a status file recap refreshes? Spawning needs no changes to
      recap but is the transport EGO reviewers scrutinise most; the other two require recap to grow a
      daemon or a writer, which its plan currently rules out. Spawn recap.
- [x] Where should this extension's code live? `ideas/pwgen` was answered with "work on the upstream
      GitHub repo, keep only a submodule here". Is there an existing or intended
      `gortazar/gnome-shell-recap` repo to develop in and push to, or is this one built inside
      `ideas/recap-gs/` and published later? Build it inside.
- [x] What does clicking a task row do — open a terminal in that project (which terminal?), resume the
      agent session directly, copy the resume command to the clipboard, or nothing at all in v1? Resume the agent session.
- [x] Is "done" the same bar as pwgen — pushed to a repo with green CI checks — or does it also include
      an actual submission to extensions.gnome.org? Just green.
- [x] Which Gnome Shell versions must be supported? Targeting only the version on this machine is
      simplest; EGO submission effectively requires listing several `shell-version` entries and testing
      against each. Use the same versions as pwgen.
- [x] Should the extension notify (a desktop notification) when a session transitions to *awaiting
      input* or *finished*, or is it strictly a passive readout? Notifications are the feature most
      likely to make it genuinely useful and also the one most likely to become noise. Not for v1.
