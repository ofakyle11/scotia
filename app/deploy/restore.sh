#!/usr/bin/env bash
# Chambers restore — bring a new box back to a working install from
#   (1) a backup archive from backup.sh  +  (2) the separately escrowed root.key.
# Neither half is any use without the other. That is by design.
#
#   sudo bash restore.sh --archive /path/chambers-20260826-030000.tar.gz \
#                        --root-key /media/escrow/root.key
#
#   sudo bash restore.sh --archive ... --root-key ... --check-only
#       Rehearsal: proves the pair opens the store in a throwaway directory,
#       touches neither /var/lib/chambers nor the running service. Run it
#       quarterly — an untested backup is a rumour.
#
# The key file may be escrowed as raw 32 bytes, base64, or hex; all three are
# accepted. Its contents are never printed, logged, or copied anywhere except
# the data directory, with mode 0600.
set -euo pipefail
umask 077

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$DEPLOY_DIR/lib.sh"

ARCHIVE=""
KEYFILE=""
CHECK_ONLY=0
FORCE=0

usage() {
  cat <<'USAGE'
usage: sudo bash restore.sh --archive FILE --root-key FILE [options]
  --archive FILE    backup written by backup.sh (chambers-*.tar.gz)
  --root-key FILE   the escrowed root key (raw 32 bytes, base64, or hex)
  --data DIR        restore target            (default /var/lib/chambers)
  --app DIR         installed app             (default /opt/chambers/app)
  --check-only      rehearse in a temp dir; do not touch data or the service
  --force           replace a non-empty data directory (it is moved aside first)
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --archive)  ARCHIVE=${2:?--archive needs a path}; shift 2 ;;
    --root-key) KEYFILE=${2:?--root-key needs a path}; shift 2 ;;
    --data)     CHAMBERS_DATA=${2:?--data needs a path}; shift 2 ;;
    --app)      CHAMBERS_APP_DIR=${2:?--app needs a path}; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --force)    FORCE=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) warn "unknown argument: $1"; usage >&2; exit 2 ;;
  esac
done

[ -n "$ARCHIVE" ] || { usage >&2; die "--archive is required"; }
[ -n "$KEYFILE" ] || { usage >&2; die "--root-key is required — the archive alone cannot be decrypted, ever"; }
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"
[ -f "$KEYFILE" ] || die "root key file not found: $KEYFILE"
[ "$CHECK_ONLY" = 1 ] || need_root

# ---- 1. the archive ---------------------------------------------------------
log "checking the archive"
gzip -t "$ARCHIVE" || die "archive is corrupt (gzip integrity test failed) — use an older one"
if [ -f "$ARCHIVE.sha256" ] && have sha256sum; then
  ( cd "$(dirname "$ARCHIVE")" && sha256sum -c --status "$(basename "$ARCHIVE").sha256" ) \
    && info "sha256 sidecar matches" \
    || die "sha256 mismatch — this archive is not the one that was written. Refusing."
else
  info "no .sha256 sidecar next to the archive — skipping checksum (gzip test passed)"
fi
members=$(tar -tzf "$ARCHIVE")
printf '%s\n' "$members" | grep -qE '(^|/)keyring\.json$' \
  || die "archive contains no keyring.json — it is not a Chambers backup"
if printf '%s\n' "$members" | grep -qE '(^|/)root\.key$'; then
  warn "this archive CONTAINS root.key — whoever holds the file holds the matters."
  warn "restore will continue, but rotate your backup process: backup.sh excludes it."
fi
info "$(printf '%s\n' "$members" | grep -cE '^\./matters/.+\.log$' || true) matter logs in the archive"

# ---- 2. the key -------------------------------------------------------------
# Normalise to 32 raw bytes in a private temp file. Contents never touch stdout.
WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM
chmod 700 "$WORK"
RAWKEY="$WORK/root.key"

keysize=$(wc -c < "$KEYFILE" | tr -d ' ')
if [ "$keysize" -eq 32 ]; then
  cp "$KEYFILE" "$RAWKEY"
  info "root key: raw 32 bytes"
