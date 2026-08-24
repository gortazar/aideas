status: not_started
version: 0.3
started_at: 2026-08-14T15:31:00+02:00
last_session_id: 35386b06-271b-4df6-8da8-1c51dd289449
last_run: 2026-08-18T01:39:40+02:00
last_cycle_cost_usd: 44.21989249999999

## Log
- 2026-08-18T01:39:40+02:00 — done ($44.21989249999999)
- 2026-08-17T01:52:57+02:00 — done ($26.964891)
- 2026-08-14T16:43:29+02:00 — done ($24.169680999999994)
- 2026-08-14T16:13:45+02:00 — in_progress ($19.85455449999999)





Difficulty estimate: **medium**, as PLAN.md said — three small pieces that cross the `/state`
contract, the orchestrator that serves it and the extension that renders it, plus this idea's
first shipped image assets, whose one hard requirement (that GNOME recolours them like stock
symbolic icons) can only be confirmed in a real compositor.

## This entry (0.3) — a grey bulb, and the questions behind "blocked"

- [x] **U1 — the server side.** `/state` now carries the questions, not just how many.
      `open_question_lines()` in `orchestrator.py` is the single reader of a `PLAN.md`'s
      `## Open Questions` section, and `count_open_questions()` is now literally the length of
      what it returns — so the count a menu shows and the texts it lists cannot disagree. Each
      question is folded to one line (the lines it was wrapped across joined, whitespace
      collapsed, the checkbox and markdown emphasis stripped, cut at a word boundary to 200
      characters with an ellipsis), and at most 5 are attached to a row as
      `open_question_texts` while `open_questions` stays whole, so a reader can say "+n more".
      `docs/state-contract.md` states the key, its bounds and its absent-rather-than-null rule,
      and turns the old "about 120 bytes per idea" estimate into a stated ~1 KiB per-row bound.
      `tests/test_state_contract.py`: 24 → **32 tests**, covering a wrapped question, emphasis
      versus identifiers (`IDEAS_REPO_PATH` survives, `**bold**` does not), an over-long
      question, more questions than the cap, a ticked/unticked mixture, a question ending at the
      next heading, and a case asserting the count and the texts come from one reader.
      Checked against the repo's real `PLAN.md` files: `vacas`'s one open question folds to 197
      characters, cut at a word boundary.
- [x] **U2 — parsing it, hostilely.** `state.js` reads the key into `row.openQuestionTexts`,
      always an array so a caller never has to ask first. Every wrong shape the wire could hold
      becomes an empty list rather than a throw — absent (an old box against a new extension),
      null, a string instead of an array, an object, non-string members, blank members — and the
      server's own bounds are applied again here: newlines collapsed (a newline in a menu row
      breaks the row), 300 characters per question, 5 questions per row. Not distrust of the box
      so much as of the *pairing*: laptop and box are updated at different times. 8 tests; 213
      gjs tests green.
