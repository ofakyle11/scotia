# Chambers security audit — findings

Report-only Opus-5 auditors, each required to attempt to REFUTE every candidate
before reporting it; anything not demonstrable is marked PLAUSIBLE rather than
CONFIRMED. Auditors discarded 44 candidates this way.

**19 findings** (14 CONFIRMED) across 4 domains: crypto-envelope, crypto-keylifecycle, auth-session, auth-password.

| # | Sev | Conf | Domain | Finding | Location |
|---|-----|------|--------|---------|----------|
| 1 | HIGH | CONFIRMED | crypto-keylifecycle | Crypto-shredding is defeated by the firm's own retained backups: a "destroyed" matter is fully recoverable in plaintext from any pre-shred archive plus the escrowed root key | `app/deploy/backup.sh:60` |
| 2 | MEDIUM | CONFIRMED | crypto-envelope | Crypto-shred does not reach the matter's identity or its financial narrative: title, client, adverse parties, litigation theory and every ledger memo survive destruction under the tenant KEK | `app/kernel/store.js:77` |
| 3 | MEDIUM | CONFIRMED | crypto-envelope | "Cryptographically irreversible" destruction is reversible from any pre-shred backup: destroyMatterKey only rewrites keyring.json, while the sealed matter log and blobs are left on disk and every nightly archive carries the wrapped DEK | `app/kernel/crypto.js:68` |
| 4 | MEDIUM | CONFIRMED | crypto-keylifecycle | Shredding a matter destroys only its DEK — the matter's prospective-client intake record, ledger memos and letters live in the firm scope under the tenant KEK and survive destruction, and room 01 still lists the destroyed client | `app/rooms/01-intake.js:14` |
| 5 | MEDIUM | CONFIRMED | auth-session | Login/2FA rate limiter keys on the reverse-proxy's socket address, so 21 anonymous requests lock the whole firm out of sign-in | `app/server.js:108` |
| 6 | MEDIUM | CONFIRMED | auth-password | Enrollment token travels in the URL path, so every live invite is written verbatim into the TLS edge's access log and the systemd journal | `app/server.js:31` |
| 7 | MEDIUM | CONFIRMED | auth-password | scrypt work factor (N=16384, r=8, p=1) is 5x below the weakest currently-recommended parameterisation, and the wrapped hashes sit in the same directory as the key that unwraps them | `app/kernel/crypto.js:80` |
| 8 | MEDIUM | CONFIRMED | auth-password | Login throttling and login audit attribution both key on req.socket.remoteAddress, which is 127.0.0.1 for every real user behind the shipped reverse proxy | `app/server.js:108` |
| 9 | MEDIUM | CONFIRMED | auth-password | The rate-limited branch of login() still writes an audit entry containing the unbounded attacker-supplied email, giving an unauthenticated caller unlimited growth of the hash-chained audit log | `app/kernel/auth.js:38` |
| 10 | MEDIUM | PLAUSIBLE | crypto-keylifecycle | Keyring mints a fresh root key whenever root.key is absent, with no first-boot marker and no fail-closed check — a data directory that has lost its key files is silently re-keyed and, in one case, re-initialised as a virgin firm while the old matter logs are orphaned | `app/kernel/crypto.js:32` |
| 11 | LOW | CONFIRMED | auth-session | Sessions have an idle timeout but no absolute lifetime — resolve() extends expiry unconditionally on every request | `app/kernel/auth.js:90` |
| 12 | LOW | CONFIRMED | auth-session | Enabling or disabling 2FA needs neither the password nor a fresh session, and does not rotate the session id | `app/server.js:179` |
| 13 | LOW | CONFIRMED | auth-session | server.js keeps raw session tokens alive forever as flash-map keys, defeating auth.js's deliberate hash-only session storage | `app/server.js:35` |
| 14 | LOW | CONFIRMED | auth-password | There is no password change or recovery path anywhere in the application | `app/kernel/auth.js:126` |
| 15 | LOW | CONFIRMED | auth-password | Non-seat invite redemption skips the email format and uniqueness checks the seat path performs; an invite minted without an email field persists a user whose email is undefined and permanently breaks every login | `app/kernel/auth.js:119` |
| 16 | LOW | PLAUSIBLE | crypto-envelope | open() has no length guard, so a truncated blob is authenticated against a truncated GCM tag (Node accepts 4–15-byte tags) | `app/kernel/crypto.js:19` |
| 17 | LOW | PLAUSIBLE | crypto-keylifecycle | Destroying a matter DEK drops the cache entry but never zeroes the key bytes: the plaintext DEK, the tenant KEK and the root key stay resident in the process heap after a shred | `app/kernel/crypto.js:73` |
| 18 | LOW | PLAUSIBLE | crypto-keylifecycle | Shredding rewrites keyring.json by rename-over, leaving the previous copy — which still contains the destroyed matter's wrapped DEK — in unallocated blocks on the data volume | `app/kernel/crypto.js:50` |
| 19 | LOW | PLAUSIBLE | crypto-keylifecycle | A matter is committed to the firm log before its DEK is minted, and neither write is fsynced — a crash or ENOSPC in that window leaves a permanently keyless matter that the app reports as neither live nor shredded | `app/kernel/store.js:73` |

---

## 1. Crypto-shredding is defeated by the firm's own retained backups: a "destroyed" matter is fully recoverable in plaintext from any pre-shred archive plus the escrowed root key

**HIGH / CONFIRMED** — crypto-keylifecycle — `app/deploy/backup.sh:60`

**Evidence**

```js
backup.sh:22  RETAIN=${RETAIN:-14}
backup.sh:60-61
  tar -czf "$ARCHIVE" -C "$DATA" \
    --exclude=root.key --exclude=./root.key --exclude='*.lock' --exclude='*.tmp' .
backup.sh:4-6  "What is in the archive: keyring.json (every matter DEK, each still sealed under the tenant KEK ...), firm.log, matters/*.log, blobs/**"

against the claim the app prints on the certificate of destruction:
26-closing.js:59  ['Effect', 'The matter’s encryption key was destroyed. Its records, documents and history are cryptographically unrecoverable — in the live store, every replica, and every backup.'],
26-closing.js:116  <p class="note">Destruction deletes the matter’s key, not just the files: the encrypted history becomes unreadable everywhere at once, including backups.</p>

and the only thing shredding actually mutates:
crypto.js:68-75  destroyMatterKey(matterId) { ... delete this.ring.matters[matterId]; this.ring.destroyed[matterId] = new Date().toISOString(); this._dekCache.delete(matterId); this._save(); }
```

