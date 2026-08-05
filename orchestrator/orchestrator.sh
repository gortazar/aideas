#!/usr/bin/env bash
#
# Idea-builder orchestrator — run this on a schedule (every 5 min is fine; the script
# exits fast if there's nothing to do). See orchestrator/systemd/ for the timer unit.
#
# SPEC (authoritative):
#   1. Read .agent-config.yml. If outside allowed_hours, or today's recorded cost is over
#      max_daily_cost_usd, exit immediately.
#   2. Ask the local heartbeat_server (fed by the laptop over VPN) whether a Claude Code
#      session is currently active there. If the heartbeat is fresh (< heartbeat_
#      staleness_minutes old), you're working — exit immediately.
#   3. Acquire the expiring repo lock. If held and unexpired, exit (another cycle or a
#      manual run is already in progress).
#   4. git pull the ideas repo.
#   5. PLANNING PASS: for every idea listed in README.md that has no ideas/<slug>/PLAN.md
#      yet, invoke Claude to draft PLAN.md (features + any Open Questions) and a
#      difficulty estimate; scaffold the idea folder and its root CI workflow; commit.
#   6. BUILD PASS: pick the highest-priority (topmost in README.md) idea where:
#        - PLAN.md exists
#        - PLAN.md has no unanswered questions in its Open Questions section
#        - status is not "blocked"
#      If the current top idea has been "in_progress" longer than stale_idea_after_hours,
#      allow falling through to the next easier idea instead. If nothing qualifies
#      (everything's blocked on you), exit — there's nothing to do.
#   7. Regenerate that idea's CLAUDE.md from AGENTS.md + PLAN.md + tail of STATUS.md.
#   8. Invoke `claude -p` (resuming the prior session if one exists) inside that idea's
#      folder, bounded by --max-budget-usd.
#   9. Parse the result: if Claude appended a new Open Question, mark the idea blocked in
#      STATUS.md. Otherwise record progress. Commit + push either way.
#  10. Release the lock, record real cost/turn usage, exit.

set -euo pipefail

# Non-negotiable: this script does float maths by piping awk output into bc, and in a
# comma-decimal locale awk prints "0,4211" while bc only ever accepts "0.4211". The
# comparison then fails silently and the daily budget gate stops firing at all.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${IDEAS_REPO_PATH:?set this to the local clone of your ideas repo}"
: "${ORCHESTRATOR_HEARTBEAT_SELF_URL:?e.g. http://127.0.0.1:8787}"

source "${SCRIPT_DIR}/lib/lock.sh"

CONFIG="${IDEAS_REPO_PATH}/.agent-config.yml"
AGENTS_MD="${IDEAS_REPO_PATH}/AGENTS.md"
STATE_DIR="${IDEAS_REPO_PATH}/.orchestrator"
USAGE_LOG="${STATE_DIR}/usage.log"

# Everything under .orchestrator/ must exist before the lock (which lives there) can be
# taken — on a fresh clone it doesn't, and a non-recursive mkdir would fail every cycle.
mkdir -p "${STATE_DIR}/logs" "${STATE_DIR}/sessions"

cfg() { grep "^$1:" "${CONFIG}" | sed "s/^$1:[[:space:]]*//" | tr -d '"'; }

MAX_DAILY_USD=$(cfg max_daily_cost_usd)
MAX_CYCLE_USD=$(cfg max_cycle_cost_usd)
MAX_PLAN_USD=$(cfg max_plan_cost_usd)
ALLOWED_HOURS=$(cfg allowed_hours)
TZ_NAME=$(cfg timezone)
STALE_MIN=$(cfg heartbeat_staleness_minutes)
LOCK_TTL=$(cfg lock_ttl_minutes)
STALE_IDEA_HOURS=$(cfg stale_idea_after_hours)
PARALLEL_AGENTS=$(cfg parallel_agents)
PARALLEL_AGENTS="${PARALLEL_AGENTS:-2}"
[[ "${PARALLEL_AGENTS}" =~ ^[1-9][0-9]*$ ]] || PARALLEL_AGENTS=2
MAX_CYCLE_MINUTES=$(cfg max_cycle_minutes)
MAX_CYCLE_MINUTES="${MAX_CYCLE_MINUTES:-45}"
AGENT_GRACE_SECONDS=$(cfg agent_grace_seconds)
AGENT_GRACE_SECONDS="${AGENT_GRACE_SECONDS:-90}"

