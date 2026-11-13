#!/usr/bin/env bash
#
# adb-wifi.sh — keep a wireless ADB connection alive without re-pairing.
#
# Why this exists:
#   Android 11+ wireless debugging picks a RANDOM adbd port every boot, so the
#   port printed on the "Wireless debugging" screen goes stale constantly. The
#   *pairing* itself is persistent (keys are stored on both ends), so you should
#   never need a new pairing code after the first time.
#
#   This script finds the device again and then pins adbd to a fixed port (5555)
#   via `adb tcpip`, so every later reconnect in the same boot session is instant.
#
# Usage:
#   scripts/adb-wifi.sh              # auto: use cached IP, else sweep the LAN
#   scripts/adb-wifi.sh 192.168.1.5  # target a known IP
#   scripts/adb-wifi.sh --status     # show connection state only
#   scripts/adb-wifi.sh --quiet      # for launchd (log only on change)
#   scripts/adb-wifi.sh --no-deep    # skip the slow port scan (background use)
#
# Exit codes: 0 connected, 1 not connected, 2 needs manual pairing.

set -uo pipefail

FIXED_PORT=5555
CACHE="${HOME}/.lifepilot-adb-wifi"
SCAN_LO=32768
SCAN_HI=61000
PARALLEL=256
NC_TIMEOUT=1
QUIET=0
STATUS_ONLY=0
NO_DEEP=0
TARGET_IP=""

for arg in "$@"; do
  case "$arg" in
    --quiet)   QUIET=1 ;;
    --status)  STATUS_ONLY=1 ;;
    --no-deep) NO_DEEP=1 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) TARGET_IP="$arg" ;;
  esac
done

log()  { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }

# Single-instance guard: a slow scan must not stack up behind a scheduled run.
LOCK="${TMPDIR:-/tmp}/lifepilot-adb-wifi.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  log "Another adb-wifi run is in progress; skipping."
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

# ---------------------------------------------------------------- adb helpers

# First serial in "device" (usable) state.
online_serial() {
  adb devices 2>/dev/null | awk '$2 == "device" { print $1; exit }'
}

# Drop stale/offline transports so adb stops trying to use them.
prune_offline() {
  adb devices 2>/dev/null | awk '$2 == "offline" { print $1 }' | while read -r s; do
    [ -n "$s" ] && adb disconnect "$s" >/dev/null 2>&1
  done
}

# adb connect exits 0 even on failure, so match the output text instead.
try_connect() {
  local ip="$1" port="$2" out
  out="$(adb connect "${ip}:${port}" 2>&1)"
  case "$out" in
    *"connected to"*) return 0 ;;
    *"failed to authenticate"*)
      warn "Device at ${ip}:${port} rejected our key — pairing was lost."
      return 2 ;;
    *) return 1 ;;
  esac
}

# Is a TCP port open? Cheap pre-check so we never hand adb a dead port.
port_open() {
  nc -z -G "$NC_TIMEOUT" -w "$NC_TIMEOUT" "$1" "$2" >/dev/null 2>&1
}

# ------------------------------------------------------------------ discovery

# Local IPv4 /24 prefix, e.g. "192.168.1."
subnet_prefix() {
  local ip
  for dev in $(route -n get default 2>/dev/null | awk '/interface:/{print $2}') en0 en1; do
    ip="$(ipconfig getifaddr "$dev" 2>/dev/null)" || true
    [ -n "${ip:-}" ] && { printf '%s.\n' "${ip%.*}"; return 0; }
  done
  return 1
}

# Warm the ARP cache, then list responsive hosts on the subnet.
live_hosts() {
  local prefix="$1"
  # Broadcast ping populates ARP for most consumer LANs.
  ping -c 2 -t 2 "${prefix}255" >/dev/null 2>&1 || true
  seq 1 254 \
    | xargs -P 64 -I{} sh -c "ping -c 1 -W 300 ${prefix}{} >/dev/null 2>&1 && echo ${prefix}{}" \
    | sort -t. -k4 -n
}

# adb's mDNS service discovery. Works on friendly networks, silent on the rest.
mdns_endpoint() {
  adb mdns services 2>/dev/null \
    | awk '/_adb-tls-connect|_adb._tcp/ { print $3; exit }'
}

# Brute-force the ephemeral range for an adbd listener.
scan_ports() {
  local ip="$1"
  seq "$SCAN_LO" "$SCAN_HI" \
    | xargs -P "$PARALLEL" -I{} sh -c \
        "nc -z -G $NC_TIMEOUT -w $NC_TIMEOUT $ip {} >/dev/null 2>&1 && echo {}" \
    | head -12
}

# ------------------------------------------------------------------ main flow

