'use strict';
// CHRONOLOGY — the sourced fact narrative (room 06) and its downstream use as
// element support in Pleadings (room 10).
//
// Four things here are malpractice-grade if they are wrong:
//   1. ORDER. A chronology that renders in entry order rather than date order is
//      a false timeline. Counsel reads causation off the sequence; if the render
//      does not sort, the story is wrong on its face.
//   2. DISPUTE. A fact the other side contests must be visibly marked as
//      disputed everywhere it is read, including the statement of facts that
//      gets pasted into a factum. An unmarked disputed fact is an assertion to
//      the court that it is agreed.
//   3. SOURCE. Source-or-drop: no pin, no fact — and the pin must survive
//      through to the narrative, or the statement of facts cites nothing.
//   4. ELEMENT SUPPORT. A fact mapped to an element of a cause of action must
//      show against THAT element and no other; the gap queue must stop calling
//      the element unsupported once it is supported.
//
// Everything below is driven over HTTP through the real router (POSTs carry an
// `origin` header, the way a browser does) and asserted on what actually
// changed: the stored record, the rendered row, the queue's decision.
const fs = require('fs'), os = require('os');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/chrono-');
process.env.PORT = String(33600 + Math.floor(Math.random() * 150));

const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'chrono@f', name: 'C Admin', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const matter = store.createMatter({ title: 'Beaumont Foods v. Ridgeline', client: 'Beaumont Foods', jurisdiction: 'on', status: 'open' }, admin.id);
const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;
const cookie = `s=${session}; m=${matter.id}`;
const sc = () => store.matterScope(matter.id);

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

async function get(path) {
  const r = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const text = await r.text();
  if (r.status !== 200) throw new Error(`GET ${path} -> ${r.status}`);
  return text;
}
async function post(path, form) {
  const r = await fetch(base + path, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(form).toString(),
  });
  await r.text();
  if (r.status >= 500) throw new Error(`POST ${path} -> ${r.status}`);
  return r.status;
}
// Table rows are the unit of "shows against" — bounded by <tr>…</tr> so a row
// check cannot bleed into the form that follows the table.
const rows = (h) => (h.match(/<tr>[\s\S]*?<\/tr>/g) || []);
const rowsWith = (h, needle) => rows(h).filter((r) => r.includes(needle));

// Three facts, ENTERED out of order on purpose. Chronological order is F2, F3, F1.
const F1 = { date: '2025-06-10', factActor: 'Ridgeline Logistics', text: 'Ridgeline stopped all shipments under the supply agreement.', source: 'Ex. 12 p.4', disputed: 'yes', issues: 'breach, damages' };
const F2 = { date: '2024-01-15', factActor: 'Beaumont Foods', text: 'The parties signed the supply agreement.', source: 'Ex. 1 p.1', disputed: 'no', issues: 'contract' };
const F3 = { date: '2025-01-02', factActor: 'Beaumont Foods', text: 'Beaumont delivered the January purchase order.', source: 'Doe transcript 41:12', disputed: 'no', issues: 'performance' };

