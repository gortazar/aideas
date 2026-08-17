#!/usr/bin/env bash
# Install the idea-builder orchestrator on this machine, then the GNOME Shell extension
# that watches it — pointed at the right address, which is the one thing you would
# otherwise have to type twice.
#
#   ./orchestrator/install.sh
#
# Installs *user* systemd units, not system ones. The orchestrator runs as you: it needs
# your ~/.claude token to invoke agents and your SSH key to push. A system unit would have
# to be told which user to become and would still be reaching into your home directory —
# `systemctl --user` is the honest shape for a laptop. orchestrator/systemd/ keeps the
# system units for the always-on box described in SETUP.md.
#
# Options:
#   --repo PATH       the clone to operate on (default: the repo this script lives in)
#   --port N          heartbeat port (default 8787)
#   --bind IP         heartbeat bind address (default 127.0.0.1; use the VPN IP on a box)
#   --enable-timer    also run cycles automatically every 5 minutes (default: off)
#   --no-extension    skip the GNOME Shell extension
#   --uninstall       stop and remove everything this installed
set -euo pipefail

REPO=""
PORT=8787
BIND=127.0.0.1
ENABLE_TIMER=no
WITH_EXTENSION=yes
UNINSTALL=no

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?--repo needs a path}"; shift 2 ;;
    --port) PORT="${2:?--port needs a number}"; shift 2 ;;
    --bind) BIND="${2:?--bind needs an address}"; shift 2 ;;
    --enable-timer) ENABLE_TIMER=yes; shift ;;
    --no-extension) WITH_EXTENSION=no; shift ;;
    --uninstall) UNINSTALL=yes; shift ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf 'orchestrator: %s\n' "$*"; }
die()  { printf 'orchestrator: %s\n' "$*" >&2; exit 1; }

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/idea-agent/env"
UUID="aideas-shell@patxi.gortazar"

# --- uninstall -----------------------------------------------------------------------
if [ "$UNINSTALL" = yes ]; then
  systemctl --user disable --now idea-orchestrator.timer 2>/dev/null || true
  systemctl --user disable --now idea-heartbeat.service  2>/dev/null || true
  rm -f "$UNIT_DIR"/idea-heartbeat.service "$UNIT_DIR"/idea-orchestrator.service \
        "$UNIT_DIR"/idea-orchestrator.timer
  systemctl --user daemon-reload
  say "units removed. $ENV_FILE was left in place (it holds your shared secret)."
  say "the extension, if installed, is removed by: ideas/aideas/install.sh --uninstall"
  exit 0
fi

# --- where is the repo ----------------------------------------------------------------
if [ -z "$REPO" ]; then
  REPO="$(cd "$(dirname "$0")/.." && pwd)"
fi
REPO="$(cd "$REPO" && pwd)"
[ -f "$REPO/orchestrator/orchestrator.py" ] || die "$REPO is not an aideas clone (no orchestrator/orchestrator.py)"
[ -d "$REPO/.git" ] || die "$REPO is not a git clone — the orchestrator commits and pushes every cycle"

# --- preflight -------------------------------------------------------------------------
command -v python3 >/dev/null || die "python3 is required"
command -v systemctl >/dev/null || die "systemd is required"
systemctl --user is-system-running >/dev/null 2>&1 || die "no user systemd session (systemctl --user is unavailable)"
command -v claude >/dev/null || say "WARNING: 'claude' is not on PATH — cycles will start and every agent will fail."

# The units get an explicit PATH: a user unit does not inherit your shell's, and both
# `claude` and `nix` usually live under $HOME rather than in /usr/bin.
UNIT_PATH="$HOME/.local/bin:$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin"

# --- environment file -------------------------------------------------------------------
mkdir -p "$(dirname "$ENV_FILE")"
if [ -f "$ENV_FILE" ] && grep -q '^HEARTBEAT_SHARED_SECRET=' "$ENV_FILE"; then
  SECRET="$(sed -n 's/^HEARTBEAT_SHARED_SECRET=//p' "$ENV_FILE" | head -1)"
  say "keeping the existing shared secret in $ENV_FILE"
else
  SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  say "generated a new shared secret"
fi

cat > "$ENV_FILE" <<EOF
# Written by orchestrator/install.sh. Holds a secret — keep it out of git.
IDEAS_REPO_PATH=$REPO
HEARTBEAT_BIND_IP=$BIND
HEARTBEAT_PORT=$PORT
HEARTBEAT_STATE_PATH=${XDG_STATE_HOME:-$HOME/.local/state}/idea-agent/heartbeat.json
HEARTBEAT_SHARED_SECRET=$SECRET
ORCHESTRATOR_HEARTBEAT_SELF_URL=http://$BIND:$PORT
EOF
chmod 600 "$ENV_FILE"
mkdir -p "$(dirname "${XDG_STATE_HOME:-$HOME/.local/state}/idea-agent/heartbeat.json")"
say "wrote $ENV_FILE"