# Pin adbd to FIXED_PORT so subsequent reconnects skip discovery entirely.
pin_fixed_port() {
  local serial="$1" ip="${1%%:*}"
  [ "${serial##*:}" = "$FIXED_PORT" ] && return 0

  adb -s "$serial" tcpip "$FIXED_PORT" >/dev/null 2>&1 || return 1
  sleep 4
  if try_connect "$ip" "$FIXED_PORT"; then
    adb disconnect "$serial" >/dev/null 2>&1
    log "Pinned adbd to port ${FIXED_PORT} (stable until the phone reboots)."
    return 0
  fi
  warn "Could not pin port ${FIXED_PORT}; staying on ${serial}."
  return 1
}

finish_connected() {
  local serial model
  serial="$(online_serial)"
  model="$(adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
  printf '%s\n' "${serial%%:*}" > "$CACHE"
  log "Connected: ${serial}${model:+  (${model})}"
  exit 0
}

adb start-server >/dev/null 2>&1
prune_offline

if [ -n "$(online_serial)" ]; then
  serial="$(online_serial)"
  [ "$STATUS_ONLY" -eq 1 ] && { log "Connected: ${serial}"; exit 0; }
  pin_fixed_port "$serial"
  finish_connected
fi

if [ "$STATUS_ONLY" -eq 1 ]; then
  log "Not connected."
  exit 1
fi

# Try the pinned port on a list of IPs. Cheap: one TCP probe each.
try_fixed_port() {
  local ip
  for ip in "$@"; do
    [ -z "$ip" ] && continue
    if port_open "$ip" "$FIXED_PORT"; then
      log "Found adbd at ${ip}:${FIXED_PORT}"
      try_connect "$ip" "$FIXED_PORT" && finish_connected
    fi
  done
}

# Brute-force the ephemeral range on a list of IPs. Expensive, so it is capped
# and only reached once per phone reboot.
try_deep_scan() {
  local ip port serial scanned=0
  for ip in "$@"; do
    [ -z "$ip" ] && continue
    [ "$scanned" -ge 6 ] && { warn "Stopping after 6 deep scans."; return 1; }
    scanned=$((scanned + 1))
    log "Scanning ${ip} ports ${SCAN_LO}-${SCAN_HI} (this takes a minute)..."
    while read -r port; do
      [ -z "$port" ] && continue
      log "  trying ${ip}:${port}"
      if try_connect "$ip" "$port"; then
        serial="$(online_serial)"
        [ -n "$serial" ] && { pin_fixed_port "$serial"; finish_connected; }
      fi
    done < <(scan_ports "$ip")
  done
  return 1
}

# Round 1 — known IP (explicit arg, else last successful one) on the pinned port.
known=()
if [ -n "$TARGET_IP" ]; then
  known+=("$TARGET_IP")
elif [ -f "$CACHE" ]; then
  known+=("$(cat "$CACHE")")
fi
[ ${#known[@]} -gt 0 ] && try_fixed_port "${known[@]}"

# Round 2 — mDNS, when the network permits it.
endpoint="$(mdns_endpoint)"
if [ -n "$endpoint" ]; then
  log "mDNS discovered ${endpoint}"
  try_connect "${endpoint%%:*}" "${endpoint##*:}" && finish_connected
fi

# Round 3 — sweep the subnet for the pinned port. Catches a changed DHCP lease.
prefix="$(subnet_prefix)" || { warn "No IPv4 address; are you on Wi-Fi?"; exit 1; }
log "Sweeping ${prefix}0/24 for the phone..."
hosts=()
while read -r host; do
  [ -n "$host" ] && hosts+=("$host")
done < <(live_hosts "$prefix")
[ ${#hosts[@]} -gt 0 ] && try_fixed_port "${hosts[@]}"

# Round 4 — deep port scan. Known IPs first, then anything else that responded.
# Skipped under --no-deep so scheduled runs stay cheap when the phone is away.
if [ "$NO_DEEP" -eq 1 ]; then
  log "Phone not found on port ${FIXED_PORT}; skipping deep scan (--no-deep)."
  exit 1
fi

ordered=("${known[@]:-}")
for host in "${hosts[@]:-}"; do
  case " ${ordered[*]} " in *" $host "*) ;; *) ordered+=("$host") ;; esac
done
[ ${#ordered[@]} -gt 0 ] && try_deep_scan "${ordered[@]}"

warn ""
warn "Could not reach the phone. Checklist:"
warn "  1. Phone and Mac on the same Wi-Fi (no guest/AP-isolation network)."
warn "  2. Settings > Developer options > Wireless debugging is ON."
warn "     Android turns this OFF again after some reboots."
warn "  3. Still stuck? Re-pair once:"
warn "       adb pair <ip>:<pairing-port> <code>"
warn "     using the port from the 'Pair device with pairing code' popup,"
warn "     which is NOT the port shown on the main screen."
exit 2
