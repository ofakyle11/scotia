'use strict';
// Room 38 — the Associate's Office. The office makes three professional claims,
// and this proves all three over HTTP with a stub model:
//
//   1. THE BAR GATES PRACTICE. The associate takes no assignment until the
//      EXACT currently-configured model+endpoint holds a passing bench score.
//      Unbenched, failed, and stale-bench (score belongs to another model) all
//      refuse — not a warning, a refusal that creates no record.
//   2. WORK IS SUPERVISED, NOT SELF-CLEARING. Output comes back 'returned' as
//      unverified work product; accepting it registers a draft into the room-08
//      citation gate with citeStatus 'unchecked', and re-accepting fresh text
//      resets the gate so stale clearance cannot survive.
//   3. THE MATTER'S POLICY STILL BINDS. A matter that forbids model use fails
//      the assignment before a single byte reaches the network.
const fs = require('fs'), os = require('os'), http = require('http'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/assoc-');
process.env.PORT = String(36600 + Math.floor(Math.random() * 900));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'd@f', name: 'Dan G', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const m = store.createMatter({ title: 'Associate v. Office', client: 'C', jurisdiction: 'on', status: 'open' }, admin.id);
const forbidden = store.createMatter({ title: 'No Models Here', client: 'C2', jurisdiction: 'on', status: 'open', aiPolicy: 'forbidden' }, admin.id);
const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

let hits = 0;
const OUTPUT = 'DRAFT DEMAND LETTER\n\nPer Dunsmuir v. New Brunswick, 2008 SCC 9, the standard applies.';
const model = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { hits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: OUTPUT } }] })); });
});

const post = (path, body, matterId) => fetch(base + path, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${session}; m=${matterId || m.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(body).toString(),
});
const get = (matterId) => fetch(base + '/r/associate', { headers: { cookie: `s=${session}; m=${matterId || m.id}` } }).then((r) => r.text());
const assignments = (matterId) => store.matterScope(matterId || m.id).list('assignment');
const drafts = () => store.matterScope(m.id).list('draft');
const settle = async (pred, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await new Promise((r) => setTimeout(r, 60)); } return false; };

