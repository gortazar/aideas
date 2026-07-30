# Global rules for the idea-builder agent

These rules apply to every idea in `ideas/`. This file is prepended to each idea's generated
`CLAUDE.md` — do not duplicate these rules inside individual PLAN.md files.

## Workflow
- Work only within `ideas/<this-idea>/`. Never touch other idea folders, `README.md`,
  `AGENTS.md` or `.agent-config.yml`. The single exception outside your folder is your own
  `.github/workflows/ci-<this-idea>.yml`.
- Do not edit `CLAUDE.md`. It is regenerated from `AGENTS.md` + `PLAN.md` + `STATUS.md`
  before every cycle, so any edit is silently discarded.
- Tests first: for any feature, write a failing test before writing the implementation.
- Commit in small, working increments. Never leave the tree in a broken (non-building,
  non-passing-tests) state at the end of a session.
- If you hit a genuine ambiguity that blocks progress (not something you can reasonably
  assume your way past), STOP and do the following instead of guessing:
  1. Append a new question under `## Open Questions` in this idea's `PLAN.md`, as its own
     `- [ ] question text` line. That exact unticked-checkbox form is what marks the idea
     blocked — a question written as plain prose will be ignored and you'll be woken up
     to work on the same ambiguity again.
  2. Update `STATUS.md` explaining what's blocked and why.
  3. End the session — do not keep working on this idea until the question is answered.
- Never delete or reword an already-answered question in `PLAN.md`. Only append new ones.

## Required per-idea deliverables
- `flake.nix` providing a reproducible dev/build/test/release environment.
- `README.md` with concrete instructions: how to enter the environment (`nix develop`),
  run tests, build, and release/publish/deploy. Once the idea has a working build, add
  screenshots under `screenshots/` and reference them in this README.
- A path-filtered CI workflow that runs the test suite on push/PR. GitHub only discovers
  workflows under the **repo-root** `.github/workflows/`, so yours lives there as
  `ci-<slug>.yml`, not inside this folder. The orchestrator creates it from
  `ideas/_template/ci.yml` when it first scaffolds the idea — keep it in step with the
  real test command as the build takes shape. This is the one file outside your own
  folder you may edit.
- `STATUS.md` kept up to date: what's done, what's next, current difficulty estimate,
  last session id.

## Style
- Prefer boring, well-supported tools over novel ones unless the idea specifically calls
  for something else.
- Keep commit messages factual and specific (what changed, not "progress").
- Do not invent features not listed in `PLAN.md`. If you think something's missing,
  propose it as an open question rather than just building it.
