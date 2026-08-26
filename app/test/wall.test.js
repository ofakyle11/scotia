'use strict';
// The ethical wall is the product's central control: a screened lawyer must not
// learn that the firm acts in the matter at all. The facade enforces this
// correctly (k.matter/k.matters/k.scope all deny before any DEK unwrap), but
// /admin reached around it with store.firm.get('matter', ...) and rendered the
// walled matter's TITLE, the screened users' names and the conflict BASIS.
// Both seats ship as admins (SEATS='Dan G:admin,Matt D:admin'), so the person a
// wall screens could simply open /admin and read what they were walled off from,
// and why. This test drives the real page over HTTP as the screened user.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/wall-');
process.env.PORT = String(24000 + Math.floor(Math.random() * 1500));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const pw = hashPassword('a-long-password-here');
const dan = store.firm.put('user', { email: 'dan@f', name: 'Dan G', role: 'admin', active: true, pw }, 't');
const matt = store.firm.put('user', { email: 'matt@f', name: 'Matt D', role: 'admin', active: true, pw }, 't');

// Matt opens a matter and screens Dan off it: Dan acted for the adverse party
// at his former firm, so he must not learn the firm is against them now.
const SECRET_TITLE = 'Beaumont v. Ridgeline Logistics';
const SECRET_CLIENT = 'A. Beaumont';
const SECRET_BASIS = 'prior retainer for Ridgeline at former firm';
const m = store.createMatter({ title: SECRET_TITLE, client: SECRET_CLIENT, jurisdiction: 'on', status: 'open' }, matt.id);
store.firm.put('wall', { matterId: m.id, screened: [dan.id], basis: SECRET_BASIS }, matt.id);

// A second, unwalled matter proves the page still works for what Dan MAY see.
store.createMatter({ title: 'Ordinary Open Matter', client: 'Someone', jurisdiction: 'on', status: 'open' }, matt.id);

const danSession = auth.createSession(dan.id);
const mattSession = auth.createSession(matt.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

(async () => {
  const fails = [];
  const admin = await fetch(base + '/admin', { headers: { cookie: `s=${danSession}` } });
  assert.strictEqual(admin.status, 200, '/admin should render for an admin seat');
  const page = await admin.text();

  // The three things a screened user must never learn from this page.
  if (page.includes(SECRET_TITLE)) fails.push('/admin leaked the WALLED MATTER TITLE to the screened user');
  if (page.includes(SECRET_CLIENT)) fails.push('/admin leaked the WALLED MATTER CLIENT to the screened user');
  if (page.includes(SECRET_BASIS)) fails.push('/admin leaked the WALL BASIS to the screened user');

  // ...while the page must still function: the unwalled matter is fine to show.
  if (!page.includes('Ordinary Open Matter')) fails.push('/admin stopped showing matters the user may legitimately see');

  // And the wall must remain fully visible to the lawyer who is NOT screened,
  // otherwise the fix has just blinded the person who has to manage it.
  const mattPage = await (await fetch(base + '/admin', { headers: { cookie: `s=${mattSession}` } })).text();
  if (!mattPage.includes(SECRET_TITLE)) fails.push('/admin hid the wall from the UNSCREENED admin who must manage it');
  if (!mattPage.includes(SECRET_BASIS)) fails.push('/admin hid the wall basis from the unscreened admin');

  server.close();
  if (fails.length) { console.error('WALL FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('WALL: ALL PASS (/admin hides walled matters from the screened seat, keeps them for the other)');
  process.exit(0);
})().catch((e) => { console.error('WALL ERROR:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
