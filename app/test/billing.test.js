'use strict';
// BILLING — the invoice run, driven end to end over HTTP the way a browser does.
//
// This suite exists because three earlier gates reported ALL PASS over a broken
// product: one rendered only empty states, one asserted HTTP 200 + shell, and one
// loaded a different source tree. So nothing here is satisfied by a 200. Every
// claim is checked against what actually changed — the stored invoice, the stored
// timeEntry/disbursement, the posted ledger transaction, and the rendered sheet.
//
// The money errors this proves cannot happen:
//   1. totals: fees + disbursements − write-downs, with a write-down clamped to
//      the line it is written down against (an unclamped one invents a credit);
//   2. a bill run cannot be executed twice over the same time — an issued invoice
//      cannot be re-issued, and a second run finds nothing left to sweep;
//   3. entries already billed never reappear on a later invoice;
//   4. a lawyer screened by an ethical wall cannot cause the firm to bill the
//      matter they are walled off from.
// Rooms: 28-books (POST /r/books/time — the only creator of timeEntry) and
// 34-billing (disb / draft / writedown / issue / status / discard).

const fs = require('fs'), os = require('os'), path = require('path');
process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-billing-'));
process.env.PORT = String(33000 + Math.floor(Math.random() * 151));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const pw = hashPassword('a-long-password-here');
const dana = store.firm.put('user', { email: 'dana@f', name: 'Dana R', role: 'admin', active: true, pw }, 't');
const kris = store.firm.put('user', { email: 'kris@f', name: 'Kris L', role: 'admin', active: true, pw }, 't');

const m1 = store.createMatter({ title: 'Halloran v. Pike Transport', client: 'J. Halloran', jurisdiction: 'on', status: 'open' }, dana.id);
const WALLED_TITLE = 'Ferris v. Northshore Dairy';
const WALLED_CLIENT = 'M. Ferris';
const m2 = store.createMatter({ title: WALLED_TITLE, client: WALLED_CLIENT, jurisdiction: 'on', status: 'open' }, dana.id);

const danaS = auth.createSession(dana.id);
const krisS = auth.createSession(kris.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

// ---------- harness ----------
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); return !!cond; };
const eq = (actual, expected, msg) => check(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const jar = (sess, matterId) => (matterId ? `s=${sess}; m=${matterId}` : `s=${sess}`);

// Every POST carries an `origin` header, as a browser form submission does; the
// router refuses cross-origin writes and would answer 403 without it. Asserting
// 303 on each write proves the request actually reached the room handler.
async function post(p, fields, sess, matterId) {
  const res = await fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: jar(sess, matterId), 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(fields).toString(),
  });
  eq(res.status, 303, `POST ${p} did not reach the room handler`);
  return res.headers.get('location') || '';
}
async function get(p, sess, matterId) {
  const res = await fetch(base + p, { headers: { cookie: jar(sess, matterId) } });
  const body = await res.text();
  eq(res.status, 200, `GET ${p} did not render`);
  return body;
}
// A refusal is a flash on the next page load; read it right after the refusal.
async function flashAfter(location, sess, matterId) { return get(location.startsWith('/') ? location : '/r/billing', sess, matterId); }

const sc = (mid) => store.matterScope(mid);
const invoices = (mid) => sc(mid).list('invoice');
const txns = (mid, kind) => store.firm.list('ledgerTxn', (t) => t.matterId === mid && (!kind || t.kind === kind));
function balance(mid, account) {
  let n = 0;
  for (const t of txns(mid)) for (const l of t.lines) if (l.account === account) n += (Number(l.dr) || 0) - (Number(l.cr) || 0);
  return Math.round(n * 100) / 100;
}
const seqOf = (number) => Number(String(number).split('-')[1]);

const NARR = {
  t1: 'Draft statement of claim, Part IV damages particulars',
  t2: 'Review Pike Transport productions and prepare index',
  t3: 'Attend case conference before Master Wong on scheduling',
  t4: 'Prepare affidavit of documents, Schedule A listing',
  vague: 'work on file', // fails 34-billing narrativeLint -> the pre-bill gate
  w: 'Advise client on limitation period and next steps',
};