STOP_FILE="${STATE_DIR}/stop"
AGENT_PID_DIR="${STATE_DIR}/agents"
mkdir -p "${AGENT_PID_DIR}"

log() { echo "[$(date -Iseconds)] $*"; }

# --- Graceful stop ------------------------------------------------------------------
# Two ways to ask this cycle to wind down: a SIGTERM (which is what systemd sends when
# TimeoutStartSec expires or you `systemctl stop`), or the stop file. Neither aborts
# anything mid-flight — they set a flag that the agent wait loop notices, so the cycle
# still commits, merges and pushes whatever the agents had produced by then.
GRACEFUL_STOP=""
on_stop_signal() { GRACEFUL_STOP="${GRACEFUL_STOP:-signal}"; }
trap on_stop_signal TERM INT

stop_requested() {
  [[ -n "${GRACEFUL_STOP}" ]] && return 0
  if [[ -f "${STOP_FILE}" ]]; then
    GRACEFUL_STOP="stop file"
    return 0
  fi
  return 1
}

if [[ -f "${STOP_FILE}" ]]; then
  log "Paused: ${STOP_FILE} exists. Remove it to resume."
  exit 0
fi

# A limit set to "unlimited" (or none/off) is not enforced at all: the schedule and
# budget gates are skipped and no --max-budget-usd is passed to Claude. Nothing then
# bounds a cycle's spend except the work running out, so treat this as a deliberate
# "let it rip" switch rather than a default.
is_unlimited() {
  local v="${1:-}"
  [[ "${v,,}" == "unlimited" || "${v,,}" == "none" || "${v,,}" == "off" ]]
}

# Float comparison via bc, with a caller-chosen answer for unparseable input. Both gates
# below fail closed — meaning "stop" — but "stop" is `true` for the budget check and
# `false` for the heartbeat check, so each passes the default that backs off.
fcmp() {
  local lhs="$1" op="$2" rhs="$3" on_error="$4" result
  result=$(echo "${lhs:-x} ${op} ${rhs:-x}" | bc -l 2>/dev/null) || result=""
  [[ -z "${result}" ]] && return "${on_error}"
  [[ "${result}" == "1" ]]
}

# Reads a field from the JSON `claude -p --output-format json` wrote, with a default.
json_field() { python3 -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get(sys.argv[2], sys.argv[3]))
except Exception:
    print(sys.argv[3])
" "$1" "$2" "$3" 2>/dev/null || echo "$3"; }

