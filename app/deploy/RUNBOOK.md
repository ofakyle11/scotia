# Chambers — deployment runbook

Everything in this directory is plain bash and one systemd unit. No agent, no
control plane, no vendor. If you can SSH to the box you can operate it.

| file | what it is |
|---|---|
| `install.sh` | first install and every re-install. Idempotent. |
| `update.sh` | new code, with a backup first and an automatic roll-back. |
| `backup.sh` | nightly encrypted backup, deliberately **without** the root key. |
| `restore.sh` | new box + archive + escrowed key → working firm. Also rehearses. |
| `healthcheck.sh` | one probe of `/healthz`, for systemd, cron, or you. |
| `chambers.service` | the hardened unit. |
| `Caddyfile` | TLS edge. |
| `optional-ollama.sh` | **optional** local model service. Nothing depends on it. |
| `lib.sh` | shared helpers (sourced; not run directly). |

---

## What you need

- Ubuntu 22.04 / 24.04 VM in a **Canadian region** for a Canadian practice
  (DigitalOcean Toronto `tor1` · OVHcloud Beauharnois · AWS `ca-central-1`).
  1 vCPU / 1 GB is plenty for two lawyers. (Only the *optional* local model
  service needs a bigger box — see the last section.)
- A domain or subdomain with an **A record already pointing at the VM's IP**.
  Caddy provisions TLS on the first request; without the A record it cannot.
- SSH access with sudo.

## Install (one command)

    git clone <this-repo> && cd <repo>/app
    sudo DOMAIN=chambers.yourfirm.ca bash deploy/install.sh

What it does, in order: apt packages (including `rsync`, which a stock Ubuntu
24.04 image does **not** ship) → Node 22 LTS via NodeSource if node < 20 →
Caddy → the `chambers` system user and group → code into `/opt/chambers/app`
→ the systemd unit → `/etc/caddy/Caddyfile` with your domain, validated before
reload → UFW (SSH on whatever port sshd actually uses, plus 80/443, nothing
else) → a DNS sanity check → a health check → the first-boot enrolment links.

**Re-running is the supported way to redeploy.** It re-syncs code into a
staging tree and swaps it in, reloads the unit, restarts, and re-checks health.
It never touches `/var/lib/chambers`.

Then, in order:

1. Open the enrolment link, set a 12+ character password, turn on 2FA at
   `/account` immediately. The link is **single-use and expires in 7 days**;
   treat it as a credential and never paste it into email, chat, or a ticket.
   Missed it? The links are in `$CHAMBERS_DATA/first-boot-invites.txt` (mode
   0600, root-only). They are deliberately NOT in the journal: a live seat link
   creates a full admin account, and the journal is readable by anyone with
   sudo and captured by any log shipper. **Delete that file once both seats are
   enrolled.**
2. **Escrow the root key** (below). Do it the day you deploy.
3. Prove the backup works (below). Do it before you have real matters.

## Health

    sudo bash /opt/chambers/app/deploy/healthcheck.sh            # one probe
    sudo bash /opt/chambers/app/deploy/healthcheck.sh --wait 30  # retry for 30s

Healthy prints one line and exits 0:

    ok   Chambers healthy — http://127.0.0.1:8028/healthz returned 200 ok (attempt 1)

Unhealthy prints what was probed, what came back, the unit's state, and the
four commands worth running next. It never dumps the journal — a fresh journal
contains enrolment links.

The same script is the unit's readiness gate (`ExecStartPost=… --wait 30`), so
a process that starts but never serves is a **failed start**, not a service
that looks fine and is not. After five failed starts in five minutes systemd
stops retrying (`StartLimitBurst`) instead of flapping forever.

Optional cron watchdog:

    */5 * * * * root /opt/chambers/app/deploy/healthcheck.sh --quiet || systemctl restart chambers

## Day-2

**Update** — `cd <repo>/app && sudo bash deploy/update.sh`
Takes a backup, syncs the code, refuses to restart if the new tree does not
even parse, restarts, waits for health, and **rolls back to the previous tree
automatically** if the new code does not come up. The failed tree is kept at
`/opt/chambers/app.failed` for the post-mortem. Data is never touched.

**Backup** — `sudo bash /opt/chambers/app/deploy/backup.sh`

    echo '0 3 * * * root bash /opt/chambers/app/deploy/backup.sh' > /etc/cron.d/chambers-backup

