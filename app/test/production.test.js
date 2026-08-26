'use strict';
// PRODUCTION — the document production path, end to end over real HTTP.
//
// Three things here are malpractice if they are wrong, and none of them is
// visible from an HTTP status code:
//   1. THE PRODUCED SET. A document is producible iff it is coded responsive
//      AND not privileged. Responsiveness is the STRING 'yes' (rooms/13-review
//      respOf) — a boolean true silently means "not responsive", which is how a
//      previous gate shipped three rooms rendering empty states while claiming
//      to have data. So the set is built through the real router and then
//      checked document by document, not counted.
//   2. PRIVILEGE. A privileged document is NEVER in a production volume, even
//      when it is also coded responsive — privilege wins over responsiveness.
//      Waiver here is not recoverable, so this is asserted against the frozen
//      ids AND against the bytes of the load file that actually leaves the firm.
//   3. THE LOAD FILE. What is served must be the volume that was assembled, not
//      the live coding as it stands today. A volume is a frozen snapshot; if
//      recoding in room 13 leaked into an already-served volume's .dat, the
//      index served on the other side would no longer describe what went out.
// Bates are also checked for the property that makes them evidence at all: one
// bates number, one document, never two — within a volume and across volumes.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/chambers-production-');
process.env.PORT = String(33200 + Math.floor(Math.random() * 151));
const { app, makeCtx, store, auth, audit } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const lawyer = store.firm.put('user', { email: 'p@f', name: 'P. Counsel', role: 'lawyer', active: true, pw: hashPassword('long-enough-password') }, 't');
const matter = store.createMatter({ title: 'Production v. Production', client: 'C', jurisdiction: 'on', status: 'open' }, lawyer.id);
const empty = store.createMatter({ title: 'Privileged Only Ltd.', client: 'C2', jurisdiction: 'on', status: 'open' }, lawyer.id);
const session = auth.createSession(lawyer.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

const H = (mid) => ({ cookie: `s=${session}; m=${mid}`, 'content-type': 'application/x-www-form-urlencoded', origin: base });
const post = (p, form, mid = matter.id) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: H(mid), body: new URLSearchParams(form).toString() });
const get = (p, mid = matter.id) => fetch(base + p, { headers: { cookie: `s=${session}; m=${mid}` } }).then((r) => r.text());
const scope = (mid = matter.id) => store.matterScope(mid);
const docs = (mid = matter.id) => scope(mid).list('document');
const byTitle = (t, mid = matter.id) => docs(mid).find((d) => d.title === t);
const prods = (mid = matter.id) => scope(mid).list('production').sort((a, b) => String(a.volume).localeCompare(String(b.volume)));

// Concordance .dat: ASCII 254 text qualifier, ASCII 20 field delimiter, CRLF rows.
const parseDat = (text) => text.split('\r\n').filter((l) => l.length).map((l) => l.split('\x14').map((f) => f.replace(/^\xFE/, '').replace(/\xFE$/, '')));

