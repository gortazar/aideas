# Setup

Three pieces:

1. **This repo** — the ranked idea list ([README.md](README.md)), the global rules
   ([AGENTS.md](AGENTS.md)), the tunable knobs ([.agent-config.yml](.agent-config.yml)),
   and one self-contained folder per idea under `ideas/`.
2. **Orchestrator box** — always-on, VPN-reachable. Runs `orchestrator.py` on a systemd
   timer and `heartbeat_server.py` as a long-lived service.
3. **Laptop** — Claude Code hooks push a heartbeat to the box over VPN whenever a session
   starts, uses a tool, or ends. Push, not pull: the laptop's VPN IP isn't stable and it
   sleeps, so only the box's address can be relied on.

The orchestrator only works when the laptop is *not* being used, so idleness has to be
observed from outside the laptop — a suspended machine can't report anything, and
"no heartbeat for `heartbeat_staleness_minutes`" covers sleep, crashes and long-running
commands with one rule.

## Values you need before starting

| Value | Where it goes | Notes |
| --- | --- | --- |
| Box VPN IP | `HEARTBEAT_BIND_IP` on box, `ORCHESTRATOR_HEARTBEAT_URL` on laptop | Bind to the VPN interface only |
| Shared secret | `HEARTBEAT_SHARED_SECRET` on box, `ORCHESTRATOR_HEARTBEAT_SECRET` on laptop | `openssl rand -hex 32`, same value both sides |
| Clone path on box | `IDEAS_REPO_PATH` | Absolute; `/opt/idea-agent` in the examples below |
| Service username on box | `User=` in both units, and the `PATH=` line | The user whose `~/.claude` holds the auth token |

## Installing on this laptop

One command installs the orchestrator as *user* systemd services and then the GNOME Shell
extension, pointed at the address it just configured:

```bash
./orchestrator/install.sh                       # this clone
./orchestrator/install.sh --repo ~/aideas-sandbox/repo   # or a different one
```

User units rather than system ones: the orchestrator runs as you, because it needs your
`~/.claude` token to invoke agents and your SSH key to push. Options: `--port`, `--bind`,
`--no-extension`, `--enable-timer`, `--uninstall`.

**The timer is installed but not enabled.** Enabling it means cycles run every five
minutes on their own, and spend money on their own — so it is an explicit choice:

```bash
systemctl --user start idea-orchestrator.service          # one cycle now
systemctl --user enable --now idea-orchestrator.timer     # every 5 minutes, unattended
```

Two things it cannot do for you: on Wayland the Shell must be restarted (log out and back
in) before it will load new extension code, and user services stop when you log out unless
you run `sudo loginctl enable-linger $USER`.

The section below is the other deployment — a separate always-on box, with system units.

## Orchestrator box

```bash
# 1. Clone, as the service user (its SSH key needs push access — the orchestrator
#    commits and pushes every cycle).
sudo mkdir -p /opt/idea-agent && sudo chown "$USER" /opt/idea-agent
git clone git@github.com:gortazar/aideas.git /opt/idea-agent

# 2. Authenticate Claude Code non-interactively. This writes a long-lived subscription
#    token into ~/.claude for the *service user*, so run it as that user.
claude setup-token

# 3. Fill in the environment file.
sudo cp /opt/idea-agent/orchestrator/env.example /etc/idea-agent.env
sudo "${EDITOR:-vi}" /etc/idea-agent.env        # replace every CHANGEME
sudo chown root:root /etc/idea-agent.env && sudo chmod 600 /etc/idea-agent.env

# 4. Install the units (replace CHANGEME_USER in both first).
sudo cp /opt/idea-agent/orchestrator/systemd/*.service \
        /opt/idea-agent/orchestrator/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now idea-heartbeat.service
sudo systemctl enable --now idea-orchestrator.timer
```

Check it:

```bash
curl -s http://127.0.0.1:8787/status | python3 -m json.tool   # heartbeat state
systemctl list-timers idea-orchestrator.timer                  # next wake
journalctl -u idea-orchestrator -f                             # cycle logs
sudo systemctl start idea-orchestrator.service                 # force one cycle now
```

A forced cycle still honours `allowed_hours`, the daily budget, the heartbeat gate and
the lock — it will say which one stopped it and exit. To genuinely test outside the
window, widen `allowed_hours` in `.agent-config.yml` temporarily.

