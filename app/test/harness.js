'use strict';
// Boots the app on a temp data dir with a provisioned admin + open matter,
// then exercises routes. Usage:
//   node test/harness.js            -> smoke-test every registered room
//   node test/harness.js <roomId>   -> test one room (exit 1 on failure)
process.env.CHAMBERS_DATA = require('fs').mkdtempSync(require('os').tmpdir() + '/chambers-');
process.env.PORT = String(20000 + Math.floor(Math.random() * 20000));

const { app, makeCtx, store, audit, auth } = require('../server.js');
const registry = require('../kernel/registry.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'test@firm.local', name: 'Test Admin', role: 'admin', active: true, pw: hashPassword('correct horse battery st') }, 'harness');
const lawyer = store.firm.put('user', { email: 'assoc@firm.local', name: 'Associate', role: 'lawyer', active: true, pw: hashPassword('another long password!') }, 'harness');
const matter = store.createMatter({ title: 'Harness v. Fixture', client: 'Harness Holdings', jurisdiction: 'on', status: 'open', posture: 'pre-filing' }, admin.id);
const session = auth.createSession(admin.id);

const server = app.listen(process.env.PORT, makeCtx, (e) => { failures.push('server error: ' + e.message); });
const base = 'http://localhost:' + process.env.PORT;
const failures = [];

async function get(path, expectStatus = 200) {
  const r = await fetch(base + path, { headers: { cookie: `s=${session}; m=${matter.id}` }, redirect: 'manual' });
  const text = await r.text();
  if (r.status !== expectStatus) throw new Error(`GET ${path} -> ${r.status} (want ${expectStatus})`);
  return { status: r.status, text };
}
async function post(path, form, expectRedirect = true) {
  const r = await fetch(base + path, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: `s=${session}; m=${matter.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(form).toString(),
  });
  await r.text();
  if (expectRedirect && ![303, 302].includes(r.status)) throw new Error(`POST ${path} -> ${r.status} (want redirect)`);
  return r;
}

async function testRoom(meta) {
  const { text } = await get('/r/' + meta.id);
  if (!text.includes(meta.title.split(' ')[0])) throw new Error(`GET /r/${meta.id}: page does not mention room title`);
  if (text.includes('being fitted out')) throw new Error(`room ${meta.id} is still a placeholder`);
  // Every POST route the room registered must at minimum not 500 on an empty body.
  for (const r of app.routes.filter((r) => r.method === 'POST' && r.pattern.startsWith('/r/' + meta.id + '/') && !r.pattern.includes(':'))) {
    const resp = await post(r.pattern, {}, false);
    if (resp.status >= 500) throw new Error(`POST ${r.pattern} with empty body -> ${resp.status}`);
  }
}

(async () => {
  const only = process.argv[2];
  // Front door invariants first.
  const anon = await fetch(base + '/r/desk', { redirect: 'manual' });
  if (anon.status !== 303) failures.push('unauthenticated /r/desk not redirected: ' + anon.status);
  const badLogin = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: 'email=nobody@x.com&password=wrong-and-long' });
  if (badLogin.status !== 303 || !(badLogin.headers.get('location') || '').includes('d=1')) failures.push('bad login did not deny uniformly');

  const targets = registry.filter((m) => (only ? m.id === only : true));
  for (const meta of targets) {
    try { await testRoom(meta); console.log('PASS', meta.id); }
    catch (e) { console.log('FAIL', meta.id, '-', e.message); failures.push(meta.id + ': ' + e.message); }
  }
  const chain = audit.verify();
  if (!chain.ok) failures.push('audit chain broken');
  server.close();
  if (failures.length) { console.log('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }
  console.log('\nALL PASS' + (only ? ` (${only})` : ` (${targets.length} rooms)`));
  process.exit(0);
})().catch((e) => { console.error('harness crash:', e); process.exit(1); });
