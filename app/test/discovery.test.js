'use strict';
// ============================================================================
// DISCOVERY — undertakings and the discovery plan, driven as a browser drives
// them (real POSTs through the router with an Origin header, then assertions on
// the STORED RECORD and the RENDERED PAGE, never on "status === 200").
//
// Why this suite exists. Three things in this area are malpractice-shaped:
//
//  1. AN UNDERTAKING WITH NO DUE DATE. A promise made on the record in an
//     Ontario examination is answered inside the r. 31.07 window or it draws a
//     motion to compel and costs. 14-depositions must COMPUTE a due date when
//     counsel leaves the field blank (60 days per the jurisdiction's rule,
//     rolled off weekends and court holidays) and record which basis it used.
//     A blank due date silently stored is an untracked promise.
//  2. AN ANSWERED PROMISE THAT STAYS OUTSTANDING — or an outstanding one that
//     stops showing. Both directions are proved here: answering must close the
//     item and drop it off the cross-matter board, and an unanswered one past
//     its date must read OVERDUE on the register AND on the board.
//  3. A RESPONDED INSTRUMENT WITH A DIARY ENTRY STILL OPEN. 12-discovery mints
//     a companion `deadline` for an instrument's response date and stores its
//     id back on the instrument; POST /respond must close THAT deadline, or the
//     response date sits open forever in 21-calendar, 27-desk and the client
//     pack while the instrument reads answered.
//
//  ...and the discovery plan (Ont. r.29.1.03 / FRCP 26(f)) is a record the
//  parties are held to: its custodians and date range must survive the form
//  round trip byte-for-byte, into the page and into the exported .txt, and an
//  inverted date range must be refused WITHOUT destroying the plan on file.
//
// Every expectation below was verified to fail before it was allowed to pass.
// ============================================================================
const fs = require('fs'), os = require('os'), path = require('path');
process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-discovery-'));
process.env.PORT = String(33800 + Math.floor(Math.random() * 151));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'disc@firm.local', name: 'Disc Admin', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const m = store.createMatter({ title: 'Okafor v. Fixture Corp', client: 'Okafor', adverse: ['Fixture Corp'], jurisdiction: 'on', status: 'open' }, admin.id);
const sc = () => store.matterScope(m.id);
const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { console.error('SERVER ERROR:', e.message); });
const base = 'http://localhost:' + process.env.PORT;
const jar = `s=${session}; m=${m.id}`;

