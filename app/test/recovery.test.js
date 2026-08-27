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
// A credential change rotates the session, so the cookie a browser holds after
// one is not the cookie it sent. A test that kept sending the old token would
// go unauthenticated from that point on and every later assertion would pass
// vacuously — which is exactly what happened here the first time the rotation
// landed. Follow the Set-Cookie the way a browser does.
const rotated = (res, current) => {
  const m2 = (res.headers.get('set-cookie') || '').match(/(?:^|[;\s])s=([^;]+)/);
  return m2 ? m2[1] : current;
};
let danSession = danS;

(async () => {
  const fails = [];

  // --- 1. a lawyer must be able to change their own password ---------------
  const pwRes = await post('/account/password', danSession, { current: DAN_PW, password: 'dan-brand-new-password', password2: 'dan-brand-new-password' });
  if (!verifyPassword('dan-brand-new-password', freshUser(dan.id).pw)) {
    fails.push('LOCKOUT: a lawyer cannot change their own password — a typo at enrolment is permanent');
  }
  danSession = rotated(pwRes, danSession);
  // The rest of this file depends on Dan still being signed in. If the rotation
  // ever stops issuing a usable cookie, say so here rather than letting a dozen
  // downstream assertions quietly stop testing anything.
  if (!auth.resolve(danSession)) fails.push('after changing his password Dan holds no working session — every assertion below this line is vacuous');
  // ...and only with the current one.
  await post('/account/password', danSession, { current: 'not-the-password', password: 'attacker-chosen-pw', password2: 'attacker-chosen-pw' });
  if (verifyPassword('attacker-chosen-pw', freshUser(dan.id).pw)) {
    fails.push('a stolen session could change the password without knowing the current one');
  }
  // ...and the two entries must match, so a typo cannot become the password.
  await post('/account/password', danSession, { current: 'dan-brand-new-password', password: 'typed-one-way', password2: 'typed-another-way' });
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
  await post('/admin/wall/remove', danSession, { wallId: wall2.id });
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
  await post('/admin/deactivate', danSession, { userId: matt.id });
  if (freshUser(matt.id).active) {
    fails.push('LOCKOUT: a seat cannot be released — a lost authenticator ends the deployment');
  }
  // ...and then re-issue it.
  if (!auth.createInvite({ email: 'matt2@f', name: 'Matt D', role: 'admin' }, dan.id)) {
    fails.push('seat still not re-issuable after releasing it');
  }
  // But nobody may release their own seat and strand the firm.
  await post('/admin/deactivate', danSession, { userId: dan.id });
  if (!freshUser(dan.id).active) {
    fails.push('an admin deactivated themselves — the firm can now be locked out with nobody left');
  }

  // --- 4. a deployment nobody enrolled in must still be enterable ---------
  // The first-boot block mints seat invites only when there are zero users AND
  // zero unused invites — but it never checked EXPIRY, while the door refuses an
  // expired code. So if both seven-day links lapsed before anyone enrolled, the
  // unused-but-expired records blocked the mint forever and the deployment could
  // not be entered by anyone, ever.
  {
    const { spawnSync } = require('child_process');
    const path = require('path');
    const dir = fs.mkdtempSync(os.tmpdir() + '/firstboot-');
    const APP = path.join(__dirname, '..');
    const boot = (p) => spawnSync(process.execPath, ['-e',
      `process.env.CHAMBERS_DATA=${JSON.stringify(dir)};process.env.PORT=${JSON.stringify(String(p))};` +
      `require(${JSON.stringify(path.join(APP, 'server.js'))});setTimeout(()=>process.exit(0),300);`],
      { cwd: APP, encoding: 'utf8', timeout: 20000 });

    const first = boot(39501);
    if (!/FIRST BOOT/.test(first.stdout || '')) fails.push('first boot did not mint seat invites at all');

    // Age every invite past its expiry, as a fortnight of nobody enrolling would.
    const { Keyring } = require('../kernel/crypto.js');
    const { Store } = require('../kernel/store.js');
    const st = new Store(dir, new Keyring(dir));
    for (const inv of st.firm.list('invite')) st.firm.put('invite', { ...inv, exp: Date.now() - 1000 }, 'test');
    if (!st.firm.list('invite', (i) => !i.used && Date.now() >= i.exp).length) fails.push('could not age the invites for the test');

    const second = boot(39502);
    if (!/FIRST BOOT/.test(second.stdout || '')) {
      fails.push('LOCKOUT: both seat invites expired unredeemed and no fresh ones were minted — the deployment cannot be entered by anyone');
    }
    const live = new Store(dir, new Keyring(dir)).firm.list('invite', (i) => !i.used && Date.now() < i.exp);
    if (!live.length) fails.push('no live invite exists after the re-mint');
  }

  server.close();
  if (fails.length) { console.error('RECOVERY FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('RECOVERY: ALL PASS (password change, wall removal, seat re-issue — each guarded)');
  process.exit(0);
})().catch((e) => { console.error('RECOVERY ERROR:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
