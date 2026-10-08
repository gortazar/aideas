# Plan: meet — the join button lands where the camera and microphone are chosen

Difficulty estimate: **easy** — one query parameter on a URL the extension already builds, one field in a
preferences window that already exists, and no new network call, new widget or new failure state. The hard
part of this entry was finding out what is actually reachable, and that research is done (below); what is
left is small, pure and testable.

Version: this entry is a `minor` update — **`0.3`**, per the `README.md` entry, set in `STATUS.md` in the
same commit that finishes the work.

## Context

v0.2 gives every room a button that opens its **anonymous moderator link**,
`https://<instance>/meet/room/<roomId>?secret=<secret>`. The entry says that link should bring you to the
page where the camera and microphone are selected — the page the *Join Meeting* button on the page you land
on takes you to — **"if possible"**.

Those three words turn out to be doing the work. What the research settled, before any code:

1. **OpenVidu Meet shows three views in a row**: the **Join view** (the "lobby" — set a nickname, press
   *Join Meeting*), then the **Device view** (tune microphone and camera, pick a virtual background), then
   the **Meeting view**. That is the flow the entry describes, and the Device view is the target.
2. **There is exactly one route for a room.** `meeting.routes.ts` registers `room/:room-id` and
   `disconnected`, and nothing else. The lobby and the device view are *states inside* that one component
   (`meeting.component.html` renders `<ov-meeting-lobby />` while `showLobby()`, and `<ov-meeting-view
   [prejoin]="true">` afterwards), not addresses. **So there is no URL that names the device view.** A
   different path, a fragment or a second room link cannot reach it.
3. **The lobby is cleared only by its own button.** `showLobby()` is `!lobbyService.accessGranted()`, and
   `_accessGranted` is set in exactly one place: `submitAccess()`, which the lobby form calls. Nothing
   auto-submits — not when a name arrives from the URL, not when the user is authenticated, not in embedded
   mode.
4. **The parameters a room URL accepts are a closed list**, read in `extractParams`: `secret`,
   `participant-name`, `participant-external-id`, `participant-metadata`, `initial-audio-active`,
   `initial-video-active`, `language`, `leave-redirect-url`, `show-only-recordings`, `show-recording`,
   `e2ee-key`. **There is no `skip-lobby` and no `skip-prejoin`** — v0.2's plan listed them as "recent" on
   the strength of OpenVidu Call; on Meet they do not exist, and that guess is now retired.
5. **`participant-name` does change the lobby**: the name control is pre-filled *and disabled* when the name
   came from the URL. The lobby then has nothing left to ask — one press of *Join Meeting* and you are on
   the device view.

So the honest answer to "if possible" is: **not possible as a URL, and one click away is the closest the
link can get.** This entry delivers that closest point and says so plainly, rather than shipping a
parameter that silently does nothing. Two properties make it the right move regardless:

- it is the same remedy either way — if some deployment *does* skip a lobby it has nothing left to ask, the
  parameter is what triggers that; if it does not, the parameter still removes the only question the lobby
  was there to put;
- an unknown parameter costs nothing. Meet reads the ones it knows and ignores the rest, so an older or
  newer instance is unaffected.

Assumptions stated rather than asked:

- **The room row and its join button keep doing the same thing as each other**, as 0.2's answered question
  settled. The new parameter goes on the URL both of them launch, in one place.
- **`secret` is untouched.** The parameter is added to the query the instance gave us; nothing is rebuilt,
  re-encoded by hand, reordered or dropped, and `redactSecrets` still covers every message built from a
  failure.
- **A link the instance already sent with a `participant-name` wins.** The deployment said something
  specific about that room; the extension does not argue with it.
- **Nothing new reaches the network.** This entry adds no request, no key and no endpoint — it is the same
  room list, launched at a slightly better address.

## Features

- **The join link carries the participant's name.** `lib/join-url.js` takes a join URL that `rooms.js` has
  already vouched for and returns the same URL with `participant-name` added — the only difference between
  landing on a lobby that asks you who you are and a lobby with nothing left to ask. Pure, Shell-free, and
  the whole behaviour of this entry lives in it.
- **The link is never damaged to add it.** The existing query is preserved exactly: `secret` and every other
  parameter keep their value and their encoding, a name containing a space, an `&`, a `+` or a non-ASCII
  character is encoded properly, a URL that already names a `participant-name` is returned unchanged, and
  applying the function twice gives the same URL as applying it once. A URL that fails `joinUrlProblem` is
  returned untouched — a room with no button stays a room with no button.
- **An empty name changes nothing.** No name configured means the link launched is byte-for-byte the one
  v0.2 launched. The entry's improvement is opt-in by having a name, and the no-name case is the old
  behaviour rather than a new broken one.
- **A name field in preferences.** One entry in the preferences window — a plain `Adw.EntryRow` in
  GSettings, not the keyring: a display name is not a credential — with a line saying where it is used
  ("shown to the other participants; fills in the Join page so the call is one click away"). Pre-filled from
  the session's own name the first time, editable and clearable afterwards, per the first open question.
- **The button and the room name both launch the new URL**, built at the single point in `extension.js`
  where a room is launched today, so the two cannot drift apart.
- **The README says exactly what the button does, including what it does not do.** One short paragraph:
  the button opens the room's moderator link with your name filled in, and OpenVidu Meet's own Join page
  still needs one press before the camera and microphone page appears, because Meet has no address for that
  page. A user who expected zero clicks should learn why from the README rather than from the behaviour.
