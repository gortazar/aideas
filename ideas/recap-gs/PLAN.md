# Plan: recap.gs — clear the two BLOCKERs by configuring the rule, not the issues

Difficulty estimate: easy — the remedy is three documented API calls and a ledger row; what keeps it
from being trivial is that nothing changes until a *fresh analysis* runs, and that the fleet's rules
turn a server-side fix into a version bump and a release.

This is a **minor** update: v0.2 → **v0.3**.

## Context

`gortazar_recap-gs` carries two open bugs, both BLOCKER, both `css:S4654` ("CSS properties should be
valid") on `src/stylesheet.css`:

> `src/stylesheet.css:5` — Unknown property "spacing"
> `src/stylesheet.css:13` — Unknown property "spacing"

`spacing` is a real St property. GNOME Shell stylesheets are St's own dialect, not CSS, and Sonar has
no analyser for it, so this rule is wrong about the whole technology and will misfire on every GJS
project with a stylesheet, forever. `ideas/quality-gate/baseline.md` already catalogues it and
measures what it costs: two issues are enough to drag a project with no other bug to reliability
**E**.

Four facts shape the work.

1. **`status: done` is currently a lie, by the repo's own rule.** `AGENTS.md` requires every open
   BLOCKER to be either fixed or written down in `STATUS.md` as a false positive, naming the issue
   key, rule, file and line. This idea's `STATUS.md` does neither — it never mentions Sonar at all.
   That is the gap this entry closes, and it is the reason the entry exists even though no user-
   visible behaviour changes.
2. **This is the worked example in `AGENTS.md`.** Under **Issues: fix them, configure around them,
   never re-label them**, `css:S4654` is named as the model case for the *profile* remedy: a rule
   that is systematically wrong for a technology gets deactivated once in a quality profile, not
   dismissed issue by issue. Dismissal is invisible in git, has to be repeated for every new
   occurrence and cannot be reviewed in a diff.
3. **No issue's status may change.** The token can call `api/issues/do_transition` and
   `api/issues/bulk_change`; this entry must not, and neither may the script it writes. A gate you
   can turn green by re-labelling what it found is not a gate.
4. **`exclusions.md` currently prescribes the other remedy for exactly this file.** Its "Considered
   and rejected" section says the narrow answer, if these ever block a pull request, is
   `sonar.exclusions=src/stylesheet.css`. This entry takes the profile route instead — the rule is
   wrong about the dialect, not about these two lines — so that paragraph is rewritten, not merely
   appended to. A file-level exclusion would also blind Sonar to the *rest* of the stylesheet, which
   the profile route keeps under analysis.

Assumptions, stated rather than asked:

- **The remedy is entirely server-side**, so the only upstream code change is documentation: a
  comment in `src/stylesheet.css` saying why this file is St and not CSS, and where the decision is
  recorded. Nothing about the extension's behaviour changes, and no shipped file's contents change
  in a way a user could observe.
- **The entry still ships a release.** `AGENTS.md` is unambiguous: an entry finished is a version
  bumped and a `v<version>` release published, and `status: done` with no release for that version
  is not done. So v0.3 is tagged and published from the upstream repo's own tag-triggered workflow,
  carrying the same packed zip and SHA-256 as v0.2 plus the comment. See the first open question —
  this is the one place where the rules and the shape of the work pull against each other.
- **The profile is a fleet asset, not a recap-gs one.** It is created and assigned by a script in
  `ideas/quality-gate/scripts/`, because the next GJS project with a stylesheet needs the same thing
  and a one-off curl session in a transcript is not reusable.
- **`spacing` stays in the stylesheet.** It is correct St and it is doing work (`.recap-row` and the
  wrapped text rows). Rewriting valid code to please an analyser that is wrong about the language
  would be the re-labelling failure in a different costume.

## Features

- **`ideas/quality-gate/scripts/ensure-quality-profile.sh`** — the fleet's route to the profile
  remedy, idempotent and safe to re-run, in the house style of `ensure-sonar-project.sh`:
  - Reads `SONAR_TOKEN` from `${XDG_CONFIG_HOME:-$HOME/.config}/idea-agent/env` straight into a
    `curl --config -` on stdin. Never into argv, a file, a log or its own output.
  - Finds the built-in CSS profile with `api/qualityprofiles/search?organization=…&language=css` and
    **asserts `isBuiltIn`** before copying — both `Sonar way` and `Sonar way essentials` report
    `builtIn=true` and are read-only, which is why copying is the route.
  - `api/qualityprofiles/copy` → a copy named once and reused (proposed: **`GNOME Shell (St)
    stylesheets`**), `api/qualityprofiles/deactivate_rule` for `css:S4654` in the copy,
    `api/qualityprofiles/add_project` for each project named on the command line.
  - **Refuses to touch the organisation default** — if the profile it is about to modify is
    `isDefault`, it dies rather than proceeding, so a future misuse cannot widen this.
  - Touches no issue: it never calls `do_transition` or `bulk_change`, and a comment says so.
  - `--status` prints what exists — profile, whether the rule is active in it, which projects it is
    assigned to — and changes nothing.
- **The profile applied to `gortazar_recap-gs`** — the affected project, and the only one the entry
  is required to fix. Which *other* fleet projects are affected is measured, not guessed: the CSS
  language distribution of all six projects is read
  (`api/measures/component?metricKeys=ncloc_language_distribution`) and recorded, so the answer is a
  fact in `STATUS.md` rather than an assumption. `gortazar_aideas` is the only other project holding
  a GNOME Shell stylesheet (`ideas/aideas/src/extension/stylesheet.css`), and it uses no St-only
  property today — see the second open question.
- **A fresh analysis, because the profile alone changes nothing.** Deactivating a rule does not
  retroactively close the issues it already raised; they close on the next analysis of `main`. Since
  `main` is gated and takes no direct push, the analysis comes from re-running the last `main` CI run
  (`gh run rerun`) or, failing that, from the merge of this entry's own documentation pull request.
  Whichever ran is named in `STATUS.md`.
- **Verified green, with numbers rather than adjectives** — after that analysis:
  `api/issues/search?componentKeys=gortazar_recap-gs&resolved=false&severities=BLOCKER` returns 0,
  the `bugs` measure is 0 and `reliability_rating` is back to **A**, and the two issue keys resolve
  as *removed* (rule no longer active) and not as *false positive* or *won't fix* — which is the
  machine-checkable evidence that nothing was re-labelled.
- **`ideas/quality-gate/exclusions.md` updated, as the ledger it is** — a new **Quality profiles**
  section beside the three exclusion tables: repository, profile, language, rule deactivated, what it
  stops reporting, and why. Plus the honest cost, written down: a project on a copied profile stops
  receiving updates to the built-in one, and `css:S4654` no longer catches a genuine typo in a real
  CSS file in that project. The existing "Considered and rejected" bullet about
  `recap-gs`'s `src/stylesheet.css` is rewritten to record that the profile route was taken and why it
  beat the file exclusion, so nobody re-proposes the exclusion later.
- **`ideas/quality-gate/baseline.md` annotated** — the `gortazar_recap-gs` section states the E
  rating as historical, with the date, what was done, and the new reading. The baseline stays a
  record of what was measured; it gains a note, not a rewrite.
- **This idea's `STATUS.md` says all of it** — a v0.3 entry that, for the first time, mentions Sonar:
  the two issue keys, rule, file and lines; that they were a false positive about the *dialect*; that
  the remedy was a profile and not a dismissal; the before/after ratings; and the dashboard link.
  Written so that the AGENTS.md "documented BLOCKER" requirement is satisfied by the text itself.
- **The upstream comment** — `src/stylesheet.css` gains two lines saying this file is St's dialect,
  that `spacing` is a real St property, and where the Sonar decision is recorded. Cheap, and it is
  where the next person looks. (Comments at the top of this file are safe; the icon-loading trap this
  project hit in 0.1 was SVG-specific.)
- **v0.3 released and verified** — the tag pushed from the upstream repo so its own tag-triggered
  workflow builds and publishes, `gh release view v0.3` confirming the zip and its `.sha256`, the
  `upstream/` submodule pin and `scripts/check-pin.sh` agreeing afterwards, and `install.sh` run once
  from a clean directory with `XDG_DATA_HOME` redirected — the same verification v0.1 and v0.2 got,
  not a weaker one because the change is small.

## Approach

Ordered so the thing that can fail late — the analysis — is proved before the paperwork is written
around it.

1. **Q1 — the script.** `ensure-quality-profile.sh`, with `--status` first so the current state
   (built-in profile keys, which profile `recap-gs` is on) is read before anything is written.
2. **Q2 — apply and re-analyse.** Copy, deactivate, assign to `gortazar_recap-gs`, then trigger the
   fresh analysis and read the numbers back. If the rating does not return to A, stop and say why;
   everything below assumes it did.
3. **Q3 — the ledger.** `exclusions.md`'s new section and rewritten rejection note, `baseline.md`'s
   annotation. These land in a pull request on this repository, with the script.
4. **Q4 — upstream and the release.** The stylesheet comment through a pull request on
   `gortazar/recap-gs` (its own gate green on the way in), merge, bump the pin, tag `v0.3`, verify
   the release and the installer, then `STATUS.md` and `version: 0.3`.

## Risks / things to verify early

- **`add_project` may need the organisation parameter** and identifies the profile by name plus
  language rather than by key. A silent 400 here looks like success in a pipeline that ignores exit
  codes — hence `--fail-with-body`, and hence `--status` re-reading the assignment afterwards rather
  than trusting the write.
- **The token may not have Administer Quality Profiles.** It could create projects and change project
  settings during onboarding, which is a different permission. If profile administration is refused,
  the entry stops with the finding written down and an open question for the user — it does not fall
  back to dismissing the issues, and it does not fall back to a wider exclusion.
- **The rerun path may not produce a new analysis.** Re-running a workflow that Sonar has already
  analysed at that commit can be a no-op from Sonar's point of view. The documentation pull request in
  Q4 is the guaranteed second route, which is why Q3 and Q4 land after the verification attempt
  rather than before it.
- **A copied profile drifts.** Sonar updates built-in profiles; the copy does not follow. It is one
  rule off one language, so the drift is small, but it is real and belongs in `exclusions.md` where
  someone can decide later to re-copy.
- **The sweep overwrites `status: done`.** Known fleet behaviour; check the release and the pin with
  the scripts rather than believing the header, and recover with the release workflow's `force` input
  if the tag never fired.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Does this entry ship a **v0.3 release**? `AGENTS.md` says every completed entry bumps the
      version and publishes a release, and the plan above assumes it. But the only upstream change is
      a two-line comment, so v0.3's zip is byte-for-byte v0.2's behaviour, and users get a release
      note that says nothing they can act on. The alternatives are (a) release v0.3 anyway, keeping
      the rule mechanical and the version history honest about "an entry happened here"; (b) leave
      the version at 0.2 and record in `STATUS.md` that this entry shipped no artefact because it
      changed no artefact. Which?
- [ ] Is the profile assigned **pre-emptively** to `gortazar_aideas` (whose
      `ideas/aideas/src/extension/stylesheet.css` is also a GNOME Shell stylesheet, analysed as CSS,
      but which happens to use no St-only property today and so has no issue), or **only to projects
      actually affected**, leaving aideas to be added the day it first goes red? Pre-assigning
      prevents a future surprise BLOCKER on a rule already known to be wrong; assigning only on
      demand keeps the ledger's rows tied to real findings and keeps `css:S4654` catching genuine
      typos everywhere it has not yet been proved wrong.
