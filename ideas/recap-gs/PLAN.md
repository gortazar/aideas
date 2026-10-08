# Plan: recap.gs — resume sessions in Terminator, not GNOME's console

Difficulty estimate: easy — the resume path is already a pure function returning an argv, so the
change is a row in a table and a test; what keeps it from being trivial is that Terminator hands a
second invocation to its *running* instance over D-Bus, and a terminal that opens in the wrong
directory resumes the agent against the wrong project.

This is a **minor** update: v0.3 → **v0.4**.

## Context

Clicking a row in the panel opens a terminal in the session's own directory and runs
`claude --resume <id>` there. Which terminal that is comes from `pickTerminal()` in
`src/lib/resume.js`: the `terminal` GSettings key if it names something on `PATH`, otherwise the
first entry of `TERMINALS` that is installed — a list of eleven, headed by `kgx`, `ptyxis` and
`gnome-terminal` because "the desktop's own terminal is the least surprising window to have appear".
This entry makes that window Terminator.

Four facts shape the work.

1. **Terminator is not in the list, and the fallback for an unlisted terminal is wrong for it.**
   `pickTerminal()` accepts a configured terminal it has never heard of and invokes it as
   `<name> -e <command...>`. Terminator's `-e/--command` takes **one** argument — the whole command
   as a single string — while `-x/--execute` is the one that takes the rest of the command line. So
   setting `terminal` to `terminator` today produces `terminator -e claude --resume <id>`, which is
   not the command anybody meant. Typing the preference in is the obvious thing a user would try, so
   this is a bug to fix, not only a feature to add.
