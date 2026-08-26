'use strict';
// EXPERTS (room 15) — expert disclosure, end to end over HTTP.
//
// Room 15 was once hard-broken: it 500'd on every matter that had ANY expert
// record, and both gates reported ALL PASS because one only ever rendered the
// EMPTY state and the other asserted HTTP 200 + shell present. So this suite
// drives the room WITH DATA, through the router the way a browser does, and
// asserts on what actually CHANGED — the stored record, the rendered page, the
// gate's decision — never on the status code alone.
//
// What is proved, and why each one is malpractice if wrong:
//   1. A report due date is TRACKED (it mints the `deadline` record the diary
//      rooms read, carrying rule:'expert report' and an EXPLICIT ruleId:null)
//      and SHOWS AS DUE (the overdue chip fires on a past date, and clears when
//      the date moves) — and moving the date updates that SAME record rather
//      than leaving a stale duplicate on the calendar.
//   2. Retained vs consulting-only is DISTINGUISHED. The app models the
//      distinction as the retention pipeline `identified -> retained -> report
//      served`: an expert consulted but never retained sits at 'identified'.
//      The ADVANCE gate must refuse to record a report served by an expert who
//      was never retained, and the consulting-only expert's IDENTITY must not
//      reach a disclosure surface — not the Form 53 acknowledgment that is
//      served under r. 53.03(2.1), and not the diary/feed surfaces that carry
//      an expert's name out of the room.
//   3. An expert with a report due date DOES appear on the deadline surfaces:
//      the Trial Calendar (21), the firm diary (27) and the ICS phone feed.
//
// Assertions 2 and 3 are deliberately paired on the same page loads: the same
// bytes that must carry the retained expert must not carry the consulting one.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-experts-'));
process.env.PORT = String(34200 + Math.floor(Math.random() * 151));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'counsel@firm.local', name: 'Counsel', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 'experts');
const m = store.createMatter({ title: 'Kavanagh v. Northbridge', client: 'Kavanagh Holdings', jurisdiction: 'on', status: 'open' }, admin.id);
// A second matter, so the disclosure download can be asked for an expert it
// must not be able to reach.
const other = store.createMatter({ title: 'Sealed v. Confidential', client: 'Sealed Ltd', jurisdiction: 'on', status: 'open' }, admin.id);
const SEALED = 'Dr. Ingrid Soderberg';
const sealedExpert = store.matterScope(other.id).put('expert', { name: SEALED, discipline: 'Toxicology', side: 'ours', status: 'retained', checklist: {}, challenge: null }, admin.id);

const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

const sc = () => store.matterScope(m.id);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const PAST = day(-45);      // report was due six weeks ago
const FUTURE = day(120);    // moved out to a real future date
const DISC1 = day(60);
const DISC2 = day(75);

// The three experts on the matter under test.
const RETAINED = 'Dr. Helena Vaszary';   // retained; report diarised
const SECOND = 'Dr. Marcus Okonjo';      // retained; report due in the future
const CONSULTING = 'Dr. Priya Ramanathan'; // consulted only; never retained, nothing diarised

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); return !!cond; };

const cookie = (matterId) => ({ cookie: `s=${session}; m=${matterId}` });
async function GET(p, matterId = m.id) {
  const r = await fetch(base + p, { headers: cookie(matterId), redirect: 'manual' });
  return { status: r.status, headers: r.headers, text: await r.text() };
}
async function POST(p, form, matterId = m.id) {
  const r = await fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: { ...cookie(matterId), 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(form).toString(),
  });
  await r.text();
  return r;
}
const experts = () => sc().list('expert');
const byName = (n) => experts().find((x) => x.name === n) || null;
const deadlines = () => sc().list('deadline');
const namedDeadlines = (n) => deadlines().filter((d) => String(d.desc || '').includes(n));

