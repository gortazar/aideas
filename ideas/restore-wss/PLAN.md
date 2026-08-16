# Plan: restore-wss — put the workspaces back the way they were

Difficulty estimate: hard — a reboot destroys exactly the information needed (window↔app↔document
links, process trees, cwds), Wayland refuses to hand window state to anything outside the
compositor, and the snapshot has to survive an *unclean* power-off, so nothing can be deferred to a
logout hook; on top of that, replaying stored command lines and reconnecting a VPN are
security-sensitive by nature.

## Context

The user shuts the laptop down with seven workspaces full of work: a Thesis document in
LibreOffice on one, Codium with `my-app` open on another, a terminal in `my-repo` running
`claude -r`, another terminal holding an `ssh my-host` session, and a VPN up. After the reboot,
the desktop is empty. `restore-wss` is the tool that puts it back.

Four facts shape the design, and they are worth stating before the feature list.

1. **The snapshot must already exist when the power goes off.** A "save on logout" design — which
   is what X11's XSMP and `gnome-session`'s old `saved-session` mechanism were — cannot help with a
   crash, a kernel panic or a held-down power button, and on Wayland it barely helps at all. So
   capture is *continuous*: a daemon keeps a current snapshot on disk at all times, written
   atomically, and restore reads whatever the last good snapshot was. The saved state is a
   consequence of running, not of shutting down properly.
2. **Window state on Wayland is only visible from inside the compositor.** There is no `wmctrl`, no
   `_NET_CLIENT_LIST`, no cross-client window IDs. Which workspace a window is on, which monitor,
   its geometry, its `wm_class` and its PID are reachable only through `Meta.Window` /
   `Shell.WindowTracker` — i.e. from a GNOME Shell extension running in the compositor process.
   Everything else (reading `/proc`, writing files, spawning apps, talking to NetworkManager) must
   happen *outside* it, or the desktop stutters and a crash takes the session down. Hence the same
   two-part shape as idea 2: a thin **extension** that observes and places windows, and a
   **daemon** that owns state and does the work, talking over the session bus.
3. **The standards-track answer exists but is not usable yet.** `xx_session_management_v1` (the
   staging Wayland session-management protocol) lets an app ask the compositor for a token, tag
   each toplevel with a name, and get its state restored on the next run. KWin merged support for
   Plasma 6.4 (June 2025); Mutter has groundwork landing but GNOME's own session save/restore is
   *not* complete as of GNOME 51, and there is a parallel xdg-desktop-portal discussion about a
   session save/restore portal. Crucially, even when it ships it only works for apps that opt in,
   which will not include most of what this user runs for years. `restore-wss` is therefore built
   on introspection and heuristics, and M0 verifies where the protocol actually stands on the
   target machine so the design can prefer it for the apps that support it.
4. **Restoring is a guess, and a guess that runs commands.** "Which document is this window
   showing?" has no general answer on Linux, and "what was this terminal running?" is answered by
   reading a process's `cmdline`, which can contain secrets and which it is not always safe to
   replay. The design treats per-app knowledge as a *capability tier*, and treats stored commands
   as *proposals the user confirms*, not as a script to execute.

Assumptions, stated rather than asked: the target is the GNOME Shell version installed on the
development machine, Wayland only, X11 not supported (this matches the answers already given for
idea 2). Browser tabs are deliberately **out of scope here** — idea 4 covers them for this same
folder — but the state schema leaves room for a browser adapter to fill in later.

## Features

- **In-depth study of prior art** — `docs/similar-tools.md`, written first and from actual
  inspection rather than recollection, covering at minimum: X11 session management (XSMP,
  `gnome-session`'s `~/.config/gnome-session/saved-session` `.desktop` files and why it is dead on
  Wayland); KDE's `ksmserver` session restore and what it does that GNOME does not;
  `xx_session_management_v1` and the xdg-desktop-portal session-restore discussion; the GNOME
  extensions in this space (`smart-auto-move`, its `SmartAutoMoveNG` fork, `window-session-manager`,
  `window-state-manager`) and specifically how they solve window identity — `smart-auto-move`
  matches on `wm_class` plus a character-histogram distance over window titles, which is the best
  documented heuristic available and a candidate to reuse; the tiling-WM tools (`i3-resurrect`,
  `i3-restore`), which are the closest thing to what this idea asks for and get the *programs* half
  right by saving each window's `cmdline` and `cwd` from `/proc`; `tmux-resurrect`/`tmux-continuum`,
  whose default of restoring only a conservative whitelist of programs is the safety precedent this
  plan adopts; `xsession-manager`; and CRIU, with a written reason for rejecting true
  checkpoint/restore. Each entry says what it does, what it cannot do, and what `restore-wss` takes
  from it.
