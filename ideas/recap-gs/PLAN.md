# Plan: recap.gs — notice the moment a session asks or finishes

Difficulty estimate: medium — the appearance change itself is an hour's work on a widget that already
exists, but the path that triggers it (agent hook → shim → D-Bus → the panel) is a new public surface,
shared by two agents, that must never block, hang or fail the agent it is hooked into.

## Context

0.1 ships a panel indicator that asks `recap --json` every 30 seconds and draws whatever it says.
That is a *readout*: to learn that a session started waiting for you, you have to look at the top bar,
and you learn it up to 30 seconds late. This entry adds the other half — the panel changes its
appearance at the moment something happens, and stays changed until you acknowledge it.

Four facts shape the design:

1. **The idea text rules out the obvious implementation.** "Detecting this would preferably not
   require a monitor running and inspecting internal details, but rather detect notifications or the
   like." So: no watcher process, no tailing transcripts, no polling faster. The trigger has to be an
   event the desktop already carries, or one the agent itself volunteers.
2. **Both agents already volunteer exactly these two events.** Claude Code's `Notification` hook fires
   when it is waiting for input or permission, and its `Stop` hook fires when it finishes responding;
   both receive JSON on stdin carrying `session_id`, `cwd`, `transcript_path` and (for `Notification`)
   the `message`. opencode's plugin API emits `session.idle` when a session finishes working. That is
   "asked" and "finished" straight from the source, with the working directory attached — no
   inspection of anything internal, because the agent is telling us.
3. **recap stays the authority on *state*; events only supply *timing*.** An event says "something
   happened in `/home/patxi/git/aideas`, now". It does not say what the session is doing — recap does.
   So an event's job is to (a) trigger an immediate refresh and (b) raise an attention flag on the
   matching row. If the two ever disagree, recap's status is what the row displays; the flag only adds
   emphasis. This keeps 0.1's rule — the extension decides nothing about a session's state — intact.
4. **An extension runs inside the compositor, and a hook runs inside the user's agent.** Both sides of
   this feature are places where a mistake is expensive: a slow hook makes Claude Code feel slow, and a
   crash in a D-Bus handler takes a piece of the desktop with it. The shim exits 0 no matter what, with
   a timeout; the handler validates everything and throws nothing.

Assumptions, stated rather than asked:

- **"Change appearance" means the extension's own surfaces** — the panel button and its menu. A Shell
  extension cannot restyle a terminal window it does not own, and marking someone else's window is a
  different feature. See the first open question.
- **Attention is per project, not per session**, because the menu has one row per project. Several
  sessions asking in one project is one flagged row with the newest event's time.
- **Attention lives in memory.** A shell restart or an extension reload clears the flags; recap's own
  `waiting` status survives regardless, so nothing is lost that matters. Persisting acknowledgements
  across restarts would need a GSettings key and a staleness rule for a state whose whole lifetime is
  usually a few minutes.
- **This entry adds no desktop notifications of its own.** 0.1 answered that question with "not for
  v1"; the ask here is appearance. See the second open question.
- **The terminal-bell fallback is off by default.** Any bell from any terminal would raise it —
  a completion beep, `make` finishing — and a signal that lies is worse than one that is 30 seconds
  late.

## Features

- **An event interface the agents can call** — the extension exports
  `org.gnome.Shell.Extensions.RecapGs` at `/org/gnome/Shell/Extensions/RecapGs` while enabled, with one
  method, `Event(kind: s, payload: s) -> ()`. `kind` is `asking` or `finished` (anything else is
  ignored, so a newer shim against an older extension is harmless); `payload` is the agent's own hook
  JSON, passed through untouched and parsed on this side, so the shim needs no `jq` and no parsing of
  its own. The name is owned in `enable()` and released in `disable()`; the payload is length-capped,
  every field validated, and nothing in it is ever executed or interpolated into a command.
- **A shim the hooks call** — `recap-gs-notify <kind>`, a POSIX shell script that reads stdin and makes
  one `gdbus call`. It always exits 0, it is bounded by a short `timeout`, and it does nothing at all
  when the extension is not running (no bus name, no error, no output). A hook that can fail the agent
  it is hooked into is a bug in this feature, not in the agent.
