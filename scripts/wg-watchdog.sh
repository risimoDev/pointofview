#!/usr/bin/env bash
# AmneziaWG watchdog for the home server (superseded vanilla WireGuard —
# the ISP's DPI was killing the wg0 rekey handshake every ~2 minutes).
#
# Even with AmneziaWG, keep this as a safety net: if the tunnel still drops
# for any reason (ISP change, router reboot, etc), this pings the VPS peer
# and restarts awg-quick@awg0. Run every 1-2 minutes via cron.
#
# Install (as root):
#   sudo cp scripts/wg-watchdog.sh /usr/local/bin/wg-watchdog.sh
#   sudo chmod +x /usr/local/bin/wg-watchdog.sh
#   (crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/wg-watchdog.sh") | sudo crontab -
# Check it fired: journalctl -t wg-watchdog --no-pager -n 20
set -euo pipefail

PEER_IP="${1:-10.9.0.1}"   # VPS awg0 address
IFACE="awg0"
LOG_TAG="wg-watchdog"

if ping -c2 -W3 "$PEER_IP" >/dev/null 2>&1; then
  exit 0
fi

logger -t "$LOG_TAG" "peer $PEER_IP unreachable — restarting awg-quick@$IFACE"
systemctl restart "awg-quick@$IFACE"
sleep 3

if ping -c2 -W3 "$PEER_IP" >/dev/null 2>&1; then
  logger -t "$LOG_TAG" "restart fixed it, peer reachable again"
else
  logger -t "$LOG_TAG" "still unreachable after restart — needs manual look"
fi
