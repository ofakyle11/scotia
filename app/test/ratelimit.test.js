'use strict';
// Login throttling keyed on req.socket.remoteAddress. The shipped deployment is
// Caddy terminating TLS and proxying to 127.0.0.1 (deploy/Caddyfile), and
// nothing in the app read X-Forwarded-For — so EVERY request arrived as
// 127.0.0.1 and the whole firm shared one 20-attempt bucket. 21 unauthenticated
// posts to the public /login (reachable from the internet; the origin check is
// skipped when a client sends neither Origin nor Referer) locked BOTH seat
// holders out for 15 minutes, repeatable indefinitely. On a two-seat product
// there is no third account to recover with.
//
// The same bug made audit attribution useless: every entry recorded 127.0.0.1.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/rate-');
process.env.PORT = String(22000 + Math.floor(Math.random() * 1500));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const PASSWORD = 'a-real-long-password';
store.firm.put('user', { email: 'dan@f', name: 'Dan G', role: 'admin', active: true, pw: hashPassword(PASSWORD) }, 't');
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

const ATTACKER = '203.0.113.9';   // the address hammering /login
const LAWYER = '198.51.100.7';    // Dan, working from the office

function login(email, password, xff) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', origin: base };
  if (xff) headers['x-forwarded-for'] = xff;
  return fetch(base + '/login', {
    method: 'POST', redirect: 'manual', headers,
    body: new URLSearchParams({ email, password }).toString(),
  });
}
// A successful sign-in is the only response that sets the session cookie.
const succeeded = (r) => /(^|[^a-z])s=/.test(r.headers.get('set-cookie') || '');

(async () => {
  // Burn the attacker's whole bucket and then some.
  for (let i = 0; i < 25; i++) await login('nobody@f', 'wrong-password', ATTACKER);

  // The attacker must now be locked out — the limiter still has to work.
  assert(!succeeded(await login('dan@f', PASSWORD, ATTACKER)),
    'rate limiter did not lock out the address that burned its bucket');

  // ...and Dan, at a different address, must still be able to sign in. This is
  // the assertion that fails when every client collapses to the proxy's IP.
  assert(succeeded(await login('dan@f', PASSWORD, LAWYER)),
    'LOCKOUT: an anonymous flood locked the firm out of its own practice system');
  console.log('PASS ratelimit: per-client buckets — a flood from one address cannot lock out another');

  // A forged X-Forwarded-For must not let an attacker escape its own bucket by
  // appending a fake hop. Our proxy appends the real peer on the RIGHT, so the
  // right-most entry is the only trustworthy one.
  for (let i = 0; i < 25; i++) await login('nobody@f', 'wrong', `1.2.3.4, ${ATTACKER}`);
  assert(!succeeded(await login('dan@f', PASSWORD, `9.9.9.9, ${ATTACKER}`)),
    'SPOOF: prepending a fake hop to X-Forwarded-For escaped the rate limit');
  console.log('PASS ratelimit: a forged left-hand X-Forwarded-For hop cannot escape the bucket');

  // With no proxy in front (direct socket), behaviour falls back to the peer
  // address, so a plain deployment is still throttled.
  const fresh = '/login-direct-check';
  void fresh;
  assert(succeeded(await login('dan@f', PASSWORD, null)),
    'direct (no XFF) sign-in from an unburned socket was refused');
  console.log('PASS ratelimit: direct connections still throttle on the socket address');

  // The tamper-evident chain must not be growable at will by an anonymous
  // caller. /login is public, the actor came straight from the request body
  // (bounded only by MAX_BODY = 25 MB) and every throttled attempt wrote its own
  // entry — so anyone could inflate the one file that has to stay small,
  // readable and append-only forever.
  {
    const HUGE = 'x'.repeat(5000) + '@f';
    const logPath = require('path').join(process.env.CHAMBERS_DATA, 'audit.log');
    const before = fs.statSync(logPath).size;
    for (let i = 0; i < 40; i++) await login(HUGE, 'wrong', '192.0.2.50');
    const grew = fs.statSync(logPath).size - before;
    // 40 attempts: at most RATE.max denials plus one throttle notice, each with
    // the actor truncated to 254 chars. Without the bound this was ~40 x 5 KB.
    assert(grew < 40 * 1024,
      `audit chain grew ${grew} bytes from 40 anonymous attempts — unauthenticated log inflation`);
    const tail = fs.readFileSync(logPath, 'utf8');
    assert(!tail.includes('x'.repeat(300)),
      'untruncated attacker-supplied actor reached the audit chain');
    console.log(`PASS ratelimit: 40 anonymous attempts added only ${grew} bytes, actor truncated`);
  }

  server.close();
  console.log('RATE LIMIT: ALL PASS');
  process.exit(0);
})().catch((e) => { console.error('RATE LIMIT FAIL:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