elif [ "$keysize" -eq 33 ] && [ "$(tail -c 1 "$KEYFILE" | od -An -tu1 | tr -d ' ')" = "10" ]; then
  head -c 32 "$KEYFILE" > "$RAWKEY"
  info "root key: raw 32 bytes (trailing newline from the escrow copy dropped)"
elif tr -d '\r\n ' < "$KEYFILE" | grep -qiE '^[0-9a-f]{64}$'; then
  if have xxd; then
    tr -d '\r\n ' < "$KEYFILE" | xxd -r -p > "$RAWKEY"
  elif have node; then
    node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],Buffer.from(fs.readFileSync(process.argv[1],"utf8").trim(),"hex"));' "$KEYFILE" "$RAWKEY"
  else
    die "key looks like hex but neither xxd nor node is available to decode it"
  fi
  info "root key: 64 hex chars, decoded"
elif tr -d '\r\n ' < "$KEYFILE" | grep -qE '^[A-Za-z0-9+/_-]{42,48}={0,2}$'; then
  tr -d '\r\n ' < "$KEYFILE" | base64 -d > "$RAWKEY" 2>/dev/null \
    || die "base64-looking key could not be decoded"
  info "root key: base64, decoded"
else
  die "root key file is $keysize bytes and is not 32 raw bytes, 64 hex chars, or base64 of 32 bytes"
fi
[ "$(wc -c < "$RAWKEY" | tr -d ' ')" -eq 32 ] || die "decoded root key is not 32 bytes — wrong file"
chmod 600 "$RAWKEY"

# ---- 3. rehearsal, or the real thing ----------------------------------------
verify_store() {   # verify_store DIR AS_SERVICE_USER — opens the store; prints counts only
  local dir=$1 as_user=${2:-0} node_bin runner=()
  node_bin=$(command -v node || true)
  [ -n "$node_bin" ] || { warn "node not on PATH — skipping the open-the-store proof"; return 0; }
  [ -f "$CHAMBERS_APP_DIR/kernel/store.js" ] || {
    warn "app not installed at $CHAMBERS_APP_DIR — skipping the open-the-store proof"; return 0; }
  # On a real restore, read the store as the SERVICE user: that proves the
  # ownership the service will actually run under, not just root's view.
  # A rehearsal runs as whoever invoked it, because its throwaway mktemp dir is
  # deliberately private to that user and the service user cannot enter it.
  if [ "$as_user" = 1 ] && [ "$(id -u)" -eq 0 ] && id -u "$CHAMBERS_USER" >/dev/null 2>&1 && have runuser; then
    runner=(runuser -u "$CHAMBERS_USER" --)
  fi
  "${runner[@]}" "$node_bin" -e '
    const app = process.argv[1], dir = process.argv[2];
    const { Keyring } = require(app + "/kernel/crypto.js");
    const { Store }   = require(app + "/kernel/store.js");
    // Exit 2 = the filesystem said no (wrong owner, un-traversable parent) —
    // a different problem from exit 1 = the key does not open this store.
    const FS = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EROFS"]);
    let k, s;
    try { k = new Keyring(dir); s = new Store(dir, k); }
    catch (e) {
      if (FS.has(e.code)) { console.error("   cannot read the data directory as this user: " + e.message); process.exit(2); }
      console.error("   the root key does NOT open this store: " + e.message);
      process.exit(1);
    }
    const matters = s.firm.list("matter");
    let ok = 0, shredded = 0, bad = 0;
    for (const m of matters) {
      try { s.matterScope(m.id).list("fact"); ok++; }
      catch (e) { if (e.code === "SHREDDED") shredded++; else { bad++; console.error("   unreadable matter log: " + e.message); } }
    }
    // Counts only — never a matter title, client name or any record content.
    console.log(`   store opens: ${s.firm.list("user").length} users, ${matters.length} matters ` +
                `(${ok} readable, ${shredded} crypto-shredded, ${bad} unreadable)`);
    process.exit(bad ? 1 : 0);
  ' "$CHAMBERS_APP_DIR" "$dir"
}

