# Plan: meet — the rooms of each instance, and a button that joins the call

Difficulty estimate: **medium** — the menu and the extra button are small, but this entry turns a flat
list of links into a two-level model fed by a **network call from inside the compositor**, which v0.1
deliberately had none of: a per-instance credential to store, an async request to cancel on `disable()`,
and four failure states (no key, unreachable, refused, empty) that all have to read as menu rows rather
than as exceptions. `medium`, not `hard`, because none of it is novel — the launcher's injected-seam
pattern already shows where the untestable part goes.

Version: this entry is a `minor` update — **`0.2`**. The `README.md` entry does not say which kind it is,
so `AGENTS.md`'s default applies; noted here and to be repeated in `STATUS.md`.

## Context

v0.1 ships a panel menu of *destinations*: a label and an `https:` URL, two by default (**Meet next**,
**Meet**), each opening in the browser. The entry renames the level that already exists and adds one
below it:

- what `destinations` holds is an **instance** — an OpenVidu Meet deployment;
- each instance has **rooms**, which the menu must list underneath it;
- each room gets a **button** that opens *the call*, "not the room homepage".

Four things about OpenVidu Meet decide the shape of this, and they are worth settling before any code:

1. **Rooms are a server-side list, not a setting.** An instance exposes them at
   `GET <instance>/api/v1/rooms?maxItems=…`, authenticated with an **`X-API-KEY` header**; the key is
   generated per deployment from the app's *Embedded* page. So the menu can only show real rooms for an
   instance the user has given a key for, and the two shipped instances will show none until they do.
   That is the honest behaviour, and the first open question asks whether it is the intended one.
2. **A room has several URLs, and only some of them are the call.** The room object carries anonymous
   role links — `access.anonymous.moderator.url` and `access.anonymous.speaker.url` — of the form
   `https://<instance>/room/<roomId>?secret=<secret>`. The secret *is* the role, and it is what makes the
   link land in the meeting. The same path without a secret is the room's own page, which is precisely
   the "room homepage" the entry says the button must not stop at. **The button opens a role link; it
   never builds one by dropping the secret.**
3. **A role link is a credential.** Anyone holding it joins that room as that role. It must never be
   logged, never appear in a notification body, never reach a screenshot, and never be written anywhere
   this repository's CI can print it. The README's screenshots come from a throwaway instance.
4. **A shell extension may make requests, but on a short leash.** `libsoup3` asynchronously, `https:`
   only, one `Gio.Cancellable` cancelled in `disable()`, a timeout, and no request at all until the menu
   is opened. v0.1's hygiene test asserts *nothing anywhere reaches the network*; this entry replaces that
   rule rather than deleting it — exactly one module may, and the test names it.

Assumptions stated rather than asked:

- **The rooms are listed flat under their instance**, indented, not behind a `PopupSubMenuMenuItem`.
  "Below the instance name" reads as visible, and a submenu that has to be opened is one more click on a
  menu whose entire point is being one click deep.
- **The instance row keeps doing what it does today** — opening the instance's own URL in the browser.
  Nothing about v0.1's behaviour is taken away by this entry.
- **Rooms are fetched when the menu opens**, not on a timer. A panel button that polls a remote API every
  minute for a list nobody is looking at is a battery and review problem; `open-state-changed` is the
  natural trigger, and the previous list stays on screen while the new one arrives.
- **The list is per session, in memory.** No room names, and emphatically no role links, are written to
  dconf as a cache.

## Features

- **Rooms listed under their instance.** Each configured instance keeps its row; beneath it, one
  indented row per room the instance reports, in the order the API returns them. The shape of that list —
  instance rows, room rows, notes, separators — lives in `lib/menu.js` as data, as it does today, so
  every state below is a headless test rather than a desktop to reconfigure.
- **A join button next to each room name.** The room row is a label plus an `St.Button` carrying a
  symbolic call icon, with its own accessible name (`Join <room>`) and its own keyboard focus, activating
  the room's **moderator role link** through the same launcher v0.1 already has. Clicking the button
  closes the menu and hands the URL to the default browser; nothing new spawns and nothing new blocks.
- **The button lands in the call, and this is asserted.** `lib/rooms.js` refuses any URL the server
  hands back that is not `https:`, not on the instance's own host, or missing the `secret` query
  parameter — the three ways a "join" link silently degrades into a page that merely talks about the
  room. A room whose link fails those checks is listed without a button rather than with a button that
  goes somewhere else.
