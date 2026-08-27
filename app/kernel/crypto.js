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
    let minted = false;
    this.dataDir = dataDir;
    this.rootPath = path.join(dataDir, 'root.key');
    this.ringPath = path.join(dataDir, 'keyring.json');
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.rootPath)) {
      // "The key file is absent" and "this is a brand new firm" are not the same
      // thing, and this could not tell them apart. Every matter is encrypted
      // under the root key, so minting a fresh one over a directory that
      // already holds a practice is the worst reachable outcome: with
      // keyring.json still present the tenant unwrap fails with an opaque
      // crypto error, and with BOTH key files gone Chambers boots as an empty
      // firm offering first-boot invites while every matter sits on disk
      // permanently unreadable. A bad restore, a partial rsync, or someone
      // deleting what looked like a stray file is all it takes — and the lawyer
      // is shown a brand new practice on the morning they most need the truth.
      //
      // So: mint only into a directory with no evidence of a firm in it. Where
      // there is evidence, fail closed and say what happened, because
      // docs/GO-LIVE.md promises the escrowed copy is the answer and this is
      // the moment to ask for it.
      const evidence = [];
      if (fs.existsSync(this.ringPath)) evidence.push('keyring.json');
      if (fs.existsSync(path.join(dataDir, 'firm.log'))) evidence.push('firm.log');
      try {
        const mdir = path.join(dataDir, 'matters');
        const n = fs.readdirSync(mdir).filter((f) => f.endsWith('.log')).length;
        if (n) evidence.push(`${n} matter log${n === 1 ? '' : 's'}`);
      } catch (_) { /* no matters directory: no evidence from here */ }
      if (evidence.length && process.env.CHAMBERS_NEW_FIRM !== '1') {
        throw new Error(
          `root.key is missing from ${dataDir}, but this directory already holds a firm (${evidence.join(', ')}).\n`
          + 'Every matter is encrypted under that key and NOTHING here can be read without it.\n'
          + `Restore the escrowed copy to ${this.rootPath} (mode 0600) and start again.\n`
          + 'Refusing to mint a new key: that would leave the existing files permanently unreadable '
          + 'and present this as a brand new firm.\n'
          + 'If you genuinely intend to discard this data and start over, set CHAMBERS_NEW_FIRM=1.');
      }
      fs.writeFileSync(this.rootPath, crypto.randomBytes(32), { mode: 0o600 });
      minted = true;
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
    // Unwrapping the tenant key is where a mismatched pair of files finally
    // shows itself, and it used to surface as a bare 'unable to authenticate
    // data' — true, and useless to the person holding the wrong backup.
    try {
      this.tenantKey = open(this.root, Buffer.from(this.ring.tenant, 'base64'), 'tenant');
    } catch (e) {
      if (!minted) {
        throw new Error(
          `keyring.json in ${dataDir} cannot be opened with this root.key — they are from different installations.\n`
          + 'Restore the root.key that was escrowed alongside THIS data directory; a key from another deployment '
          + 'cannot read these matters and never will.');
      }
      // A deliberate re-init (CHAMBERS_NEW_FIRM=1) with a keyring left over from
      // the old firm. Start a fresh ring, but never delete the old one: it holds
      // every wrapped matter DEK, and if the escrowed root key turns up later
      // that file is half of what is needed to read the practice again.
      const aside = this.ringPath + '.orphaned-' + Date.now();
      fs.renameSync(this.ringPath, aside);
      this.ring = { tenant: null, matters: {}, destroyed: {} };
      this.ring.tenant = seal(this.root, crypto.randomBytes(32), 'tenant').toString('base64');
      this._save();
      this.tenantKey = open(this.root, Buffer.from(this.ring.tenant, 'base64'), 'tenant');
      console.error(`  the previous keyring was kept at ${aside} — it holds the old matter keys; do not delete it`);
    }
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
// Password hashing is VERSIONED by prefix so the cost can be raised without
// locking anyone out: s2$ is the original 2^14 tranche, s3$ the current one.
// verifyPassword reads either; hashPassword only ever writes the current.
// maxmem must be raised explicitly — node's 32 MB default rejects 2^17.
const SCRYPT_V = {
  s2: { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
  s3: { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
};
const CURRENT = 's3';
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32, SCRYPT_V[CURRENT]);
  return CURRENT + '$' + salt.toString('base64') + '$' + key.toString('base64');
}
// Built on first use, not at module load: at the current cost this is ~0.4s,
// and every process that merely REQUIRES this file would otherwise pay it.
let _dummy = null;
const dummy = () => (_dummy || (_dummy = hashPassword(crypto.randomBytes(9).toString('hex'))));
function verifyPassword(pw, stored) {
  const v = typeof stored === 'string' ? String(stored).split('$')[0] : '';
  // An unknown account still costs a full CURRENT-cost hash: the uniform-time
  // property that makes "no such user" indistinguishable from "wrong password".
  const DUMMY = dummy();
  const rec = SCRYPT_V[v] ? stored : DUMMY;
  const [ver, saltB64, keyB64] = rec.split('$');
  const salt = Buffer.from(saltB64, 'base64');
  const expect = Buffer.from(keyB64, 'base64');
  const got = crypto.scryptSync(String(pw), salt, 32, SCRYPT_V[ver]);
  const ok = expect.length === got.length && crypto.timingSafeEqual(expect, got);
  return ok && rec !== DUMMY;
}

const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');
const uuid = () => crypto.randomUUID();

module.exports = { seal, open, Keyring, hashPassword, verifyPassword, token, sha256, uuid };
