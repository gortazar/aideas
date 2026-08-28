status: not_started
version: 0.2
started_at: 2026-08-16
last_session_id: ebf1ecd2-6691-4213-9815-2f9920396ad5
last_run: 2026-08-17T21:37:37+02:00
last_cycle_cost_usd: 38.504905

## Log
- 2026-08-17T21:37:37+02:00 — done ($38.504905)
- 2026-08-17T01:17:09+02:00 — done ($9.534980500000001)
- 2026-08-16T22:39:18+02:00 — in_progress ($20.323337000000002)



## Units — v0.2 (browsers and the tabs inside them)
- [x] B0 — `docs/browser-extensions-research.md`: eleven candidates read from source plus two probes
      of this machine; go/no-go written; conclusions below

- [x] B1 — the `browser` block: family, version, profile, the browser's own window id, an ordered
      tab list, the source it came from and the correlation's confidence; a v0.1 snapshot reads and
      restores unchanged, tested in both directions
- [x] B2 — capture from two sources: the add-on through a native-messaging **file drop** (not D-Bus,
      per B0), and Firefox's `recovery.jsonlz4` through a 40-line pure-Python mozlz4 reader
- [x] B3 — correlation: title-first with a confidence, geometry only as a tiebreak, and a refusal
      ("a browser window, tabs unknown") when two windows look alike but hold different tabs
- [x] B4 — restore as **reconciliation**: a window Firefox already brought back is left alone even
      if it has since gained tabs, a missing one is created whole, tabs are never appended
- [x] B5 — installer for the browser half (verified into a fake home), the packaged `.xpi` with a
      secret-gated AMO signing step, the review window's browser switch, four docs updated, and a
      new screenshot

**Green:** `nix flake check` — 247 unit tests, 9 D-Bus tests, ruff, extension + add-on manifest
checks. Green in GitHub Actions on the `v0.2` tag (CI and Release both `success`).

**Released as v0.2**, and the published installer was run from a clean directory: checksum verified,
the Firefox bridge written to `~/snap/firefox/common/.mozilla/native-messaging-hosts/` with the right
absolute host path and the add-on id pinned, the `.xpi` delivered, `restore-wss --version` → `0.2`,
and the *installed* copy reading the live Firefox profile (6 windows, 28 tabs).

### Verified against real things

- **The whole browser capture path against the live Firefox profile**: 6 windows, 27 tabs, 3 pinned;
  every window correlated to its own tab set; `restore-wss status` printing tab counts and previews
  per window.
- **The shipped native host run as a real process**: framed messages in, `report.json` out, and a
  restore request picked up while the browser said nothing — the case the `select()` loop exists for.
- **The installer's browser half**, run into a fake home: manifest written to the snap path with the
  right absolute host path, host executable, `.xpi` delivered.
- **The AppArmor and mozlz4 probes** behind B0, both committed as evidence.

### What is built but not verified

- **The add-on has never run in a real Firefox.** Every byte of the protocol is tested — including
  against the shipped host — but installing it needs a signed `.xpi` (or a temporary add-on loaded by
  hand in a browser holding the user's live session), and signing needs the user's AMO credentials.
  The session-file route, which needs no add-on, *is* verified against the real profile.
- **No screenshot of two browser windows with different tabs on two workspaces.** That needs Firefox
  inside the nested Shell, and snapd refuses to launch a confined app from an arbitrary cgroup — the
  same wall v0.1 hit for LibreOffice. The review-window screenshot is real; that one is not possible
  here.
- **`tools/smoke-nested.sh` has not been re-run** since v0.1's M3 (a browser cannot take part in it
  for the reason above).

### What B0 changed in the plan

- **The transport cannot be D-Bus.** This machine's AppArmor profile lets Firefox execute a native
  host under `~/snap/firefox/` (`ix`), but `ix` inherits the browser's confinement, and the profile's
  140 session-bus rules are per-name allow-lists with no room for `org.gnome.RestoreWss`. The bridge
  is a **file drop** under `~/snap/firefox/common/`. Evidence:
  `docs/probe-data/snap-firefox-apparmor.txt`.