## Laptop

```bash
# In ~/.zshrc, or better ~/.config/idea-agent/env sourced from it — this holds a secret,
# so keep it out of anything you might commit.
export ORCHESTRATOR_HEARTBEAT_URL="http://<box-vpn-ip>:8787/heartbeat"
export ORCHESTRATOR_HEARTBEAT_SECRET="<same secret as the box>"
```

Then install the hook:

```bash
mkdir -p ~/.claude/hooks
cp orchestrator/hook-heartbeat.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/hook-heartbeat.sh
```

and merge the `hooks` key from [claude-settings/hooks.json](claude-settings/hooks.json)
into your existing `~/.claude/settings.json`. It registers `SessionStart`, `PostToolUse`
and `SessionEnd`. The hook is fire-and-forget with a 2s curl timeout and always exits 0 —
a missed heartbeat only costs the orchestrator one extra staleness window, and it must
never slow down or block your own session.

Verify from the laptop, on VPN:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"event\":\"manual_test\",\"secret\":\"$ORCHESTRATOR_HEARTBEAT_SECRET\"}" \
  "$ORCHESTRATOR_HEARTBEAT_URL" -w '%{http_code}\n'
```

`200` means accepted, `401` means the secrets don't match, a hang means the VPN or the
bind address is wrong.

Note that the heartbeat gate fails **closed**: if `idea-heartbeat.service` is down, the
orchestrator can't tell whether you're working, so it skips the cycle rather than risk
building on top of your session. That means a dead heartbeat service quietly halts all
work — if nothing has been built for a while, check it first:

```bash
systemctl status idea-heartbeat.service
journalctl -u idea-orchestrator | grep -i unreachable
```

### Seeing the queue in the top bar (optional)

[`ideas/aideas`](ideas/aideas/) is a GNOME Shell extension for this laptop: a panel button
while a cycle is running, whose menu lists what is running, what is ready, and what is
blocked on a question. It reads `GET /state` from the same heartbeat server the hook above
posts to, so there is nothing new to install on the box.

```bash
curl -fsSL https://raw.githubusercontent.com/gortazar/aideas/main/ideas/aideas/install.sh | sh
```

Run it *after* exporting `ORCHESTRATOR_HEARTBEAT_URL` above and the installer takes the
box's address from it; otherwise set it with `gnome-extensions prefs
aideas-shell@patxi.gortazar`. On Wayland, log out and back in for the Shell to load it.

Two things to know, both about the box rather than the extension:

- `/state` is served by `idea-heartbeat.service`, and it can only read the queue if that
  unit has `IDEAS_REPO_PATH` in its environment — the same value the orchestrator unit
  uses. Without it the menu says so, in the server's own words, rather than looking broken.
- `HEARTBEAT_BIND_IP` and `HEARTBEAT_PORT` are what the extension has to be pointed at. If
  you changed the port from 8787, change it in the extension's preferences too.

#### Letting the panel start a cycle

The menu's *Run a cycle* posts to `/cycle` on the same receiver. It applies the gates a
timer-fired cycle applies — the stop file, `allowed_hours`, the daily budget, the heartbeat,
the lock — and reports which one refused, so a click that does nothing still says why.

**How the cycle is launched is the box's decision, and on a sandboxed box you must make it.**
`idea-heartbeat.service` deliberately runs with `ProtectSystem=strict`, `ProtectHome=yes`,
`MemoryMax=128M` and no `PATH` carrying `claude`; a cycle forked from inside it would start,
find no `claude`, and fail every agent. So point it at systemd instead:

```bash
# In /etc/idea-agent.env, read by idea-heartbeat.service
ORCHESTRATOR_CYCLE_COMMAND="systemctl start idea-orchestrator.service"
```

That makes systemd, not the receiver, supply the cycle's `PATH`, its home directory and its
timeouts — the same environment a timer-fired cycle gets. The cost is a permission: the
receiver's user must be allowed to start that unit. Either run the receiver as a user with a
polkit rule for it:

```
# /etc/polkit-1/rules.d/50-idea-orchestrator.rules
polkit.addRule(function(action, subject) {
    if (action.id == "org.freedesktop.systemd1.manage-units" &&
        action.lookup("unit") == "idea-orchestrator.service" &&
        subject.user == "CHANGEME_USER")
        return polkit.Result.YES;
});
```

or use the `--user` units and `ORCHESTRATOR_CYCLE_COMMAND="systemctl --user start
idea-orchestrator.service"`, which needs no polkit rule at all.