const fails = [];
const ck = (cond, msg) => { if (!cond) fails.push(msg); return !!cond; };
const eq = (got, want, msg) => ck(got === want, `${msg} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
const has = (hay, needle, msg) => ck(String(hay).includes(needle), `${msg} — page does not contain ${JSON.stringify(needle)}`);
const hasnt = (hay, needle, msg) => ck(!String(hay).includes(needle), `${msg} — page still contains ${JSON.stringify(needle)}`);

const get = async (p) => {
  const r = await fetch(base + p, { headers: { cookie: jar } });
  const body = await r.text();
  if (r.status !== 200) fails.push(`GET ${p} returned ${r.status}`);
  return body;
};
// A browser form post: same-origin header, no redirect following.
const post = async (p, fields) => {
  const r = await fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: jar, 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(fields).toString(),
  });
  const body = await r.text();
  if (r.status >= 500) fails.push(`POST ${p} returned ${r.status}`);
  return { status: r.status, body, headers: r.headers };
};

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
const TODAY = iso(new Date());
const PAST_DUE = shift(-30);   // guaranteed overdue whenever this suite runs
const FUTURE_DUE = shift(45);  // guaranteed still open

const U1 = 'To produce the 2024 maintenance invoices for the plant.';
const U2 = 'To advise whether the tachograph data was preserved.';
const U3 = 'To produce the driver training records for 2023-24.';

(async () => {
  // ------------------------------------------------------------------ setup
  // Two witnesses, created through the real route: one of ours (promises we owe)
  // and one adverse (promises we chase). The cross-matter board splits on side.
  await post('/r/depositions/witness', { name: 'J. Okafor', side: 'ours', role: 'VP Ops', examDate: '2026-09-01' });
  await post('/r/depositions/witness', { name: 'R. Vance', side: 'theirs', role: 'Fleet manager', examDate: '2026-09-02' });
  const wOurs = sc().list('witness').find((w) => w.name === 'J. Okafor');
  const wTheirs = sc().list('witness').find((w) => w.name === 'R. Vance');
  if (!ck(wOurs && wTheirs, 'setup: POST /r/depositions/witness did not create both witnesses')) throw new Error('cannot continue without witnesses');

  // ============================================================ ASSERTION 1
  // An undertaking given at examination with the due date left BLANK becomes a
  // tracked OPEN item with a COMPUTED due date, and the room records which
  // basis computed it. 2026-09-01 + 60 calendar days = Sat 2026-10-31, rolled
  // forward off the weekend to Mon 2026-11-02 (r. 31.07 practice, on-undertakings).
  await post('/r/depositions/undertaking', {
    witnessId: wOurs.id, kind: 'undertaking', text: U1, qnum: '417', pl: '41:12',
    given: '2026-09-01', due: '',
  });
  const u1 = sc().list('undertaking').find((u) => u.text === U1);
  if (!ck(u1, 'ASSERTION 1: the undertaking was not tracked at all')) throw new Error('no undertaking stored');
  eq(u1.status, 'open', 'ASSERTION 1: a freshly given undertaking must be tracked OPEN');
  eq(u1.answered, null, 'ASSERTION 1: an unanswered undertaking must have no answered date');
  eq(u1.due, '2026-11-02', 'ASSERTION 1: a BLANK due date must be COMPUTED (60 days from 2026-09-01 per r. 31.07, rolled off the weekend), never left empty');
  eq(u1.basis, 'r. 31.07 practice', 'ASSERTION 1: the room must record WHICH basis produced the due date');
  eq(u1.given, '2026-09-01', 'ASSERTION 1: the date given on the record must be stored as given');
  eq(u1.witnessId, wOurs.id, 'ASSERTION 1: the undertaking must attach to the witness who gave it');

  // ============================================================ ASSERTION 2
  // An outstanding undertaking is visible AS outstanding — on this matter's
  // register and on the firm-wide board — and one past its date reads OVERDUE.
  await post('/r/depositions/undertaking', { witnessId: wTheirs.id, kind: 'undertaking', text: U2, given: '2026-01-05', due: PAST_DUE });
  await post('/r/depositions/undertaking', { witnessId: wTheirs.id, kind: 'refusal', text: U3, ground: 'relevance', sought: 'The 2023-24 training file.', given: '2026-01-06', due: FUTURE_DUE });
  const u2 = sc().list('undertaking').find((u) => u.text === U2);
  const u3 = sc().list('undertaking').find((u) => u.text === U3);
  if (!ck(u2 && u3, 'ASSERTION 2: the overdue / refusal rows were not tracked')) throw new Error('setup rows missing');
  eq(u2.basis, 'set by hand', 'ASSERTION 2: a due date typed by counsel must be recorded as set by hand, not attributed to a rule');
  eq(u3.kind, 'refusal', 'ASSERTION 2: a refusal must ride the register as a refusal');
  eq(u3.ground, 'relevance', 'ASSERTION 2: the ground of refusal must be recorded');

  let page = await get('/r/depositions');
  has(page, U1, 'ASSERTION 2: the register must show the undertaking');
  has(page, U2, 'ASSERTION 2: the register must show the overdue undertaking');
  has(page, '2026-11-02', 'ASSERTION 2: the computed due date must be visible on the register');
  has(page, '3 open', 'ASSERTION 2: three unanswered promises must count as three open');
  has(page, '1 overdue', 'ASSERTION 2: the one promise past its date must count as overdue');
  has(page, 'OVERDUE', 'ASSERTION 2: an unanswered promise past its due date must read OVERDUE');
  // The firm-wide board is the part a second lawyer looks at; assert on it alone.
  const boardOf = (p) => p.slice(p.indexOf('Cross-matter undertakings board'));
  let board = boardOf(page);
  has(board, '3 outstanding', 'ASSERTION 2: the cross-matter board must count all three as outstanding');
  has(board, 'Ours to answer — 1', 'ASSERTION 2: the board must show the one promise WE owe');
  has(board, 'Theirs to chase — 2', 'ASSERTION 2: the board must show the two promises owed TO us');
  has(board, U1, 'ASSERTION 2: our open undertaking must appear on the cross-matter board');
  has(board, U2, 'ASSERTION 2: the overdue undertaking must appear on the cross-matter board');

  // ============================================================ ASSERTION 3
  // Answering closes it: the record moves to answered with today's date, the
  // open count drops, and the row leaves the outstanding board entirely.
  await post('/r/depositions/answer', { id: u1.id });
  const u1b = sc().get('undertaking', u1.id);
  eq(u1b.status, 'answered', 'ASSERTION 3: answering must close the undertaking');
  eq(u1b.answered, TODAY, 'ASSERTION 3: the date answered must be recorded as today');
  eq(u1b.due, '2026-11-02', 'ASSERTION 3: answering must not disturb the due date on the record');
  eq(u1b.text, U1, 'ASSERTION 3: answering must not disturb what was promised');

  page = await get('/r/depositions');
  board = boardOf(page);
  has(page, '2 open', 'ASSERTION 3: the open count must drop when a promise is answered');
  has(page, 'answered', 'ASSERTION 3: the answered row must read answered on the register');
  has(board, '2 outstanding', 'ASSERTION 3: the board must no longer count the answered promise');
  has(board, 'Nothing we owe', 'ASSERTION 3: with our only promise answered the board must say we owe nothing');
  hasnt(board, U1, 'ASSERTION 3: an answered undertaking must leave the outstanding board');

  // The board's own matter-qualified button (used with no matter open) must
  // close a promise on the named matter too, and clear the overdue alarm.
  await post('/r/depositions/answer-x', { matterId: m.id, id: u2.id });
  const u2b = sc().get('undertaking', u2.id);
  eq(u2b.status, 'answered', 'ASSERTION 3: the cross-matter board answer must close the promise on the named matter');
  eq(u2b.answered, TODAY, 'ASSERTION 3: the board answer must record the date answered');
  page = await get('/r/depositions');
  board = boardOf(page);
  has(page, '1 open', 'ASSERTION 3: two answered leaves exactly one open');
  hasnt(page, 'OVERDUE', 'ASSERTION 3: with the overdue promise answered nothing may still read OVERDUE');
  hasnt(board, U2, 'ASSERTION 3: the answered overdue promise must leave the board');
  has(board, U3, 'ASSERTION 3: the still-open refusal must stay on the board');

  // ============================================================ ASSERTION 4
  // A discovery instrument's response date is calendared, and answering the
  // instrument CLOSES that diary entry. 2026-02-02 + 60 days lands on Good
  // Friday 2026-04-03, rolled forward past the weekend to Mon 2026-04-06.
  const newRes = await post('/r/discovery/new', {
    type: 'undertaking', direction: 'inbound', party: 'Fixture Corp',
    served: '2026-02-02', items: 'The maintenance invoices.\nThe tachograph export.',
  });
  eq(newRes.status, 303, 'ASSERTION 4: tracking an instrument must redirect back to the desk');
  const inst = sc().list('instrument')[0];
  if (!ck(inst, 'ASSERTION 4: the instrument was not tracked')) throw new Error('no instrument stored');
  eq(inst.due, '2026-04-06', 'ASSERTION 4: the response date must be computed from the rule and rolled off the court holiday/weekend');
  eq(inst.dueCite, 'r. 31.07 practice', 'ASSERTION 4: the instrument must carry the citation of the rule that computed its date');
  eq(inst.status, 'open', 'ASSERTION 4: a newly served instrument is open');
  ck(inst.deadlineId, 'ASSERTION 4: the instrument must store the id of its companion diary entry, or /respond can never close it');
  const dl = sc().get('deadline', inst.deadlineId);
  if (!ck(dl, 'ASSERTION 4: no companion deadline was minted for the response date')) throw new Error('no deadline stored');
  eq(dl.due, '2026-04-06', 'ASSERTION 4: the diary entry must carry the same response date as the instrument');
  eq(dl.status, 'open', 'ASSERTION 4: the response date must start open in the diary');
  eq(dl.ruleId, 'on-undertakings', 'ASSERTION 4: the diary entry must name the rules.js rule that computed it');
  let disc = await get('/r/discovery?i=' + encodeURIComponent(inst.id));
  has(disc, 'in the diary', 'ASSERTION 4: an open instrument must show its response date as sitting in the diary');

  await post('/r/discovery/respond', { id: inst.id });
  const instB = sc().get('instrument', inst.id);
  const dlB = sc().get('deadline', inst.deadlineId);
  eq(instB.status, 'responded', 'ASSERTION 4: the instrument must be marked responded');
  eq(instB.respondedAt, TODAY, 'ASSERTION 4: the date of response must be recorded');
  eq(dlB.status, 'done', 'ASSERTION 4: answering the instrument MUST close its diary entry — otherwise the response date stands open forever in the calendar, the firm diary and the client pack');
  disc = await get('/r/discovery?i=' + encodeURIComponent(inst.id));
  has(disc, 'diary entry closed', 'ASSERTION 4: the desk must show the diary entry as closed once responded');

  // ============================================================ ASSERTION 5
  // The discovery plan's custodians and date range survive the form round trip:
  // into storage byte-for-byte, back onto the page, and into the exported .txt.
  const CUST1 = 'J. Okafor (VP Ops)\nProcurement shared drive\nO365 mailboxes for 3 custodians';
  await post('/r/discovery/plan', {
    scope: 'Documentary discovery limited to the 2024-25 supply relationship.',
    custodians: CUST1, dateFrom: '2024-01-01', dateTo: '2025-12-31',
    format: 'TIFF + .dat/.opt load file', costNote: 'Est. $18k against a $250k claim.',
    agreedDates: 'Affidavits of documents: 2026-10-01',
  });
  let plan = sc().list('discoveryPlan');
  eq(plan.length, 1, 'ASSERTION 5: the discovery plan is one record per matter');
  eq(plan[0].custodians, CUST1, 'ASSERTION 5: every custodian line must survive the round trip exactly');
  eq(plan[0].dateFrom, '2024-01-01', 'ASSERTION 5: the start of the agreed date range must survive the round trip');
  eq(plan[0].dateTo, '2025-12-31', 'ASSERTION 5: the end of the agreed date range must survive the round trip');
  disc = await get('/r/discovery');
  has(disc, 'O365 mailboxes for 3 custodians', 'ASSERTION 5: the custodian list must render back on the desk');
  has(disc, 'Procurement shared drive', 'ASSERTION 5: every custodian line must render back on the desk');
  has(disc, '2024-01-01', 'ASSERTION 5: the start of the date range must render back on the desk');
  has(disc, '2025-12-31', 'ASSERTION 5: the end of the date range must render back on the desk');

  // An inverted range is refused — and refusing must not blank the plan on file.
  await post('/r/discovery/plan', {
    scope: 'Documentary discovery limited to the 2024-25 supply relationship.',
    custodians: 'WIPED', dateFrom: '2025-12-31', dateTo: '2024-01-01',
    format: '', costNote: '', agreedDates: '',
  });
  plan = sc().list('discoveryPlan');
  eq(plan.length, 1, 'ASSERTION 5: a refused save must not mint a second plan record');
  eq(plan[0].custodians, CUST1, 'ASSERTION 5: a refused save must leave the custodians on file untouched');
  eq(plan[0].dateTo, '2025-12-31', 'ASSERTION 5: a refused save must leave the agreed date range untouched');
  disc = await get('/r/discovery');
  has(disc, 'Date range ends before it starts', 'ASSERTION 5: an inverted date range must be refused with a reason counsel can read');
  hasnt(disc, 'WIPED', 'ASSERTION 5: the refused values must never reach the plan on file');

  // A genuine revision replaces the plan in place — still one record.
  const CUST2 = CUST1 + '\nFleet telematics vendor (third-party)';
  await post('/r/discovery/plan', {
    scope: 'Documentary discovery limited to the 2024-25 supply relationship.',
    custodians: CUST2, dateFrom: '2024-01-01', dateTo: '2025-12-31',
    format: 'TIFF + .dat/.opt load file', costNote: 'Est. $18k against a $250k claim.',
    agreedDates: 'Affidavits of documents: 2026-10-01',
  });
  plan = sc().list('discoveryPlan');
  eq(plan.length, 1, 'ASSERTION 5: revising the plan must update the one record, not add another');
  eq(plan[0].custodians, CUST2, 'ASSERTION 5: the revised custodian list must be what is on file');

  // And the record that leaves the building carries the same custodians and range.
  const exp = await post('/r/discovery/plan-export', {});
  has(exp.body, 'Fleet telematics vendor (third-party)', 'ASSERTION 5: the exported plan must carry the custodians on file');
  has(exp.body, 'J. Okafor (VP Ops)', 'ASSERTION 5: the exported plan must carry every custodian line');
  has(exp.body, '3. Date range: 2024-01-01 to 2025-12-31', 'ASSERTION 5: the exported plan must carry the agreed date range');

  server.close();
  if (fails.length) {
    console.error('DISCOVERY FAIL (' + fails.length + '):\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('DISCOVERY: ALL PASS (blank undertaking due date computed to 2026-11-02 on r. 31.07 and tracked open; answering closes it and clears the cross-matter board; an unanswered promise past its date reads OVERDUE; a responded instrument closes its companion diary entry; the plan\'s custodians and date range round-trip to page and export, and an inverted range is refused without destroying the plan)');
  process.exit(0);
})().catch((e) => {
  console.error('DISCOVERY ERROR:', e && e.stack ? e.stack : e);
  if (fails.length) console.error('  pending failures:\n  ' + fails.join('\n  '));
  try { server.close(); } catch (_) {}
  process.exit(1);
});
