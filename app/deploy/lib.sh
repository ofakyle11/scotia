# shellcheck shell=bash
# Chambers deploy kit — shared helpers. SOURCED by install.sh / update.sh /
# restore.sh; never executed on its own. backup.sh and healthcheck.sh are
# deliberately standalone (they run from cron and from systemd, where a missing
# sibling file must never be able to break a backup or a service start).
#
# SECRETS RULE: nothing in this kit ever prints, echoes, copies or writes a
# stored secret. root.key is moved only as opaque bytes (never cat/base64'd to
# a terminal or a log), the AI gateway key lives encrypted inside the store and
# is never touched here, and no script writes any credential to a file.

# chambers.service hardcodes /opt/chambers/app and /var/lib/chambers (a unit
# file cannot read these). Overriding either var here is for testing and for
# non-standard layouts only — if you move them for real, edit the unit to match.
CHAMBERS_APP_DIR=${CHAMBERS_APP_DIR:-/opt/chambers/app}
CHAMBERS_DATA=${CHAMBERS_DATA:-/var/lib/chambers}
CHAMBERS_USER=${CHAMBERS_USER:-chambers}
CHAMBERS_UNIT=${CHAMBERS_UNIT:-chambers}
CHAMBERS_PORT=${CHAMBERS_PORT:-8028}

log()  { printf '== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die()  { printf '!! %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "run with sudo (needs root to write /opt, /var/lib and systemd units)"; }

# node_major -> major version number, or 0 when node is absent/broken.
node_major() {
  have node || { echo 0; return 0; }
  node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0
}

# systemd_live -> 0 when there is a running systemd we can drive. Containers,
# WSL and CI boxes have none; every caller degrades to a printed note instead
# of dying, so the same script is exercisable off-box.
systemd_live() { have systemctl && [ -d /run/systemd/system ]; }

# unit_exists UNIT -> 0 when systemd knows the unit.
unit_exists() { systemd_live && systemctl cat "$1" >/dev/null 2>&1; }

# sync_code SRC DEST
# Mirror SRC into DEST with delete-extras semantics, excluding data/,
# node_modules/ and .git/.
#
# Ubuntu 24.04 server images do NOT ship rsync (verified: `command -v rsync`
# is empty on a stock 24.04 root). The old one-liner hid that behind
# `2>/dev/null || cp -r "$SRC" "$DEST"`, which on a re-run copied the tree to
# DEST/app (nested) instead of over it, and copied data/ in as well. So:
# rsync when present, otherwise tar (coreutils-grade, always present), and
# either way the new tree is assembled in a staging dir and swapped in, so the
# service never runs a half-copied tree and a re-run is idempotent.
# The previous tree is left at DEST.old for rollback_code; callers that do not
# want it call `rm -rf "$DEST.old"`.
sync_code() {
  local src=$1 dest=$2 staging
  [ -d "$src" ] || die "source tree not found: $src"
  [ -f "$src/server.js" ] || die "$src is not the Chambers app (no server.js)"
  mkdir -p "$(dirname "$dest")"
  staging="$dest.new.$$"
  rm -rf "$staging"
  mkdir -p "$staging"
  if have rsync; then
    rsync -a --delete --exclude=data --exclude=node_modules --exclude=.git "$src/" "$staging/"
  else
    tar -C "$src" --exclude=./data --exclude=./node_modules --exclude=./.git -cf - . \
      | tar -C "$staging" -xf - --no-same-owner
  fi
  [ -f "$staging/server.js" ] || { rm -rf "$staging"; die "code copy failed — no server.js under $staging"; }
  [ -d "$staging/rooms" ] || { rm -rf "$staging"; die "code copy failed — no rooms/ under $staging"; }
  rm -rf "$dest.old"
  [ -e "$dest" ] && mv "$dest" "$dest.old"
  mv "$staging" "$dest"
  chown -R root:root "$dest" 2>/dev/null || true
  chmod 0755 "$dest"/deploy/*.sh 2>/dev/null || true
  return 0
}

# rollback_code DEST — put back what sync_code displaced.
rollback_code() {
  local dest=$1
  [ -d "$dest.old" ] || { warn "no $dest.old to roll back to"; return 1; }
  rm -rf "$dest.failed"
  [ -e "$dest" ] && mv "$dest" "$dest.failed"
  mv "$dest.old" "$dest"
  return 0
}

# run_health [args...] — invoke the kit's health check from wherever this lib
# was sourced. Returns the check's exit status.
run_health() {
  local hc="${DEPLOY_DIR:-$(dirname "${BASH_SOURCE[0]}")}/healthcheck.sh"
  [ -x "$hc" ] || [ -f "$hc" ] || { warn "healthcheck.sh missing next to lib.sh"; return 2; }
  bash "$hc" "$@"
}
