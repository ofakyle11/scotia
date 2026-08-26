# Chambers security audit — findings

Report-only Opus-5 auditors, each required to attempt to REFUTE every candidate
before reporting it; anything not demonstrable is marked PLAUSIBLE rather than
CONFIRMED. Auditors discarded 150 candidates this way.

**59 findings** (42 CONFIRMED) across 12 domains: crypto-envelope, crypto-keylifecycle, auth-session, auth-password, authz-walls, auth-totp, authz-roles, audit-chain, money-billing-trust, store-integrity, deadline-rules, external-apis.

| # | Sev | Conf | Domain | Finding | Location |
|---|-----|------|--------|---------|----------|
| 1 | HIGH | CONFIRMED | crypto-keylifecycle | Crypto-shredding is defeated by the firm's own retained backups: a "destroyed" matter is fully recoverable in plaintext from any pre-shred archive plus the escrowed root key | `app/deploy/backup.sh:60` |
| 2 | HIGH | CONFIRMED | authz-walls | /admin ethical-walls table renders the title of every walled matter to the very user the wall screens off | `app/server.js:223` |
| 3 | HIGH | CONFIRMED | authz-roles | GET /admin renders the title, client and screening basis of every matter behind an ethical wall — including to the very admin the wall screens | `app/server.js:223` |
| 4 | HIGH | CONFIRMED | audit-chain | Audit chain is unkeyed and unanchored: tail truncation (and whole-chain rewrite) verifies as intact | `app/kernel/audit.js:79` |
| 5 | HIGH | CONFIRMED | audit-chain | Unauthenticated caller controls the content and the volume of the tamper-evident log via POST /login; ~21 requests permanently disable it | `app/kernel/auth.js:38` |
| 6 | HIGH | CONFIRMED | audit-chain | State changes are committed before their audit entry, so any audit-write failure yields a persisted but unlogged mutation | `app/kernel/api.js:41` |
| 7 | HIGH | CONFIRMED | money-billing-trust | ledger.post's double-entry invariant does not hold for non-finite amounts — Infinity passes the balance check and poisons every trust control | `app/kernel/api.js:70` |
| 8 | HIGH | CONFIRMED | money-billing-trust | Trust receipt accepts a non-finite amount, permanently defeating the By-Law 9 s.7 overdraw gate for that matter | `app/rooms/28-books.js:330` |
| 9 | HIGH | CONFIRMED | deadline-rules | Trial cascade rolls backward-counted deadlines FORWARD, shortening the statutory lead time before trial | `app/kernel/rules.js:89` |
| 10 | HIGH | CONFIRMED | external-apis | Model gateway follows HTTP redirects, so privileged draft text is re-POSTed to any host the configured endpoint names — unaudited | `app/kernel/ai.js:15` |
| 11 | MEDIUM | CONFIRMED | crypto-envelope | Crypto-shred does not reach the matter's identity or its financial narrative: title, client, adverse parties, litigation theory and every ledger memo survive destruction under the tenant KEK | `app/kernel/store.js:77` |
| 12 | MEDIUM | CONFIRMED | crypto-envelope | "Cryptographically irreversible" destruction is reversible from any pre-shred backup: destroyMatterKey only rewrites keyring.json, while the sealed matter log and blobs are left on disk and every nightly archive carries the wrapped DEK | `app/kernel/crypto.js:68` |
| 13 | MEDIUM | CONFIRMED | crypto-keylifecycle | Shredding a matter destroys only its DEK — the matter's prospective-client intake record, ledger memos and letters live in the firm scope under the tenant KEK and survive destruction, and room 01 still lists the destroyed client | `app/rooms/01-intake.js:14` |
| 14 | MEDIUM | CONFIRMED | auth-session | Login/2FA rate limiter keys on the reverse-proxy's socket address, so 21 anonymous requests lock the whole firm out of sign-in | `app/server.js:108` |
| 15 | MEDIUM | CONFIRMED | auth-password | Enrollment token travels in the URL path, so every live invite is written verbatim into the TLS edge's access log and the systemd journal | `app/server.js:31` |
| 16 | MEDIUM | CONFIRMED | auth-password | scrypt work factor (N=16384, r=8, p=1) is 5x below the weakest currently-recommended parameterisation, and the wrapped hashes sit in the same directory as the key that unwraps them | `app/kernel/crypto.js:80` |
| 17 | MEDIUM | CONFIRMED | auth-password | Login throttling and login audit attribution both key on req.socket.remoteAddress, which is 127.0.0.1 for every real user behind the shipped reverse proxy | `app/server.js:108` |
| 18 | MEDIUM | CONFIRMED | auth-password | The rate-limited branch of login() still writes an audit entry containing the unbounded attacker-supplied email, giving an unauthenticated caller unlimited growth of the hash-chained audit log | `app/kernel/auth.js:38` |
| 19 | MEDIUM | CONFIRMED | authz-walls | Stored three-way reconciliation legs are computed over the recorder's matter set and re-displayed to walled users without re-filtering | `app/rooms/28-books.js:243` |
| 20 | MEDIUM | CONFIRMED | auth-totp | POST /account/totp-disable is guarded by a 6-digit code with no rate limit, no lockout and no audit of failures — the second factor can be brute-forced off an account in ~10 minutes, silently | `app/server.js:195` |
| 21 | MEDIUM | CONFIRMED | authz-roles | Any authenticated seat, including a clerk, can lift a matter's model-use prohibition with a single POST — every sibling confidentiality control is admin-only | `app/rooms/19-moot.js:186` |
| 22 | MEDIUM | CONFIRMED | audit-chain | Matter free-text is written into the plaintext audit log, where it survives crypto-shredding and travels in backups | `app/rooms/10-pleadings.js:391` |
| 23 | MEDIUM | CONFIRMED | money-billing-trust | Settlement gross accepts a non-finite figure and stages it into the trust account | `app/rooms/24-waterfall.js:70` |
| 24 | MEDIUM | CONFIRMED | money-billing-trust | Trust overdraw gate compares against a half-up-rounded balance, so a sub-cent position can be paid out in full | `app/kernel/trust.js:44` |
| 25 | MEDIUM | CONFIRMED | money-billing-trust | Closing gate on the trust balance is one-sided — an overdrawn matter closes and can then be shredded | `app/rooms/26-closing.js:167` |
| 26 | MEDIUM | CONFIRMED | store-integrity | Log append is neither atomic nor durable, and one unreadable line permanently bricks the whole scope (firm.log kills the app) | `app/kernel/store.js:33` |
| 27 | MEDIUM | CONFIRMED | store-integrity | No cross-process coordination or reload of store logs: the shipped console tool writes an enrollment invite the running server cannot see, which then goes live on the next restart | `app/kernel/store.js:16` |
| 28 | MEDIUM | CONFIRMED | deadline-rules | Holiday tables cover 2026 only, so every deadline outside 2026 is computed as if no court holiday exists — and the limitation weekend/holiday flag is holiday-blind by construction | `app/kernel/rules.js:62` |
| 29 | MEDIUM | CONFIRMED | deadline-rules | The limitation weekend/holiday warning is a one-shot flash and is never persisted or shown on either diary; the primary limitation bar written at intake never gets it at all | `app/rooms/21-calendar.js:232` |
| 30 | MEDIUM | CONFIRMED | deadline-rules | Deadlines flagged stale by a governing-law change are invisible on both diaries and can still receive the dual-diary tick, certifying a date computed under a rulebook that no longer governs | `app/rooms/27-desk.js:103` |
| 31 | MEDIUM | CONFIRMED | external-apis | CanLII connector reports a 200 with an unparseable body as a successful fetch with data:null, producing a false "resolved" citation and permanently poisoning the firm-wide cache | `app/kernel/canlii.js:56` |
| 32 | MEDIUM | CONFIRMED | external-apis | cite-resolve reports resolved:true for a CanLII response that carries no case data, echoing the caller's own citation back as the "resolved" title | `app/kernel/cite-resolve.js:61` |
| 33 | MEDIUM | CONFIRMED | external-apis | Rooms 30 and 31 make outbound third-party requests carrying operator-supplied query text with no audit entry at all | `app/rooms/30-uscourts.js:26` |
| 34 | MEDIUM | PLAUSIBLE | crypto-keylifecycle | Keyring mints a fresh root key whenever root.key is absent, with no first-boot marker and no fail-closed check — a data directory that has lost its key files is silently re-keyed and, in one case, re-initialised as a virgin firm while the old matter logs are orphaned | `app/kernel/crypto.js:32` |
| 35 | MEDIUM | PLAUSIBLE | auth-totp | The login second factor has no per-account or per-pending-token attempt limit — a wrong code neither retires the pending token nor costs the account anything, only the shared per-IP bucket | `app/kernel/auth.js:72` |
| 36 | MEDIUM | PLAUSIBLE | audit-chain | _releaseLock() unlinks whatever lockfile exists, not the one it owns, so a broken stale lock lets two writers share one tail | `app/kernel/audit.js:59` |
| 37 | MEDIUM | PLAUSIBLE | audit-chain | A single malformed line makes the audit module throw instead of reporting tampering, and prevents the server from booting | `app/kernel/audit.js:19` |
| 38 | MEDIUM | PLAUSIBLE | money-billing-trust | Trust-to-operating fee transfer is authorised by a free-text string, with no check that any invoice was issued for the amount | `app/rooms/28-books.js:348` |
| 39 | MEDIUM | PLAUSIBLE | store-integrity | Scope.get/list hand out live references into the committed projection; put only shallow-copies, so stored records can be edited with no event, no updatedAt/updatedBy and no audit line | `app/kernel/store.js:38` |
| 40 | MEDIUM | PLAUSIBLE | deadline-rules | An unverified limitation bar can be cleared from the firm-wide dual-diary control single-handedly via /r/calendar/done, with no second person and no limitation-specific audit action | `app/rooms/21-calendar.js:274` |
| 41 | MEDIUM | PLAUSIBLE | external-apis | CourtListener result URLs are built by string-concatenating the attacker-influenced absolute_url onto the base origin, defeating the room's http(s) allowlist | `app/kernel/uscourts.js:37` |
| 42 | LOW | CONFIRMED | auth-session | Sessions have an idle timeout but no absolute lifetime — resolve() extends expiry unconditionally on every request | `app/kernel/auth.js:90` |
| 43 | LOW | CONFIRMED | auth-session | Enabling or disabling 2FA needs neither the password nor a fresh session, and does not rotate the session id | `app/server.js:179` |
| 44 | LOW | CONFIRMED | auth-session | server.js keeps raw session tokens alive forever as flash-map keys, defeating auth.js's deliberate hash-only session storage | `app/server.js:35` |
| 45 | LOW | CONFIRMED | auth-password | There is no password change or recovery path anywhere in the application | `app/kernel/auth.js:126` |
| 46 | LOW | CONFIRMED | auth-password | Non-seat invite redemption skips the email format and uniqueness checks the seat path performs; an invite minted without an email field persists a user whose email is undefined and permanently breaks every login | `app/kernel/auth.js:119` |
| 47 | LOW | CONFIRMED | authz-walls | Conflict-check note leaks the firm-wide matter count, including matters the viewer is walled from | `app/rooms/02-conflicts.js:133` |
| 48 | LOW | CONFIRMED | audit-chain | audit.log is created world-readable (0644) although it is the one plaintext file in the data directory | `app/kernel/audit.js:66` |
| 49 | LOW | CONFIRMED | store-integrity | Sealed logs and blobs are created with the process umask while key material is deliberately 0600 | `app/kernel/store.js:88` |
| 50 | LOW | CONFIRMED | external-apis | uscourts.search dereferences out.data unconditionally, so a 200 with a non-JSON body crashes the room with an HTTP 500 | `app/kernel/uscourts.js:32` |
| 51 | LOW | PLAUSIBLE | crypto-envelope | open() has no length guard, so a truncated blob is authenticated against a truncated GCM tag (Node accepts 4–15-byte tags) | `app/kernel/crypto.js:19` |
| 52 | LOW | PLAUSIBLE | crypto-keylifecycle | Destroying a matter DEK drops the cache entry but never zeroes the key bytes: the plaintext DEK, the tenant KEK and the root key stay resident in the process heap after a shred | `app/kernel/crypto.js:73` |
| 53 | LOW | PLAUSIBLE | crypto-keylifecycle | Shredding rewrites keyring.json by rename-over, leaving the previous copy — which still contains the destroyed matter's wrapped DEK — in unallocated blocks on the data volume | `app/kernel/crypto.js:50` |
| 54 | LOW | PLAUSIBLE | crypto-keylifecycle | A matter is committed to the firm log before its DEK is minted, and neither write is fsynced — a crash or ENOSPC in that window leaves a permanently keyless matter that the app reports as neither live nor shredded | `app/kernel/store.js:73` |
| 55 | LOW | PLAUSIBLE | authz-walls | POST /r/conflicts/party accepts an arbitrary matter id with no wall check, unlike its sibling /run handler | `app/rooms/02-conflicts.js:317` |
| 56 | LOW | PLAUSIBLE | authz-walls | kernel facade's ai.chat and ai.policy read a matter record with the raw firm getter, bypassing walledFrom | `app/kernel/api.js:119` |
| 57 | LOW | PLAUSIBLE | money-billing-trust | The recorded s.18 three-way comparison is computed over a wall-narrowed ledger and does not say so | `app/rooms/28-books.js:376` |
| 58 | LOW | PLAUSIBLE | store-integrity | matterId is interpolated into filesystem paths with no shape validation (blob id is validated, matter id is not) | `app/kernel/store.js:68` |
| 59 | LOW | PLAUSIBLE | external-apis | No response-size cap on any of the four connectors: a hostile or misconfigured endpoint can stream an unbounded body into the single-process heap | `app/kernel/ai.js:19` |

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