If you leave it unset, the receiver starts a detached `python3 orchestrator.py run` itself,
which is right for a box that runs the receiver *outside* that sandbox — for instance one where
you start it by hand. It refuses to do so when `claude` is not on the `PATH` it would hand the
cycle, rather than burning a cycle to discover it.

Two more optional settings: `HEARTBEAT_SHARED_SECRET` also protects this endpoint (the panel
sends it, as the heartbeat hook does; without one the endpoint is as open as `/heartbeat`), and
`ORCHESTRATOR_CYCLE_MIN_SECONDS` (default 30) is the shortest gap between two launches.

Check it by hand before trusting the button:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$ORCHESTRATOR_HEARTBEAT_SECRET\"}" \
  http://<box-vpn-ip>:8787/cycle
# {"started": false, "gate": "lock", "reason": "A cycle is already running"}
```

A `404` means the box is older than the extension; `started: true` means *launched*, not
finished — the cycle re-checks its own gates and may still exit, which is why the panel keeps
watching `/state` afterwards.

To check what the extension will see, from the laptop, without installing anything:

```bash
cd ideas/aideas && gjs -m tools/probe-state.js <box-vpn-ip> 8787
```

## Adding an idea

Add a numbered entry to [README.md](README.md) in the format documented there. That's the
whole job — on its next cycle the orchestrator creates `ideas/<slug>/`, drafts `PLAN.md`,
and generates `.github/workflows/ci-<slug>.yml`. Position in the list is the priority.

To hand-seed instead, copy `ideas/_template/` to `ideas/<slug>/` and write `PLAN.md`
yourself; the planning pass skips any idea that already has one.

## Answering a blocked idea

When Claude hits a genuine ambiguity it appends `- [ ] question…` under `## Open
Questions` in that idea's `PLAN.md`, sets `status: blocked` in `STATUS.md`, and stops —
the orchestrator then moves to the next eligible idea. To unblock, edit `PLAN.md`: change
`- [ ]` to `- [x]` and write the answer inline on that line. Leave answered questions in
place; they're the record of what was decided and they stay in Claude's context because
`CLAUDE.md` is regenerated from `PLAN.md` every cycle. Set `status:` back to
`in_progress` (or `not_started`) in `STATUS.md`, commit, push.

Only an unticked `- [ ]` blocks. A question written as prose won't be noticed.

## How a cycle works

The docstring at the top of [orchestrator/orchestrator.py](orchestrator/orchestrator.py)
is the authoritative spec. Everything else is supporting infrastructure for that script.

## Budget

`--max-turns` doesn't exist in the Claude Code CLI, so the per-cycle safety valve is
`--max-budget-usd`, which aborts a runaway cycle mid-flight. The daily gate sums the real
`total_cost_usd` each cycle reports into `.orchestrator/usage.log`.

Because the box authenticates with a subscription token rather than a metered API key,
those dollar figures are the *equivalent* API value of the work, not money billed. Treat
them as a consistent proxy for allowance burn; your actual ceiling is the plan's rolling
5-hour and weekly windows. See the notes at the top of `.agent-config.yml`.

```bash
# What did today cost? LC_ALL=C matters: in a comma-decimal locale awk prints "3,79".
LC_ALL=C awk -F, -v d="$(date +%F)" '$1==d {s+=$2} END {printf "$%.2f\n", s}' .orchestrator/usage.log
```

The daily figure gates the *start* of a cycle, so a day can overshoot by at most
`parallel_agents × max_cycle_cost_usd`. The per-cycle cap is also approximate — a cycle
capped at $1.50 has been seen finishing at $1.53 — and it stops the agent mid-tool-call,
so a cycle can be cut off partway through a push or a merge.

### Turning the limits off

`allowed_hours`, `max_daily_cost_usd`, `max_cycle_cost_usd` and `max_plan_cost_usd` each
accept `unlimited` (or `none`/`off`):

```yaml
allowed_hours: "unlimited"
max_daily_cost_usd: unlimited
max_cycle_cost_usd: unlimited
```

With `max_cycle_cost_usd: unlimited` no `--max-budget-usd` is passed, so an agent runs
until it decides it has finished rather than being cut off — better output, no ceiling.
Combined with `parallel_agents`, an unlimited overnight run can consume your entire
rolling allowance, so it is worth pairing with a `max_daily_cost_usd` you keep finite.

The heartbeat gate has deliberately **no** off switch: it is the one rule that keeps the
orchestrator off your allowance while you are working, which is the point of the system.

### Parallel agents

`parallel_agents` (default 2) sets how many ideas are built concurrently, one agent each,
taking the top N eligible ideas in README order. Each agent gets its own git worktree
under `.orchestrator/worktrees/<slug>` on branch `agent/<slug>`, so its commits can't
collide with the other's, and the orchestrator merges the branches back at the end of the
cycle. A conflicting merge is treated as a signal that agents crossed lanes: the branch
and worktree are left in place for inspection rather than discarded.

```bash
# What each agent is doing right now
git -C "$IDEAS_REPO_PATH" worktree list
git -C "$IDEAS_REPO_PATH" branch --list 'agent/*'
```

Leftover `agent/*` branches mean a merge conflicted or a cycle was killed mid-flight; the
next cycle rebuilds its own worktrees from scratch, so they are safe to inspect and delete
once you've salvaged anything you want.

## Seeing what it will do

```bash
python3 orchestrator/orchestrator.py status
```

Read-only, and needs no environment set up — it defaults to the clone it lives in and
`http://127.0.0.1:8787`. It reports, in order:

- **the heartbeat**, whether it is up, and whether it is `systemd`-managed or a user
  process someone started by hand. That distinction matters: an unsupervised receiver dies
  with its terminal or at the next reboot, and every cycle refuses to start while it is
  unreachable — so the orchestrator would go quiet without any obvious cause.
- **the orchestrator's own version**, and the budget and cycle settings in force.
- **every entry under `## Ideas`** — in queue order, with each idea's version, whether it
  is buildable, blocked (and on how many questions), or queued behind an earlier entry for
  the same folder. A `*` marks what the next cycle would pick, and the last line says so
  outright.

Entries under `## Finished` are deliberately not shown; they are a record, not work.

## Stopping gracefully

A cycle never has to be killed. Three things ask it to wind down, and all take the same
path: each agent is sent SIGTERM, given `agent_grace_seconds` to exit, and then the cycle
carries on to commit their work, merge the branches, update `STATUS.md` and push. Nothing
in progress is thrown away.

```bash
# Pause the whole system — honoured before a cycle starts and mid-cycle
touch "$IDEAS_REPO_PATH/.orchestrator/stop"
rm    "$IDEAS_REPO_PATH/.orchestrator/stop"   # resume

# Stop the cycle that's running now
sudo systemctl stop idea-orchestrator.service
```

The third is `max_cycle_minutes`: the cycle stops its own agents at that point. That's
what keeps a long cycle from being SIGKILLed halfway through a merge, so keep the ordering
in `.agent-config.yml` intact — `max_cycle_minutes < lock_ttl_minutes < TimeoutStartSec`.
Setting it to `unlimited` gives up that guarantee, which matters most when the cost caps
are also off and cycles have nothing else bounding them.

A SIGTERMed agent still writes its result JSON on the way out — with its session id and
its real cost — so it stays resumable and the day's ledger stays accurate. It's marked
`is_error: true` with `subtype: error_during_execution`, which is how a stopped cycle is
told apart from one that finished on its own.

Only a SIGKILL or a crash loses that JSON. Then the orchestrator recovers the session id
from the transcript filename so `--resume` still works, but the cost is genuinely gone: it
goes in the ledger as `build-stopped` with `$0` and a warning, and the day under-counts by
whatever that agent spent.

```bash
grep -c 'stopped' "$IDEAS_REPO_PATH/.orchestrator/usage.log"   # unaccounted-for agents
```

## Security

The heartbeat server must only be reachable over the VPN — bind it to the VPN interface,
never `0.0.0.0`. The shared secret is a minimal safeguard against stray requests, not a
substitute for that. `.orchestrator/` (lock, session ids, cycle logs, usage ledger) is
gitignored, as is `*.env`.
