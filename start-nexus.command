#!/usr/bin/env bash
# NEXUS — start script for macOS / Linux. macOS: double-click start-nexus.command. Linux: ./start-nexus.sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "NEXUS needs Node.js 20+ (free): https://nodejs.org/en/download"
  (command -v open >/dev/null && open https://nodejs.org/en/download) || (command -v xdg-open >/dev/null && xdg-open https://nodejs.org/en/download) || true
  read -r -p "Press Enter to close…" _; exit 1
fi
node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" || { echo "Node.js 20 or newer is required."; exit 1; }
[ -d node_modules ] || { echo "[1/2] Installing NEXUS (first run only)…"; npm install --no-audit --no-fund; }
if [ ! -f dist/index.html ] || [ ! -f dist-server/index.js ]; then echo "[2/2] Building NEXUS…"; npm run build; fi
echo "Starting NEXUS — your browser will open. Press Ctrl+C to stop."
exec node dist-server/index.js --serve-dist --open
