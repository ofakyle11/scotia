#!/usr/bin/env bash
# Nightly backup of the encrypted matter store — WITHOUT the root key.
# The archive is useless to whoever steals it; restoring needs the root key
# the firm escrowed separately (password manager / sealed envelope).
set -euo pipefail
DATA=/var/lib/chambers
DEST=${BACKUP_DIR:-/var/backups/chambers}
mkdir -p "$DEST"
STAMP=$(date -u +%Y%m%d-%H%M%S)
tar -czf "$DEST/chambers-$STAMP.tar.gz" -C "$DATA" --exclude=root.key .
chmod 600 "$DEST/chambers-$STAMP.tar.gz"
ls -1t "$DEST"/chambers-*.tar.gz | tail -n +15 | xargs -r rm --   # keep 14
echo "backup written: $DEST/chambers-$STAMP.tar.gz (root.key deliberately excluded)"
# Off-site: rsync/restic this directory to storage IN THE SAME COUNTRY as the cell.
