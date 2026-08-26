#!/usr/bin/env bash
# Chambers backup — the encrypted matter store, WITHOUT the root key.
#
# What is in the archive: keyring.json (every matter DEK, each still sealed
# under the tenant KEK, itself sealed under the root key), firm.log,
# matters/*.log, blobs/**, audit.log. All ciphertext except the audit chain,
# which is metadata only.
# What is NOT in it: root.key. The archive is therefore useless to whoever
# steals it, and restoring needs the key the firm escrowed separately. That is
# the whole security model — see RUNBOOK.md "Escrow the root key".
#
#   sudo bash backup.sh                 # nightly use; quiesces ~2s by default
#   sudo QUIESCE=0 bash backup.sh       # hot copy, zero downtime (see below)
#   sudo BACKUP_DIR=/mnt/vault RETAIN=30 bash backup.sh
#
# Standalone on purpose: cron must never fail because a sibling file moved.
set -euo pipefail
umask 077

DATA=${CHAMBERS_DATA:-/var/lib/chambers}
DEST=${BACKUP_DIR:-/var/backups/chambers}
RETAIN=${RETAIN:-14}
UNIT=${CHAMBERS_UNIT:-chambers}
# QUIESCE=1 stops the service for the duration of the tar (about two seconds
# for a two-lawyer firm) so no matter log can be captured mid-append. The store
# replays each log line through AES-256-GCM; one torn line makes that matter
# unopenable, and a backup you cannot restore is not a backup. Set QUIESCE=0 if
# you truly cannot take the seconds — then verify restores more often.
QUIESCE=${QUIESCE:-1}

die() { printf '!! %s\n' "$*" >&2; exit 1; }

[ -d "$DATA" ] || die "no data directory at $DATA (set CHAMBERS_DATA)"
[ -r "$DATA" ] || die "$DATA is not readable — run with sudo"
[ -r "$DATA/keyring.json" ] || die "$DATA/keyring.json missing or unreadable — is this a Chambers data dir? run with sudo"

mkdir -p "$DEST"
chmod 700 "$DEST"

stopped=0
restart_if_stopped() {
  if [ "$stopped" = 1 ]; then
    systemctl start "$UNIT" >/dev/null 2>&1 || printf '!! could not restart %s — start it by hand\n' "$UNIT" >&2
    stopped=0
  fi
}
trap restart_if_stopped EXIT INT TERM

if [ "$QUIESCE" != "0" ] && [ "$(id -u)" -eq 0 ] && command -v systemctl >/dev/null 2>&1 \
   && [ -d /run/systemd/system ] && systemctl is-active --quiet "$UNIT"; then
  printf '== quiescing %s for a consistent snapshot\n' "$UNIT"
  systemctl stop "$UNIT"
  stopped=1
fi

STAMP=$(date -u +%Y%m%d-%H%M%S)
ARCHIVE="$DEST/chambers-$STAMP.tar.gz"

# --exclude comes before the member list, and matches root.key at any depth.
tar -czf "$ARCHIVE" -C "$DATA" \
  --exclude=root.key --exclude=./root.key --exclude='*.lock' --exclude='*.tmp' .
chmod 600 "$ARCHIVE"

restart_if_stopped   # back in service before the (slower) verification pass
trap - EXIT INT TERM

# ---- verify the archive we just wrote, every time -------------------------
gzip -t "$ARCHIVE" 2>/dev/null || { rm -f "$ARCHIVE"; die "archive failed gzip integrity test — removed, NOT a backup"; }

members=$(tar -tzf "$ARCHIVE")
if printf '%s\n' "$members" | grep -qE '(^|/)root\.key$'; then
  rm -f "$ARCHIVE"
  die "root.key leaked into the archive — removed. Refusing to write a backup that carries the key."
fi
printf '%s\n' "$members" | grep -qE '(^|/)keyring\.json$' \
  || { rm -f "$ARCHIVE"; die "archive has no keyring.json — every matter would be unrecoverable. Removed."; }
printf '%s\n' "$members" | grep -qE '(^|/)firm\.log$' \
  || printf '!! note: no firm.log in the archive (a store with no matters yet?)\n' >&2

if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$DEST" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256" )
  chmod 600 "$ARCHIVE.sha256"
fi

# ---- prune, keeping the RETAIN newest -------------------------------------
mapfile -t archives < <(ls -1t "$DEST"/chambers-*.tar.gz 2>/dev/null || true)
if [ "${#archives[@]}" -gt "$RETAIN" ]; then
  for old in "${archives[@]:$RETAIN}"; do
    rm -f -- "$old" "$old.sha256"
  done
fi

size=$(du -h "$ARCHIVE" | cut -f1)
matters=$(printf '%s\n' "$members" | grep -cE '^\./matters/.+\.log$' || true)
printf 'backup written: %s (%s, %s matter logs, root.key deliberately excluded)\n' "$ARCHIVE" "$size" "$matters"
printf 'kept: %s of %s archives in %s\n' "$(ls -1 "$DEST"/chambers-*.tar.gz 2>/dev/null | wc -l)" "$RETAIN" "$DEST"
printf 'restore drill: sudo bash %s/restore.sh --archive %s --root-key <escrowed> --check-only\n' \
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" "$ARCHIVE"
# Off-site: rsync/restic this directory to storage IN THE SAME COUNTRY as the
# box. The archive is ciphertext, but residency is a professional obligation,
# not just a security one.
