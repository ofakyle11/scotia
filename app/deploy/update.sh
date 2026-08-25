#!/usr/bin/env bash
# Update Chambers in place: sync new code, restart. Data is untouched.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
REPO_APP="$(cd "$(dirname "$0")/.." && pwd)"
rsync -a --delete "$REPO_APP/" /opt/chambers/app/ --exclude data --exclude node_modules
systemctl restart chambers
systemctl --no-pager --lines=5 status chambers
