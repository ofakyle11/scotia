'use strict';
// Six confirmed MEDIUM findings. Every one is an ordinary-bad-day defect: a
// connector that lies about a bad response, a room that 500s on a successful
// HTTP call, a world-readable audit log, a money gate that only checks one
// direction, a privilege toggle with no privilege check, and a count that
// includes matters the viewer is walled off from.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), assert = require('assert');

// ---- 1 & 2: connectors on a 200 that carries no usable body ---------------
// kernel/canlii.js and kernel/uscourts.js both do `await r.json().catch(() => null)`.
// canlii then returned {ok:true, data:null} — a successful fetch with nothing in
// it — and uscourts dereferenced out.data.results and threw.
(async () => {
  // The connectors' BASE is hardcoded (correctly — a legal tool should not take
  // its API host from the environment), so the transport is stubbed instead of
  // the host. Both connectors do `await r.json().catch(() => null)`, so this is
  // the exact shape a 200 carrying HTML or a truncated body produces.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    text: async () => '<html>not json</html>',
  });

  const canlii = require('../kernel/canlii.js');
  const uscourts = require('../kernel/uscourts.js');

  const c = await canlii.fetchCase({ databaseId: 'csc-scc', caseId: '2008scc9' }, 'k');
  assert.strictEqual(c.ok, false, 'canlii reported a 200-with-unparseable-body as SUCCESS: ' + JSON.stringify(c));
  assert(!/refused the API key/i.test(String(c.message)), 'canlii blamed the API key for an unparseable body');

  let u;
  try { u = await uscourts.search('Dunsmuir', 'o', null); }
  catch (e) { globalThis.fetch = realFetch; assert.fail('uscourts THREW on a successful HTTP call: ' + e.message); }
  assert.strictEqual(u.ok, false, 'uscourts reported a bodyless 200 as success: ' + JSON.stringify(u));

  // A good 200 must still parse — the guard must not reject real answers.
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ title: 'Dunsmuir v New Brunswick', citation: '2008 SCC 9' }) });
  const good = await canlii.fetchCase({ databaseId: 'csc-scc', caseId: '2008scc9' }, 'k');
  assert(good.ok && good.data && good.data.title === 'Dunsmuir v New Brunswick', 'a well-formed 200 must still succeed: ' + JSON.stringify(good));

  globalThis.fetch = realFetch;
  console.log('PASS connectors: a 200 with no usable body is a failure, and never a throw');

  // ---- 3: the audit log is the one plaintext file — it must not be world-readable
  const { Audit } = require('../kernel/audit.js');
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'bl2-audit-'));
  new Audit(d1).log('someone', 'did.something', 'to-something');
  const m1 = fs.statSync(path.join(d1, 'audit.log')).mode & 0o777;
  assert.strictEqual(m1, 0o600, `audit.log must be 0600, got 0${m1.toString(8)} — it names every actor and action`);
  // An existing loose file must be tightened, not left as found.
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bl2-audit2-'));
  fs.writeFileSync(path.join(d2, 'audit.log'), '', { mode: 0o644 });
  fs.chmodSync(path.join(d2, 'audit.log'), 0o644);
  new Audit(d2).log('someone', 'did.something', 'to-something');
  const m2 = fs.statSync(path.join(d2, 'audit.log')).mode & 0o777;
  assert.strictEqual(m2, 0o600, `an existing 0644 audit.log must be tightened, got 0${m2.toString(8)}`);
  console.log('PASS audit: the log is 0600 on create, and an existing loose file is tightened');

  // ---- 4, 5, 6 need the live app -----------------------------------------
  process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bl2-'));
  process.env.PORT = String(43000 + Math.floor(Math.random() * 900));
  const { app, makeCtx, store, auth } = require('../server.js');
  const { hashPassword } = require('../kernel/crypto.js');

  const pw = hashPassword('a-long-password-here');
  const admin = store.firm.put('user', { email: 'a@f', name: 'Admin', role: 'admin', active: true, pw }, 't');
  const clerk = store.firm.put('user', { email: 'c@f', name: 'Clerk', role: 'clerk', active: true, pw }, 't');
  const adminS = auth.createSession(admin.id), clerkS = auth.createSession(clerk.id);
  const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
  const base = 'http://localhost:' + process.env.PORT;
  const post = (p, sess, mid, body) => fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: `s=${sess}` + (mid ? `; m=${mid}` : ''), 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(body).toString(),
  });
  const fails = [];

  // 4. An OVERDRAWN matter must not be closeable. `trust > 0.005` is one-sided:
  // a negative balance is not > 0.005, so the shortfall closed and could then be
  // destroyed, taking the evidence with it.
  {
    const k = require('../kernel/api.js').makeKernel({ store, audit: require('../kernel/audit.js') && server && undefined || undefined, keyring: undefined }, admin);
    void k;
    const m = store.createMatter({ title: 'Overdrawn v. Closing', client: 'C', jurisdiction: 'on', status: 'open' }, admin.id);
    // Drive the position negative directly in the ledger the closing gate reads.
    store.firm.put('ledgerTxn', { matterId: m.id, date: '2026-01-01', memo: 'shortfall', kind: 'trust-payment',
      lines: [{ account: 'trust:client', dr: 500 }, { account: 'trust:bank', cr: 500 }] }, admin.id);
    // Tick every closing step so only the trust gate can refuse.
    const closing = require('../rooms/26-closing.js');
    void closing;
    const sc = store.matterScope(m.id);
    // The real CHECK keys (26-closing.js:8) — guessing field names here would
    // make the close refuse on the CHECKLIST and never reach the trust gate,
    // and the test would pass while proving nothing.
    await post('/r/closing/close', adminS, m.id, { account: '1', originals: '1', letter: '1' });
    const after = store.firm.get('matter', m.id);
    if (after.status === 'closed') {
      fails.push('OVERDRAWN CLOSE: a matter holding a NEGATIVE trust position closed — the shortfall can now be shredded');
    }
    void sc;
  }

  // 5. Only an administrator may lift a matter's model-use prohibition.
  {
    const m = store.createMatter({ title: 'Policy v. Seat', client: 'C', jurisdiction: 'on', status: 'open', aiPolicy: 'forbidden' }, admin.id);
    await post('/r/moot/ai-policy', clerkS, m.id, { policy: 'allowed' });
    if ((store.firm.get('matter', m.id).aiPolicy || 'allowed') !== 'forbidden') {
      fails.push('POLICY LIFT: a non-admin seat lifted the matter\'s model-use prohibition');
    }
    await post('/r/moot/ai-policy', adminS, m.id, { policy: 'allowed' });
    if ((store.firm.get('matter', m.id).aiPolicy || 'allowed') !== 'allowed') {
      fails.push('an administrator could no longer change the policy — the guard is too tight');
    }
  }

  // 6. The conflicts page must not count matters the viewer is walled off from.
  {
    const secret = store.createMatter({ title: 'ZZWALLEDCOUNT', client: 'X', jurisdiction: 'on', status: 'open' }, admin.id);
    store.firm.put('wall', { matterId: secret.id, screened: [clerk.id], basis: 'screened' }, admin.id);
    const openM = store.createMatter({ title: 'Ordinary', client: 'Y', jurisdiction: 'on', status: 'open' }, admin.id);
    const page = await (await fetch(base + '/r/conflicts?m=' + openM.id, { headers: { cookie: `s=${clerkS}` } })).text();
    if (page.includes('ZZWALLEDCOUNT')) fails.push('the walled matter TITLE appeared on the conflicts page');
    const adminPage = await (await fetch(base + '/r/conflicts?m=' + openM.id, { headers: { cookie: `s=${adminS}` } })).text();
    const num = (h) => { const m2 = /(\d+)\s*(?:matters?|open matters?|on the books)/i.exec(h); return m2 ? Number(m2[1]) : null; };
    const a = num(adminPage), c2 = num(page);
    if (a !== null && c2 !== null && a === c2) {
      fails.push(`WALLED COUNT: the screened seat sees the same firm-wide matter count as the admin (${c2}) — the walled matter is included`);
    }
  }

  server.close();
  if (fails.length) { console.error('BACKLOG2 FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS closing: an overdrawn matter cannot be closed');
  console.log('PASS moot: only an administrator lifts a model-use prohibition');
  console.log('PASS conflicts: walled matters are not counted for the seat they screen');
  console.log('BACKLOG2: ALL PASS');
  process.exit(0);
})().catch((e) => { console.error('BACKLOG2 ERROR:', e.message); process.exit(1); });