- **The offline reader is promoted from footnote to a shipped tier.** `recovery.jsonlz4` decodes with
  a 40-line pure-Python mozlz4 reader and holds 6 windows / 27 tabs with url, title, pinned,
  selected, groups *and* per-window geometry — with no extension and no permission at all.
- **No third-party extension is adopted.** The session managers expose no interface (Tab Session
  Manager has no `nativeMessaging` permission at all); `brotab` does, but via an unauthenticated
  localhost HTTP service exposing tab text, HTML and screenshots, and it cannot work with snap
  Firefox as installed. The sibling `gnome-tasks` extension is adapted with attribution; its D-Bus
  host is replaced.
- **Correlation stays title-first**: every window on this machine reports `1165x1408 @0,0
  maximized`, so geometry cannot break ties here.
- **Signing needs the user's AMO credentials.** CI will run `web-ext sign` only when
  `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` exist; until then the released `.xpi` is unsigned and the README
  says so.

## Units — v0.1 (delivered, released as v0.1)
- [x] Upstream repository created (`gortazar/restore-wss`), pinned here as the `upstream` submodule
- [x] M0a — `docs/similar-tools.md`: eleven tools read from source, plus `tools/wayland-globals.sh`
      and its committed output proving GNOME 46 here has no session-management Wayland global
- [x] M0b — `docs/platform-findings.md` + `tools/proc-probe.py` + `tools/nested-shell.sh`: the
      terminal question answered against a real `gnome-terminal`, with two committed process-tree
      fixtures
- [x] M1 — skeleton: `flake.nix` (unit, D-Bus, ruff and extension-syntax checks), `Makefile`, CI,
      the `org.gnome.SessionCore` extension, the `org.gnome.RestoreWss` daemon, `restore-wss status`
- [x] M2 — capture and crash-safe snapshot storage (temp + fsync + rename, previous generation
      retained, torn file falls back)
- [x] M3 — restore: the ported window matcher, the idempotent plan, the extension's placement and
      launch methods, `restore-wss restore` with `--dry-run`/`--yes`/`--json`
- [x] M4 — documents: the per-application adapter table, five sources in order of preference, a
      confidence on each, and readers for both recent-document stores
- [x] M5 — terminals and commands: `/proc` capture of tabs, working directories and foreground
      jobs; capture-time redaction; the `never`/`whitelist`/`always` policy with its two overrides;
      terminal restore as argv with no shell
- [x] M6 — VPN: NetworkManager only, identity only, `needs-you` rather than failure when it wants
      a password
- [x] M7 — the GTK/libadwaita review window, the systemd user unit and login check, `list` and
      `diff`, the four documentation deliverables, the README, the installer and the v0.1 release

**Green:** `nix flake check` upstream — 174 unit tests, 9 D-Bus tests on a private bus, ruff,
extension syntax. Green in GitHub Actions too (CI and Release workflows on the v0.1 tag).
`nix flake check` here — the pinned commit's unit suite plus a deliverables check;
`scripts/check-pin.sh` passes.

## What "done" covers

Every feature in `PLAN.md` is built, tested and released as **v0.1**, installable with:

```console
curl -fsSL https://raw.githubusercontent.com/gortazar/restore-wss/main/install.sh | sh
```

| Feature | Where |
| --- | --- |
| In-depth study of prior art | `docs/similar-tools.md` — eleven tools read from source, each with what it cannot do and what this takes from it |
| Continuous session capture | extension signals → daemon, debounced and rate-limited; never a logout hook |
| Crash-safe snapshot storage | `src/restore_wss/storage.py`: temp + fsync + rename, `session.prev.json`, mode 0700 |
| Documents, tiered by app | `src/restore_wss/documents.py` + `recentfiles.py`, confidence per source |
| Command-line session capture | `procwalk.py` + `terminals.py`: tabs, per-tab cwd, foreground job, redaction at capture time |
| Command restore with a confirmation gate | `policy.py`: whitelist by default, deny-list and redaction override the mode in both directions |
| Workspace-faithful restore | `plan.py` + `restore.py` + `src/extension/placement.js`; idempotent, monitor-relative geometry |
| Interactive review | `review.py`, GTK4/libadwaita; screenshot in the README |
| VPN capture and restore | `vpn.py`, NetworkManager only |
| CLI | `status`, `save`, `list`, `diff`, `restore`, `daemon`, `login-check`, `--json` on the read-only ones |
| Login integration | `data/systemd/restore-wss.service` + `data/autostart/…`; boot-id comparison in `login.py` |
| Exclusions, pause, privacy | `config.toml`; nothing leaves the machine; state dir 0700 |
| Reproducible environment + green CI | `flake.nix` upstream and here; `.github/workflows/ci-restore-wss.yml` |
| README with real evidence | install command first, worked example, screenshot, six documents |

