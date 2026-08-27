# Going live — the whole thing, in order

Chambers is finished and tested. It is not running anywhere. This is the shortest
honest path from "a repo" to "Dan and Matt sign in", start to finish, about half an
hour of which maybe five minutes is you typing.

Nothing here is guesswork: every command below is what `deploy/install.sh` and the
runbook actually do. Paths are the installer's defaults — app at `/opt/chambers/app`,
data at `/var/lib/chambers` (mode 700), service `chambers`, app bound to
`127.0.0.1:8028` and reachable only through Caddy.

---

## What you need first

**A server.** Any Ubuntu 22.04 or 24.04 box, 1–2 GB RAM. That is genuinely enough:
Chambers has zero npm dependencies and no database server. ~$12–25/month.

Pick a **Toronto/Canadian region** if the provider has one. This is not superstition
— privileged client data staying in-jurisdiction is a real answer to a real question
a client may ask, and it costs nothing to choose it now versus migrating later.
DigitalOcean (`tor1`), Vultr (Toronto) and AWS (`ca-central-1`) all have one.

**A domain or subdomain**, e.g. `chambers.mattdanlaw.ca`. Point an **A record** at
the server's IP before you start — TLS is issued automatically on first boot, and it
can only be issued if DNS already resolves.

**A password manager entry ready.** You will be handed two enrolment links and a root
key, once each.

---

## 1. Get on the box

```bash
ssh root@YOUR_SERVER_IP
```

## 2. Get the code

```bash
apt-get update -qq && apt-get install -y -qq git
git clone https://github.com/ofakyle11/MattDanLaw.git /opt/chambers-src
cd /opt/chambers-src
```

## 3. Install — one command

```bash
sudo DOMAIN=chambers.yourfirm.ca bash app/deploy/install.sh
```

Substitute your real domain. That single command:

- installs Node 22 and Caddy
- creates the `chambers` system user and `/var/lib/chambers` at mode 700
- syncs the app to `/opt/chambers/app` and refuses to start if it does not parse
- writes the Caddy config with your domain and gets a TLS certificate automatically
- enables and starts the `chambers` systemd service
- configures the firewall: **deny all incoming** except SSH, 80 and 443. Port 8028
  is deliberately **not** opened — the app listens only on loopback and the outside
  world reaches it through Caddy or not at all
- checks the service is healthy before it reports success

It is idempotent. Re-running it is the supported way to pick up new code, and it
never touches `/var/lib/chambers`.

## 4. Escrow the root key — the one step nobody can undo for you

```bash
# from YOUR laptop, not the server
scp root@chambers.yourfirm.ca:/var/lib/chambers/root.key ./root.key
```

Put that file somewhere safe and offline — a password manager attachment, a safe.
**Every matter in the system is encrypted under it.** Lose the server and you can
restore from backup; lose the root key as well and every file is gone permanently and
correctly, with no recovery by anyone including us. That is the design working, and
it is the one thing you cannot ask anyone to fix afterwards.

Do it the day you deploy, not later.

## 5. Turn on nightly backups

```bash
echo '0 3 * * * root bash /opt/chambers/app/deploy/backup.sh' > /etc/cron.d/chambers-backup
```

Keeps 14 encrypted archives by default. Note what that means for destruction: a
matter destroyed today stays recoverable from earlier archives until they age out —
the certificate now says so, and `deploy/RUNBOOK.md` has the arithmetic and the purge
commands.

## 6. Prove a restore works — before you need it

```bash
sudo bash /opt/chambers/app/deploy/backup.sh          # take one now
ls -t /var/backups/chambers/                          # find the newest
sudo bash /opt/chambers/app/deploy/restore.sh \
  --archive /var/backups/chambers/<newest>.tar.gz \
  --root-key ./root.key --check-only
```

An untested backup is a rumour. `--check-only` verifies without touching live data.

## 7. Enrol the two seats

First boot writes both enrolment links to a root-only file:

```bash
sudo cat /var/lib/chambers/first-boot-invites.txt
```

They are deliberately **not** printed to the systemd journal — an enrolment link
creates a full admin account, and the journal is readable by anyone with sudo and
captured by any log shipper.

Send Dan his link, take yours. Each of you:

1. opens the link, sets **your own** email and password (typed twice)
2. lands on `/account` and enables 2FA immediately — scan the secret into any
   authenticator app
3. neither of you, and nobody else, can read or reset the other's credentials

Then:

```bash
sudo rm /var/lib/chambers/first-boot-invites.txt
```

Both seats are now taken. A third account cannot be created while both are active —
if someone loses a device, an admin releases that seat at `/admin` and re-issues it.

## 8. Before you rely on any AI feature

`/admin` → **Model gateway** → point it at a model, then **Competence bench**. It
runs 48 bar-style questions through the gateway and scores them against a 75% line.
Until the exact configured model has passed, the Associate's Office refuses
assignments and the Counsel Panel shows an unbenched warning.

A local model (Ollama on the same box) means nothing leaves the building — that is
the privacy-strongest option, and precisely the one most likely to flunk the bench.
Run it and see, before either of you leans on a word it writes.

---

## Keeping it running

| Task | Command |
|---|---|
| Update to newest code | `cd /opt/chambers-src && git pull && sudo bash app/deploy/update.sh` |
| Health check | `sudo bash /opt/chambers/app/deploy/healthcheck.sh` |
| Service status | `systemctl status chambers` |
| Logs (never contain client content) | `journalctl -u chambers -n 100` |

`update.sh` backs up first, syncs, restarts, verifies health, and **rolls back
automatically** if the new code does not come up. Data is never touched.

---

## Two things that are not this

**The Netlify demo tour** is a static walkthrough for showing someone around. It
cannot run Chambers — the encryption, audit chain and matter store need a real
stateful server. Linking the repo to that site is a click in the Netlify UI; it has
nothing to do with the steps above.

**The pasted Netlify API token** from earlier in our chat is in a transcript in
plaintext. Rotate it whenever you get a minute, regardless of anything else here.