(async () => {
  for (const f of [F1, F2, F3]) await post('/r/chronology/add', f);

  const stored = sc().list('fact');
  check(stored.length === 3, `expected 3 facts stored, got ${stored.length}`);
  const byText = (t) => stored.find((f) => f.text === t);
  const s1 = byText(F1.text), s2 = byText(F2.text), s3 = byText(F3.text);
  if (!s1 || !s2 || !s3) { fails.push('a posted fact was not stored at all'); throw new Error(fails.join('; ')); }

  // ---- 1. The record the room wrote -------------------------------------
  check(s1.source === 'Ex. 12 p.4', `fact lost its source pin: ${JSON.stringify(s1.source)}`);
  check(s3.source === 'Doe transcript 41:12', `fact lost its source pin: ${JSON.stringify(s3.source)}`);
  check(s1.disputed === true, `disputed:'yes' did not store as boolean true (got ${JSON.stringify(s1.disputed)})`);
  check(s2.disputed === false, `disputed:'no' did not store as boolean false (got ${JSON.stringify(s2.disputed)})`);
  check(Array.isArray(s1.issues) && s1.issues.join('|') === 'breach|damages',
    `issue tags not parsed to an array: ${JSON.stringify(s1.issues)}`);

  // Precondition for the ordering proof: storage hands facts back in ENTRY
  // order, so a date-ordered render can only come from the room sorting.
  check(stored.map((f) => f.date).join(',') === '2025-06-10,2024-01-15,2025-01-02',
    `precondition broken — storage no longer returns entry order (${stored.map((f) => f.date).join(',')})`);

  // ---- 2. Chronological render, whatever the entry order ----------------
  const page = await get('/r/chronology');
  const timeline = page.slice(page.indexOf('Timeline'));
  check(timeline.length > 0, 'timeline section missing from /r/chronology');
  const at = (t) => timeline.indexOf(t);
  check(at(F2.text) > -1 && at(F3.text) > -1 && at(F1.text) > -1, 'a stored fact is missing from the rendered timeline');
  check(at(F2.text) < at(F3.text) && at(F3.text) < at(F1.text),
    `timeline is not in date order — rendered ${[[at(F2.text), '2024-01-15'], [at(F3.text), '2025-01-02'], [at(F1.text), '2025-06-10']].sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(' → ')}`);
  const renderedDates = rows(timeline).map((r) => (r.match(/\d{4}-\d{2}-\d{2}/) || [])[0]).filter(Boolean);
  check(renderedDates.join(',') === '2024-01-15,2025-01-02,2025-06-10',
    `date column not ascending: ${renderedDates.join(',')}`);

  // ---- 3. Disputed is visible on the face of the timeline ----------------
  const r1 = rowsWith(timeline, F1.text), r2 = rowsWith(timeline, F2.text);
  check(r1.length === 1 && r2.length === 1, 'expected exactly one timeline row per fact');
  check(/<span class="tag [^"]*">disputed<\/span>/.test(r1[0] || ''), 'the disputed fact is NOT marked disputed in the timeline');
  check(/<span class="tag [^"]*">undisputed<\/span>/.test(r2[0] || ''), 'an undisputed fact is not marked undisputed');
  check(!/<span class="tag [^"]*">disputed<\/span>/.test(r2[0] || ''), 'an undisputed fact is wrongly marked disputed');

  // ---- 4. The statement of facts: numbered, ordered, sourced, flagged ----
  const narr = await get('/r/chronology/narrative');
  const paras = [...narr.matchAll(/<b class="num">(\d+)\.<\/b>([\s\S]*?)<\/p>/g)].map((m) => ({ n: Number(m[1]), body: m[2] }));
  check(paras.length === 3, `narrative rendered ${paras.length} numbered paragraphs, expected 3`);
  const p = (n) => (paras.find((x) => x.n === n) || { body: '' }).body;
  check(p(1).includes(F2.text) && p(2).includes(F3.text) && p(3).includes(F1.text),
    'narrative paragraphs are not numbered in chronological order');
  check(p(1).includes('Ex. 1 p.1'), 'narrative paragraph 1 dropped its source pin');
  check(p(2).includes('Doe transcript 41:12'), 'narrative paragraph 2 dropped its source pin');
  check(p(3).includes('Ex. 12 p.4'), 'narrative paragraph 3 dropped its source pin');
  check(p(3).includes('[disputed]'), 'the disputed fact is NOT flagged as disputed in the statement of facts');
  check(!p(1).includes('[disputed]'), 'an undisputed fact is flagged disputed in the statement of facts');
  check(p(3).includes('2025-06-10') && p(3).includes('Ridgeline Logistics'), 'narrative paragraph lost its date or actor');

  // ---- 5. Source-or-drop: no pin, no fact --------------------------------
  await post('/r/chronology/add', { date: '2025-03-03', factActor: 'Ridgeline Logistics', text: 'Ridgeline denied receiving notice.', source: '  ', disputed: 'no', issues: '' });
  check(sc().list('fact').length === 3, 'a fact with no source pin entered the chronology (source-or-drop breached)');
  const afterRefusal = await get('/r/chronology');
  check(/source-or-drop/i.test(afterRefusal), 'the unsourced fact was refused without telling counsel why');
  check(!afterRefusal.includes('Ridgeline denied receiving notice.'), 'the refused fact still rendered in the timeline');

  // ---- 6. Facts show against the element they were mapped to -------------
  await post('/r/pleadings/cause', { side: 'claim', set: 'on-contract' });
  const cause = sc().list('cause')[0];
  if (!cause) { fails.push('cause of action was not created'); throw new Error(fails.join('; ')); }
  const BREACH = 'Breach by the defendant', DAMAGES = 'Damages flowing from the breach';

  const before = await get('/r/pleadings');
  check(rowsWith(before, BREACH).some((r) => r.includes('no fact behind it')),
    'gap queue did not report the unsupported element before mapping');

  await post('/r/pleadings/link', { cause: cause.id, element: 'breach', fact: s1.id });
  const mapping = sc().get('cause', cause.id).mapping || {};
  check((mapping.breach || []).includes(s1.id), `mapping did not record the fact against 'breach': ${JSON.stringify(mapping)}`);
  check(!(mapping.damages || []).length, "mapping leaked the fact onto the 'damages' element");

  const pl = await get('/r/pleadings');
  const breachRows = rowsWith(pl, BREACH), damagesRows = rowsWith(pl, DAMAGES);
  check(breachRows.some((r) => r.includes(F1.text) && r.includes('Ex. 12 p.4')),
    'the mapped fact (and its source pin) does not show against its element');
  check(breachRows.some((r) => /supported/.test(r)), "the mapped element is not marked supported");
  check(!breachRows.some((r) => r.includes('no fact behind it')),
    'the gap queue still calls the element unsupported after a fact was mapped to it');
  check(!damagesRows.some((r) => r.includes(F1.text)), 'the fact shows against an element it was never mapped to');
  check(damagesRows.some((r) => r.includes('no factual support yet') || r.includes('no fact behind it')),
    'an element with no fact behind it is not flagged as unsupported');

  // ---- 7. Marking a fact disputed changes the record and the page --------
  await post('/r/chronology/dispute', { id: s3.id });
  check(sc().get('fact', s3.id).disputed === true, 'dispute toggle did not flip the stored record');
  const toggled = await get('/r/chronology');
  const r3 = rowsWith(toggled.slice(toggled.indexOf('Timeline')), F3.text);
  check(/<span class="tag [^"]*">disputed<\/span>/.test(r3[0] || ''), 'a newly disputed fact is not shown as disputed');

  server.close();
  if (fails.length) { console.error('CHRONOLOGY FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('CHRONOLOGY: ALL PASS (date-ordered timeline from out-of-order entry, disputed flagged in timeline and statement of facts, source pins carried through, facts shown against their mapped element)');
  process.exit(0);
})().catch((e) => { console.error('CHRONOLOGY ERROR:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