# Claude Code names each session's transcript <session-id>.jsonl, under a directory whose
# name is the working directory with every non-alphanumeric character replaced by "-".
# That's the only place a session id survives when an agent is stopped instead of allowed
# to finish, because the result JSON is written on clean exit only. Without this recovery,
# a graceful stop would silently start a brand-new conversation on the next cycle and
# throw away everything the agent had worked out.
recover_session_id() {
  local agent_cwd="$1" dir newest
  dir="${HOME}/.claude/projects/$(printf '%s' "${agent_cwd}" | sed 's/[^a-zA-Z0-9]/-/g')"
  [[ -d "${dir}" ]] || return 0
  newest=$(ls -t "${dir}"/*.jsonl 2>/dev/null | head -1)
  [[ -n "${newest}" ]] && basename "${newest}" .jsonl
}

# An idea is blocked iff its Open Questions section still holds an unticked checkbox.
# The template documents "- [ ]" as the one blocking form, so match only that — also
# matching any line ending in "?" made ordinary prose look like an open question.
has_unanswered_questions() {
  local plan="$1"
  [[ -f "${plan}" ]] || return 1
  awk '/^## Open Questions/{f=1; next} /^## /{f=0} f' "${plan}" \
    | grep -qE '^[[:space:]]*-[[:space:]]*\[[[:space:]]\]'
}

# --- 1. Schedule / budget gate -------------------------------------------------
if is_unlimited "${ALLOWED_HOURS}"; then
  log "allowed_hours is ${ALLOWED_HOURS}; running at any hour."
else
now_local=$(TZ="${TZ_NAME}" date +%H:%M)
# (Overnight-range-aware comparison; swap in your own if allowed_hours can't wrap midnight.)
in_window=$(python3 - "$now_local" "$ALLOWED_HOURS" <<'PY'
import sys
now, rng = sys.argv[1], sys.argv[2]
start, end = rng.split("-")
def m(t):
    h, mnt = map(int, t.split(":")); return h * 60 + mnt
n, s, e = m(now), m(start), m(end)
print("yes" if (s <= e and s <= n < e) or (s > e and (n >= s or n < e)) else "no")
PY
)
if [[ "${in_window}" != "yes" ]]; then
  log "Outside allowed_hours (${ALLOWED_HOURS} ${TZ_NAME}); exiting."
  exit 0
fi
fi

today=$(date +%F)
# usage.log is CSV: date,cost_usd,slug,phase,turns
used_usd=$(awk -F, -v d="$today" '$1==d {sum+=$2} END {printf "%.4f", sum+0}' "${USAGE_LOG}" 2>/dev/null || echo 0)
if is_unlimited "${MAX_DAILY_USD}"; then
  log "Today's spend so far: \$${used_usd}; daily budget is ${MAX_DAILY_USD}."
# An unreadable total counts as over budget: never treat a broken ledger as free money.
elif fcmp "${used_usd}" ">=" "${MAX_DAILY_USD}" 0; then
  log "Daily budget spent (\$${used_usd} >= \$${MAX_DAILY_USD}); exiting."
  exit 0
else
  log "Today's spend so far: \$${used_usd} of \$${MAX_DAILY_USD}."
fi

# Per-run caps, omitted entirely when unlimited so Claude runs to completion.
plan_budget_args=()
is_unlimited "${MAX_PLAN_USD}" || plan_budget_args=(--max-budget-usd "${MAX_PLAN_USD}")
cycle_budget_args=()
is_unlimited "${MAX_CYCLE_USD}" || cycle_budget_args=(--max-budget-usd "${MAX_CYCLE_USD}")

# --- 2. Heartbeat gate ----------------------------------------------------------
# A dead heartbeat server is not evidence that the laptop is idle — it's the absence of
# evidence either way. Backing off is the safe reading: building while the user is working
# spends the very allowance this gate exists to protect. The service has Restart=always
# and the timer retries in 5 minutes, so a blip costs one skipped cycle, nothing more.
if ! status_json=$(curl --silent --fail --max-time 3 "${ORCHESTRATOR_HEARTBEAT_SELF_URL}/status"); then
  log "Heartbeat server unreachable at ${ORCHESTRATOR_HEARTBEAT_SELF_URL}; can't tell whether the laptop is busy; exiting."
  exit 0
fi
stale_seconds=$(echo "${status_json}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('stale_seconds', 0))" 2>/dev/null || echo "")
stale_threshold=$(( STALE_MIN * 60 ))
# An unreadable heartbeat counts as "session active": back off rather than risk running
# on top of the user's own Claude Code session.
if fcmp "${stale_seconds}" "<" "${stale_threshold}" 0; then
  log "Laptop Claude Code session active (heartbeat ${stale_seconds}s old); exiting."
  exit 0
fi

# --- 3. Lock ---------------------------------------------------------------------
if ! acquire_lock "${LOCK_TTL}"; then
  log "Lock held by another run; exiting."
  exit 0
fi
trap release_lock EXIT

cd "${IDEAS_REPO_PATH}"
git pull --quiet --ff-only || log "pull failed — continuing with the local tree"

# Records a phase's real cost so the daily gate above has something true to read.
record_usage() {
  local out_file="$1" slug="$2" phase="$3"
  local cost turns denials
  # Cost and turns live only in the result JSON, which a stopped agent never writes. Say
  # so rather than logging a confident "$0" — otherwise a wound-down cycle looks free and
  # the daily ledger quietly under-counts everything it spent.
  if [[ ! -s "${out_file}" ]]; then
    echo "${today},0,${slug},${phase}-stopped,0" >> "${USAGE_LOG}"
    log "WARNING: ${phase}/${slug} produced no result JSON (agent stopped); its real cost is unknown and is recorded as \$0."
    return 0
  fi
  cost=$(json_field "${out_file}" total_cost_usd 0)
  turns=$(json_field "${out_file}" num_turns 0)
  denials=$(python3 -c "
import json, sys
try:
    print(len(json.load(open(sys.argv[1])).get('permission_denials') or []))
except Exception:
    print(0)
" "${out_file}" 2>/dev/null || echo 0)
  echo "${today},${cost},${slug},${phase},${turns}" >> "${USAGE_LOG}"
  log "${phase}/${slug}: \$${cost}, ${turns} turns, ${denials} permission denials."
  # Denials mean Claude tried a tool --allowed-tools didn't cover: it silently did less
  # work than it wanted to, which otherwise looks identical to a quiet, uneventful cycle.
  if (( denials > 0 )); then
    log "WARNING: ${denials} tool call(s) denied — widen --allowed-tools if this repeats."
  fi
}

# --- 5. Planning pass -------------------------------------------------------------
mapfile -t idea_slugs < <(grep -oP '(?<=ideas/)[a-z0-9-]+(?=/)' README.md | uniq)
if (( ${#idea_slugs[@]} == 0 )); then
  log "No ideas found in README.md (expected links of the form ideas/<slug>/); exiting."
  exit 0
fi

for slug in "${idea_slugs[@]}"; do
  mkdir -p "ideas/${slug}"
  [[ -f "ideas/${slug}/STATUS.md" ]] || cp ideas/_template/STATUS.md "ideas/${slug}/STATUS.md"

  # Scaffold CI for every idea in the README, not only ones this pass drafts a plan for.
  # A hand-seeded PLAN.md (which SETUP.md invites) skips the drafting below, and gating
  # the workflow on that branch left such ideas permanently without CI.
  # GitHub only discovers workflows under the repo-root .github/workflows/, so each idea's
  # path-filtered CI lives there as ci-<slug>.yml rather than inside the idea folder.
  ci_path=".github/workflows/ci-${slug}.yml"
  if [[ ! -f "${ci_path}" ]]; then
    mkdir -p .github/workflows
    awk 'past {print} /^# --- template header ends ---$/ {past=1}' ideas/_template/ci.yml \
      | sed "s/<idea-slug>/${slug}/g" > "${ci_path}"
    git add "${ci_path}"
    git commit -m "Add CI workflow for ${slug}" --quiet || true
  fi

  plan_path="ideas/${slug}/PLAN.md"
  [[ -f "${plan_path}" ]] && continue

  log "Drafting plan for ${slug}"
  idea_desc=$(awk -v s="ideas/${slug}/" 'index($0, s){f=1} f{print} f && /^[[:space:]]*$/{exit}' README.md)
  out_file="${STATE_DIR}/logs/plan-${slug}-$(date +%s).json"
  claude -p "Draft ideas/${slug}/PLAN.md for this idea:

${idea_desc}

Include: a '## Features' section listing main features, and if anything is
genuinely ambiguous, a '## Open Questions' section where every question is its own
'- [ ] question text' line. Also add a one-line difficulty estimate
(easy/medium/hard) with a short reason. Do not start implementing yet." \
    --allowed-tools "Read,Write" \
    --permission-mode acceptEdits \
    ${plan_budget_args[@]+"${plan_budget_args[@]}"} \
    --output-format json > "${out_file}" || true

  record_usage "${out_file}" "${slug}" plan
  git add "ideas/${slug}" "${ci_path}"
  git commit -m "Draft plan for ${slug}" --quiet || true
done

# --- 6. Pick ideas to build ---------------------------------------------------------
# Returns up to $1 slugs, highest README priority first.
pick_ideas() {
  local want="$1"
  local slug plan status started age_h
  local -a fresh=() stalled=()
  for slug in "${idea_slugs[@]}"; do
    plan="ideas/${slug}/PLAN.md"
    status="ideas/${slug}/STATUS.md"
    [[ -f "${plan}" ]] || continue
    has_unanswered_questions "${plan}" && continue
    if [[ -f "${status}" ]]; then
      grep -qi "^status: blocked" "${status}" && continue
      if grep -qi "^status: in_progress" "${status}"; then
        started=$(sed -n 's/^started_at:[[:space:]]*//p' "${status}" | head -1)
        if [[ -n "${started}" ]]; then
          age_h=$(( ( $(date +%s) - $(date -d "${started}" +%s 2>/dev/null || date +%s) ) / 3600 ))
          if (( age_h > STALE_IDEA_HOURS )); then
            # Grinding on too long — deprioritise, don't disqualify.
            stalled+=("${slug}")
            continue
          fi
        fi
      fi
    fi
    fresh+=("${slug}")
  done
  # Fresh ideas fill the slots first; stalled ones only take what's left over. That keeps
  # a long-running idea deprioritised without ever abandoning it — if everything is
  # stalled, the stalled list is all there is and work continues rather than halting.
  (( ${#fresh[@]} + ${#stalled[@]} == 0 )) && return 0
  printf '%s\n' ${fresh[@]+"${fresh[@]}"} ${stalled[@]+"${stalled[@]}"} | head -n "${want}"
}

mapfile -t build_slugs < <(pick_ideas "${PARALLEL_AGENTS}")
if (( ${#build_slugs[@]} == 0 )); then
  log "No idea is currently buildable (all blocked or planned only); exiting."
  exit 0
fi
log "Building ${#build_slugs[@]} of ${PARALLEL_AGENTS} slot(s) in parallel: ${build_slugs[*]}"

# Any scaffolding the pass above created must be committed before worktrees branch off
# HEAD, or the agents start from a tree missing their own STATUS.md and the merge below
# trips over uncommitted local changes.
git add -A
git commit -m "Scaffold idea files" --quiet || true

# --- 7/8. Run the agents, each in its own worktree, in parallel ----------------------
# Parallel agents cannot share one working tree. AGENTS.md tells each agent to commit as
# it goes, and concurrent commits in a shared tree race on .git/index — one agent would
# stage and commit the other's half-finished files. A linked worktree per agent gives
# each its own index, HEAD and branch, so the commits are independent; the branches are
# merged back below. Worktrees live under .orchestrator/, which is gitignored.
WORKTREE_ROOT="${STATE_DIR}/worktrees"
mkdir -p "${WORKTREE_ROOT}"
git worktree prune

run_agent() {
  local slug="$1" wt="$2" out_file="$3"
  # CLAUDE.md is regenerated every cycle, never hand-edited, so edits to AGENTS.md and
  # newly answered questions in PLAN.md propagate on the very next cycle.
  {
    cat "${AGENTS_MD}"
    echo
    cat "${wt}/ideas/${slug}/PLAN.md"
    echo
    echo "## Current status"
    tail -n 20 "${wt}/ideas/${slug}/STATUS.md" 2>/dev/null || true
  } > "${wt}/ideas/${slug}/CLAUDE.md"

  local session_file="${STATE_DIR}/sessions/${slug}.id"
  local -a resume_args=()
  [[ -f "${session_file}" ]] && resume_args=(--resume "$(cat "${session_file}")")

  (
    cd "${wt}/ideas/${slug}" || exit 0
    claude -p "Continue implementing this idea per CLAUDE.md." \
      --allowed-tools "Bash,Read,Edit,Write,Glob,Grep" \
      --permission-mode acceptEdits \
      ${cycle_budget_args[@]+"${cycle_budget_args[@]}"} \
      --output-format json \
      ${resume_args[@]+"${resume_args[@]}"} > "${out_file}" &
    # Recorded so a wind-down can signal Claude itself rather than this wrapper subshell,
    # which would leave the real agent orphaned and still spending.
    echo $! > "${AGENT_PID_DIR}/${slug}.pid"
    wait $!
  ) || true
  rm -f "${AGENT_PID_DIR}/${slug}.pid"
}

declare -A WT_OF=() OUT_OF=() SUB_PID_OF=()
declare -a AGENT_PIDS=()
now_stamp=$(date +%s)
cycle_started=${now_stamp}
for slug in "${build_slugs[@]}"; do
  wt="${WORKTREE_ROOT}/${slug}"
  # A worktree left behind by a killed cycle would block `worktree add`; clear it first.
  git worktree remove --force "${wt}" 2>/dev/null || true
  git branch -D "agent/${slug}" 2>/dev/null || true
  git worktree add --quiet -b "agent/${slug}" "${wt}" HEAD
  WT_OF["${slug}"]="${wt}"
  OUT_OF["${slug}"]="${STATE_DIR}/logs/${slug}-${now_stamp}.json"
  rm -f "${AGENT_PID_DIR}/${slug}.pid"
  run_agent "${slug}" "${wt}" "${OUT_OF[${slug}]}" &
  SUB_PID_OF["${slug}"]=$!
  AGENT_PIDS+=("$!")
done

agents_running() {
  local pid
  for pid in ${AGENT_PIDS[@]+"${AGENT_PIDS[@]}"}; do
    kill -0 "${pid}" 2>/dev/null && return 0
  done
  return 1
}

# Ask every agent to stop, then give it AGENT_GRACE_SECONDS to exit before forcing it.
# Claude Code handles SIGTERM by shutting the session down, and the session transcript is
# already on disk, so the work in the worktree and the resumable session both survive.
wind_down() {
  local reason="$1" slug pf cpid waited=0
  log "Winding down agents gracefully: ${reason}."
  for slug in "${build_slugs[@]}"; do
    pf="${AGENT_PID_DIR}/${slug}.pid"
    cpid=""
    [[ -f "${pf}" ]] && cpid=$(cat "${pf}" 2>/dev/null)
    if [[ -n "${cpid}" ]] && kill -0 "${cpid}" 2>/dev/null; then
      log "  SIGTERM -> ${slug} agent (pid ${cpid})"
      kill -TERM "${cpid}" 2>/dev/null || true
    elif kill -0 "${SUB_PID_OF[${slug}]}" 2>/dev/null; then
      # No pid file yet: the agent is still starting up, so signal its wrapper instead.
      log "  SIGTERM -> ${slug} wrapper (pid ${SUB_PID_OF[${slug}]}); agent had not started"
      kill -TERM "${SUB_PID_OF[${slug}]}" 2>/dev/null || true
    fi
  done
  while agents_running && (( waited < AGENT_GRACE_SECONDS )); do
    sleep 2
    waited=$(( waited + 2 ))
  done
  if agents_running; then
    log "  agents still alive after ${AGENT_GRACE_SECONDS}s; escalating to SIGKILL"
    for slug in "${build_slugs[@]}"; do
      pf="${AGENT_PID_DIR}/${slug}.pid"
      [[ -f "${pf}" ]] && kill -KILL "$(cat "${pf}" 2>/dev/null)" 2>/dev/null || true
      kill -KILL "${SUB_PID_OF[${slug}]}" 2>/dev/null || true
    done
  fi
}

# Poll rather than plain `wait`: a bare wait blocks until the agents finish, which with no
# budget cap may be never, and it would leave no room to react to a stop request or to
# finish before systemd's TimeoutStartSec kills us mid-merge.
cycle_deadline=""
if ! is_unlimited "${MAX_CYCLE_MINUTES}"; then
  cycle_deadline=$(( cycle_started + MAX_CYCLE_MINUTES * 60 ))
  log "Agents must finish by $(date -d "@${cycle_deadline}" +%H:%M:%S) (max_cycle_minutes=${MAX_CYCLE_MINUTES})."
fi
while agents_running; do
  if stop_requested; then
    wind_down "${GRACEFUL_STOP}"
    break
  fi
  if [[ -n "${cycle_deadline}" ]] && (( $(date +%s) >= cycle_deadline )); then
    wind_down "max_cycle_minutes=${MAX_CYCLE_MINUTES} reached"
    break
  fi
  sleep 5
done
wait || true

# --- 9. Merge each agent's branch back, update status, commit ------------------------
for slug in "${build_slugs[@]}"; do
  wt="${WT_OF[${slug}]}"
  out_file="${OUT_OF[${slug}]}"

  new_session_id=$(json_field "${out_file}" session_id "")
  if [[ -z "${new_session_id}" ]]; then
    # No result JSON: the agent was stopped rather than finishing. Fall back to the
    # transcript on disk so the next cycle can still --resume this conversation.
    new_session_id=$(recover_session_id "${wt}/ideas/${slug}")
    [[ -n "${new_session_id}" ]] && log "${slug}: recovered session ${new_session_id} from its transcript."
  fi
  [[ -n "${new_session_id}" ]] && echo "${new_session_id}" > "${STATE_DIR}/sessions/${slug}.id"

  # Sweep up whatever the agent left uncommitted in its own worktree. A well-behaved
  # agent self-commits, so "nothing to commit" is the normal case and is not worth
  # printing — git says that on stdout, where it reads like a failure.
  git -C "${wt}" add -A
  git -C "${wt}" commit -m "${slug}: uncommitted work from automated build cycle" \
    --quiet >/dev/null 2>&1 || true

  # Each agent touches only its own ideas/<slug>/ and ci-<slug>.yml, so these branches are
  # disjoint and the merge should never conflict. If one does, something crossed lanes:
  # keep the branch and its worktree for inspection rather than silently discarding work.
  if ! git merge --no-ff --no-edit --quiet "agent/${slug}"; then
    git merge --abort 2>/dev/null || true
    log "WARNING: merging agent/${slug} conflicted — work kept on that branch in ${wt}; skipping."
    record_usage "${out_file}" "${slug}" build
    continue
  fi
  git worktree remove --force "${wt}" 2>/dev/null || true
  git branch -d "agent/${slug}" --quiet 2>/dev/null || true

  # pick_ideas only selects ideas with zero unanswered questions, so any unticked checkbox
  # now can only have been appended by the run that just finished. Checking the file beats
  # diffing the tree, which is usually already clean because the agent self-commits.
  blocked="no"
  has_unanswered_questions "ideas/${slug}/PLAN.md" && blocked="yes"
  new_status=$( [[ ${blocked} == yes ]] && echo blocked || echo in_progress )

  status_file="ideas/${slug}/STATUS.md"
  prev_started=$(sed -n 's/^started_at:[[:space:]]*//p' "${status_file}" 2>/dev/null | head -1)
  [[ -n "${prev_started}" ]] || prev_started=$(date -Iseconds)
  cycle_cost=$(json_field "${out_file}" total_cost_usd 0)

  # Rebuild the header rather than prepending to it, otherwise every cycle buries the
  # previous cycle's "key: value" lines inside the log body.
  {
    echo "status: ${new_status}"
    echo "started_at: ${prev_started}"
    echo "last_session_id: ${new_session_id}"
    echo "last_run: $(date -Iseconds)"
    echo "last_cycle_cost_usd: ${cycle_cost}"
    echo
    echo "## Log"
    echo "- $(date -Iseconds) — ${new_status} (\$${cycle_cost})"
    # Carry the existing log over, dropping the old header block, its "## Log" heading, and
    # the template's instructional comment — which would otherwise sink below the newest
    # entry and stay there for the life of the idea.
    awk 'BEGIN{hdr=1}
         hdr && /^[a-z_]+:/ {next}
         hdr && /^[[:space:]]*$/ {next}
         {hdr=0}
         /^## Log$/ {next}
         /^[[:space:]]*<!--/ {next}
         {print}' "${status_file}" 2>/dev/null || true
  } > "${status_file}.new"
  mv "${status_file}.new" "${status_file}"

  git add -A
  git commit -m "${slug}: automated build cycle ($( [[ ${blocked} == yes ]] && echo 'blocked on new question' || echo 'progress' ))" --quiet || true

  # --- 10. Record usage --------------------------------------------------------------
  record_usage "${out_file}" "${slug}" build
  log "Cycle complete for ${slug} (${new_status})."
done

git push --quiet || log "push failed — will retry next cycle"
