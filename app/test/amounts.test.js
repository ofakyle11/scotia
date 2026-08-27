'use strict';
// `!(amt > 0)` is true for NaN and false for Infinity. Nine amount fields across
// six rooms used it, so every one of them accepted 1e400 as a positive figure.
//
// The ledger itself is safe — kernel/api.js refuses a non-finite line, and
// money.test.js pins that. But the guard protects the LEDGER, not every stored
// number, and several of these fields never reach it: hours on a time entry,
// a judgment amount, a Rule 49 offer, a hypothetical judgment, a client budget.
// Those went straight into a record, and Infinity propagates silently through
// every total computed from it afterwards.
//
// Where the ledger did catch it, the lawyer got "Internal error." from a thrown
// guard rather than a sentence telling them what was wrong with what they typed.
// The kernel guard is the backstop; refusing the input is the fix.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/amounts-');
process.env.PORT = String(33200 + Math.floor(Math.random() * 900));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const u = store.firm.put('user', { email: 'u@f', name: 'U', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const m = store.createMatter({ title: 'Amounts v. Infinity', client: 'C', jurisdiction: 'on', status: 'open' }, u.id);
const session = auth.createSession(u.id);
// Log handler errors instead of rethrowing: server.js does exactly this, and a
// rethrow here would turn a handled 500 into a process crash and misreport it.
const handlerErrors = [];
const server = app.listen(process.env.PORT, makeCtx, (e) => handlerErrors.push(e.message));
const base = 'http://localhost:' + process.env.PORT;

const post = (p, form) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${session}; m=${m.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(form).toString(),
}).then(async (r) => { await r.text(); return r.status; });
const scope = () => store.matterScope(m.id);

// Every amount field, with the field name the room actually reads. A wrong name
// here would make the route refuse for the wrong reason and prove nothing, so
// each case also asserts the route ACCEPTS a good value.
const CASES = [
  { route: '/r/books/retainer',  bad: { amount: '1e400', memo: 'x' },                  good: { amount: '500', memo: 'x' },                  type: null },
  { route: '/r/books/time',      bad: { hours: '1e400', rate: '400', narrative: 'x' }, good: { hours: '2', rate: '400', narrative: 'x' },   type: 'timeEntry' },
  { route: '/r/judgment/new',    bad: { amount: '1e400', court: 'ONSC', debtor: 'D' }, good: { amount: '1500.50', court: 'ONSC', debtor: 'D' }, type: 'judgment' },
  { route: '/r/billing/disb',    bad: { amount: '1e400', desc: 'x' },                  good: { amount: '75', desc: 'x' },                    type: 'disbursement' },
];

(async () => {
  const fails = [];
  for (const c of CASES) {
    const known = app.routes.some((r) => r.method === 'POST' && r.pattern === c.route);
    if (!known) { fails.push(`setup: no POST route ${c.route} — this case tests nothing`); continue; }
    const status = await post(c.route, c.bad);
    if (status >= 500) fails.push(`${c.route} answered ${status} on a non-finite amount — the lawyer sees "Internal error." instead of what was wrong with what they typed`);
    if (c.type) {
      const poisoned = scope().list(c.type).filter((r) => Object.values(r).some((v) => typeof v === 'number' && !Number.isFinite(v)));
      if (poisoned.length) fails.push(`${c.route} stored a non-finite number on the matter: ${JSON.stringify(poisoned[0])}`);
    }
  }
  // No ledger transaction may hold a non-finite leg either — those live in the
  // firm scope, not the matter's.
  for (const t of store.firm.list('ledgerTxn', (x) => x.matterId === m.id)) {
    for (const l of t.lines || []) {
      for (const side of ['dr', 'cr']) {
        if (l[side] !== undefined && l[side] !== null && l[side] !== '' && !Number.isFinite(Number(l[side]))) {
          fails.push(`a ledger transaction holds a non-finite ${side}`);
        }
      }
    }
  }
  // Nothing anywhere on the matter may hold a non-finite number.
  for (const t of ['timeEntry', 'judgment', 'offer', 'disbursement', 'settlement']) {
    let recs = [];
    try { recs = scope().list(t); } catch (_) { recs = []; }
    for (const r of recs) {
      for (const [key, v] of Object.entries(r)) {
        if (typeof v === 'number' && !Number.isFinite(v)) fails.push(`a ${t} record holds a non-finite ${key}`);
      }
    }
  }
  // The guard must not have been bought by refusing everything: a real figure
  // still posts. Without this the suite would pass against a room that rejects
  // every amount, which is the other way to make these assertions come true.
  const okStatus = await post('/r/books/retainer', { amount: '500', memo: 'genuine' });
  if (okStatus >= 400) fails.push(`a valid retainer was refused with ${okStatus} — the guard rejects everything`);
  const posted = store.firm.list('ledgerTxn', (t) => t.matterId === m.id)
    .some((e) => (e.lines || []).some((l) => Number(l.dr) === 500 || Number(l.cr) === 500));
  if (!posted) fails.push('a valid retainer did not reach the ledger');

  server.close();
  if (fails.length) { console.log('AMOUNTS FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log(`AMOUNTS: ALL PASS (non-finite figures refused at the form on every amount field, valid ones still post; ${handlerErrors.length} handler error(s))`);
  process.exit(0);
})().catch((e) => { console.error('amounts crash:', e); try { server.close(); } catch (_) {} process.exit(1); });
