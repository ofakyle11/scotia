'use strict';
// TOTP replay protection: a code that granted access once never works again,
// including across a fresh pending login inside the same time window.
const fs = require('fs');
const os = require('os');
const assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/chambers-replay-');
const { store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');
const totp = require('../kernel/totp.js');

const sec = totp.genSecret();
store.firm.put('user', { email: 'r@f', name: 'R', role: 'lawyer', active: true, pw: hashPassword('a-long-password-here'), totp: sec }, 't');
const codeNow = totp.code(sec);

// First login with the code: succeeds.
const p1 = auth.login('r@f', 'a-long-password-here', '9.9.9.9');
assert(p1 && p1.pending, 'expected pending');
assert(auth.verifyTotp(p1.pending, codeNow, '9.9.9.9'), 'first use should pass');

// Second login, SAME code, fresh pending token, same window: refused.
const p2 = auth.login('r@f', 'a-long-password-here', '9.9.9.9');
assert(p2 && p2.pending, 'expected second pending');
assert.strictEqual(auth.verifyTotp(p2.pending, codeNow, '9.9.9.9'), null, 'replayed code must be refused');

// A later-step code still works (fresh pending, next window).
const later = totp.code(sec, Date.now() + 30000);
const p3 = auth.login('r@f', 'a-long-password-here', '9.9.9.9');
if (later !== codeNow) {
  assert(auth.verifyTotp(p3.pending, later, '9.9.9.9'), 'next-step code should pass');
}
console.log('TOTP REPLAY: ALL PASS (accepted once, burned thereafter)');
