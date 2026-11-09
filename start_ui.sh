#!/usr/bin/env bash
# Quick launcher for Photon Web Dashboard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "$SCRIPT_DIR/venv/bin/python" ]; then
    PYTHON="$SCRIPT_DIR/venv/bin/python"
else
    PYTHON="python3"
fi

echo "[+] Starting Photon Web Dashboard..."
exec "$PYTHON" "$SCRIPT_DIR/web_server.py" "$@"

