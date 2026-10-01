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

### Units — 5 of 9 done

- [x] **U1 — the room model.** `src/lib/rooms.js`: what a room is (`id`, `name`, `status`,
      `createdAt`, `joinUrl`), that the link taken is the **anonymous moderator** one, and
      the three-part check that a join URL really joins — `https:`, the instance's own host,
      and a non-empty `secret`. A link that fails any of them costs the room its button and
      not its row. 35 tests, including the degraded cases: no secret, another host, a
      disabled moderator link, no `access` object at all, and a `?not-secret=` that contains
      the word without being the parameter. **161 headless tests** in all.
- [x] **U2 — the two-level menu model.** `buildMenuModel(instances, roomStates)` returns
      instance rows with indented room rows beneath them, and the answered questions are
      pinned as tests: twenty rooms at most, most recently created first, closed ones listed
      too, a *…and N more* row for the remainder, and **one** destination per room, because
      the name does what the button does. Five states other than "here they are" are rows
      under the instance — no key, unreachable, refused, no rooms, and a request in flight —
      so a broken instance costs its rooms and not the menu. A room whose link `rooms.js`
      refuses is listed with **no** destination, so no button can be drawn. 33 tests, **194**
      in the suite.
- [x] **U3 — the API response** (`lib/client.js`), over an injected transport. The request
      (`GET …/api/v1/rooms?maxItems=100`, `X-API-KEY`, `Accept: application/json`) and the
      reading of every answer: `ok` with rooms — an empty list included — `refused` for 401
      and 403, `cancelled` for a request the caller abandoned, and `unreachable` for
      everything else, including a 200 whose body is a proxy's HTML login page. A failure
      state never carries rooms, so a stale list cannot survive through one. 33 tests,
      **227** in the suite.
- [x] **U4 — the API key, in the keyring.** `lib/keyring.js` over an injected keyring, so a
      locked one, a session with no secret service and an absent key are ordinary tests;
      `lib/secret-store.js` holds the three calls that need a running one, imported
      **dynamically and guarded** because `gnome-shell` depends on libsecret the library but
      not on `gir1.2-secret-1`, its typelib. `keyUpdates` turns an edit into what the keyring
      must be told, and its load-bearing distinction is that a row with *no* `apiKey` means
      "not read yet" while one with `''` means "emptied on purpose" — which is what stops a
      window opening faster than the keyring unlocks from deleting the key it was about to
      show. Verified end to end first: a real `gnome-keyring-daemon` under
      `dbus-run-session` stores, reads back and clears. 46 tests, **273** in the suite.
- [x] **U4b — the key field in the preferences window.** An `Adw.PasswordEntryRow` per
      instance, with a line saying where the key comes from and what it costs not to have
      one. Rows are drawn first and filled in when the keyring answers — unlocking one can
      be a dialog — and a lookup arriving after the user has edited the list is dropped
      rather than written over their edit. Writes are debounced by 400 ms, flushed on
      `close-request`, and a failed store marks its own row. 6 tests, **279** in the suite.
- [ ] **U5 — the room rows and the join button in the shell.** **Next.**
- [ ] U6 — the request itself: libsoup3, the cancellable, the timeout.
- [ ] U7 — the nested shell: a stub instance, the assertions, the screenshots.
- [ ] U8 — ship `v0.2`.

**Two things U2 added that the plan does not list**, both stated here rather than buried:

- **A fifth state, `loading`.** The plan names four *failures*; a request that has not
  answered yet is not one, but on the very first open there is no previous list to leave on
  screen and the alternative is a gap under the instance that reads as breakage. It is a
  note row like the others, and an instance with *no* state at all still gets no rows —
  which is 0.1's menu exactly.
- **A separator between instances.** With rooms indented underneath, the row after one
  instance's last room is the next instance, and without a rule between them the two levels
  read as one list.

### What the research settled, before any code

The plan's four facts about OpenVidu Meet are confirmed — and then pinned down properly
against **OpenVidu Meet's own OpenAPI specification**, `meet-ce/backend/openapi` in
`OpenVidu/openvidu-meet`, which the published documentation site only renders client-side
and so cannot be read from a fetch. None of this is an assumption any more:

- the list is `GET <instance>/api/v1/rooms`, authenticated with an **`X-API-KEY` header**,
  and the key is generated from the deployment's *Embedded* page;
- a room carries `roomId`, `roomName`, `owner`, `creationDate` (epoch milliseconds),
  `status`, and `access.anonymous.moderator.url` / `access.anonymous.speaker.url`;
- a role link looks exactly like `https://YOUR_DOMAIN/meet/room/room-123?secret=123456` —
  the documented example — so the `secret` parameter is what the check in `rooms.js` looks
  for;
- the statuses are exactly **`open`**, **`active_meeting`** and **`closed`**. The answered
  question asks for closed rooms listed too, so `status` is parsed and carried but does not
  filter.

And four things the specification settled that the plan could not:

- **The 200 envelope is `{rooms, _extraFields, pagination}`**, with
  `pagination.{isTruncated, nextPageToken, maxItems}`.
- **`maxItems` defaults to 10, is capped at 100, and answers `422` to zero or a negative
  value.** The request therefore asks for 100 — the default of 10 would have quietly shown a
  tenth of a deployment's rooms. Past 100 the API paginates and the *…and N more* row
  undercounts; the row goes to the instance, where all of them are, so the cost of not
  following `nextPageToken` is one inaccurate number on a deployment with far more rooms
  than a popup menu could usefully show.
- **`access.user.url` is the room's own page — the same path with no secret** — and it sits
  directly beside the moderator link in the same object. That is the degradation this entry
  is about, confirmed as a real neighbouring field rather than a hypothetical, which is why
  `rooms.js` requires a `secret` rather than merely preferring one.
- **A role URL is "present only when the caller holds the `roomShareAccessLinks`
  permission, removed otherwise".** A room with no link is an ordinary, documented case, not
  a malformed payload — so listing it without a button is the correct behaviour and not a
  defensive guess.

Two consequences worth stating now rather than at the end:

- **The API path is resolved relative to the instance URL.** The backend mounts itself at
  `/api/v1` and the deployment's proxy puts the Meet application under `/meet` — the
  specification's `servers:` entry reads `meet/api/v1`, and the API docs live at
  `/meet/api/v1/docs/`. An instance entered as `https://host/meet/` therefore has to reach
  `https://host/meet/api/v1/rooms`. Resolving relatively handles that deployment and the one
  at a domain root alike; an absolute `/api/v1/rooms` would have worked on the second and
  missed the first entirely.
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