## 2. /admin ethical-walls table renders the title of every walled matter to the very user the wall screens off

**HIGH / CONFIRMED** — authz-walls — `app/server.js:223`

**Evidence**

```js
${walls.length ? ui.table(['Matter', 'Screened', 'Basis'], walls.map((w) => { const m = ctx.kernel.firm.get('matter', w.matterId); return [ui.esc(m ? m.title : w.matterId), ui.esc((w.screened || []).map((id) => { const u = ctx.kernel.firm.get('user', id); return u ? u.name : id; }).join(', ')), ui.esc(w.basis || '')]; })) : ui.empty('No walls configured.')}
```

**How it fails**

1. Seats default to BOTH being administrators — kernel/auth.js:12: `const SEATS = (process.env.CHAMBERS_SEATS || 'Dan G:admin,Matt D:admin')`. So the screened lawyer is himself an admin and passes the only gate on this route (server.js:205 `if (!ctx.kernel.isAdmin())`).
2. Dan (admin) raises a wall screening Matt off matter X via POST /admin/wall (server.js:264), storing `{matterId: X, screened:[matt.id], basis}` in FIRM scope.
3. Matt signs in and GETs /admin. server.js:208 does `ctx.kernel.firm.list('wall')` — `k.firm.list` is the RAW firm projection (kernel/api.js:46) and applies no `walledFrom()` filter at all.
4. Line 223 then resolves each wall row's matter with `ctx.kernel.firm.get('matter', w.matterId)` — again the raw firm getter, NOT `k.matter(id)` (kernel/api.js:25-29) which is the wall-checked accessor. Matt's page renders `m.title` for matter X.
5. Matter titles are minted as `${inq.client} — ${inq.claimType}` (rooms/01-intake.js:118), so Matt reads the client's identity and the nature of the claim he is ethically screened from, plus the free-text `basis` (e.g. 'prior retainer at former firm'). That is precisely the disclosure a screen exists to prevent, and rooms/02-conflicts.js:27-32 states the opposite invariant for the same data: 'a conflict check must never read a walled matter's identity — title, client, adverse parties — back to the very user the wall screens off.'
Refutation attempted: the wall-RAISING form two lines below (server.js:225) uses `ctx.matters` (wall-filtered by makeCtx), proving the file already knows the distinction — the listing table is the one place that skipped it. The 'admins must administer walls' defence fails here because the threat model states the wall must hold against an authenticated seat-holder, and in the shipped default configuration the screened seat-holder IS an admin.

**Fix**

In server.js:208-223, resolve wall rows through the wall-aware accessor and suppress identity the viewer is screened from: build `const visible = new Set(ctx.matters.map((m) => m.id));` and render the Matter cell as `visible.has(w.matterId) ? ui.esc((ctx.kernel.firm.get('matter', w.matterId)||{}).title || w.matterId) : ui.tag('screened from you','gate')`, also blanking `w.basis` for those rows. Equivalently, use `ctx.kernel.matter(w.matterId)` (which returns null + audits 'wall.denied' for a screened matter) instead of `ctx.kernel.firm.get('matter', …)`.

## 3. GET /admin renders the title, client and screening basis of every matter behind an ethical wall — including to the very admin the wall screens

**HIGH / CONFIRMED** — authz-roles — `app/server.js:223`

**Evidence**

```js
server.js:208  const walls = ctx.kernel.firm.list('wall');
server.js:223  ${walls.length ? ui.table(['Matter', 'Screened', 'Basis'], walls.map((w) => { const m = ctx.kernel.firm.get('matter', w.matterId); return [ui.esc(m ? m.title : w.matterId), ui.esc((w.screened || []).map((id) => { const u = ctx.kernel.firm.get('user', id); return u ? u.name : id; }).join(', ')), ui.esc(w.basis || '')]; })) : ui.empty('No walls configured.')}

contrast, two lines below, the form on the SAME card, which correctly uses the wall-filtered list:
server.js:225  ${ui.select('matterId', 'Matter', ctx.matters.map((m) => [m.id, m.title]), ctx.matter && ctx.matter.id)}

and the kernel primitive this bypasses:
api.js:25-29  function matter(id) { if (!id) return null; if (walledFrom(id)) { audit.log(user.id, 'wall.denied', id); return null; } return store.firm.get('matter', id) || null; }
```

**How it fails**

1. Both shipped seats are administrators (`kernel/auth.js:12` — `'Dan G:admin,Matt D:admin'`), so the person a wall screens is necessarily an admin and `/admin` is open to them. 2. Matt raises a wall at POST /admin/wall screening Dan from matter 'Beta Holdings — hostile takeover defence', basis 'Dan acted for Beta at his former firm'. 3. Every other read path holds: I confirmed `k.matter(secret.id)` returns `null` for Dan, `k.matters()` omits it, forcing the `m` cookie to the walled id leaves /r/closing and /r/calendar showing nothing of it, and POST /r/desk/verify with the walled matterId in the body is refused. 4. Dan then loads GET /admin. `firm.list('wall')` is unfiltered and each row resolves `firm.get('matter', w.matterId)` — the raw store getter, not `kernel.matter()` — so the page renders the matter title, the screened names and the free-text basis. Reproduced end to end over real HTTP against the unmodified server: `/admin status 200 | leaks walled title: true | leaks basis: true`, in the same run where `k.matter(secret) = null` and `k.matters() titles = [ 'Ordinary Matter' ]`. The screen exists precisely to keep the existence and identity of that client and the conflict's nature from that lawyer (LSO r. 3.4); the basis field routinely names the adverse party and the prior retainer. The wall does not hold against the seat-holder it screens.

**Fix**

Filter the wall table through the same wall the rest of the kernel uses. In server.js:223 resolve the matter with `ctx.kernel.matter(w.matterId)` instead of `ctx.kernel.firm.get('matter', w.matterId)`, and render a row whose matter resolves to `null` as an opaque placeholder — screened-out, no title, no basis, no screened names — e.g. `const m = ctx.kernel.matter(w.matterId); if (!m) return ['<span class="note">screened from you</span>', '', ''];`. Equivalently, pre-filter at server.js:208: `const walls = ctx.kernel.firm.list('wall', (w) => !!ctx.kernel.matter(w.matterId));`. Note `kernel.matter()` also writes the `wall.denied` audit line, which the current path silently skips.

## 4. Audit chain is unkeyed and unanchored: tail truncation (and whole-chain rewrite) verifies as intact

**HIGH / CONFIRMED** — audit-chain — `app/kernel/audit.js:79`

**Evidence**

```js
verify() {
    if (!fs.existsSync(this.file)) return { ok: true, entries: 0 };
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
    let prev = 'genesis';
    for (let i = 0; i < lines.length; i++) {
      const e = JSON.parse(lines[i]);
      const expect = sha256(prev + JSON.stringify([e.ts, e.actor, e.action, e.object]));
      if (e.prev !== prev || e.hash !== expect) return { ok: false, at: i + 1, entries: lines.length };
      prev = e.hash;
    }
    return { ok: true, entries: lines.length };
  }

// and the construction, line 65:
      entry.hash = sha256(this.prev + JSON.stringify([entry.ts, actor, action, object]));
```

**How it fails**

verify() re-derives the whole chain from the constant literal 'genesis' using an UNKEYED sha256, and compares it only against values stored inside audit.log itself. Nothing outside the file records the expected tip hash or the expected entry count. Two consequences, both trivially reachable by the actor the hash chain exists to defend against (anyone with write access to $CHAMBERS_DATA/audit.log — a seat-holder with shell on the box, a backup/restore operator, or anyone who obtains the backup archive, which deploy/backup.sh documents as 'All ciphertext except the audit chain'):
(1) TRUNCATION, no crypto required: `head -n -20 data/audit.log > t && mv t data/audit.log`. Every surviving line still satisfies `e.prev === prev` and `e.hash === expect`, so verify() returns {ok:true, entries:n-20}. /admin (server.js:240) renders `intact` and /r/desk (27-desk.js:164) renders the `Audit chain — N entries` stat with no way to know N shrank. A lawyer removes the last 20 lines covering a wall.denied, a matter.exported, or a billing.issue and the log certifies itself as intact.
(2) FULL REWRITE: because sha256 takes no secret, an editor can change or delete ANY entry anywhere and then recompute `prev`/`hash` forward over the remaining lines with ~15 lines of code, reusing the exact expression on line 65. verify() then returns ok:true. The only tamper the current design detects is one where the attacker edits a line and forgets to recompute the tail — which is precisely and only what test/audit.test.js:23-25 exercises ('e.object = FORGED' with no re-chaining), so the gate gives false assurance.
The in-memory tip that the constructor computes at line 19 would have caught (1) against a running server, but _syncPrev() (lines 25-29) unconditionally overwrites this.prev from the file's current tail before every append, so after a truncation the live server silently re-chains from the truncated tail and the seam is gone forever.

**Fix**

Two changes, both required. (a) Make the chain keyed so it cannot be recomputed by a file-level attacker: replace sha256(prev + …) at line 65 and line 79 with crypto.createHmac('sha256', chainKey) where chainKey is derived from the tenant KEK in kernel/crypto.js (e.g. an HKDF of keyring.tenantKey labelled 'audit-chain'), which lives in root.key/keyring.json at mode 0600 and is excluded from backups. (b) Anchor the tip outside the log: persist {tip, count} after every append into keyring.json (sealed, via Keyring._save) or a separate 0600 tip file, and have verify() fail unless lines.length === storedCount && prev === storedTip. Also make _syncPrev() refuse to proceed when the file tail no longer chains from the remembered this.prev, instead of silently adopting it.

## 5. Unauthenticated caller controls the content and the volume of the tamper-evident log via POST /login; ~21 requests permanently disable it

**HIGH / CONFIRMED** — audit-chain — `app/kernel/auth.js:38`

**Evidence**

```js
login(email, password, ip) {
    if (this.rateLimited(ip)) { this.audit.log(String(email), 'login.ratelimited', ip); return null; }
    const user = this.userByEmail(email);
    const ok = verifyPassword(password, user ? user.pw : undefined);
    if (!user || !ok) { this.audit.log(String(email), 'login.denied', ip); return null; }
```

**How it fails**

POST /login is in server.js:39 PUBLIC, and http.js:57-70 only runs the same-origin check when an Origin/Referer header is present, so a bare `curl` (no Origin) is admitted. deploy/Caddyfile reverse-proxies the site root to 127.0.0.1:8028 with `request_body max_size 25MB`, matching MAX_BODY in http.js:8. So an anonymous internet caller can POST a 25 MB `email` field; String(email) is written verbatim and untruncated into the `actor` field of an audit entry. The per-IP limiter does not help: the rateLimited() branch on line 38 writes its OWN audit line with the same unbounded email, so every request past the cap still appends. This breaks the invariant the project states for itself in docs/CONTRACT-SHEET.md:1102 ('an unauthenticated caller must not be able to grow the hash-chained log').
Two distinct impacts:
(a) PERMANENT DENIAL OF THE AUDIT CHAIN AND OF THE APP. ~21 such requests push audit.log past V8's max string length (~512 MiB). Every audit read path uses fs.readFileSync(this.file, 'utf8'): the constructor (line 18), _syncPrev (line 27), verify (line 75) and tail (line 87). All then throw ERR_STRING_TOO_LONG. Result: the server cannot boot at all (new Audit(DATA) at server.js:22 throws before app.listen), /admin and /r/desk 500 on k.auditTrail().verify(), and every mutating request 500s because api.js calls audit.log after the store write. There is no rotation, no cap and no admin repair path; the only remedy is to truncate audit.log by hand, which per finding #1 is itself undetectable. Long before 512 MB, the O(n) full-file re-read that _syncPrev does on EVERY append makes each write and every /r/desk page load quadratically expensive.
(b) ATTRIBUTION FORGERY. The `actor` column is elsewhere an authenticated user id (kernel/api.js:137 binds user.id), and 26-closing.js:49 consumes it as one: `const u = k.firm.get('user', e.actor)`. An anonymous caller chooses this value freely, so entries whose actor is an arbitrary string — including a known user id or 'system' (the value auth.js:109 uses) — can be planted in the chain from outside, and the chain's own hashes then certify them as authentic.

**Fix**

Never write unauthenticated attacker text into the chain. In auth.js:38 and :43 log a non-identifying, bounded value — e.g. this.audit.log('anon', 'login.denied', ip) with the submitted address recorded only as sha256(email).slice(0,16), and never on the rate-limited branch (drop that log entirely, or fold it into one entry per IP per window). Independently, cap the entry size in Audit.log (reject or truncate any actor/action/object over a few hundred bytes) and stop re-reading the whole file per append: keep the tip in memory and re-open the file only on the verified-anchor check from finding #1.

## 6. State changes are committed before their audit entry, so any audit-write failure yields a persisted but unlogged mutation

**HIGH / CONFIRMED** — audit-chain — `app/kernel/api.js:41`

**Evidence**

```js
put: (type, obj) => { const r = s.put(type, obj, user.id); audit.log(user.id, `${type}.put`, matterId + ':' + r.id); return r; },
      del: (type, id) => { s.del(type, id, user.id); audit.log(user.id, `${type}.del`, matterId + ':' + id); },

// same ordering at api.js:50-53 (firm scope) and api.js:140 (blob.put), 149 (matter.shredded)
```

**How it fails**

