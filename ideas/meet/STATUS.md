status: not_started
version: 0.2
started_at: 2026-08-28
last_session_id: a8a338d4-3bad-427b-bd3d-112da5346bf3
last_run: 2026-10-01T10:26:18+02:00
last_cycle_cost_usd: 36.152480999999995

## Log
- 2026-10-01T10:26:18+02:00 — done ($36.152480999999995)
- 2026-10-01T09:42:37+02:00 — in_progress ($0.0)
- 2026-08-28T10:09:49+02:00 — done ($23.70250049999999)



## This entry — 0.2: the rooms of each instance, and a button that joins the call

`version:` above still reads `0.1` and moves to **`0.2`** in the same commit as
`status: done`, per the cycle header. The `README.md` entry does not say which kind of
update it is, so `AGENTS.md`'s default applies: **minor**.

**Released: [v0.2](https://github.com/gortazar/meet/releases/tag/v0.2)** from
[354e8c2](https://github.com/gortazar/meet/commit/354e8c2), the merge of pull request
[#4](https://github.com/gortazar/meet/pull/4). Both pins here name that commit.

The previous cycle's sweep rescued U7 to `agent/meet-sweep`; that commit sat directly on the
agent branch's tip, so it was reworded onto `agent/meet/2026-10-01` rather than opened as a
second pull request. Both branches are deleted now that #4 is merged.

### Units — 9 of 9 done

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
- [x] **U5 — the room rows and the join button in the shell.** A custom `RoomMenuItem`:
      a label plus an `St.Button` with Adwaita's call icon, its own accessible name
      (*Join <room>*) and its own keyboard focus. The button activates the item rather than
      launching directly, so the two ways into a room are one handler and both close the
      menu; a room with no vouched-for link is insensitive and buttonless. Failure messages
      now go through **`redactSecrets`** — the way a role link would reach the screen is not
      that anybody writes it into a message, but that a launch fails and GIO quotes the URI
      it was given. The teardown hygiene test is checked per class now, and both directions
      verified by mutation. 15 tests, **291** in the suite.
- [x] **U6 — the request, for real.** One `Soup.Session` with a ten-second timeout, one
      `Gio.Cancellable` per refresh, fetched on `open-state-changed` and abandoned when the
      menu closes or the extension is disabled. The status is read as `message.status_code`
      and never through `get_status()`, which throws on a status outside libsoup's enum from
      inside the async callback, where a throw settles no promise and the request hangs for
      ever. 0.1's "nothing reaches the network" rule is **replaced, not dropped**: exactly
      one file may import `gi://Soup` and the test names it, nothing under `lib/` may even
      in principle, no synchronous spelling appears anywhere, and no credential reaches
      anything that writes text. Both halves verified by mutation. 7 tests, **298** in the
      suite.
- [x] **U7 — the nested shell. 50 checks, all passing on GNOME Shell 46.** The rooms are
      listed under their instance, most recent first, closed ones included; the join button
      is drawn, says *Join Weekly sync* to a screen reader and takes keyboard focus; pressing
      it reaches the stub browser with the **role link, secret and all**; and a room whose
      link the instance withheld is listed with no button. Two of the four states are end to
      end — a real `gnome-keyring-daemon` on the session bus stores and reads back a key,
      and a real libsoup request to a real closed port renders *Could not reach …* while
      that instance's own row goes on working. Screenshots retaken, `rooms.png` added.
- [x] **U8 — shipped.** Pull request [#4](https://github.com/gortazar/meet/pull/4) merged as
      [354e8c2](https://github.com/gortazar/meet/commit/354e8c2) with all four checks green,
      [v0.2](https://github.com/gortazar/meet/releases/tag/v0.2) released and verified, the
      pin and the flake input bumped to the merge commit.

**What the nested shell could not prove, and why.** The *rooms* and *refused* states have
their room state injected into the indicator; everything around that is real — the payload
is parsed by the extension's own `parseRooms`, the rows are real widgets in a real shell,
and the click goes through the real launcher to the real default handler. What is skipped is
the HTTP response itself. The extension refuses anything but `https:`, so a stub instance
would need a certificate this machine trusts, and there is no way to arrange one here:
**glib-networking honours no environment override for its trust anchors** — `SSL_CERT_FILE`
and a p11-kit user config were both tried and both ignored — and **user namespaces are
unavailable in this sandbox**, so `bwrap` cannot bind a CA bundle over the system one
either. Every branch of `readRoomsResponse` is covered exhaustively by the headless suite
instead, and the failure direction of the real transport is covered by the unreachable
check. This is the one place the plan's wording ("a local HTTP server answering
`/api/v1/rooms`") could not be met as written, and it is met as closely as an https-only
extension allows.

**Two real bugs the nested shell caught**, both of which look fine in a diff:

- **`PopupBaseMenuItem` runs its params through `Params.parse`, which throws on any key it
  does not know** — and `style` is not one of them. The throw is at construction time, so it
  took the whole menu with it. The indent is set after `super._init` now.
- **`RoomMenuItem` set `label_actor` but not `label`.** `label` is the name `PopupMenuItem`
  gives its own, and therefore the one everything else looks for. The room rows were on
  screen and invisible to anything asking the menu what it held — the driver included, which
  is how it showed up as four failing checks rather than as a wrong-looking screenshot.

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

## What "done" covers

Every feature in `PLAN.md`, as amended by the answered open questions.

- **Merged**: pull request [#4](https://github.com/gortazar/meet/pull/4), squashed to
  [354e8c2](https://github.com/gortazar/meet/commit/354e8c2), with `check`, `package`,
  `sonar / Analysis` and SonarCloud all green. `CI` on `main` is green at the same commit.
- **Quality gate green on `main`** — `new_reliability_rating`, `new_security_rating`,
  `new_maintainability_rating` all 1 and duplication 0.0% — and **no open Sonar issue at any
  severity, queried under both the legacy and the impact severity models**. So nothing is
  documented here as a false positive: there was nothing to document. The eight findings the
  gate raised on the pull request were all fixed in it (five floating promises, a nested
  ternary, an array where a `Set` belonged, two `push`es that should have been one).
- **Released and verified**: [v0.2](https://github.com/gortazar/meet/releases/tag/v0.2),
  both assets, and `scripts/check-release.sh` green — over curl and over `gh`
  independently, which is a new check this cycle (see Notes).
- **The published artefact was run, not just downloaded.** The installer was piped into a
  shell from a clean directory with `HOME` and `XDG_DATA_HOME` redirected: it fetched the
  asset, the checksum matched, **17 files landed** — the four new `lib/` modules among them
  — and `gnome-extensions enable` succeeded. The same published zip, sha256 `4f3653a6…`,
  then passed **45/45 checks in a real headless GNOME Shell 46** through `MEET_INSTALL_ZIP`.
- **298 headless tests** under plain `gjs`, green in `nix flake check` alongside ESLint and
  the packed zip assembled and inspected.

What a user gets that they did not have at 0.1: each configured deployment is an
**instance**, its **rooms** are listed underneath it, and each room has a button that opens
the call rather than the room's page. The API key that makes that possible is entered in the
preferences and kept in the login keyring.

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

**New this cycle, and worth keeping:**

- **`scripts/check-release.sh` reported "no release tagged v0.2" when the release was there.**
  The first failure was honest — the workflow had not published yet, which is the documented
  trap. The second was not: `curl -f` against the unauthenticated `api.github.com` had
  failed, `|| true` swallowed it, and the script turned that into a statement about the
  release. It now falls back to `gh`, which is authenticated and has its own allowance, and
  **both paths are exercised independently** (each verified with the other removed from
  `PATH`). An unauthenticated 60-requests-an-hour limit answering 403 must not read as "the
  release workflow never ran".
- Its file list also only named 0.1's modules, so a zip missing `lib/rooms.js`,
  `lib/client.js`, `lib/keyring.js` or `lib/secret-store.js` would have passed. All four are
  named now.
- **A trusted-TLS stub is not arrangeable here**, which is why the smoke test injects the
  room state for the success path. `SSL_CERT_FILE` is not read by glib-networking, a p11-kit
  user config does not register a second trust token, and `bwrap` cannot map a uid in this
  sandbox. Recorded above under U7 as well, because it is the one place the plan's wording
  could not be met literally.

Difficulty estimate: **medium**, as the plan says — the model and the menu are small, but a
network call from inside the compositor brings a credential to store, a request to cancel,
and four failure states that all have to read as menu rows.
