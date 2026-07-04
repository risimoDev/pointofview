#!/usr/bin/env bash
# WireGuard watchdog for the home server.
#
# Residential NAT/CGNAT can silently drop the UDP port mapping after a period
# of low traffic. When that happens wg0 stays "up" (interface exists, wg show
# reports a peer) but no packets actually get through until the tunnel is
# restarted — PersistentKeepalive alone doesn't reliably recover from this on
# some ISPs. This script pings the VPS peer and restarts wg-quick@wg0 if it's
# unreachable. Run every 1-2 minutes via cron (see install instructions below).
#
# Install (as root):
#   sudo cp scripts/wg-watchdog.sh /usr/local/bin/wg-watchdog.sh
#   sudo chmod +x /usr/local/bin/wg-watchdog.sh
#   (crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/wg-watchdog.sh") | sudo crontab -
# Check it fired: journalctl -t wg-watchdog --no-pager -n 20
set -euo pipefail

PEER_IP="${1:-10.9.0.1}"   # VPS wg0 address
LOG_TAG="wg-watchdog"

if ping -c2 -W3 "$PEER_IP" >/dev/null 2>&1; then
  exit 0
fi

logger -t "$LOG_TAG" "peer $PEER_IP unreachable — restarting wg-quick@wg0"
systemctl restart wg-quick@wg0
sleep 3

if ping -c2 -W3 "$PEER_IP" >/dev/null 2>&1; then
  logger -t "$LOG_TAG" "restart fixed it, peer reachable again"
else
  logger -t "$LOG_TAG" "still unreachable after restart — needs manual look"
fi
