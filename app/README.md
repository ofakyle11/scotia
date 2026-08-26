# Chambers — the 36-room firm

A private, encrypted practice platform for a two-lawyer firm. One command runs it:
`node server.js`. No npm packages, no database server, no external service required
to work.

- **Closed by design** — no landing page, no signup, no public surface. First boot
  prints one single-use invite per seat; each person sets their own password and
  their own second factor. Accounts exist only by provisioning.
- **AES-256-GCM everywhere** — envelope keys: root file key → tenant KEK → one DEK
  per matter → per-record and per-blob sealing. Matter state is an append-only log
  of sealed events; destroying a matter's key makes its history unreadable
  everywhere, permanently.
- **Hash-chained audit** — every login, denial, key event and ledger post lands in a
  SHA-256 chain holding metadata only, never content.
- **36 rooms over one kernel** — the pipeline from intake to closing, plus the
  always-on desks and four research connectors.

---

## Run it

```
cd app
node server.js
```

That is the whole install. It prints one invite per seat and serves on
<http://localhost:8028>:

```
  FIRST BOOT — seat invites (single use each, 7 days):
  Dan G (admin):  http://localhost:8028/invite/8NbZFOMk7SxXrH7ScXCp3DmCLot2dxmT
  Matt D (admin):  http://localhost:8028/invite/SFIjkPMkp_Gm2oUvK9aPfUdVoQplJZn4

Chambers listening on http://localhost:8028 (bound to 127.0.0.1, data: .../app/data)
```

Requires **Node 22** and nothing else. Data lands in `app/data/` (override with
`CHAMBERS_DATA`); the port is `PORT`. The server binds `127.0.0.1` deliberately —
set `CHAMBERS_HOST=0.0.0.0` only behind a TLS proxy, never on the open internet.

Want something to look at? `node tools/seed-demo.js` seeds one demonstration
matter after you have enrolled.

### Enrollment — two seats, self-set credentials

The seat list is fixed at first boot (`CHAMBERS_SEATS`, default `Dan G:admin,Matt
D:admin`). Nothing is pre-shared: an invite carries a *name and a role*, and the
person supplies their own email and password.

1. Open your invite link. Single use, expires in 7 days.
2. Enter your email and a password of **12 characters or more**. That email becomes
   your sign-in.
3. You land on `/account` with a prompt to turn on 2FA. Do it now — "Begin
   enrollment" prints a secret for any authenticator app (1Password, Aegis, Google
   Authenticator). Enrollment completes only after you prove a working code, and
   once enabled 2FA is required at every sign-in.

The build is **seat-locked to exactly two active accounts**. A third invite is
refused — from `/admin` and from the console alike:

```
Seat lock: this build is limited to 2 enrolled accounts.
```

A used invite is gone: replaying the link returns `404 Not found.` To replace a
departing seat holder you must first release their seat — see
[`docs/OPERATIONS.md`](../docs/OPERATIONS.md).

---

## The test gate

One command runs everything. It discovers every suite in `test/`, so a new test
file is picked up with no edit to the runner and no edit to CI.

```
cd app
node test/run-all.js
```

```
CHAMBERS GATE
-------------
13 suites · node v22.22.2 · /home/user/scotia/app · 2026-08-26T13:21:05.887Z

   1/13  canlii.test.js     PASS        0.05s
   2/13  totp.test.js       PASS        0.06s
   3/13  crypto.test.js     PASS        0.12s
   4/13  audit.test.js      PASS        0.12s
   5/13  replay.test.js     PASS        0.35s
   6/13  gate.test.js       PASS        0.34s
   7/13  improve.test.js    PASS        0.35s
   8/13  pleadcite.test.js  PASS        0.35s
   9/13  seam.test.js       PASS        0.38s
  10/13  seats.test.js      PASS        0.44s
  11/13  harness.js         PASS        0.69s
  12/13  seeded.test.js     PASS        0.40s
  13/13  browser.test.js    PASS       44.80s

13 suites run: 13 passed, 0 failed  in 48.44s

GATE: PASS
```

Exit 0 = green (a cleanly skipped suite counts as green), 1 = a suite failed or
timed out, 2 = the runner could not run.

| suite | what it proves |
|---|---|
| `canlii.test.js` | citation parsing + CanLII id derivation, entirely offline |
| `totp.test.js` | RFC 6238 TOTP vectors |
| `crypto.test.js` | matter logs and blobs are ciphertext on disk; ethical walls deny *before* any key unwrap; a shredded matter is unreadable forever |
| `audit.test.js` | the hash chain detects forgery; two writers extend one chain |
| `replay.test.js` | a TOTP code that has worked once can never work again |
| `gate.test.js` | the citation gate: extract → block → verify → clear → file |
| `improve.test.js` | cross-room handshakes |
| `pleadcite.test.js` | a pleading is citation-scannable end to end |
| `seam.test.js` | the cross-room seams hold (limitation flags, foreign deadlines survive recompute) |
| `seats.test.js` | two named seats, self-set credentials, no third account |
| `harness.js` | **all 36 rooms render, no POST 500s — EMPTY state** |
| `seeded.test.js` | **all 36 rooms render WITH real records of every type** — the important one |
| `browser.test.js` | drives real Chromium through real enrollment; **skips cleanly with no browser** |

Useful flags: `--list` (print the plan, run nothing), `--verbose`, `--bail`,
`--timeout=90000`, or a filter — `node test/run-all.js crypto gate`.

Both room suites matter. `harness.js` alone only ever proved that every room
renders with *nothing in it*; `seeded.test.js` exists because a room passed the
empty harness while returning HTTP 500 for any matter that had real records in it.