(async () => {
  // ---------------------------------------------------------------- 1. TRACKED
  await POST('/r/experts/new', { name: RETAINED, discipline: 'Biomechanics', side: 'ours', reportDue: PAST, rateType: 'hourly', rate: '575', scope: 'Crash mechanics of the 2025 collision' });
  const v0 = byName(RETAINED);
  check(!!v0, `POST /r/experts/new stored no expert record for ${RETAINED}`);
  check(v0 && v0.reportDue === PAST, `expert.reportDue is ${v0 && v0.reportDue}, want ${PAST}`);
  check(v0 && v0.status === 'identified', `a new expert file must open at 'identified', got ${v0 && v0.status}`);
  check(v0 && typeof v0.deadlineId === 'string' && v0.deadlineId, 'a report due date must mint a deadline and store its id on the expert (deadlineId missing)');

  // The deadline record itself is the thing every diary room reads.
  const d0 = v0 && v0.deadlineId ? sc().get('deadline', v0.deadlineId) : null;
  check(!!d0, 'expert.deadlineId does not resolve to a deadline record');
  check(d0 && d0.due === PAST, `deadline.due is ${d0 && d0.due}, want ${PAST}`);
  check(d0 && d0.status === 'open', `deadline.status is ${d0 && d0.status}, want open`);
  check(d0 && d0.rule === 'expert report', `deadline.rule is ${JSON.stringify(d0 && d0.rule)}, want the citation string 'expert report'`);
  check(d0 && String(d0.desc || '').includes(RETAINED), `deadline.desc must name the expert; got ${JSON.stringify(d0 && d0.desc)}`);
  // ruleId must be PRESENT and explicitly null — "counsel typed this, no rule
  // computed it". Absent means "legacy row", and readers (27-desk,
  // 09-jurisdiction) distinguish the two.
  check(d0 && Object.prototype.hasOwnProperty.call(d0, 'ruleId'), 'deadline written by room 15 omits ruleId entirely (reads as a legacy row)');
  check(d0 && d0.ruleId === null, `deadline.ruleId must be explicitly null, got ${JSON.stringify(d0 && d0.ruleId)}`);

  // ------------------------------------------------------- 1b. SHOWS AS DUE
  await POST('/r/experts/new', { name: SECOND, discipline: 'Forensic accounting', side: 'ours', reportDue: FUTURE, rateType: 'daily', rate: '4000', scope: 'Loss of profits' });
  await POST('/r/experts/new', { name: CONSULTING, discipline: 'Human factors', side: 'ours', reportDue: '', rateType: 'hourly', rate: '500', scope: 'Consulted on theory only — not retained to give evidence' });
  check(experts().length === 3, `expected 3 experts on the matter, got ${experts().length}`);

  const room1 = await GET('/r/experts');
  check(room1.status === 200, `GET /r/experts with three experts present -> HTTP ${room1.status}`);
  check(!/Internal error|Handler did not respond/i.test(room1.text), 'room 15 rendered an error page WITH expert data present');
  for (const n of [RETAINED, SECOND, CONSULTING]) check(room1.text.includes(n), `roster did not render ${n}`);
  // The overdue signal must be data-driven: exactly the one past-due report.
  check(room1.text.includes('1 report overdue'), 'roster did not flag the past-due report as overdue');
  check(!room1.text.includes('2 reports overdue'), 'roster counted a future-dated or undiarised expert as overdue');
  check(room1.text.includes('>overdue<'), "the past-due expert's row carries no 'overdue' chip");

  // ------------------------------------- 2. RETAINED vs CONSULTING-ONLY (gate)
  await POST('/r/experts/status', { id: v0.id, to: 'retained' });
  check(byName(RETAINED).status === 'retained', `advancing identified -> retained failed; status is ${byName(RETAINED).status}`);

  // The consulting-only expert was never retained. Recording a served report
  // for them would create a disclosure obligation out of nothing, so the
  // pipeline must refuse the non-adjacent jump.
  const c0 = byName(CONSULTING);
  await POST('/r/experts/status', { id: c0.id, to: 'report served' });
  check(byName(CONSULTING).status === 'identified', `GATE BREACH: an unretained (consulting-only) expert was advanced straight to '${byName(CONSULTING).status}'`);
  await POST('/r/experts/outcome', { id: c0.id, outcome: 'qualified' });
  check(byName(CONSULTING).status === 'identified', `GATE BREACH: an unchallenged consulting expert was ruled '${byName(CONSULTING).status}'`);

  // ------------------------------------- 1c. MOVING THE DATE, NOT DUPLICATING
  await POST('/r/experts/due', { id: v0.id, reportDue: FUTURE });
  const v1 = byName(RETAINED);
  check(v1.reportDue === FUTURE, `report due did not move: ${v1.reportDue}`);
  check(v1.deadlineId === v0.deadlineId, 'moving the report date re-pointed the expert at a NEW deadline (the old one is now stale on the calendar)');
  check(sc().get('deadline', v1.deadlineId).due === FUTURE, 'the deadline record still carries the old date');
  check(namedDeadlines(RETAINED).filter((d) => d.rule === 'expert report').length === 1,
    `moving the report date left ${namedDeadlines(RETAINED).filter((d) => d.rule === 'expert report').length} 'expert report' deadlines on the calendar; want exactly 1`);

  // ...and the overdue signal clears, so it tracks the data rather than latching.
  const room2 = await GET('/r/experts');
  check(!/report[s]? overdue/.test(room2.text), 'the overdue flag survived the date being moved into the future');

  // An impossible calendar date must be refused outright, not silently dropped:
  // a day nobody lived poisons every room that sorts and compares these dates.
  await POST('/r/experts/due', { id: v0.id, reportDue: '2026-02-31' });
  check(byName(RETAINED).reportDue === FUTURE, `an impossible date (2026-02-31) was accepted: reportDue is now ${byName(RETAINED).reportDue}`);
  check(sc().get('deadline', v0.deadlineId).due === FUTURE, 'an impossible date reached the deadline record');

  // ------------------------------------------------ 2b. DISCLOSURE DEADLINE
  await POST('/r/experts/disclosure', { id: v0.id, rule: 'on_5303_1', due: DISC1 });
  const v2 = byName(RETAINED);
  check(typeof v2.disclosureDeadlineId === 'string' && v2.disclosureDeadlineId, 'posting a disclosure deadline stored no disclosureDeadlineId on the expert');
  check(v2.disclosureRule === 'on_5303_1', `expert.disclosureRule is ${JSON.stringify(v2.disclosureRule)}, want on_5303_1`);
  const dd = v2.disclosureDeadlineId ? sc().get('deadline', v2.disclosureDeadlineId) : null;
  check(!!dd, 'disclosureDeadlineId does not resolve to a deadline record');
  check(dd && dd.due === DISC1, `disclosure deadline due is ${dd && dd.due}, want ${DISC1}`);
  check(dd && /53\.03\(1\)/.test(String(dd.rule || '')), `disclosure deadline must carry the r. 53.03(1) citation, got ${JSON.stringify(dd && dd.rule)}`);
  check(dd && dd.ruleId === null, `disclosure ruleId must be null while no rules.js rule computes it, got ${JSON.stringify(dd && dd.ruleId)}`);
  // Moving it moves the same record.
  await POST('/r/experts/disclosure', { id: v0.id, rule: 'on_5303_1', due: DISC2 });
  check(byName(RETAINED).disclosureDeadlineId === v2.disclosureDeadlineId, 'moving the disclosure date minted a second disclosure deadline');
  check(sc().get('deadline', v2.disclosureDeadlineId).due === DISC2, 'the disclosure deadline record did not move');
  check(namedDeadlines(RETAINED).filter((d) => /disclosure/i.test(d.desc)).length === 1,
    'moving the disclosure date left a stale duplicate disclosure deadline on the calendar');

  // The consulting-only expert owns nothing on the diary: no report date, no
  // disclosure date, and therefore no record anywhere carrying their name.
  check(!byName(CONSULTING).deadlineId, 'a consulting-only expert with no report date acquired a deadline');
  check(!byName(CONSULTING).disclosureDeadlineId, 'a consulting-only expert acquired a disclosure deadline');
  check(namedDeadlines(CONSULTING).length === 0, `${CONSULTING} (consulting-only) is named on ${namedDeadlines(CONSULTING).length} deadline record(s)`);

  // -------------------------------------- 2c. THE DISCLOSURE SURFACE ITSELF
  // Form 53 is the instrument served with the report under r. 53.03(2.1). It
  // must carry the disclosed expert and nobody else.
  await POST('/r/experts/form53', { id: v0.id, party: 'Kavanagh Holdings', signedDate: day(-3), independence: 'None disclosed.', acknowledged: '1' });
  const v3 = byName(RETAINED);
  check(v3.form53 && v3.form53.acknowledged === true, 'Form 53 acknowledgment was not recorded on the expert file');
  check(v3.form53 && v3.form53.party === 'Kavanagh Holdings', `Form 53 party is ${JSON.stringify(v3.form53 && v3.form53.party)}`);

  const f53 = await GET('/r/experts/form53/download?id=' + encodeURIComponent(v0.id));
  check(f53.status === 200, `Form 53 download -> HTTP ${f53.status}`);
  check(/text\/plain/.test(f53.headers.get('content-type') || ''), 'Form 53 download is not served as text/plain');
  check(f53.text.includes('FORM 53'), 'Form 53 download did not render the form');
  check(f53.text.includes(RETAINED), 'Form 53 for the retained expert does not name that expert');
  check(f53.text.includes('Kavanagh Holdings'), 'Form 53 does not name the engaging party');
  check(!f53.text.includes(CONSULTING), `PRIVILEGE LEAK: the consulting-only expert ${CONSULTING} appears on the Form 53 served for another expert`);

  // ...and it must be matter-scoped: an id from another matter must not pull
  // that matter's expert onto this matter's disclosure surface.
  const leak = await GET('/r/experts/form53/download?id=' + encodeURIComponent(sealedExpert.id), m.id);
  check(leak.status === 303, `another matter's expert id must be refused, not served: HTTP ${leak.status}`);
  check(!/FORM 53/.test(leak.text) && !leak.text.includes(SEALED), `PRIVILEGE LEAK: another matter's expert (${SEALED}) was served from this matter's Form 53 download`);
  // ...and the page it lands on is this matter's expert room, which genuinely
  // renders expert names — so the absence below is a real absence, not an
  // empty haystack.
  const after = await GET('/r/experts');
  check(after.text.includes(RETAINED), 'sanity: the expert room does not render this matter\'s own experts');
  check(!after.text.includes(SEALED), `PRIVILEGE LEAK: another matter's expert ${SEALED} reached this matter's expert room`);

  // ------------------------------------------- 3. THE DEADLINE SURFACES
  const cal = await GET('/r/calendar');
  check(cal.status === 200, `GET /r/calendar -> HTTP ${cal.status}`);
  check(cal.text.includes(`Expert report due — ${RETAINED}`), 'the expert report deadline is not on the Trial Calendar');
  check(cal.text.includes(FUTURE), `the Trial Calendar does not carry the report date ${FUTURE}`);
  check(cal.text.includes(`Expert disclosure served — ${RETAINED}`), 'the expert disclosure deadline is not on the Trial Calendar');
  check(!cal.text.includes(CONSULTING), `PRIVILEGE LEAK: the consulting-only expert ${CONSULTING} appears on the Trial Calendar`);

  const desk = await GET('/r/desk');
  check(desk.status === 200, `GET /r/desk -> HTTP ${desk.status}`);
  check(desk.text.includes(`Expert report due — ${RETAINED}`), 'the expert report deadline is not on the firm diary (27-desk)');
  check(!desk.text.includes(CONSULTING), `PRIVILEGE LEAK: the consulting-only expert ${CONSULTING} appears on the firm diary`);

  // The ICS phone feed — the deadline surface that leaves the building.
  await POST('/r/calendar/feed-new', {});
  const feed = store.firm.list('calfeed').find((f) => f.userId === admin.id);
  check(!!feed, 'minting the phone feed created no calfeed record');
  if (feed) {
    const ics = await GET('/r/calendar/feed/' + feed.id);
    const unfolded = ics.text.replace(/\r\n /g, '');
    check(ics.status === 200, `ICS feed -> HTTP ${ics.status}`);
    check(unfolded.includes(`SUMMARY:[${m.title}] Expert report due — ${RETAINED}`), 'the expert report deadline is not on the ICS phone feed');
    check(unfolded.includes('DTSTART;VALUE=DATE:' + FUTURE.replace(/-/g, '')), `the ICS feed does not carry the report date ${FUTURE}`);
    check(!unfolded.includes(CONSULTING), `PRIVILEGE LEAK: the consulting-only expert ${CONSULTING} is syndicated on the ICS phone feed`);
  }

  server.close();
  if (fails.length) { console.error('EXPERTS FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('EXPERTS: ALL PASS (report due tracked + shows overdue + moves in place; unretained expert cannot serve a report; consulting-only identity absent from Form 53, calendar, diary and ICS feed; retained expert present on all three)');
  process.exit(0);
})().catch((e) => { console.error('EXPERTS ERROR:', e.stack || e.message); try { server.close(); } catch (_) {} process.exit(1); });