store.Scope.put/_append (store.js:31-35) does fs.appendFileSync on the sealed matter/firm log and is durable the instant it returns. Only afterwards is audit.log called. Audit.log has several failure modes that throw: _acquireLock throws 'audit: could not acquire audit.log lock' after LOCK_WAIT_MS (audit.js:55); _syncPrev throws on ENOSPC/EACCES/ERR_STRING_TOO_LONG or on a malformed tail line; appendFileSync throws on a full disk. The throw propagates out of the room handler to http.js:77-82, which answers 500 — but the record is already written. The user's change stands with NO line in the tamper-evident log.
This is remotely inducible, and the setup step needs no account: use finding #2 to grow audit.log past ~512 MiB, after which fs.readFileSync(...,'utf8') in _syncPrev throws on every call. From that moment every seat-holder write (documents, ledger posts, wall-relevant reads, blob uploads, matter.shredded at api.js:149) persists unlogged. A screened or self-interested seat-holder can also reach it with far less effort if they can drop a file at $CHAMBERS_DATA/audit.log.lock: _acquireLock then times out for 10 s at a time and every mutation in that window commits unaudited.
The codebase already knows the correct discipline and states it for the network path only — api.js:183-185: 'The audit fires BEFORE the request, so a failure to record fails closed — no unlogged call to a third party.' The store path does the opposite.

**Fix**

Invert the order in kernel/api.js so the audit write fails closed for state changes too: write the audit entry first (it can carry the id, which store.put already lets you pre-generate with crypto.randomUUID), and only call store.put/del/putBlob/shredMatter if audit.log returned. Where an id must come from the store, wrap the pair so an audit failure triggers a compensating del, or move both appends under one lock and a single commit point.

## 7. ledger.post's double-entry invariant does not hold for non-finite amounts — Infinity passes the balance check and poisons every trust control

**HIGH / CONFIRMED** — money-billing-trust — `app/kernel/api.js:70`

**Evidence**

```js
dr += Math.round((l.dr || 0) * 100); cr += Math.round((l.cr || 0) * 100);
...
      if (dr !== cr) throw new Error('ledger: unbalanced (dr ' + dr + ' != cr ' + cr + ')');
      if (dr === 0) throw new Error('ledger: zero-value transaction');
```

**How it fails**

ledger.post is the single choke point every money movement passes through, and it never tests that a line amount is finite. Math.round(Infinity*100) === Infinity, and `Infinity !== Infinity` is false, so the unbalanced check passes; `dr === 0` is false, so the zero-value check passes. Any value >= ~1.8e306 also overflows to Infinity in the cents conversion even though it is finite. Verified: `node -e` on the exact expressions gives dr=Infinity, cr=Infinity, unbalanced=false, zero=false. Reachable from four rooms that hand raw form numbers straight in: 28-books.js:334 (/retainer, dr trust:bank), 24-waterfall.js:93 (/stage, dr trust:bank), 34-billing.js:339 (/disb) and 34-billing.js:454 (/issue). Once such a line is stored, kernel/trust.js round2()/cents() both return Infinity, so wouldNotOverdraw() returns true for every amount (see finding 2), threeWayCheck() returns ok:false forever (Math.abs(Infinity-Infinity) is NaN), and 28-books' CSV handoff to the accountant prints "Infinity" in the dr column (28-books.js:433). Worse, the value is durable-asymmetric: Scope._append seals JSON.stringify(ev) — JSON.stringify({dr:Infinity}) is {"dr":null} — but then calls _apply(ev) with the live object (store.js:31-35), so the running process sees Infinity while the on-disk log replays as 0. Every withdrawal made against the phantom balance survives the restart; the deposit does not.

**Fix**

In kernel/api.js ledger.post, coerce and validate each line before summing: reject unless Number.isFinite(l.dr||0) && Number.isFinite(l.cr||0) and both are within a sane maximum (e.g. |cents| <= Number.MAX_SAFE_INTEGER), and store the rounded-to-cents value rather than the raw float. This is the one place that fixes all four rooms at once.

## 8. Trust receipt accepts a non-finite amount, permanently defeating the By-Law 9 s.7 overdraw gate for that matter

**HIGH / CONFIRMED** — money-billing-trust — `app/rooms/28-books.js:330`

**Evidence**

```js
const amt = Number(ctx.body.amount);
    if (!(amt > 0)) { ctx.setFlash('Enter a positive amount.', 'err'); redirect(res, '/r/books'); return; }
    ctx.kernel.ledger.post(ctx.matter.id, {
      memo: ctx.body.memo || 'Retainer received', kind: 'trust-receipt',
      lines: [{ account: 'trust:bank', dr: amt }, { account: 'trust:client', cr: amt }],
```

**How it fails**

`!(amt > 0)` is the ONLY validation. Number('1e999') === Infinity, and Infinity > 0, so it passes (a JSON body posts the same value literally). 03-retainer.js:293 already uses the correct `Number.isFinite(rate) && rate > 0` shape, so this omission is an inconsistency, not a house style. Step by step: a seat-holder POSTs amount=1e999 to /r/books/retainer for matter M. ledger.post accepts it (finding 1), so M's ledger now reads trust:bank = Infinity, trust:client = -Infinity. kernel/trust.js:35 perMatterTrustBalance returns round2(Infinity) = Infinity; kernel/trust.js:44 wouldNotOverdraw then computes cents(amt) <= cents(Infinity), which is true for EVERY finite amount — verified: cents(999999) <= cents(Infinity) === true. The s.7 gate at 28-books.js:353 is therefore permanently open on that matter. The same actor now POSTs /r/books/transfer with feeAmount=500000 and any non-empty invoiceRef; the gate passes and the ledger posts dr trust:client / cr trust:bank / dr operating:bank / cr operating:income:fees — half a million dollars of pooled client trust money moved into the firm's fee income with no invoice behind it. On the next restart the Infinity receipt replays from disk as dr:null → 0 (store.js:31-35, JSON.stringify drops it), so the matter's trust:bank settles at -500000: a real trust overdraft funded by other clients' money in the pooled account, exactly what By-Law 9 s.7 forbids. The audit chain records only 'ledger.post <matter>:<txn>:trust-receipt' with no amount (api.js:76), so the phantom deposit leaves no legible trace. Note the three-way comparison does flag ok:false, but only after the money is gone.

**Fix**

At rooms/28-books.js:330 replace `const amt = Number(ctx.body.amount); if (!(amt > 0))` with a finite, bounded, cent-rounded parse — e.g. `const amt = Number(ctx.body.amount); if (!Number.isFinite(amt) || amt <= 0 || amt > 1e12) refuse;` then post `r2(amt)` rather than the raw float. Apply the identical change to the /transfer handler at line 343.

## 9. Trial cascade rolls backward-counted deadlines FORWARD, shortening the statutory lead time before trial

**HIGH / CONFIRMED** — deadline-rules — `app/kernel/rules.js:89`

**Evidence**

```js
// kernel/rules.js:87-90
  } else {
    d.setUTCDate(d.getUTCDate() + rule.days);
    if (!limitation) while (!isBusinessDay(d, rule.jur)) d.setUTCDate(d.getUTCDate() + 1);
  }

// rooms/21-calendar.js:75-80 — the caller that feeds it a NEGATIVE offset
function computeCascade(k, jur, trialDate) {
  return pretrialTemplate(jur).map((m) => {
    const synth = { id: 'trial-back-' + m.key, jur, category: 'procedural', method: 'calendar', days: -m.before };
    return { ...m, due: k.rules.compute(synth, trialDate) };
  });
}
```

**How it fails**

compute() only ever rolls in one direction (+1 day) because it was written for forward-counted deadlines. 21-calendar's cascade reuses it with days: -90 / -60 / -45 / -30 to back-calculate from the trial date, so when the back-computed day lands on a weekend or holiday the roll moves the milestone LATER — i.e. closer to trial — instead of earlier. Verified by executing the real code: trial date 2026-06-05 -> raw trial-minus-90 is 2026-03-07 (Saturday) -> compute() returns 2026-03-09, which is only 88 days before trial. Trial 2026-06-06 -> 2026-03-09, 89 days. Trial 2026-09-14 -> pretrial-conference raw 2026-08-15 (Saturday) -> computed 2026-08-17, only 28 days before trial. For a us-fed matter those two milestones are the rule-cited ones (PRETRIAL_TEMPLATE['us-fed'] marks expert-disclosure firm:false, cite 'FRCP 26(a)(2)(D)(i)', and pretrial-conference firm:false, cite 'FRCP 16(e) / pretrial disclosures FRCP 26(a)(3)(B)'), and 21-calendar.js:154 renders them with tag('rule','ok') rather than 'firm default'. FRCP 26(a)(2)(D)(i) requires disclosure 'at least 90 days before' trial and FRCP 26(a)(3)(B) 'at least 30 days before'; FRCP 6(a)(5) states that for a period measured BEFORE an event the 'next day' is found by counting BACKWARD, so the correct roll is to the preceding business day. The engine therefore emits a date the cited rule makes untimely, writes it as a real 'deadline' record (21-calendar.js:262-267), and it then appears on the firm diary (27-desk) and the ICS phone feed as an authoritative rule-derived date. 21-calendar.js:156 affirmatively tells counsel the roll is correct: 'Offsets roll off weekends/holidays to the next business day via the same procedural rule engine as forward deadlines.' An expert disclosure served 88 days before trial is untimely and exposed to exclusion under FRCP 37(c)(1).

**Fix**

Make the roll direction follow the count direction. In kernel/rules.js compute(), replace the unconditional forward roll with a signed step: `const step = rule.days < 0 ? -1 : 1; if (!limitation) while (!isBusinessDay(d, rule.jur)) d.setUTCDate(d.getUTCDate() + step);` (and apply the same sign to the `method === 'business'` loop at line 86, which currently also only counts forward). This makes a backward-counted milestone land on the preceding business day, preserving the 'at least N days before' guarantee.

## 10. Model gateway follows HTTP redirects, so privileged draft text is re-POSTed to any host the configured endpoint names — unaudited

**HIGH / CONFIRMED** — external-apis — `app/kernel/ai.js:15`

**Evidence**

```js
const r = await fetch(String(cfg.endpoint).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal, headers,
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: maxTokens, temperature }),
    });
```

**How it fails**

No `redirect` option is passed, so undici's default `redirect: 'follow'` applies. On a 307/308 the fetch spec preserves method AND body while stripping only Authorization/Cookie cross-origin. I proved this end to end with a local reproduction: a gateway replying `307 Location: http://other-host/steal` caused the full body `{"model":"m","messages":[{"role":"user","content":"PRIVILEGED DRAFT TEXT"}]}` to be delivered to the redirect target, and `chat()` still returned `{ok:true,...}` with no indication the content had left the configured host. rooms/19-moot.js:203-206 feeds `sections.slice(0, 24000)` — the matter's own draft argument, solicitor-client privileged — into this call. kernel/api.js:132 audits only `audit.log(user.id, 'ai.call', (matterId || 'firm') + ':' + cfg.model)`, i.e. the model name, never the host actually contacted, so the exfiltration leaves no trace in the hash-chained audit log and `matter.aiPolicy` is checked only at the door. The precondition is that the configured endpoint issues a redirect — either because it was compromised/DNS-hijacked, or benignly (a hosted OpenAI-compatible proxy relocating a route), which ai.js:3-5 explicitly contemplates ("a hosted model where the engagement permits").

**Fix**

Pass `redirect: 'error'` (or 'manual') in the fetch options at kernel/ai.js:15 so the gateway refuses to follow any hop off the administrator-approved endpoint, and include the resolved request host in the `ai.call` audit line at kernel/api.js:132.

## 11. Crypto-shred does not reach the matter's identity or its financial narrative: title, client, adverse parties, litigation theory and every ledger memo survive destruction under the tenant KEK

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

## 12. "Cryptographically irreversible" destruction is reversible from any pre-shred backup: destroyMatterKey only rewrites keyring.json, while the sealed matter log and blobs are left on disk and every nightly archive carries the wrapped DEK

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

## 13. Shredding a matter destroys only its DEK — the matter's prospective-client intake record, ledger memos and letters live in the firm scope under the tenant KEK and survive destruction, and room 01 still lists the destroyed client

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

## 14. Login/2FA rate limiter keys on the reverse-proxy's socket address, so 21 anonymous requests lock the whole firm out of sign-in

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

## 15. Enrollment token travels in the URL path, so every live invite is written verbatim into the TLS edge's access log and the systemd journal

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

## 16. scrypt work factor (N=16384, r=8, p=1) is 5x below the weakest currently-recommended parameterisation, and the wrapped hashes sit in the same directory as the key that unwraps them

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

## 17. Login throttling and login audit attribution both key on req.socket.remoteAddress, which is 127.0.0.1 for every real user behind the shipped reverse proxy

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

## 18. The rate-limited branch of login() still writes an audit entry containing the unbounded attacker-supplied email, giving an unauthenticated caller unlimited growth of the hash-chained audit log

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

## 19. Stored three-way reconciliation legs are computed over the recorder's matter set and re-displayed to walled users without re-filtering

**MEDIUM / CONFIRMED** — authz-walls — `app/rooms/28-books.js:243`

**Evidence**

```js
${recons.length ? table(['Statement date', 'Bank', 'Ledger', 'Liabilities', 'Result', 'By'], recons.map((r) => [
      date(r.statementDate), rcell(money(r.statementBalance)), rcell(money(r.ledger)), rcell(money(r.liabilities)),
      r.ok ? tag('RECONCILED', 'ok') : tag('OUT OF BALANCE', 'gate'), esc(r.byName || ''),
    ])) : empty(…)}
```

**How it fails**