- **Hook installation that is inspectable before it runs** — `hooks/install-hooks.sh` merges the
  `Notification` and `Stop` entries into `~/.claude/settings.json` (backing the file up first, and
  idempotently — running it twice leaves one entry) and drops an opencode plugin that forwards
  `session.idle`. The preferences window gains a **Detection** page showing what is wired up, the exact
  snippet for each agent with a copy button, and when each source last delivered an event — so
  "why did nothing light up?" is answerable without a log.
- **Attention state, decided by a pure function** — an event plus the current report produce a set of
  flagged projects, each with its kind (`asking` beats `finished`), the time it arrived, and the
  message the agent sent. Events are matched to a project by longest-prefix match of the event's `cwd`
  against the session directories recap reports, falling back to the project root; an event that
  matches nothing raises fleet-level attention only, rather than being dropped or guessed onto a row.
  Repeat events for the same project within a few seconds coalesce, and a per-minute ceiling means a
  hook stuck in a loop cannot turn the panel into a strobe.
- **Acknowledgement rules that clear it** — opening the menu clears the flags on the rows it shows;
  activating a row clears that row's; and a project recap reports as no longer waiting, whose flag was
  `asking`, clears on the next refresh. Nothing clears on a timer: a question asked while you were away
  from the machine is still a question when you come back.
- **The panel says so** — the button takes an `asking` or `finished` style class, drawn from the theme's
  accent colour with a plain fallback for themes that have none, and pulses its opacity a bounded
  number of times (three, then steady) rather than blinking forever. `asking` and `finished` look
  clearly different: one is the urgent state, the other is a quiet success mark. Attention outranks the
  polled summary while it is pending, so an event that arrives 28 seconds before the next refresh is
  visible immediately; the count beside the icon is how many projects are flagged.
- **The menu says which, and why** — a flagged row is marked (a leading dot and the row in bold) and
  carries the agent's own message when it sent one ("Claude needs your permission to run git push"),
  under recap's sentence, wrapped like it. The row order stays recap's — see the fourth open question.
- **An immediate refresh on every event** — the event schedules a refresh through the existing
  single-flight refresher, so the flagged row's text is recap's current answer and not a 30-second-old
  one. The refresh schedule is otherwise untouched: still suppressed while locked or idle, and an event
  arriving during suppression flags the row without spawning anything.
- **Two secondary sources, both event-driven** — the message tray (`Main.messageTray` `source-added` →
  each source's `notification-added`, filtered to a configurable list of app names, for people whose
  agents already `notify-send`), and `window-demands-attention` on `global.display`, filtered to the
  eleven terminal `wm_class`es 0.1 already knows, which raises fleet-level attention only because a
  bell carries no project. Each source is a preference; each is behind the same seam as the D-Bus one,
  so the attention model is tested without any of them.
- **Headless tests for all of it** — payload validation (truncated, not JSON, not an object, missing
  `cwd`, an unknown `kind`, a 1 MiB string), `cwd`→project matching including the prefix traps
  (`/home/p/git/aideas-old` must not match `/home/p/git/aideas`), coalescing and the rate ceiling,
  every acknowledgement rule, and the summary's precedence over the polled state. The clock and the bus
  are injected, as the subprocess seam already is.
- **Compositor tests in the existing smoke test** — `ci/smoke-test.sh` gains: a `gdbus call` from
  outside the shell lights the panel up, opening the menu clears it, and five enable/disable rounds
  leave no bus name owned, no signal connected and nothing on the main loop. The pulse is checked as
  "opacity returned to 255 and no source is left", which is the part that can leak.
- **Documentation and a release** — upstream's README gains a *Notifications* section (what each agent
  needs, the one command that sets it up, what it looks like, and how to turn a source off), a
  screenshot of the flagged panel and menu taken from the smoke-test run, `docs/event-interface.md`
  specifying the D-Bus method as the versioned surface it is, and `v0.2` tagged, released and
  install-verified from a clean directory.

## Approach

Units, each one commit, tests first:

1. **U1 — the attention model.** Pure: events in, flagged projects out, with coalescing, the ceiling,
   the matching rules and every acknowledgement rule. No bus, no widgets. The wording and the
   precedence over recap's summary are settled before anything can deliver an event.
2. **U2 — payload decoding.** Claude's hook JSON and opencode's `session.idle` payload become an
   internal event or a named reason for ignoring it, never a throw. Fixtures recorded from both agents.