Defaults: `/var/backups/chambers`, 14 archives kept, mode 0600, a `.sha256`
sidecar beside each. `BACKUP_DIR=`, `RETAIN=` and `QUIESCE=` override.

By default the backup **stops the service for the couple of seconds the tar
takes** (`QUIESCE=1`) and starts it again through a trap, even if the backup
fails. Reason: matter state is an append-only log replayed through AES-256-GCM,
and one torn line makes that matter unopenable. A backup you cannot restore is
not a backup; two seconds at 03:00 is a better trade for a two-lawyer firm.
`QUIESCE=0` gives you a hot copy with no downtime if you need it.

Every archive is verified the moment it is written: `gzip -t`, `keyring.json`
must be present, and **`root.key` must be absent** — if the key ever appeared
in an archive the script deletes it and fails loudly rather than leave a
backup that carries its own key.

Off-site: `rsync`/`restic` `/var/backups/chambers` to storage **in the same
country as the box**. The archives are ciphertext, but data residency is a
professional obligation, not only a security one.

**Logs** — `journalctl -u chambers -f` (app) · `/var/log/caddy/` (access).
Neither contains client content.

---

## Escrow the root key — once, on day one

`/var/lib/chambers/root.key` is 32 random bytes. It wraps the tenant key, which
wraps one key per matter. Backups **exclude it on purpose**: an archive on its
own is unreadable, forever, by anyone including you.

From your own laptop (not from the server's shell — do not leave copies on the
box, and do not print it to a terminal):

    scp root@chambers.yourfirm.ca:/var/lib/chambers/root.key ./root.key
    # optional, if your password manager only takes text:
    base64 -w0 root.key > root.key.b64      # restore.sh accepts raw, base64, or hex

Put it in the firm's password manager as an attachment or a secure note, or in
a sealed envelope, **held by two principals**. Then delete your local copies.

- Lose the key → every backup is permanently unreadable. That is the security
  model working as designed, not a bug to be worked around.
- Hold the key and the archive in the same place → you have undone the model.
  Keep them apart.

## THE RESTORE DRILL

Run the rehearsal **quarterly** and after any change to the backup path. An
untested backup is a rumour.

### Rehearsal — no downtime, touches nothing

    sudo bash /opt/chambers/app/deploy/restore.sh \
      --archive /var/backups/chambers/chambers-20260826-030000.tar.gz \
      --root-key /media/usb/root.key \
      --check-only

It verifies the sha256 sidecar, extracts to a throwaway directory, drops the
key in, opens the store with the app's own kernel, and prints **counts only**
(never a matter title or a client name):

    == checking the archive
       sha256 sidecar matches
       1 matter logs in the archive
       root key: raw 32 bytes
    == rehearsing the restore in /tmp/tmp.XXXXXXXX/data (nothing on this box is touched)
       store opens: 0 users, 1 matters (1 readable, 0 crypto-shredded, 0 unreadable)
    == REHEARSAL PASSED — this archive plus this key reconstitute the firm.

Anything else is a real problem you have found on a Tuesday instead of during
an outage. The wrong key prints:

    the root key does NOT open this store: Unsupported state or unable to authenticate data
    !! REHEARSAL FAILED — this archive and this key do not go together. Fix it BEFORE you need them.

### The real thing — new box, from nothing

1. **Build the box**: same Canadian region, same domain A record repointed at
   the new IP, then

       git clone <this-repo> && cd <repo>/app
       sudo DOMAIN=chambers.yourfirm.ca bash deploy/install.sh

   The installer brings up an *empty* Chambers and prints fresh enrolment
   links — ignore them, the restore replaces that store.

2. **Get the two halves onto the box**: the newest archive from off-site, and
   the escrowed key from the safe.

3. **Restore**:

       sudo bash /opt/chambers/app/deploy/restore.sh \
         --archive /root/chambers-20260826-030000.tar.gz \
         --root-key /root/root.key \
         --force            # only needed because install.sh left an empty store

   `--force` never deletes: the existing directory is moved to
   `/var/lib/chambers.pre-restore-<timestamp>` first.

   The script stops the service, extracts, installs the key at mode 0600,
   chowns everything to `chambers`, **proves the key opens the store before it
   starts anything**, starts the unit, and waits for `/healthz`:

       == restoring into /var/lib/chambers
          owner set to chambers
       == proving the key opens the restored store
          store opens: 2 users, 14 matters (14 readable, 0 crypto-shredded, 0 unreadable)
       == starting chambers
       ok   Chambers healthy — http://127.0.0.1:8028/healthz returned 200 ok (attempt 1)
       == RESTORE COMPLETE — the firm is back up.

   If the key does not open the store the service is **not** started and
   nothing has been deleted. Try another archive/key pair.

