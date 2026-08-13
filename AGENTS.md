# Global rules for the idea-builder agent

These rules apply to every idea in `ideas/`. This file is prepended to each idea's generated
`CLAUDE.md` — do not duplicate these rules inside individual PLAN.md files.

## Where the code lives

**Every idea is developed in its own GitHub repository, included here as a submodule.**
This repo is the workshop — the queue, the plans, the status — not the home of the code.

- The repository is named after the idea's slug, under the same account as this repo:
  `github.com/<owner>/<slug>`. If it does not exist yet, create it: `gh repo create
  <owner>/<slug> --public`. It must be **public**, because the installation methods below
  download release assets without credentials.
- Add it as a submodule at `ideas/<this-idea>/upstream`. `ideas/pwgen/` and `ideas/recap/`
  already do this — copy their layout rather than inventing another.
- **All source, tests, CI and releases live upstream.** `ideas/<this-idea>/` keeps only the
  wrapper: `PLAN.md`, `STATUS.md`, `plans/`, and whatever thin glue helps (a `flake.nix`
  that consumes the submodule, a pin-check script).
- You have push access to the idea's own repository over the SSH key you run under. Push
  there freely — that is where the work belongs.
- **Commit the submodule pointer here whenever you push upstream.** The pointer is how this
  repo records which upstream commit the idea is at; leave it stale and the work looks
  lost from here even though it is safely pushed.

## Workflow
- Work within `ideas/<this-idea>/` and its `upstream` submodule. Never touch other idea
  folders, `README.md`, `AGENTS.md` or `.agent-config.yml`. The single exception outside
  your folder is your own `.github/workflows/ci-<this-idea>.yml`.
- Do not edit `CLAUDE.md`. It is regenerated from `AGENTS.md` + `PLAN.md` + `STATUS.md`
  before every cycle, so any edit is silently discarded.
- Tests first: for any feature, write a failing test before writing the implementation.
- Work in small units and commit each one — see **Units of work** below. Never leave the
  tree in a broken (non-building, non-passing-tests) state at the end of a session.
- You are working in a git worktree on a branch of your own, because another agent may be
  building a different idea at the same time. Commit freely, but do **not** push *this*
  repo, switch branches, rebase, or merge — the orchestrator merges your branch and pushes
  once you finish. Pushing your idea's **own** repository is expected and encouraged; this
  rule is only about the ideas repo.
- Keep everything you produce inside your idea folder or its upstream repo. If a task needs
  a scratch clone of something else, put it under `ideas/<this-idea>/` — not in `/tmp`,
  which is not committed and can be wiped between cycles, silently losing a session's work.
- If you hit a genuine ambiguity that blocks progress (not something you can reasonably
  assume your way past), STOP and do the following instead of guessing:
  1. Append a new question under `## Open Questions` in this idea's `PLAN.md`, as its own
     `- [ ] question text` line. That exact unticked-checkbox form is what marks the idea
     blocked — a question written as plain prose will be ignored and you'll be woken up
     to work on the same ambiguity again.
  2. Update `STATUS.md` explaining what's blocked and why.
  3. End the session — do not keep working on this idea until the question is answered.
- Never delete or reword an already-answered question in `PLAN.md`. Only append new ones.
- When every feature in `PLAN.md` is delivered, tested, green, **released and installable**
  (see **Shipping**), set `status: done` in `STATUS.md` and say in the body what "done"
  covered. That is the only way to finish an
  idea: the orchestrator keeps picking an `in_progress` idea and rebuilding it every cycle
  otherwise, so declaring completion in prose alone quietly burns the budget forever. Do
  not use it to mean "done for now" — a stopping point mid-plan is `in_progress`.

## Units of work

Split every feature in `PLAN.md` into units small enough to build, test and commit in one
go — one observable behaviour each. Finish one before starting the next; never leave two
half-built. If you can't say what a unit does in a single specific sentence, it's still
two units.

A unit is done when its tests pass, the build is clean, and it's committed. Until then it
doesn't exist as far as anyone else can tell, so:

- **Commit at the end of every unit, not at the end of the session.** Ten small commits
  beat one big one. A commit whose diff sprawls across several behaviours should have
  been several commits.
- **Update `STATUS.md` in that same commit** — what this unit added, and what the next
  unit is. A session can end at any moment; a `STATUS.md` you planned to write later
  reads afterwards as work that never happened.
- **Estimate in units, not in features.** "3 of 7 units done" is a fact someone can act
  on; "working on the daemon" isn't.

### Your uncommitted work may be committed for you

A cycle can be stopped at any instant — by its deadline or by a signal — and the
orchestrator then sweeps whatever is sitting in your worktree into a commit so that
nothing is lost. That commit is merged like any other. It has already happened: an agent
was stopped after writing a test importing a module it hadn't created yet, and the merged
result broke the whole suite with an `ImportError`.

