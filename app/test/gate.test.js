'use strict';
// The load-bearing seam, end to end over real HTTP:
// draft -> citation extraction -> gate BLOCKS final -> human verification
// -> gate clears -> final -> Filing Room -> signature -> filed.
const fs = require('fs');
const os = require('os');
const assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/chambers-gate-');
process.env.PORT = String(21000 + Math.floor(Math.random() * 9000));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'g@f', name: 'G. Counsel', role: 'lawyer', active: true, pw: hashPassword('long-enough-password') }, 't');
const matter = store.createMatter({ title: 'Gate v. Gate', client: 'C', jurisdiction: 'on', status: 'open' }, admin.id);
const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;
const H = { cookie: `s=${session}; m=${matter.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base };
const post = async (p, form) => { const r = await fetch(base + p, { method: 'POST', redirect: 'manual', headers: H, body: new URLSearchParams(form).toString() }); await r.text(); return r; };
const scope = () => store.matterScope(matter.id);

(async () => {
  // 1. Draft with a real citation in Brief Writer.
  await post('/r/briefs/new', { title: 'Test Factum', type: 'factum' });
  let draft = scope().list('draft')[0];
  await post('/r/briefs/save', { id: draft.id, court: 'ONSC', wordLimit: '', s_rule: 'As held in Dunsmuir v. New Brunswick, 2008 SCC 9, deference applies.' });
  await post('/r/briefs/status', { id: draft.id, status: 'cite-check' });

  // 2. Extract citations in room 08 — gate must block.
  await post('/r/citations/scan', { draftId: draft.id });
  let inst = scope().list('citation_instance', (i) => i.draftId === draft.id);
  assert(inst.length >= 1, 'extractor found no citations');
  draft = scope().get('draft', draft.id);
  assert.strictEqual(draft.citeStatus, 'blocked', 'gate should be blocked after scan');

  // 3. Final must be REFUSED while blocked.
  await post('/r/briefs/status', { id: draft.id, status: 'final' });
  draft = scope().get('draft', draft.id);
  assert.notStrictEqual(draft.status, 'final', 'final must be refused while citations unverified');

  // 4. Half-verification must be refused (missing confirmations).
  await post('/r/citations/verify', { id: inst[0].id, pinpoint: 'para 47', resolves: '1' });
  assert.strictEqual(scope().get('citation_instance', inst[0].id).status, 'unverified', 'partial confirmation must not verify');

  // 5. Full four-point verification of every instance — gate clears.
  for (const i of inst) await post('/r/citations/verify', { id: i.id, pinpoint: 'para 47', resolves: '1', quoteOk: '1', treatment: '1' });
  draft = scope().get('draft', draft.id);
  assert.strictEqual(draft.citeStatus, 'clear', 'gate should clear after full verification');

  // 6. Final now succeeds.
  await post('/r/briefs/status', { id: draft.id, status: 'final' });
  draft = scope().get('draft', draft.id);
  assert.strictEqual(draft.status, 'final');

  // 7. Filing Room: assemble, wrong-name signature refused, exact name signs, confirm files.
  await post('/r/filing/prepare', { draftId: draft.id, court: 'ONSC Toronto', style: 'Gate v. Gate', fileNo: 'CV-1', served: 'Opposing counsel', serviceMethod: 'email (consented)', redacted: 'on', tabs: 'on', limits: 'on' });
  let filing = scope().list('filing')[0];
  assert(filing && filing.status === 'awaiting-signature', 'packet not assembled');
  await post('/r/filing/sign', { id: filing.id, signature: 'Wrong Name', confirm: 'on' });
  assert.strictEqual(scope().get('filing', filing.id).status, 'awaiting-signature', 'wrong-name signature must be refused');
  await post('/r/filing/sign', { id: filing.id, signature: 'G. Counsel', confirm: 'on' });
  assert.strictEqual(scope().get('filing', filing.id).status, 'signed', 'exact-name signature should sign');
  await post('/r/filing/confirm', { id: filing.id, confirmedAt: '2026-08-25', registryRef: 'STAMP-1' });
  assert.strictEqual(scope().get('filing', filing.id).status, 'filed');

  // 8. Editing a final draft reopens the gate.
  await post('/r/briefs/save', { id: draft.id, court: 'ONSC', wordLimit: '', s_rule: 'Edited text, new cite 2019 SCC 65.' });
  draft = scope().get('draft', draft.id);
  assert.strictEqual(draft.citeStatus, 'none', 'edit must reset verification');
  assert.notStrictEqual(draft.status, 'final', 'edit must reopen final status');

  server.close();
  console.log('GATE CHAIN: ALL PASS (extract -> block -> verify -> clear -> final -> sign -> file -> edit reopens)');
  process.exit(0);
})().catch((e) => { console.error('GATE CHAIN FAIL:', e.message); process.exit(1); });
