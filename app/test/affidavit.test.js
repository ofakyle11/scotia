'use strict';
// AFFIDAVIT — room 35, Ontario r. 30.03 / Form 30A.
//
// This is SWORN material served on the opposing party. Schedule A is what the
// party produces; Schedule B is what it withholds on privilege, with grounds.
// A document that lands in the wrong schedule is not a display bug: a
// privileged document listed in Schedule A is produced, and producing it is a
// waiver of the privilege. A responsive document in neither schedule is a
// false oath ("I have never had in my possession ... any document other than
// those listed").
//
// So this suite drives the real pipeline the way a lawyer does — code the
// review set through room 13's router, then read room 35's rendered affidavit
// and its downloadable sworn text — and asserts the EXACT membership of each
// schedule by bates number, not that the page returned 200. It then RECODES a
// document through the router and proves the schedules actually moved, so a
// hard-wired or stale affidavit cannot pass.
//
// Contract (docs/CONTRACT-SHEET.md, `document`): responsive is the STRING
// 'yes'|'no', privilege is 'none'|'solicitor-client'|'litigation', and
// withheld (privilege !== 'none') wins over responsive.
const fs = require('fs'), os = require('os'), path = require('path');

process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'affidavit-'));
process.env.PORT = String(33400 + Math.floor(Math.random() * 151));

const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', {
  email: 'dep@f', name: 'Deponent Lawyer', role: 'admin', active: true,
  pw: hashPassword('a-long-password-here'),
}, 't');
const matter = store.createMatter(
  { title: 'Ferrante v. Northgate Haulage Ltd.', client: 'Northgate Haulage Ltd.', jurisdiction: 'on', status: 'open' },
  admin.id);

const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;
const COOKIE = `s=${session}; m=${matter.id}`;

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const eqSet = (got, want, msg) => {
  const g = [...new Set(got)].sort().join(','), w = [...new Set(want)].sort().join(',');
  if (g !== w) fails.push(`${msg}\n      expected exactly: [${w}]\n      actually got:     [${g}]`);
};

const post = (url, form) => fetch(base + url, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: COOKIE, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(form).toString(),
});
const get = (url) => fetch(base + url, { headers: { cookie: COOKIE } });

// Slice one schedule out of a rendered/plain affidavit. The section headings
// are unique in both renderings.
function section(text, from, to) {
  const a = text.indexOf(from);
  if (a < 0) { fails.push(`affidavit is missing the section heading: ${from}`); return ''; }
  const b = to ? text.indexOf(to, a) : -1;
  return text.slice(a, b < 0 ? text.length : b);
}
const batesIn = (s) => (s.match(/DEF-\d{6}/g) || []);