- **Continuous session capture** — a user-level daemon (`restore-wss-daemon`) that maintains a live
  picture of every workspace: for each window, the application (desktop-file id / `wm_class`), the
  workspace index, the monitor (identified by connector + EDID so replugging a display does not
  invalidate the snapshot), geometry, maximised/fullscreen/minimised state, stacking order, window
  title, and PID. Fed by events the extension forwards (`window-created`, `workspace-changed`,
  `position-changed`, `size-changed`, `unmanaged`, `app-state-changed`), debounced so dragging a
  window does not cause a write storm.
- **Crash-safe snapshot storage** — the state lives in `~/.restore-wss/` as the idea requires:
  `config.toml` (user settings, per-app overrides, exclusions) and `state/session.json` (the
  current snapshot, versioned schema, written to a temp file and `rename(2)`d over the old one,
  with the previous generation retained as `session.prev.json`). A snapshot is never half-written,
  and a torn or unreadable snapshot falls back to the previous generation instead of losing
  everything. Both files are human-readable and hand-editable on purpose.
- **Document and folder tracking, tiered by app** — what "LibreOffice with the Thesis document" is
  recorded as, with an honest ladder rather than one mechanism pretending to cover everything:
  - *Tier 0 — app only.* Restore launches the app with no arguments.
  - *Tier 1 — document/folder recovered by introspection.* In order of preference: the app's own
    D-Bus interface where it has one; the GTK application/window object path exposed on the window;
    open files under `/proc/<pid>/fd` and the process's `/proc/<pid>/cwd`, filtered to real
    documents; the freedesktop recent-files store (`~/.local/share/recently-used.xbel`) correlated
    by app and timestamp; and last, per-app title parsing declared explicitly for that app (this is
    how "Thesis — LibreOffice Writer" and a Codium window titled after `my-app` become a path).
  - *Tier 2 — app cooperates.* Reserved for apps that can report their own state; the browser
    adapter of idea 4 is the first one. Not built here, but the schema and the D-Bus API allow it.
  Every restored document carries a *confidence* value, and low-confidence guesses are what the
  review step (below) puts in front of the user.
- **Command-line session capture** — for terminal windows, the part `i3-resurrect` gets right and
  the desktop tools ignore: from the window's PID, walk the process tree in `/proc` to find the
  foreground descendants, and record each one's `cmdline`, `cwd`, and the terminal tab it lived in.
  This is what turns a window into "a terminal in `~/git/my-repo` running `claude -r`" or "a
  terminal running `ssh my-host`". Secrets are handled up front: arguments matching configurable
  patterns (`--password`, `--token`, anything that looks like a key) are redacted at capture time,
  never written to disk, and marked so restore knows to ask.
- **Command restore with a confirmation gate** — commands are proposals, not a script. A restored
  terminal is always reopened at the right `cwd` on the right workspace; whether the command is
  *re-run* follows a three-level policy in `config.toml`: `never` (open the shell only),
  `whitelist` (the default — re-run only commands whose program is on an allow-list, seeded with
  the obvious safe ones like `ssh`, `claude`, `top`, `htop`, editors, and extendable by the user),
  or `always`. Anything not covered by the policy is offered in the review step. `rm -rf`-shaped
  history never runs by accident, and a command containing a redaction is never auto-run.