(async () => {
  // ---- 1. Build a review set through room 13's real intake -----------------
  // Six documents spanning every corner of the coding matrix.
  const SET = [
    { title: 'Delivery schedule', responsive: 'yes', privilege: 'none', custodian: 'Ops' },                       // producible
    { title: 'Family photographs', responsive: 'no', privilege: 'none', custodian: 'Ops' },                       // neither
    { title: 'Advice from counsel', responsive: 'yes', privilege: 'solicitor-client', custodian: 'GC',            // WITHHELD: privilege beats responsive
      author: 'M. Solicitor', privDesc: 'Legal advice on the supply dispute' },
    { title: 'Litigation strategy memo', responsive: 'no', privilege: 'litigation', custodian: 'GC',
      author: 'M. Solicitor', privDesc: 'Counsel work product prepared for this action' },                        // withheld
    { title: 'Boolean-coded note', responsive: 'true', privilege: 'none', custodian: 'Ops' },                     // NOT 'yes' -> not responsive
    { title: 'Shipping manifest', responsive: 'yes', privilege: 'none', custodian: 'Ops' },                       // producible
  ];
  for (const d of SET) await post('/r/review/add', { ...d, text: 'body of ' + d.title, docDate: '2025-03-04' });
  assert.strictEqual(docs().length, 6, `room 13 stored ${docs().length} documents, expected 6`);

  const D = Object.fromEntries(SET.map((d) => [d.title, byTitle(d.title)]));
  const bates = (t) => D[t].bates;

  // The trap that made a previous harness lie: 'true' is not 'yes'.
  assert.strictEqual(D['Boolean-coded note'].responsive, 'no',
    `a non-'yes' responsive value was stored as ${JSON.stringify(D['Boolean-coded note'].responsive)} — the room must coerce it to 'no'`);
  assert.strictEqual(D['Delivery schedule'].responsive, 'yes', 'a document coded responsive did not store the string yes');

  // Bates are contiguous, unique and one per document.
  const allBates = docs().map((d) => d.bates).sort();
  assert.deepStrictEqual(allBates, ['DEF-000001', 'DEF-000002', 'DEF-000003', 'DEF-000004', 'DEF-000005', 'DEF-000006'],
    `bates were not assigned contiguously: ${allBates.join(', ')}`);

  // ---- 2. The room renders the real set, not an empty state ---------------
  const page = await get('/r/production');
  const m = /<dt>Producible now<\/dt><dd><span class="num">(\d+)<\/span>/.exec(page);
  assert(m, 'Production room did not render the producible count — it fell through to an empty state with data present');
  assert.strictEqual(Number(m[1]), 2, `room counted ${m[1]} producible documents, expected 2 (responsive + not privileged)`);
  const w = /<dt>Withheld<\/dt><dd>[\s\S]{0,80}?(\d+) on privilege log/.exec(page);
  assert(w && Number(w[1]) === 2, `room did not show 2 documents on the privilege log (got ${w && w[1]})`);
  assert(page.includes('Solicitor-client privilege'), 'privilege log did not render the basis for the withheld document');

  // ---- 3. The assembly gate ------------------------------------------------
  await post('/r/production/assemble', { recipient: '', servedDate: '2026-08-20' });
  assert.strictEqual(prods().length, 0, 'a volume was assembled with no recipient named');
  await post('/r/production/assemble', { recipient: 'Smith LLP', servedDate: '2026-02-31' });
  assert.strictEqual(prods().length, 0, 'a volume was served on 2026-02-31, a day nobody lived');

  // A matter whose only responsive document is privileged produces NOTHING.
  await post('/r/review/add', { title: 'Privileged only', responsive: 'yes', privilege: 'solicitor-client', text: 'x', author: 'A', privDesc: 'advice' }, empty.id);
  await post('/r/production/assemble', { recipient: 'Smith LLP' }, empty.id);
  assert.strictEqual(prods(empty.id).length, 0,
    'a volume was assembled from a set whose only responsive document is privileged — that volume would have been a privilege waiver');

  // ---- 4. Assemble PROD001 and check the frozen set document by document ---
  const r1 = await post('/r/production/assemble', { recipient: 'Smith LLP (counsel for the plaintiff)', servedDate: '2026-08-20' });
  assert.strictEqual(r1.status, 303, `assemble returned ${r1.status}`);
  assert.strictEqual(prods().length, 1, 'assembly did not write a production record');
  const v1 = prods()[0];
  assert.strictEqual(v1.volume, 'PROD001', `first volume named ${v1.volume}`);

  const idsOf = (vol) => (vol.documentIds || []).slice();
  assert.deepStrictEqual(idsOf(v1), [D['Delivery schedule'].id, D['Shipping manifest'].id],
    'PROD001 did not freeze exactly the responsive, not-privileged documents in bates order');
  // Said the other way, per document, so a coincidence of counts cannot pass:
  for (const t of ['Advice from counsel', 'Litigation strategy memo'])
    assert(!idsOf(v1).includes(D[t].id), `PRIVILEGE WAIVER: "${t}" is privileged and was produced in ${v1.volume}`);
  for (const t of ['Family photographs', 'Boolean-coded note'])
    assert(!idsOf(v1).includes(D[t].id), `"${t}" is not coded responsive but was produced in ${v1.volume}`);
  assert.deepStrictEqual((v1.withheldIds || []).slice(), [D['Advice from counsel'].id, D['Litigation strategy memo'].id],
    'the privilege log frozen into PROD001 is not exactly the privileged set');
  assert.strictEqual(idsOf(v1).filter((id) => (v1.withheldIds || []).includes(id)).length, 0,
    'a document is both produced and on the privilege log — it must be one or the other');
  assert.strictEqual(v1.batesStart, bates('Delivery schedule'), `PROD001 batesStart ${v1.batesStart} does not match its first document`);
  assert.strictEqual(v1.batesEnd, bates('Shipping manifest'), `PROD001 batesEnd ${v1.batesEnd} does not match its last document`);
  assert.strictEqual(v1.recipient, 'Smith LLP (counsel for the plaintiff)');
  assert.strictEqual(v1.servedDate, '2026-08-20');

  // The audit line is the firm's own record of what went to whom, when.
  const line = audit.tail(50).find((e) => e.action === 'production.served');
  assert(line, 'no immutable audit line was written for the served volume');
  for (const frag of ['PROD001', 'to=Smith LLP', 'on=2026-08-20', '2 docs', `${v1.batesStart}-${v1.batesEnd}`, 'withheld=2'])
    assert(String(line.object).includes(frag), `audit line is missing ${frag}: ${line.object}`);

  // ---- 5. The load file is the volume that was served ---------------------
  const loadfile = async (vol, format) => {
    const r = await post('/r/production/loadfile', { id: vol.id, format });
    assert.strictEqual(r.status, 200, `${format} load file returned ${r.status}`);
    assert(/attachment; filename="([^"]+)"/.test(r.headers.get('content-disposition') || ''), 'load file was not served as a download');
    assert.strictEqual(/filename="([^"]+)"/.exec(r.headers.get('content-disposition'))[1], `${vol.volume}.${format}`,
      'the load file is not named for the volume it belongs to');
    return r.text();
  };
  const dat1 = await loadfile(v1, 'dat');
  const rows1 = parseDat(dat1);
  assert.deepStrictEqual(rows1[0], ['BATESBEGIN', 'BATESEND', 'CUSTODIAN', 'DATE', 'DOCTITLE'], 'the .dat header row is not the Concordance field list');
  assert.deepStrictEqual(rows1.slice(1).map((r) => r[0]), [bates('Delivery schedule'), bates('Shipping manifest')],
    'the .dat body does not list exactly the documents frozen into PROD001, in bates order');
  assert.deepStrictEqual(rows1.slice(1).map((r) => r[4]), ['Delivery schedule', 'Shipping manifest'], 'the .dat titles do not match the served documents');
  for (const t of ['Advice from counsel', 'Litigation strategy memo'])
    assert(!dat1.includes(bates(t)) && !dat1.includes(t),
      `PRIVILEGE WAIVER: the load file served with ${v1.volume} names privileged document "${t}"`);
  for (const t of ['Family photographs', 'Boolean-coded note'])
    assert(!dat1.includes(bates(t)), `the load file names "${t}", which is not in the produced set`);

  const opt1 = (await loadfile(v1, 'opt')).split('\r\n').filter(Boolean).map((l) => l.split(','));
  assert.deepStrictEqual(opt1.map((r) => r[0]), [bates('Delivery schedule'), bates('Shipping manifest')], 'the .opt image keys are not the served bates');
  assert(opt1.every((r) => r[1] === 'PROD001' && r[2] === `\\IMAGES\\PROD001\\${r[0]}.TIF`), 'the .opt rows do not point at the volume actually served');

  // ---- 6. A served volume is frozen; later coding does not follow it ------
  // Recode a previously non-responsive document as responsive AFTER service.
  await post('/r/review/code', { id: D['Family photographs'].id, responsive: 'yes', privilege: 'none' });
  assert.strictEqual(byTitle('Family photographs').responsive, 'yes', 'the recode did not take');
  const v1after = scope().get('production', v1.id);
  assert.deepStrictEqual((v1after.documentIds || []).slice(), idsOf(v1), 'recoding in room 13 changed what a served volume contains');
  const dat1again = await loadfile(v1after, 'dat');
  assert.strictEqual(dat1again, dat1, 'the load file for an already-served volume changed after later recoding — it must describe what went out');

  // ---- 7. A second volume: bates never collide across volumes -------------
  await post('/r/review/add', { title: 'Second tranche invoice', responsive: 'yes', privilege: 'none', custodian: 'AP', text: 'inv', docDate: '2025-06-01' });
  await post('/r/production/assemble', { recipient: 'Smith LLP (counsel for the plaintiff)', servedDate: '2026-08-25' });
  assert.strictEqual(prods().length, 2, 'the second volume was not assembled');
  const v2 = prods()[1];
  assert.strictEqual(v2.volume, 'PROD002', `second volume named ${v2.volume}`);
  assert.notStrictEqual(v2.id, v1.id, 'the second assembly overwrote the first volume');
  const inv = byTitle('Second tranche invoice');
  assert.strictEqual(inv.bates, 'DEF-000007', `a new document took bates ${inv.bates} — bates must continue past the produced range`);
  assert(idsOf(v2).includes(inv.id), 'PROD002 did not include the newly responsive document');
  for (const t of ['Advice from counsel', 'Litigation strategy memo'])
    assert(!idsOf(v2).includes(D[t].id), `PRIVILEGE WAIVER: "${t}" is privileged and was produced in ${v2.volume}`);

  // One bates number, one document — within and across every volume served.
  const seen = new Map();
  for (const p of prods()) {
    const inVol = (p.documentIds || []).map((id) => scope().get('document', id));
    assert(inVol.every(Boolean), `${p.volume} froze an id that is not a document in this matter`);
    const local = inVol.map((d) => d.bates);
    assert.strictEqual(new Set(local).size, local.length, `BATES COLLISION: ${p.volume} produced the same bates twice: ${local.join(', ')}`);
    const sorted = local.slice().sort();
    assert.deepStrictEqual(local, sorted, `${p.volume} is not in bates order`);
    assert.strictEqual(p.batesStart, sorted[0], `${p.volume} batesStart ${p.batesStart} is not its lowest bates`);
    assert.strictEqual(p.batesEnd, sorted[sorted.length - 1], `${p.volume} batesEnd ${p.batesEnd} is not its highest bates`);
    for (const d of inVol) {
      if (seen.has(d.bates)) {
        assert.strictEqual(seen.get(d.bates), d.id,
          `BATES COLLISION: ${d.bates} identifies two different documents across volumes`);
      } else seen.set(d.bates, d.id);
    }
  }

  // And the second volume's load file describes the second volume, not the first.
  const dat2 = await loadfile(v2, 'dat');
  assert.deepStrictEqual(parseDat(dat2).slice(1).map((r) => r[0]), idsOf(v2).map((id) => scope().get('document', id).bates),
    'the PROD002 load file does not list exactly what PROD002 froze');
  assert(dat2.includes('DEF-000007') && !dat1.includes('DEF-000007'),
    'the two volumes served the same load file — each must reflect its own frozen set');

  server.close();
  console.log('PRODUCTION: ALL PASS (producible = responsive+not-privileged only, privilege never produced, volumes frozen, bates unique across volumes, load file matches the volume served)');
  process.exit(0);
})().catch((e) => { console.error('PRODUCTION FAIL:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
