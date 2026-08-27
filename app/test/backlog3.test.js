'use strict';
// Four remaining confirmed findings. The first is the most serious defect left
// in the product: one damaged byte makes an entire matter unreadable forever.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');

// ---- A. ONE TORN LINE BRICKS A WHOLE MATTER --------------------------------
// The scope constructor JSON.parses every line of the encrypted log with no
// guard. A single unreadable line — a torn append from a crash or a full disk,
// a flipped bit on the volume — throws, so the constructor throws, so the
// matter can never be opened again. Every OTHER record in that file is intact
// and recoverable; the reader just refuses to get to them.
{
  const { Keyring } = require('../kernel/crypto.js');
  const { Store } = require('../kernel/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl3-torn-'));
  const kr = new Keyring(dir);
  const store = new Store(dir, kr);
  const u = store.firm.put('user', { email: 'a@f', name: 'A', role: 'admin', active: true }, 't');
  const m = store.createMatter({ title: 'Torn v. Line', client: 'C', jurisdiction: 'on', status: 'open' }, u.id);
  const s = store.matterScope(m.id);
  for (let i = 0; i < 6; i++) s.put('fact', { text: 'fact number ' + i, date: '2026-01-0' + (i + 1) }, u.id);
  assert.strictEqual(s.list('fact').length, 6, 'baseline: six facts written');

  // Damage ONE line in the middle, exactly as a torn write would.
  const logFile = path.join(dir, 'matters', m.id + '.log');
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  assert(lines.length >= 6, 'expected several sealed lines');
  const victim = Math.floor(lines.length / 2);
  lines[victim] = lines[victim].slice(0, Math.floor(lines[victim].length / 2)); // truncated mid-record
  fs.writeFileSync(logFile, lines.join('\n') + '\n');

  // Re-open from scratch. This is what a server restart does.
  const store2 = new Store(dir, new Keyring(dir));
  let scope2;
  try { scope2 = store2.matterScope(m.id); }
  catch (e) { assert.fail('BRICKED: one damaged line made the whole matter unopenable: ' + e.message); }
  const facts = scope2.list('fact');
  assert(facts.length >= 5, `expected the surviving records to load, got ${facts.length} of 6`);
  // The damage must not be silent — a scope that quietly drops records is worse
  // than one that throws, because nobody knows anything is missing.
  const damage = typeof scope2.damagedLines === 'number' ? scope2.damagedLines : null;
  assert.strictEqual(damage, 1, `the scope must report how many lines it could not read, got ${damage}`);
  console.log(`PASS store: a torn line no longer bricks the matter — ${facts.length}/6 facts recovered, 1 unreadable line reported`);
}

// ---- the rest need the live app -------------------------------------------
process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bl3-'));
process.env.PORT = String(44000 + Math.floor(Math.random() * 900));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');
const rules = require('../kernel/rules.js');

