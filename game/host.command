#!/usr/bin/env bash
# MYS Generals - HOST a LAN multiplayer game (macOS). Double-click to run. Requires Node.js.
# Usage: ./host.command [port]   (default port 3000)
# Other players on the SAME Wi-Fi open the LAN link / scan the QR printed below to join.
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org then run this again." >&2
  echo "Press any key to close..."; read -n 1 -s; exit 1
fi
echo "============================================================"
echo " MYS Generals - hosting a LAN game"
echo " - Keep every device on the SAME Wi-Fi / network."
echo " - On first run, click \"Allow\" if macOS asks to accept"
echo "   incoming network connections."
echo " - Share the LAN link / QR printed below. Other devices"
echo "   open it in a browser to join - use the LAN address, not localhost."
echo "============================================================"
exec node launch.mjs "${1:-3000}"