# --- units ---------------------------------------------------------------------------------
mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/idea-heartbeat.service" <<EOF
[Unit]
Description=Idea-builder heartbeat receiver and /state endpoint
After=network.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
Environment=PATH=$UNIT_PATH
ExecStart=/usr/bin/python3 $REPO/orchestrator/heartbeat_server.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/idea-orchestrator.service" <<EOF
[Unit]
Description=Idea-builder orchestrator — one build cycle
After=idea-heartbeat.service

[Service]
Type=oneshot
EnvironmentFile=$ENV_FILE
Environment=PATH=$UNIT_PATH
ExecStart=/usr/bin/python3 $REPO/orchestrator/orchestrator.py

# The cycle's own max_cycle_minutes should trip first and wind the agents down; this is
# only a backstop. SIGTERM is trapped and treated as "wind down now", and KillMode=mixed
# keeps systemd from signalling the agents directly and racing the script to the exit.
TimeoutStartSec=3600
KillMode=mixed
TimeoutStopSec=300

# No [Install]: the timer starts this, never boot.
EOF

cat > "$UNIT_DIR/idea-orchestrator.timer" <<EOF
[Unit]
Description=Wake the idea-builder orchestrator every 5 minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now idea-heartbeat.service >/dev/null 2>&1
say "installed and started idea-heartbeat.service on $BIND:$PORT"

# --- does it actually answer? ----------------------------------------------------------------
ok=no
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 2 "http://$BIND:$PORT/state" >/dev/null 2>&1; then ok=yes; break; fi
  sleep 1
done
[ "$ok" = yes ] || die "the heartbeat service did not answer on http://$BIND:$PORT/state
Check: systemctl --user status idea-heartbeat.service"
say "/state is answering"

if [ "$ENABLE_TIMER" = yes ]; then
  systemctl --user enable --now idea-orchestrator.timer >/dev/null 2>&1
  say "ENABLED the 5-minute timer — cycles will now run on their own, and spend money."
else
  say "timer installed but NOT enabled; run a cycle by hand with:"
  say "    systemctl --user start idea-orchestrator.service"
  say "  or enable automatic cycles with: systemctl --user enable --now idea-orchestrator.timer"
fi

# --- the extension --------------------------------------------------------------------------
if [ "$WITH_EXTENSION" = yes ]; then
  if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    say "no graphical session — skipping the GNOME Shell extension."
  else
    say "installing the GNOME Shell extension, pointed at $BIND:$PORT"
    # The extension installer reads this to fill in the address, which is the one value
    # that otherwise has to be typed into a preferences dialog by hand.
    export ORCHESTRATOR_HEARTBEAT_URL="http://$BIND:$PORT/heartbeat"
    if [ -x "$REPO/ideas/aideas/install.sh" ]; then
      sh "$REPO/ideas/aideas/install.sh" || say "WARNING: the extension installer failed."
    else
      curl -fsSL "https://raw.githubusercontent.com/gortazar/aideas/main/ideas/aideas/install.sh" \
        | sh || say "WARNING: the extension installer failed."
    fi
    # Point it at this install, authoritatively. The extension's own installer only fills
    # the address in when the host is still empty, so as not to clobber something you set
    # by hand — which means a machine that was once configured for a different port keeps
    # it, and this script's "pointed at $BIND:$PORT" would be a lie. We just wrote the
    # env file, so we know where the heartbeat actually is.
    SCHEMADIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID/schemas"
    if [ -d "$SCHEMADIR" ] && command -v gsettings >/dev/null 2>&1; then
      gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.aideas \
        orchestrator-host "'$BIND'" 2>/dev/null || true
      gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.aideas \
        orchestrator-port "$PORT" 2>/dev/null || true
      got_host=$(gsettings --schemadir "$SCHEMADIR" get org.gnome.shell.extensions.aideas orchestrator-host 2>/dev/null | tr -d "'")
      got_port=$(gsettings --schemadir "$SCHEMADIR" get org.gnome.shell.extensions.aideas orchestrator-port 2>/dev/null)
      if [ "$got_host" = "$BIND" ] && [ "$got_port" = "$PORT" ]; then
        say "extension configured for $BIND:$PORT"
      else
        say "WARNING: extension is set to $got_host:$got_port, not $BIND:$PORT — fix it with"
        say "         gnome-extensions prefs $UUID"
      fi
    fi

    # It cannot always enable itself: run through a pipe it may have no session bus.
    gnome-extensions enable "$UUID" 2>/dev/null \
      && say "extension enabled" \
      || say "could not enable the extension — run: gnome-extensions enable $UUID"
  fi
fi

echo
say "done. Check it with:"
say "    python3 $REPO/orchestrator/orchestrator.py status"
if [ "${XDG_SESSION_TYPE:-}" = wayland ] && [ "$WITH_EXTENSION" = yes ]; then
  say "On Wayland the Shell must be restarted to load new extension code: log out and back in."
fi
say "User services stop when you log out. To keep cycles running while logged out:"
say "    sudo loginctl enable-linger $USER"
