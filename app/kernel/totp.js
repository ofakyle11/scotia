'use strict';
// TOTP (RFC 6238) on Node's crypto — no dependencies, verified against the
// RFC's own test vectors in test/totp.test.js. 30s steps, 6 digits, ±1 window.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const genSecret = () => base32Encode(crypto.randomBytes(20));

function code(secretB32, forTime = Date.now()) {
  const counter = Math.floor(forTime / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}

// Returns the matched time-step counter, or null. Callers that grant access
// MUST persist the counter and refuse any step <= the stored one (RFC 6238
// s.5.2: a verified code is burned — it never verifies twice).
function matchStep(secretB32, input, forTime = Date.now()) {
  const given = String(input || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  let matched = null;
  for (const w of [-1, 0, 1]) {
    const at = forTime + w * 30000;
    const expect = code(secretB32, at);
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(given)) && matched === null) {
      matched = Math.floor(at / 1000 / 30);
    }
  }
  return matched;
}

const verify = (secretB32, input, forTime = Date.now()) => matchStep(secretB32, input, forTime) !== null;

const otpauthUri = (account, secret) =>
  `otpauth://totp/${encodeURIComponent('Chambers:' + account)}?secret=${secret}&issuer=Chambers&algorithm=SHA1&digits=6&period=30`;

module.exports = { genSecret, code, verify, matchStep, otpauthUri, base32Encode, base32Decode };
