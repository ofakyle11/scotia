'use strict';
// Phase 2 cross-file handshakes: conflicts gate binds intake+retainer; limitation no-roll.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/chambers-improve-');
process.env.PORT = String(25500 + Math.floor(Math.random() * 4000));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');
const rules = require('../kernel/rules.js');

// --- limitation no-roll (the malpractice fix) ---
// on-limitation lands 730 days after a discovery date; find one that lands on a weekend.
const lim = rules.rule('on-limitation');
// 2024-06-15 + 730d = 2026-06-15 (Mon) — pick a trigger whose +730 is a Saturday.
// 2024-06-14 -> 2026-06-14 is a Sunday.
const raw = rules.compute(lim, '2024-06-14');
assert.strictEqual(raw, '2026-06-14', 'limitation must NOT roll off Sunday, got ' + raw);
const proc = rules.rule('on-soc-defence'); // procedural, must still roll
// pick a trigger where +20 calendar lands on a weekend and verify it rolls to a business day
const pr = rules.compute(proc, '2026-05-31'); // +20 = 2026-06-20 Sat -> rolls to Mon 22
assert(rules.isBusinessDay(new Date(pr + 'T00:00:00Z'), 'on'), 'procedural deadline must roll to a business day, got ' + pr);
const meta = rules.computeLimitation(lim, '2024-06-14');
assert(meta.weekendOrHoliday === true && meta.limitation === true, 'limitation landing on weekend must be flagged');
console.log('LIMITATION: no-roll holds (' + raw + ' stays), procedural still rolls (' + pr + '), weekend flagged');

// --- conflicts gate binds intake accept ---
const admin = store.firm.put('user', { email: 'a@f', name: 'A', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;
const H = { cookie: `s=${session}`, 'content-type': 'application/x-www-form-urlencoded', origin: base };
const post = async (p, f) => { const r = await fetch(base + p, { method: 'POST', redirect: 'manual', headers: H, body: new URLSearchParams(f).toString() }); await r.text(); return r; };

(async () => {
  // open an inquiry
  await post('/r/intake/new', { client: 'Testco', adverse: 'Rivalco', jurisdiction: 'on', claimType: 'Commercial dispute', discovered: '2025-01-10', summary: 'x' });
  let inq = store.firm.list('inquiry')[0];
  const before = store.firm.list('matter').length;
  // accept WITHOUT a cleared conflict run -> must be refused
  await post('/r/intake/decide', { id: inq.id, decision: 'accept' });
  assert.strictEqual(store.firm.list('matter').length, before, 'intake accept must be BLOCKED without a cleared conflict run');
  // record a clear conflictRun for this inquiry, then accept -> succeeds
  store.firm.put('conflictRun', { inquiryId: inq.id, parties: ['Testco'], outcome: 'clear', ranBy: admin.id });
  await post('/r/intake/decide', { id: inq.id, decision: 'accept' });
  assert.strictEqual(store.firm.list('matter').length, before + 1, 'intake accept must SUCCEED once conflict cleared');
  server.close();
  console.log('CONFLICTS GATE: intake accept blocked without clearance, allowed with it');
  console.log('PHASE 2 HANDSHAKES: ALL PASS');
  process.exit(0);
})().catch((e) => { console.error('PHASE 2 FAIL:', e.message); process.exit(1); });