**How it fails**

1. backup.sh runs nightly (install.sh:161 installs exactly that cron) and keeps RETAIN=14 archives. Each archive contains keyring.json — which holds the matter's DEK wrapped under the tenant KEK — plus matters/<id>.log and blobs/<id>/**. 2. An admin later destroys the matter in room 26; k.shred -> store.shredMatter -> keyring.destroyMatterKey deletes the wrapped DEK from the LIVE keyring.json only. Nothing touches the 14 archives already on disk (or off-site: backup.sh:99 tells the operator to rsync/restic them elsewhere). 3. The firm still holds root.key in escrow — install.sh:154 makes escrowing it step 2 of every deployment. 4. Anyone with an archive written before the shred plus that escrowed key runs restore.sh (or the same three lines it uses at restore.sh:129-135) and reads the destroyed matter in full. I reproduced this end to end against the real kernel: after k.shred() the live store answered `SHREDDED matter key destroyed (crypto-shredded)`, while the pre-shred archive + root.key returned `RESTORED shredded matter facts: [{"text":"PRIVILEGED brakes serviced late",...}]`, `RESTORED shredded matter blob : PRIVILEGED attachment bytes`, and `isShredded in restored store : false` — the destruction marker is gone too, so the restored app treats the matter as live and lets it be reopened. The certificate of destruction the client is handed is therefore false for up to 14 nights (longer for off-site copies), which for a court-ordered or retention-schedule destruction is the malpractice event.

**Fix**

