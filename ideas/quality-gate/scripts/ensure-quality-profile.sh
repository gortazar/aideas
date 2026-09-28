#!/usr/bin/env bash
# Deactivate a rule that is wrong about a whole technology, by copying a built-in quality
# profile and assigning the copy to the projects it affects.
#
#   scripts/ensure-quality-profile.sh <repo-name> [<repo-name> ...]
#   scripts/ensure-quality-profile.sh --status [<repo-name> ...]
#
# with the defaults below naming the case this was written for: `css:S4654` ("CSS properties
# should be valid") on GNOME Shell stylesheets, which are St's own dialect and not CSS.
# Other rule/language pairs go through --profile/--language/--rule rather than a second copy
# of this script.
#
# **This script never changes an issue's status.** SonarQube Cloud will happily accept a
# `falsepositive` or `wontfix` transition on the very issues this makes go away, and that
# would be the dishonest remedy: invisible in git, repeated for every new occurrence, and
# impossible to review in a diff. `api/issues/do_transition` and `api/issues/bulk_change`
# are not called here and must not be added. What this does instead is a decision recorded
# in `exclusions.md` and re-runnable by anyone.
#
# It is idempotent. A profile that already exists is reused, a rule already inactive is left
# alone, a project already assigned is reported and skipped.
#
# Like scripts/ensure-sonar-project.sh, it takes the *capability* of the token without its
# *value*: read from the machine-local agent env file straight into a curl --config on
# stdin, never into argv (where `ps` would show it), never into a file, a log or output.
set -euo pipefail

ENV_FILE="${IDEA_AGENT_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/idea-agent/env}"
ORGANIZATION="${SONAR_ORGANIZATION:-gortazar}"
HOST="https://sonarcloud.io"

# The defaults: the GNOME Shell stylesheet case. `spacing`, `natural-width` and the rest of
# St's box-layout properties are real, and no Sonar analyser knows the dialect, so the rule
# misfires on every GJS project with a stylesheet, forever.
PROFILE_NAME="${SONAR_PROFILE_NAME:-GNOME Shell (St) stylesheets}"
LANGUAGE="${SONAR_PROFILE_LANGUAGE:-css}"
RULES=()

die() { printf 'ensure-quality-profile: %s\n' "$*" >&2; exit 1; }

status_only=no
repos=()
while [ "$#" -gt 0 ]; do
    case "$1" in
        --status) status_only=yes ;;
        --profile) PROFILE_NAME="${2:?--profile needs a name}"; shift ;;
        --language) LANGUAGE="${2:?--language needs a language key}"; shift ;;
        --rule) RULES+=("${2:?--rule needs a rule key}"); shift ;;
        -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) die "unknown option: $1" ;;
        *) repos+=("$1") ;;
    esac
    shift
done
[ "${#RULES[@]}" -gt 0 ] || RULES=("css:S4654")
if [ "${#repos[@]}" -eq 0 ] && [ "$status_only" = no ]; then
    die "usage: ensure-quality-profile.sh [--status] [--profile NAME] [--language LANG] [--rule KEY] <repo> [...]"
fi

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE — ask the user to add SONAR_TOKEN to it"
command -v jq >/dev/null || die "jq is not on PATH (run inside nix develop)"

token="$(sed -n 's/^SONAR_TOKEN=//p' "$ENV_FILE" | head -1)"
[ -n "$token" ] || die "SONAR_TOKEN is not set in $ENV_FILE.
This script cannot create a credential, only use one. Ask the user to add it."

# All API traffic goes through here so the token has exactly one path out of this script.
# --config - keeps the Authorization header off the command line; --fail-with-body makes an
# HTTP error an exit status while still letting the caller see what Sonar said — a silent
# 400 from add_project otherwise looks exactly like success.
sonar_api() {
    local method="$1" path="$2"
    shift 2
    printf 'header = "Authorization: Bearer %s"\n' "$token" |
        curl --silent --show-error --fail-with-body --config - \
            --request "$method" "$HOST/$path" "$@"
}

profiles_json() {
    sonar_api GET "api/qualityprofiles/search?organization=$ORGANIZATION&language=$LANGUAGE"
}

# Both `Sonar way` and `Sonar way essentials` report isBuiltIn — they are read-only, which
# is the whole reason the remedy is a copy rather than an edit. Asserting it here means a
# future rename cannot quietly turn this into "modify whatever profile came back first".
builtin_profile_key() {
    local json="$1"
    printf '%s' "$json" |
        jq -r --arg lang "$LANGUAGE" '
            [.profiles[] | select(.language == $lang and .isBuiltIn == true)]
            | sort_by(.name != "Sonar way")
            | .[0].key // empty'
}

