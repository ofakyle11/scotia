'use strict';
// RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890").
const assert = require('assert');
const { code, verify, base32Encode } = require('../kernel/totp.js');

const secret = base32Encode(Buffer.from('12345678901234567890'));
assert.strictEqual(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
assert.strictEqual(code(secret, 59 * 1000), '287082');
assert.strictEqual(code(secret, 1111111109 * 1000), '081804');
assert.strictEqual(code(secret, 1234567890 * 1000), '005924');
assert.strictEqual(code(secret, 2000000000 * 1000), '279037');
assert(verify(secret, '287082', 59 * 1000), 'exact step verifies');
assert(verify(secret, '287082', 89 * 1000), 'previous step inside window verifies');
assert(!verify(secret, '287082', 200 * 1000), 'stale code rejected');
assert(!verify(secret, '000000', 59 * 1000) || code(secret, 59 * 1000) === '000000', 'wrong code rejected');
assert(!verify(secret, '28708', 59 * 1000), 'short code rejected');
console.log('TOTP RFC 6238: ALL PASS');
