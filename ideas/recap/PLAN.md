# Plan: recap — what were my agents doing?

Difficulty estimate: medium — the mechanics (read session logs, check which processes are alive, print
a line per project) are straightforward, but the two supported agents store their transcripts in
undocumented, version-drifting formats, and turning a transcript into one honest sentence needs care.

## Context

A user runs several coding agents at once, across several repos, in terminals scattered over
workspaces — and then closes the laptop. On return there is no single place that answers "what were
they doing, and is anything still going?". `recap` is that place: one command, a few lines of output,
no interaction.

Two facts shape the design:

1. **Both supported agents already persist everything to disk.** Claude Code writes one JSONL
   transcript per session under `~/.claude/projects/<escaped-cwd>/<session-id>.jsonl`, one JSON object
   per line (user turns, assistant turns, tool calls and results), each carrying a timestamp, the
   session id and the project path. opencode keeps its own session/message store under its data
   directory (`~/.local/share/opencode/`), with session metadata separate from message parts. So
   recap needs no daemon, no hooks and no cooperation from the agents: it is a *reader*. Reading is
   also the only safe option — a tool that writes into an agent's state directory can corrupt a live
   session.
2. **"Status" and "what it was doing" come from different places.** Whether a session is *running* is
   a live-process question (is there a process whose cwd is this project and whose command is the
   agent?), not something the transcript can answer — a transcript looks identical whether the agent
   is thinking or was killed by a suspend. Whether it is *waiting for you* is inferred from the shape
   of the transcript tail (last event is an assistant message or a permission prompt, nothing since).
   Recap combines the two: process table for liveness, transcript for narrative.

Assumptions, stated rather than asked: recap runs on the same machine as the agents (no remote
sessions in v1); it reads only the local user's own files; and "recently" defaults to a time window
(sessions untouched for longer are hidden unless asked for).

## Features

- **One line per project, sorted by recency** — the output format from the idea text:
  `<icon> <project> (<agent>) -> <one-sentence recap>`, where the project name is the basename of the
  session's working directory and the agent is `Claude Code` or `opencode`. Multiple sessions in the
  same project collapse into one line by default, with the busiest state winning.
- **Status icons with a defined meaning** — a small fixed vocabulary, each with a rule behind it, so
  the icon is a fact and not a vibe:
  - 🟢 *running* — a live agent process is attached to that session/cwd and the transcript grew
    recently.
  - 🟡 *awaiting input* — process alive (or session resumable) and the last transcript event is an
    assistant turn, a question, or a pending permission/tool-approval prompt.
  - ⚪ *idle / not running* — no live process; last activity was an ordinary stopping point.
  - 🔴 *interrupted* — no live process and the transcript ends mid-work (last event is a tool call
    with no result, or an abort/interrupt marker), i.e. the laptop-suspension case.
  - ✅ *finished* — no live process and the session ended after completing what it was asked.
  A `--legend` flag prints the vocabulary; a `--no-icons` flag substitutes words for terminals and
  pipes that mangle emoji.
- **Claude Code reader** — discovers projects under `~/.claude/projects/`, maps the escaped directory
  name back to a real path, and parses each session's JSONL incrementally *from the tail* (a long
  session's transcript is large; recap must not read megabytes to print one line). Extracts: first
  user request, last user request, last assistant text, outstanding tool calls, interrupt markers,
  timestamps, session id, cwd, and the git branch/worktree when recorded.
- **opencode reader** — the same extraction against opencode's own storage layout, behind the same
  internal interface, so a third agent is a new reader and nothing else.
- **Version-drift tolerance** — both formats are undocumented and change between releases. Readers
  treat every field as optional, skip records they do not recognise instead of aborting, and never
  let one unparseable session hide the others. A malformed session degrades to a line saying so.
- **Recap sentence generation** — the "was doing X, now Y" sentence, built from the transcript
  without calling out to a model, so `recap` stays instant and offline: the *was* clause comes from
  the most recent user request (trimmed to one clause), the *now* clause from the status rule that
  fired, plus counts where they are informative ("3 of 7 units done" style, when the agent left such
  a marker). Sentence assembly is pure logic and is where most of the test suite lives.
- **Optional richer detail on demand** — `recap -v` adds per-session lines under each project: session
  id, age, model, last tool used, and the file it last touched; `--json` emits the same data
  machine-readably, which is also what the future `recap-gs` Gnome extension (idea 6) consumes, so
  the JSON shape is treated as a public interface and versioned.
