# Plan: restore-wss — restore workspaces as they were before shutdown

Difficulty estimate: hard — on Wayland nothing outside the compositor can enumerate windows or
their workspaces, "which document is this window showing?" has no general answer, re-running a
recorded shell command is a security decision rather than a mechanism, and the tool must survive
an *unclean* power-off, so state has to be snapshotted continuously rather than saved at logout.

## Context

The goal is narrow and concrete: after a reboot or a power cut, put the desktop back — the same
apps, on the same workspaces, with the same documents open, the same terminals in the same
directories running the same things, and the same VPN up.

Three constraints shape the design and are worth stating before the feature list.

1. **Recording must not depend on a clean shutdown.** The classic answer to this problem is
   session management (XSMP, `ksmserver`, `xfce4-session`): the session manager asks clients to
   save state *at logout*. That is exactly the case this idea does not care about — a power cut
   never reaches logout. So restore-wss records **continuously**, on a timer plus on interesting
   events, into rotating snapshots, and restores from the newest snapshot that looks sane.
2. **Window→workspace mapping is compositor-private on Wayland.** There is no `_NET_CLIENT_LIST`,
   no `wmctrl`, no cross-client window IDs, and `org.gnome.Shell.Eval` is disabled outside unsafe
   mode. The only supported way to learn which workspace a window is on, and the only way to place
   a window on restore, is code running *inside* GNOME Shell. So the tool is two pieces: a
   **recorder/restorer daemon** (all the logic, all the I/O, all the process inspection) and a
   **thin GNOME Shell extension** that exposes window/workspace facts and placement over D-Bus.
   The daemon is useful on its own — apps, documents, terminals and VPN restore without it — but
   without the extension everything lands on whatever workspace GNOME picks.
3. **Restoring is a guess; the user is the tiebreaker.** The idea text already anticipates this
   ("the user can be asked about information that cannot be collected automatically"). The design
   makes that first-class: every recorded item carries a **confidence**, and restore runs as a
   reviewable plan the user can confirm, edit or skip, not as a silent replay.

Assumption (stated rather than asked): the target is the GNOME Shell version on the development
machine, Wayland session, with NetworkManager managing VPNs — matching the environment the sibling
`gnome-tasks` idea targets. X11 is not a goal.

**Relationship to sibling ideas.** `gnome-tasks` (idea 2) solves an overlapping problem — capture
and restore a set of apps and their documents — but for *named tasks the user switches between*,
not for *the machine that just rebooted*. The capture layer is nearly the same problem twice; see
Open Questions for whether these should share code. Browser tabs are explicitly **out of scope
here**: idea 4 is a separate entry covering browser/tab restore for this same folder.

## Features

- **Continuous session recording** — a user-level daemon (`restore-wss-recorderd`, a systemd user
  service) snapshots the session periodically and on significant events (window opened/closed,
  window moved between workspaces, VPN up/down), debounced so a window drag does not cause a write
  storm. Snapshots are written atomically to `~/.restore-wss/snapshots/`, rotated with a bounded
  count, so an unclean power-off loses at most one interval.
- **Config and state under `~/.restore-wss/`** — `config.toml` (intervals, exclusions, per-app
  overrides, restore policy), `snapshots/<timestamp>.json` (versioned schema, atomic writes),
  `answers.json` (facts the user has been asked about and confirmed, so the same question is never
  asked twice), and `logs/`. The snapshot schema is versioned and documented, and contains
  everything needed to restore — no hidden dependency on state elsewhere.
- **Graphical app capture and restore** — for each window: the `.desktop` app id, its workspace
  index, monitor and geometry, and the document or folder it is working on. Restore launches via
  `Gio.DesktopAppInfo.launch_uris_async()` with an activation token so the window that appears can
  be matched back to the slot that asked for it, then places it through the extension.
- **Document/folder resolution, tiered by confidence** — no single mechanism covers everything, so
  sources are tried in order and the result is tagged:
  - *high* — the app exposes its own state (D-Bus interface, or the `org.gtk.Application` window
    object path), or its open file is directly visible as an open fd under `/proc/<pid>/fd`
    (LibreOffice with `Thesis.odt`);
  - *medium* — `/proc/<pid>/cmdline` and `/proc/<pid>/cwd` (a Codium started as `codium ~/my-app`),
    or the freedesktop recent-files store correlated by app and timestamp;
  - *low* — window-title heuristics, declared explicitly per app rather than applied globally.
  Anything below the configured threshold becomes a question at restore time instead of a guess.
- **Terminal and command-line restore** — for each terminal window, walk the process tree from the
  terminal's PID down through its ptys, take each pty's foreground process group, and record its
  `cmdline` and `cwd`. That recovers `ssh my-host`, `claude -r` in `~/my-repo`, `docker compose
  up`, and the plain-shell case (restore the directory, run nothing). Restore re-launches the
  terminal with the recorded working directory and, for commands the user has approved, the
  recorded command. Which terminal emulators are supported is declared per emulator (working
  directory and command-argument flags differ), starting with the one on the development machine.
