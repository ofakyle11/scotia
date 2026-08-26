'use strict';
// The three ways this product could lock its only two users out permanently.
// Found while writing the owner's manual: documenting honestly forced the
// question "what happens when this goes wrong", and the answer was "nothing —
// there is no way back".
//
//  1. A password is set exactly once, at enrolment, by a form with a SINGLE
//     password box and no confirmation. Mistype it and you are locked out of the
//     practice forever; the other admin cannot help, because /admin has no
//     control over anyone's credentials.
//  2. Ethical walls can be raised but never lowered, and the "screen" list
//     includes yourself — so an admin can wall themselves off a matter and then,
//     by design, cannot even see the wall that did it.
//  3. Nothing ever sets a user inactive, but the seat lock counts active users.
//     Once both seats enrol, activeCount is 2 forever and every future invite is
//     refused — so a lost authenticator or a departing partner cannot be
//     recovered from.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/recov-');
process.env.PORT = String(37000 + Math.floor(Math.random() * 1200));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword, verifyPassword } = require('../kernel/crypto.js');

const DAN_PW = 'dan-original-password';
const dan = store.firm.put('user', { email: 'dan@f', name: 'Dan G', role: 'admin', active: true, pw: hashPassword(DAN_PW) }, 't');
const matt = store.firm.put('user', { email: 'matt@f', name: 'Matt D', role: 'admin', active: true, pw: hashPassword('matt-original-password') }, 't');
const m = store.createMatter({ title: 'Recover v. Lockout', client: 'C', jurisdiction: 'on', status: 'open' }, matt.id);

const danS = auth.createSession(dan.id);
const mattS = auth.createSession(matt.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

const post = (path, session, body) => fetch(base + path, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${session}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(body).toString(),
});
const freshUser = (id) => store.firm.get('user', id);

(async () => {
  const fails = [];

  // --- 1. a lawyer must be able to change their own password ---------------
  await post('/account/password', danS, { current: DAN_PW, password: 'dan-brand-new-password', password2: 'dan-brand-new-password' });
  if (!verifyPassword('dan-brand-new-password', freshUser(dan.id).pw)) {
    fails.push('LOCKOUT: a lawyer cannot change their own password — a typo at enrolment is permanent');
  }
  // ...and only with the current one.
  await post('/account/password', danS, { current: 'not-the-password', password: 'attacker-chosen-pw', password2: 'attacker-chosen-pw' });
  if (verifyPassword('attacker-chosen-pw', freshUser(dan.id).pw)) {
    fails.push('a stolen session could change the password without knowing the current one');
  }
  // ...and the two entries must match, so a typo cannot become the password.
  await post('/account/password', danS, { current: 'dan-brand-new-password', password: 'typed-one-way', password2: 'typed-another-way' });
  if (verifyPassword('typed-one-way', freshUser(dan.id).pw)) {
    fails.push('mismatched confirmation was accepted — the original enrolment trap, again');
  }

  // --- 2. a wall must be removable by the lawyer it does not screen --------
  const wall = store.firm.put('wall', { matterId: m.id, screened: [dan.id], basis: 'prior retainer' }, matt.id);
  await post('/admin/wall/remove', mattS, { wallId: wall.id });
  if (store.firm.get('wall', wall.id)) {
    fails.push('LOCKOUT: a wall cannot be lifted — a wall on the wrong matter or person is permanent');
  }
  // A screened lawyer must NOT be able to lift their own wall; that would make
  // walls meaningless.
  const wall2 = store.firm.put('wall', { matterId: m.id, screened: [dan.id], basis: 'prior retainer' }, matt.id);
  await post('/admin/wall/remove', danS, { wallId: wall2.id });
  if (!store.firm.get('wall', wall2.id)) {
    fails.push('a screened lawyer lifted the very wall that screens them');
  }
  store.firm.del('wall', wall2.id, matt.id);

  // Raising a wall against yourself is unrecoverable, so it must be refused.
  await post('/admin/wall', mattS, { matterId: m.id, userId: matt.id, basis: 'oops' });
  if (store.firm.list('wall', (w) => (w.screened || []).includes(matt.id)).length) {
    fails.push('an admin walled themselves off a matter — unrecoverable through the UI');
  }

  // --- 3. a seat must be re-issuable -------------------------------------
  // Both seats are enrolled, so the lock is at its cap and refuses new invites.
  if (auth.createInvite({ email: 'third@f', role: 'lawyer' }, matt.id)) {
    fails.push('seat lock let a THIRD account be invited');
  }
  // Matt loses his authenticator. Dan must be able to release Matt's seat...
  await post('/admin/deactivate', danS, { userId: matt.id });
  if (freshUser(matt.id).active) {
    fails.push('LOCKOUT: a seat cannot be released — a lost authenticator ends the deployment');
  }
  // ...and then re-issue it.
  if (!auth.createInvite({ email: 'matt2@f', name: 'Matt D', role: 'admin' }, dan.id)) {
    fails.push('seat still not re-issuable after releasing it');
  }
  // But nobody may release their own seat and strand the firm.
  await post('/admin/deactivate', danS, { userId: dan.id });
  if (!freshUser(dan.id).active) {
    fails.push('an admin deactivated themselves — the firm can now be locked out with nobody left');
  }

  server.close();
  if (fails.length) { console.error('RECOVERY FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('RECOVERY: ALL PASS (password change, wall removal, seat re-issue — each guarded)');
  process.exit(0);
})().catch((e) => { console.error('RECOVERY ERROR:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