- **Filtering and scope** — `--since <duration>` (default: last 24h of activity), `--all` to ignore
  the window, `--agent claude|opencode`, `--project <name>` for a single project, and `--running` to
  show only live work.
- **Fast and side-effect free** — a hard performance target (sub-300 ms on a machine with dozens of
  sessions) met by tail-reading and by caching parsed summaries keyed on file size + mtime under
  `~/.cache/recap/`. Recap never writes to an agent's directories, never spawns an agent, and works
  with no network.
- **Reproducible environment + green CI** — `flake.nix` for dev/test/build, a test suite that runs
  against committed transcript fixtures (recorded from real sessions, scrubbed of file contents and
  secrets) so parsing is verified without needing live agents, and
  `.github/workflows/ci-recap.yml` running it path-filtered.
- **README with real output** — installation, usage, the icon vocabulary, the `--json` schema, and a
  screenshot of actual output in a terminal.

## Approach

1. **M0 — Format spike.** Probe both agents' on-disk state on this machine and write
   `docs/session-formats.md`: directory layout, record types, which fields are reliable, how
   interrupts and permission prompts appear, and what a finished session looks like versus an
   abandoned one. Capture fixtures at the same time. This is the step that can invalidate the status
   rules, so it comes first.
2. **M1 — Skeleton.** Flake, test runner, CI green, `recap` binary that prints nothing but exits 0.
3. **M2 — Claude Code reader + status rules,** against fixtures only.
4. **M3 — Liveness detection** — process discovery and its correlation with sessions.
5. **M4 — Rendering** — icons, one line per project, `--no-icons`, sorting, filters.
6. **M5 — opencode reader** behind the same interface.
7. **M6 — `--json`, `-v`, caching, README, screenshot.**

Per the repo's tests-first rule: parsing, status classification and sentence assembly are pure
functions over fixtures and are unit-tested; process discovery is behind a seam with a fake in tests;
rendering is snapshot-tested.

## Risks / things to verify early

- **Correlating a process with a session.** Claude Code's process command line may not carry the
  session id, so the link may have to be made through the process cwd plus which transcript file is
  currently being appended to. If that proves unreliable, the running/idle distinction degrades to
  "was active in the last N minutes" and the README says so.
- **Detecting "awaiting input" versus "thinking".** Both look like a transcript that has stopped
  growing. Distinguishing them may need the process state (sleeping on stdin) as a tiebreaker.
- **"Finished" is a judgement.** Without a model there is no reliable "the task was completed"
  signal; the honest fallback is to reserve ✅ for sessions with an explicit completion marker and
  otherwise report ⚪ idle rather than claim success.
- **Format churn.** Fixtures pin behaviour for the versions recorded; a later agent release can
  silently change field names. Mitigation is the skip-unknown-records rule plus a fixture per
  observed format version.
- **Privacy.** Transcripts contain source code, paths and sometimes secrets. Recap prints only short
  summaries, fixtures are scrubbed before committing, and nothing is ever sent off the machine.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] What language and runtime should recap be written in? The repo has no default, and the choice
      is constrained by idea 6 (`recap-gs`, a Gnome Shell extension) needing to consume recap — a
      compiled binary invoked for its `--json` output works from GJS, but a shared library or a GJS
      implementation would too. Preference?
- [ ] Should the recap sentence ever be generated by an LLM? Pure-logic assembly is instant, offline
      and free, but produces a blunter sentence than the examples in the idea text ("was interrupted
      mid-task by laptop suspension and is now resuming work" reads like a model wrote it). Is a
      heuristic sentence acceptable, or is an optional `--smart` mode that calls a model wanted?
- [ ] Is the example line "Was running the orchestrator against ideas 6 and 8. Idea 7 stopped and
      requested further info." meant to be *recursive* — recap understanding that a session is itself
      orchestrating sub-agents and reporting on their individual states — or is that just a verbose
      example of one session's summary? The recursive reading is a substantially bigger feature.
- [ ] Which opencode installation is the reference? opencode's storage layout has changed across
      releases, and the plan assumes the version installed on this machine — is that right, or must a
      specific version be supported?
- [ ] Should recap show sessions from *all* projects on the machine, or only those under a configured
      set of roots (e.g. `~/git`)? Machine-wide is simpler but will surface throwaway sessions from
      `/tmp` and scratch directories.
- [ ] Is a config file wanted (default time window, project roots, icon set, ignored paths), and if
      so should it live at `~/.config/recap/config.toml`? Or are command-line flags enough for v1?