So keep the tree in a state you'd be willing to have committed *right now*. Tests-first is
still correct — just close the loop quickly:

- Create the module in the same breath as the test that imports it. A stub that throws
  `Error('not implemented')` is enough; it keeps the tree loadable.
- Keep the red window down to minutes, and never end a unit inside it.
- A failing assertion is a fine thing to be caught mid-way through. A tree that can't
  even load its test suite is not.

## Versioning

Every idea carries a version, held as `version:` in the header of its `STATUS.md`.

- **An idea starts at `0.1`.** Its first piece of work delivers `0.1` — do not bump during
  it.
- **Later entries in `README.md` say whether they are a `minor` or a `major` update**, and
  you bump the version when that work is complete:
  - `minor` — `0.1` → `0.2`, `1.4` → `1.5`
  - `major` — `0.1` → `1.0`, `1.4` → `2.0`
  Both components are integers, not decimal places: a minor bump from `0.9` gives `0.10`,
  not `1.0`. Only a `major` entry moves the first number.
- The generated `## This cycle` block at the top of your `CLAUDE.md` states the current
  version and, when a bump is due, the exact version to set. Set it in the same commit
  that finishes the work, alongside `status: done`.
- Never lower a version, and never bump twice for one entry. If the entry does not say
  which kind of update it is, treat it as `minor` and note the assumption in `STATUS.md`.

The version is what `## Finished` records against each completed entry, so it is the one
durable answer to "what did this idea actually ship, and when".

## Shipping

An idea is not finished when the code works. It is finished when someone else can install
and run it without building anything.

### Publish a release for every completed entry

Each entry in `README.md` that you finish ships a release from the idea's own repository,
tagged `v<version>` to match the version you set in `STATUS.md` — `v0.1` for the first
piece of work, then `v0.2`, `v1.0` and so on.

- A release carries **built artefacts**, not just a tag: the binary for each supported
  platform, or the packaged equivalent for whatever the idea is — a `.zip` for a shell or
  browser extension, a `.deb`, a container image. If the thing has no natural single
  artefact, package what a user actually needs to install.
- Build and publish it from a workflow **in the idea's own repository**, where the
  automatic `GITHUB_TOKEN` can tag, create the release and upload assets. Nothing needs a
  personal access token or a secret; a cross-repo token would only be required if the
  workflow lived in this repo, which is exactly why it does not.
- Releasing is part of finishing the entry, not a follow-up. `status: done` with no release
  for that version is not done.

### Every idea installs without compiling

Provide an automated installation path that downloads a prebuilt artefact. "Clone it and
run the build" is not an installation method.

- A `curl`-able installer is the usual answer: `curl -fsSL https://.../install.sh | sh`,
  fetching the right asset from the latest release, verifying it, and putting it on `PATH`.
- Use the platform's own channel where one exists and fits better — an apt repository or
  `.deb`, extensions.gnome.org for a GNOME Shell extension, the add-on store for a browser
  extension. Pick what the thing's users would actually reach for.
- The idea's `README.md` opens with that command, copy-pasteable, before any development
  instructions.
- **Verify it from a clean directory before calling the entry done** — download the
  published asset and run it. An installer that was never executed is a guess.

## Required per-idea deliverables

**In the idea's own repository** (`ideas/<this-idea>/upstream`):

- `flake.nix` providing a reproducible dev/build/test/release environment.
- `README.md` opening with the one-line install command, then how to enter the environment
  (`nix develop`), run tests and build. Once there is a working build, add screenshots
  under `screenshots/` and reference them here.
- CI that runs the test suite on push and PR, plus the release workflow described above.
- The installer — `install.sh` or the packaging that channel needs.

**In `ideas/<this-idea>/` here:**

- The `upstream` submodule, with its pointer committed and current.
- `STATUS.md` kept up to date, refreshed at every unit rather than only at session end:
  units done, the next unit, the version, current difficulty estimate, last session id. It
  is the only report anyone reads to judge progress, so make it match the tree — list what
  is committed and passing, not what is nearly ready.
- Enough glue to check the wrapper is coherent: `ideas/pwgen/scripts/check-pin.sh` is the
  model, keeping the submodule pointer and any flake input naming the same commit.
- A path-filtered CI workflow at this repo's **root** `.github/workflows/ci-<slug>.yml` —
  GitHub only discovers workflows there. With the source upstream this is a light check of
  the wrapper and the pin, not the idea's real test suite, which runs upstream. This is the
  one file outside your own folder you may edit.

## Style
- Prefer boring, well-supported tools over novel ones unless the idea specifically calls
  for something else.
- Keep commit messages factual and specific (what changed, not "progress").
- Do not invent features not listed in `PLAN.md`. If you think something's missing,
  propose it as an open question rather than just building it.