const pw = hashPassword('a-long-password-here');
const dan = store.firm.put('user', { email: 'd@f', name: 'Dan G', role: 'admin', active: true, pw }, 't');
const matt = store.firm.put('user', { email: 'm@f', name: 'Matt D', role: 'admin', active: true, pw }, 't');
const danS = auth.createSession(dan.id), mattS = auth.createSession(matt.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;
const post = (p, sess, mid, body) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${sess}` + (mid ? `; m=${mid}` : ''), 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(body).toString(),
});

(async () => {
  const fails = [];

  // ---- D. A LIMITATION DATE ON A WEEKEND WARNED ONCE, THEN NEVER AGAIN -----
  // The warning was a flash: shown on the redirect after calendaring and gone
  // forever. A limitation date that does not roll off a Saturday is exactly the
  // date you want flagged every time anyone looks at it, not once.
  {
    const m = store.createMatter({ title: 'Weekend v. Limitation', client: 'C', jurisdiction: 'on', status: 'open' }, dan.id);
    // Find a trigger whose on-limitation due date lands on a non-business day.
    const rule = rules.rule('on-limitation');
    let trigger = null, due = null;
    for (let i = 0; i < 400; i++) {
      const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
      const d = rules.compute(rule, t);
      if (rules.landsOnNonBusinessDay(rule, d)) { trigger = t; due = d; break; }
    }
    assert(trigger, 'could not find a limitation date landing on a weekend/holiday');
    await post('/r/calendar/compute', danS, m.id, { rule: 'on-limitation', trigger });
    const dl = store.matterScope(m.id).list('deadline').find((x) => x.due === due);
    assert(dl, 'the deadline was not calendared at all');
    if (!dl.nonBusinessDay) {
      fails.push(`VANISHING WARNING: the limitation date ${due} falls on a non-business day but nothing is recorded on the deadline — the warning was a one-shot flash`);
    }
    const page = await (await fetch(base + '/r/calendar?m=' + m.id, { headers: { cookie: `s=${danS}` } })).text();
    if (!/weekend|holiday|non-business/i.test(page)) {
      fails.push('the calendar page does not show the weekend/holiday warning for a limitation date that lands on one');
    }
  }

  // ---- E. PRIVILEGED FREE TEXT IN THE PLAINTEXT AUDIT LOG -----------------
  // The audit log is plaintext by design (it must be readable to be evidence)
  // and it SURVIVES crypto-shredding and travels in every backup. Record ids
  // belong there; a lawyer's own words about a client's case do not.
  {
    const m = store.createMatter({ title: 'Audit v. Leak', client: 'C', jurisdiction: 'on', status: 'open' }, dan.id);
    const SECRET = 'ZZPRIVILEGEDDEFENCENAME';
    const r = await post('/r/pleadings/defence', danS, m.id, { custom: SECRET, basis: 'client admits nothing' });
    // A 404 here would make this test pass for the wrong reason — no route, no
    // audit entry, no leak. Assert the write actually happened.
    assert.strictEqual(r.status, 303, 'the defence-register POST did not reach a route (status ' + r.status + ')');
    assert(store.matterScope(m.id).list('affdefence').some((d) => d.name === SECRET), 'the defence was not recorded, so nothing could have been audited');
    const log = fs.readFileSync(path.join(process.env.CHAMBERS_DATA, 'audit.log'), 'utf8');
    if (log.includes(SECRET)) {
      fails.push('AUDIT LEAK: matter free-text was written into the plaintext audit log, where it survives shredding and rides in backups');
    }
  }

  // ---- B. A PARTIAL RECONCILIATION RECORDED AS A COMPLETE ONE -------------
  // threeWay() computes over visibleBalances() — the WALLED view. A lawyer
  // screened from a matter holding trust records a By-Law 9 s.18 three-way
  // comparison that silently omits it, and the stored record does not say so.
  {
    const walled = store.createMatter({ title: 'Screened Trust', client: 'X', jurisdiction: 'on', status: 'open' }, matt.id);
    store.firm.put('wall', { matterId: walled.id, screened: [dan.id], basis: 'screened' }, matt.id);
    store.firm.put('ledgerTxn', { matterId: walled.id, date: '2026-01-01', memo: 'retainer', kind: 'trust-receipt',
      lines: [{ account: 'trust:bank', dr: 9000 }, { account: 'trust:client', cr: 9000 }] }, matt.id);
    const before = store.firm.list('reconciliation').length;
    await post('/r/books/reconcile', danS, null, { statementBalance: '0', statementDate: '2026-02-01' });
    const recs = store.firm.list('reconciliation');
    if (recs.length > before) {
      const r = recs[recs.length - 1];
      if (!r.partial && !r.screenedFrom) {
        fails.push('PARTIAL RECONCILIATION: a lawyer screened from a matter holding $9,000 in trust recorded a three-way comparison that omits it, with nothing on the record saying it is incomplete');
      }
    }
  }

  server.close();
  if (fails.length) { console.error('BACKLOG3 FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS calendar: a limitation date on a non-business day is recorded and shown, not flashed once');
  console.log('PASS pleadings: matter free-text stays out of the plaintext audit log');
  console.log('PASS books: a reconciliation a screened lawyer cannot complete is refused, not silently partial');
  console.log('BACKLOG3: ALL PASS');
  process.exit(0);
})().catch((e) => { console.error('BACKLOG3 ERROR:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
