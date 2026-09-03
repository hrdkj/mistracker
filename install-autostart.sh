#!/usr/bin/env bash
# Install Mistracker as a systemd user service that auto-starts on login,
# plus an app-launcher entry ("Mistracker") that opens it in the browser.
#
# Usage:
#   ./install-autostart.sh            install + enable + start now
#   ./install-autostart.sh --uninstall  remove service + launcher
#
# Opt-in: nothing runs in the background until you execute this script,
# so cloning the repo never auto-starts anything on someone else's machine.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8111}"
SERVICE_DIR="$HOME/.config/systemd/user"
DESKTOP_DIR="$HOME/.local/share/applications"
PYTHON_BIN="$REPO_DIR/.venv/bin/python"

if [[ "${1:-}" == "--uninstall" ]]; then
    systemctl --user disable --now mistracker.service 2>/dev/null || true
    rm -f "$SERVICE_DIR/mistracker.service" "$DESKTOP_DIR/mistracker.desktop"
    systemctl --user daemon-reload
    echo "Mistracker auto-start removed."
    exit 0
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "Creating virtualenv..."
    uv sync --project "$REPO_DIR"
fi

mkdir -p "$SERVICE_DIR" "$DESKTOP_DIR"

# Direct .venv python (not `uv run`) avoids the ~35 MB uv supervisor
# process and per-start sync checks. MISTRACKER_DEBUG=0 disables the
# Flask reloader so the service is a single ~35 MB process instead of two.
cat > "$SERVICE_DIR/mistracker.service" <<EOF
[Unit]
Description=Mistracker study-mistake tracker (http://127.0.0.1:${PORT})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
Environment=MISTRACKER_DEBUG=0
Environment=PORT=${PORT}
ExecStart=${PYTHON_BIN} main.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat > "$DESKTOP_DIR/mistracker.desktop" <<EOF
[Desktop Entry]
Version=1.0
Name=Mistracker
Comment=Track study mistakes (starts local server if needed)
Exec=sh -c "systemctl --user start mistracker.service; xdg-open http://127.0.0.1:${PORT}"
Terminal=false
Type=Application
Icon=web-browser
StartupNotify=true
Categories=Education;
EOF
chmod +x "$DESKTOP_DIR/mistracker.desktop"

systemctl --user daemon-reload
systemctl --user enable --now mistracker.service

echo "Waiting for http://127.0.0.1:${PORT} ..."
for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
        echo "Mistracker is up at http://127.0.0.1:${PORT}"
        systemctl --user status mistracker.service --no-pager -l | head -n 12
        exit 0
    fi
    sleep 1
done
echo "Service started but the page did not respond in 30s."
echo "Check: journalctl --user -u mistracker.service -e"
exit 1
