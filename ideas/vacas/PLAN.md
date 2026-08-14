# Plan: vacas — "did I already write to this place?" for Rentalia

Difficulty estimate: hard — the extension itself is small and boring, but every interesting part of it
is glued to the DOM of a third-party site that cannot be researched from here (rentalia.com answers
403 to every non-browser client), the one event that matters ("the enquiry was actually sent") can
only be observed by really sending one, and shipping to release Firefox needs AMO signing credentials
this repo does not have yet.

## Context

What is already known, and what is deliberately not assumed:

1. **Properties have a stable numeric id, and it is in the URL.** Rentalia listings live at
   `https://<locale>.rentalia.com/<digits>` — e.g. `https://es.rentalia.com/881748`,
   `https://www.rentalia.com/994948` — and the same number is shown on the page as the *referencia*.
   That number, not the title and not the URL string, is the identity of a place. Titles are
   translated per locale and rewritten by owners; the ref is not.
2. **`www.`, `es.`, `en.` … are the same site in different languages.** The dedup key must therefore
   be the bare ref, so that a place found today on `es.` and again next week on `www.` is recognised
   as one place. Locale is recorded alongside, never as part of the key.
3. **The site cannot be studied by fetching it.** Both `www.rentalia.com` and `help.rentalia.com`
   return 403 to scripted requests. Whatever selector research the entry asks for has to happen in a
   real Firefox, by hand, and its output has to be *captured as fixture HTML committed to the repo* —
   otherwise the next session starts the research from zero and the tests have nothing to run against.
   This is the single biggest scheduling risk in the plan, and it is why unit U1 is research and
   fixtures rather than code.
4. **"Sent" is an event nobody can observe cheaply.** The entry is explicit: if the send button was not
   pressed, nothing is stored. Pressing it, though, is also not proof — a validation error, a captcha
   or a network failure leaves the user staring at the same form. Getting one confirmed send observed
   in the wild means writing to a real owner, which is a real email to a real person. See the second
   open question.
5. **There is no Rentalia API and no account integration.** Everything is read off the page the user is
   already looking at, in their own session. The extension sends nothing anywhere: no server, no
   telemetry, no sync. That is both the privacy stance and the reason `storage.local` is enough.

Assumptions, stated rather than asked:

- **Manifest V3, Firefox-only**, non-persistent background script, `browser.*` promise API. No Chrome
  compatibility shims: the entry says Firefox, and pretending otherwise doubles the test matrix.
- **"Activated on demand" means a toolbar toggle that stays on until turned off**, per browser
  profile, with a clearly ON/OFF toolbar icon and a badge. It is not a one-page-only activation and
  not a per-session reset — a tracker you must remember to re-arm on every tab would miss exactly the
  enquiries it exists to catch.
- **Host access is requested, not assumed.** `*.rentalia.com` is an *optional* host permission, asked
  for the first time the user switches the extension on, and the content script is registered
  dynamically only while it is on. An install that silently reads a travel site from day one is not
  what "on demand" means, and AMO reviewers read it the same way.
- **Records are local and exportable, never uploaded.** `browser.storage.local`, plus JSON export and
  import so a history survives a profile move.
- **Same place, same dates = exact check-in *and* check-out match.** Overlapping-but-different ranges
  are surfaced as a softer "you contacted this place for nearby dates" note, not as the main alert.
  See the third open question.

## Features

- **A toolbar toggle that arms the tracker** — one click turns tracking on for `*.rentalia.com`,
  requesting the host permission the first time and registering the content script; another click
  turns it off, unregisters the script and stops all observation. The icon and badge say which state
  it is in from across the room, and the popup states it in words, because a tracker whose state you
  have to guess is worse than no tracker.
- **Contact-form detection driven by a versioned site profile** — all knowledge of Rentalia's DOM
  lives in one module, `site-profile.js`: how to recognise the contact/availability form, the check-in
  and check-out inputs, the guest count, the message textarea and the submit control, each expressed
  as an ordered chain of candidate strategies (stable attribute → form-field name → ARIA/label text →
  structural fallback) so one renamed CSS class does not blind the extension. The profile carries a
  version and a `capturedAt` date, and the research behind it is written up in
  `docs/rentalia-research.md` next to the fixture HTML it was derived from.
