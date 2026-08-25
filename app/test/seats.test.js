'use strict';
// Seat lock: exactly two named seats (Dan G, Matt D) can ever enroll,
// each with their own email and password; a third account is impossible.
const fs = require('fs');
const os = require('os');
const assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/chambers-seats-');
process.env.PORT = String(24000 + Math.floor(Math.random() * 5000));
const { app, makeCtx, store, auth } = require('../server.js');

const invites = store.firm.list('invite', (i) => i.seat && !i.used);
assert.strictEqual(invites.length, 2, 'first boot must mint exactly two seat invites');
assert.deepStrictEqual(invites.map((i) => i.name).sort(), ['Dan G', 'Matt D'], 'seats are Dan G and Matt D');

const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;
const post = async (p, form) => { const r = await fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: new URLSearchParams(form).toString() }); const text = await r.text(); return { status: r.status, text, location: r.headers.get('location') }; };

(async () => {
  const dan = invites.find((i) => i.name === 'Dan G');
  const matt = invites.find((i) => i.name === 'Matt D');

  // Dan enrolls with his own email + password; lands on /account for 2FA.
  let r = await post('/invite/' + dan.code, { email: 'dan@firm.ca', password: 'dan-sets-his-own-pw' });
  assert.strictEqual(r.status, 303); assert.strictEqual(r.location, '/account', 'enrollment routes straight to 2FA setup');
  const danUser = store.firm.list('user', (u) => u.email === 'dan@firm.ca')[0];
  assert(danUser && danUser.name === 'Dan G' && danUser.role === 'admin' && danUser.active);

  // Reusing Dan's link is dead; bad email on Matt's seat refused; dup email refused.
  r = await post('/invite/' + dan.code, { email: 'x@x.ca', password: 'another-long-password' });
  assert.strictEqual(r.status, 404, 'used seat invite must be dead');
  r = await post('/invite/' + matt.code, { email: 'not-an-email', password: 'matt-sets-his-own-pw' });
  assert(r.text.includes('valid email'), 'bad email refused');
  r = await post('/invite/' + matt.code, { email: 'dan@firm.ca', password: 'matt-sets-his-own-pw' });
  assert(r.text.includes('already enrolled'), 'duplicate email refused');

  // Matt enrolls.
  r = await post('/invite/' + matt.code, { email: 'matt@firm.ca', password: 'matt-sets-his-own-pw' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(store.firm.list('user', (u) => u.active).length, 2);

  // A third account is impossible by every path.
  assert.strictEqual(auth.createInvite('third@firm.ca', 'lawyer', 'Third Wheel', danUser.id), null, 'admin invite refused at cap');
  assert.strictEqual(auth.redeemInvite('any', 'irrelevant-password'), null, 'stray codes dead');
  assert.strictEqual(store.firm.list('user', (u) => u.active).length, 2, 'still exactly two accounts');

  // Both can sign in with their own credentials.
  assert(auth.login('dan@firm.ca', 'dan-sets-his-own-pw', 'ip').session, 'Dan signs in');
  assert(auth.login('matt@firm.ca', 'matt-sets-his-own-pw', 'ip').session, 'Matt signs in');

  server.close();
  console.log('SEAT LOCK: ALL PASS (two named seats, self-set credentials, third account impossible)');
  process.exit(0);
})().catch((e) => { console.error('SEAT LOCK FAIL:', e.message); process.exit(1); });