4. **Afterwards**: everyone signs in again (sessions die on restart by design;
   2FA enrolments, users, matters and the audit chain all survive). Delete the
   key from the box — `shred -u /root/root.key` — and put the escrow copy back
   in the safe. Take a fresh backup. Re-point DNS if you have not already.

### What is and is not in an archive

In: `keyring.json` (every matter key, still sealed), `firm.log`,
`matters/*.log`, `blobs/**`, `audit.log`. Out: `root.key`, lock files, temp
files. A stolen archive is 100% ciphertext except the audit chain, which is
metadata only — no client content, ever.

## Destroying a matter, and why backups decide when it is final

The Closing room destroys a matter's encryption key and removes its sealed log
and blobs from the live store, so nothing on this box can reopen it. That is not
the whole story, and the certificate now says so.

`backup.sh` archives `keyring.json` together with `matters/` and `blobs/`, and
keeps `RETAIN` archives (14 by default). It deliberately hard-fails if the
keyring is missing, because without it every matter is unrecoverable. So an
archive taken BEFORE a destruction still contains that matter's wrapped key and
its sealed records: restore that archive, add the escrowed root key, and the
"destroyed" matter reads in full.

Destruction therefore becomes irreversible everywhere only when the last
pre-destruction archive has aged out.

**When you destroy a matter:**

1. Note the destruction date from the certificate (it is also in the audit chain).
2. That date plus `RETAIN` days is when destruction becomes final. With the
   default nightly schedule and `RETAIN=14`, that is 14 days.
3. If the retention schedule or an undertaking to the client requires destruction
   sooner, purge the pre-destruction archives explicitly:

   ```bash
   # List archives older than the destruction date, then remove them.
   ls -l /var/backups/chambers/
   sudo rm /var/backups/chambers/chambers-YYYY-MM-DD*.tar.gz
   ```

   Do this for every off-site copy as well — the rsync/restic target in
   "Day-2" is a second set of archives with the same property.
4. Record what you purged. The audit chain records the destruction; it cannot
   know what you did with media it never sees.

Do not shorten `RETAIN` to make destruction faster: the archives are the only
thing standing between a disk failure and the loss of every live matter. Purge
the specific archives that matter instead.

## Secrets discipline in this directory

Nothing here prints, logs or stores a stored secret. Specifically:

- No script ever reads `root.key` to a terminal or a log. `restore.sh` moves
  key bytes file-to-file only, into a `mktemp -d` it deletes on exit, then to
  `/var/lib/chambers/root.key` at mode 0600.
- `healthcheck.sh` never dumps the journal; it tells you the command instead,
  because a fresh journal carries enrolment links.
- The AI gateway's API key (if you ever use a hosted model) lives encrypted
  inside the store and is never touched by anything in this directory.
- The one credential printed anywhere is the first-boot enrolment link, on your
  own terminal, once, because that is the only channel it has. It is
  single-use, expires in 7 days, and is never written to a file by this kit.
  `SHOW_INVITE=0 sudo -E bash deploy/install.sh` suppresses even that for an
  unattended install.

## The systemd unit, and why it is shaped that way

The service may write **its own data directory and nothing else**:
`ProtectSystem=strict` + `ProtectHome` + an explicit `ReadWritePaths`, plus
`StateDirectory=chambers` / `StateDirectoryMode=0700` so systemd creates,
owns and re-fixes `/var/lib/chambers` on every start — the sandbox can never
lock the app out of its own store. `UMask=0077` because the store's log files
would otherwise be created 0644.

Two directives are deliberately **absent**, and both should stay absent:

- `MemoryDenyWriteExecute` — blocks the `mprotect(PROT_EXEC)` that V8's JIT
  performs. With it set, node does not reliably run. Keeping it would mean
  `node --jitless`, an unmeasured performance cost for one directive.
- `ProcSubset=pid` — V8 sizes its heap from `/proc/meminfo`.