1. POST /r/books/reconcile (28-books.js:375) computes the legs with `threeWay(ctx, k, stmt)`, which narrows the ledger to the RECORDING user's visible matters via `trustView(ctx,k)` -> `visibleBalances` -> `visibleTxns` (28-books.js:75-78, 103-119). Dan, screened off nothing, records legs that include walled matter X's trust:bank and trust:client legs.
2. Those figures are persisted verbatim into FIRM scope at 28-books.js:376-379 (`k.firm.put('reconciliation', {…ledger, liabilities…})`) — firm scope carries no wall filter (kernel/api.js:46).
3. Matt, screened off matter X, opens /r/books. Line 222 reads `k.firm.list('reconciliation')` unfiltered and line 243 prints Dan's `r.ledger` and `r.liabilities` as-is.
4. The same page's live legs (lines 207-231, via `visibleBalances`) are correctly narrowed to Matt's matters. Subtracting the live figure from the recorded figure yields the exact dollar amount held in trust for the matter(s) Matt is walled off — and in a two-matter firm that is matter X's balance to the cent. kernel/api.js:79-84 names this exact leak as the reason ledger reads are wall-filtered: 'otherwise a screened user could read a hidden matter's trust balances … via Trust & Books or its CSV exports.'
Refutation attempted: every other cross-matter read in this room (visibleTxns, liabRows at line 218-221, both CSV exports at 414/427) IS filtered, so this is an omission rather than a deliberate firm-level disclosure; and the stored record is not a bank statement figure alone — `ledger` and `liabilities` are derived from per-matter ledger legs.

**Fix**

Do not display persisted legs computed under someone else's visibility. Either recompute the comparison for the current viewer at render time (`threeWay(ctx, k, r.statementBalance)`) and show the stored `ok`/`byName` as history only, or stamp each reconciliation with the matter-id set it covered and suppress the Ledger/Liabilities cells for a viewer whose `ctx.matters` does not cover that set.

## 20. POST /account/totp-disable is guarded by a 6-digit code with no rate limit, no lockout and no audit of failures — the second factor can be brute-forced off an account in ~10 minutes, silently

**MEDIUM / CONFIRMED** — auth-totp — `app/server.js:195`

**Evidence**

```js
app/server.js:192-201
app.route('POST', '/account/totp-disable', (req, res, ctx) => {
  const u = ctx.kernel.firm.get('user', ctx.user.id);
  if (!u.totp) { ctx.setFlash('2FA is not enabled.', 'err'); redirect(res, '/account'); return; }
  if (!auth.consumeTotp(u.id, ctx.body.code)) { ctx.setFlash('That code did not verify.', 'err'); redirect(res, '/account'); return; }

and the silent-failure branch it calls, app/kernel/auth.js:55-59:
  consumeTotp(userId, code2) {
    const user = this.store.firm.get('user', userId);
    if (!user || !user.active || !user.totp) return false;
    const step = totp.matchStep(user.totp, code2);
    if (step === null) return false;

contrast the login-side second factor, app/kernel/auth.js:67-68, which IS throttled:
  verifyTotp(pendingToken, code2, ip) {
    if (this.rateLimited(ip)) return null;
```

**How it fails**

Preconditions: a live session cookie for a 2FA-enrolled seat and no authenticator device (the unattended-laptop / exfiltrated-cookie case the codebase itself treats as the realistic one for a two-lawyer office). Steps: (1) POST /account/totp-disable repeatedly with code=000000, 000001, ... Unlike POST /login/totp, this handler never calls auth.rateLimited, so no counter is touched, and consumeTotp returns false at auth.js:59 for a wrong code without writing any audit line. (2) Measured on the real server (app.listen + makeCtx, tmp data dir): 300 wrong-code POSTs completed in 510 ms (~590 req/s), every one returned 303 and was evaluated, auth.hits was still empty ([] — the rate limiter was never consulted), and the 301st request carrying the genuine code succeeded, leaving user.totp = null. With ~3 codes accepted per instant out of 10^6, the expected 333k guesses take ~9.4 minutes at that rate. (3) Aftermath: the audit chain for that user contains exactly two lines — 'user.2fa.disabled' and 'firm.user.put' — indistinguishable from the seat-holder voluntarily turning 2FA off; the 333k failed guesses leave no trace at all in a hash-chained log whose stated purpose (server.js:241) is that 'every login, read denial, key event and ledger post lands here'. (4) The attacker can then bind their own authenticator via POST /account/totp-start + /account/totp-confirm (server.js:176-191, likewise unthrottled and unaudited on failure), so the legitimate seat-holder's own codes stop working at the next sign-in and only the OPERATIONS.md 'Case A' offline reset restores the account. Note the effect is not remotely reachable without a session — makeCtx (server.js:83-89) 303s every non-PUBLIC route lacking one — which is why this is MEDIUM and not higher.

**Fix**

In the /account/totp-disable handler (server.js:195) and /account/totp-confirm (server.js:186), gate the code check behind the same throttle the login path uses — `if (auth.rateLimited(req.socket.remoteAddress || '?')) { ...refuse... }` before calling consumeTotp/matchStep — and add an audit line on the failure branch (e.g. ctx.kernel.audit('user.2fa.disable.denied', ctx.user.id)), so a guessing run is both bounded and visible. Better still, move the counter into consumeTotp itself keyed on userId (a per-account failure count on the user record, reset on success, refusing after N) so every TOTP verification sink inherits the limit instead of each caller having to remember it.

## 21. Any authenticated seat, including a clerk, can lift a matter's model-use prohibition with a single POST — every sibling confidentiality control is admin-only

**MEDIUM / CONFIRMED** — authz-roles — `app/rooms/19-moot.js:186`

**Evidence**

```js
19-moot.js:181  app.route('POST', `/r/${ROOM.id}/ai-policy`, (req, res, ctx) => {
19-moot.js:182    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
19-moot.js:184    const m2 = k.firm.get('matter', ctx.matter.id);
19-moot.js:186    const policy = ctx.body.policy === 'forbidden' ? 'forbidden' : 'allowed';
19-moot.js:187    k.firm.put('matter', { ...m2, aiPolicy: policy });

the only place that value is ever enforced:
api.js:127-130  if ((m.aiPolicy || 'allowed') === 'forbidden') { audit.log(user.id, 'ai.denied.policy', matterId); return { ok: false, message: 'Model use is forbidden on this matter by its data-handling policy.' }; }

every sibling control on the same surface:
server.js:254  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }        // POST /admin/ai — the gateway itself
29-canlii.js:15  if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); ...  // connector credential
30-uscourts.js:12 if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); ...
31-edgar.js:21   if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); ...
26-closing.js:177 if (!k.isAdmin()) { ctx.setFlash('Only an administrator performs destruction.', 'err'); ...
26-closing.js:192 if (!k.isAdmin()) { ctx.setFlash('Transfer export is an administrator function.', 'err'); ...
```

**How it fails**

1. An admin configures the gateway at POST /admin/ai (admin-gated) with a remote OpenAI-compatible endpoint and API key. 2. A matter whose engagement forbids AI processing carries `aiPolicy: 'forbidden'`, the single flag `k.ai.chat` consults before any model call (api.js:127). 3. A clerk — the role the app elsewhere explicitly treats as lower-trust ('A clerk cannot sign a filing', 22-filing.js:169, enforced at 22-filing.js:116) — opens the matter and submits POST /r/moot/ai-policy with `policy=allowed`. There is no admin check, no role check, no typed confirmation, and no second factor; the room renders it as one hidden-field button (19-moot.js:43-47). I reproduced this over real HTTP with an account whose role is `clerk`: `policy before clerk POST: forbidden` → `policy after clerk (non-admin) POST: allowed status 303`. 4. The clerk then runs POST /r/moot/ai-oppose, which ships up to 24,000 characters of the privileged draft (19-moot.js:205) out through the gateway. The prohibition the client's engagement bought is removable by the least-trusted account in the firm, while merely storing the gateway's API key requires admin. Only a bare `matter.aiPolicy` audit line records it.

**Fix**

Gate the downgrade, not the upgrade. In rooms/19-moot.js at line 186, refuse the transition to `'allowed'` for a non-admin: `if (policy === 'allowed' && (m2.aiPolicy || 'allowed') === 'forbidden' && !k.isAdmin()) { ctx.setFlash('Lifting a matter\'s model prohibition is an administrator function.', 'err'); redirect(res, back); return; }` — leaving any user free to tighten the policy to `'forbidden'`, which matches how the room's other gates behave. Hide the toggle in `modelCard` for non-admins the way 26-closing and 29/30/31 hide their admin forms, and audit the lift with the prior value (`matter.aiPolicy.lifted`, `matterId:forbidden->allowed`) so the change is legible in the chain.

## 22. Matter free-text is written into the plaintext audit log, where it survives crypto-shredding and travels in backups

**MEDIUM / CONFIRMED** — audit-chain — `app/rooms/10-pleadings.js:391`

**Evidence**

```js
const custom = String(ctx.body.custom || '').trim();
    let name, cite;
    if (custom) {
      name = custom;
      ...
    ctx.kernel.audit('pleadings.defence.register', ctx.matter.id + ':' + name);

// same shape at rooms/33-production.js:256, where `recipient` is free-typed:
//   k.audit('production.served', `${ctx.matter.id}:${volume}:to=${recipient}:on=${servedDate}:...`)
```

**How it fails**

`name` here is `ctx.body.custom` — arbitrary, unbounded text a seat-holder types into the Affirmative defences form, describing this matter's defence strategy. It is concatenated straight into the audit `object` field. kernel/audit.js:2 states the contract this violates: 'plaintext metadata only (never client content)'. Everything else about a matter is AES-256-GCM sealed under that matter's DEK (store.js:32); audit.log alone is plaintext, and deploy/backup.sh:6 and RUNBOOK.md:211-212 confirm it is included in backups and is the one non-ciphertext member ('A stolen archive is 100% ciphertext except the audit chain'). It is also the one artefact that survives kernel shred(): 26-closing.js:116 promises the client that destruction makes the matter's history 'cryptographically unrecoverable — in the live store, every replica, and every backup', but the defence text, the service recipient's name (33-production.js:256), the invoice totals (34-billing.js:370) and the bates ranges remain readable in cleartext afterwards. Anyone holding a backup tarball, or with read access to the host (see the mode issue below), recovers privileged matter detail with no key at all. The gate does not catch this: test/crypto.test.js:52 only asserts that one literal string ('brakes') is absent from audit.log.

**Fix**

In rooms/10-pleadings.js:391 log an opaque identifier instead of the text — after the s.put, log ctx.matter.id + ':' + saved.id. Apply the same rule at rooms/33-production.js:256 (log rec.id, volume and counts, not `to=${recipient}`). Then enforce it: add a gate assertion that no audit `object` contains a substring of any matter-scope free-text field, and state the metadata-only rule for `k.audit` in docs/CONTRACT-SHEET.md §(c).

## 23. Settlement gross accepts a non-finite figure and stages it into the trust account

**MEDIUM / CONFIRMED** — money-billing-trust — `app/rooms/24-waterfall.js:70`

**Evidence**

```js
const gross = Number(ctx.body.gross), feePct = Number(ctx.body.feePct), costs = Number(ctx.body.costs) || 0;
    if (!(gross > 0) || !(feePct >= 0 && feePct <= 100)) { ctx.setFlash('Need a positive gross and a fee between 0 and 100%.', 'err'); redirect(res, '/r/waterfall'); return; }
```

**How it fails**

Second entry point into the same trust corruption as finding 2, and it needs no direct access to Trust & Books. POST /r/waterfall/new with gross=1e999: `!(Infinity > 0)` is false, so the waterfall record is stored with gross=Infinity. POST /r/waterfall/stage then re-checks only `!(Number(w.gross) > 0)` (24-waterfall.js:90), which Infinity also passes, and posts `lines: [{account:'trust:bank', dr: w.gross}, {account:'trust:client', cr: w.gross}]` at line 93. ledger.post accepts it (finding 1) and the matter's trust position becomes Infinity, which opens the s.7 overdraw gate for unlimited trust-to-operating fee transfers exactly as in finding 2. The room's own statement card also renders `money(Infinity)` as '$∞' to the client and compute() propagates Infinity/NaN through every net-to-client figure on the settlement statement the client signs.

**Fix**

At rooms/24-waterfall.js:70-71 validate with Number.isFinite on gross, feePct and costs (and a sane upper bound), and store gross rounded to cents; add the same Number.isFinite guard to the /stage re-check at line 90.

## 24. Trust overdraw gate compares against a half-up-rounded balance, so a sub-cent position can be paid out in full

**MEDIUM / CONFIRMED** — money-billing-trust — `app/kernel/trust.js:44`

**Evidence**

```js
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
...
function perMatterTrustBalance(kernel, matterId) {
  ...
  return round2(bal['trust:bank'] || 0);
}
...
function wouldNotOverdraw(kernel, matterId, amount) {
  const amt = finite(amount);
  if (amt === null || amt <= 0) return false;
  return cents(amt) <= cents(perMatterTrustBalance(kernel, matterId));
}
```

**How it fails**

The gate compares the requested amount against a balance that has already been ROUNDED HALF-UP to cents, while the rooms post unrounded floats into the ledger (28-books.js:334 posts `dr: amt` verbatim, not r2(amt)). So the ledger can hold a true balance of 0.005 while perMatterTrustBalance reports 0.01. Verified against the real module: post a retainer of 0.005 (it survives ledger.post because Math.round(0.5) = 1 cent on both legs), then perMatterTrustBalance returns 0.01 and wouldNotOverdraw(0.01) returns true; the resulting trust-transfer leaves trust:bank at -0.005 — an actual overdrawn trust account, the exact condition By-Law 9 s.7 prohibits. The same works from the other side: with exactly 100.00 held, a transfer of 100.004 passes because cents(100.004) rounds down to 10000. Magnitude is bounded at half a cent per matter (the error is in the rounding of the total, not per operation), so this is an invariant break rather than a theft channel — but it means the code cannot actually prove 'trust is never overdrawn', and the residual shows up as a permanent DISAGREE on the s.18 comparison.

**Fix**

Make cents the ledger's only unit at the boundary: have the rooms post r2(amt), and have wouldNotOverdraw compare against the UNROUNDED balance in cents — `cents(amt) <= Math.floor(rawBalance * 100)` — so rounding can only ever refuse a payment, never authorise one.