model.listen(0, '127.0.0.1', async () => {
  const endpoint = 'http://127.0.0.1:' + model.address().port;
  try {
    // --- 1. the bar gates practice -----------------------------------------
    // Gateway off entirely: the office has no occupant.
    let page = await get();
    assert(/NOT CALLED|gateway is off/i.test(page), 'closed office must say so with no gateway');
    await post('/r/associate/assign', { title: 'T', kind: 'draft', instructions: 'I' });
    assert.strictEqual(assignments().length, 0, 'assignment created with the gateway off');

    // Gateway on, never benched -> still refused.
    store.firm.put('setting', { id: 'ai', endpoint, model: 'stub-model' }, admin.id);
    await post('/r/associate/assign', { title: 'T', kind: 'draft', instructions: 'I' });
    assert.strictEqual(assignments().length, 0, 'BAR GATE: unbenched model was allowed to take work');
    page = await get();
    assert(/NOT CALLED/.test(page) && /never passed the competence bench/i.test(page), 'office must name the bench as the reason');

    // Benched but FAILED -> refused.
    store.firm.put('setting', { id: 'bench', status: 'done', model: 'stub-model', endpoint, total: 48, correct: 20, pct: 41.7, passLine: 75, passed: false, bySubject: {} }, admin.id);
    await post('/r/associate/assign', { title: 'T', kind: 'draft', instructions: 'I' });
    assert.strictEqual(assignments().length, 0, 'BAR GATE: a model that FAILED the bench was allowed to take work');

    // Passing bench for a DIFFERENT model -> stale, still refused. This is the
    // currency rule: yesterday's score says nothing about today's model.
    store.firm.put('setting', { id: 'bench', status: 'done', model: 'some-other-model', endpoint, total: 48, correct: 46, pct: 95.8, passLine: 75, passed: true, bySubject: {} }, admin.id);
    await post('/r/associate/assign', { title: 'T', kind: 'draft', instructions: 'I' });
    assert.strictEqual(assignments().length, 0, 'BAR GATE: a passing score for ANOTHER model admitted this one');
    assert.strictEqual(hits, 0, 'the gateway was called while the office was closed');
    console.log('PASS bar: unbenched, failed, and another model’s pass all refuse work — no record, no call');

    // Passing bench for THIS model -> called.
    store.firm.put('setting', { id: 'bench', status: 'done', model: 'stub-model', endpoint, total: 48, correct: 46, pct: 95.8, passLine: 75, passed: true, bySubject: { Privilege: { total: 6, correct: 6 } } }, admin.id);
    page = await get();
    assert(/called to the Chambers bar/i.test(page), 'a passing model must show as called');
    console.log('PASS bar: a model that passed THIS bench is called and the desk opens');

    // --- 2. assignment -> work -> returned ---------------------------------
    await post('/r/associate/assign', { title: 'Demand letter — Ridgeline', kind: 'draft', instructions: 'Unpaid invoices, $42,000, demand payment in 14 days.' });
    let all = assignments();
    assert.strictEqual(all.length, 1, 'assignment not created for a called associate');
    assert.strictEqual(all[0].status, 'queued', 'a new assignment must sit queued, not auto-run');
    assert.strictEqual(hits, 0, 'queuing an assignment must not call the model');

    await post('/r/associate/work', { id: all[0].id });
    assert(await settle(() => assignments()[0].status === 'returned'), 'assignment never returned: ' + assignments()[0].status);
    const done = assignments()[0];
    assert.strictEqual(done.output, OUTPUT, 'output not recorded');
    assert.strictEqual(hits, 1, 'expected exactly one gateway call, got ' + hits);
    assert.strictEqual(drafts().length, 0, 'returned work must NOT reach the citation gate before review');
    page = await get();
    assert(/UNVERIFIED work product/i.test(page), 'returned work must carry the unverified banner');
    console.log('PASS work: queued -> worked -> returned as unverified; nothing reaches the gate unreviewed');

    // --- 3. accepting registers into the citation gate ---------------------
    await post('/r/associate/review', { id: done.id, verdict: 'accept', reviewNote: 'usable with edits' });
    const d = drafts();
    assert.strictEqual(d.length, 1, 'accepting did not register a draft for citation check');
    assert.strictEqual(d[0].citeStatus, 'unchecked', 'accepted work must enter the gate UNCHECKED');
    assert.strictEqual(d[0].status, 'draft');
    assert.strictEqual(d[0].text, OUTPUT);
    assert.strictEqual(d[0].assignmentId, done.id, 'draft must backlink to its assignment');
    const acc = assignments()[0];
    assert.strictEqual(acc.status, 'accepted');
    assert.strictEqual(acc.draftId, d[0].id);
    assert(acc.reviewedBy && acc.reviewedAt, 'acceptance must record who and when');
    console.log('PASS review: accepted work registers as an UNCHECKED draft, backlinked, with the reviewer recorded');

    // Re-accepting fresh text must RESET the gate — stale clearance must never
    // survive new words (the 10-pleadings /tocite rule).
    store.matterScope(m.id).put('draft', { ...d[0], id: d[0].id, citeStatus: 'clear', scannedAt: '2026-01-01', status: 'final' }, admin.id);
    store.matterScope(m.id).put('assignment', { ...acc, id: acc.id, status: 'returned', output: OUTPUT + '\nAnd Hryniak v. Mauldin, 2014 SCC 7.' }, admin.id);
    await post('/r/associate/review', { id: acc.id, verdict: 'accept' });
    const d2 = drafts();
    assert.strictEqual(d2.length, 1, 're-accepting must reuse the draft, not fork one');
    assert.strictEqual(d2[0].citeStatus, 'unchecked', 'STALE CLEARANCE: re-accepted text kept its old clear status');
    assert.strictEqual(d2[0].status, 'draft', 'a re-accepted draft must be demoted from final');
    assert(/Hryniak/.test(d2[0].text), 'the draft did not take the new text');
    console.log('PASS gate: re-accepting new text resets citeStatus and demotes from final');

    // --- 4. decline keeps the file but creates nothing ----------------------
    await post('/r/associate/assign', { title: 'Research — limitation', kind: 'research', instructions: 'When did it start running?' });
    const q = assignments().find((a) => a.status === 'queued');
    await post('/r/associate/work', { id: q.id });
    assert(await settle(() => assignments().find((a) => a.id === q.id).status === 'returned'), 'second assignment never returned');
    await post('/r/associate/review', { id: q.id, verdict: 'decline', reviewNote: 'wrong statute' });
    assert.strictEqual(assignments().find((a) => a.id === q.id).status, 'declined');
    assert.strictEqual(drafts().length, 1, 'a declined item must not reach the citation gate');
    console.log('PASS review: declining records the verdict and creates no draft');

    // --- 5. the matter's own policy still binds ----------------------------
    const before = hits;
    await post('/r/associate/assign', { title: 'X', kind: 'draft', instructions: 'Y' }, forbidden.id);
    const fq = assignments(forbidden.id)[0];
    assert(fq, 'assignment should be creatable; the refusal belongs at the model call');
    await post('/r/associate/work', { id: fq.id }, forbidden.id);
    assert(await settle(() => assignments(forbidden.id)[0].status === 'failed'), 'forbidden matter did not fail: ' + assignments(forbidden.id)[0].status);
    assert(/forbidden/i.test(assignments(forbidden.id)[0].error || ''), 'failure must name the policy');
    assert.strictEqual(hits, before, 'POLICY LEAK: a forbidden matter reached the network');
    console.log('PASS policy: a matter forbidding model use fails before any byte leaves the building');

    model.close(); server.close();
    console.log('ASSOCIATE: ALL PASS (bar gates practice, work is supervised, accepted work enters the gate unchecked)');
    process.exit(0);
  } catch (e) {
    console.error('ASSOCIATE FAIL:', e.message);
    try { model.close(); server.close(); } catch (_) {}
    process.exit(1);
  }
});