`RestrictAddressFamilies` includes `AF_NETLINK`: glibc's `getaddrinfo` opens a
netlink socket for source-address selection, so dropping it breaks every
outbound lookup (CanLII, CourtListener, the model gateway) with "temporary
failure in name resolution".

If the service ever fails to start right after a kernel or node upgrade, the
first thing to try is commenting out `SystemCallFilter=@system-service`, then
`systemctl daemon-reload && systemctl restart chambers`. Confirm any unit edit
with `systemd-analyze verify /etc/systemd/system/chambers.service`.

## Troubleshooting

| symptom | look here |
|---|---|
| install ends "the service did not come up healthy" | `journalctl -u chambers -n 50` — usually a permissions or Node version problem |
| 502 from the browser | `systemctl status chambers`; the proxy points at `127.0.0.1:8028`, never `localhost` (a dual-stack box resolves that to `::1` first) |
| TLS never provisions | the A record does not point here yet; `journalctl -u caddy -n 50` |
| every write fails | `df -h /var/lib/chambers` — a full disk stops an append-only store dead |
| service starts, then dies | five failed starts in five minutes trips `StartLimitBurst`; `systemctl reset-failed chambers` after you fix the cause |
| backup exits non-zero | it deletes the bad archive on purpose; the message says which check failed |
| locked out by UFW | the installer allows whatever port `sshd_config` declares; if you changed the port *after* installing, `ufw allow <port>/tcp` |

## Posture notes

- No public surface: the domain serves the sign-in and nothing else, robots are
  denied, sessions die on restart by design. `/healthz` answers 404 from the
  internet (the local checks bypass Caddy) — delete the `@external_health`
  block in the Caddyfile if an uptime monitor needs it.
- The app binds `127.0.0.1` only. Port 8028 is never opened in the firewall.
- Keep SSH key-only: `PasswordAuthentication no` in `sshd_config`.
- Before real client matters: an external penetration test and a crypto review
  (see the Privilege Vault doc), and confirm the law society's residency and
  retention expectations for the province.

---

## OPTIONAL — a local model service (Ollama)

**Entirely optional. Chambers works fully with the model gateway off, and
nothing in this kit installs or requires it.** Skip this section unless the
firm wants the AI features in the Moot Room and elsewhere.

Why local: the gateway (`kernel/ai.js`) speaks the OpenAI-compatible API, so it
can point at a hosted model — but pointing it at a vendor means privileged
material crosses a border and lands in someone else's logs. **Ollama on this
box keeps every inference on the box**: the prompt, the document and the answer
never leave the machine, and no third party can be compelled to produce what it
never received.

**Hardware first.** An 8B model needs roughly 8 GB of free RAM and 6 GB of
disk, and answers in tens of seconds on CPU. The 1 vCPU / 1 GB droplet above
cannot run it. Either resize to 8–16 GB, or run Ollama on a second machine on
the same private network and allow port 11434 **only** from the Chambers box.

Exact commands (or just run `sudo bash deploy/optional-ollama.sh`, which does
these and checks each one):

    # 1. install
    curl -fsSL https://ollama.com/install.sh | sh

    # 2. pin it to loopback so an upgrade can never publish it to the network
    sudo mkdir -p /etc/systemd/system/ollama.service.d
    printf '[Service]\nEnvironment=OLLAMA_HOST=127.0.0.1:11434\n' \
      | sudo tee /etc/systemd/system/ollama.service.d/override.conf
    sudo systemctl daemon-reload && sudo systemctl enable --now ollama

    # 3. pull a model (several GB)
    ollama pull llama3.1:8b

    # 4. prove the endpoint answers, and that it is loopback-only
    curl -fsS http://127.0.0.1:11434/v1/models >/dev/null && echo endpoint ok
    ss -ltn | grep 11434        # must show 127.0.0.1:11434, not 0.0.0.0:11434

Then wire it in from the browser, as an admin, at **/admin → Model gateway**:

    OpenAI-compatible endpoint : http://127.0.0.1:11434/v1
    Model                      : llama3.1:8b
    API key                    : leave blank — a local Ollama needs none

Unchanged by any of this: every call is policy-checked per matter and audited,
a matter can forbid model use entirely (Moot Room), and client content never
trains anything — the gateway only ever infers.

To turn it off: clear the endpoint field at /admin (a blank endpoint disables
the gateway cleanly), then `sudo systemctl disable --now ollama`.