## 25. Closing gate on the trust balance is one-sided — an overdrawn matter closes and can then be shredded

**MEDIUM / CONFIRMED** — money-billing-trust — `app/rooms/26-closing.js:167`

**Evidence**

```js
const trust = k.ledger.balances(m.id)['trust:bank'] || 0;
    if (trust > 0.005) { ctx.setFlash(`Refused: ${trust.toFixed(2)} still held in trust for this matter. Disburse it in Trust & Books first.`, 'err'); redirect(res, '/r/closing'); return; }
```

**How it fails**

The gate exists to stop a matter closing with client money still held, and it correctly refuses a positive balance. It says nothing about a NEGATIVE one, which is the far more serious condition: a negative trust:bank means this matter has paid out more than it held, i.e. it is holding another client's money to cover a shortfall. Both findings 2 and 4 produce exactly that state (-500000 after restart in finding 2's path, -0.005 in finding 4's), and neither is caught here. Once closed, an admin can POST /r/closing/shred (26-closing.js:174-183), which destroys the matter DEK — the ledgerTxn rows survive in the firm log, but the matter scope that documents what the money was for is unrecoverable, and the closing certificate asserts the file was closed clean. The audit trail records 'matter.closed' with no balance, so nothing in the record shows the trust account was short.

**Fix**

At rooms/26-closing.js:167 gate on the absolute value — `if (Math.abs(trust) > 0.005) refuse`, with a distinct message for a negative balance directing counsel to investigate a shortfall before the file can be closed. Apply the same two-sided test to the display at line 94.

## 26. Log append is neither atomic nor durable, and one unreadable line permanently bricks the whole scope (firm.log kills the app)

**MEDIUM / CONFIRMED** — store-integrity — `app/kernel/store.js:33`

**Evidence**

```js
_append(ev) {
    const line = seal(this.key, Buffer.from(JSON.stringify(ev)), this.label).toString('base64');
    fs.appendFileSync(this.file, line + '\n');
    this._apply(ev);
  }

// and the loader, store.js:16-23:
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(open(this.key, Buffer.from(line, 'base64'), this.label).toString('utf8'));
        this._apply(ev);
      }
    }
```

**How it fails**

1) `_append` writes with a bare `fs.appendFileSync` — no O_EXCL/tmp+rename, no `fs.fsyncSync`, no length prefix or per-line checksum, and no truncation of a trailing partial record on load. Compare `Keyring._save` (app/kernel/crypto.js:49-53) which does tmp-write + `renameSync`, and `Audit` (app/kernel/audit.js:36-59) which takes an O_EXCL lock — the store is the only writer with neither. 2) The loader has zero tolerance: the first line whose GCM tag fails or whose JSON is truncated throws out of the `Scope` constructor. There is no skip, quarantine, truncate-to-last-good-record, or repair tool anywhere in the tree. 3) Reaching a torn write is an authenticated seat-holder's choice: `putBlob` (store.js:83-90) has no size cap and no per-matter or global quota, and `POST /r/review/add` accepts a body up to MAX_BODY = 25MB (app/kernel/http.js:8) per request, so a lawyer can fill the volume. On ENOSPC, write(2) returns a short count and Node's next writeSync throws — leaving a truncated base64 line with no terminating newline. A `kill -9` mid-write does the same. 4) Consequence on next boot: for a matter log, every sealed event in that matter — the whole privileged record set — is permanently unreadable even though only the last event is damaged; for `firm.log`, `new Scope(...)` throws inside `new Store(DATA, keyring)` at app/server.js:21 during module load, so the application never starts again and no room, matter, user or wall is reachable at all. Note the damage survives restore-from-key: the key is fine, the log is not.

**Fix**

In `_append`, write through a crash-safe path — append to the log, then `fs.fsyncSync` the fd (and the directory fd) before `_apply` — and make each line self-delimiting (e.g. write `<byteLength>.<base64>` or a per-line CRC). In the `Scope` constructor, replay defensively: wrap the `open`/`JSON.parse` of each line in try/catch, stop at the first line that fails, keep every record replayed up to that point, record the byte offset of the last good line so the next append can truncate the partial tail, and surface a loud 'log truncated at line N' warning rather than throwing. Separately, give `putBlob` an explicit byte cap and a per-matter quota.

## 27. No cross-process coordination or reload of store logs: the shipped console tool writes an enrollment invite the running server cannot see, which then goes live on the next restart

**MEDIUM / CONFIRMED** — store-integrity — `app/kernel/store.js:16`

**Evidence**

```js
if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      ...
    }
  }
  ...
  _append(ev) {
    ...
    fs.appendFileSync(this.file, line + '\n');
```

**How it fails**

A `Scope` projects its log exactly once, in its constructor, and never re-reads the file; `_append` takes no lock. `kernel/audit.js:30-35` documents that this deployment genuinely has two writers ('the server plus a console tool') and defends `audit.log` with an O_EXCL lockfile — the store has no equivalent. app/tools/invite.js:19-21 builds its own `Keyring`/`Store` over the same `CHAMBERS_DATA` and calls `auth.createInvite`, which appends an `invite` record to `firm.log` (app/kernel/auth.js:98 `this.store.firm.put('invite', {...})`). Run against a live server — the documented usage, 'Mint a single-use enrollment invite from the server console' — the record lands in `firm.log` and prints a link, but the server's `store.firm` Map is stale, so `GET /invite/:code` (app/server.js:127-129 `store.firm.list('invite', (i) => i.code === ctx.params.code && !i.used)[0]`) finds nothing and answers the constant 404. The admin concludes the invite failed. It did not: after the next server restart the same code is replayed into the projection and, still inside its 24h window (auth.js:98), becomes a live single-use enrollment credential on an invite-only two-seat system. The same staleness makes the seat-cap check in auth.js:96 (`this.activeCount() >= this.seatCap()`) evaluate against a projection that is missing whatever the other process wrote. Concurrent large appends from two processes are also unserialised, which is a second route into finding 1's torn-line failure.

**Fix**

Either take the same O_EXCL lock `Audit._acquireLock` uses around read-tail + append in `Scope._append` and re-read (tail-follow) the log from the last known byte offset before each read/append, or make the console tools refuse to run while a server holds the data directory (a pidfile/lock in `dataDir`) and tell the operator to use `/admin/invite` instead.

## 28. Holiday tables cover 2026 only, so every deadline outside 2026 is computed as if no court holiday exists — and the limitation weekend/holiday flag is holiday-blind by construction

**MEDIUM / CONFIRMED** — deadline-rules — `app/kernel/rules.js:62`

**Evidence**

```js
// kernel/rules.js:7-16 (abbreviated) — every entry is a 2026 date
const HOLIDAYS = {
  'us-fed': ['2026-01-01', '2026-01-19', ... '2026-12-25'],
  'on': ['2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-26'],
  ...
};

// kernel/rules.js:58-63
function isBusinessDay(d, jur) {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  return !(HOLIDAYS[jur] || HOLIDAYS['us-fed']).includes(iso);
}
```

**How it fails**

isBusinessDay() decides holiday status purely by exact-string membership in a table that holds only 2026 dates, so for any other year it degrades silently to a weekend-only test. Two concrete, executed consequences. (1) Procedural deadlines are calendared on days the courthouse is closed: rules.compute(rules.rule('on-soc-defence'), '2027-06-11') returns 2027-07-01 — Canada Day, an Ontario court holiday — and rules.isBusinessDay(new Date('2027-07-01T00:00:00Z'),'on') returns true. Likewise compute(on-soc-defence,'2027-12-05') returns 2027-12-27, the substituted Christmas/Boxing Day court closure, and isBusinessDay('2027-12-27','on') returns true. A statement of defence diaried for a day the registry is shut is a default-judgment exposure. (2) The limitation safety flag is dead for its holiday half: every limitation rule in the book is 730, 1095 or 2190 days, so every limitation date computed from a present-day trigger necessarily falls outside 2026. Executed: rules.computeLimitation(rules.rule('on-limitation'), '2026-12-26') returns { date: '2028-12-25', weekendOrHoliday: false } — Christmas Day 2028 is a Monday, so landsOnNonBusinessDay() reports it as an ordinary business day and 21-calendar.js:232-234 prints no warning at all. The single control that is supposed to tell counsel 'this statutory expiry lands on a day nobody can file' can therefore only ever detect a Saturday or Sunday. The existing gate hides this: test/improve.test.js:15-21 exercises only 2026 dates.

**Fix**

Make the year gap explicit rather than silently permissive. Either (a) key HOLIDAYS by year and have isBusinessDay() throw / return a third 'unknown' state for a date whose year has no loaded table, so compute() refuses rather than emitting a date it cannot vouch for, or (b) at minimum add a `coveredYears` set per jurisdiction and have compute()/landsOnNonBusinessDay() propagate an 'outside the loaded holiday tranche — holiday roll not applied' flag that 21-calendar and 27-desk surface on the row. Do not leave `.includes(iso)` as the sole test against a single-year array.

## 29. The limitation weekend/holiday warning is a one-shot flash and is never persisted or shown on either diary; the primary limitation bar written at intake never gets it at all

**MEDIUM / CONFIRMED** — deadline-rules — `app/rooms/21-calendar.js:232`

**Evidence**

```js
// rooms/21-calendar.js:232-235
    const warn = k.rules.isLimitation(rule) && k.rules.landsOnNonBusinessDay(rule, due);
    ctx.setFlash(`Calendared: ${rule.desc} — ${due} (${rule.cite}).`
      + (warn ? ' LIMITATION date falling on a weekend or holiday — it is not rolled forward. Confirm any statutory extension and work to the business day before.' : ''), warn ? 'err' : undefined);
    redirect(res, '/r/calendar');
```

**How it fails**

kernel/rules.js:78-79 states the contract: 'callers pair this with landsOnNonBusinessDay() to warn counsel to confirm any statutory extension.' Grepping the whole app, landsOnNonBusinessDay is called in exactly one place outside rules.js itself — this line — and computeLimitation's weekendOrHoliday is read only by the stateless calculator in 17-tools (lines 25, 35). The result is never written onto the deadline record. server.js:35-37 shows setFlash stores into a Map keyed by session cookie and takeFlash (server.js:37, consumed in makeCtx) deletes it on the next render, so the warning survives exactly one page view. Thereafter: the Trial Calendar diary (21-calendar.js:186-191) renders only due/desc/trigger/rule/status, and the firm-wide limitation diary in 27-desk (27-desk.js:133-141, limCell at 115-125) renders only the LIMITATION tag and the dual-diary tick — neither calls landsOnNonBusinessDay. Worse, the single most consequential limitation bar in the system, the one 01-intake writes when a matter is opened (01-intake.js:85 `limitation = k.rules.compute(limRule, discovered)`, persisted at 01-intake.js:140 `k.scope(m.id).put('deadline', dl)`), never invokes the check on any code path, so a limitation date expiring on a Saturday is calendared, printed on the Monday-meeting diary, exported to the ICS phone feed and dual-diary-verified with nothing anywhere indicating that no filing is possible on the day it expires. Counsel who was not at the keyboard for the one redirect that produced the flash has no way to learn it.

**Fix**

Persist the flag instead of flashing it. Have every writer store the result of k.rules.computeLimitation() on the record (e.g. `expiresOnNonBusinessDay: true`, recomputed on read so a later-loaded holiday table is picked up), and render it as a distinct chip beside the LIMITATION tag in 27-desk's limCell (27-desk.js:115-125), in 21-calendar's diary row (21-calendar.js:187-188) and in the ICS DESCRIPTION (21-calendar.js:344-345). Add the same call to 01-intake's limitation write path at 01-intake.js:85/140.

## 30. Deadlines flagged stale by a governing-law change are invisible on both diaries and can still receive the dual-diary tick, certifying a date computed under a rulebook that no longer governs

**MEDIUM / CONFIRMED** — deadline-rules — `app/rooms/27-desk.js:103`

**Evidence**

```js
// rooms/27-desk.js:82 — the firm diary's only filter
        ds = s.list('deadline', (d) => d.status === 'open');

// rooms/27-desk.js:103
    const limUnticked = diary.filter((r) => isLimitation(k, r.d) && !r.d.verifiedBy).length;

// rooms/27-desk.js:115-124 — the tick is offered with no reference to d.stale
    const limCell = (m, d) => {
      const parts = [];
      const lim = isLimitation(k, d);
      if (lim) parts.push(tag('LIMITATION', 'gate'));
      if (d.verifiedBy) { ... } else if (lim) {
        parts.push(`<form method="POST" action="/r/desk/verify" ...><button class="quiet">Verify date</button></form>`);
      }
```

**How it fails**

09-jurisdiction.js:123-127 correctly detects that a governing-law change invalidates already-computed dates and stamps every open deadline with `stale: true, staleReason, staleLimitation`. But `stale` is read nowhere else in the app — grep for 'stale' across rooms/ returns only 09-jurisdiction.js plus 21-calendar.js:252/253/268/270, where the identifier is an unrelated local variable holding the cascade rows being deleted. Concretely: lawyer A opens an Ontario matter, intake computes the s.4 limitation bar at 730 days; counsel later corrects the governing law to bc or ny in room 09, which stamps the bar stale (and 09-jurisdiction.js:130 audits it). The Trial Calendar diary (21-calendar.js:186-191) and the firm-wide limitation diary (27-desk.js:133-141) both continue to display the old, wrong date as an ordinary open LIMITATION row with no marker, and the ICS feed (21-calendar.js:343-346) exports it to counsel's phone unmarked. Room 27 then invites the second lawyer to press 'Verify date' on it; POST /r/desk/verify (27-desk.js:193-210) checks only that the verifier is not d.createdBy and stamps verifiedBy/verifiedAt, after which limCell renders a green 'verified' tag and limUnticked drops. The LawPRO dual-diary control thus positively certifies a limitation date the system already knows was computed against the wrong rulebook. The stale warning is only visible in room 09 and only while that matter happens to be the open one.