2. **The correct invocation is `terminator --working-directory=<dir> -x claude --resume <id>`**
   ([terminator(1)](https://www.man7.org/linux/man-pages/man1/terminator.1.html)): `--working-directory`
   sets the terminal's directory and `-x` runs the remainder of the line instead of the shell. That
   is the same shape as the `xfce4-terminal` row, which already uses `-x`.
3. **Terminator's D-Bus hand-off is the thing that can go wrong.** When an instance is already
   running, a second invocation talks to it over D-Bus and the *existing* process opens the window —
   so `SubprocessLauncher.set_cwd()`, which `extension.js:506` sets as belt and braces, buys nothing,
   and the directory arrives only if `--working-directory` survives the hand-off. `-u/--no-dbus`
   forces a standalone instance and sidesteps it at the cost of a second process and a second
   Terminator config load. Which of the two ships is a measurement on a real desktop, not a guess —
   see **Risks**.
4. **Terminator's bell is also unwatched.** `TERMINAL_WM_CLASSES` in `src/lib/sources.js` is the list
   of terminals whose bell counts as an agent asking for attention, and its comment says why it is
   the same list: "a terminal worth resuming a session in is a terminal whose bell is worth listening
   to." Adding Terminator to one list and not the other would quietly make that sentence false.

Assumptions, stated rather than asked:

- **"Claude sessions" is not a special case.** The resume path does not branch per agent — it builds
  an agent command and hands it to a terminal — so opencode sessions open in Terminator too. A
  Terminator-for-Claude-only rule would be a new concept in a module that deliberately has none.
- **Terminator is preferred, not forced.** The `terminal` preference still wins when it names an
  installed terminal, and a machine without Terminator keeps today's behaviour exactly. Nobody loses
  a working resume because of this entry.
- **No new preference.** Where Terminator sits relative to the GNOME terminals is a question about
  the default order (first open question), not another switch to maintain.

## Features

- **Terminator as a terminal this extension knows** — a `TERMINALS` row building
  `terminator --working-directory=<dir> -x <command...>`, replacing the generic `-e` fallback that an
  unlisted name gets. Tested the way the other rows are: the argv is a value, so the assertion is on
  the exact list, including that `--resume` and the session id survive as separate arguments.
- **It is what opens when you click a row** — Terminator placed ahead of the GNOME terminals in the
  default order, so on a machine that has both, a resume opens Terminator rather than Console. A
  `terminal` preference that names something else still wins, and when Terminator is not installed
  the list falls through to exactly the order it has today.
- **The preference says so** — the Terminal row's placeholder and subtitle in `src/lib/preferences.js`
  name Terminator as the default pick, so the preferences window does not keep advertising `kgx` as
  what will open. No schema change: the key stays a free-text string defaulting to empty.
- **Terminator's bell is heard** — `terminator`/`Terminator` added to `TERMINAL_WM_CLASSES`, so the
  optional terminal-bell attention source treats a Terminator window like every other terminal it
  already knows. Covered by the existing `isTerminalWindow()` tests, which are case-insensitive.
- **Proven against a real Terminator** — the resume is run on this machine in both states that
  matter: with no Terminator running, and with one already running (the D-Bus hand-off). Each is
  checked for the three things that can be wrong independently — a window appears, its working
  directory is the session's own, and `claude --resume <id>` is what is running in it. A screenshot of
  the resumed window goes under `screenshots/`.
- **Shipped** — README updated where it describes which terminal opens, `v0.4` tagged and released
  from upstream's own workflow, and the published asset install-verified from a clean directory with
  `XDG_DATA_HOME` redirected, as 0.1–0.3 each were.

## Approach

Units, each one commit, tests first:

1. **U1 — the argv.** A failing test asserting the exact Terminator argv from `buildResumeLaunch`,
   then the `TERMINALS` row. Also a test pinning the thing that is currently broken: a configured
   `terminator` must resolve to the known row, not to the `-e` fallback.
2. **U2 — the order.** A test that with every known terminal installed, `pickTerminal('')` returns
   Terminator, and that an explicit preference and a Terminator-less machine both behave as before.
   Then move the row to the head of the list.
3. **U3 — the bell list.** `isTerminalWindow('Terminator')` — red, then the two spellings added.
4. **U4 — the real desktop.** Run both D-Bus states, decide `-u` on the evidence, record what was
   observed in `STATUS.md` whichever way it goes. If `-u` is needed, it lands here with the reason in
   the commit message and a comment in `resume.js`.
5. **U5 — preferences copy, README, screenshot.**
6. **U6 — `v0.4`: version bump, tag, release, install-verify, submodule pin and flake input bumped
   together (`scripts/check-pin.sh` agrees), `STATUS.md`.**

Each unit is pushed to `agent/recap-gs/<date>`; the pull request opens as a draft at U1.

## Risks / things to verify early

- **The D-Bus hand-off silently dropping `--working-directory`** is the one failure that looks like
  success: a Terminator window opens, Claude resumes, and it is reading whatever project the first
  Terminator instance was started in. U4 exists for this, and it must check the directory explicitly
  rather than eyeballing a window. This is the same class of defect the 0.1 and 0.2 smoke tests each
  found exactly once — plausible behaviour that only a real compositor disproves.
- **Terminator may not be installed on this machine**, in which case U4 cannot be done honestly. If
  so: install it locally if that is possible without touching anything the fleet depends on, and
  otherwise say in `STATUS.md` that the verification was not performed, in the style 0.2 used for the
  hook it could not run. Shipping an unverified terminal row while implying otherwise is the one
  outcome worth avoiding.
- **Reordering `TERMINALS` is a behaviour change for every user**, not just this machine — which is
  the first open question, and the reason it is a question rather than an assumption.
- **No Sonar surprise expected**: the diff is a few lines of JS and a list, and the new-code gate has
  never been exercised on a real change here (0.3 says so). If it goes red, the ladder in `AGENTS.md`
  applies — read it with `pr-gate.sh`, fix it in the same pull request.

## Open Questions

- [x] Should Terminator outrank the GNOME terminals in the default order for *everyone* who installs
      this extension, or should it only be preferred when the `terminal` preference names it (with
      the plan then being to set that preference on this machine, and to leave the shipped default
      GNOME-first)? Recommendation: the former — the entry says "instead of the default console of
      GNOME", a user who installed Terminator chose it deliberately, and the preference remains the
      escape hatch.
- [x] Should a resume open a **new Terminator window**, or a **new tab in the existing one**
      (`--new-tab`)? Recommendation: a new window, matching what every other terminal in the list
      does today; `--new-tab` also only works when an instance is already running, so it would make
      the first resume of a session behave differently from the rest.
