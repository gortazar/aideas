status: in_progress
version: 0.1
started_at: 2026-08-28
last_session_id: 259b11be-e715-4112-802e-a582b86d5fb9
last_run: 2026-08-28T10:09:49+02:00
last_cycle_cost_usd: 23.70250049999999

## Log
- 2026-08-28T10:09:49+02:00 — done ($23.70250049999999)

## This entry — 0.2: the rooms of each instance, and a button that joins the call

`version:` above still reads `0.1` and moves to **`0.2`** in the same commit as
`status: done`, per the cycle header. The `README.md` entry does not say which kind of
update it is, so `AGENTS.md`'s default applies: **minor**.

Branch `agent/meet/2026-10-01` on `gortazar/meet`.

### Units — 1 of 8 done

- [x] **U1 — the room model.** `src/lib/rooms.js`: what a room is (`id`, `name`, `status`,
      `createdAt`, `joinUrl`), that the link taken is the **anonymous moderator** one, and
      the three-part check that a join URL really joins — `https:`, the instance's own host,
      and a non-empty `secret`. A link that fails any of them costs the room its button and
      not its row. 35 tests, including the degraded cases: no secret, another host, a
      disabled moderator link, no `access` object at all, and a `?not-secret=` that contains
      the word without being the parameter. **161 headless tests** in all.
- [ ] **U2 — the two-level menu model.** `buildMenuModel` over instances plus a per-instance
      room state: instance rows, indented room rows, the four failure notes, the cap and the
      order. **Next.**
- [ ] U3 — the API response, over an injected transport (`lib/client.js`).
- [ ] U4 — the API key in preferences, in the keyring.
- [ ] U5 — the room rows and the join button in the shell.
- [ ] U6 — the request itself: libsoup3, the cancellable, the timeout.
- [ ] U7 — the nested shell: a stub instance, the assertions, the screenshots.
- [ ] U8 — ship `v0.2`.

### What the research settled, before any code

The plan's four facts about OpenVidu Meet are confirmed against the 3.8 documentation, so
none of them is an assumption any more:

- the list is `GET <instance>/api/v1/rooms`, authenticated with an **`X-API-KEY` header**,
  and the key is generated from the deployment's *Embedded* page;
- a room carries `roomId`, `roomName`, `owner`, `creationDate` (epoch milliseconds),
  `status`, and `access.anonymous.moderator.url` / `access.anonymous.speaker.url`;
- a role link looks exactly like `https://YOUR_DOMAIN/meet/room/room-123?secret=123456` —
  the documented example — so the `secret` parameter is what the check in `rooms.js` looks
  for;
- the statuses are **open**, **active meeting** and **closed**. The answered question asks
  for closed rooms listed too, so `status` is parsed and carried but does not filter.

Two consequences worth stating now rather than at the end:

- **The API path is resolved relative to the instance URL.** The documentation's own
  deployment serves the app under `/meet`, and its API docs at `/meet/api/v1/docs/`. An
  instance entered as `https://host/meet/` therefore has to reach
  `https://host/meet/api/v1/rooms`, not `https://host/api/v1/rooms`. Resolving relatively
  handles both, and costs an instance at the domain root nothing.
- **`gi://Secret` and `gi://Soup` (3.0) are both present** and usable from plain `gjs` on
  this machine, so the keyring answer to open question 2 and the libsoup half of U6 are
  both buildable as planned. Checked, not assumed.

### Previously — 2026-08-28, 0.1 (one click from the top bar into an OpenVidu Meet room)

A button in the GNOME Shell top bar whose menu lists your meeting rooms. Click one and it
opens in your default browser. **Meet next** and **Meet** ship with it as ordinary
entries — renameable, repointable, reorderable, removable — and a preferences window adds
your own.

