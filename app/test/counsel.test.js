'use strict';
// Room 37 — Counsel Panel: one doctrine brief across the whole syllabus, then
// three advisers who take THAT BRIEF and answer "what do we do" from different
// chairs. This proves the structure over HTTP with a stub model:
//   - four charges reach the gateway, in order, each with a DIFFERENT system
//     prompt (the lenses are real, not one prompt four times)
//   - the three advisers actually receive the doctrine brief in their input
//   - the finished panel renders with the UNVERIFIED banner and the citation-
//     gate note (the room prepares the lawyer; it does not practise law)
//   - a matter whose policy forbids model use gets a failed panel, not a leak
//   - with the gateway off, no record is created at all
const fs = require('fs'), os = require('os'), http = require('http'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/counsel-');
process.env.PORT = String(35600 + Math.floor(Math.random() * 900));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'd@f', name: 'Dan G', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const m = store.createMatter({ title: 'Panel v. Question', client: 'C', jurisdiction: 'on', posture: 'pleadings', status: 'open' }, admin.id);
const forbidden = store.createMatter({ title: 'No Models Here', client: 'C2', jurisdiction: 'on', status: 'open', aiPolicy: 'forbidden' }, admin.id);
const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

// Stub model: echoes which chair it was asked to sit in, and whether the
// doctrine brief was in its input — that is exactly what the test must prove.
const calls = [];
const model = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    let body = {}; try { body = JSON.parse(b); } catch (_) { /* ignore */ }
    const sys = ((body.messages || []).find((x) => x.role === 'system') || {}).content || '';
    const usr = ((body.messages || []).find((x) => x.role === 'user') || {}).content || '';
    const lens = /every subject on the bar syllabus/.test(sys) ? 'doctrine'
      : /litigation strategist/.test(sys) ? 'strategy'
      : /risk and settlement/.test(sys) ? 'risk'
      : /professional duty/.test(sys) ? 'client' : 'unknown';
    calls.push({ lens, sawDoctrine: usr.includes('DOCTRINE-BRIEF-FINGERPRINT') });
    const text = lens === 'doctrine'
      ? 'DOCTRINE-BRIEF-FINGERPRINT: the limitation clock and Rule 18.01 both bear on this.'
      : `${lens.toUpperCase()}-ADVICE built on the brief.`;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
});

const post = (path, body, mid) => fetch(base + path, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${session}; m=${mid}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(body).toString(),
});
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 200)); } };

(async () => {
  // Gateway OFF: the room must refuse before creating anything.
  await post('/r/counsel/ask', { question: 'Too early?' }, m.id);
  assert.strictEqual(store.matterScope(m.id).list('counselPanel').length, 0, 'a panel was created with no gateway configured');
  console.log('PASS off: no gateway, no record — the panel has no knowledge of its own');

  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  store.firm.put('setting', { id: 'ai', endpoint: 'http://127.0.0.1:' + model.address().port, model: 'stub' }, admin.id);

  // The real thing.
  await post('/r/counsel/ask', { question: 'Defence and counterclaim served yesterday — what now?' }, m.id);
  const done = await until(() => store.matterScope(m.id).list('counselPanel').find((p) => p.status === 'done'));
  assert(done, 'panel never completed: ' + JSON.stringify(store.matterScope(m.id).list('counselPanel')));
  assert.deepStrictEqual(calls.map((c) => c.lens), ['doctrine', 'strategy', 'risk', 'client'], 'charges wrong or out of order: ' + JSON.stringify(calls));
  assert(calls.slice(1).every((c) => c.sawDoctrine), 'an adviser did not receive the doctrine brief');
  assert(!calls[0].sawDoctrine, 'the doctrine charge should not receive its own output');
  assert.strictEqual(done.sections.length, 4);
  console.log('PASS panel: doctrine first, then three advisers, each handed the brief');

  const page = await (await fetch(base + '/r/counsel?m=' + m.id, { headers: { cookie: `s=${session}` } })).text();
  assert(page.includes('UNVERIFIED'), 'finished panel must carry the UNVERIFIED banner');
  assert(page.includes('Citation Check'), 'the citation-gate note must appear with the advice');
  assert(page.includes('STRATEGY-ADVICE') && page.includes('RISK-ADVICE') && page.includes('CLIENT-ADVICE'), 'adviser sections not rendered');
  console.log('PASS render: advice appears only under the unverified banner and the citation-gate note');

  // A matter that forbids model use: the gateway refuses, the panel records the
  // refusal, and the stub never hears about the matter.
  const before = calls.length;
  await post('/r/counsel/ask', { question: 'Should never reach a model.' }, forbidden.id);
  const failed = await until(() => store.matterScope(forbidden.id).list('counselPanel').find((p) => p.status === 'failed'));
  assert(failed && /forbidden/i.test(failed.error || ''), 'policy-forbidden matter did not fail cleanly: ' + JSON.stringify(failed));
  assert.strictEqual(calls.length, before, 'LEAK: a forbidden matter\'s question reached the model endpoint');
  console.log('PASS policy: a forbidden matter never reaches the model, and the refusal is on the record');

  model.close(); server.close();
  console.log('COUNSEL PANEL: ALL PASS (one mind for the law, three for what to do, none of them the lawyer)');
  process.exit(0);
})().catch((e) => { console.error('COUNSEL FAIL:', e.message); try { model.close(); server.close(); } catch (_) {} process.exit(1); });