---

## Architecture

**Zero dependency is a checked fact, not an aspiration.** There is no
`package.json`, no `package-lock.json` and no `node_modules` anywhere in `app/`.
Every `require()` in the whole tree resolves to a relative path or a Node builtin —
`crypto`, `fs`, `path`, `http`, `url` in the app itself, plus `assert`,
`child_process` and `os` in tests only.

```
app/
  server.js        the front door: sessions, enrollment, /admin, /account, mounts rooms
  kernel/          store · crypto · auth · audit · ledger · rules · html · http · connectors
  rooms/           36 modules, one file each: rooms/NN-<id>.js
  test/            the gate — run-all.js discovers everything here
  tools/           seed-demo.js, invite.js
  deploy/          install/update/backup/restore/healthcheck + systemd unit + Caddyfile
```

`kernel/registry.js` is the authoritative room list — **36 rooms, 01–36**, mounted in
that order. Count the registry, never a prose sentence.

| phase | rooms | |
|---|---|---|
| Intake | 5 | Intake Desk · Ethics & Conflicts · Retainer · Case Value · Client Desk |
| Build | 6 | Chronology · Research · Citation Check · Jurisdiction · Pleadings · Court Book |
| Discover | 8 | Discovery · Document Review · Depositions · Experts · Evidence · Tools ×20 · Production · Affidavit of Documents |
| Argue | 5 | Brief Writer · Moot Room · Trial Book · Trial Calendar · Filing Room |
| Resolve | 4 | Mediation & ADR · Settlement Waterfall · Judgment & Enforcement · Closing Room |
| Always on | 8 | Workflow · Trust & Books · CanLII · PACER/RECAP · EDGAR · Sources · Billing · Client Portal |

Rooms are deliberately powerless. A room module may require **only**
`../kernel/html.js` and `../kernel/http.js` — no `fs`, no `crypto`, no `fetch`, no
network of any kind — and reaches all state through `ctx.kernel`. All 36 comply;
`CONTRACT.md` is the module contract and `../docs/CONTRACT-SHEET.md` is the data
contract underneath it.

Storage is an encrypted event log, not a database. The firm log seals under the
tenant KEK; each matter log seals under its own DEK. Nothing is ever updated in
place, which is why a backup is a `tar` of one directory and a restore is untarring
it next to the right key.

### Security posture, in one place

- Sessions live in **server memory only** — a restart signs everyone out, by design.
  8h sliding, `HttpOnly`, `SameSite=Strict`, `Secure`.
- Login is uniform-time (an unknown account and a wrong password cost the same
  scrypt), rate-limited to 20 attempts per IP per 15 minutes, and audited either way.
- A TOTP code is burned on use and cannot be replayed inside its window.
- Every response carries CSP (nonce-based), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: same-origin` and `X-Robots-Tag: noindex, nofollow`. Bodies are
  capped at 25 MB. Form POSTs are origin-checked, and an opaque or unparseable
  origin is refused, not crashed on.
- There is exactly **one** session-less route: `GET /r/calendar/feed/:token`, the
  RFC 5545 phone feed, whose credential is the unguessable token in the path. It
  builds the kernel for the feed's owner, so every ethical wall and shred that binds
  that user binds the feed. Every rejection returns the same constant 404. Do not
  add a second cookie-less surface.

---

## What needs a real host, and what does not

Honestly:

**Runs on a laptop, right now, with nothing else installed.** The entire
application — all 36 rooms, encryption at rest, enrollment, 2FA, the ledger and
trust accounting, the deadline engine, the citation gate, backups and restores.
There is no database to provision, no Redis, no queue, no build step. The full test
gate runs offline; only `browser.test.js` wants Chromium, and it skips cleanly
without one. If you want to evaluate Chambers, you never need to deploy anything.

**Needs a real host.** Anything with real client matters in it:

- **TLS and a domain.** The session cookie is `Secure`. Browsers make an exception
  for `http://localhost`, which is why local development works — but reach the same
  server over a LAN IP and sign-in silently fails. Any access that is not
  `localhost` needs real HTTPS. (`CHAMBERS_INSECURE_COOKIES=1` exists for
  diagnosing that; it is not for production.)
- **Reachability.** The app binds loopback. Multi-device access means a reverse
  proxy — `deploy/Caddyfile` terminates TLS and proxies `127.0.0.1:8028`.
- **Uptime and durability.** A laptop that sleeps is not a server, and `app/data/`
  on one machine is not a backup.
- **Data residency and key escrow.** A Canadian practice puts the box in a Canadian
  region and escrows `root.key` off the machine on day one.

**Needs the internet but not a host** — four optional connectors, each degrading to
something honest rather than breaking:

| service | credential | without it |
|---|---|---|
| CanLII | API key | link-out mode: citation scanning and CanLII deep links still work; live resolution and the citator do not |
| CourtListener / RECAP | API token (optional) | searches still work, at anonymous rate limits |
| EDGAR | a declared contact email (SEC fair-access) | the EDGAR room searches nothing until an admin sets one |
| Model gateway | an OpenAI-compatible endpoint | the gateway is off and every other room is unaffected |

Nothing above is required for the practice workflow. Chambers with all four absent
is a complete, working system.

For provisioning, the one-command install, day-2 operations, key escrow, the restore
drill, and what to do when a seat is locked out, see
**[`docs/OPERATIONS.md`](../docs/OPERATIONS.md)**. For the deployment kit's internals
— the hardened systemd unit, secrets discipline, the optional local model service —
see [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md).
