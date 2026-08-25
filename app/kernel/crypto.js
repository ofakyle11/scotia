'use strict';
// Envelope encryption: root key (file) -> tenant KEK -> per-matter DEK -> content.
// AES-256-GCM throughout. Destroying a matter DEK crypto-shreds that matter.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALG = 'aes-256-gcm';

function seal(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALG, key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function open(key, blob, aad) {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ct = blob.subarray(28);
  const d = crypto.createDecipheriv(ALG, key, iv);
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

class Keyring {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.rootPath = path.join(dataDir, 'root.key');
    this.ringPath = path.join(dataDir, 'keyring.json');
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.rootPath)) {
      fs.writeFileSync(this.rootPath, crypto.randomBytes(32), { mode: 0o600 });
    }
    this.root = fs.readFileSync(this.rootPath);
    if (this.root.length !== 32) throw new Error('root key corrupt');
    if (fs.existsSync(this.ringPath)) {
      this.ring = JSON.parse(fs.readFileSync(this.ringPath, 'utf8'));
    } else {
      this.ring = { tenant: null, matters: {}, destroyed: {} };
    }
    if (!this.ring.tenant) {
      this.ring.tenant = seal(this.root, crypto.randomBytes(32), 'tenant').toString('base64');
      this._save();
    }
    this.tenantKey = open(this.root, Buffer.from(this.ring.tenant, 'base64'), 'tenant');
    this._dekCache = new Map();
  }
  _save() {
    const tmp = this.ringPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.ring, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.ringPath);
  }
  createMatterKey(matterId) {
    if (this.ring.matters[matterId]) throw new Error('key exists');
    this.ring.matters[matterId] = seal(this.tenantKey, crypto.randomBytes(32), 'matter:' + matterId).toString('base64');
    this._save();
  }
  matterKey(matterId) {
    if (this.ring.destroyed[matterId]) { const e = new Error('matter key destroyed (crypto-shredded)'); e.code = 'SHREDDED'; throw e; }
    const wrapped = this.ring.matters[matterId];
    if (!wrapped) { const e = new Error('no key for matter'); e.code = 'NOKEY'; throw e; }
    if (!this._dekCache.has(matterId)) {
      this._dekCache.set(matterId, open(this.tenantKey, Buffer.from(wrapped, 'base64'), 'matter:' + matterId));
    }
    return this._dekCache.get(matterId);
  }
  destroyMatterKey(matterId) {
    if (!this.ring.matters[matterId]) throw new Error('no key');
    this.ring.matters[matterId] = null;
    delete this.ring.matters[matterId];
    this.ring.destroyed[matterId] = new Date().toISOString();
    this._dekCache.delete(matterId);
    this._save();
  }
  isShredded(matterId) { return !!this.ring.destroyed[matterId]; }
}

// Password hashing: scrypt, constant-time compare, uniform-cost verify.
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32, SCRYPT);
  return 's2$' + salt.toString('base64') + '$' + key.toString('base64');
}
const DUMMY = hashPassword(crypto.randomBytes(9).toString('hex'));
function verifyPassword(pw, stored) {
  const rec = typeof stored === 'string' && stored.startsWith('s2$') ? stored : DUMMY;
  const [, saltB64, keyB64] = rec.split('$');
  const salt = Buffer.from(saltB64, 'base64');
  const expect = Buffer.from(keyB64, 'base64');
  const got = crypto.scryptSync(String(pw), salt, 32, SCRYPT);
  const ok = crypto.timingSafeEqual(expect, got);
  return ok && rec !== DUMMY;
}

const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');
const uuid = () => crypto.randomUUID();

module.exports = { seal, open, Keyring, hashPassword, verifyPassword, token, sha256, uuid };
