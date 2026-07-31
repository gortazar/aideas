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

log() { echo "[$(date -Iseconds)] $*"; }

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

today=$(date +%F)
# usage.log is CSV: date,cost_usd,slug,phase,turns
used_usd=$(awk -F, -v d="$today" '$1==d {sum+=$2} END {printf "%.4f", sum+0}' "${USAGE_LOG}" 2>/dev/null || echo 0)
# An unreadable total counts as over budget: never treat a broken ledger as free money.
if fcmp "${used_usd}" ">=" "${MAX_DAILY_USD}" 0; then
  log "Daily budget spent (\$${used_usd} >= \$${MAX_DAILY_USD}); exiting."
  exit 0
fi
log "Today's spend so far: \$${used_usd} of \$${MAX_DAILY_USD}."

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
  plan_path="ideas/${slug}/PLAN.md"
  [[ -f "${plan_path}" ]] && continue

  log "Drafting plan for ${slug}"
  mkdir -p "ideas/${slug}"
  [[ -f "ideas/${slug}/STATUS.md" ]] || cp ideas/_template/STATUS.md "ideas/${slug}/STATUS.md"

  # GitHub only discovers workflows under the repo-root .github/workflows/, so each idea's
  # path-filtered CI lives there as ci-<slug>.yml rather than inside the idea folder.
  ci_path=".github/workflows/ci-${slug}.yml"
  if [[ ! -f "${ci_path}" ]]; then
    mkdir -p .github/workflows
    awk 'past {print} /^# --- template header ends ---$/ {past=1}' ideas/_template/ci.yml \
      | sed "s/<idea-slug>/${slug}/g" > "${ci_path}"
  fi

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
    --max-budget-usd "${MAX_PLAN_USD}" \
    --output-format json > "${out_file}" || true

  record_usage "${out_file}" "${slug}" plan
  git add "ideas/${slug}" "${ci_path}"
  git commit -m "Draft plan for ${slug}" --quiet || true
done

# --- 6. Pick an idea to build ------------------------------------------------------
pick_idea() {
  local slug plan status started age_h
  local -a stalled=()
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
            # Grinding on too long — deprioritise, don't disqualify. Remember it and
            # keep looking for something fresher first.
            stalled+=("${slug}")
            continue
          fi
        fi
      fi
    fi
    echo "${slug}"
    return 0
  done
  # Nothing fresh is eligible. Rather than stall forever — which is what happens if a
  # long-running idea is merely skipped and every idea eventually crosses the threshold —
  # go back to the highest-priority stalled one and keep chipping away at it.
  if (( ${#stalled[@]} > 0 )); then
    # stdout is this function's return channel, so the log line must go to stderr.
    log "All eligible ideas are past stale_idea_after_hours; resuming ${stalled[0]}." >&2
    echo "${stalled[0]}"
    return 0
  fi
  return 1
}

if ! slug=$(pick_idea); then
  log "No idea is currently buildable (all blocked or planned only); exiting."
  exit 0
fi
log "Building: ${slug}"

# --- 7. Regenerate CLAUDE.md -------------------------------------------------------
# Always regenerated, never hand-edited, so edits to AGENTS.md and newly answered
# questions in PLAN.md propagate on the very next cycle.
{
  cat "${AGENTS_MD}"
  echo
  cat "ideas/${slug}/PLAN.md"
  echo
  echo "## Current status"
  tail -n 20 "ideas/${slug}/STATUS.md" 2>/dev/null || true
} > "ideas/${slug}/CLAUDE.md"

# --- 8. Invoke Claude Code headlessly ----------------------------------------------
session_file="${STATE_DIR}/sessions/${slug}.id"
resume_args=()
[[ -f "${session_file}" ]] && resume_args=(--resume "$(cat "${session_file}")")

out_file="${STATE_DIR}/logs/${slug}-$(date +%s).json"
pushd "ideas/${slug}" >/dev/null
claude -p "Continue implementing this idea per CLAUDE.md." \
  --allowed-tools "Bash,Read,Edit,Write,Glob,Grep" \
  --permission-mode acceptEdits \
  --max-budget-usd "${MAX_CYCLE_USD}" \
  --output-format json \
  "${resume_args[@]}" > "${out_file}" || true
popd >/dev/null

new_session_id=$(json_field "${out_file}" session_id "")
[[ -n "${new_session_id}" ]] && echo "${new_session_id}" > "${session_file}"

# --- 9. Update status, commit ------------------------------------------------------
# pick_idea only selects ideas with zero unanswered questions, so any unticked checkbox
# now can only have been appended by the run that just finished. Checking the file beats
# diffing the worktree, which is usually already clean because AGENTS.md tells Claude to
# commit its own work as it goes.
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
git push --quiet || log "push failed — will retry next cycle"

# --- 10. Record usage --------------------------------------------------------------
record_usage "${out_file}" "${slug}" build

log "Cycle complete for ${slug} (${new_status})."
