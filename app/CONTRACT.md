# Room module contract — Chambers

Every room is one file: `rooms/NN-<id>.js` (NN = zero-padded number). It must run
under `node server.js` with ZERO npm dependencies and follow this contract exactly.
`rooms/01-intake.js` is the reference implementation — read it first, mimic its shape.

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
  - `k.rules` — {JURISDICTIONS, RULES, rulesFor(jur), rule(id), compute(rule, isoDate)} deadline engine.
  - `k.blob.put(matterId, buf) -> id`, `k.blob.get(matterId, id) -> Buffer` — encrypted files.
  - `k.audit(action, object)` — extra audit events (routine puts are audited automatically).
  - `k.isAdmin()`, `k.shred(matterId)` (admin only), `k.isShredded(matterId)`.

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