### Verified against real things, not only fakes

* **`tools/smoke-nested.sh`: all 8 checks passed** on a real headless GNOME Shell 46 with
  `gnome-terminal` — capture, an unprompted write, and a full restore that put the window back on
  the workspace and at the position it was captured on (the terminal rounded 700x500 to 694x489,
  its character grid, which is the "the app's own size wins" finding observed again).
* **The published installer was run from a clean directory** against the real release asset:
  checksum verified, CLI, extension, unit and autostart entry installed, `restore-wss --version`,
  `list` and `status` all correct.
* **NetworkManager** was read on this machine: one active VPN, 28 known connections.
* **Both recent-document stores** were read here: 400 freedesktop entries across 12 applications,
  and 25 entries in LibreOffice's own picklist.
* The **review window** was rendered and screenshotted in a nested session.

### What is built but not verified

Stated plainly, because "done" should not imply more than was checked:

* **The smoke test was last run in full at M3.** M4–M7 (documents, terminals, VPN, the review
  window) are covered by unit and D-Bus tests and by the individual real-world checks above, but
  the eight-step end-to-end script has not been re-run since; the session was asked to stop before
  it did. Re-running `tools/smoke-nested.sh` is the first thing to do if this is picked up again.
* **Nobody has installed this into a real logged-in session.** The extension has only run in a
  nested Shell; `make install` plus a log out needs the machine's owner.
* **LibreOffice and Codium capture were never exercised**: both are snaps here, and snapd refuses
  to launch a confined app into the nested session. The LibreOffice *picklist reader* was checked
  against the real file; the window-to-document correlation was not.
* **Connector stability across a real replug** is untested — one virtual monitor in the harness.
* **Which terminal window owns which tab** is an open gap, documented in `docs/limitations.md`:
  with two terminal windows open, tabs may be grouped onto the wrong window.

## Findings that changed the plan

- `xx_session_management_v1` has been renamed and promoted: it is `xdg-session-management-v1` in
  wayland-protocols *staging* since 2026-03-23. Mutter has implemented it since the `gnome-47`
  branch (storing state in a GVDB file), KWin since 2026-04. **Not on this machine** — GNOME 46's
  registry advertises no such global (`docs/probe-data/wayland-globals.txt`) — and still opt-in per
  application everywhere, so the introspection design stood; the schema reserves
  `session_protocol` for windows that restore themselves.
- The command-replay allow-list is not excessive caution: `i3-restore` and `tmux-resurrect` both
  landed on the same answer, while Another Window Session Manager and `i3-resurrect` replay
  captured command lines through a shell unreviewed.
- Terminal tabs *are* enumerable from `/proc` with no help from the emulator, which made multi-tab
  capture possible — a risk `PLAN.md` flagged and the probe retired.
- LibreOffice does not write to `recently-used.xbel`; the headline "Thesis in LibreOffice" case
  needs its own picklist reader.
- Two in-process D-Bus deadlocks shaped the code: an extension cannot call
  `org.gnome.Mutter.DisplayConfig` synchronously (mutter serves it), and a test cannot call a
  service it hosts itself.

Difficulty estimate: **hard**, as `PLAN.md` said — two processes, a platform that hides what the
idea needs, and security-sensitive replay. The prior-art study and the `/proc` probe are what made
it tractable.