profile_field() {
    printf '%s' "$1" | jq -r --arg name "$2" --arg lang "$LANGUAGE" \
        '.profiles[] | select(.name == $name and .language == $lang) | .'"$3"' // empty'
}

rule_is_active() {
    sonar_api GET "api/rules/search?organization=$ORGANIZATION&qprofile=$1&activation=true&rule_key=$2" |
        jq -e '.total > 0' >/dev/null
}

assigned_projects() {
    sonar_api GET "api/qualityprofiles/projects?key=$1&ps=100" |
        jq -r '.results[]?.key'
}

echo "organization $ORGANIZATION, language $LANGUAGE, profile \"$PROFILE_NAME\""

json="$(profiles_json)"
builtin_key="$(builtin_profile_key "$json")"
[ -n "$builtin_key" ] || die "no built-in $LANGUAGE profile in $ORGANIZATION — nothing to copy from"

profile_key="$(profile_field "$json" "$PROFILE_NAME" key)"

if [ -z "$profile_key" ]; then
    if [ "$status_only" = yes ]; then
        echo "  profile: DOES NOT EXIST (would be copied from $builtin_key)"
        exit 0
    fi
    sonar_api POST "api/qualityprofiles/copy" \
        --data-urlencode "fromKey=$builtin_key" \
        --data-urlencode "toName=$PROFILE_NAME" >/dev/null
    json="$(profiles_json)"
    profile_key="$(profile_field "$json" "$PROFILE_NAME" key)"
    [ -n "$profile_key" ] || die "copied the profile but cannot find it again by name"
    echo "  profile: created as a copy of $builtin_key -> $profile_key"
else
    echo "  profile: exists -> $profile_key"
fi

# The one thing this script must never widen. The organisation default applies to every
# project that has not been given a profile of its own, including ones nobody has written
# yet, so deactivating a rule in it is the blanket exclusion under another name. If the
# profile we are about to edit is the default, something has gone wrong upstream of here.
if [ "$(profile_field "$json" "$PROFILE_NAME" isDefault)" = "true" ]; then
    die "\"$PROFILE_NAME\" is the organisation default for $LANGUAGE.
Refusing to deactivate a rule in it: that would apply to every project, including ones that
do not exist yet. Copy it to a named profile and assign that instead."
fi

for rule in "${RULES[@]}"; do
    if rule_is_active "$profile_key" "$rule"; then
        if [ "$status_only" = yes ]; then
            echo "  rule $rule: ACTIVE (would be deactivated)"
        else
            sonar_api POST "api/qualityprofiles/deactivate_rule" \
                --data-urlencode "key=$profile_key" \
                --data-urlencode "rule=$rule" >/dev/null
            echo "  rule $rule: deactivated"
        fi
    else
        echo "  rule $rule: inactive"
    fi
done

# Read the assignment back rather than trusting the write: add_project identifies the
# profile by name plus language rather than by key, and gets the organisation too, so there
# are three ways to be subtly wrong about which profile was meant.
mapfile -t assigned < <(assigned_projects "$profile_key")
is_assigned() {
    local want="$1" have
    for have in ${assigned[@]+"${assigned[@]}"}; do
        [ "$have" = "$want" ] && return 0
    done
    return 1
}

if [ "${#repos[@]}" -eq 0 ]; then
    echo "  projects: ${assigned[*]:-none}"
    exit 0
fi

for repo in "${repos[@]}"; do
    key="${ORGANIZATION}_${repo}"
    if is_assigned "$key"; then
        echo "  $key: assigned"
        continue
    fi
    if [ "$status_only" = yes ]; then
        echo "  $key: NOT ASSIGNED"
        continue
    fi
    sonar_api POST "api/qualityprofiles/add_project" \
        --data-urlencode "organization=$ORGANIZATION" \
        --data-urlencode "qualityProfile=$PROFILE_NAME" \
        --data-urlencode "language=$LANGUAGE" \
        --data-urlencode "project=$key" >/dev/null
    if assigned_projects "$profile_key" | grep -qx "$key"; then
        echo "  $key: assigned"
    else
        die "add_project returned success but $key is not on \"$PROFILE_NAME\""
    fi
done

printf '  %s/organizations/%s/quality_profiles\n' "$HOST" "$ORGANIZATION"