**Fix**

Carry the stale state into the places counsel reads dates: add a `tag('RECOMPUTE', 'gate')` in 27-desk's limCell and in the 21-calendar diary row whenever `d.stale && d.status !== 'done'`; count stale limitation bars in the 27-desk stat strip alongside limUnticked; and in POST /r/desk/verify (27-desk.js:193) refuse the tick while `d.stale` is set, with a flash pointing at the recompute list in room 09.

## 31. CanLII connector reports a 200 with an unparseable body as a successful fetch with data:null, producing a false "resolved" citation and permanently poisoning the firm-wide cache

**MEDIUM / CONFIRMED** — external-apis — `app/kernel/canlii.js:56`

**Evidence**

```js
const body = await r.json().catch(() => null);
    if (!r.ok) {
      ...
    }
    return { ok: true, data: body };
```

**How it fails**

`.catch(() => null)` swallows every body-level failure — a maintenance/captive-portal HTML page served with 200, an empty 200, a truncated response, or the 12s AbortController firing during the body read — and the only success test that follows is `r.ok`, which is already true. `apiGet` therefore returns `{ok:true, data:null}`. I reproduced this verbatim against a local server that answers 200 with `<html>maintenance</html>`: output `apiGet -> {"ok":true,"data":null}`. Two things then break. (1) kernel/cite-resolve.js:58-63 sees `out.ok` true, does `const d = out.data || {}` and returns `resolved:true` with the input cite echoed back as the title; rooms/08-citations.js:433-443 stores `lookup.resolved = true` and flashes "Connector matched 2008 SCC 9", and lookupBlock (08-citations.js:167) renders the `connector found a match` chip — in the one room whose founding rule is that no machine verifies anything. (2) rooms/29-canlii.js:46 first commits `k.firm.put('canliiCase', { id: databaseId + '/' + caseId, ..., meta: out.data })` with `meta: null`, and only then line 56 (`title: out.data.title`) / line 63 (`${out.data.title}`) dereference null and throw TypeError -> HTTP 500. Because the null-meta record is already appended to the firm log and there is no route in room 29 that deletes a `canliiCase`, every later resolve of that citation takes the `cached` branch at line 44 (`{ ok: true, data: cached.meta }` = null) and 500s again, firm-wide, forever.

**Fix**

In `apiGet` (kernel/canlii.js:56-64) treat a null/non-object body as a failure: `if (!r.ok || body === null || typeof body !== 'object') return { ok:false, status:r.status, message:'CanLII returned an unreadable response.' }` — and distinguish the AbortError case instead of catching it into null. Additionally guard rooms/29-canlii.js:46 so nothing is cached unless `out.data` is a usable object.

## 32. cite-resolve reports resolved:true for a CanLII response that carries no case data, echoing the caller's own citation back as the "resolved" title

**MEDIUM / CONFIRMED** — external-apis — `app/kernel/cite-resolve.js:61`

**Evidence**

```js
const d = out.data || {};
    return result(true, 'canlii-api', d.title || withIds.cite, d.url || searchUrl,
      `Resolved via CanLII API: ${d.title || withIds.cite}${d.citation ? ', ' + d.citation : ''}.`);
```

**How it fails**

The only success test is `out.ok` (line 58). Any response body that is null, `{}`, `[]`, or an object with no `title`/`url` — which kernel/canlii.js:64 happily returns as `{ok:true, data:...}` — falls straight through to line 61-63, which fabricates a positive result out of the caller's own input: `title` becomes `withIds.cite` and `url` becomes the CanLII *search* link, not a case link. My local reproduction printed `{"resolved":true,"source":"canlii-api","title":"2008 SCC 9","url":"https://www.canlii.org/en/search/?text=2008+SCC+9","note":"Resolved via CanLII API: 2008 SCC 9."}` from a body that was an HTML error page. rooms/08-citations.js:434-447 records `resolved: out.resolved === true` and flashes "Connector matched"; the verifier sees a green "connector found a match" chip and a pre-filled URL asserting the cite is a real case, when the connector confirmed nothing. In a build whose docs cite Ko v. Li, 2025 ONSC 2766 on hallucinated authority, a machine asserting identity it never obtained is the specific failure mode the room exists to prevent.

**Fix**

At kernel/cite-resolve.js:58 require substance, not just `ok`: treat `!out.data || typeof out.data !== 'object' || !(out.data.title || out.data.url)` as a miss and return `result(false, 'canlii-api', '', searchUrl, 'CanLII returned no case record for this id — link-out only.')`.

## 33. Rooms 30 and 31 make outbound third-party requests carrying operator-supplied query text with no audit entry at all

**MEDIUM / CONFIRMED** — external-apis — `app/rooms/30-uscourts.js:26`

**Evidence**

```js
const out = await ctx.kernel.uscourts.search(q, type, ctx.kernel.uscourts.token());
    if (!out.ok) { ctx.setFlash('CourtListener: ' + out.message, 'err'); redirect(res, '/r/uscourts'); return; }
    render(res, ctx, { q, type, ...out });
```

**How it fails**

kernel/api.js:179-187 states the invariant explicitly — "OUTBOUND ACCOUNTABILITY ... an audit line is written at the moment a request actually leaves ... The audit fires BEFORE the request, so a failure to record fails closed — no unlogged call to a third party" — and implements it (api.js:194-200, `cite.resolve.egress`) for the two calls cite-resolve makes. The direct room routes route around it. POST /r/uscourts/search (30-uscourts.js:22-29) and POST /r/edgar/search (31-edgar.js:32-39) call `k.uscourts.search` / `k.edgar.search` and never call `k.audit`; neither route writes any record, so there is not even an incidental `*.put` audit line. Concretely: a seat-holder — including one screened off a matter by an ethical wall, since neither route requires `ctx.matter` — types a client or opposing-party name into the RECAP or EDGAR box, the firm's identity plus that party name leaves to the Free Law Project and the SEC (edgar.js:14 attaches the firm's declared contact to the User-Agent on every request), and the hash-chained audit log shows nothing. After a confidentiality incident there is no way to establish what was sent or by whom.

**Fix**

Wrap both calls the way api.js wraps cite-resolve: emit `ctx.kernel.audit('uscourts.search.egress', type)` / `ctx.kernel.audit('edgar.search.egress', forms || 'any')` immediately BEFORE the await, so the record is written even if the request fails. Log the corpus/form metadata, not the query string, matching the existing decision at api.js:185-187 not to log the cite itself.

## 34. Keyring mints a fresh root key whenever root.key is absent, with no first-boot marker and no fail-closed check — a data directory that has lost its key files is silently re-keyed and, in one case, re-initialised as a virgin firm while the old matter logs are orphaned

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

## 35. The login second factor has no per-account or per-pending-token attempt limit — a wrong code neither retires the pending token nor costs the account anything, only the shared per-IP bucket

**MEDIUM / PLAUSIBLE** — auth-totp — `app/kernel/auth.js:72`

**Evidence**

```js
app/kernel/auth.js:67-79
  verifyTotp(pendingToken, code2, ip) {
    if (this.rateLimited(ip)) return null;
    const key = sha256(String(pendingToken || ''));
    const p = this.pending.get(key);
    if (!p || Date.now() > p.exp) { this.pending.delete(key); return null; }
    if (!this.consumeTotp(p.uid, code2)) {
      this.audit.log(p.uid, 'login.2fa.denied', ip);
      return null;
    }
    this.pending.delete(key);

and the only counter in the class, app/kernel/auth.js:24-30:
  rateLimited(ip) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || now > h.resetAt) { this.hits.set(ip, { n: 1, resetAt: now + RATE.windowMs }); return false; }
    h.n++;
    return h.n > RATE.max;
  }
```

**How it fails**

A wrong second-factor code leaves this.pending[key] intact (the delete on line 76 runs only on success; the delete on line 71 only on expiry), and consumeTotp records nothing on the user record for a miss. So one password submission buys unlimited code attempts for the pending token's full 5-minute life, and the ONLY thing standing between an attacker who has phished a partner's password and a completed sign-in is this.hits, keyed on `req.socket.remoteAddress` (server.js:115). Concrete path where that key is not a barrier: server.js:291 ships an explicit escape hatch — `const HOST = process.env.CHAMBERS_HOST || '127.0.0.1'` documented as 'Set CHAMBERS_HOST=0.0.0.0 to expose it' — and app.listen's own comment at http.js:85 notes host may be omitted. On any such deployment an attacker sourcing from an IPv6 /64 or a handful of hosts gets a fresh 20-per-15-minute budget per address, and with ~3 of 10^6 codes accepted per instant the second factor falls in ~333k requests; verifyTotp is a bare HMAC path with no scrypt, so that is minutes, not days. Marked PLAUSIBLE rather than CONFIRMED because on the shipped Caddy-to-loopback topology every request presents the same remoteAddress, which collapses the budget to one global 20-per-15-minutes bucket and does throttle the attack (at the cost of the mutual-lockout problem already recorded elsewhere) — i.e. the defence that actually holds today is an accident of the proxy, not a property of the second factor.

**Fix**

Give the second factor its own account-scoped counter that does not depend on the client's IP: on a failed consumeTotp inside verifyTotp, increment a tries field on the pending entry ({uid, exp, tries}) and delete the pending token once tries exceeds a small number (e.g. 5), forcing a fresh password submission; and persist a per-user consecutive-2FA-failure count on the user record that locks the account's second factor after N misses until an operator or a successful password+code pair clears it.

## 36. _releaseLock() unlinks whatever lockfile exists, not the one it owns, so a broken stale lock lets two writers share one tail

**MEDIUM / PLAUSIBLE** — audit-chain — `app/kernel/audit.js:59`

**Evidence**

```js
_releaseLock() { try { fs.unlinkSync(this.lockFile); } catch (_) { /* already released */ } }

// paired with the stale-break at lines 46-53:
        const st = fs.statSync(this.lockFile);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          const gone = this.lockFile + '.stale-' + process.pid + '-' + Date.now();
          fs.renameSync(this.lockFile, gone);
          fs.unlinkSync(gone);
        }
```

**How it fails**

The comment on lines 33-35 claims 'a lock left behind by a crashed process is broken via atomic rename, so at most one contender ever wins it'. The rename is indeed atomic between two BREAKERS, but the guarantee does not survive the original owner's release, because _releaseLock carries no ownership token — no pid check, no unique-file-plus-rename handoff. Sequence with the server plus tools/invite.js (a second Audit handle, exactly the configuration test/audit.test.js:11-12 blesses): A acquires the lock at t=0 and stalls inside log() for more than LOCK_STALE_MS (reachable, because the lock is held across _syncPrev's full-file readFileSync — see finding #2, where the log is remotely growable to hundreds of MB, and restore.sh:201 already has to `rm -f audit.log.lock`, so stale locks are a known field condition). At t=11 s B declares A's lock stale, breaks it and creates its own, then begins its own _syncPrev. At t=11.1 s A finishes and unlinks B's lock. C now acquires immediately and reads the same tail B read. B and C each append an entry with the identical `prev`, and verify() reports ok:false at that index from then on, permanently and irreparably — indistinguishable from real tampering, which also gives a genuine tamperer the defence that 'the lock races'. A second, milder defect sits in the same routine: LOCK_WAIT_MS (5000) is less than LOCK_STALE_MS (10000), so after a crash no single waiter can ever break the stale lock inside its own budget — every audit write throws for a full 10 s window (and per finding #3 those mutations commit unlogged). Marked PLAUSIBLE rather than CONFIRMED because it needs a >10 s stall in a second process; the code defect itself is unambiguous.

**Fix**

Give the lock an owner token: write to a unique temp file and link()/rename() it into place, remember the inode/random id, and in _releaseLock only unlink when the on-disk lockfile still carries that id (read it back and compare, or use fs.openSync with O_EXCL and keep the fd). Break a stale lock by renaming to a per-breaker path and re-attempting the O_EXCL create rather than assuming the break succeeded. Set LOCK_WAIT_MS > LOCK_STALE_MS so a waiter can actually outlive a stale lock, and stop holding the lock across a whole-file read.

## 37. A single malformed line makes the audit module throw instead of reporting tampering, and prevents the server from booting

**MEDIUM / PLAUSIBLE** — audit-chain — `app/kernel/audit.js:19`

**Evidence**

```js
const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length) this.prev = JSON.parse(lines[lines.length - 1]).hash;

// unguarded JSON.parse also at line 28 (_syncPrev), line 78 (verify) and line 88 (tail)
```

**How it fails**