Make shredding cover the archives, or stop claiming it does. Minimal correct change: (a) have k.shred() write the destroyed matter id to a durable purge list, and add a deploy step (invoked by shred and re-run by backup.sh before it prunes) that rewrites every retained archive in $BACKUP_DIR — dropping ./matters/<id>.log and ./blobs/<id>/** and rewriting ./keyring.json with that key removed and the `destroyed` marker added — re-verifying and re-writing the .sha256 sidecar; and (b) until that exists, correct the two claims at rooms/26-closing.js:59 and :116 to state that backups written before destruction must be purged separately, and say so on the printed certificate.

## 2. Crypto-shred does not reach the matter's identity or its financial narrative: title, client, adverse parties, litigation theory and every ledger memo survive destruction under the tenant KEK

**MEDIUM / CONFIRMED** — crypto-envelope — `app/kernel/store.js:77`

**Evidence**

```js
shredMatter(matterId) {
    this._matterScopes.delete(matterId);
    this.keyring.destroyMatterKey(matterId);
    // The sealed log and blobs remain on disk but are unreadable forever.
  }

// ...and the content that never lived under the DEK in the first place:
// app/kernel/store.js:72-76
  createMatter(meta, by) {
    const rec = this.firm.put('matter', meta, by);   // <- firm scope = tenant KEK
    this.keyring.createMatterKey(rec.id);
    return rec;
  }
// app/kernel/api.js:75
      const txn = firm.put('ledgerTxn', { matterId, date: ..., memo, kind: kind || 'general', lines });
```

**How it fails**

shredMatter() destroys only the per-matter DEK, which seals matters/<id>.log and blobs/<id>/**. The matter's own record (title, client, adverse[], theory, budget) is written to the FIRM scope by store.createMatter (store.js:73) and every ledgerTxn — including its free-text `memo` and trust amounts — is written to the FIRM scope by api.js:75. The firm scope is sealed with the tenant KEK (store.js:62), which shredding never touches. I proved this end to end: after k.shred(m.id), a fresh `new Store(dir, new Keyring(dir))` still returns `title: 'Beaumont v. Ridgeline (PRIVILEGED)' | client: 'A. Beaumont' | theory: 'client was sober; driver ran the light' | adverse: ['Ridgeline Logistics Inc.']` and `memo: ['Retainer re: DUI defence — client A. Beaumont']`, while matterScope(m.id) throws SHREDDED. Room 26 then renders that very surviving record on the certificate of destruction (26-closing.js:55-56 `['Matter', esc(m.title)], ['Client', esc(m.client)]`) directly under the assertion at 26-closing.js:59 that "Its records, documents and history are cryptographically unrecoverable — in the live store, every replica, and every backup." The client identity, the opposing party, counsel's theory of the case and the full billing narrative of a supposedly destroyed file remain readable to anyone holding the box and root.key, forever. For a destruction certificate handed to a client under a retention schedule this is a materially false representation.

**Fix**

Either (a) move matter-scoped content out of the tenant-KEK scope — seal the matter record's sensitive fields (title, client, adverse, theory) and every ledgerTxn memo under the matter DEK, keeping only the opaque matterId and the numeric legs in the firm log — or (b) have kernel/api.js shred() overwrite the surviving firm-scope records for that matter with a redacted tombstone (`{id, status:'destroyed'}` and, for each ledgerTxn, `memo:null`) before the DEK is destroyed, and reword 26-closing.js:59/116 to state exactly what survives.

## 3. "Cryptographically irreversible" destruction is reversible from any pre-shred backup: destroyMatterKey only rewrites keyring.json, while the sealed matter log and blobs are left on disk and every nightly archive carries the wrapped DEK

**MEDIUM / CONFIRMED** — crypto-envelope — `app/kernel/crypto.js:68`

**Evidence**

```js
destroyMatterKey(matterId) {
    if (!this.ring.matters[matterId]) throw new Error('no key');
    this.ring.matters[matterId] = null;
    delete this.ring.matters[matterId];
    this.ring.destroyed[matterId] = new Date().toISOString();
    this._dekCache.delete(matterId);
    this._save();
  }

// app/deploy/backup.sh:60-61 — the archive contains the wrapped DEKs, the matter logs and the blobs:
// tar -czf "$ARCHIVE" -C "$DATA" \
//   --exclude=root.key --exclude=./root.key --exclude='*.lock' --exclude='*.tmp' .
```

**How it fails**

Destruction is a single-file edit: destroyMatterKey deletes the wrapped DEK from keyring.json and calls _save(). It does not delete matters/<id>.log or blobs/<id>/** (store.js:80 says so explicitly), and nothing prunes the backup set. backup.sh:60-61 excludes only root.key, so every nightly archive contains keyring.json *including that matter's still-wrapped DEK*, plus its sealed log and blobs; RETAIN defaults to 14 archives (backup.sh:22) and the footer at backup.sh:99-101 tells the firm to rsync/restic the directory off-site. restore.sh:199-200 untars an archive and installs the escrowed root.key. I reproduced the full resurrection: seal a fact and a blob into a matter, tar the data dir minus root.key, k.shred(m.id) (live store then reports SHREDDED), untar the archive into a new dir, copy root.key in — and `new Store(rest, new Keyring(rest))` returns `RESTORED fact: [{"text":"PRIVILEGED-BRAKES-SERVICED-LATE",...}]` and `RESTORED blob: PRIVILEGED-ATTACHMENT-BODY`. So an admin who runs the documented restore drill, or anyone who obtains one pre-shred archive plus the escrowed key, reads a matter for which the firm has already issued a certificate stating the content is gone "in the live store, every replica, and every backup" (26-closing.js:59) and "unreadable everywhere at once, including backups" (26-closing.js:116). Neither RUNBOOK.md nor OPERATIONS.md mentions backups anywhere near destruction — grep for shred/destroy across app/deploy and docs returns only rehearsal output lines.

**Fix**

Make destruction durable rather than advisory: (1) have Store.shredMatter unlink matters/<id>.log and rm -rf blobs/<id>/ after the DEK is destroyed, so a restored keyring cannot re-open ciphertext that no longer exists on the live box; and (2) add a destruction step that expires the backup set — either re-key the tenant KEK and re-seal on shred, or make backup.sh/RUNBOOK require pruning archives older than the earliest un-purged destruction and record that purge in the audit chain. Until one of these exists, soften 26-closing.js:59 and :116 to say destruction takes effect in the live store and that backups must be aged out.

## 4. Shredding a matter destroys only its DEK — the matter's prospective-client intake record, ledger memos and letters live in the firm scope under the tenant KEK and survive destruction, and room 01 still lists the destroyed client

**MEDIUM / CONFIRMED** — crypto-keylifecycle — `app/rooms/01-intake.js:14`

**Evidence**

```js
01-intake.js:14
    const inquiries = k.firm.list('inquiry').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

what that record holds (01-intake.js:90-94):
    k.firm.put('inquiry', {
      client, adverse: (ctx.body.adverse || '').split(',')...,
      jurisdiction: jur, claimType, discovered,
      summary: ctx.body.summary, limitation, ...

the summary field is the client's own account of the facts (01-intake.js:39 label: `Facts as told. Dates matter.`), and the inquiry is linked to the matter at 01-intake.js:121:
      k.firm.put('inquiry', { ...inq, status: 'accepted', matterId: m.id });

and shredding never touches the firm scope (store.js:77-80):
  shredMatter(matterId) {
    this._matterScopes.delete(matterId);
    this.keyring.destroyMatterKey(matterId);
    // The sealed log and blobs remain on disk but are unreadable forever.
  }
```

**How it fails**

The firm log is sealed under the tenant KEK, not the per-matter DEK, so destroying the DEK leaves every firm-scope record about that matter permanently readable to anyone holding root.key. Concretely surviving a destruction: `inquiry` including the free-text `summary` of what the client said (01-intake.js:90-94), every `ledgerTxn` including `memo` (api.js:75 — and this room's own CSV note at 28-books.js:199 calls memos and time narratives privileged disclosure), the non-engagement `letter` text (01-intake.js:146) and conflict-waiver `letter` text (02-conflicts.js:396), `party` and `conflictRun` screening records (02-conflicts.js:320, :294) and `engagementSigned` (03-retainer.js:214). 28-books.js:70-74 shows the authors know firm-log residue exists and filters shredded matters out of that room — but nothing filters `inquiry`: room 01's "Disposed inquiries" table (01-intake.js:51-58) calls k.firm.list('inquiry') with no isShredded check, so after destruction the destroyed client's name, claim type, jurisdiction and limitation date are still rendered on screen, with `accepted / matter opened` beside them. The certificate at 26-closing.js:59 tells the client their "records, documents and history are cryptographically unrecoverable"; they are not.

**Fix**

Two parts. (1) Filter the destroyed matter out of the firm-scope surfaces that still show it: in 01-intake.js:14, drop inquiries whose `matterId` satisfies `k.isShredded(...)`, the same belt-and-braces filter 28-books.js:76 already applies to ledger transactions. (2) For at-rest destruction, seal per-matter free text under the matter DEK rather than the tenant KEK — move `inquiry.summary` (and the matter-linked `letter.text`) into the matter scope at 01-intake.js:117-121 once the matter exists, keeping only the non-privileged index fields in the firm log — or amend the certificate text at 26-closing.js:59 to state exactly what survives destruction.

## 5. Login/2FA rate limiter keys on the reverse-proxy's socket address, so 21 anonymous requests lock the whole firm out of sign-in

**MEDIUM / CONFIRMED** — auth-session — `app/server.js:108`

**Evidence**

```js
server.js:108  const ip = req.socket.remoteAddress || '?';
server.js:115  const ip = req.socket.remoteAddress || '?';

kernel/auth.js:8   const RATE = { windowMs: 15 * 60 * 1000, max: 20 };
kernel/auth.js:24-30
  rateLimited(ip) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || now > h.resetAt) { this.hits.set(ip, { n: 1, resetAt: now + RATE.windowMs }); return false; }
    h.n++;
    return h.n > RATE.max;
  }
kernel/auth.js:38  if (this.rateLimited(ip)) { this.audit.log(String(email), 'login.ratelimited', ip); return null; }
kernel/auth.js:68  if (this.rateLimited(ip)) return null;

deploy/Caddyfile:  reverse_proxy 127.0.0.1:8028
```

**How it fails**

The shipped production deployment is Caddy terminating TLS and proxying to the app over loopback (deploy/Caddyfile: `reverse_proxy 127.0.0.1:8028`; server.js:291 binds CHAMBERS_HOST=127.0.0.1). The app never reads X-Forwarded-For anywhere (grep for x-forwarded across kernel/, rooms/, server.js returns nothing), so `req.socket.remoteAddress` is the literal string for 127.0.0.1 on every production request regardless of who sent it. The 20-per-15-minutes counter is therefore one single global bucket shared by the internet and by both seat-holders. Concrete attack: an unauthenticated caller sends 21 `POST /login` bodies with curl. No credentials needed; `POST /login` is in the PUBLIC set (server.js:39) and the origin check in kernel/http.js:66 is skipped entirely when the request carries no Origin and no Referer, which curl does not send. I verified the counter semantics in-process: `node -e` instantiating Auth with a stub store shows the 21st call to rateLimited('127.0.0.1') returns true, and after that `auth.login('dan@firm.ca','pw','127.0.0.1')` returns null and `auth.verifyTotp('x','123456','127.0.0.1')` returns null — i.e. both the password step and the second-factor step are refused before any credential is examined. Dan and Matt see only the generic /?d=1 'Access denied' page and cannot distinguish a lockout from a mistyped password. Because the fixed window restarts on the first request after resetAt, roughly 1.4 requests per minute sustains the outage indefinitely. Secondary amplifier: every blocked attempt still takes the audit lockfile and appends a `login.ratelimited` line (kernel/auth.js:38), so the same anonymous request stream grows the hash-chained audit.log without bound and serialises on an O_EXCL lock — the exact property server.js:60-63 deliberately refuses to grant unauthenticated callers on the ICS feed route. Existing in-memory sessions keep working, but after any restart (README: 'a restart signs everyone out, by design') the firm cannot get back in. README:180 documents this control as 'rate-limited to 20 attempts per IP per 15 minutes', which is not what the shipped topology delivers.

**Fix**

In server.js:108 and :115, derive the client address from the proxy hop rather than the socket: trust `X-Forwarded-For`'s right-most entry only when `req.socket.remoteAddress` is the loopback proxy, and fall back to the socket address otherwise. Independently, key the limiter on the submitted email as well as the address (e.g. bucket `ip + '|' + email`) so exhausting one identity's budget cannot deny sign-in to the other seat, and cap/omit the `login.ratelimited` audit write once a bucket is already blocked so an anonymous caller cannot grow the chained log without bound.

## 6. Enrollment token travels in the URL path, so every live invite is written verbatim into the TLS edge's access log and the systemd journal

**MEDIUM / CONFIRMED** — auth-password — `app/server.js:31`

**Evidence**

```js
for (const s2 of seats) console.log(`  ${s2.name} (${s2.role}):  http://localhost:${PORT}/invite/${s2.code}`);

// app/kernel/html.js:360 — the credential is also the form target:
<form method="POST" action="/invite/${esc(invite.code)}">

// app/deploy/Caddyfile:37-39 — every request URI is logged in front of the app:
	log {
		output file /var/log/caddy/chambers-access.log
		format json

// app/deploy/RUNBOOK.md:51 — retrieval from the journal is documented policy:
   Missed it? `sudo journalctl -u chambers | grep /invite/`
```

**How it fails**

createSeatInvites() mints a 7-day, single-use code that enrolls a full `admin` seat (auth.js:108, role comes from SEATS = 'Dan G:admin,Matt D:admin'). server.js:31 prints that code to stdout, which under deploy/chambers.service lands in the systemd journal; RUNBOOK.md:51 and install.sh:132 explicitly instruct the operator to recover it with `journalctl -u chambers | grep /invite/`. Independently, because the code is a PATH SEGMENT rather than a POST body field, the Caddy reverse proxy in front of the app logs it: `format json` emits `request.uri` in full, so `/var/log/caddy/chambers-access.log` contains `"uri":"/invite/<live-code>"` for both the GET of the enroll page and the POST that redeems it. Concrete sequence: Dan opens his seat link, hits the 'Password must be at least 12 characters' branch (auth.js:118) and walks away without completing enrollment — the invite is still `used:false`. Anyone who can read the Caddy access file or the journal (a different, non-`chambers` uid; root.key at crypto.js:29 is written 0o600 and is NOT readable by them) now replays `POST /invite/<code>` with their own email and password, redeemInvite() creates an active `admin` user, and auth.js:117 then answers the real partner with 'Seat lock: every seat in this build is already enrolled.' The attacker holds an admin seat over solicitor-client material and the legitimate seat-holder cannot enroll. There is no revocation path: grep shows no `del('invite', ...)` anywhere and /admin (server.js:220) only lists open invites, it cannot kill one.

**Fix**

Stop putting the secret in the URL and in stdout. Store `sha256(code)` on the invite record instead of `code`, serve the enroll page at a codeless path with the raw code carried in a POST body (or a short-lived HttpOnly cookie set by a one-shot redeem-start handler), and have server.js print only a fingerprint plus an out-of-band retrieval command rather than the code itself. Add an invite-revoke route on /admin (`firm.del('invite', id)`) so a leaked code can be killed before its 7 days elapse.

## 7. scrypt work factor (N=16384, r=8, p=1) is 5x below the weakest currently-recommended parameterisation, and the wrapped hashes sit in the same directory as the key that unwraps them

**MEDIUM / CONFIRMED** — auth-password — `app/kernel/crypto.js:80`

**Evidence**

```js
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32, SCRYPT);
```

**How it fails**

Measured on this host: `hashPassword` completes in ~48 ms (I timed it: `hash ms 48`). OWASP's current scrypt guidance is N=2^17,r=8,p=1, with the lowest accepted fallbacks being 2^14/r=8/p=5 — this build uses 2^14 with p=1, i.e. one fifth of the cheapest sanctioned setting. Salt (16 random bytes) and output length (32 bytes) are fine; only the cost is short. The reason this matters here rather than being theoretical: `root.key` and `firm.log` live in the SAME data directory (crypto.js:29 `path.join(dataDir,'root.key')`, store.js:62 `path.join(dataDir,'firm.log')`), so any single filesystem-level exfiltration or a mis-scoped snapshot of /var/lib/chambers yields both the wrapping key and the sealed user records. deploy/backup.sh deliberately excludes root.key, but a VM snapshot, a stolen disk, or `cp -a /var/lib/chambers` does not. Once both are held, the tenant KEK opens firm.log, the two `pw` strings fall out in plaintext form, and the KDF cost is the only thing standing between the attacker and both partners' passwords — which are also the first factor for accounts where 2FA is optional and self-disableable (server.js:192). At 16 MiB/hash scrypt still resists GPU parallelism well, so this is a cost shortfall rather than an immediate break, hence MEDIUM not HIGH.

**Fix**

Raise to `const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }` (the default 32 MB maxmem will otherwise reject 128 MiB), version the prefix as `s3$`, keep `verifyPassword` able to read `s2$` records, and re-hash on next successful login. Note the DUMMY constant must be regenerated with the same parameters so the unknown-account path stays time-equal.

## 8. Login throttling and login audit attribution both key on req.socket.remoteAddress, which is 127.0.0.1 for every real user behind the shipped reverse proxy

**MEDIUM / CONFIRMED** — auth-password — `app/server.js:108`

**Evidence**

```js
const ip = req.socket.remoteAddress || '?';
  const out = auth.login(ctx.body.email || '', ctx.body.password || '', ip);

// app/kernel/auth.js:24-30
  rateLimited(ip) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || now > h.resetAt) { this.hits.set(ip, { n: 1, resetAt: now + RATE.windowMs }); return false; }
    h.n++;
    return h.n > RATE.max;
  }

// app/deploy/Caddyfile:13
	reverse_proxy 127.0.0.1:8028
```

**How it fails**

The shipped deployment terminates TLS in Caddy and proxies to 127.0.0.1:8028 (Caddyfile:13; server.js:291 binds `CHAMBERS_HOST || '127.0.0.1'`). Caddy sets X-Forwarded-For, but nothing in the app reads it — grep for 'x-forwarded' across app/ returns zero hits; the only IP source is `req.socket.remoteAddress`. Therefore every browser request, from every client on the internet, presents the same key `'127.0.0.1'` to `this.hits`. Two consequences, both reachable by an unauthenticated remote caller. (1) Mutual lockout: 21 `POST /login` requests from anywhere on the internet push the single shared bucket past RATE.max=20, and `login()` then returns null at auth.js:38 for BOTH partners for the full 15-minute window — repeat every 15 minutes and the firm can never sign in. There is no per-account bucket and no allowance for a correct password to bypass the counter. (2) Audit attribution: every `login.ok`, `login.denied`, `login.await2fa` and `login.ratelimited` entry records the object field as `127.0.0.1` (auth.js:38,43,47,50). For a hash-chained audit log whose stated purpose is 'every login... lands here' (server.js:241), the chain records who and when but never from where, so a credential-stuffing campaign and the partner's own morning sign-in are indistinguishable in the record.

**Fix**

In server.js:108 and :115 derive the client address from the rightmost untrusted hop of `req.headers['x-forwarded-for']` ONLY when `req.socket.remoteAddress` is a configured trusted-proxy address (127.0.0.1/::1), falling back to the socket address otherwise, and add a second per-account counter in `rateLimited` keyed on the normalised email so one hostile source cannot exhaust the shared bucket.

## 9. The rate-limited branch of login() still writes an audit entry containing the unbounded attacker-supplied email, giving an unauthenticated caller unlimited growth of the hash-chained audit log

**MEDIUM / CONFIRMED** — auth-password — `app/kernel/auth.js:38`

**Evidence**

```js
login(email, password, ip) {
    if (this.rateLimited(ip)) { this.audit.log(String(email), 'login.ratelimited', ip); return null; }

// app/kernel/audit.js:60-66 — every call re-reads the WHOLE file under a lockfile
  log(actor, action, object) {
    this._acquireLock();
    try {
      this._syncPrev();
      const entry = { ts: new Date().toISOString(), actor, action, object, prev: this.prev };
      entry.hash = sha256(this.prev + JSON.stringify([entry.ts, actor, action, object]));
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');

// app/kernel/audit.js:27 — _syncPrev reads the entire log, synchronously
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
```

**How it fails**

`POST /login` is in the PUBLIC set (server.js:39) and the origin check in http.js:66 is skipped entirely when a client sends neither Origin nor Referer, so a plain curl reaches it. `ctx.body.email` is bounded only by MAX_BODY = 25 MB (http.js:8, matched by Caddy's `request_body max_size 25MB`), is never length-checked, and is passed straight to `this.audit.log(String(email), ...)`. The rate limiter is supposed to be the brake, but the rate-limited branch performs the single most expensive operation in the codebase before returning: it takes an O_EXCL lockfile, reads and splits the ENTIRE audit.log synchronously (audit.js:27), appends, and unlinks. So exceeding the limit costs the attacker nothing and costs the server strictly more than a normal login. Sequence: send `POST /login` with `email=<25 MB of 'A'>` in a loop. Requests 1-20 also burn ~48 ms of blocking scryptSync each; every request from 21 onward appends another ~25 MB JSON line, and every subsequent append re-reads the whole file — quadratic. Within a few hundred requests audit.log is multiple GB on a 1 GB / 25 GB VM, `_syncPrev` blocks the single Node event loop for seconds at a time, /healthz stops answering, and the tamper-evident chain that /admin renders (server.js:209 `auditTrail().verify()`, which also walks every line) becomes unusable. Nothing prunes or caps it and the log is append-only by design. Note the contrast with server.js:62, which states as a rule that 'an unauthenticated caller must never be able to grow the hash-chained audit log' — the login path violates exactly that rule.

**Fix**

Truncate the actor before it reaches the chain — `this.audit.log(String(email).slice(0, 254), ...)` at auth.js:38 and :43 — and drop the audit write on the rate-limited branch entirely (or emit one 'login.ratelimited' entry per IP per window, keyed off the `hits` record, rather than one per request). Separately, replace `_syncPrev`'s full-file read with a tail read so audit.log cost stops being O(n) per append.

## 10. Keyring mints a fresh root key whenever root.key is absent, with no first-boot marker and no fail-closed check — a data directory that has lost its key files is silently re-keyed and, in one case, re-initialised as a virgin firm while the old matter logs are orphaned

**MEDIUM / PLAUSIBLE** — crypto-keylifecycle — `app/kernel/crypto.js:32`

**Evidence**

```js
crypto.js:31-45
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.rootPath)) {
      fs.writeFileSync(this.rootPath, crypto.randomBytes(32), { mode: 0o600 });
    }
    this.root = fs.readFileSync(this.rootPath);
    if (this.root.length !== 32) throw new Error('root key corrupt');
    if (fs.existsSync(this.ringPath)) {
      this.ring = JSON.parse(fs.readFileSync(this.ringPath, 'utf8'));
    } else {
      this.ring = { tenant: null, matters: {}, destroyed: {} };
    }
    if (!this.ring.tenant) {
      this.ring.tenant = seal(this.root, crypto.randomBytes(32), 'tenant').toString('base64');
      this._save();
    }
```

**How it fails**

There is no marker anywhere that says "this store has been initialised", so absence of root.key is indistinguishable from first boot. I exercised the three loss cases against the real Keyring: (A) root.key deleted, keyring.json + logs kept -> a NEW random root.key is written to disk first, then the constructor dies with the opaque `Unsupported state or unable to authenticate data`; the box is left carrying a plausible-looking 32-byte root.key that is not the firm's, and nothing in the error names the cause or tells the operator to restore the escrow copy. (B) keyring.json deleted -> same opaque throw. Those two fail loudly, so they do not orphan a live store. (C) root.key, keyring.json and firm.log all absent while matters/*.log and blobs/** are still present — reachable through a hand-rolled copy/rsync of the data directory, a partially-completed manual restore, or an operator "resetting" the app by deleting what look like state files — the constructor silently mints a new root key AND a new tenant KEK, writes a fresh keyring.json, `new Store` builds an empty firm log, and server.js:28-33 prints FIRST BOOT seat invites. My run printed `Keyring+Store constructed OK. users=0 matters=0`, `matterScope -> NOKEY no key for matter`, `matters/ still on disk: 5548b36e-...log`. Every surviving matter log and blob is orphaned forever, with no warning and no error, and the operator sees what looks like a clean install.

**Fix**

Fail closed instead of minting. In the Keyring constructor, only create root.key when the data directory contains no store at all — i.e. guard the write at crypto.js:32-34 with a check that neither keyring.json, firm.log, matters/ nor blobs/ exists, and otherwise throw a named error (`root key missing from <dataDir> — restore the escrowed copy; refusing to generate a new one`). Create it with `flag: 'wx'` so the create is atomic, and drop a `.initialised` marker at the same time so a later absence of root.key is always diagnosed as loss rather than first boot.

## 11. Sessions have an idle timeout but no absolute lifetime — resolve() extends expiry unconditionally on every request

**LOW / CONFIRMED** — auth-session — `app/kernel/auth.js:90`

**Evidence**

```js
kernel/auth.js:80-93
  createSession(uid) {
    const t = token(32);
    this.sessions.set(sha256(t), { uid, exp: Date.now() + SESSION_TTL });
    return t;
  }
  resolve(t) {
    if (!t) return null;
    const s = this.sessions.get(sha256(t));
    if (!s) return null;
    if (Date.now() > s.exp) { this.sessions.delete(sha256(t)); return null; }
    s.exp = Date.now() + SESSION_TTL; // sliding
    const user = this.store.firm.get('user', s.uid);
    return user && user.active ? user : null;
  }
```

**How it fails**

The session record carries only `exp`; no issuance timestamp is stored, so nothing can ever cap total lifetime. Every call to resolve() — which runs in makeCtx (server.js:83) for every non-public request, and again in the `GET /` handler (server.js:103) — pushes exp another 8 hours out. A token captured once (an unlocked laptop, a forensic heap dump of the node process, a backup of a swapped-out page) authenticates forever so long as it is used at least once per 8 hours, and there is no server-side event other than an explicit `POST /logout` or a process restart that will ever retire it. Deactivating the seat-holder does bound the damage (line 92 re-checks `user.active` per request), but nothing in the codebase deactivates a user — /admin renders the active/disabled column (server.js:213) but ships no deactivation route — so in practice an operator's only revocation lever for a stolen live token is restarting the service. For a two-seat firm holding solicitor-client material, a credential with unbounded lifetime and no per-user revocation is a weaker posture than the 8h the /account page advertises (server.js:170: 'Session policy', '8h sliding · HttpOnly · SameSite=Strict').

**Fix**

Record `iat: Date.now()` in the object stored by createSession (kernel/auth.js:82), and in resolve() refuse and delete the session when `Date.now() - s.iat > ABSOLUTE_TTL` (e.g. 12h) before applying the sliding extension on line 90. Optionally index sessions by uid so an operator can drop every session for one seat without restarting the process.

## 12. Enabling or disabling 2FA needs neither the password nor a fresh session, and does not rotate the session id

**LOW / CONFIRMED** — auth-session — `app/server.js:179`

**Evidence**

```js
server.js:176-181
app.route('POST', '/account/totp-start', (req, res, ctx) => {
  const u = ctx.kernel.firm.get('user', ctx.user.id);
  if (u.totp) { ctx.setFlash('2FA is already enabled.', 'err'); redirect(res, '/account'); return; }
  ctx.kernel.firm.put('user', { ...u, pendingTotp: totpKit.genSecret() });
  redirect(res, '/account');
});

server.js:187
  ctx.kernel.firm.put('user', { ...u, totp: u.pendingTotp, pendingTotp: null, totpLastStep: enrollStep });
```

**How it fails**

The only gate on /account/totp-start and /account/totp-confirm is possession of the session cookie — no password re-entry, and no `auth.createSession` call anywhere in the /account handlers, so the session id that existed before the account gained a second factor is the same one that exists after. Anyone holding a live session for a seat that has not yet enrolled 2FA (the state every seat is in immediately after enrollment — server.js:139 flashes 'Next: enable two-factor authentication below') can bind their own authenticator secret to that account by POSTing totp-start then totp-confirm. From then on the legitimate seat-holder cannot sign in without the attacker's device, and the attacker's stolen session token is never invalidated by the privilege change it just caused. The mirror route /account/totp-disable (server.js:192-201) does demand a current code but likewise never asks for the password and never rotates the session. This is not remotely reachable — it requires an already-stolen session, and HttpOnly + Secure + SameSite=Strict + the nonce CSP make browser-side theft hard — so the realistic vector is an unattended signed-in laptop, which for a two-lawyer office is the credible one. I am marking the code defect CONFIRMED and the impact bounded by that precondition.

**Fix**

Require the account password in the bodies of /account/totp-start, /account/totp-confirm and /account/totp-disable and verify it with `verifyPassword` before mutating the user record, and mint a replacement session (`auth.logout(ctx.cookies.s); const t = auth.createSession(ctx.user.id)`) with a fresh `cookie('s', t, …)` on the redirect out of /account/totp-confirm and /account/totp-disable, so the authenticator change rotates the session id.

## 13. server.js keeps raw session tokens alive forever as flash-map keys, defeating auth.js's deliberate hash-only session storage

**LOW / CONFIRMED** — auth-session — `app/server.js:35`

**Evidence**

```js
server.js:35-37
const flashes = new Map(); // one-shot flash messages keyed by session cookie
function setFlash(req, msg, kind) { const t = (req._cookies || {}).s; if (t) flashes.set(t, { msg, kind }); }
function takeFlash(req) { const t = (req._cookies || {}).s; const f = flashes.get(t); flashes.delete(t); return f; }

server.js:138-139
  const t = auth.createSession(out.user.id);
  flashes.set(t, { msg: 'Enrolled. Next: enable two-factor authentication below — it takes thirty seconds.', kind: '' });

(contrast) kernel/auth.js:20  this.sessions = new Map(); // sha256(token) -> {uid, exp}
kernel/auth.js:94  logout(t) { if (t) this.sessions.delete(sha256(t)); }
```

**How it fails**

Auth deliberately never retains a usable session token: sessions and pending are both keyed by sha256(token) (auth.js:20-21, 82, 87), so a heap dump of the process yields hashes, not credentials. The flash map undoes that. `setFlash` stores the raw cookie value as the Map key, and nothing ever removes it except a matching `takeFlash` on a later request from the same browser — `auth.logout` (auth.js:94) and the expiry branch in `resolve` (auth.js:89) both delete from `auth.sessions` and know nothing about `flashes`. So a flash set on the last request before the user signs out, or before the session idles out, pins that raw token in process memory for the lifetime of the server. Concretely: server.js:138-139 writes the brand-new post-enrolment token into `flashes` verbatim; if the enrollee never loads /account, that token sits in the map indefinitely. The result is a growing set of plaintext session strings — some for still-live sessions — reachable from any heap snapshot, core dump or swapped page, which is precisely the exposure the sha256 keying in auth.js was written to avoid. Not remotely triggerable on its own; it is an amplifier that converts a memory-disclosure incident into working credentials.

**Fix**

Key `flashes` on `sha256(token)` the same way Auth does (require sha256 from kernel/crypto.js and hash in both setFlash and takeFlash), and delete the corresponding entry inside the POST /logout handler (server.js:123-126) alongside `auth.logout`, so no raw token and no orphaned entry outlives its session.

## 14. There is no password change or recovery path anywhere in the application

**LOW / CONFIRMED** — auth-password — `app/kernel/auth.js:126`

**Evidence**

```js
email: userEmail, name: inv.name || userEmail, role: inv.role, active: true, pw: hashPassword(password),
    }, 'invite');
```

**How it fails**

`hashPassword` has exactly one call site in application code — auth.js:126, inside `redeemInvite`. (The only other occurrences are tools/seed-demo.js and test fixtures.) The /account page (server.js:150-201) offers TOTP enrollment, confirmation and disable, and nothing else; there is no POST route matching /password, /account/password, or any equivalent. Consequence for the real threat model: if a partner's password is shoulder-surfed, phished, or typed into the wrong window, it can never be rotated. Re-enrolling is also impossible — `createInvite` refuses at auth.js:96 (`activeCount() >= seatCap()`) and `redeemInvite` refuses at auth.js:117 once both seats are filled, and there is no route to deactivate a user, so the seat cannot be freed and re-issued either. The only remediation available is hand-editing the encrypted event log or destroying the data directory. Not a break on its own, hence LOW, but it removes the standard response to a suspected credential compromise on a system holding privileged material.

**Fix**

Add `POST /account/password` requiring the current password through `verifyPassword` (plus a current TOTP code when `u.totp` is set), writing `pw: hashPassword(newPassword)` under the same 12-character floor, invalidating every other session for that uid in `auth.sessions`, and emitting a `user.password.changed` audit line.

## 15. Non-seat invite redemption skips the email format and uniqueness checks the seat path performs; an invite minted without an email field persists a user whose email is undefined and permanently breaks every login

**LOW / CONFIRMED** — auth-password — `app/kernel/auth.js:119`

**Evidence**

```js
let userEmail = inv.email;
    if (inv.seat) {
      userEmail = String(email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userEmail)) return { error: 'Enter a valid email — it becomes your sign-in.' };
      if (this.userByEmail(userEmail)) return { error: 'That email is already enrolled.' };
    }

// app/kernel/auth.js:35 — the unguarded consumer
    return this.store.firm.list('user', (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.active)[0];
```

**How it fails**

Both validations live inside `if (inv.seat)`, so an admin-minted invite (server.js:246 `POST /admin/invite` -> auth.js:95 `createInvite`) is redeemed with `userEmail = inv.email` and no checks at all. `createInvite` never validates or coerces its `email` argument — only tools/invite.js does, and the HTTP route does not. A direct `curl -X POST /admin/invite -d 'role=lawyer'` (no email field; the HTML form's `required` attribute is client-side only) stores an invite with `email: undefined`. Redeeming it while a seat is still free creates a user record with `email: undefined` and `name: undefined`. From that instant, `userByEmail` at auth.js:35 evaluates `u.email.toLowerCase()` over every active user and throws `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` on the FIRST login attempt, which propagates out of `auth.login`, out of the POST /login handler, and is caught by http.js:77 as a bare 500. Every subsequent sign-in by either partner 500s. The bad record is in an append-only, AES-GCM-sealed event log with no delete route and no admin UI to fix it, and existing sessions survive only until the next restart (sessions are in-memory, server.js:171). Requires an admin to issue the malformed request, so there is no privilege gain — but it is an unrecoverable, self-inflicted lockout that one missing coercion would prevent, and it is the same missing check that lets an admin invite duplicate a live account's email.

**Fix**

Move the format test and the `userByEmail` duplicate check out of the `if (inv.seat)` block so they run for every invite, and coerce at mint time in `createInvite`: reject unless `/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))`. Harden `userByEmail` to `String(u.email || '').toLowerCase()` so a malformed record can never take down authentication for everyone.

## 16. open() has no length guard, so a truncated blob is authenticated against a truncated GCM tag (Node accepts 4–15-byte tags)

**LOW / PLAUSIBLE** — crypto-envelope — `app/kernel/crypto.js:19`

**Evidence**

```js
function open(key, blob, aad) {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ct = blob.subarray(28);
  const d = crypto.createDecipheriv(ALG, key, iv);
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
```

**How it fails**

`tag` is whatever bytes happen to exist between offsets 12 and 28 — Buffer.subarray silently clamps, so a blob shorter than 28 bytes yields a tag of 4..15 bytes and an empty ciphertext, and open() never checks blob.length. createDecipheriv is called without an authTagLength option, and I verified on this box (node v22.22.2) that Node then accepts a short tag and verifies only the bytes supplied: setAuthTag(tag.subarray(0,4)) decrypted successfully. So the forgery bar for a record on disk drops from 2^128 to as low as 2^32. Concretely: an attacker with write access to the data directory truncates blobs/<matter>/<id> to 16 bytes; if the 4 remaining bytes verify (2^32 online attempts against k.blob.get), open() returns an empty Buffer and 13-review renders the document as blank text rather than raising a tamper error. I could not demonstrate a practical exploit — 2^32 online oracle calls is not realistic, the forged plaintext is necessarily empty so no confidentiality is lost, and anyone with data-directory write access already has root.key sitting beside it. Reporting it because tag truncation was in scope and the guard is genuinely absent, not because I can reach it.

**Fix**

Add an explicit length and tag-width check at the top of open(): `if (!Buffer.isBuffer(blob) || blob.length < 28) throw new Error('sealed blob truncated');` and pin the width by constructing the decipher as `crypto.createDecipheriv(ALG, key, iv, { authTagLength: 16 })`, so a short tag is rejected by Node rather than accepted as a prefix.

## 17. Destroying a matter DEK drops the cache entry but never zeroes the key bytes: the plaintext DEK, the tenant KEK and the root key stay resident in the process heap after a shred

**LOW / PLAUSIBLE** — crypto-keylifecycle — `app/kernel/crypto.js:73`

**Evidence**

```js
crypto.js:63-66
    if (!this._dekCache.has(matterId)) {
      this._dekCache.set(matterId, open(this.tenantKey, Buffer.from(wrapped, 'base64'), 'matter:' + matterId));
    }
    return this._dekCache.get(matterId);
crypto.js:73
    this._dekCache.delete(matterId);

and the same key Buffer is held a second time by the cached Scope (store.js:9-13 `this.key = key`), released only by a Map delete at store.js:78:
    this._matterScopes.delete(matterId);

No `.fill(0)` exists anywhere in the kernel (grep for fill(0) in crypto.js and store.js returns nothing). this.root (crypto.js:35) and this.tenantKey (crypto.js:46) live for the whole process lifetime.
```

**How it fails**

Shredding only removes two Map references; the 32 plaintext DEK bytes remain in the V8 heap until a garbage collection happens to reclaim and reuse those pages, which for a service running `Restart=always` (chambers.service:20) can be days. Meanwhile the matter's ciphertext is deliberately left on disk (store.js:80). Anything that captures process memory in that window — a core dump (chambers.service sets no LimitCORE=0 and no CoredumpFilter, so systemd-coredump will write one on a crash), a swap page, a heap snapshot taken for debugging — yields a working DEK for a matter the firm has certified destroyed, together with the ciphertext needed to use it. Marked PLAUSIBLE because it needs an attacker or investigator with access to that memory image, which on a hardened single-tenant box is root; it is nonetheless the difference between a shred and a certified shred.

**Fix**

Zero before dropping: in destroyMatterKey (crypto.js:68-75), fetch the cached Buffer and call `.fill(0)` on it before `this._dekCache.delete(matterId)`, and have Store.shredMatter (store.js:77) do the same to the cached Scope's `key` before deleting the scope — both references point at the same Buffer, so one wipe is enough but wiping via whichever holder still exists is what makes it reliable. Add `LimitCORE=0` to chambers.service so a crash cannot spill the tenant KEK either.

## 18. Shredding rewrites keyring.json by rename-over, leaving the previous copy — which still contains the destroyed matter's wrapped DEK — in unallocated blocks on the data volume

**LOW / PLAUSIBLE** — crypto-keylifecycle — `app/kernel/crypto.js:50`

**Evidence**

```js
crypto.js:49-53
  _save() {
    const tmp = this.ringPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.ring, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.ringPath);
  }
```

**How it fails**

renameSync replaces the directory entry; the old keyring.json inode is unlinked and its data blocks are returned to the free list without being overwritten. Every _save() since the matter was created (one per createMatterKey, crypto.js:57) has left another such copy behind, each containing that matter's DEK sealed under the tenant KEK. After a shred the matter's ciphertext is deliberately still on disk (store.js:80) and root.key is on the same volume by design (docs/OPERATIONS.md:72), so anyone able to carve free space on the data volume — forensic imaging of a decommissioned disk, a snapshot of the VM's block device, an SSD where TRIM has not run — recovers a wrapped DEK that root.key opens, and with it the matter the firm certified destroyed. Marked PLAUSIBLE because it requires raw block access rather than filesystem access.

**Fix**

In destroyMatterKey's save path, overwrite the existing keyring.json in place before writing the new ring — open the current file, write random bytes over its full length, fsync, then perform the tmp+rename — so the block that held the wrapped DEK is overwritten rather than merely unlinked. Note in RUNBOOK.md that on a copy-on-write or flash-translated volume even that is best-effort, and that full-volume encryption is what actually bounds this.

## 19. A matter is committed to the firm log before its DEK is minted, and neither write is fsynced — a crash or ENOSPC in that window leaves a permanently keyless matter that the app reports as neither live nor shredded

**LOW / PLAUSIBLE** — crypto-keylifecycle — `app/kernel/store.js:73`

**Evidence**

```js
store.js:72-76
  createMatter(meta, by) {
    const rec = this.firm.put('matter', meta, by);
    this.keyring.createMatterKey(rec.id);
    return rec;
  }

Neither side is durable at the point of return: Scope._append uses `fs.appendFileSync(this.file, line + '\n')` (store.js:33) with no fsync, and _save does writeFileSync + renameSync with no fsync of either the file or the directory (crypto.js:51-52).
```

**How it fails**

The matter row lands in the append-only firm.log first; the DEK is written to keyring.json second. A power loss, an OOM kill, or ENOSPC on keyring.json.tmp between the two leaves a matter that exists forever in the firm log with no key. keyring.matterKey then throws NOKEY (crypto.js:62) rather than SHREDDED, so k.isShredded is false: room 26 offers no certificate of destruction, room 01 shows the inquiry as `accepted / matter opened`, and every cross-matter walker swallows the throw as "walled or shredded — skip" (28-books.js:416). The matter reads as an empty live file rather than an error, and nothing in the codebase ever retries createMatterKey, so the state is unrecoverable — an opened file that silently accepts nothing. Marked PLAUSIBLE because it needs a crash inside a narrow window, but the append-only design makes the result permanent when it happens.

**Fix**

Mint the key first: in store.js:72-76 call `this.keyring.createMatterKey(id)` for a pre-generated id and only then `this.firm.put('matter', {...meta, id})`, so a failure leaves an unreferenced key rather than a keyless matter. Additionally fsync in Keyring._save (fsync the tmp fd before renameSync, then fsync the directory) so an acknowledged matter creation is durable.