- **Commands are never replayed without consent** — a recorded command line is shown before it is
  ever run; the user approves it once (remembered in `answers.json` as an exact-match rule),
  approves it for this restore only, or edits it. A denylist and an interactive-only default keep
  a destructive command in a shell's history from being re-executed by a restore. This is a
  deliberate constraint, not a missing feature.
- **VPN capture and restore** — the active VPN/WireGuard connections are read from NetworkManager
  (`nmcli -t -f NAME,TYPE,STATE connection show --active`, and the corresponding D-Bus properties)
  and brought back up on restore. Secrets are never stored by restore-wss: connections whose
  secrets live in the keyring come back automatically, and connections that need a password, OTP
  or interactive auth are surfaced as a prompt. Non-NetworkManager VPNs (a `wg-quick@` or
  `openvpn@` systemd unit) are recorded as unit names and restored by starting the unit.
- **Reviewable restore, with questions** — `restore-wss restore` builds a plan from the newest
  snapshot, shows it grouped by workspace (what will be launched, with which document, on which
  workspace, which commands, which VPN), asks about the low-confidence and consent-requiring
  items, and then executes, reporting per-item success or failure. `--dry-run` prints the plan and
  exits; `--yes` runs the pre-approved subset and skips anything that would ask.
- **Double-restore avoidance** — apps that restore their own session (editors, browsers, anything
  with "reopen last files") are marked in config so restore-wss launches them bare and lets them
  do it, instead of forcing documents and getting each one twice.
- **Exclusions and privacy controls** — recording is local-only, with an app/path exclusion list, a
  `restore-wss pause`/`resume` switch, and no capture of window titles for excluded apps. What is
  recorded is a list of the documents a user opens, so the tool says so plainly and keeps the file
  readable and hand-editable.
- **GNOME Shell companion extension** — a deliberately thin extension owning
  `org.gnome.RestoreWss.Shell` on the session bus: list windows with app id, workspace, monitor,
  geometry and PID; emit window/workspace change signals; move a window to a workspace and
  geometry on request. All logic, spawning and file I/O stays in the daemon so a bug cannot take
  the compositor down.
- **CLI** — `restore-wss save` (snapshot now), `restore`, `status`, `list`, `show <snapshot>`,
  `edit`, `pause`/`resume`, `enable`/`disable` (install the systemd user units, including the
  optional restore-on-login unit).
- **Prior-art study** — `similar-tools-research.md` in this folder (see below), written before the
  design is locked.
- **Reproducible environment + green CI** — `flake.nix` providing the runtime and test tooling,
  `nix flake check` running lint and the test suite, and `.github/workflows/ci-restore-wss.yml`
  path-filtered on push and PR.

## Documentation deliverables

- **`similar-tools-research.md`** — the in-depth study the idea calls for, written from checking
  what the tools actually do, with a table of what each one restores, how it captures it, and what
  restore-wss should take or reject. At minimum it must cover: X11 session management (XSMP,
  `ksmserver`, `xfce4-session`, `lxsession`) and why GNOME dropped session saving; the Wayland
  session-management protocol work and whether Mutter implements any of it yet; KDE Plasma 6's
  session restore on Wayland; KDE Activities and this repo's own `gnome-tasks`; GNOME extensions
  in this space (Auto Move Windows and the various "save/restore window position" extensions);
  `tmux-resurrect`/`tmux-continuum`, which is the closest prior art for the command-line half,
  including its process-whitelist model; CRIU, as the "actually checkpoint the processes" approach
  and why it is not the answer here; per-app self-restore (browsers, VS Code/Codium, LibreOffice);
  and macOS/Windows equivalents for the interaction model.
- **`docs/state-schema.md`** — the snapshot and config format, versioning and migration rules.
- **`docs/capture-sources.md`** — every source used to answer "what is this window showing?" and
  "what is this terminal running?", with its confidence tier and its failure modes.
- **`docs/limitations.md`** — the honest list of what cannot be restored (unsaved buffers, shell
  history and in-process state, interactive TUI state, anything behind a login).

## Approach

Sequenced so the research that could invalidate the design happens first, and so each milestone
leaves something usable on its own.

1. **M0 — Prior art and probe.** Write `similar-tools-research.md`. In parallel build
   `tools/probe.py`, which dumps everything reachable about the current session (processes,
   `/proc` fds and cwds, pty foreground groups, NetworkManager active connections) and a throwaway
   Shell extension that logs window/workspace facts. Deliverable: knowledge, plus a go/no-go on
   each capture source.
2. **M1 — Skeleton.** Flake, lint, test runner, CI green on a tool that only writes and reads back
   an empty snapshot. A green baseline before behaviour lands.
3. **M2 — Capture and restore apps.** App ids and documents from the high/medium-confidence
   sources; `restore` launches them; no workspace placement yet. First genuinely useful version.
4. **M3 — Workspaces.** The companion extension, the D-Bus surface, window→workspace capture, and
   placement on restore including launch-to-window matching.
