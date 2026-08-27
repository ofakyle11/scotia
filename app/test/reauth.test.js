'use strict';
// Two credential controls that a live session was allowed to walk straight past.
//
//   * POST /account/totp-disable was gated on a 6-digit code alone. A valid
//     session is exactly what an attacker holds when they reach that route, so
//     the second factor could be removed by someone who never knew the first.
//     (It was also unthrottled once; that was fixed earlier. Throttling a
//     control does not make it a control.)
//   * Nothing rotated the session on a credential change, so the one action a
//     person takes BECAUSE they believe someone else has their cookie left that
//     someone else signed in.
//
// And one property with no behaviour to observe: kernel/auth.js stores only
// sha256(token) so that a heap dump cannot yield a live session, and server.js
// then used the RAW token as a key in the flash map. A map keyed on the token
// and a map keyed on its hash behave identically, so this looks at the keys.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/reauth-');
process.env.PORT = String(28200 + Math.floor(Math.random() * 1200));
const { app, makeCtx, store, auth, flashes } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');
const totp = require('../kernel/totp.js');

const PW = 'a-long-password-here';
const u = store.firm.put('user', { email: 'u@f', name: 'U', role: 'admin', active: true, pw: hashPassword(PW) }, 't');
const secret = totp.genSecret();
store.firm.put('user', { ...u, id: u.id, totp: secret }, 't');

let session = auth.createSession(u.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

const post = (p, form, s) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${s}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(form).toString(),
}).then(async (r) => { await r.text(); return r; });
const twoFA = () => !!store.firm.get('user', u.id).totp;
// A fresh code each time: consumeTotp burns the step it accepts, so reusing one
// would make the second call fail for replay protection and prove nothing.
const code = () => totp.code(secret);

(async () => {
  const fails = [];

  // 1. A correct code with the WRONG password must not strip 2FA.
  await post('/account/totp-disable', { code: code(), password: 'not-the-password' }, session);
  if (!twoFA()) fails.push('2FA was disabled with a valid code and a WRONG password — a stolen session is enough to remove the second factor');

  // 2. And the right password with a wrong code must not either — the new check
  //    must be in ADDITION to the old one, not instead of it.
  await post('/account/totp-disable', { code: '000000', password: PW }, session);
  if (!twoFA()) fails.push('2FA was disabled with the password and an INVALID code — the code check was replaced rather than added to');

  // 3. Both correct: it comes off, and the session that did it is rotated.
  const before = session;
  const r = await post('/account/totp-disable', { code: code(), password: PW }, session);
  if (twoFA()) { fails.push('2FA could not be disabled even with the correct password and code — the control is now simply broken'); }
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/(?:^|[;\s])s=([^;]+)/);
  if (!m) fails.push('no new session cookie was issued after a credential change');
  else {
    session = m[1];
    if (session === before) fails.push('the session id did not change after a credential change');
    if (auth.resolve(before)) fails.push('the OLD session still resolves after a credential change — a stolen cookie survives the very action taken to kill it');
    if (!auth.resolve(session)) fails.push('the NEW session does not resolve — the user was logged out of their own account');
  }

  // 4. No raw session token is ever a key in the flash map.
  const keys = [...flashes.keys()];
  if (!keys.length) fails.push('no flash was recorded at all — assertion 5 would pass vacuously');
  for (const k of keys) {
    if (k === session || k === before) fails.push('the flash map is keyed on a RAW session token');
    if (!/^[0-9a-f]{64}$/.test(k)) fails.push('flash key is not a sha256 hex digest: ' + JSON.stringify(String(k).slice(0, 24)));
  }

  // 5. Password change rotates too.
  const beforePw = session;
  const r2 = await post('/account/password', { current: PW, password: 'another-long-password', password2: 'another-long-password' }, session);
  const m2 = (r2.headers.get('set-cookie') || '').match(/(?:^|[;\s])s=([^;]+)/);
  if (!m2) fails.push('password change issued no new session cookie');
  else if (auth.resolve(beforePw)) fails.push('the old session still resolves after a PASSWORD change');

  server.close();
  if (fails.length) { console.log('REAUTH FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('REAUTH: ALL PASS (2FA removal costs password AND code, credential changes rotate the session, flash map holds only hashes)');
  process.exit(0);
})().catch((e) => { console.error('reauth crash:', e); try { server.close(); } catch (_) {} process.exit(1); });