3. **U3 — the D-Bus service.** Name owned in `enable()`, released in `disable()`, method wired to U2 and
   U1, with a test that unexporting is complete (the same discipline `_onDestroy` already has).
4. **U4 — the shim and the installer.** `recap-gs-notify`, `hooks/install-hooks.sh` and the opencode
   plugin, tested against a stand-in bus and a throwaway `HOME` — including running the installer twice
   and against a `settings.json` that already has unrelated hooks in it.
5. **U5 — the appearance.** Style classes, the bounded pulse, the panel precedence, the row marker and
   the message line. This is the unit where the feature becomes visible.
6. **U6 — the refresh trigger**, through the existing single-flight refresher, including the
   locked/idle case.
7. **U7 — the secondary sources**, message tray and `window-demands-attention`, each behind its
   preference and its seam.
8. **U8 — preferences**: the Detection page, its rows held against the schema by the existing test.
9. **U9 — the real shell**: smoke-test additions, the screenshots, and a by-hand run against a real
   Claude Code session recorded in `STATUS.md` — this feature is only true if a real agent asking a
   real question lights the panel up.
10. **U10 — README, `docs/event-interface.md`, `version: 0.2`, `status: done`**, tag `v0.2` upstream,
    let the release workflow publish, and verify the published installer from a clean directory.

## Risks / things to verify early

- **The message tray API moved between the versions we support.** `metadata.json` claims 46–50, and
  the `Source`/`Notification` classes were reworked in 46 with further churn after. Verify on the
  target versions before U7, and if it cannot be made to behave the same everywhere, ship the D-Bus
  source alone rather than a source that works on one machine — that is why it is the secondary path.
- **A hook that misbehaves damages trust in the agent, not in us.** Verify the shim's cost and its
  failure modes first: no bus, no `gdbus`, extension disabled, D-Bus reply slow. It must be
  single-digit milliseconds and exit 0 in every one of them.
- **Editing `~/.claude/settings.json` is editing the user's own configuration.** Back it up, merge
  rather than overwrite, be idempotent, and never touch a hook the user wrote. See the third open
  question.
- **opencode's plugin API is younger than Claude Code's hooks** and `session.idle` is the only event
  that matches "finished" — there may be no clean equivalent of "asked". If so, opencode gets
  `finished` and stays on the 30-second poll for `asking`, documented rather than faked.
- **`cwd` is not always the project root.** An agent started in a subdirectory reports the
  subdirectory; a worktree reports the worktree. Longest-prefix matching against recap's session
  directories handles both, but the fallback path (nothing matches) must be tested, because it is what
  a monorepo will hit.
- **A pulse is an animation in the compositor.** Bounded, cancelled in `disable()`, and it must not run
  while the screen is locked. An infinite blink would also be an accessibility problem, which is the
  other reason it is three.
- **Attention that will not clear is worse than none.** The clearing rules are the part most likely to
  strand a permanently-lit panel, so they are the part with the most tests — in particular the case
  where recap goes unavailable while a flag is up.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] **What changes appearance?** The plan assumes the extension's own surfaces: the panel button and
      the flagged row in its menu. The wider readings are (b) also mark the *terminal window* of the
      asking session — the Shell can set a window's attention flag, so it would show in the overview and
      in the dash, but only for windows we can identify, which means a title or PID match we do not have
      today; or (c) something desktop-wide (a screen edge glow, the accent colour). Ticking this line
      as-is chooses the panel and its menu.
- [ ] **Should an event also raise a desktop notification?** 0.1 answered "not for v1" and this entry
      asks for an appearance change, so the plan says no. But "a session asked something" is the case
      where a notification is genuinely wanted — you are in another window, which is exactly why you
      did not see the panel. Ticking this line as-is keeps notifications out of 0.2; the alternative is
      an off-by-default preference for `asking` events only.
- [ ] **May the installer write to `~/.claude/settings.json` and the opencode config?** The plan says
      yes, with a backup and an idempotent merge, because a copy-paste-only path means most people never
      turn the feature on. The conservative answer is that the preferences page shows the snippet and
      the user edits their own configuration. Ticking this line as-is chooses the installer.
- [ ] **Should a flagged project jump to the top of the menu?** Attention is easier to find at the top,
      but 0.1's rule is that recap owns the order and the extension only renders it, and a list that
      reorders itself while you read it is hard to click. Ticking this line as-is keeps recap's order
      and relies on the row marker.
