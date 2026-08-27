#!/usr/bin/env bash
# Update Chambers in place: back up, sync new code, restart, verify health,
# and roll back automatically if the new code does not come up.
# Data is never touched.
#   sudo bash deploy/update.sh
#   sudo SKIP_BACKUP=1 bash deploy/update.sh   # only if you just took one
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$DEPLOY_DIR/lib.sh"

need_root
REPO_APP="$(cd "$DEPLOY_DIR/.." && pwd)"
[ -f "$REPO_APP/server.js" ] || die "run this from the repo: $REPO_APP has no server.js"
[ -d "$CHAMBERS_APP_DIR" ] || die "$CHAMBERS_APP_DIR is not installed — run install.sh first"

if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  log "backup before update"
  bash "$DEPLOY_DIR/backup.sh"
fi

log "syncing code"
sync_code "$REPO_APP" "$CHAMBERS_APP_DIR"      # previous tree kept at .old

if ! node --check "$CHAMBERS_APP_DIR/server.js"; then
  warn "the new tree does not parse — rolling back before touching the service"
  rollback_code "$CHAMBERS_APP_DIR"
  die "update aborted, old code left running"
fi

log "restarting $CHAMBERS_UNIT"
if systemd_live && unit_exists "$CHAMBERS_UNIT"; then
  install -m 644 "$DEPLOY_DIR/chambers.service" /etc/systemd/system/chambers.service
  systemctl daemon-reload
  if systemctl restart "$CHAMBERS_UNIT" && run_health --wait 45; then
    rm -rf "$CHAMBERS_APP_DIR.old"
    systemctl --no-pager --lines=5 status "$CHAMBERS_UNIT" || true
    log "UPDATE COMPLETE"
  else
    warn "new code failed to come up — rolling back to the previous tree"
    rollback_code "$CHAMBERS_APP_DIR"
    systemctl restart "$CHAMBERS_UNIT" || true
    if run_health --wait 30; then
      die "rolled back; the previous version is healthy again. The failed tree is at $CHAMBERS_APP_DIR.failed"
    fi
    die "rolled back but the service is still unhealthy — sudo journalctl -u $CHAMBERS_UNIT -n 50"
  fi
else
  rm -rf "$CHAMBERS_APP_DIR.old"
  warn "no running systemd unit here — code synced, start the app yourself"
fi