None of the four JSON.parse call sites is guarded, and neither is the property access on the parsed value. A torn trailing line is a real outcome: log() writes with fs.appendFileSync (line 66) with no fsync and no atomic staging, and the entries can be very large (finding #2 shows a 25 MB actor is accepted), so a crash or power loss mid-write leaves a partial line. The consequences are ordered worst-first: the Audit CONSTRUCTOR parses the last line, and server.js:22 constructs Audit before app.listen, so a single corrupt or garbage final line means the process throws at startup and the firm cannot sign in at all — with no repair tool in the tree. A signed-in user hitting /r/desk (27-desk.js:107) or /admin (server.js:209) gets a 500 from verify() rather than the `BROKEN` tag those pages are written to display. That inverts the intended behaviour: corruption of the log — the exact event the chain exists to surface — is reported as an opaque 500/boot failure instead of as detected tampering. Marked PLAUSIBLE because it needs a crash mid-append or direct file corruption rather than a purely remote trigger.

**Fix**

Wrap each JSON.parse in try/catch. In verify(), treat an unparseable line as tamper: return { ok:false, at:i+1, reason:'malformed' } rather than throwing. In the constructor and _syncPrev, fall back to a scan backwards for the last parseable line and surface the condition, so the server still boots and the admin page can show a broken chain. Additionally make the append atomic-ish (write the line to a temp file and rename-append, or fsync after each append) so a crash cannot leave a partial record.

## 38. Trust-to-operating fee transfer is authorised by a free-text string, with no check that any invoice was issued for the amount

**MEDIUM / PLAUSIBLE** — money-billing-trust — `app/rooms/28-books.js:348`

**Evidence**

```js
const ref = String(ctx.body.invoiceRef || '').trim();
    if (!ref) { ctx.setFlash('Name the invoice this transfer pays — a withdrawal from trust must be traceable to the bill it satisfies.', 'err'); redirect(res, '/r/books'); return; }
```

**How it fails**

By-Law 9 permits withdrawing client trust money for fees only to the extent of a bill actually delivered to the client. The only control here is that `ref` is non-empty; 'x' satisfies it. The overdraw gate immediately below limits the transfer to what the matter HOLDS, not to what has been BILLED, so a seat-holder can move a client's entire retainer from trust to operating:income:fees with no invoice in existence, and the resulting ledgerTxn memo is whatever string was typed. The data to check against is already on hand in the same matter scope — 34-billing writes `invoice` records with `number`, `total` and `status:'sent'` (34-billing.js:451-452), and marks them paid separately — so the room could verify that a matching issued invoice exists and that cumulative transfers do not exceed the sum of issued invoices. Marked PLAUSIBLE rather than CONFIRMED because this is a missing control rather than a broken one: no code path is bypassed, and a two-seat firm may intend the honour system here. But nothing in the CONTRACT-SHEET states that intent, and the handler's own comment claims the ledger 'can never hold an unattributed trust-transfer', which is not what the code achieves.

**Fix**

In the /transfer handler, resolve `invoiceRef` against `sc.list('invoice')` for the matter, require a matching invoice with status 'sent' or 'paid', and refuse when the running total of trust-transfers against that invoice would exceed its `total`. Store the resolved invoice id on the txn rather than the typed string.

## 39. Scope.get/list hand out live references into the committed projection; put only shallow-copies, so stored records can be edited with no event, no updatedAt/updatedBy and no audit line

**MEDIUM / PLAUSIBLE** — store-integrity — `app/kernel/store.js:38`

**Evidence**

```js
list(type, filter) {
    const m = this.types.get(type);
    const all = m ? [...m.values()] : [];
    return filter ? all.filter(filter) : all;
  }
  get(type, id) {
    const m = this.types.get(type);
    return m ? m.get(id) : undefined;
  }
  put(type, obj, by) {
    ...
    const rec = { ...obj };
```

**How it fails**

`list()` copies the array but not the elements, and `get()` returns the map value itself, so every caller holds a live handle on the object that IS the committed state. `put`'s `{ ...obj }` is one level deep, so after a put the stored record still shares its nested `lineItems`, `lines`, `issues`, `mapping`, `screened` arrays with the caller, and `put` also returns that same `rec` object it just stored. Any mutation through those handles changes what every other request sees, with no sealed event appended, no `updatedAt`/`updatedBy` stamp and no audit line — and it silently reverts on restart, so the UI and the log disagree until then. Traced instance: app/rooms/34-billing.js:424-426 calls `recompute(inv)` on the object returned by `sc.get('invoice', ...)`; `recompute` writes `inv.fees/disbursements/writeDowns/total` in place (34-billing.js:80) and the very next line `if (!(num(inv.total) > 0)) { ...; return; }` can return without ever calling `sc.put`, as can the unbalanced-lines branch below it — while that route's own comment at 34-billing.js:443-444 asserts 'Everything above is read-only, so every refusal leaves the draft exactly as it was'. app/rooms/34-billing.js:391 (`l.writeDown = r2(wd)`) likewise mutates the stored invoice's line objects before any put. I marked this PLAUSIBLE rather than CONFIRMED because `recompute` is idempotent over the invoice's own fields, so I could not produce a run where a refusal leaves a numerically different total in memory; what is confirmed is that the store offers no guarantee here and the room is relying on one it does not have. The ethical wall reads the same way (`store.firm.list('wall', ...)` in app/kernel/api.js:18), so a stray mutation of a returned `wall` object would drop a screen for every user until restart with nothing in the audit chain.

**Fix**

Make the projection immutable at the boundary: in `_apply`, store `Object.freeze`d records (deep-freeze on replay/put), and have `put` take a structured deep copy (`structuredClone(obj)`) before sealing so the stored record shares no nested reference with the caller. `get`/`list` should then return frozen objects, forcing every writer through `put` and its audit line in kernel/api.js:41.

## 40. An unverified limitation bar can be cleared from the firm-wide dual-diary control single-handedly via /r/calendar/done, with no second person and no limitation-specific audit action

**MEDIUM / PLAUSIBLE** — deadline-rules — `app/rooms/21-calendar.js:274`

**Evidence**

```js
// rooms/21-calendar.js:274-282
  app.route('POST', `/r/${ROOM.id}/done`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (ctx.matter) {
      const s = k.scope(ctx.matter.id);
      const d = s.get('deadline', String(ctx.body.id || ''));
      if (d) { s.put('deadline', { ...d, status: 'done' }); ctx.setFlash(`Closed: ${d.desc} (${d.due || 'no date'}).`); }
    }
    redirect(res, '/r/calendar');
  });
```

**How it fails**

POST /r/desk/verify is deliberately hardened against self-signoff (27-desk.js:202-205 refuses when ctx.user.id === d.createdBy) because the dual diary is the control that catches a mis-diaried limitation. The complementary path is not: /r/calendar/done takes any deadline id in the open matter and sets status:'done' with no check of category, no second person, and no confirmation. Both readers of the control key off status: 27-desk.js:82 lists only `d.status === 'open'`, and the 'Limitation bars unticked' statistic at 27-desk.js:103/160 is derived from that list. So the same lawyer who calendared a limitation bar can, in one click and without any colleague, remove it from the firm diary, from the unticked counter, and from the ICS feed (21-calendar.js:340), leaving the firm's mission-control page showing zero outstanding limitation bars. The write is audited, but only as the generic `deadline.put` emitted by kernel/api.js:41 with payload `matterId + ':' + r.id` — the audit line does not record that the record closed was an unverified limitation bar, so a later reviewer reading the chain cannot distinguish it from any other edit. I mark this PLAUSIBLE rather than CONFIRMED because closing a satisfied deadline is a legitimate operation; the defect is the asymmetry between the guarded verify path and the unguarded close path for the one category the control exists to protect.

**Fix**

In the /r/calendar/done handler, branch on k.rules.isLimitation of the backing rule (or 27-desk's classify): for a limitation/prescription row require an explicit confirmation field and write a distinct audit action, e.g. `k.audit('diary.limitation.closed', matterId + ':' + d.id + ':verified=' + !!d.verifiedBy)`, so closing an untick­ed limitation bar is a named, reviewable event rather than an anonymous deadline.put.

## 41. CourtListener result URLs are built by string-concatenating the attacker-influenced absolute_url onto the base origin, defeating the room's http(s) allowlist

**MEDIUM / PLAUSIBLE** — external-apis — `app/kernel/uscourts.js:37`

**Evidence**

```js
url: r.absolute_url ? BASE + r.absolute_url : '',
```

**How it fails**

`BASE` is the literal 'https://www.courtlistener.com' and `r.absolute_url` is taken verbatim from the search response. A hostile or compromised upstream (the threat model names external API responses as untrusted) returning `absolute_url: "@evil.example/x"` yields `https://www.courtlistener.com@evil.example/x`, whose host — I verified with Node's URL parser — is `evil.example`; `".evil.example/x"` yields host `www.courtlistener.com.evil.example`. Both start with `https://`, so `isWeb` (30-uscourts.js:63) passes them, `linkOut` (line 64) renders them as the clickable case-name link, and the value survives the identical allowlist check at 30-uscourts.js:39 to be persisted onto the matter file as `authority.url` / `docketRef.url` (lines 50, 53), where it is re-rendered as an "open" link at line 105 on every later visit. The room's own comment (lines 60-62) and CONTRACT-SHEET.md's SCHEME ALLOWLIST invariant treat that regex as the control; it checks the scheme and never the host, so a privileged matter file can carry a permanent, case-name-labelled link that navigates to an attacker's site. Marked PLAUSIBLE because it needs a malicious or compromised CourtListener response — TLS verification is on and the two seat-holders cannot choose `absolute_url` themselves.

**Fix**

Resolve and verify the origin instead of concatenating: `const u = (() => { try { const x = new URL(r.absolute_url, BASE); return x.origin === BASE ? x.href : ''; } catch { return ''; } })();` at kernel/uscourts.js:37, and apply the same origin check (not just the scheme regex) in 30-uscourts.js:39 before persisting.

## 42. Sessions have an idle timeout but no absolute lifetime — resolve() extends expiry unconditionally on every request

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

## 43. Enabling or disabling 2FA needs neither the password nor a fresh session, and does not rotate the session id

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

## 44. server.js keeps raw session tokens alive forever as flash-map keys, defeating auth.js's deliberate hash-only session storage

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

## 45. There is no password change or recovery path anywhere in the application

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

## 46. Non-seat invite redemption skips the email format and uniqueness checks the seat path performs; an invite minted without an email field persists a user whose email is undefined and permanently breaks every login

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

## 47. Conflict-check note leaks the firm-wide matter count, including matters the viewer is walled from

**LOW / CONFIRMED** — authz-walls — `app/rooms/02-conflicts.js:133`

**Evidence**

```js
const mattersAll = k.firm.list('matter');
```

**How it fails**

1. GET /r/conflicts line 133 reads the RAW firm matter projection (`k.firm.list('matter')`, kernel/api.js:46) rather than the wall-filtered `k.matters()` (kernel/api.js:21-24) that the same file uses everywhere else (line 36, 119, 121, 146).
2. Line 175 renders it: `Token match across ${mattersAll.length} matter(s), ${inquiries.length} inquiry(ies) and ${parties.length} recorded part…`.
3. A screened user compares `mattersAll.length` against the matter picker in the topbar (kernel/html.js:161, built from wall-filtered `ctx.matters`) and learns exactly how many matters exist behind the wall — existence and cardinality metadata the screen is meant to withhold.
4. Secondary correctness harm: the sentence asserts the check ran against N matters when `candidates()` (line 36) actually ran it against only the visible subset, so a screened user is told a conflict search covered files it never touched.
Refutation attempted: `inquiries.length` and `parties.length` in the same sentence are legitimately firm-level (inquiries are pre-engagement conflicts data by design; parties are filtered at line 130), which makes the unfiltered matter count the single outlier rather than a deliberate firm-level disclosure.

**Fix**

At 02-conflicts.js:133 replace `k.firm.list('matter')` with the wall-aware set already in hand — `const mattersAll = ctx.matters || [];` — so the count reported at line 175 matches the set `candidates()` actually searched.

## 48. audit.log is created world-readable (0644) although it is the one plaintext file in the data directory

**LOW / CONFIRMED** — audit-chain — `app/kernel/audit.js:66`

**Evidence**

```js
fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
```

**How it fails**

No `mode` option is passed, so the file is created with 0o666 masked by the default umask 022, i.e. 0644 — world-readable. kernel/crypto.js:33 and :51 deliberately create root.key and keyring.json with { mode: 0o600 }, so the asymmetry is not intentional. audit.log is the only unencrypted artefact in $CHAMBERS_DATA (deploy/backup.sh:6), and it carries every user's account id and email (auth.js:99), every login source IP (auth.js:38/43/50), matter ids, invoice numbers and totals (34-billing.js:370), service recipients (33-production.js:256), free-text defence names (10-pleadings.js:391) and the full wall.denied history (api.js:27). Any other local account or any process not running as the chambers service user can read the firm's complete activity record. Reachability is limited — the deployment is a single-purpose box per deploy/install.sh — hence LOW.

**Fix**

Create the file explicitly with restrictive permissions in the Audit constructor: if it does not exist, fs.writeFileSync(this.file, '', { mode: 0o600 }); and create the data directory with fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }). Do the same for the lockfile at audit.js:40 ({ flag: 'wx', mode: 0o600 }).

## 49. Sealed logs and blobs are created with the process umask while key material is deliberately 0600

**LOW / CONFIRMED** — store-integrity — `app/kernel/store.js:88`

**Evidence**

```js
const dir = path.join(this.dataDir, 'blobs', matterId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id), seal(key, buf, 'blob:' + id));

// store.js:15 and :33 the same:
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(this.file, line + '\n');
```

**How it fails**

None of the store's four filesystem writes passes a `mode`, so `firm.log`, `matters/<id>.log`, `blobs/<id>/` and every blob are created 0o666/0o777 masked by the process umask — 0644/0755 on a default install. app/kernel/crypto.js:33 and :51 show the intended standard: `fs.writeFileSync(this.rootPath, crypto.randomBytes(32), { mode: 0o600 })` and the same for `keyring.json`. On any host where another local account, a backup agent, or a web-server user shares the box, that account can copy the entire sealed corpus for offline attack, and can read the directory structure directly: `blobs/<matterId>/` enumerates matter ids, the number of documents in each matter and each document's plaintext size to within the GCM overhead. That last part is unencrypted metadata about privileged files. Impact is limited because the contents are AES-256-GCM and the keys are 0600, so this is defence-in-depth rather than a live disclosure of content.

**Fix**

Pass `{ mode: 0o600 }` on the blob `writeFileSync` and the first log write, `{ mode: 0o700 }` on both `mkdirSync` calls, and chmod the data directory itself to 0700 in `Keyring`'s constructor so an existing deployment is tightened on next boot.

## 50. uscourts.search dereferences out.data unconditionally, so a 200 with a non-JSON body crashes the room with an HTTP 500