- **The room list comes from the instance's REST API.** `lib/client.js` holds the request the API needs
  (path, `X-API-KEY`, paging, the JSON the response must contain) and the parsing of what comes back,
  behind an injected transport seam — so "the server answered 401", "the server answered HTML", "the
  server answered a room with no links" are all ordinary tests, and only the four lines that actually
  call libsoup live in `extension.js`.
- **A per-instance API key, entered in preferences.** Each instance in the preferences window gains a
  key field, with the one-line explanation of where the key comes from (the instance's *Embedded* page).
  An instance without a key is not an error: it is an instance whose rooms we do not know.
- **Every failure is a row, not an exception.** No key → *Add an API key in Rooms…*; request failed or
  timed out → *Could not reach <instance>*; key refused (401/403) → *That instance refused the API key*;
  no rooms → *No rooms yet*. The instance row still works in all four, so a broken or offline instance
  costs you its rooms and not the menu — the same rule `parseDestinations` already follows for a row
  broken by hand in dconf.
- **The request cannot outlive the menu, or the extension.** One `Gio.Cancellable` per refresh, cancelled
  when the menu closes and again in `disable()`; a timeout on the session; and the existing
  `_destroyed` guard extended to the callback, so a reply arriving after teardown touches nothing.
- **Hygiene rules updated rather than dropped.** The "nothing reaches the network" test becomes "only
  `extension.js` may import `gi://Soup`, everything under `lib/` stays pure", plus new assertions: no
  `secret` value is ever passed to `log`/`console`/`notifyError`, and no synchronous Soup spelling
  (`send_and_read`) appears anywhere.
- **Proven in a real nested GNOME Shell.** `ci/smoke-test.sh` grows a stub OpenVidu instance — a local
  HTTP server answering `/api/v1/rooms` with a canned payload — so the smoke test asserts the rooms
  appear under their instance, the join button is drawn and focusable, clicking it reaches the stub
  browser with the *role link including its secret*, and the no-key and unreachable states each render.
  The README screenshots are retaken from that run.
- **Shipped, as every entry is.** `v0.2` released from upstream's own workflow with the packed extension
  and its checksum, `install.sh` unchanged but re-verified from a clean directory against the new asset,
  the wrapper's pin and `check-release.sh` green, and the Sonar gate green on the pull request.

## Approach

Units, each one commit, tests first. U1–U3 are pure and land before anything touches the network.

1. **U1 — the room model.** `lib/rooms.js`: what a room is (`id`, `name`, `joinUrl`), which role link is
   chosen, and the three-part check that a join URL is really a join URL (https, same host as its
   instance, carries `secret`). Tests include the degraded cases: link without secret, link on another
   host, room with no links at all.
2. **U2 — the two-level menu model.** `buildMenuModel` takes instances plus a per-instance room state and
   returns instance rows, indented room rows carrying their join URL, and the four note states. The empty
   menu and the `Rooms…` item survive unchanged. This is where the entry's behaviour is pinned.
3. **U3 — the API response.** `lib/client.js`: the request description and the parser, over an injected
   transport. 200 with rooms, 200 with none, 401, 500, HTML instead of JSON, a truncated body, a payload
   whose rooms are missing fields — every one asserted to produce a state the menu can render.
4. **U4 — the API key in preferences.** Schema key and its migration (v0.1's `destinations` keeps
   working and keeps its meaning), the prefs field per instance, and the pure add/edit/remove rules in
   `lib/editing.js` extended to carry it. Storage per the answered open question.
5. **U5 — the room rows and the join button in the shell.** `extension.js`: the custom
   `PopupBaseMenuItem`, accessible names, teardown of the new widgets and handlers asserted by the
   existing hygiene test, and the button wired to the launcher.
6. **U6 — the request, for real.** libsoup3 in `extension.js` behind U3's seam, the cancellable, the
   timeout, refresh on `open-state-changed`, in-memory cache. Hygiene test amended in the same commit.
7. **U7 — the nested shell.** Stub instance + stub browser; the assertions listed above; screenshots.
8. **U8 — ship it.** `STATUS.md` at `version: 0.2`, README updated (including a plain sentence saying
   what the extension sends where, which a reviewer will look for), pull request ready, auto-merge,
   `v0.2` released and verified, submodule pin bumped here.

## Risks / things to verify early

- **`libsoup`'s `Message.get_status()` throws on any status outside its enum** — 429 is the one that bit
  another idea here — and thrown from inside the async callback it settles no promise and the request
  hangs forever. Read `status_code` directly. Verify with a stub that answers 429 in U3.
- **The public instances may have no key a user can get.** `meet.openvidu.io` and `meet-next.openvidu.io`
  are not the user's deployment; if no API key is obtainable there, the two shipped entries show *Add an
  API key* forever and every screenshot has to come from a self-hosted instance. Find out in U1 — it is
  the fact most likely to change what this entry should look like.
- **The room's own page URL is an assumption.** `<instance>/room/<roomId>` without a secret is taken to
  be the "room homepage" the entry contrasts the button with. Confirm against a live instance before
  making the room *label* open it (see the open question); if it is not a real route, the label stays
  inert and only the button acts.
- **`skip-lobby` / `skip-prejoin` are recent.** They exist as room-URL query params, but an older
  instance ignores unknown params and a newer one falls back to the lobby when it cannot resolve a name.
  Whether to append them at all is an open question; either way the button must work on an instance that
  has never heard of them.
- **API responses change shape between versions.** Pin what is required (`rooms[].roomId`,
  `rooms[].roomName`, the role links) and treat everything else as optional, so a 3.x minor upgrade
  costs a field and not the menu.
- **Secrets in logs and screenshots.** The smoke test prints what the stub browser was asked to open, and
  that URL contains a secret. Use an obviously fake one in the stub, and assert on its presence rather
  than echoing real output.
- **A long room list makes an unusable menu.** The API returns up to 100. Decide the cap in U2 (see the
  open question) rather than discovering it on someone's deployment.
- **Sonar on new code.** U3 and U1 are pure and should be near-fully covered; the uncovered part is the
  libsoup call in `extension.js`, which is the catalogued GJS class — a narrow exclusion with a row in
  `ideas/quality-gate/exclusions.md` if it costs the gate, never a re-labelled issue.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **Where do the rooms come from: the instance's REST API, or a list typed by hand in preferences?**
      Ticking this line as-is means the REST API — "the rooms of each instance" read as the real ones —
      which brings with it a per-instance API key, a network request from the extension, and two shipped
      instances that show no rooms until a key is added. The alternative is no network at all: rooms are
      configured under each instance in the preferences window, the user pastes a join link per room, and
      the whole `client.js`/libsoup half of this plan disappears.
- [x] **Where is the API key stored?** Ticking this line as-is means the **system keyring** via
      `libsecret`, keyed by instance URL: a key in dconf is readable by anything in the session and shows
      up in a `dconf dump` a user might paste into a bug report. The cost is a second storage path to
      test and a prefs window that can fail to save. The alternative is a GSettings key alongside the
      instance, which is simpler and matches how the instances themselves are stored.
- [x] **Which role does the button join as — moderator or speaker?** Ticking this line as-is means
      **moderator**: it is your own instance, your own room, and the link that can start and manage the
      meeting. The alternative is speaker, or a per-room choice in the preferences.
- [x] **Should the join URL carry `skip-prejoin` (and `skip-lobby`)?** Ticking this line as-is means
      **no**: the prejoin view is where a camera and microphone are chosen, and a button that drops you
      into a call with whatever device was default — camera live — is a surprise, not a convenience. The
      alternative reads "the call itself" as strictly as possible and appends them.
- [x] **What does clicking the room's *name* do, as opposed to its button?** Ticking this line as-is
      means the name opens the **room's page on the instance** (the link without the secret) and the
      button joins the call — which is what makes the entry's distinction between the two meaningful, and
      is subject to that route existing (see Risks). The alternatives are: the name does the same as the
      button, or the name is an inert label and the button is the only action. Name does the same as the button.
- [x] **How many rooms should a menu show, and should closed ones appear?** Ticking this line as-is means
      **the first 20 open rooms**, most recently created first, with a final *…and N more* row that opens
      the instance's own rooms page; rooms the API reports as closed are not listed. The alternative is
      everything the API returns, which on a busy deployment is a menu 100 rows long. The first 20, open first,
      but showing closed as well.