# Run verify_store and turn its exit code into a specific instruction.
verify_or_die() {
  local dir=$1 rc=0
  verify_store "$dir" 1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    2) die "the '$CHAMBERS_USER' user cannot read $dir — the service would fail the same way.
   Check every parent directory is traversable (chmod o+x) and that the restore
   ran as root. Nothing has been deleted." ;;
    *) die "restored data will not open with this key — the service was NOT started.
   Try another archive/key pair; nothing has been deleted." ;;
  esac
}

if [ "$CHECK_ONLY" = 1 ]; then
  log "rehearsing the restore in $WORK/data (nothing on this box is touched)"
  mkdir -p "$WORK/data"
  tar -xzf "$ARCHIVE" -C "$WORK/data" --no-same-owner
  cp "$RAWKEY" "$WORK/data/root.key"
  chmod 600 "$WORK/data/root.key"
  rc=0
  verify_store "$WORK/data" || rc=$?
  case "$rc" in
    0) log "REHEARSAL PASSED — this archive plus this key reconstitute the firm."; exit 0 ;;
    2) die "REHEARSAL INCONCLUSIVE — could not read $WORK/data. Re-run as the user that owns it." ;;
    *) die "REHEARSAL FAILED — this archive and this key do not go together. Fix it BEFORE you need them." ;;
  esac
fi

# ---- 4. real restore --------------------------------------------------------
if unit_exists "$CHAMBERS_UNIT" && systemctl is-active --quiet "$CHAMBERS_UNIT"; then
  log "stopping $CHAMBERS_UNIT"
  systemctl stop "$CHAMBERS_UNIT"
fi

if [ -e "$CHAMBERS_DATA" ] && [ -n "$(ls -A "$CHAMBERS_DATA" 2>/dev/null || true)" ]; then
  [ "$FORCE" = 1 ] || die "$CHAMBERS_DATA is not empty. Re-run with --force (the existing directory is moved aside, never deleted)."
  aside="$CHAMBERS_DATA.pre-restore-$(date -u +%Y%m%d-%H%M%S)"
  mv "$CHAMBERS_DATA" "$aside"
  warn "existing data moved to $aside — delete it yourself once you are satisfied"
fi

log "restoring into $CHAMBERS_DATA"
mkdir -p "$CHAMBERS_DATA"
chmod 700 "$CHAMBERS_DATA"
tar -xzf "$ARCHIVE" -C "$CHAMBERS_DATA" --no-same-owner
install -m 600 "$RAWKEY" "$CHAMBERS_DATA/root.key"
rm -f "$CHAMBERS_DATA"/audit.log.lock

if id -u "$CHAMBERS_USER" >/dev/null 2>&1; then
  chown -R "$CHAMBERS_USER:$CHAMBERS_USER" "$CHAMBERS_DATA"
  info "owner set to $CHAMBERS_USER"
else
  warn "user '$CHAMBERS_USER' does not exist — run install.sh first, or chown by hand"
fi
chmod 700 "$CHAMBERS_DATA"
chmod 600 "$CHAMBERS_DATA/root.key" "$CHAMBERS_DATA/keyring.json" 2>/dev/null || true

log "proving the key opens the restored store"
verify_or_die "$CHAMBERS_DATA"

if unit_exists "$CHAMBERS_UNIT"; then
  log "starting $CHAMBERS_UNIT"
  systemctl start "$CHAMBERS_UNIT"
  if run_health --wait 30; then
    log "RESTORE COMPLETE — the firm is back up."
  else
    die "service started but /healthz never answered. Data is restored; investigate the app."
  fi
else
  log "RESTORE COMPLETE (no systemd unit here — start the app yourself)."
fi
printf '\n'
printf '   Reminder: the sessions of everyone signed in before the outage are gone by\n'
printf '   design; they sign in again. 2FA enrolments, users and matters all survive.\n'
printf '   Put the escrowed key back in the safe. Do not leave it on this box.\n'