**LOW / CONFIRMED** — external-apis — `app/kernel/uscourts.js:32`

**Evidence**

```js
const results = (out.data.results || []).slice(0, 20).map((r) => ({
```

**How it fails**

clGet (uscourts.js:15,22) turns any unparseable body into `{ok:true, data:null}` exactly as canlii.js does. `search()` then reads `out.data.results` outside any try/catch, throwing `TypeError: Cannot read properties of null (reading 'results')`. rooms/30-uscourts.js:26 awaits `search` inside an async handler, so the rejection reaches kernel/http.js:75-83 and the seat-holder gets a bare `500 Internal error` instead of a flash. Triggers on any 200-with-non-JSON from CourtListener: a maintenance page, a captive-portal interstitial, an empty body, or the 15s abort firing during the body read (which `.catch(() => null)` also converts into a null body). CONTRACT-SHEET.md §g.3 requires that garbage input flash an error, never 500. Note kernel/cite-resolve.js:73-74 is unaffected — its `.catch()` absorbs the rejection — so only the room path breaks.

**Fix**

Guard in kernel/uscourts.js: after `if (!out.ok) return out;` add `if (!out.data || typeof out.data !== 'object') return { ok:false, status:0, message:'CourtListener returned an unreadable response.' };` before line 32.

## 51. open() has no length guard, so a truncated blob is authenticated against a truncated GCM tag (Node accepts 4–15-byte tags)

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

## 52. Destroying a matter DEK drops the cache entry but never zeroes the key bytes: the plaintext DEK, the tenant KEK and the root key stay resident in the process heap after a shred

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

## 53. Shredding rewrites keyring.json by rename-over, leaving the previous copy — which still contains the destroyed matter's wrapped DEK — in unallocated blocks on the data volume

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

## 54. A matter is committed to the firm log before its DEK is minted, and neither write is fsynced — a crash or ENOSPC in that window leaves a permanently keyless matter that the app reports as neither live nor shredded

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

## 55. POST /r/conflicts/party accepts an arbitrary matter id with no wall check, unlike its sibling /run handler

**LOW / PLAUSIBLE** — authz-walls — `app/rooms/02-conflicts.js:317`

**Evidence**

```js
matterId: target.startsWith('m:') ? target.slice(2) : null,
      inquiryId: target.startsWith('i:') ? target.slice(2) : null,
    };
    k.firm.put('party', rec);
```

**How it fails**

The sibling handler POST /r/conflicts/run validates the same `target` field through the wall — line 286: `const tiedMatter = matterId ? k.matter(matterId) : null;` — so a walled or garbage matter id is dropped and audited 'wall.denied'. The /party handler performs no such check: whatever id follows 'm:' in the submitted form field is stored directly onto a firm-scope `party` record via `k.firm.put` (kernel/api.js:48-52), which applies no wall filter. A screened seat-holder who learns a walled matter's id can therefore write a party record bound to a matter they may not read: that record then joins the conflict graph of UNSCREENED users, where `partyWhere()` (line 56-66) labels it 'matter — <walled matter title>' and it can manufacture spurious conflict hits against a file the writer cannot see. Marked PLAUSIBLE rather than CONFIRMED because the id must be obtained out of band (the room's own `targets` list at line 146 is built from the wall-filtered `ctx.matters`, and the screened user's own reads of the record are suppressed by the `visible.has(p.matterId)` guard at line 48 and the `visibleMatters` filter at line 130) — however finding 1 above (the /admin walls table) is a plausible source for that id in a deployment where wall rows fall back to printing `w.matterId`.

**Fix**

Mirror the /run handler: in 02-conflicts.js:308-320 resolve the target through the wall before storing — `const mid = target.startsWith('m:') ? target.slice(2) : null; const tied = mid ? k.matter(mid) : null;` — and set `matterId: tied ? mid : null`, flashing a refusal when a matter id was supplied but did not resolve.

## 56. kernel facade's ai.chat and ai.policy read a matter record with the raw firm getter, bypassing walledFrom

**LOW / PLAUSIBLE** — authz-walls — `app/kernel/api.js:119`

**Evidence**

```js
policy: (matterId) => { const m = store.firm.get('matter', matterId); return (m && m.aiPolicy) || 'allowed'; },
      // The one path to a model. Policy-checked, audited, never training.
      async chat(matterId, messages, opts) {
        …
        if (matterId) {
          const m = store.firm.get('matter', matterId);
```

**How it fails**

Every other matter-keyed entry point on the facade routes through the wall first — `scope()` calls `requireMatter` (api.js:36), `ledger.post`/`ledger.list` call `requireMatter` (api.js:61, 87), `blob.put`/`blob.get` call `requireMatter` (api.js:140-141), `shred` calls `requireMatter` (api.js:146). `ai.policy` (line 119) and `ai.chat` (line 125) instead hit `store.firm.get('matter', matterId)` directly, so a caller passing a walled matter id gets that matter's `aiPolicy`, has an `ai.call` line written against it in the hash-chained audit log (line 132), and reaches the model gateway with whatever messages it supplied. No exploit exists today: the only caller is rooms/19-moot.js:203, which passes `ctx.matter.id` (already wall-filtered by server.js makeCtx:94), and `ai.policy` has no caller at all. Reported as a latent hole in the facade's own invariant — the next room to pass a body- or query-supplied matter id into `k.ai.chat` gets an unwalled read and a forged-looking audit entry for a matter the actor cannot open.

**Fix**

In kernel/api.js replace both `store.firm.get('matter', matterId)` calls (lines 119 and 125) with the facade's own wall-checked accessor `matter(matterId)`, so a screened caller gets null (audited 'wall.denied') and `chat` returns its existing `{ ok: false, message: 'Matter unavailable.' }` before any audit line or outbound request.

## 57. The recorded s.18 three-way comparison is computed over a wall-narrowed ledger and does not say so

**LOW / PLAUSIBLE** — money-billing-trust — `app/rooms/28-books.js:376`

**Evidence**

```js
const { ledger, liabilities, statement, ok } = threeWay(ctx, k, stmt);
    k.firm.put('reconciliation', {
      statementDate: sdate, statementBalance: statement === null ? stmt : statement,
      ledger, liabilities, ok, byName: ctx.user.name,
    });
```

**How it fails**

threeWay() is handed trustView(ctx, k), which restricts balances to matters this caller can see (28-books.js:103, deliberately, so a screened user cannot read a walled matter's trust position). The resulting record is then written to firm scope as THE monthly By-Law 9 s.18 trust comparison — the artifact the Law Society asks for on audit — with legs 1 and 2 covering only part of the trust account and no marker recording whose view produced it. Because a walled matter is excluded from both legs equally, they still agree with each other, so the record can be stored with ok:true whenever the reconciling lawyer enters a leg-3 figure matching their partial ledger instead of the bank's true balance. The reconciliation table at 28-books.js:243 then displays that record to everyone as 'RECONCILED'. This is not a wall break (the narrowing is correct and intentional) and it does not move money; the defect is that a partial comparison is recorded and displayed as a firm-wide one. Marked PLAUSIBLE because the narrowing is documented as deliberate and the harm requires the reconciling user to enter a leg-3 figure that matches their narrowed view.

**Fix**

Stamp the reconciliation record with the view it was computed over — e.g. `scope:'partial'` plus the count of matters included whenever ctx.matters is smaller than the firm's matter list — and render partial records distinctly from full ones, or require the comparison to be run by a user screened from nothing.

## 58. matterId is interpolated into filesystem paths with no shape validation (blob id is validated, matter id is not)

**LOW / PLAUSIBLE** — store-integrity — `app/kernel/store.js:68`

**Evidence**

```js
this._matterScopes.set(matterId, new Scope(path.join(this.dataDir, 'matters', matterId + '.log'), key, 'matter:' + matterId));
  ...
  putBlob(matterId, buf) {
    const key = this.keyring.matterKey(matterId);
    const id = uuid();
    const dir = path.join(this.dataDir, 'blobs', matterId);
  ...
  getBlob(matterId, id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('bad blob id');
```

**How it fails**

`getBlob` validates the blob id against an anchored `/^[0-9a-f-]{36}$/` (which correctly admits no '.' or '/'), but none of `matterScope`, `putBlob` or `getBlob` applies any shape test to `matterId` before concatenating it into a path — a value like '../firm' would resolve `path.join(dataDir,'matters','../firm.log')` onto the firm log, and '../../..' would escape the blob tree entirely. I could not build a working exploit and am reporting it as a missing guard, not a live break: every one of the three entry points calls `this.keyring.matterKey(matterId)` as its first statement, which throws NOKEY unless a wrapped DEK exists under that exact string (app/kernel/crypto.js:59-67), and DEKs are minted only by `store.createMatter` -> `keyring.createMatterKey(rec.id)` where `rec.id` came from `uuid()` (store.js:48,72-75) — kernel/api.js:50 routes to `createMatter` only when `!obj.id`, so a caller-chosen matter id never gets a key. Prototype-shaped ids ('__proto__', 'constructor') are also stopped, incidentally, by the truthy `this.ring.destroyed[matterId]` check throwing SHREDDED first. The exposure is that the store's path safety rests entirely on an invariant enforced two modules away; anything that ever mints a DEK under a non-uuid id (an import/restore tool, a migration, a future 'matter alias') turns this into an arbitrary-file read/write under the matter DEK.

**Fix**

Add the same anchored check the blob id gets — `if (!/^[0-9a-f-]{36}$/.test(matterId)) throw new Error('bad matter id');` — as the first line of `matterScope`, `putBlob` and `getBlob` (and in `createMatter` before `createMatterKey`), so path safety is enforced where the path is built.

## 59. No response-size cap on any of the four connectors: a hostile or misconfigured endpoint can stream an unbounded body into the single-process heap

**LOW / PLAUSIBLE** — external-apis — `app/kernel/ai.js:19`

**Evidence**

```js
const body = await r.json().catch(() => null);
```

**How it fails**

All four connectors (ai.js:19, canlii.js:56, uscourts.js:15, edgar.js:15) call `r.json()`, which buffers the entire response in memory before parsing, with no Content-Length check and no streaming cap. The AbortController bounds duration only — 12s (CanLII), 15s (CourtListener/EDGAR) and 90s (model gateway) — not size, so a compromised upstream or a mis-pointed `ai` endpoint answering at line rate can push hundreds of megabytes into the heap before the timer fires. This is a single-process Node server that holds every open matter's decrypted scope in memory (kernel/store.js:12-14), so heap exhaustion takes down both seats at once and drops in-flight work. Marked PLAUSIBLE: it needs a hostile or badly-behaved upstream, and the abort timer does eventually stop the read, so this is availability only — no confidentiality consequence.

**Fix**

Read the body as a stream with a byte budget (e.g. 8 MB) and reject past it, or at minimum refuse when `Number(r.headers.get('content-length'))` exceeds the budget before calling `r.json()`. Apply the same cap to all four connectors.

---

## Addendum — defects found by the T5 e2e agents (2026-08-26)

Nine agents wrote behavioural suites and were forbidden from fixing app code or
weakening an assertion to make it pass. Five real defects surfaced that way.

**Fixed, each red-green verified:**

1. **Silent matter substitution on write routes** (`server.js`). A request naming
   a matter the user cannot open — walled, shredded, or unknown — fell through to
   `matters[0]` instead of being refused. Proven on a money route: a bill run
   carrying the walled matter's id created a numbered draft invoice on a
   *different client's* matter, with a success flash naming neither. Now a named
   matter that does not resolve stays null; the convenience default applies only
   when no matter was named. Pinned in `test/wall.test.js`.

2. **cite-resolve treated any 200 as a resolution** (`kernel/cite-resolve.js`).
   `kernel/canlii.js` returns `{ok:true, data:null}` when a 200 body fails to
   parse, and the resolver hardcoded `resolved:true` with the *citation string*
   echoed back as the case title. Room 08 then flashed "Connector matched
   2011 ONCA 9999" and rendered "connector found a match" directly above the
   checkbox "Resolves to a real case — looked up, not assumed": machine
   corroboration for a case that does not exist, which is exactly the
   hallucinated-citation failure this gate exists to prevent. A resolution now
   requires a real title from the payload, and the query is never its own answer.
   Same rule applied to the CourtListener branch. Pinned in `test/cite.test.js`.

3. **Bates collision past DEF-999999** (`rooms/13-review.js`). `nextBates()`
   matched `/^DEF-(\d{6})$/`, so the first document past 999999 got
   `DEF-1000000`, which the regex no longer matched — the scan fell back and
   issued the same number again. Two documents sharing a bates number breaks
   document identity in a production and on the privilege log. Widened to
   `\d+`; `padStart` keeps six the minimum width.

**Reported, deliberately NOT changed — these are design calls for the lawyers:**

4. **Supplemental productions re-produce everything** (`rooms/33-production.js`).
   Assembly builds the producible set from coding alone and never excludes
   documents already frozen into an earlier volume, so PROD002 re-serves all of
   PROD001 and the two volumes' bates ranges overlap. The room's own advice
   ("recode before assembling") is worse than the disease: recoding a produced
   document to `responsive:'no'` is the only way to get a clean supplemental
   volume, and `35-affidavit.js` derives Schedule A of the Rule 30.03 affidavit
   from the same coding — so the workaround silently drops produced documents out
   of sworn evidence. Either exclude already-produced ids at assembly, or state
   that re-production is intended. Not for me to decide.

5. **Chronology filter widens on the way to the extract**
   (`rooms/06-chronology.js`). The timeline filters `actor` exactly; the
   "Statement of facts →" handoff re-filters by substring, so a filtered extract
   headed `actor "Doe"` also contains "J. Doe Holdings" facts the user was not
   looking at. The narrative's own form says "Actor contains", so substring is
   intended *there* — the defect is the one-click handoff between two different
   semantics. Same divergence exists for the issue filter.