- **Recording only on confirmed send** — a two-phase commit. A submit-button press (captured at the
  form's `submit` event *and* at a capture-phase click, since the button may not be a real submit)
  stages a *pending* record holding ref, locale, title, dates, guests and the message text as typed.
  The record is only written to storage when the send is confirmed: a success panel appearing, a
  navigation to a confirmation URL, or the enquiry request completing successfully — whichever the
  research in U1 establishes as reliable. A pending record that is not confirmed within a short
  timeout, or whose page shows validation errors, is discarded, and the popup says "not recorded".
  Never a silent guess in either direction.
- **What is stored per enquiry** — `{ref, locale, url, title, checkIn, checkOut, guests, message,
  sentAt, profileVersion, confirmedBy}`. The message text is kept verbatim, as the entry requires, so
  "what did I actually ask them?" is answerable months later. `profileVersion` and `confirmedBy` are
  what make a stale record diagnosable instead of merely suspicious.
- **The already-contacted alert, where the decision is made** — three placements, weakest first:
  search-result cards for a place already contacted for those dates get an inline marker with the
  date it was contacted; the listing page shows a banner above the fold; and opening or submitting the
  contact form for a match raises a clear in-page confirmation ("you wrote to this place on 3 June for
  these exact dates — send anyway?"). Dates for the comparison come from the search context (URL
  parameters and the form's own fields), so results browsed with no dates chosen are matched by ref
  alone and worded accordingly.
- **A history view in the popup** — every recorded enquiry, newest first, searchable by ref, title or
  text, each row linking back to the listing, with per-record delete, a full clear, and JSON
  export/import. Storage is bounded and the popup shows the count, because an extension that quietly
  grows without limit is a bug waiting for a slow morning.
- **Loud failure when the site changes** — if the site profile stops matching (form found but no date
  fields, submit control unrecognised, confirmation never observed), the extension does not fail
  silently: the badge turns to a warning state and the popup says which part of the profile stopped
  matching and on which URL. A tracker that has quietly stopped tracking is the worst possible
  outcome for this idea, so it is the one failure mode with its own UI.
- **Tests that do not touch the live site** — pure logic (ref extraction from every URL shape, date
  normalisation across locale formats, the dedup/overlap rule, record shape, storage migrations) as
  plain unit tests; DOM behaviour driven with jsdom and Playwright against the *committed fixture
  pages* served from `file://`/a local static server, covering: form found and sent and confirmed,
  button pressed but validation failed, button pressed and network failed, form present but never
  submitted, search page with and without dates, and a deliberately mangled fixture standing in for a
  redesign. `web-ext lint` runs in CI as a release gate.
- **A recorded manual verification pass** — a checklist in `docs/manual-verification.md` walked
  against the real site in a real Firefox, with the result and date noted in `STATUS.md`. The
  automated suite proves the logic; only this proves the selectors.
- **Packaged and installable without building** — `flake.nix` for the dev/test/build environment,
  a release workflow in the upstream repo that builds and publishes the `.xpi` for tag `v<version>`,
  and the upstream `README.md` opening with the one-line install. Which channel that is — AMO listing
  or a signed self-hosted XPI from the release — is the first open question, and it is genuinely
  blocking for "installs without compiling".

## Approach

Source lives in `github.com/<owner>/vacas`, added here as `ideas/vacas/upstream`; this folder keeps
the plan, the status and the pin check, and `.github/workflows/ci-vacas.yml` (already present) checks
the wrapper. Units, one commit each, tests first:

1. **U1 — research and fixtures.** Walk the real site: a search with dates, a listing page, the
   contact form, a completed send. Save the HTML of each as fixtures under `tests/fixtures/rentalia/`,
   scrubbed of personal data, and write `docs/rentalia-research.md` recording the URL shapes, the ref,
   the field identifiers, the submit control and — most important — exactly what the page does after a
   successful send. Everything downstream is derived from this; no code before it.
2. **U2 — skeleton.** `flake.nix`, `manifest.json`, the test runner, `web-ext lint` in CI, an
   extension that loads, does nothing, and unloads cleanly.
3. **U3 — identity and dates, pure.** Ref from URL, locale, date parsing/normalisation to ISO, the
   dedup key. No DOM.
4. **U4 — the store.** Record shape, add/query/delete/clear over `storage.local`, a schema version and
   a migration path, quota handling.
5. **U5 — the site profile and form detection**, against the U1 fixtures, including the mangled one.
6. **U6 — two-phase capture**: staging on press, commit on confirmation, discard on failure or
   timeout. The core of the idea and the unit with the most tests.
7. **U7 — the toolbar toggle**, optional permission request and dynamic content-script registration.
8. **U8 — the alerts**: search-card markers, listing banner, pre-send confirmation.
9. **U9 — the popup**: history, search, delete, export/import.
10. **U10 — profile-mismatch reporting** and the warning badge.
11. **U11 — manual verification** on the live site, recorded.
12. **U12 — packaging and release**: signed artefact, install path, `README.md`, `version: 0.1`,
    installed from the published asset in a clean Firefox profile before `status: done`.

## Risks / things to verify early

- **The whole plan rests on U1.** If the research cannot be done (site blocks automation, form is
  behind a login, confirmation is only an email), every later unit is guesswork. Do U1 first, and if
  it fails, raise a question rather than writing selectors from imagination.
- **Sending a test enquiry writes to a real person.** There may be no sandbox. Options are a
  cancelled-at-the-last-moment send (which teaches nothing about confirmation), a genuine enquiry the
  user was going to send anyway, or a locally replayed fixture. See the second open question.
- **AMO signing is a hard gate, not a formality.** Release Firefox will not install an unsigned XPI
  permanently. Both routes (AMO listing, or `web-ext sign` for self-hosting) need AMO API credentials
  in the upstream repo's secrets — the one place this idea needs something the automatic
  `GITHUB_TOKEN` cannot give. First open question.
- **AMO review dislikes broad permissions and remote code.** Optional host permissions, no
  `eval`, no injected remote scripts, and a clear data-handling statement ("everything stays in your
  browser") keep the review short.
- **The message textarea may be filled after the click** by the site's own JS, or cleared on submit.
  Read the text at press time, from the staged record — never re-read the DOM at confirmation time.
- **Dates may live in three places** (URL query, a datepicker widget's hidden inputs, the form fields)
  and they may disagree. Prefer the form's own values; record where they came from.
- **Single-page navigation.** If the site swaps content without a page load, `MutationObserver` plus
  history-API hooks are needed or the extension will only work on the first page the user lands on.
- **A pending record must not survive a tab close** as if it were confirmed. Pending state is
  in-memory in the content script, never written to storage until confirmed.
- **Firefox MV3 background scripts are not persistent.** Anything the background page holds must
  survive termination; keep state in storage or in the content script, not in a module-level variable.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [x] **How does vacas get signed and installed?** Release Firefox refuses unsigned extensions, so
      "installs without compiling" needs an AMO account and API credentials (`AMO_JWT_ISSUER` /
      `AMO_JWT_SECRET`) in the `vacas` repository's secrets — something no previous idea in this repo
      has needed. The options: (a) list it publicly on addons.mozilla.org and make that the install
      channel, accepting review latency and a public listing for a personal tool; (b) keep it
      unlisted, sign with `web-ext sign` in CI and attach the signed `.xpi` to the GitHub release;
      (c) ship an unsigned `.xpi` and document temporary loading in `about:debugging`, which is not an
      installation method under AGENTS.md and would leave the entry unfinishable. The plan assumes
      (b), and needs the credentials to be created and added before U12. Ticking this line as-is
      chooses (b) — and please confirm the credentials will be provided.
- [x] **May the research send a real enquiry to a real owner?** Confirming "the enquiry was sent" needs
      the page state that only follows a genuine successful submit, and Rentalia has no test property.
      The options: (a) the user performs one real enquiry they intended to send anyway, with the
      extension in capture mode, and shares the resulting page as a fixture; (b) the agent sends a
      polite enquiry from the user's account for research purposes; (c) confirmation is inferred
      without ever observing it — from the form disappearing or the request completing — accepting
      that the first real-world confirmation happens on the user's own first enquiry. The plan assumes
      (a) and will stop at U1 to ask for the capture if it cannot be obtained otherwise. Ticking this
      line as-is chooses (a). Let's do (c).
- [x] **What counts as "the same dates"?** Exact check-in and check-out match is the literal reading,
      but a place contacted for 1–8 August is realistically "already contacted" when it turns up again
      for 2–9 August, and searches are often browsed with no dates set at all. The plan assumes: exact
      match raises the full alert, an overlapping range raises a softer note, and a no-dates search
      shows a neutral "you have contacted this place before" marker. The alternatives are strict exact
      match only, or treating any overlap as a duplicate. Ticking this line as-is chooses the first.
- [x] **Should the alert be able to interrupt a send?** The entry says "alerts the user", which passive
      markers satisfy. The plan goes further and asks for confirmation before re-sending to a place
      already contacted for the same dates — more useful, but it means the extension intervenes in a
      form submission on someone else's site, which is the most intrusive thing in this plan and the
      most likely to break if the site changes. Ticking this line as-is keeps the pre-send
      confirmation; the alternative is markers and banners only. Use passive markers.
- [ ] **The AMO API key, please — it is the only thing left.** The first question chose (b): sign
      with `web-ext sign` in CI and attach the signed `.xpi` to the GitHub release, and it asked for
      confirmation that the credentials would be provided. They are not there yet:
      `gh secret list --repo gortazar/vacas` is empty, so `v0.1` has not been tagged — a tag now
      would only produce a failed workflow and a version number burned on nothing.
      Everything else for U12 is built and tested: the release workflow, and `install.sh` run end to
      end against a locally built asset (it refused the unsigned build, and installed a
      signature-bearing one into a sandbox profile).
      What is needed: create an API key at <https://addons.mozilla.org/developers/addon/api/key/>
      and add both halves as secrets in `github.com/gortazar/vacas` —
      `AMO_JWT_ISSUER` (the "JWT issuer" string) and `AMO_JWT_SECRET` (the "JWT secret"). Then
      ticking this line is enough: the next cycle tags `v0.1`, the workflow signs and publishes, the
      published asset gets installed in a clean profile, and the idea is done.
      If you would rather not have an AMO account at all, say so on this line and the alternative is
      a listed AMO submission (public listing, review latency) or accepting that vacas is only
      installable in Developer Edition or Nightly — which under AGENTS.md would leave the entry
      unfinishable, so it needs to be a deliberate choice.
