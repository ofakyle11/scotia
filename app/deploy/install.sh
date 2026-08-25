#!/usr/bin/env bash
# Chambers installer — Ubuntu 22.04/24.04, idempotent.
# Usage:  sudo DOMAIN=chambers.yourfirm.ca bash deploy/install.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
: "${DOMAIN:?set DOMAIN=your.domain.tld}"
REPO_APP="$(cd "$(dirname "$0")/.." && pwd)"

echo "== packages =="
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw >/dev/null
# Node 22 LTS via NodeSource if node >= 20 is absent
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
# Caddy (official repo) for automatic HTTPS
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "== user, directories, code =="
id -u chambers >/dev/null 2>&1 || useradd --system --home /var/lib/chambers --shell /usr/sbin/nologin chambers
mkdir -p /opt/chambers /var/lib/chambers
rsync -a --delete "$REPO_APP/" /opt/chambers/app/ --exclude data --exclude node_modules 2>/dev/null || cp -r "$REPO_APP" /opt/chambers/app
chown -R root:root /opt/chambers
chown -R chambers:chambers /var/lib/chambers
chmod 700 /var/lib/chambers

echo "== services =="
install -m 644 "$REPO_APP/deploy/chambers.service" /etc/systemd/system/chambers.service
sed "s/chambers.example.com/${DOMAIN}/" "$REPO_APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now chambers
systemctl reload caddy || systemctl restart caddy

echo "== firewall =="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== first-boot invite =="
sleep 2
journalctl -u chambers -n 20 --no-pager | grep -A1 "FIRST BOOT" | sed "s|http://localhost:8028|https://${DOMAIN}|" || echo "(already provisioned — no invite pending)"
echo
echo "Done. Chambers is at https://${DOMAIN} — TLS provisions automatically on first request."
echo "NEXT: 1) open the invite link above once, enroll the founding admin, enable 2FA at /account"
echo "      2) copy /var/lib/chambers/root.key to the firm's password manager, then verify backups:"
echo "         sudo bash /opt/chambers/app/deploy/backup.sh"
