# Chambers — deployment runbook

## What you need
- Ubuntu 22.04/24.04 VM in a **Canadian region** for a Canadian practice
  (DigitalOcean Toronto tor1 · OVHcloud Beauharnois · AWS ca-central-1). 1 vCPU/1GB is plenty to start.
- A domain (or subdomain) with an A record pointed at the VM's IP **before** installing.
- SSH access with sudo.

## Install (one command)
    git clone <this-repo> && cd <repo>/app
    sudo DOMAIN=chambers.yourfirm.ca bash deploy/install.sh

The installer is idempotent: Node 22, Caddy (automatic HTTPS), a locked-down
systemd service running as its own user, UFW allowing only SSH/80/443, and the
first-boot founding-admin invite printed at the end. Open that link once, set a
12+ char password, then enable 2FA at /account immediately.

## Day-2
- **Update:**   `sudo bash deploy/update.sh`   (code only; data untouched)
- **Backup:**   `sudo bash deploy/backup.sh`  — add to cron:
      `0 3 * * * root bash /opt/chambers/app/deploy/backup.sh`
  Backups exclude `root.key` by design. **Escrow `/var/lib/chambers/root.key`
  once** (password manager or sealed envelope, held by two principals). Lose the
  key and every backup is permanently unreadable — that is the security model
  working, so escrow it the day you deploy.
- **Restore:** new VM → run installer → stop service → untar backup into
  /var/lib/chambers → restore root.key alongside → start service.
- **Logs:** `journalctl -u chambers -f` (app) · `/var/log/caddy/` (access).
  Neither contains client content.

## Posture notes
- No public surface: the domain serves the sign-in and nothing else; robots
  denied; sessions die on restart by design.
- Keep SSH key-only (`PasswordAuthentication no` in sshd_config).
- Before real client matters: external penetration test + crypto review
  (see the Privilege Vault doc), and confirm the law society's residency and
  retention expectations for the province.
