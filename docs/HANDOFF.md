# Handoff: Idea-Builder Orchestrator Setup

This scaffold was designed in a planning conversation with Claude (chat). You are Claude
Code, picking this up fresh in a real repo. Everything you need is below — you don't need
the original conversation.

## What this system is
A background agent that builds ideas from a ranked list (`README.md`) one at a time,
running only when the user isn't actively using Claude Code on their laptop, within a
configured time window and token budget.

## Design decisions already made (don't re-litigate these unless asked)
- **Orchestrator runs on a separate always-on box**, reachable from the laptop only via
  VPN. It is NOT the laptop — a suspended laptop can't run anything, so idleness must be
  observed externally.
- **Heartbeat is push, not pull**: the laptop's VPN IP isn't stable and it sleeps, so
  Claude Code hooks on the laptop POST heartbeats to the orchestrator's stable VPN
  address, not the reverse.
- **"Other agents" = other Claude Code sessions** on the laptop specifically (not other
  GitHub Actions or unrelated processes).
- **Suspend/idle detection is staleness-based**: no heartbeat within
  `heartbeat_staleness_minutes` = treat as idle, regardless of whether it's because of
  sleep, a crash, or a long-running command. `SessionEnd` back-dates the timestamp so a
  clean exit is detected immediately rather than waiting out the window.
- **Implementation always waits for a plan with zero unanswered questions.** New
  questions discovered mid-implementation get appended to that idea's `PLAN.md` (never
  overwriting prior answered ones) and the idea is marked blocked; the orchestrator moves
  to the next eligible idea by README order.
- **Invocation is `claude -p` (headless/print mode)**, resumed across cycles via
  `--resume <session_id>`, bounded by `--max-turns` per cycle as a safety valve
  independent of the token-% daily budget.
- **Each idea's `CLAUDE.md` is generated, not hand-written** — it's
  `AGENTS.md` (global rules) + that idea's `PLAN.md` + tail of `STATUS.md`, regenerated
  every cycle so edits and answered questions always propagate.
- **Every idea folder is self-contained**: its own `flake.nix` (dev/build/test/release
  via Nix), its own `README.md` with build/test/release instructions and screenshots once
  working, its own path-filtered CI workflow. Note: GitHub only discovers workflows under
  the repo-root `.github/workflows/`, so per-idea CI files live there, named per-slug
  (`ci-<slug>.yml`), not inside `ideas/<slug>/.github/`.
- **Budget/schedule are user-tunable at any time** via `.agent-config.yml` — daily token
  %, allowed hours (with timezone), max turns/cycle, heartbeat staleness threshold, lock
  TTL, and how long an idea can be "in progress" before the orchestrator prefers an
  easier one instead.

## Files already built (attached / in this repo under `_scaffold/`)
- `README.md` — setup instructions for both machines
- `AGENTS.md` — global rules merged into every idea's CLAUDE.md
- `.agent-config.yml` — the tunable knobs
- `orchestrator/orchestrator.sh` — the main loop (fully commented spec at the top)
- `orchestrator/heartbeat_server.py` — receiver service for the orchestrator box
- `orchestrator/hook-heartbeat.sh` — client script installed on the laptop
- `orchestrator/lib/lock.sh` — expiring repo lock
- `claude-settings/hooks.json` — Claude Code hook registration for the laptop
- `ideas/_template/{PLAN.md,STATUS.md,flake.nix,ci.yml}` — per-idea starter files

## What's still unresolved / needs the user's input
- The `pick_idea` / plan-parsing logic in `orchestrator.sh` assumes README idea entries
  link to `ideas/<slug>/` — confirm this matches the real README format, adjust the
  `grep -oP` parser if not.
- Token-usage-% tracking in `orchestrator.sh` is a rough placeholder heuristic
  (`turns_used / max_turns`), not tied to real billing data — needs tuning once real
  usage numbers are visible.
- Heartbeat server is meant to run as a long-lived service (e.g. systemd unit) on the
  orchestrator box — no systemd unit file exists yet, just a bare Python script.
- Nothing has been tested end-to-end yet.

## Your task now
1. Confirm this repo's actual layout matches what's assumed above (README.md idea-list
   format, existing folders, etc.) — ask the user if unclear rather than guessing.
2. Move `_scaffold/*` into place at the repo root (or wherever the user wants), removing
   the `_scaffold/` wrapper.
3. Fill in the placeholders that need real values: VPN IP, shared secret, `IDEAS_REPO_PATH`,
   any systemd unit for `heartbeat_server.py`.
4. Do NOT change the design decisions listed above without checking with the user first —
   they were deliberated over several rounds and reflect real constraints (VPN-only
   reachability, laptop sleep behavior, etc.), not arbitrary choices.
