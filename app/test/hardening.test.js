'use strict';
// Four confirmed MEDIUM findings from the security audit, each an "ordinary bad
// day" defect rather than an exotic attack:
//
//   1. FIRST-BOOT INVITE CODES WENT TO THE JOURNAL. server.js printed live
//      admin-seat enrolment links to stdout, which systemd captures — and the
//      runbook told the operator to recover them with `journalctl | grep
//      /invite/`. Anyone with sudo, or any log shipper, could claim a seat
//      before its intended holder.
//   2. TOTP-DISABLE HAD NO RATE LIMIT. Every other credential path is
//      throttled; the one that TURNS OFF the second factor was not, so a stolen
//      session could brute-force six digits at full speed.
//   3. SESSIONS NEVER EXPIRED. resolve() extended `exp` on every request and
//      nothing recorded issuance, so a session refreshed once a day lived
//      forever — there was no ceiling at all.
//   4. SCRYPT N WAS BELOW GUIDANCE (2^14). Raised, with old hashes still
//      verifying so nobody is locked out by the change.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { spawnSync } = require('child_process');

// --- 1 & the boot path: run a real first boot and read what it printed ------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hard-boot-'));
  const out = spawnSync(process.execPath, ['-e', `
    process.env.CHAMBERS_DATA = ${JSON.stringify(dir)};
    process.env.PORT = '41999';
    const { app } = require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))});
  `], { encoding: 'utf8', timeout: 20000 });
  const printed = (out.stdout || '') + (out.stderr || '');
  const codeLike = /\/invite\/[A-Za-z0-9_-]{16,}/.exec(printed);
  assert(!codeLike, 'JOURNAL LEAK: a live enrolment code was printed to stdout:\n  ' + (codeLike && codeLike[0]));
  assert(/first[- ]boot/i.test(printed), 'first boot must still tell the operator something happened');

  // The codes must be somewhere the operator can get them — a private file.
  const f = path.join(dir, 'first-boot-invites.txt');
  assert(fs.existsSync(f), 'first boot must leave the seat links in a file when it does not print them');
  assert(printed.includes('first-boot-invites.txt'), 'the operator must be told where the links are');
  const mode = fs.statSync(f).mode & 0o777;
  assert.strictEqual(mode, 0o600, `seat-link file must be 0600, got 0${mode.toString(8)}`);
  assert(/\/invite\/[A-Za-z0-9_-]{16,}/.test(fs.readFileSync(f, 'utf8')), 'the file must actually contain the links');
  console.log('PASS boot: enrolment codes go to a 0600 file, never to stdout/journal');
}

// --- 2, 3, 4 need a live app ------------------------------------------------
process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hard-'));
process.env.PORT = String(41000 + Math.floor(Math.random() * 800));
const { app, makeCtx, store, auth } = require('../server.js');
const crypto = require('../kernel/crypto.js');
const totpKit = require('../kernel/totp.js');

// --- 4. scrypt cost ---------------------------------------------------------
{
  const h = crypto.hashPassword('a-long-password-here');
  const n = Number(/^s(\d+)\$/.exec(h)[1]);
  assert(n >= 3, `password hash must be a NEWER version than s2 (got s${n}$) — the cost was raised`);
  assert(crypto.verifyPassword('a-long-password-here', h), 'new-format hash must verify');
  assert(!crypto.verifyPassword('wrong-password-here', h), 'wrong password must not verify');
  // Old s2$ hashes must still work — nobody is locked out by a cost change.
  const legacy = 's2$' + require('crypto').randomBytes(16).toString('base64') + '$';
  const salt = Buffer.from(legacy.split('$')[1], 'base64');
  const key = require('crypto').scryptSync('legacy-password-here', salt, 32, { N: 16384, r: 8, p: 1 });
  const oldHash = 's2$' + salt.toString('base64') + '$' + key.toString('base64');
  assert(crypto.verifyPassword('legacy-password-here', oldHash), 'LOCKOUT: an existing s2$ password stopped verifying');
  assert(!crypto.verifyPassword('nope-nope-nope-nope', oldHash), 'legacy verify must still reject a wrong password');
  console.log('PASS scrypt: cost raised to a new version; existing s2$ hashes still verify');
}

const pw = crypto.hashPassword('a-long-password-here');
const secret = totpKit.genSecret();
const dan = store.firm.put('user', { email: 'd@f', name: 'Dan G', role: 'admin', active: true, pw, totp: secret }, 't');
const session = auth.createSession(dan.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

(async () => {
  // --- 2. TOTP-disable must throttle ---------------------------------------
  const disable = (code) => fetch(base + '/account/totp-disable', {
    method: 'POST', redirect: 'manual',
    headers: { cookie: `s=${session}`, 'content-type': 'application/x-www-form-urlencoded', origin: base, 'x-forwarded-for': '203.0.113.77' },
    body: new URLSearchParams({ code }).toString(),
  });
  for (let i = 0; i < 25; i++) await disable('000000');
  assert(store.firm.get('user', dan.id).totp, 'guessing must not have disabled 2FA');
  // Now the CORRECT code must be refused too — proof a limiter is in the path.
  const good = totpKit.code(secret);
  await disable(good);
  assert(store.firm.get('user', dan.id).totp,
    'NO THROTTLE: after 25 wrong codes the right one still disabled 2FA at full speed');
  console.log('PASS totp-disable: throttled — 25 guesses locks the endpoint, even for a valid code');

  // --- 3. sessions must have an absolute ceiling ---------------------------
  const t = auth.createSession(dan.id);
  assert(auth.resolve(t), 'a fresh session must resolve');
  const rec = auth.sessions.get(require('../kernel/crypto.js').sha256(t));
  assert(rec && typeof rec.iat === 'number', 'a session must record when it was issued');
  // Backdate issuance beyond any sane ceiling and keep the sliding window fresh:
  // under the old code this still resolved, forever.
  rec.iat = Date.now() - 30 * 24 * 3600 * 1000;
  rec.exp = Date.now() + 3600 * 1000;
  assert.strictEqual(auth.resolve(t), null,
    'IMMORTAL SESSION: a month-old session still resolved because sliding expiry had no ceiling');
  console.log('PASS session: an absolute lifetime caps a session no matter how often it is refreshed');

  server.close();
  console.log('HARDENING: ALL PASS (no codes in the journal, 2FA-disable throttled, sessions expire, scrypt raised)');
  process.exit(0);
})().catch((e) => { console.error('HARDENING FAIL:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