(async () => {
  // ---- the review set, coded through room 13's real router --------------
  // Every document below is added through POST /r/review/add exactly as the
  // browser form does, so the coding under test is the coding the app writes.
  const add = async (d) => {
    const r = await post('/r/review/add', {
      title: d.title, text: d.text || (d.title + ' — body text'),
      custodian: d.custodian || 'R. Okafor', docDate: d.date || '2024-03-04',
      privilege: d.privilege || 'none', responsive: d.responsive || 'no',
      author: d.author || '', recipients: d.recipients || '', privDesc: d.privDesc || '',
    });
    if (r.status !== 303) fails.push(`review intake refused "${d.title}" (status ${r.status})`);
  };

  // Bates are assigned monotonically on intake, so these are DEF-000001..06.
  await add({ title: 'Fleet maintenance log, Unit 41', responsive: 'yes' });                 // 1 -> A
  await add({ title: 'Bill of lading 88214', responsive: 'yes' });                           // 2 -> A
  await add({ title: 'Memo to counsel: liability exposure', responsive: 'yes',               // 3 -> B
    privilege: 'solicitor-client', author: 'R. Okafor', recipients: 'M. Sandhu (counsel)',
    privDesc: 'Legal advice sought on liability exposure' });
  await add({ title: 'Investigator interview notes', responsive: 'yes',                      // 4 -> B
    privilege: 'litigation', author: 'K. Vance', recipients: 'M. Sandhu (counsel)',
    privDesc: 'Investigator notes prepared in contemplation of litigation' });
  await add({ title: 'Staff cafeteria menu, March 2024', responsive: 'no' });                // 5 -> neither
  await add({ title: 'Unreviewed scan batch 12' });                                          // 6 -> neither (uncoded)

  const docs = store.matterScope(matter.id).list('document')
    .sort((a, b) => (a.bates || '').localeCompare(b.bates || ''));
  const B = {};
  for (const d of docs) B[d.title.split(',')[0].split(':')[0]] = d.bates;
  const bFleet = B['Fleet maintenance log'], bLading = B['Bill of lading 88214'];
  const bMemo = B['Memo to counsel'], bNotes = B['Investigator interview notes'];
  const bMenu = B['Staff cafeteria menu'], bScan = B['Unreviewed scan batch 12'];
  ok(docs.length === 6, `expected 6 documents in the review set, found ${docs.length}`);
  ok([bFleet, bLading, bMemo, bNotes, bMenu, bScan].every(Boolean), 'a document failed to get a bates number');

  // Guard the contract itself: room 13 must have stored responsive as the
  // STRING 'yes' (a boolean true here is the bug that silently emptied three
  // other rooms), otherwise everything below is testing the wrong thing.
  const fleet = docs.find((d) => d.bates === bFleet);
  ok(fleet.responsive === 'yes', `room 13 stored responsive as ${JSON.stringify(fleet.responsive)}, contract says the string 'yes'`);

  // ---- the rendered affidavit -------------------------------------------
  const page = await get('/r/affidavit');
  ok(page.status === 200, `/r/affidavit did not render (status ${page.status})`);
  const htmlText = await page.text();

  const htmlA = section(htmlText, 'Schedule A — documents produced', 'Schedule B — documents withheld');
  const htmlB = section(htmlText, 'Schedule B — documents withheld', 'Schedule C — documents no longer');

  eqSet(batesIn(htmlA), [bFleet, bLading],
    'SCHEDULE A (rendered) does not list exactly the responsive, non-privileged documents');
  eqSet(batesIn(htmlB), [bMemo, bNotes],
    'SCHEDULE B (rendered) does not list exactly the privileged documents');

  // No document may sit in both schedules — that is production AND a privilege
  // claim over the same document.
  const both = batesIn(htmlA).filter((b) => batesIn(htmlB).includes(b));
  ok(both.length === 0, `PRIVILEGE WAIVER: ${both.join(', ')} appears in BOTH Schedule A and Schedule B`);

  // Uncoded / non-responsive documents are sworn to in neither schedule.
  for (const [b, what] of [[bMenu, 'a not-responsive document'], [bScan, 'an uncoded document']])
    ok(!batesIn(htmlA).includes(b) && !batesIn(htmlB).includes(b),
      `${what} (${b}) was listed in a schedule of the sworn affidavit`);

  // Grounds must be stated per withheld document, and the two heads must not be
  // swapped — the ground is what the opposing party tests the claim against.
  const rowOf = (sec, bates) => {
    const i = sec.indexOf(bates);
    return i < 0 ? '' : sec.slice(i, sec.indexOf('</tr>', i) + 5 || sec.length);
  };
  ok(/Solicitor-client privilege/.test(rowOf(htmlB, bMemo)),
    `Schedule B row for ${bMemo} does not state solicitor-client privilege as its grounds`);
  ok(/Litigation privilege/.test(rowOf(htmlB, bNotes)),
    `Schedule B row for ${bNotes} does not state litigation privilege as its grounds`);
  ok(rowOf(htmlB, bMemo).includes('Legal advice sought on liability exposure'),
    `Schedule B row for ${bMemo} does not carry its subject description (r. 30.03 requires it)`);

  // ---- the downloadable sworn text: same partition, or the served copy lies
  const dl = await post('/r/affidavit/download', {});
  ok(dl.status === 200, `affidavit download failed (status ${dl.status})`);
  const txt = await dl.text();
  const txtA = section(txt, 'SCHEDULE A —', 'SCHEDULE B —');
  const txtB = section(txt, 'SCHEDULE B —', 'SCHEDULE C —');
  eqSet(batesIn(txtA), [bFleet, bLading], 'SCHEDULE A of the DOWNLOADED affidavit differs from the correct set');
  eqSet(batesIn(txtB), [bMemo, bNotes], 'SCHEDULE B of the DOWNLOADED affidavit differs from the correct set');
  ok(/grounds: Solicitor-client privilege/.test(txtB.split('\n').find((l) => l.includes(bMemo)) || ''),
    `downloaded Schedule B states the wrong grounds for ${bMemo}`);
  ok(/grounds: Litigation privilege/.test(txtB.split('\n').find((l) => l.includes(bNotes)) || ''),
    `downloaded Schedule B states the wrong grounds for ${bNotes}`);

  // The affidavit is served on the other side: a withheld document is described
  // by its neutral subject, never by the title of the privileged communication.
  ok(!txt.includes('Memo to counsel: liability exposure'),
    'the served affidavit discloses the TITLE of a privileged document instead of its neutral subject');

  // ---- recode, and prove the affidavit actually follows ------------------
  // Without this, a hard-wired or cached schedule would pass everything above.
  const memoDoc = docs.find((d) => d.bates === bMemo);
  const menuDoc = docs.find((d) => d.bates === bMenu);
  // Counsel realises the memo was never privileged, and the menu is responsive.
  const r1 = await post('/r/review/code', { id: memoDoc.id, privilege: 'none', responsive: 'yes' });
  const r2 = await post('/r/review/code', { id: menuDoc.id, privilege: 'none', responsive: 'yes' });
  ok(r1.status === 303 && r2.status === 303, `recoding through room 13 was refused (${r1.status}/${r2.status})`);

  const page2 = await (await get('/r/affidavit')).text();
  const a2 = batesIn(section(page2, 'Schedule A — documents produced', 'Schedule B — documents withheld'));
  const b2 = batesIn(section(page2, 'Schedule B — documents withheld', 'Schedule C — documents no longer'));
  eqSet(a2, [bFleet, bLading, bMemo, bMenu],
    'after recoding, Schedule A did not pick up the newly producible documents');
  eqSet(b2, [bNotes], 'after recoding, Schedule B still withholds a document whose privilege claim was dropped');
  ok(!b2.includes(bMemo), `FALSE CLAIM: ${bMemo} is still withheld on privilege after the claim was dropped`);
  ok(!a2.includes(bNotes), `PRIVILEGE WAIVER: ${bNotes} moved into Schedule A while still coded privileged`);

  server.close();
  if (fails.length) {
    console.error('AFFIDAVIT FAIL:\n  - ' + fails.join('\n  - '));
    process.exit(1);
  }
  console.log('AFFIDAVIT: ALL PASS (Schedule A = responsive & unprivileged, Schedule B = privileged with correct grounds, no overlap, uncoded documents in neither, and both schedules follow a recode)');
  process.exit(0);
})().catch((e) => {
  console.error('AFFIDAVIT ERROR:', e && e.stack || e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