- **Released**: [v0.1](https://github.com/gortazar/meet/releases/tag/v0.1) from
  [ca3152d](https://github.com/gortazar/meet/commit/ca3152d), the merge of pull request
  [#1](https://github.com/gortazar/meet/pull/1). Both assets published — the packed
  extension and its SHA-256 — and `scripts/check-release.sh` confirms the zip contains
  everything the shell needs and declares the right uuid.
- **Install-verified** from a clean directory, with `HOME` and `XDG_DATA_HOME` redirected so
  it could not touch this machine's session: the published installer downloaded the asset,
  the checksum matched, 13 files landed, and `gnome-extensions enable` succeeded.
- **The published artefact itself was run in a real headless GNOME Shell 46** — not just
  downloaded. The zip whose sha256 is `e1d35d26…`, the one on the release page, passes all
  27 smoke-test checks: the icon is drawn, the menu lists both rooms, clicking **Meet**
  reaches a stub browser with `https://meet.openvidu.io/`, and five enable/disable rounds
  leave no timer behind.
- **126 headless tests** under plain `gjs`, green in `nix flake check` alongside ESLint and
  the packed zip assembled and inspected.
- **Quality gate green** on `main`, all ratings A, 0 bugs, 0 vulnerabilities, 0 code smells,
  0% duplication, and **no open issues of any severity** — the five Sonar found were fixed
  rather than dismissed. `CI` on `main` is green at
  [6fae6b7](https://github.com/gortazar/meet/commit/6fae6b7).

Its ten units were: the environment and a green pipeline; the destinations model; the
launcher over an injected seam; the symbolic panel icon, tested as an image; configurable
destinations with their schema and preferences window; the panel button and its menu; the
nested-shell smoke test; the installer and README; the wrapper here; and the release with
its two follow-ups.

**The release is `v0.1` = `ca3152d`.** Two follow-ups landed on `main` after it: the
`MEET_INSTALL_ZIP` smoke-test path, which is test tooling and is not in the packed zip at
all, and the Sonar fixes, which are `catch {` in place of `catch (e) { void e; }` and one
`push` in place of three — no behaviour change. Neither is worth moving a published tag for;
both ship with the next version.

## Notes

**From 0.1, and all still true.** Every one of these looks fine in a diff:

- The OpenVidu logo **may not be vendored**: the panel carries an **original symbolic icon**
  drawn to resemble the logo's arrangement, in the single colour GTK recolours symbolic
  icons with.
- `Adw.ExpanderRow.add_suffix` puts widgets on screen in the reverse of the order they were
  added. The buttons go in one `Gtk.Box`, which packs in the order written. Found by looking
  at the nested shell's screenshot, not by reading the code.
- A pixel measurement **cannot** tell a working preferences page from a broken one. GNOME's
  error page scored 1.63% dark against the real page's 0.42%, so "did it draw anything"
  passes on the broken case. What catches it is the log line `Failed to open preferences`,
  which carries no uuid and so slipped through the existing scan.
- A synthetic pointer click into the preferences window does not reach GTK clients under
  headless Wayland. Tried and dropped: a click that silently misses is worse than no click.
- **The orchestrator's sweep had pushed a branch literally named `HEAD`** at the rescued
  commit, and `github:gortazar/meet` then resolved to it. `check-pin.sh` now warns when a
  pin is not on `origin/main`.
- Auto-merge fires the moment checks go green. A commit pushed to a branch after arming it
  misses the merge and silently recreates the branch. Arm it last.
- **The very first `sonar / Analysis` on `main` fails, and it is not a quality problem.**
  The run on `ca3152d` — the release commit — is red, with gate status `NONE` rather than
  `ERROR`: a first analysis has no new-code period to evaluate against, and the shared
  workflow reads anything other than `OK` as a failure. The next push computed a gate and
  went green.

Difficulty estimate: **medium**, as the plan says — the model and the menu are small, but a
network call from inside the compositor brings a credential to store, a request to cancel,
and four failure states that all have to read as menu rows.