(async () => {
  // ================= 1. draft time in -> one numbered draft invoice out =======
  await post('/r/books/time', { hours: '2.5', rate: '400', utbms: 'L210 Pleadings', narrative: NARR.t1 }, danaS, m1.id);
  await post('/r/books/time', { hours: '1.25', rate: '400', utbms: 'L310 Written discovery', narrative: NARR.t2 }, danaS, m1.id);
  await post('/r/books/time', { hours: '0.5', rate: '300', utbms: 'L120 Analysis & strategy', narrative: NARR.t3 }, danaS, m1.id);
  await post('/r/billing/disb', { desc: 'Court filing fee — statement of claim', amount: '229.00', incurred: '2026-03-02' }, danaS, m1.id);
  await post('/r/billing/disb', { desc: 'Process server — statement of claim', amount: '75.50', incurred: '2026-03-03' }, danaS, m1.id);

  const time0 = sc(m1.id).list('timeEntry');
  eq(time0.length, 3, 'room 28 did not store the three time entries');
  eq(time0.filter((t) => t.state === 'draft').length, 3, 'new time entries are not in state draft');

  await post('/r/billing/draft', {}, danaS, m1.id);
  let inv1 = invoices(m1.id)[0];
  if (!check(!!inv1, 'the bill run stored no invoice at all')) { throw new Error('no draft invoice — nothing further can be proved'); }
  eq(invoices(m1.id).length, 1, 'the bill run stored more than one invoice');
  eq(inv1.status, 'draft', 'a fresh invoice is not a draft');
  eq((inv1.lineItems || []).length, 3, 'the draft did not sweep all three unbilled time entries');
  eq((inv1.disbLines || []).length, 2, 'the draft did not sweep both unbilled disbursements');
  eq(inv1.fees, 1650, 'hourly fees are not the sum of each line hours x that line rate (2.5x400 + 1.25x400 + 0.5x300)');
  eq(inv1.disbursements, 304.5, 'disbursements on the draft are wrong (229.00 + 75.50)');
  eq(inv1.writeDowns, 0, 'a fresh draft carries a write-down');
  eq(inv1.total, 1954.5, 'draft total is not fees + disbursements');
  check(/^\d{4}-\d{3}$/.test(String(inv1.number)), `invoice number is not firm-wide YYYY-NNN: ${inv1.number}`);
  // Nothing is billed by drafting — only issuing marks time.
  eq(sc(m1.id).list('timeEntry').filter((t) => t.state === 'billed').length, 0, 'drafting an invoice marked time billed before it was issued');
  eq(txns(m1.id, 'invoice').length, 0, 'drafting an invoice posted a receivable before it was issued');

  // ================= 2. ONE OPEN DRAFT — a second run cannot start ===========
  const loc2 = await post('/r/billing/draft', {}, danaS, m1.id);
  eq(invoices(m1.id).length, 1, 'DOUBLE BILL: a second draft invoice was generated over the same unbilled time while one was already open');
  const refused = await flashAfter(loc2, danaS, m1.id);
  check(refused.includes('already open'), 'the second bill run was not refused with an explanation naming the open draft');

  // ================= 3. write-downs — and the clamp =========================
  const [l1, l2] = inv1.lineItems;
  await post('/r/billing/writedown', {
    inv: inv1.id,
    ['wd:' + l1.timeEntryId]: '250.00',
    ['wd:' + l2.timeEntryId]: '999999', // more than the line is worth — must clamp
  }, danaS, m1.id);
  inv1 = sc(m1.id).get('invoice', inv1.id);
  eq(inv1.lineItems[0].writeDown, 250, 'the write-down was not applied to the line');
  eq(inv1.lineItems[1].writeDown, 500, 'CLAMP: a write-down larger than the line was not clamped to the line value');
  eq(inv1.writeDowns, 750, 'total write-downs are wrong');
  eq(inv1.fees, 900, 'fees are not gross minus write-downs (1650 - 750)');
  eq(inv1.total, 1204.5, 'total is not fees + disbursements - write-downs (1650 - 750 + 304.50)');

  // The sheet a client would actually be handed must carry those same figures —
  // an empty state or a stale render is a failure, not a pass.
  const sheet = await get('/r/billing?inv=' + encodeURIComponent(inv1.id), danaS, m1.id);
  check(sheet.includes(inv1.number), 'the invoice sheet does not render the invoice number');
  check(sheet.includes(NARR.t1), 'the invoice sheet does not render the billed narrative (empty state?)');
  check(sheet.includes('$1,204.50'), 'the invoice sheet does not show the written-down total due');
  check(sheet.includes('$900.00'), 'the invoice sheet does not show net fees');
  check(sheet.includes('$750.00'), 'the invoice sheet does not show the write-downs');
  check(!sheet.includes('$1,954.50'), 'the invoice sheet still shows the pre-write-down total as the amount due');

  // ================= 4. issue — money moves exactly once =====================
  await post('/r/billing/issue', { inv: inv1.id }, danaS, m1.id);
  inv1 = sc(m1.id).get('invoice', inv1.id);
  eq(inv1.status, 'sent', 'issuing did not move the invoice to sent');
  check(!!inv1.issuedDate, 'an issued invoice carries no issue date');
  const billed = sc(m1.id).list('timeEntry').filter((t) => t.state === 'billed');
  eq(billed.length, 3, 'issuing did not mark every time entry on the invoice billed');
  eq(billed.filter((t) => t.invoiceId === inv1.id && t.invoiceNumber === inv1.number).length, 3, 'billed time entries do not carry the issuing invoice id/number');
  eq(sc(m1.id).list('disbursement').filter((d) => d.state === 'billed').length, 2, 'issuing did not mark the disbursements billed');
  eq(txns(m1.id, 'invoice').length, 1, 'issuing did not post exactly one receivable');
  eq(balance(m1.id, 'ar:client'), 1204.5, 'the receivable posted is not the written-down total the client owes');
  eq(balance(m1.id, 'operating:income:fees'), -900, 'fee income posted is not the net fee');

  // ================= 5. NO DOUBLE BILL — re-issue is refused =================
  const locRe = await post('/r/billing/issue', { inv: inv1.id }, danaS, m1.id);
  const reFlash = await flashAfter(locRe, danaS, m1.id);
  const inv1b = sc(m1.id).get('invoice', inv1.id);
  eq(inv1b.status, 'sent', 'an already-issued invoice changed state on a second issue');
  eq(txns(m1.id, 'invoice').length, 1, 'DOUBLE BILL: issuing the same invoice twice posted the receivable twice');
  eq(balance(m1.id, 'ar:client'), 1204.5, 'DOUBLE BILL: the client was charged twice for the same invoice');
  check(reFlash.includes('cannot be issued again'), 'a re-issue was not refused with an explanation');

  // ...and a fresh bill run finds nothing, because the time is spent.
  const locEmpty = await post('/r/billing/draft', {}, danaS, m1.id);
  eq(invoices(m1.id).length, 1, 'DOUBLE BILL: a second invoice was generated over time that is already billed');
  const emptyFlash = await flashAfter(locEmpty, danaS, m1.id);
  check(emptyFlash.includes('Nothing unbilled'), 'a bill run with nothing unbilled was not refused');

  // ================= 6. billed entries never reappear ========================
  await post('/r/books/time', { hours: '1', rate: '400', utbms: 'L310 Written discovery', narrative: NARR.t4 }, danaS, m1.id);
  await post('/r/books/time', { hours: '1', rate: '400', utbms: 'L190 Other case assessment', narrative: NARR.vague }, danaS, m1.id);
  await post('/r/billing/draft', {}, danaS, m1.id);
  let inv2 = invoices(m1.id).find((i) => i.id !== inv1.id);
  if (!check(!!inv2, 'a second bill run over genuinely new time produced no invoice')) throw new Error('no second invoice');
  eq((inv2.lineItems || []).length, 2, 'the second invoice did not carry exactly the two NEW time entries');
  const billedIds = new Set(billed.map((t) => t.id));
  eq(inv2.lineItems.filter((l) => billedIds.has(l.timeEntryId)).length, 0, 'DOUBLE BILL: a time entry already billed on invoice ' + inv1.number + ' reappeared on the next invoice');
  eq((inv2.disbLines || []).length, 0, 'DOUBLE BILL: a disbursement already billed reappeared on the next invoice');
  eq(inv2.fees, 800, 'the second invoice fees are not the new time alone (1x400 + 1x400)');
  eq(seqOf(inv2.number), seqOf(inv1.number) + 1, 'invoice numbers are not a monotonic firm-wide sequence');

  // ================= 7. pre-bill lint gate blocks the money ==================
  const locLint = await post('/r/billing/issue', { inv: inv2.id }, danaS, m1.id);
  const lintFlash = await flashAfter(locLint, danaS, m1.id);
  inv2 = sc(m1.id).get('invoice', inv2.id);
  eq(inv2.status, 'draft', 'an invoice carrying a narrative that fails pre-bill lint was issued anyway');
  eq(txns(m1.id, 'invoice').length, 1, 'a lint-blocked invoice still posted a receivable');
  eq(balance(m1.id, 'ar:client'), 1204.5, 'a lint-blocked invoice still charged the client');
  eq(sc(m1.id).list('timeEntry').filter((t) => t.state === 'billed').length, 3, 'a lint-blocked invoice still marked its time billed');
  check(lintFlash.includes('pre-bill lint'), 'the lint refusal did not say why the bill was blocked');

  // Discarding the draft leaves its time unbilled, ready for a corrected run.
  await post('/r/billing/discard', { inv: inv2.id }, danaS, m1.id);
  eq(invoices(m1.id).length, 1, 'discarding the draft did not remove it');
  eq(sc(m1.id).list('timeEntry').filter((t) => t.state !== 'billed' && !t.invoiceId).length, 2, 'discarding a draft did not leave its time unbilled');

  // ================= 8. a walled matter cannot be billed =====================
  // Dana opens a bill run on the second matter; THEN Kris is screened off it.
  await post('/r/books/time', { hours: '3', rate: '500', utbms: 'L120 Analysis & strategy', narrative: NARR.w }, danaS, m2.id);
  await post('/r/billing/draft', {}, danaS, m2.id);
  const wInv = invoices(m2.id)[0];
  if (!check(!!wInv, 'no draft invoice on the second matter')) throw new Error('no walled-matter draft');
  eq(wInv.total, 1500, 'the second matter draft total is wrong (3 x 500)');
  store.firm.put('wall', { matterId: m2.id, screened: [kris.id], basis: 'acted for Northshore at former firm' }, dana.id);

  // Kris asks for that matter by id and tries to issue its invoice by id.
  const krisPage = await get('/r/billing?m=' + encodeURIComponent(m2.id), krisS, m2.id);
  check(!krisPage.includes(WALLED_TITLE), 'WALL: the billing room showed the screened lawyer the walled matter title');
  check(!krisPage.includes(WALLED_CLIENT), 'WALL: the billing room showed the screened lawyer the walled matter client');
  check(!krisPage.includes(wInv.number), 'WALL: the billing room showed the screened lawyer the walled matter invoice number');

  await post('/r/billing/issue', { inv: wInv.id }, krisS, m2.id);
  const wAfter = sc(m2.id).get('invoice', wInv.id);
  eq(wAfter.status, 'draft', 'WALL: a screened lawyer issued the invoice on a matter they are walled off from');
  eq(txns(m2.id, 'invoice').length, 0, 'WALL: a screened lawyer caused a receivable to be posted on a walled matter');
  eq(balance(m2.id, 'ar:client'), 0, 'WALL: a screened lawyer billed a walled matter');
  eq(sc(m2.id).list('timeEntry').filter((t) => t.state === 'billed').length, 0, 'WALL: a screened lawyer marked time billed on a walled matter');
  // ...and the refusal must not have landed on the matter Kris CAN see.
  eq(invoices(m1.id).length, 1, 'the screened lawyer\'s refused bill run leaked onto another matter');
  eq(txns(m1.id, 'invoice').length, 1, 'the screened lawyer\'s refused bill run posted against another matter');

  // Control: the route itself works — the UNSCREENED lawyer bills it normally.
  // Without this the wall assertions above would also pass on a dead route.
  await post('/r/billing/issue', { inv: wInv.id }, danaS, m2.id);
  const wIssued = sc(m2.id).get('invoice', wInv.id);
  eq(wIssued.status, 'sent', 'the unscreened lawyer could not issue the invoice — the refusal above was not the wall');
  eq(balance(m2.id, 'ar:client'), 1500, 'the unscreened lawyer\'s invoice did not post its receivable');

  server.close();
  if (fails.length) { console.error('BILLING FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('BILLING: ALL PASS (totals = fees + disb - write-downs; no re-issue, no re-sweep, no double receivable; lint gate holds; a walled matter cannot be billed)');
  process.exit(0);
})().catch((e) => {
  console.error('BILLING ERROR:', e && e.stack || e);
  if (fails.length) console.error('  outstanding failures:\n  ' + fails.join('\n  '));
  try { server.close(); } catch (_) {}
  process.exit(1);
});
