#!/usr/bin/env bash
# Chambers installer — Ubuntu 22.04 / 24.04, idempotent, safe to re-run.
#   sudo DOMAIN=chambers.yourfirm.ca bash deploy/install.sh
#
# Re-running is the supported way to pick up new code: it re-syncs, reloads the
# unit, restarts, and re-checks health. It never touches /var/lib/chambers.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$DEPLOY_DIR/lib.sh"

need_root
: "${DOMAIN:?set DOMAIN=your.domain.tld}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] \
  || die "DOMAIN '$DOMAIN' is not a hostname (letters, digits, hyphens and dots only)"
REPO_APP="$(cd "$DEPLOY_DIR/.." && pwd)"
[ -f "$REPO_APP/server.js" ] || die "run this from the repo: $REPO_APP has no server.js"
SHOW_INVITE=${SHOW_INVITE:-1}
export DEBIAN_FRONTEND=noninteractive

log "packages"
apt-get update -qq
# rsync is NOT in a stock Ubuntu 24.04 server image — install it here so code
# syncs are incremental, and keep tar as the fallback (see lib.sh sync_code).
apt-get install -y -qq ca-certificates curl gnupg ufw rsync tar coreutils >/dev/null

if [ "$(node_major)" -lt 20 ]; then
  log "installing Node 22 LTS (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
[ "$(node_major)" -ge 20 ] || die "node >= 20 is required and could not be installed (found: $(node -v 2>/dev/null || echo none))"
info "node $(node -v)"

if ! have caddy; then
  log "installing Caddy (automatic HTTPS)"
  rm -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg   # gpg --dearmor refuses to overwrite
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
info "caddy $(caddy version 2>/dev/null | head -1 || echo '(version unknown)')"

log "service account and directories"
getent group "$CHAMBERS_USER" >/dev/null 2>&1 || groupadd --system "$CHAMBERS_USER"
id -u "$CHAMBERS_USER" >/dev/null 2>&1 \
  || useradd --system --gid "$CHAMBERS_USER" --home "$CHAMBERS_DATA" \
             --shell /usr/sbin/nologin "$CHAMBERS_USER"
mkdir -p "$(dirname "$CHAMBERS_APP_DIR")" "$CHAMBERS_DATA" /var/log/caddy /etc/caddy
chown -R "$CHAMBERS_USER:$CHAMBERS_USER" "$CHAMBERS_DATA"
chmod 700 "$CHAMBERS_DATA"
id -u caddy >/dev/null 2>&1 && chown caddy:caddy /var/log/caddy || true

log "code -> $CHAMBERS_APP_DIR"
sync_code "$REPO_APP" "$CHAMBERS_APP_DIR"
rm -rf "$CHAMBERS_APP_DIR.old"
node --check "$CHAMBERS_APP_DIR/server.js" || die "the synced tree does not parse — refusing to restart the service"
info "$(find "$CHAMBERS_APP_DIR/rooms" -name '*.js' | wc -l) room modules installed"

log "systemd unit"
install -m 644 "$DEPLOY_DIR/chambers.service" /etc/systemd/system/chambers.service
if systemd_live; then
  systemctl daemon-reload
  systemctl enable "$CHAMBERS_UNIT" >/dev/null
  systemctl restart "$CHAMBERS_UNIT"     # enable --now would NOT pick up new code on a re-run
else
  warn "no running systemd here — unit written but not started"
fi

log "reverse proxy"
sed "s|chambers.example.com|${DOMAIN}|" "$DEPLOY_DIR/Caddyfile" > /etc/caddy/Caddyfile
if have caddy; then
  caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || die "/etc/caddy/Caddyfile is invalid — run: caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile"
fi
if systemd_live; then
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
fi

log "firewall"
if have ufw; then
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  # Allow the port sshd ACTUALLY listens on. The old script assumed the
  # OpenSSH profile (22) and would have locked out anyone who moved it.
  ssh_ports=$(awk 'tolower($1)=="port" && $2 ~ /^[0-9]+$/ {print $2}' \
    /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | sort -un || true)
  if [ -n "$ssh_ports" ]; then
    for p in $ssh_ports; do ufw allow "$p"/tcp >/dev/null; done
    info "SSH allowed on: $(echo "$ssh_ports" | tr '\n' ' ')"
  else
    ufw allow OpenSSH >/dev/null
    info "SSH allowed on the OpenSSH profile (22/tcp)"
  fi
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  info "8028 is NOT opened — the app binds 127.0.0.1 and is reached only through Caddy"
else
  warn "ufw is not installed — no firewall was configured. Install it, or configure your provider's."
fi

log "DNS"
resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -z "$resolved" ]; then
  warn "$DOMAIN has no A record yet — Let's Encrypt will fail until it points at this box"
else
  mine=$(hostname -I 2>/dev/null || true)
  found=0
  for ip in $mine; do [ "$ip" = "$resolved" ] && found=1 || true; done
  [ "$found" = 1 ] && info "$DOMAIN -> $resolved (this box)" \
    || warn "$DOMAIN -> $resolved, which is not an address on this box ($mine). TLS will fail if that is wrong."
fi

log "health"
if systemd_live; then
  run_health --wait 45 || die "the service did not come up healthy — see the commands above"
else
  info "skipped (no systemd)"
fi

# ---- first-boot enrolment link ---------------------------------------------
# server.js prints one single-use seat invite per locked seat on an empty
# store. It is a 7-day, single-use credential: shown once, here, on your own
# terminal, because that is the only channel that exists for it. It is never
# written to a file by this kit. Set SHOW_INVITE=0 for an unattended install
# and read it later with: sudo journalctl -u chambers | grep /invite/
if [ "$SHOW_INVITE" = "1" ] && systemd_live; then
  log "first-boot enrolment"
  invites=$(journalctl -u "$CHAMBERS_UNIT" --since '-5 min' --no-pager 2>/dev/null \
            | awk '/FIRST BOOT/{f=1} f && /\/invite\//{print}' \
            | sed "s|http://localhost:${CHAMBERS_PORT}|https://${DOMAIN}|" || true)
  if [ -n "$invites" ]; then
    printf '%s\n' "$invites"
    printf '   ^ single-use, expires in 7 days. Open it now in your own browser.\n'
    printf '     Do not paste it into email, chat, or a ticket.\n'
  else
    info "(already provisioned — no invite pending)"
  fi
fi

cat <<DONE

Done. Chambers is at https://${DOMAIN} — TLS provisions on the first request.

NEXT, in order:
  1. Open the invite link above, enrol the founding admin, turn on 2FA at /account.
  2. Escrow the root key — ONCE, the day you deploy:
       scp root@${DOMAIN}:${CHAMBERS_DATA}/root.key ./root.key   (from your laptop)
     then put that file in the firm's password manager or a sealed envelope held
     by two principals, and delete your local copy. Backups deliberately exclude
     it: lose it and every backup is unreadable forever. That is the design.
  3. Prove the backup works before you need it:
       sudo bash ${CHAMBERS_APP_DIR}/deploy/backup.sh
       sudo bash ${CHAMBERS_APP_DIR}/deploy/restore.sh --archive <newest> --root-key <escrowed> --check-only
  4. Schedule it:  echo '0 3 * * * root bash ${CHAMBERS_APP_DIR}/deploy/backup.sh' > /etc/cron.d/chambers-backup
DONE
