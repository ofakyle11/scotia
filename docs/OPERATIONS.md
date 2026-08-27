# Chambers — operations runbook

For whoever operates the firm's server. Assumes you can SSH and use `sudo`, and
nothing else. No Claude, no agent, no control plane, no vendor.

Everything here is plain bash and one systemd unit. If you can reach the box you
can run the firm.

- **This file** is what to do: provision, install, run, recover.
- **[`../app/deploy/RUNBOOK.md`](../app/deploy/RUNBOOK.md)** is why the kit is
  shaped the way it is — the hardened unit, secrets discipline, the optional local
  model service. Read it when something surprises you.
- **[`../app/README.md`](../app/README.md)** is the application itself.

> **The one thing you must not skip:** escrow `root.key` on day one. Without it
> every backup you ever take is permanently unreadable. That is the security model
> working, not a bug — see [Key escrow](#key-escrow--do-this-on-day-one).

---

## 1. What you need

| | |
|---|---|
| **A VM** | Ubuntu 22.04 or 24.04, **in a Canadian region** for a Canadian practice — DigitalOcean `tor1`, OVHcloud Beauharnois, AWS `ca-central-1`. 1 vCPU / 1 GB RAM is genuinely enough for two lawyers. |
| **Node 22** | The installer adds it from NodeSource if the box has nothing ≥ 20. |
| **Caddy** | TLS only. The installer adds it. |
| **A domain** | With an **A record already pointing at the VM's IP.** Caddy provisions the certificate on the first request and cannot do it before DNS resolves. |
| **SSH** | Key-only. Set `PasswordAuthentication no` in `sshd_config`. |

**No database. No Redis. No queue. No object store. No build step.** If a
provisioning checklist tells you to stand up Postgres, it is describing a different
product. Chambers stores everything as encrypted append-only logs in one directory,
which is why backup is `tar` and restore is untar.

Disk: the store is small — text sealed per record — but attachments live in it too.
Start at 25 GB and watch it; a full disk stops an append-only store dead.

---

## 2. Install — one command

```bash
git clone <this-repo> && cd <repo>/app
sudo DOMAIN=chambers.yourfirm.ca bash deploy/install.sh
```

In order: apt packages (including `rsync`, which a stock Ubuntu 24.04 image does
**not** ship) → Node 22 if needed → Caddy → the `chambers` system user → code into
`/opt/chambers/app` → the systemd unit → `/etc/caddy/Caddyfile` with your domain,
validated before reload → UFW (SSH on whatever port `sshd` actually uses, plus
80/443, nothing else — port 8028 is never opened) → a DNS sanity check → a health
check → the first-boot enrolment links.

It is **idempotent**. Re-running is the supported way to redeploy: it stages the new
tree, swaps it in, reloads and restarts, and never touches `/var/lib/chambers`.

Then, in order, the same day:

1. **Enrol.** Open the invite link the installer printed, set a 12+ character
   password, and turn on 2FA at `/account` immediately. Single use, 7-day expiry —
   treat it as a credential and never paste it into email, chat or a ticket.
   Missed it? `sudo journalctl -u chambers | grep /invite/`
2. **Escrow the root key.** Section 4. Not next week.
3. **Prove the backup works.** Section 5. Before there are real matters to lose.

### Where things live

| path | what |
|---|---|
| `/opt/chambers/app` | the code (replaced on update) |
| `/var/lib/chambers` | **the firm** — `root.key`, `keyring.json`, `firm.log`, `matters/*.log`, `blobs/`, `audit.log`. Mode 0700, owned by `chambers`. |
| `/var/backups/chambers` | archives, mode 0600, 14 kept |
| `/etc/systemd/system/chambers.service` | the unit |
| `/etc/caddy/Caddyfile` | the TLS edge |

---

## 3. Day-2

### Health

```bash
sudo bash /opt/chambers/app/deploy/healthcheck.sh            # one probe
sudo bash /opt/chambers/app/deploy/healthcheck.sh --wait 30  # retry for 30s
```

Healthy is one line, exit 0:

```
ok   Chambers healthy — http://127.0.0.1:8028/healthz returned 200 ok (attempt 1)
```

Unhealthy tells you exactly what it tried and what to run next, exit 1:

```
!! Chambers health check FAILED
   probed : http://127.0.0.1:8999/healthz
   result : ERR no answer — connection refused or timed out
   tries  : 1 over 0s
   next   : sudo systemctl status chambers --no-pager
            sudo journalctl -u chambers -n 50 --no-pager
            sudo ss -ltnp | grep 8999        # is anything listening?
            df -h /var/lib/chambers        # a full disk stops every write
   note   : the journal can contain a one-time enrolment link. Treat it
            as a credential — do not paste it into a ticket or chat.
```

It never dumps the journal, because a fresh journal carries enrolment links.

The same script is the unit's readiness gate, so a process that starts but never
serves is a *failed start*, not a service that looks fine and is not. Optional
watchdog:

```
*/5 * * * * root /opt/chambers/app/deploy/healthcheck.sh --quiet || systemctl restart chambers
```

### Update

```bash
cd <repo>/app && sudo bash deploy/update.sh
```

Takes a backup, syncs the code, refuses to restart if the new tree does not even
parse, restarts, waits for health, and **rolls back to the previous tree
automatically** if the new code does not come up. The failed tree is kept at
`/opt/chambers/app.failed` for the post-mortem. Data is never touched.

Before you push an update, the gate should be green on your own machine —
`cd app && node test/run-all.js`, 13 suites, `GATE: PASS`.

### Backup

```bash
sudo bash /opt/chambers/app/deploy/backup.sh
echo '0 3 * * * root bash /opt/chambers/app/deploy/backup.sh' > /etc/cron.d/chambers-backup
```

```
backup written: /var/backups/chambers/chambers-20260826-132410.tar.gz (12K, 1 matter logs, root.key deliberately excluded)
kept: 2 of 14 archives in /var/backups/chambers
```

Defaults: `/var/backups/chambers`, 14 archives kept, mode 0600, a `.sha256` sidecar
beside each. Override with `BACKUP_DIR=`, `RETAIN=`, `QUIESCE=`.

By default the backup **stops the service for the couple of seconds the tar takes**
and restarts it through a trap even if the backup fails. Matter state is an
append-only log replayed through AES-256-GCM: one torn line makes that matter
unopenable, and a backup you cannot restore is not a backup. `QUIESCE=0` gives a hot
copy with no downtime if you truly cannot spare the seconds.

Every archive is verified as it is written — `gzip -t`, `keyring.json` must be
present, and **`root.key` must be absent**. If the key ever appeared in an archive
the script deletes the archive and fails loudly rather than leave a backup that
carries its own key.

**Off-site:** `rsync` or `restic` `/var/backups/chambers` to storage **in the same
country as the box**. The archives are ciphertext, but residency is a professional
obligation, not only a security one. Keep the off-site copy and the escrowed key in
*different* places — together they are the firm.

### Logs

```bash
journalctl -u chambers -f      # application
ls /var/log/caddy/             # access logs, JSON
```

Neither contains client content. The application journal *can* contain a one-time
enrolment link right after a first boot — treat it accordingly.

---

## 4. Key escrow — do this on day one

`/var/lib/chambers/root.key` is 32 random bytes. It wraps the tenant key, which
wraps one key per matter. **Backups exclude it deliberately.** An archive on its own
is unreadable forever, by anyone, including you.

From your own laptop — not from the server's shell, and never printed to a terminal:

```bash
scp root@chambers.yourfirm.ca:/var/lib/chambers/root.key ./root.key
base64 -w0 root.key > root.key.b64    # optional: restore.sh takes raw, base64 or hex
```

Put it in the firm's password manager as an attachment, or in a sealed envelope
**held by two principals**. Then delete your local copies.

This is not a formality. Proven on this build — the same archive, opened with the
right key and then with a wrong one:

```
== rehearsing the restore in /tmp/tmp.QLGcaKYopl/data (nothing on this box is touched)
   store opens: 2 users, 1 matters (1 readable, 0 crypto-shredded, 0 unreadable)
== REHEARSAL PASSED — this archive plus this key reconstitute the firm.
```

```
   the root key does NOT open this store: Unsupported state or unable to authenticate data
!! REHEARSAL FAILED — this archive and this key do not go together.
```

- **Lose the key → every backup is permanently unreadable.** No recovery, no
  support channel, no vendor escrow. That is the design.
- **Hold the key and the archives in the same place → you have undone the design.**

---

## 5. The restore drill

Run the rehearsal **quarterly** and after any change to the backup path. An untested
backup is a rumour.

### Rehearsal — no downtime, touches nothing

```bash
sudo bash /opt/chambers/app/deploy/restore.sh \
  --archive /var/backups/chambers/chambers-20260826-030000.tar.gz \
  --root-key /media/usb/root.key \
  --check-only
```

It verifies the sha256 sidecar, extracts to a throwaway directory, drops the key in,
opens the store with the app's own kernel, and prints **counts only** — never a
matter title or a client name. Exit 0 is the only acceptable answer.

### The real thing — new box, from nothing

1. **Build the box.** Same Canadian region, domain A record repointed at the new IP,
   then the ordinary install:

   ```bash
   git clone <this-repo> && cd <repo>/app
   sudo DOMAIN=chambers.yourfirm.ca bash deploy/install.sh
   ```

   It brings up an *empty* Chambers and prints fresh enrolment links — ignore them,
   the restore replaces that store.

2. **Get both halves onto the box**: newest archive from off-site, escrowed key from
   the safe.

3. **Restore:**

   ```bash
   sudo bash /opt/chambers/app/deploy/restore.sh \
     --archive /root/chambers-20260826-030000.tar.gz \
     --root-key /root/root.key \
     --force
   ```

   `--force` is needed only because the install left an empty store, and it never
   deletes: the existing directory is moved to
   `/var/lib/chambers.pre-restore-<timestamp>` first. The script stops the service,
   extracts, installs the key at 0600, chowns to `chambers`, **proves the key opens
   the store before starting anything**, starts the unit and waits for `/healthz`.
   If the key does not open the store the service is **not** started and nothing has
   been deleted.

4. **Afterwards.** Everyone signs in again — sessions die on restart by design; 2FA
   enrolments, users, matters and the audit chain all survive. `shred -u
   /root/root.key` to remove the key from the box, put the escrow copy back in the
   safe, take a fresh backup, confirm DNS.

---

## 6. When a seat is locked out

**Read this before you need it.** Chambers has **no password reset, no "forgot
password" link, no 2FA recovery codes, and no admin screen that can reset another
person's credentials.** That is deliberate for a two-person firm with no help desk,
but it means the only recovery path is an operator with root on the box.

Every procedure below **requires `root.key` on the box** — which is another reason
section 4 matters. Stop the service first: the running server holds an in-memory
projection of the store, so an edit made underneath it is not seen until restart and
can interleave with its own writes.

```bash
sudo systemctl stop chambers
```

Run the recovery, then `sudo systemctl start chambers`. Every one of these writes an
ordinary audited event into the append-only log — nothing is rewritten, nothing is
hidden.

Each snippet names the app directory explicitly (`APP="/opt/chambers/app"`) so it
works from any working directory. If you installed somewhere else, change that one
line.

### Case A — lost the second factor (password still known)

Clears the second factor only. The person signs in with their existing password and
re-enrols 2FA at `/account`.

```bash
sudo -u chambers CHAMBERS_DATA=/var/lib/chambers node -e '
const APP="/opt/chambers/app";
const {Keyring}=require(APP+"/kernel/crypto.js");const {Store}=require(APP+"/kernel/store.js");
const k=new Keyring(process.env.CHAMBERS_DATA);const s=new Store(process.env.CHAMBERS_DATA,k);
const email=process.argv[1];
const u=s.firm.list("user").find(x=>x.email.toLowerCase()===email.toLowerCase());
if(!u){console.error("no such user");process.exit(1);}
s.firm.put("user",{...u,totp:null,pendingTotp:null,totpLastStep:null},"operator:2fa-reset");
console.log("cleared 2FA for",u.email,"— they sign in with their password and re-enrol at /account");
' dan@yourfirm.ca
```

Verified on this build: before, sign-in demands a 6-digit code the person cannot
produce; after, sign-in returns `303 → /r/desk`.

**Tell them to re-enrol 2FA the moment they are back in.** Until they do, that
account is password-only.

### Case B — lost the password

Set a temporary passphrase, hand it over in person or by phone — never by email —
and have them change it. (There is no change-password screen either; to rotate it,
run this again.)

```bash
sudo -u chambers CHAMBERS_DATA=/var/lib/chambers node -e '
const APP="/opt/chambers/app";
const {Keyring,hashPassword}=require(APP+"/kernel/crypto.js");const {Store}=require(APP+"/kernel/store.js");
const k=new Keyring(process.env.CHAMBERS_DATA);const s=new Store(process.env.CHAMBERS_DATA,k);
const [email,pw]=process.argv.slice(1);
if(String(pw).length<12){console.error("choose 12+ characters");process.exit(1);}
const u=s.firm.list("user").find(x=>x.email.toLowerCase()===email.toLowerCase());
if(!u){console.error("no such user");process.exit(1);}
s.firm.put("user",{...u,pw:hashPassword(pw)},"operator:password-reset");
console.log("password reset for",u.email);
' matt@yourfirm.ca 'temporary-passphrase-1'
```

Verified: the new password signs in (`→ /r/desk`), the old one is refused
(`→ /?d=1`). If the account also has 2FA, that still applies — this changes the
password only.

### Case C — "it says my password is wrong and I know it isn't"

Almost always the **rate limiter**: 20 attempts per IP per 15 minutes, after which
even the correct password is refused. Verified — 22 bad attempts, then the correct
password is still denied.

It is in-memory and per-IP. Wait 15 minutes, or `sudo systemctl restart chambers`,
which clears it instantly (and signs everyone out — sessions are in memory too).
Check `journalctl -u chambers | grep login.ratelimited` before assuming a lost
password.

### Case D — replacing a seat holder

The build is locked to **two active accounts**. You cannot invite a third; you must
release a seat first. Deactivating preserves the person's history and audit trail —
it never deletes anything.

```bash
sudo -u chambers CHAMBERS_DATA=/var/lib/chambers node -e '
const APP="/opt/chambers/app";
const {Keyring}=require(APP+"/kernel/crypto.js");const {Store}=require(APP+"/kernel/store.js");
const k=new Keyring(process.env.CHAMBERS_DATA);const s=new Store(process.env.CHAMBERS_DATA,k);
const u=s.firm.list("user").find(x=>x.email===process.argv[1]);
if(!u){console.error("no such user");process.exit(1);}
s.firm.put("user",{...u,active:false},"operator:seat-release");
console.log("deactivated",u.email,"— active seats now:",s.firm.list("user",x=>x.active).length);
' departing@yourfirm.ca
```

Then start the service and invite the replacement — from `/admin` as an admin, or
from the console:

```bash
cd /opt/chambers/app
sudo -u chambers CHAMBERS_DATA=/var/lib/chambers node tools/invite.js new@yourfirm.ca lawyer "N. Lawyer"
```

```
Single-use invite for new@yourfirm.ca (lawyer), expires in 24h:
  /invite/Fdgs__LipZDTlBf-xsW6SyB0n6udXlzb
```

Prefix it with `https://chambers.yourfirm.ca`. With both seats occupied it refuses,
as it should:

```
Refusing: seat lock — this build is limited to 2 enrolled accounts.
```

### Case E — both seats locked out at once

Not a special case: do Case A and/or Case B for each account in turn. As long as you
have root on the box and `root.key` is in place, the firm is recoverable.

If the box itself is gone, this is section 5 — rebuild, then restore from archive +
escrowed key.

**If `root.key` is gone and there is no escrow copy, the matters are unrecoverable.**
Not by you, not by anyone. There is no other path, which is exactly why section 4 is
a day-one task.

---

## 7. External services

All four are optional and outbound-only. Each degrades to something honest rather
than breaking. Keys are set **in the app by an admin**, stored encrypted in the firm
log — never in a config file, an environment variable or the Caddyfile.

| service | what it needs | set at | without it |
|---|---|---|---|
| **CanLII** | API key — request via CanLII's feedback form; commercial-scale use is a licensing conversation with them | `/r/canlii` (admin) | **Link-out mode.** Citation scanning and CanLII deep links still work. Live resolution and the citator do not. |
| **CourtListener / RECAP** | API token (optional), free from the Free Law Project | `/r/uscourts` (admin) | Search still works at anonymous rate limits. A token raises them. |
| **EDGAR** | a declared contact email — the SEC's fair-access policy requires automated clients to identify themselves | `/r/edgar` (admin) | **The room searches nothing.** The SEC declines unidentified requests, so this one is required before any EDGAR use. |
| **Model gateway** | an OpenAI-compatible endpoint, optionally a key | `/admin` → Model gateway | The gateway is off. Every other room is unaffected. |

Notes that matter professionally:

- The CanLII module **never scrapes** canlii.org — their Terms of Use prohibit
  scraping and bulk download. It uses the official REST API and deep links only.
- PACER itself is credentialed and fee-based with no free API. Chambers links into
  it and never scrapes it; RECAP is searched first because what the archive already
  holds is free.
- The model gateway is the **only** door between Chambers and any language model.
  Point it at a local Ollama and nothing leaves the building — see the optional
  section at the end of [`../app/deploy/RUNBOOK.md`](../app/deploy/RUNBOOK.md);
  that needs 8–16 GB RAM, not the 1 GB droplet. Point it at a hosted vendor and
  privileged material crosses a border and lands in someone else's logs. Every call
  is audited, a matter can forbid model use entirely, and client content never
  trains anything.
- Losing any of these keys is not a crisis. Re-enter it in the same screen.

---

## 8. Troubleshooting

| symptom | look here |
|---|---|
| install ends "the service did not come up healthy" | `journalctl -u chambers -n 50` — usually permissions or Node version |
| 502 from the browser | `systemctl status chambers`; the proxy must point at `127.0.0.1:8028`, never `localhost` (a dual-stack box resolves that to `::1` first) |
| TLS never provisions | the A record does not point here yet; `journalctl -u caddy -n 50` |
| every write fails | `df -h /var/lib/chambers` — a full disk stops an append-only store dead |
| service starts, then dies | five failed starts in five minutes trips `StartLimitBurst`; `systemctl reset-failed chambers` after fixing the cause |
| backup exits non-zero | it deleted the bad archive on purpose; the message names the failed check |
| sign-in works on the box but not from a laptop | the session cookie is `Secure`; anything that is not `localhost` needs real HTTPS |
| everyone signed out at once | expected after any restart — sessions are in memory by design |
| locked out by UFW | the installer allows whatever port `sshd_config` declares; if you changed it *after* installing, `ufw allow <port>/tcp` |

---

## 9. Posture

- No public surface: the domain serves the sign-in and nothing else, robots are
  denied, and `/healthz` answers 404 from the internet (local checks bypass Caddy).
- The app binds `127.0.0.1`. Port 8028 is never opened in the firewall.
- Sessions die on restart, deliberately.
- Before real client matters: an external penetration test and a crypto review, and
  confirm the law society's residency and retention expectations for the province.

### The operator's calendar

| when | do |
|---|---|
| day one | escrow `root.key`; prove a restore rehearsal passes |
| nightly (cron) | `backup.sh` |
| weekly | glance at `/admin` — the audit chain should read **intact** |
| quarterly | full restore rehearsal against the newest archive; confirm the escrow copy is where you think it is and still readable |
| on any update | gate green (`node test/run-all.js`), then `update.sh` |
| on staff change | release the seat, then invite (section 6, Case D) |
