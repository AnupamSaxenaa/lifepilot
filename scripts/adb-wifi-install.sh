#!/usr/bin/env bash
#
# Install (or refresh) the auto-reconnect background agent.
#
#   scripts/adb-wifi-install.sh            # install / update
#   scripts/adb-wifi-install.sh --uninstall
#
# The script is copied to ~/.local/bin because macOS TCC forbids launchd from
# executing files under ~/Desktop and ~/Documents. Re-run this after editing
# scripts/adb-wifi.sh so the installed copy picks up your changes.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.lifepilot.adbwifi"
BIN_DIR="${HOME}/.local/bin"
BIN_PATH="${BIN_DIR}/lifepilot-adb-wifi"
AGENT_DIR="${HOME}/Library/LaunchAgents"
AGENT_PATH="${AGENT_DIR}/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  rm -f "$AGENT_PATH" "$BIN_PATH"
  echo "Removed the auto-reconnect agent and ${BIN_PATH}."
  exit 0
fi

mkdir -p "$BIN_DIR" "$AGENT_DIR"

install -m 0755 "${REPO_DIR}/scripts/adb-wifi.sh" "$BIN_PATH"
echo "Installed ${BIN_PATH}"

# Rewrite the hard-coded home path so this works for any user account.
sed "s|/Users/praveenkumarsaxena/.local/bin|${HOME}/.local/bin|g" \
  "${REPO_DIR}/scripts/${LABEL}.plist" > "$AGENT_PATH"
plutil -lint "$AGENT_PATH" >/dev/null
echo "Installed ${AGENT_PATH}"

launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$AGENT_PATH"
echo "Agent loaded — it will re-check the connection every 120s."
echo "Log: /tmp/lifepilot-adbwifi.log"
