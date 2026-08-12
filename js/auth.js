/* =========================================================================
 * CINAMATE — js/auth.js
 * Client-side access gate. Attaches a single global: window.CinamateAuth.
 *
 * Threat model (per spec §3.5): this is a soft velvet rope for a marketing
 * experience, NOT real access control. The allowlist stores SHA-256 digests
 * only — no plaintext access codes appear anywhere in shipped source.
 * ========================================================================= */
(function () {
  'use strict';

  const SESSION_KEY = 'cinamate.session';
  const HASH_PREFIX = 'CINAMATE::';

  // Allowlist of SHA-256 hex digests of (HASH_PREFIX + normalizedCode).
  // NEVER store plaintext codes in the repo. Exactly two entries.
  const ALLOWLIST = [
    '371c42647afaf34328cb5956e7b1565cde1b3952a8b0388aefd50047ac6e6815',
    '9df6322a7d4467fdbfbb0c44722a0858b0230aacd7493d161a44ebd1ce3f8319'
  ];

  /* -----------------------------------------------------------------------
   * Pure-JS synchronous SHA-256 (FIPS 180-4) over UTF-8 bytes.
   * Mandatory fallback: crypto.subtle is unavailable on file:// in some
   * browsers. Produces lowercase 64-char hex, identical to crypto.subtle.
   * --------------------------------------------------------------------- */
  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    // Manual UTF-8 encoder (works even where TextEncoder is absent).
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let cp = str.codePointAt(i);
      if (cp > 0xffff) i++; // consumed a surrogate pair
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return out;
  }

  function sha256HexSync(str) {
    const bytes = utf8Bytes(str);
    const bitLen = bytes.length * 8;

    // Padding: 0x80, zeros, then 64-bit big-endian bit length.
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let s = 56; s >= 0; s -= 8) bytes.push((bitLen / Math.pow(2, s)) & 0xff);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < bytes.length; off += 64) {
      for (let t = 0; t < 16; t++) {
        const j = off + t * 4;
        w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map(x => ('00000000' + x.toString(16)).slice(-8))
      .join('');
  }

  /* -----------------------------------------------------------------------
   * sha256Hex(input) → Promise<string>
   * Primary: crypto.subtle (secure contexts / https).
   * Fallback: pure-JS path above (file:// and other non-secure contexts).
   * Both paths yield identical lowercase 64-char hex.
   * --------------------------------------------------------------------- */
  function sha256Hex(input) {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return Promise.resolve(sha256HexSync(input));
    }
    return crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(input))
      .then(function (buf) {
        const view = new Uint8Array(buf);
        let hex = '';
        for (let i = 0; i < view.length; i++) {
          hex += ('0' + view[i].toString(16)).slice(-2);
        }
        return hex;
      });
  }

  function normalize(code) {
    return String(code == null ? '' : code).trim().toUpperCase();
  }

  /* -----------------------------------------------------------------------
   * Public API
   * --------------------------------------------------------------------- */

  // verify(code) → Promise<boolean>. Never throws; internal errors → false.
  function verify(code) {
    try {
      const normalized = normalize(code);
      if (normalized === '') return Promise.resolve(false);
      return sha256Hex(HASH_PREFIX + normalized)
        .then(function (digest) {
          for (let i = 0; i < ALLOWLIST.length; i++) {
            if (digest === ALLOWLIST[i]) return true;
          }
          return false;
        })
        .catch(function () { return false; });
    } catch (err) {
      return Promise.resolve(false);
    }
  }

  // grant(code): store the session record. Caller verifies first;
  // grant does not re-verify.
  function grant(code) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ operator: normalize(code), t: Date.now() })
    );
  }

  // requireSession(): parsed session object, or redirect to index.html
  // and return null when absent/malformed.
  function requireSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) throw new Error('no session');
      const session = JSON.parse(raw);
      if (!session || typeof session.operator !== 'string' || session.operator === '') {
        throw new Error('malformed session');
      }
      return session;
    } catch (err) {
      window.location.replace('index.html');
      return null;
    }
  }

  // operator(): session's operator string or null. Pure read, never redirects.
  function operator() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || typeof session.operator !== 'string' || session.operator === '') {
        return null;
      }
      return session.operator;
    } catch (err) {
      return null;
    }
  }

  // signOut(): clear session, return to the gate.
  function signOut() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (err) { /* storage unavailable — still redirect */ }
    window.location.replace('index.html');
  }

  window.CinamateAuth = {
    verify: verify,
    grant: grant,
    requireSession: requireSession,
    operator: operator,
    signOut: signOut
  };
})();
