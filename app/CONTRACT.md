# Room module contract — Chambers

Every room is one file: `rooms/NN-<id>.js` (NN = zero-padded number). It must run
under `node server.js` with ZERO npm dependencies and follow this contract exactly.
`rooms/01-intake.js` is the reference implementation — read it first, mimic its shape.

`kernel/registry.js` is the authoritative room list: **36 rooms** (01–36), mounted in
that order by `server.js`. Any other count you find in a comment or doc is stale — count
the registry, never a prose sentence.

## Export shape
```js
module.exports = { num, id, title, phase, register };
function register(app) {
  app.route('GET', `/r/<id>`, (req, res, ctx) => { ... });      // REQUIRED
  app.route('POST', `/r/<id>/<action>`, (req, res, ctx) => { ... });
}
```

## Allowed requires — nothing else
```js
const { layout, esc, table, empty, tag, kv, input, textarea, select, date, money } = require('../kernel/html.js');
const { html, redirect, send } = require('../kernel/http.js');
```
NO `fs`, `net`, `http`, `child_process`, `crypto`, no npm packages, no fetch, no
external calls of any kind. All state goes through `ctx.kernel`. All markup through
the helpers; every user string through `esc()`.

## ctx (built by the server; you never build it)
- `ctx.user` — {id, name, email, role: 'admin'|'lawyer'|'clerk'}
- `ctx.matter` — currently selected matter (may be null!) {id, title, client, jurisdiction, status, posture, adverse[]}
- `ctx.matters` — all matters visible to this user (walls already applied)
- `ctx.body` — POST form fields (strings); `ctx.query` — URLSearchParams; `ctx.params`
- `ctx.setFlash(msg, kind?)` — one-shot banner; kind 'err' for errors
- `ctx.kernel` — the ONLY way to touch data:
  - `k.scope(matterId).list(type, filter?) / .get(type, id) / .put(type, obj) / .del(type, id)` — ENCRYPTED per-matter storage (AES-256-GCM under that matter's key). Use for all matter content. `put` assigns id/createdAt when absent.
  - `k.firm.list/get/put/del(type, ...)` — firm-wide records (matters metadata, inquiries, directories). Never put privileged content here.
  - `k.createMatter(meta)` — mints the matter AND its encryption key.
  - `k.ledger.post(matterId, {date?, memo, kind, lines:[{account, dr?, cr?}]})` — dual-entry, throws if unbalanced or if it takes fees from trust without kind:'trust-transfer'. `k.ledger.list(matterId?)`, `k.ledger.balances(matterId?)`.
  - `k.rules` — the deadline engine, i.e. `kernel/rules.js` in full: `{JURISDICTIONS, RULES, HOLIDAYS, rulesFor(jur) -> rule[], rule(id) -> rule|undefined, compute(rule, isoDate) -> isoDate, isBusinessDay(dateObject, jur) -> bool, isLimitation(rule) -> bool, landsOnNonBusinessDay(rule, isoDate) -> bool, computeLimitation(rule, isoDate) -> {date, weekendOrHoliday, limitation}}` — note `isBusinessDay` takes a **Date object**, everything else an ISO `YYYY-MM-DD` string. A rule is `{id, jur, category:'limitation'|'procedural', trigger, days, method:'calendar'|'business', desc, cite}`. `compute()` rolls a **procedural** deadline forward off weekends/holidays and deliberately does **not** roll a **limitation/prescription** date (a true statutory expiry must never be pushed to a later, false-safe day) — pair it with `landsOnNonBusinessDay()` or `computeLimitation()` and warn counsel instead. 09-jurisdiction already relies on `isLimitation`.
  - `k.blob.put(matterId, buf) -> id`, `k.blob.get(matterId, id) -> Buffer` — encrypted files.
  - `k.audit(action, object)` — extra audit events (routine puts are audited automatically).
  - `k.isAdmin()`, `k.shred(matterId)` (admin only), `k.isShredded(matterId)`.
  - `k.citeResolve` — `kernel/cite-resolve.js` surfaced through the facade: `{detect(cite), US_CITE_RX, resolve(cite)}`. `detect` is a pure offline classifier (`{jurisdiction:'CA'|'US'|null, raw, ca}`); `resolve` is the **one-argument, kernel-already-bound** form and **never throws** — an unrecognised cite, a missing API key or no match all return `{resolved:false, source, title, url, note}`. Each call that actually reaches CanLII/CourtListener is audited before it leaves; the cite string itself is never logged.
  - `k.trust` — `kernel/trust.js` surfaced through the facade: `{perMatterTrustBalance, wouldNotOverdraw, wouldNoverdraw (alias), replenishmentNeeded, threeWayCheck}`. Pure, read-only LSO By-Law 9 s.7/s.18 arithmetic over `k.ledger.balances` (already wall-filtered), kernel-bound — pass your own narrower kernel-like `{ledger:{balances}}` as the first argument only when you must restrict the view further.
  - **`citeResolve` and `trust` are kernel modules a room may never `require`** (see Allowed requires) — the facade is the only door, and only where it exposes them. Check `ctx.kernel.citeResolve` / `ctx.kernel.trust` for presence and degrade gracefully when absent.

## Session-less routes — there is exactly ONE
Every `/r/...` route requires a signed-in session, with one deliberate exception:
`GET /r/calendar/feed/:token`, the RFC 5545 phone feed, whose credential is the
unguessable `calfeed` id in the path (a calendar app subscribes with no cookie jar).
`makeCtx` admits that exact pattern — GET only, one path segment, nothing nested — and
builds the kernel for the feed's **owner**, so every ethical wall, shred and matter filter
that binds that user binds the feed too. A token that is unusable for any reason (wrong
shape, unknown, owner deleted or deactivated) gets a constant `404 Not found.` — the same
answer the room's own handler gives an unknown token, so the route distinguishes nothing
and cannot be walked to enumerate tokens or accounts. That ctx has `matter: null`, no
flash, and grants nothing beyond the feed. **Do not add a second cookie-less surface** —
in particular there is no client login and no unauthenticated read route for a client pack.

## Rendering
```js
html(res, layout({ ...ctx, room: '<id>' }, { title: '<Title>', sub: '<one-line role>', body }));
```
- If the room needs a matter and `ctx.matter` is null: render `empty('Open a matter to ...')` — never crash.
- POST handlers: validate, act, `ctx.setFlash(...)`, `redirect(res, '/r/<id>')`. NEVER leave a POST without responding. Empty/garbage form input must not 500 — validate and flash an error instead.
- Type names in scope storage are yours per room (e.g. 'fact', 'authority', 'exhibit') — pick clear nouns; reuse another room's types when genuinely shared (deadlines: 'deadline' {desc, due, rule, trigger, status}; documents: 'document'; time: 'timeEntry').

## Honesty rules
- No fabricated legal data presented as authoritative. Small reference datasets are fine when labeled as reference/tranche (see kernel/rules.js style: real citations, clearly scoped).
- Where the full build needs an external corpus/model/API (per the Build Sheet), implement the WORKFLOW and record-keeping now, and render a clearly-marked integration note (e.g. `<p class="note">Resolution against CourtListener/CAP wires in here — Build Sheet L07.</p>`). Do not fake the integration's output.
- Every citation-like string you ship as reference data must be real.

## Definition of done
`node test/harness.js <id>` prints ALL PASS. The page renders with real controls
(forms that work), handles the empty state, and reads like the room specs in the
three planning docs (see /home/user/scotia/*.html source for the room's description).