- **Workspace-faithful restore** — restore recreates the workspaces themselves (creating enough of
  them under GNOME's dynamic-workspaces setting), launches each application via
  `Gio.DesktopAppInfo` with its documents, and places the resulting window on the recorded
  workspace, monitor and geometry. New windows are matched back to the launch that asked for them
  using activation tokens (`XDG_ACTIVATION_TOKEN`), falling back to app id and then PID within a
  time window. Restore is **idempotent**: running it when some of the session is already up matches
  existing windows first and only launches what is missing, so it can be re-run safely and can
  finish a partial restore.
- **Interactive review, only where it earns its place** — the idea explicitly allows asking the
  user, so `restore-wss restore` shows what it is about to do and lets the user accept, skip or
  edit each item, with everything it is confident about pre-ticked. Unattended use is a flag
  (`--yes`), not the default. The same mechanism handles capture-time unknowns: an app whose
  document could not be determined can be annotated once by the user and remembered in
  `config.toml` for next time.
- **VPN capture and restore** — record which VPN was active, via NetworkManager's D-Bus API
  (`nmcli`-equivalent, covering NM's OpenVPN/WireGuard/IPsec connection types) as the primary
  source, plus detection of VPNs NetworkManager does not own: `wg-quick`/`wg show` interfaces,
  `tailscale`, and `openvpn`/`openconnect` running as systemd user or system units. Only the
  connection's identity is stored — never credentials. Restore reactivates the connection where
  that can be done non-interactively (secrets already in the keyring), and otherwise reports what
  needs to be brought up by hand and offers to open the right dialog. A VPN that needs a password
  or 2FA is a prompt, not a failure.
- **CLI with a small honest surface** — `restore-wss status` (what is currently captured),
  `save` (force a snapshot now), `restore` (the review-and-restore flow), `list` (snapshots
  available), `diff` (what the snapshot says versus what is running now), and `daemon` (run the
  capture loop, normally started as a systemd user unit). `--json` output on the read-only
  commands.
- **Login integration** — a systemd user unit starts the daemon on session start, and an optional
  autostart entry offers the restore on first login after a reboot, detected by comparing the
  snapshot's boot id with the current one so that logging out and back in does not trigger it
  spuriously.
- **Exclusions, pause, and privacy** — a per-app and per-path exclusion list, a global pause
  switch, and a rule that nothing ever leaves the machine. Recording which documents a user opens
  and which commands they run is a surveillance-shaped feature; the file is theirs, local,
  readable, and deletable, and `~/.restore-wss/state/` is created mode `0700`.
- **Reproducible environment + green CI** — `flake.nix` for dev/test/build, unit tests over
  committed fixtures (recorded `/proc` trees, window-event traces, NetworkManager states) so the
  logic is testable without a live desktop, and a path-filtered
  `.github/workflows/ci-restore-wss.yml`.
- **README with real evidence** — install, usage, the config-file reference, the snapshot schema,
  the safety model for commands, and screenshots of a real before/after restore.

## Documentation deliverables

- `docs/similar-tools.md` — the prior-art study described above. This is the first deliverable, and
  its conclusions are allowed to change the rest of the plan.
- `docs/state-schema.md` — the `session.json` and `config.toml` formats, versioning and migration.
- `docs/app-adapters.md` — the tier model, the adapter interface, and how to add an app; one worked
  example per tier (a plain GTK app, LibreOffice, Codium, a terminal).
- `docs/limitations.md` — the honest list of what cannot be restored and why: unsaved buffers,
  scroll positions, shell history and in-shell state, `sudo` sessions, anything behind a login.

## Approach

Sequenced so the research that could invalidate the design comes first, and so each milestone
leaves something a person can actually use.

1. **M0 — Prior art + probe.** Write `docs/similar-tools.md`. In parallel, build a throwaway probe
   extension that dumps every reachable window property and a `/proc` walker for a realistic
   desktop (LibreOffice, Codium, GNOME Terminal with an ssh and a `claude` session, a Flatpak app),
   and check the current state of `xx_session_management_v1` in the installed Mutter. Deliverable:
   knowledge, fixtures, and a go/no-go on the tier-1 sources.
2. **M1 — Skeleton.** Flake, test runner, CI green, daemon and extension that do nothing but talk
   to each other over D-Bus, and `restore-wss status` printing an empty session.
3. **M2 — Capture and snapshot.** Window inventory per workspace, atomic writes to
   `~/.restore-wss/state/session.json`, the schema, `save`/`status`/`diff`. Verified by killing the
   daemon mid-write and checking the snapshot is still readable.
4. **M3 — Restore, apps only.** Launch apps, recreate workspaces, place windows, token matching,
   idempotency. First genuinely useful version.
5. **M4 — Documents (tier 1).** Adapter framework plus adapters for the apps M0 showed to be
   tractable, with confidence scoring.
6. **M5 — Terminals and commands.** Process-tree capture, cwd, redaction, the whitelist policy, and
   the confirmation gate.
7. **M6 — VPN.** NetworkManager first, then the non-NM detectors.
8. **M7 — Review UX, login integration, README, screenshots, `docs/limitations.md`.**

Per the repo's tests-first rule the suite splits three ways: snapshot schema, migration, window
matching, monitor remapping, redaction, command policy and confidence scoring are pure logic tested
against fixtures; the daemon's D-Bus surface is tested on a private bus with `dbus-run-session`;
and full capture/restore is a manual smoke test whose result is recorded in `STATUS.md`, with a
nested headless Shell attempted in CI but treated as a risk rather than a plan.

## Risks / things to verify early

- **Window identity across a reboot.** There is no stable window ID, so matching a saved slot to a
  newly appeared window is heuristic. `smart-auto-move`'s `wm_class` + title-histogram approach is
  the reference; expect it to mismatch when several windows of the same app are open, and design
  the review step so a mismatch is correctable rather than silent.
- **Single-instance, Flatpak and Electron apps.** A second launch handed to an existing process
  produces no new window and no usable activation token, and Flatpak sandboxing hides `/proc` of
  the app from us. These need per-app handling and may cap out at tier 0.
- **Terminals are the hard case and the most valuable one.** Which process is "the" foreground one,
  what a multi-tab terminal looks like from outside, and whether the terminal emulator can even be
  told to open N tabs with N different cwds and commands all vary per emulator. Verify against the
  emulator actually in use before promising multi-tab restore.
- **Replaying commands is the sharpest edge in the whole idea.** The whitelist default, redaction,
  and the confirmation gate exist because a stored `cmdline` is untrusted input that was captured
  without the user thinking about it. Anything that weakens those three needs to be a deliberate
  user choice.
- **VPN reconnection may be impossible unattended** — credentials, 2FA and captive portals. Report
  clearly instead of retrying blindly.
- **Wayland geometry control.** Whether Mutter honours `move_resize_frame()` for all Wayland
  clients from an extension is the main assumption in M3; if it holds only for some, placement
  degrades to workspace + monitor and `docs/limitations.md` says so.
- **Unclean shutdown is the normal case, not the edge case.** The snapshot cadence has to be
  frequent enough that "as they were before the power off" is true, and cheap enough not to hurt
  battery or SSD. Measure it.
- **Overlap with idea 2 (`gnome-tasks`).** Capture, placement, adapters and the extension/daemon
  split are nearly the same machinery for a different purpose. Building both independently means
  writing it twice — see the first open question.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] How should `restore-wss` relate to `gnome-tasks` (idea 2)? They need the same window-capture
      extension, the same app adapters and the same placement logic, differing mainly in what
      triggers a restore (a reboot versus a task switch). Options: (a) build `restore-wss`
      standalone and accept the duplication, (b) build it as a client of the `gnome-tasks` daemon,
      treating "the session at shutdown" as an implicit task, (c) extract the shared capture/restore
      core into a component both use. Which? c
- [x] Should restore happen automatically at the first login after a reboot, or only when the user
      runs `restore-wss restore` (or clicks a notification)? Automatic is what "restore the
      workspaces" literally asks for, but it launches a dozen apps and possibly commands
      unattended, which is a lot to do to someone who just wanted to check their email. Make it configurable.
- [x] Is the command re-run policy right? The plan defaults to `whitelist` — reopen every terminal
      at its correct working directory, but only re-execute commands whose program is on an
      allow-list (`ssh`, `claude`, editors, …), offering the rest in the review step. Is that the
      wanted default, or should captured commands always be re-run, or never? that's the desired behavior.
- [x] Which VPN setups actually need supporting on this machine — NetworkManager connections only,
      or also `wg-quick`, `tailscale`, or an `openvpn`/`openconnect` invocation? Supporting only NM
      is a fraction of the work. network manager only
- [x] What should the interactive review look like: a terminal TUI (fine when the user runs
      `restore` themselves, wrong for an automatic login restore), a GTK/libadwaita dialog, or a
      GNOME notification that opens one? This follows from the automatic-versus-manual answer.gtk libadwaita 
- [x] Should only the latest snapshot be kept, or a short history the user can restore from
      ("yesterday morning's workspaces"), and should the user be able to save a snapshot under a
      name and restore it deliberately? History is cheap to store but adds a whole selection UX. no history
- [x] What is the daemon written in? The extension must be GJS (compositor access), but the daemon
      does `/proc` parsing, D-Bus and NetworkManager work where Python 3 + PyGObject is the boring,
      well-supported choice. The alternative is GJS everywhere so the two halves share code — which
      also matters for the first question above. Preference? Python 
- [x] Does "restore the workspaces as they were" include restoring the *desktop-level* state around
      them — workspace names, which workspace was active, and window stacking/focus order — or only
      which apps are where? The plan captures active workspace and stacking but treats names and
      exact focus order as best-effort. Whatever is possible without a huge effort