- **Proven in the nested GNOME Shell.** `ci/smoke-test.sh` asserts the stub browser is handed a URL that
  carries both the role secret and `participant-name=<the configured name>`, and that with the name cleared
  it is handed the bare role link. The assertion is on the URL the desktop was asked to open, which is the
  last thing the extension controls.
- **Shipped, as every entry is.** `v0.3` released from upstream's own workflow with the packed extension and
  its checksum, `install.sh` re-verified from a clean directory against the new asset, `check-release.sh`
  and `check-pin.sh` green, the Sonar gate green on the pull request and no undocumented BLOCKER.

## Approach

Units, each one commit, tests first.

1. **U1 — `lib/join-url.js`.** The whole behaviour: add `participant-name`, preserve everything else,
   no-op on an empty name, on an already-named URL and on a URL `rooms.js` refuses. Tests first, including
   the encoding cases and the idempotence case. Nothing else changes in this unit — the menu still launches
   what it launched.
2. **U2 — the name in settings.** A `participant-name` GSettings key (schema addition, defaulting to the
   empty string), the pure read/normalise rules beside the existing ones in `lib/settings.js`/`lib/editing.js`
   (trimmed, collapsed whitespace, a sane maximum length), and the first-run default taken from the
   session's own name.
3. **U3 — the field in the preferences window.** The row, its subtitle, and the debounced write the window
   already does for the other fields; a cleared field means "no name" and not "unset, fill it in again".
4. **U4 — the shell uses it.** `extension.js` passes the configured name through `buildJoinUrl` at the one
   place a room is launched, for both the row and the button. The hygiene test gains one assertion: the
   module that builds the URL stays Shell-free and reaches no network.
5. **U5 — the nested shell.** The two smoke-test checks above, plus a screenshot refresh only if the menu
   looks different (it should not — this entry changes an address, not a widget).
6. **U6 — ship it.** README paragraph, `STATUS.md` at `version: 0.3` with what the research settled and what
   is therefore *not* possible, pull request ready, auto-merge, `v0.3` released and verified, pin bumped
   here.

## Risks / things to verify early

- **The one fact this entire entry rests on is version-dependent.** Points 2–5 of the Context were read off
  `OpenVidu/openvidu-meet` at `main`; the deployment a user points the extension at is some released 3.x.
  Verify against a real instance in U1 — open a role link with `participant-name` appended and look at the
  Join page. If an instance turns out to skip the lobby entirely when it has nothing to ask, the entry is
  *fully* satisfied by the same change and only the README paragraph needs softening. If some older instance
  ignores `participant-name` altogether, the entry degrades to v0.2's behaviour, which is the floor this
  plan is built on.
- **There is no way to check the browser's behaviour from CI here.** The smoke test can assert the URL
  handed to the default handler and nothing beyond it: an https stub instance would need a certificate this
  machine trusts, and 0.2 established that neither `SSL_CERT_FILE` nor `bwrap` can arrange one in this
  sandbox. "The lobby arrives pre-filled" is therefore verified by hand against a real instance once, and
  recorded in `STATUS.md` with the instance's version — not asserted in the suite. Say which, rather than
  implying the suite proves it.
- **`participant-name` is published to the other participants and to the instance's logs.** It is not a
  secret and does not go in the keyring, but it is personal data leaving the machine, so it is a field the
  user fills in — never a value harvested silently. The first open question is where its default comes from
  for exactly this reason.
- **Appending to a URL is where `secret` gets damaged.** The failure mode is quiet: a re-encoded or
  truncated secret produces a link that loads a room page instead of joining, which looks like the feature
  working badly rather than like a bug. Build the new query from the parsed one with GLib's own
  encoding, and pin a test on a secret containing characters that round-trip badly by hand.
- **Sonar on a small change.** New code here is a handful of pure functions and should be near-fully
  covered; if coverage of the two wiring lines in `extension.js` costs the gate, that is the catalogued GJS
  class — a narrow exclusion with a row in `ideas/quality-gate/exclusions.md`, never a re-labelled issue.
- **Scope creep towards the device view's own settings.** `initial-audio-active` and `initial-video-active`
  exist and are tempting; they pre-empt the very page this entry is trying to reach. Not in this entry —
  see the third open question.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **OpenVidu Meet has no address for the camera-and-microphone page, and its Join page is cleared only
      by its own button — so "bring you to that page" cannot be done with a link. Is one click away what
      this entry should deliver?** Ticking this line as-is means yes: the join link gains
      `participant-name`, the Join page arrives with its only question already answered, and its *Join
      Meeting* button is all that remains between the panel and the device page. The alternatives are:
      change nothing in the extension and only document the limitation in the README; or hold the entry
      until OpenVidu Meet offers a parameter that skips the Join view (there is none today, and asking for
      one is not something this repository can do). Do nothing and just document this limitation.
- [x] **Where does the name sent as `participant-name` come from?** Ticking this line as-is means **one name
      for all instances, in the preferences window, pre-filled on first run from the session's own full
      name** (`GLib.get_real_name()`) and editable or clearable afterwards — a name is what the Join page
      would have asked for anyway, and it is shown to everyone else in the call either way. The cost is that
      a first run sends the account's real name without being asked. The alternatives are: an empty field
      the user must fill in before anything changes; or a separate name per instance, since a work
      deployment and a personal one may not want the same one. Not valid, since we won't do it.
- [x] **Should the link also carry `initial-audio-active` / `initial-video-active`?** Ticking this line
      as-is means **no**: the device page is exactly where the camera and microphone are chosen, and this
      entry is about arriving there, not about deciding in advance what it will say. The alternative is two
      more preferences ("join muted", "join with camera off") that pre-set them — a sensible feature, and a
      different entry. Do nothing.