- [x] **U3 — the questions in the menu.** `menuModel.js` attaches up to three questions to each
      blocked row (each cut at a word boundary to 120 characters, which is what makes "at most two
      rendered lines" true without the model knowing the menu's width) plus how many are not
      shown, counted against the *whole* `open_questions` rather than just what the server sent.
      `menuItems.js` emits them as `question` items immediately after their row, inside the same
      block — never separated from the idea they are about by a separator — and a `question-more`
      item for the remainder. `indicator.js` renders them indented, dimmed, wrapped at word
      boundaries and non-reactive; `stylesheet.css` keeps them narrow enough to wrap rather than
      stretch the menu. Only blocked rows ever list questions.
      15 tests, comparing whole menus: three shown of seven with `+4 more`, a blocked row with no
      questions rendering exactly as before, a row from a box that never sent texts, two blocked
      ideas keeping their own, questions present behind a running cycle, and dimmed along with
      everything else in a stale last-good reading. 228 gjs tests green; flake check green.
- [x] **U4 — the bulbs.** `src/extension/icons/` ships four SVGs on the 16px Adwaita grid, one
      colour and that colour `currentColor`, named `-symbolic.svg` — which is the suffix the
      shell's texture cache looks for before recolouring rather than blitting. `ICONS` keeps its
      shape (a state-to-name map, one lookup, still pure): the four *queue* states point at
      bulbs, and `unreachable`/`unavailable`/`unconfigured` keep their stock glyphs, per the
      answered question. `indicator.js` resolves a shipped name to a `Gio.FileIcon` under the
      extension's own `icons/`, and a stock name through the icon theme as before.
      The four were drawn, rendered and **looked at** at 16 and 64 px before being kept: the
      first attempt had a visibly smaller glass for `running`, which would have made the button
      appear to shrink whenever a cycle started. All four now share one glass and base, and
      differ only in the drawing: rays (running), a question punched through the glass
      (blocked), hollow (idle), struck through (all blocked).
      12 tests assert what recolouring depends on — the `-symbolic` name, no hex or named
      colour anywhere, `currentColor`, the 16px viewBox, no embedded raster or script — plus
      that every name in `ICONS` is a file that ships and every shipped file is named by
      `ICONS`. `tools/check-bundle.js` imports the bundle's own icon map and fails if a named
      icon did not ship, because that failure is otherwise a silent blank square; **verified by
      deleting one from a built bundle and watching it fail**. 239 gjs tests green.
- [x] **U5 — `allBlocked`.** A queue where nothing can move without a person is now its own
      panel state: the reading is good, no cycle is running, at least one idea is blocked, and
      there is nothing the orchestrator could pick up. `queued` deliberately does not count as
      work — a duplicate entry behind a blocked one is stuck too — while `ready`, `running` and
      `to be planned` do, and so does a state word this version does not recognise, because
      declaring the whole queue stuck on the strength of a word we do not understand would be
      worse than saying nothing. It wears the struck-through bulb, badges the number of blocked
      ideas, and reads as `aideas: every idea is blocked, 3 waiting for an answer`.
      It also **summons the button by itself**, the second answered question: this state is
      never "running", so under the old rule alone it could never have been seen. 10 tests, all
      of them boundaries: one ready idea among blocked ones, a queued duplicate, an unplanned
      idea, an empty queue, a running cycle, an unknown state, and an unreachable box.
      The menu header still says `Idle` for such a queue — accurate, and the Blocked section
      right beneath it lists every idea and its questions. Changing that wording was not part of
      this entry.
- [x] **U6 — the compositor, where this entry's real risk lived.** The smoke test grew from 39
      checks to **56**, all green: the panel wears the shipped bulb and *resolved to the file*;
      its pixels are drawn, light and grey — proving the SVG is recoloured to the panel
      foreground rather than blitted; the questions appear under their blocked idea; the
      all-blocked bulb appears **without a cycle running and without "always show"**, badged 3,
      with `+2 more` under the idea that has five questions and `STATUS.md says blocked`
      unchanged under the one that has none. Screenshots for each.
      **The screenshots did their job twice.** First: at 16px the original solid bulbs read as a
      cog, and running and all-blocked were indistinguishable — so all four were redrawn as
      outline bulbs, where the hollow interior carries the mark. Second, and worse: after the
      redraw the panel looked *exactly the same*, which is how it came out that the shell had
      never rendered these files at all. A leading `<!-- -->` comment pushes `<svg>` past
      gdk-pixbuf's format sniffing, the loader refuses the file, and the shell silently
      substitutes a fallback icon with nothing logged. Every unit test above passed throughout.
      Now: the comments live inside the element; two unit tests catch it (nothing may stand
      between the top of the file and `<svg>`, and every icon must actually rasterise through
      the same loader the shell uses, for which the flake's `unit` check gained gdk-pixbuf and
      librsvg); and the smoke test compares the icon's pixels between two states, because a
      fallback icon is drawn, light and grey too — the one thing it cannot be is *different*
      between states.
- [x] **U7 — the bump and the docs.** `version: 0.3` here, in `metadata.json` and in
      `flake.nix` — the three the release workflow asserts agree. `README.md` gains a **The
      bulb** section (what each drawing means, and why it is grey), says that the menu lists
      what a blocked idea is waiting to be told, and records the widened visibility rule and the
      new test counts.

Next: nothing — every unit is done. See **What 0.3 covers** below.

## What 0.3 covers

The three things the entry asked for, and all suites green at 0.3:

| Suite | Covers | Result |
| --- | --- | --- |
| `make test-unit` | the pure logic, now including the icons | **251 pass** |
| `make test-http` | libsoup against a stub server | **29 pass** |
| `make test-contract` | `/state` over fixture repositories | **32 pass** |
| `make smoke` | the extension in a nested headless GNOME Shell | **56 pass** |
| `make test-pack` / `test-release` / `test-install` | the release path, unchanged this entry | **7 / 19 / 39 pass** |
| `nix flake check` | lint, unit, http, bundle | **4 green** |

| What the entry asked for | Where it landed |
| --- | --- |
| A bulb, in every queue state | `src/extension/icons/` — four outline bulbs on the 16px grid; `ICONS` keeps its shape |
| Grey because symbolic, not painted grey | `currentColor` + `-symbolic.svg`, recolouring **verified against the panel's own pixels** |
| The state in the drawing, never in colour | rays / a question inside / plain / struck through — each checked at 16px, and against each other pixel for pixel |
| The unanswered questions of each blocked idea | `open_question_texts` in `/state`, listed under the row in the menu |
| Bounded, because `/state` is polled | folded to one line, 200 chars, 5 per idea server-side; 3 shown with `+n more` |
| Nothing changes for rows without questions | a `STATUS.md`-blocked row and an old box's row both render exactly as before |
| An unmistakable "everything is blocked" | the `allBlocked` state, its struck-through bulb, its badge and its one-line accessible name |
| The panel appears when the queue stops | the widened visibility rule, verified in the compositor without "always show" |
| The contract says all of it | `docs/state-contract.md` + `tests/test_state_contract.py` |
| Screenshots that show what was built | `screenshots/menu-running.png`, `menu-all-blocked.png`, `panel-all-blocked.png` |

**What was verified where.** The bulb's recolouring, the all-blocked button appearing without a
cycle, and the questions in the menu are all asserted in a real GNOME Shell, because none of
them can be proved headlessly. The folding was also run against this repo's real `PLAN.md`
files. What cannot be verified from here is unchanged: the release publishes on merge, and
`make check-release` is how to confirm it — as it did for 0.2, which this session checked first
and found published cleanly, 7 checks, all three assets.

### Answered questions, as read

- The button **appears whenever every idea is blocked**, cycle or no cycle ("Yes, should appear
  always").
- **The task bar icon is a bulb; the other icons stay as they are.** The answer picked the
  question's alternative, so the *queue* states wear bulbs and the three states that are about
  the connection — `unreachable`, `unavailable`, `unconfigured` — keep their stock symbolic
  glyphs, where a network-offline or warning sign says more than a bulb could.
- Long questions: **follow the plan** — folded to one line, at most two lines in the menu, at
  most three questions per idea with `+n more`.

## What 0.2 covers

The release path, fixed and testable from a worktree. Every suite green at version 0.2:

| Suite | Covers | Result |
| --- | --- | --- |
| `make test-unit` | the pure logic, unchanged this entry | **205 pass** |
| `make test-http` | libsoup against a stub server, **plus the code-to-phrase mapping** | **29 pass** |
| `make test-contract` | `/state` over fixture repositories | **24 pass** |
| `make test-pack` | the artefact is a function of the source, and `nix build` agrees | **7 pass** |
| `make test-release` | the release decision, over fixture releases lists | **19 pass** |
| `make test-install` | `install.sh` executed from a clean directory | **39 pass** |
| `make smoke` | the extension in a nested headless GNOME Shell | **39 pass** |
| `nix flake check` | lint, unit, http, bundle | **4 green** |

| Feature in PLAN.md | Where |
| --- | --- |
| A release job that can build the artefact | `nix build`, the derivation `nix flake check` validates — no apt, no missing `gjs` |
| The release runs the tests it is releasing | `nix flake check` + the `/state` contract, before anything is published |
| Triggered by the extension, not its paperwork | `paths:` narrowed to `src/**`, `Makefile`, `flake.nix`, `flake.lock`, `tools/check-bundle.js`, `ci/release-plan.sh`, the workflow |
| A guard that turns "changed" into content | `ci/release-plan.sh` compares the built artefact against the newest published one, by digest |
| A reproducible zip | `make pack`: fixed epoch, sorted entries, fixed modes, `TZ=UTC`, `zip -X -D` — `ci/pack-test.sh` |
| A tag scheme where "newest wins" holds | `aideas-shell-v0.2`, then `-2`, `-3`; `install.sh` takes the newest, tested with suffixed tags |
| Assets the installer can verify | three per release; `install.sh` falls back to `SHA256SUMS` |
| The decision as a tested script | `ci/release-plan.sh` + `ci/release-test.sh` |
| Version consistency enforced | one step asserts `STATUS.md` = `metadata.json` = `flake.nix` |
| The installer verified against a release-shaped source | `ci/install-test.sh`, 27 → 39 checks |
| A post-merge check anyone can run | `tools/check-release.sh` (`make check-release`) |
| v0.2 published, and the README saying how | the workflow publishes on merge; README has a **Releases** section |

**What was proved before the merge, and what still cannot be.** Every part of the workflow was
executed here against real data: the version check (`STATUS.md=0.2 metadata.json=0.2
flake.nix=0.2`), the build producing the three assets, and `ci/release-plan.sh` reading the
**live** releases list and answering `publish=yes tag=aideas-shell-v0.1-2` for a rebuild of 0.1.
`install.sh` was run against the **live v0.1 release** and now reports `checksum verified
against SHA256SUMS`, where before it verified nothing. `tools/check-release.sh` was run against
that same release and reported truthfully, warnings and all.

What cannot be proved from here is unchanged from last entry and is the whole reason this one
existed: an agent may not push this repo, so the workflow's first real run happens after the
merge. **On merge this should publish `aideas-shell-v0.2`** — `status: done`, the version is
0.2 everywhere, the trigger paths include `src/`, `Makefile` and `flake.nix`, all of which
changed. Afterwards, one command says whether it did:

```sh
cd ideas/aideas && make check-release
```

If it did not: the Actions tab, then `Run workflow` (with *force* if needed). The two failures
that silently produced no release before — `gjs` missing from the runner, and a red CI that
nobody was told about — are both fixed, and the second is why `check-release.sh` exists.

### The other reason nothing would have published

`CI - aideas` had **never passed** — every run since the idea was created failed, which nobody
had reason to look at because the *release* workflow was the one being discussed. The cause was
a single test in the `http` suite: `a name that does not resolve is "host not found"`. A laptop
with a resolver reports `Gio.ResolverError.NOT_FOUND`; a build sandbox on a runner, with no
`/etc/resolv.conf` at all, reports something else, so the assertion passed here and failed
there on every single run.

That matters to this entry directly: the new release job runs `nix flake check` **before**
publishing, so this test would have failed the release too — a second silent non-release, for a
different reason, discovered only because the job was rewritten to run its own tests.

The fix separates the two things that test was conflating. The code-to-phrase mapping is now
pinned hermetically against `GLib.Error`s constructed by hand — eleven codes across
`Gio.IOErrorEnum` and `Gio.ResolverError`, plus an unmapped one — and the live DNS case asserts
only what is true anywhere: that the reason is one of the module's own phrases and is plain
ASCII, never a localised GLib message. `tests/http`: 16 checks → **29**.

### What the failed run actually said

Checked rather than assumed, and one correction to PLAN.md's account:

- The workflow has run **three** times, not once. The 2026-08-14 run (the v0.1 merge) failed;
  two later runs — 2026-08-16T23:17Z and 23:21Z, on pushes that touched `ideas/aideas/**` —
  **succeeded by publishing nothing**, because by then `STATUS.md` said `not_started` and the
  job's own gate refused. So the path filter is not why it went quiet; the `status: done` gate
  is. That gate is being kept (the first answered question), so this stays true.
- The failure is exactly what PLAN.md says:
  `make: gjs: No such file or directory` / `make: *** [Makefile:66: check-bundle] Error 127`.
  `pack` depends on `check-bundle`, which runs `gjs`, which a stock runner does not have.
- The v0.1 release was made by hand by `gortazar` on 2026-08-16T20:41Z. Its assets are the zip
  (32 670 bytes, `sha256:53606c5a…`) and **`SHA256SUMS`** — not `<zip>.sha256`, which is what
  `install.sh` asks for and gets a 404 for, so it installs without verifying anything.

## What 0.1 covered

Every feature in `PLAN.md`, each with tests, and all four suites green:

| Suite | What it covers | Count |
| --- | --- | --- |
| `make test-unit` | parsing, grouping, wording, visibility, badge, backoff, scheduler, test-connection | **205** |
| `make test-http` | the real libsoup transport against a stub server on loopback | **16** |
| `make test-contract` | `/state` driven over fixture repositories, keeping the two halves in step | **24** |
| `make smoke` | the extension in a nested headless GNOME Shell, plus screenshots | **39** |
| `make test-install` | `install.sh` executed for real from a clean directory | **27** |
| `nix flake check` | lint, unit, http and the assembled bundle | 4 checks |

| Feature in PLAN.md | Where |
| --- | --- |
| A panel indicator that appears with the work | `src/lib/indicatorModel.js`, `src/extension/indicator.js` — visible only while a cycle runs, six stock symbolic icons, agent/blocked badge |
| A menu grouped by state | `src/lib/menuModel.js`, `menuItems.js` — Running, Blocked, Ready, Also in the queue; empty sections omitted; `will_run_next` marked; read-only rows |
| A header line for the cycle itself | `Cycle running for 12 min, 2 agents` / `Idle`, with the age of the reading and the lock's last renewal |
| Honest failure states | four readings in `src/lib/state.js`; `unavailable` and `unreachable` worded apart; last good reading kept and dated |
| Polling that behaves | `src/lib/scheduler.js` + `backoff.js` + `stateClient.js` — one timer, single-flight, 5 s while the menu is open, backoff to 5 min, nothing while locked or idle |
| A preferences window | `src/extension/prefs.js` — host, port, interval, always-show, and a Test button that names the real fault |
| A documented, tested contract | `docs/state-contract.md` + `tests/test_state_contract.py` |
| Headless GJS tests | `tests/unit/` — 205, no compositor, no network |
| A compositor smoke test | `ci/smoke-test.sh` + `ci/probe/` — 39 checks, screenshots, five enable/disable rounds, and a request counter proving no timer survives a disable |
| Installed with the orchestrator, on the laptop | `install.sh`, verified by `ci/install-test.sh`; pointed at from `SETUP.md`'s Laptop section |
| CI and a release | `.github/workflows/ci-aideas.yml` (contract + flake checks), `release-aideas.yml` (tag, release, asset, checksum) |

**How the release actually went.** The claim below was written before the merge and was wrong in two ways, which is what this entry exists to fix: the workflow could not build the artefact at all, and `make pack` and `nix build` were only byte-identical by coincidence of matching mtimes (U1 makes it true by construction). The original note read:

**The one thing that finishes itself.** The release for `v0.1` publishes when this work reaches
`main`: `release-aideas.yml` runs on push, reads `version: 0.1` and `status: done` from this
file, and creates the `aideas-shell-v0.1` tag and release itself. It has to work that way —
the orchestrator pushes with a plain `git push`, which does not carry tags, so a tag created in
this worktree would never reach GitHub. An agent may not push this repo, so I could not publish
the release myself, and therefore could not download the *published* asset. What was verified
instead, and is as close as this can get: the artefact `release-aideas.yml` will upload is the
one `make pack` and `nix build` both produce (byte-identical, 32 670 bytes), and `install.sh`
was executed against exactly that zip from a clean directory — over HTTP, with a checksum, and
through a stubbed releases API. If the release has not appeared after this merges, run the
workflow by hand from the Actions tab; nothing else is outstanding.

## Notes for later units

- **One behaviour found while pinning the contract, now documented and tested:** every
  entry of a *running* slug comes back as `running`, not just the first. `queue_rows`
  checks the agent list before the duplicate check and never adds a running slug to its
  seen set. So the Running section must tolerate the same slug appearing twice, and rows
  must be keyed by `position` — `slug` is not unique.
- **`lock_age_seconds` survives a dead cycle** (`running: false`, non-null age), which is
  exactly the signal for a box that stopped renewing. `cycle_started_at` does *not*: it is
  null unless the cycle is live.
- **The contract test is not a flake check, deliberately.** The flake's root is this folder,
  and `tests/test_state_contract.py` imports the orchestrator from two directories up, which
  a flake cannot see. It runs as its own CI job and as `make test-contract`, needing nothing
  but a stock `python3` — which is what it is designed for, since it can then also be run on
  the box itself. PLAN.md said "the contract test through flake.nix"; this is the one
  documented deviation from it.
- **One decision the answered question did not cover, taken in U4:** what the button does
  when a poll fails while a cycle was running a moment ago. Strictly hiding it would blink the
  panel out on every VPN hiccup, and would make the "unreachable" icon PLAN.md lists
  unreachable in practice — it could only ever be seen with "always show" on. So a good
  reading keeps the button up for 5 minutes after contact is lost, wearing the unreachable
  icon and the count it last knew. Still "only while a cycle is running", just not forgetting
  between two readings. A box that answers `available: false` does **not** borrow from the
  past: it is talking to us, and what it says is that it cannot read its queue.
- **Failure reasons must come from GError codes, never messages.** GLib messages are
  localised — on this laptop a refused connection says "Conexión rehusada" — so the transport
  maps `error.matches(Gio.IOErrorEnum, ...)` and `Gio.ResolverError` to fixed English phrases.
  `error.domain` is a *numeric quark* (195 for Gio, 468 for the resolver), not a name.
- **Three things only a real compositor said**, each now fixed and guarded:
  1. A backtick inside a template literal holding D-Bus XML ends the string. `ci/` is now in the
     flake's lint fileset, where eslint reports that in a second — the compositor took a
     four-minute run to say only that the probe never reached the bus.
  2. `St.Label` owns an internal `Clutter.Text` with the same string, so a naive actor walk
     reports every menu label twice.
  3. **Disabling and re-enabling an extension inside one main-loop iteration is not a round.**
     `ExtensionManager`'s bookkeeping ends up out of step with reality and the extension stays
     down with nothing logged. The smoke test drives each half-round as its own call and waits,
     which is what a screen lock and its unlock actually look like.
- **The orchestrator box is not currently serving `/state`.** On `gx10-e7da`,
  `idea-heartbeat.service` and `idea-agent.timer` are both `inactive` and nothing listens on
  8787; the orchestrator that is actually running cycles is on this laptop, serving `/state` on
  **127.0.0.1:8833** (`HEARTBEAT_PORT=8833`, `HEARTBEAT_BIND_IP=127.0.0.1`). So the port
  default of 8787 is right per SETUP.md but will not match this deployment, and the risk
  PLAN.md raised about `IDEAS_REPO_PATH` in the serving unit could not be checked on the box —
  the local server has it set, and `/state` there is `available: true`. Worth a line in
  SETUP.md rather than a change to the extension.
- **A virtual-pointer click could not press a button in the preferences window** (a separate
  Wayland client): motion and press/release spaced across main-loop iterations moved the
  pointer but the window closed rather than activating anything. Dropped rather than left in as
  dead test code — `tools/probe-state.js` verifies that code path headlessly instead, which is
  better anyway because it is also useful to a person diagnosing a real setup.
- The answered open questions settle: the button is visible **only while a cycle is
  running**; this work may edit `SETUP.md` and `orchestrator/`; the release is a tag on
  this repo (`aideas-shell-v0.1`) published by `.github/workflows/release-aideas.yml`; menu
  rows stay read-only.