5. **M4 — Terminals and commands.** Process-tree walk, cwd/cmdline capture, the consent model, and
   per-emulator restore.
6. **M5 — VPN.** NetworkManager capture and restore, systemd-unit VPNs, the secrets prompt.
7. **M6 — Polish.** Reviewable restore UI and the question flow, exclusions, systemd units,
   `restore-wss enable`, README, screenshots, `docs/limitations.md`.

Testing, per the repo's tests-first rule, splits three ways: snapshot schema, migration, plan
building, confidence scoring, consent matching and process-tree analysis are pure logic tested
against recorded fixtures (captured `/proc` trees and `nmcli` output) and run headless in CI; the
D-Bus surfaces are tested against a private bus with `dbus-run-session`; and real capture/restore
against a live GNOME session is a manual smoke test, recorded in `STATUS.md`, unless a nested
headless Shell turns out to be runnable on the CI runners.

## Risks / things to verify early

- **Tests must never touch the real desktop.** A capture-and-restore tool that runs its own smoke
  test can launch apps, switch workspaces, write `dconf` and bring a VPN up or down on the
  developer's actual machine. `dbus-run-session` alone does *not* isolate `dconf`. Every test
  runs with `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_RUNTIME_DIR` pointed at a
  temporary directory, and anything that would spawn a process or change network state is behind
  an injected executor that is stubbed by default. Verify this before the first capture test.
- **Wayland geometry control.** Whether Mutter honours `move_resize_frame()` for Wayland clients
  from an extension is the main assumption in M3. If it only holds for XWayland, placement
  degrades to workspace-only and `docs/limitations.md` says so.
- **Single-instance and Electron apps** hand a second launch to an existing process, producing no
  new window and no usable activation token — expect per-app handling and a matching fallback on
  app id and PID within a time window.
- **Snapshot freshness vs. write churn.** Too long an interval loses the last minutes of work; too
  short thrashes the disk and records transient states (an app mid-launch, a window mid-drag). The
  interval and the debounce need to be measured, not guessed, and a snapshot taken while the
  session was tearing down must be rejected as unsane.
- **Dynamic workspaces and changed monitors.** GNOME's workspace count varies with use, and a
  monitor may have been unplugged since capture; workspaces must be restored by index with
  creation as needed, and monitors identified by connector/EDID with a documented fallback.
- **`/proc` inspection is best-effort.** Open fds do not always name the document (memory-mapped
  or re-created files), `cwd` may have been changed since launch, and a flatpak or snap app's
  paths are namespaced. Each of these needs an explicit answer in `docs/capture-sources.md`.
- **Replaying commands is the sharpest edge in this tool.** Consent-first is the mitigation; it
  must not be softened into "remember everything and just run it" for convenience.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] How should restore-wss relate to `gnome-tasks` (idea 2)? They need almost the same capture layer (windows, workspaces, documents, terminals) and both want a GNOME Shell extension. Options: build restore-wss standalone and accept the duplication; build it as a consumer of gnome-tasks' `org.gnome.Tasks` daemon; or keep them separate now and extract a shared library later. `AGENTS.md` forbids touching another idea's folder, so this decides whether restore-wss can depend on gnome-tasks at all.
- [ ] Should restore happen automatically at login, or only when the user runs `restore-wss restore`? Automatic is what "restore the workspaces as they were" implies, but it means launching apps and possibly re-running commands before anyone has confirmed anything. Proposed default: automatic restore of the app/document/workspace/VPN parts, with commands and low-confidence items collected into a prompt shown once the session is up — is that the wanted behaviour?
- [ ] Is a GNOME Shell extension acceptable as a required companion component? Without one there is no way to know or set which workspace a window is on under Wayland; with one, the tool needs an install step beyond a package. If it is not acceptable, is "everything except workspace placement" an acceptable definition of done?
- [ ] Which terminal emulator(s) must be supported for command-line restore, and is it acceptable that a terminal is restored as *a fresh terminal in the right directory running the recorded command*, with scrollback, shell history and in-process state lost? Should multi-tab/multi-pane terminals restore their tab layout, or is one tab per recorded command enough?
- [ ] For VPNs, is restoring **only NetworkManager-managed connections** enough for now, with `wg-quick@`/`openvpn@` systemd units as a stretch? And when a connection needs a password or OTP that is not in the keyring, should restore-wss prompt at restore time, or just report "VPN X was active, reconnect it yourself"?
- [ ] How aggressive should document restore be for apps that already restore their own session (Codium, LibreOffice, browsers)? Letting the app do it risks restoring a *different* set than was open; forcing documents risks opening everything twice. Which default, and should it be per-app configurable from the start?
- [ ] What does the tool do when the user is *already* logged in with windows open and asks to restore — merge into the current session, refuse, or restore only the missing items? This also decides what happens if a restore is interrupted halfway and re-run.
- [ ] How is "done" verified given CI has no graphical session? Is unit-tests-plus-lint CI plus a manual smoke test recorded in `STATUS.md` acceptable, or must a nested headless GNOME Shell be made to work on the runners first?
