'use strict';
// Two deadline warnings that were computed, stored, and then shown to nobody.
//
// Both flags existed and both were correct. Neither was ever read back:
//
//   * 09-jurisdiction stamps `stale` on every open deadline when a matter's
//     governing law changes. The flag was rendered ONLY on that room's own
//     recompute card. The firm diary in 27-desk — the page a lawyer actually
//     reads deadlines off — showed the superseded date unmarked AND offered it
//     the dual-diary tick. So the one date computed under a rulebook that no
//     longer governs could collect the firm's strongest control and come out
//     rendered `verified` in green: certified wrong, and looking better for it.
//   * 21-calendar computes and persists `nonBusinessDay` for a limitation date
//     landing on a weekend or court holiday (which is never rolled forward — a
//     statutory expiry must not be pushed to a later, false-safe day). It was
//     announced in one flash to whoever happened to be at the keyboard and read
//     back on no page at all.
//
// The shape of both defects is the same and worth naming: the write landed, the
// read never did. A control that lives in the store and not on the screen is
// not a control. So every assertion here checks the RECORD first and the RENDER
// second — a test that only scraped HTML would pass on a page that happened to
// contain the word "stale" for some other reason.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/stale-');
process.env.PORT = String(25500 + Math.floor(Math.random() * 1500));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const pw = hashPassword('a-long-password-here');
const ann = store.firm.put('user', { email: 'ann@f', name: 'Ann A', role: 'admin', active: true, pw }, 't');
const ben = store.firm.put('user', { email: 'ben@f', name: 'Ben B', role: 'admin', active: true, pw }, 't');
const m = store.createMatter({ title: 'Marchetti v. Delcorte Holdings', client: 'A. Marchetti', jurisdiction: 'on', status: 'open' }, ann.id);
const annS = auth.createSession(ann.id), benS = auth.createSession(ben.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

const get = (p, s) => fetch(base + p, { headers: { cookie: `s=${s}; m=${m.id}` } })
  .then(async (r) => ({ status: r.status, text: await r.text() }));
const post = (p, form, s) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${s}; m=${m.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(form).toString(),
}).then(async (r) => { await r.text(); return r; });
const deadlines = () => store.matterScope(m.id).list('deadline');

(async () => {
  const fails = [];

  // ---- 1. The weekend/holiday flag, stored then shown ---------------------
  // 2026-01-01 + 730 days lands on 2028-01-01, a Saturday. A limitation date is
  // calendared exactly as it falls, so the flag is the only thing standing
  // between counsel and a date that looks ordinary.
  await post('/r/calendar/compute', { rule: 'on-limitation', trigger: '2026-01-01' }, annS);
  let ds = deadlines();
  assert.strictEqual(ds.length, 1, 'setup: the limitation deadline was not calendared at all');
  const lim = ds[0];
  // Assert the WRITE before asserting anything about the render.
  assert.strictEqual(lim.nonBusinessDay, true,
    'setup: 21-calendar did not persist nonBusinessDay for a Saturday limitation landing');
  assert.strictEqual(lim.due, '2028-01-01', 'setup: unexpected due date ' + lim.due);

  for (const [route, sess, who] of [['/r/desk', annS, 'firm diary (27-desk)'], ['/r/calendar', annS, 'matter diary (21-calendar)']]) {
    const { status, text } = await get(route, sess);
    assert.strictEqual(status, 200, route + ' -> ' + status);
    if (!text.includes(lim.due)) fails.push(`${who} does not even list the limitation date — test would pass for the wrong reason`);
    else if (!/weekend\/holiday/i.test(text)) {
      fails.push(`${who} lists a limitation date landing on a weekend and shows NO warning — the stored nonBusinessDay flag is read back nowhere`);
    }
  }

  // ---- 2. The stale flag: shown, and refused the tick ---------------------
  // Before the governing law moves, the dual-diary tick must be on offer: this
  // proves the refusal below is caused by staleness and not by some unrelated
  // gate that would have blocked Ben anyway.
  const before = await get('/r/desk', benS);
  const offered = before.text.includes(`value="${lim.id}"`);
  assert(offered, 'setup: the dual-diary tick was never offered even on a clean deadline — the rest of this test proves nothing');

  await post('/r/jurisdiction/govern', { jurisdiction: 'qc' }, annS);
  const stale = deadlines().find((d) => d.id === lim.id);
  assert.strictEqual(stale.stale, true,
    'setup: changing the governing law did not flag the open deadline stale');

  // (a) The diary must SAY so.
  const desk = await get('/r/desk', benS);
  // Match the chip and its reason, never a bare word: the first draft of this
  // test asserted /STALE/i and passed on an unflagged page because the fixture
  // matter was called 'Stale v. Rulebook'.
  if (!/STALE[^<]*governing law changed/i.test(desk.text)) {
    fails.push('firm diary shows a deadline computed under a superseded rulebook with no stale mark on it');
  }
  // (b) It must not offer the tick on a superseded date.
  if (desk.text.includes(`value="${lim.id}"`)) {
    fails.push('firm diary still offers the dual-diary Verify button on a stale deadline');
  }

  // (c) And the POST must refuse regardless of the button — hiding a control is
  //     not enforcing it. Ben is not the lawyer who calendared it, so nothing
  //     but staleness can be doing the refusing here.
  await post('/r/desk/verify', { matterId: m.id, id: lim.id }, benS);
  const after = deadlines().find((d) => d.id === lim.id);
  if (after.verifiedBy) {
    fails.push(`DUAL-DIARY CERTIFIED A SUPERSEDED DATE: ${after.desc} (${after.due}) was verified by ${after.verifiedBy} after the governing law moved ${stale.staleFrom} -> ${stale.staleTo}`);
  }

  // (d) The control must still WORK on a date that is not stale — a gate that
  //     refuses everything is just a broken gate.
  await post('/r/jurisdiction/recompute-clear', { id: lim.id }, annS);
  assert.strictEqual(deadlines().find((d) => d.id === lim.id).stale, false, 'setup: clearing the stale flag did not take');
  await post('/r/desk/verify', { matterId: m.id, id: lim.id }, benS);
  const ticked = deadlines().find((d) => d.id === lim.id);
  if (ticked.verifiedBy !== ben.name) {
    fails.push('the dual-diary tick no longer works on a cleared deadline — verifiedBy=' + JSON.stringify(ticked.verifiedBy));
  }

  // (e) The same-person rule is untouched by any of this.
  const m2 = store.createMatter({ title: 'Second', client: 'C2', jurisdiction: 'on', status: 'open' }, ann.id);
  const post2 = (p, form, s) => fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: `s=${s}; m=${m2.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(form).toString(),
  }).then(async (r) => { await r.text(); return r; });
  await post2('/r/calendar/compute', { rule: 'on-limitation', trigger: '2026-01-04' }, annS);
  const d2 = store.matterScope(m2.id).list('deadline')[0];
  await post2('/r/desk/verify', { matterId: m2.id, id: d2.id }, annS);
  if (store.matterScope(m2.id).list('deadline')[0].verifiedBy) {
    fails.push('the dual-diary same-person refusal regressed: Ann verified her own date');
  }

  server.close();
  if (fails.length) { console.log('STALE/WEEKEND FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('STALE+WEEKEND: ALL PASS (flag stored and shown on both diaries; stale date refused the tick; cleared date still tickable; same-person rule intact)');
  process.exit(0);
})().catch((e) => { console.error('staleverify crash:', e); try { server.close(); } catch (_) {} process.exit(1); });
