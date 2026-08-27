'use strict';
// Tamper-evident audit chain: plaintext metadata only (never client content),
// each line HMAC-SHA-256 chained to the previous. `verify()` walks the chain AND
// checks it against a separately-stored head.
//
// A bare hash chain that only walks itself proves internal consistency and
// nothing more, which leaves two holes it cannot see:
//   - TRUNCATION. Cut entries off the tail and what remains is a shorter,
//     perfectly consistent chain. This is the realistic insider move — deleting
//     your own entry, not editing someone else's — and it verified as intact.
//   - REWRITE. With an unkeyed hash the algorithm is public, so anyone who can
//     write the file can recompute every link from 'genesis' and produce a clean
//     chain saying whatever they like.
// Both are closed here: the links are keyed with a secret (audit.key, 0600,
// minted on first use like root.key) so they cannot be recomputed, and the head
// (entry count + last hash, itself keyed) is written beside the log so a shorter
// chain no longer agrees with what the firm last recorded.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_STALE_MS = 10000; // a lock left by a crashed writer is broken after this
const LOCK_WAIT_MS = 5000;   // give up (and throw) rather than hang forever

class Audit {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'audit.log');
    this.lockFile = this.file + '.lock';
    this.headFile = path.join(dataDir, 'audit.head');
    this.keyFile = path.join(dataDir, 'audit.key');
    fs.mkdirSync(dataDir, { recursive: true });
    this.key = readOrMintKey(this.keyFile);
    this.prev = 'genesis';
    if (fs.existsSync(this.file)) {
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length) this.prev = JSON.parse(lines[lines.length - 1]).hash;
    }
  }
  // Re-sync to the file's true tail before appending, so two writers (the
  // server plus a console tool) extend one chain instead of forking it.
  // Tamper evidence is unaffected: verify() still walks every link.
  _syncPrev() {
    if (!fs.existsSync(this.file)) { this.prev = 'genesis'; return; }
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
    this.prev = lines.length ? JSON.parse(lines[lines.length - 1]).hash : 'genesis';
  }
  // Cross-process mutual exclusion around read-tail + append. Without it, two
  // writers (server + console tool) can both read the same tail hash and both
  // append an entry with the same `prev`, permanently breaking verify() even
  // though no one tampered. An O_EXCL lockfile is the strongest primitive
  // available with zero dependencies; a lock left behind by a crashed process
  // is broken via atomic rename, so at most one contender ever wins it.
  _acquireLock() {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        fs.writeFileSync(this.lockFile, process.pid + '\n', { flag: 'wx' });
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      try {
        const st = fs.statSync(this.lockFile);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          // rename is atomic: exactly one contender succeeds, so two processes
          // can never each believe they broke (and re-took) the same stale lock.
          const gone = this.lockFile + '.stale-' + process.pid + '-' + Date.now();
          fs.renameSync(this.lockFile, gone);
          fs.unlinkSync(gone);
        }
      } catch (_) { /* lock vanished or another process broke it first — retry */ }
      if (Date.now() > deadline) throw new Error('audit: could not acquire audit.log lock');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // sleep ~5ms
    }
  }
  _releaseLock() { try { fs.unlinkSync(this.lockFile); } catch (_) { /* already released */ } }
  log(actor, action, object) {
    this._acquireLock();
    try {
      this._syncPrev();
      const entry = { ts: new Date().toISOString(), actor, action, object, prev: this.prev };
      entry.hash = this._link(this.prev, entry.ts, actor, action, object);
      // 0600 on create, and tightened if it already exists. This is the ONE
      // plaintext file in the data directory — it names every actor, every
      // action and every object id — and it was being created at the process
      // umask (0644), readable by any local account and by any backup that
      // preserves modes. The keyring and audit.key are already 0600; this file
      // is no less sensitive for being metadata.
      const existed = fs.existsSync(this.file);
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 });
      if (existed) { try { const m = fs.statSync(this.file).mode & 0o777; if (m !== 0o600) fs.chmodSync(this.file, 0o600); } catch (_) { /* best effort */ } }
      this.prev = entry.hash;
      // Anchor the tail under the same lock, so a later truncation disagrees
      // with the head the firm last recorded.
      this._writeHead(this._count(), entry.hash);
      return entry;
    } finally {
      this._releaseLock();
    }
  }
  _link(prev, ts, actor, action, object) {
    return crypto.createHmac('sha256', this.key)
      .update(prev + JSON.stringify([ts, actor, action, object])).digest('hex');
  }
  _count() {
    if (!fs.existsSync(this.file)) return 0;
    return fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).length;
  }
  // The head is keyed too: without it an attacker could truncate the log and
  // simply rewrite the anchor to match.
  _headMac(n, hash) {
    return crypto.createHmac('sha256', this.key).update('head:' + n + ':' + hash).digest('hex');
  }
  _writeHead(n, hash) {
    const tmp = this.headFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ n, hash, mac: this._headMac(n, hash) }) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.headFile);
  }
  _readHead() {
    if (!fs.existsSync(this.headFile)) return null;
    try {
      const h = JSON.parse(fs.readFileSync(this.headFile, 'utf8'));
      if (!h || typeof h.n !== 'number' || typeof h.hash !== 'string') return null;
      if (h.mac !== this._headMac(h.n, h.hash)) return { forged: true };
      return h;
    } catch (_) { return { forged: true }; }
  }
  verify() {
    const head = this._readHead();
    if (head && head.forged) return { ok: false, reason: 'audit.head is forged or corrupt', entries: this._count() };
    if (!fs.existsSync(this.file)) {
      if (head && head.n > 0) return { ok: false, reason: `audit.log is missing but ${head.n} entries were recorded`, entries: 0 };
      return { ok: true, entries: 0 };
    }
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
    let prev = 'genesis';
    for (let i = 0; i < lines.length; i++) {
      const e = JSON.parse(lines[i]);
      const expect = this._link(prev, e.ts, e.actor, e.action, e.object);
      if (e.prev !== prev || e.hash !== expect) {
        return { ok: false, at: i + 1, entries: lines.length, reason: `entry ${i + 1} does not match the chain` };
      }
      prev = e.hash;
    }
    // Internally consistent — now check it against what was last anchored.
    if (head) {
      if (head.n !== lines.length || head.hash !== prev) {
        return {
          ok: false, entries: lines.length, reason:
            `chain ends at ${lines.length} entries but ${head.n} were recorded — entries were removed`,
        };
      }
    }
    return { ok: true, entries: lines.length };
  }
  tail(n = 50) {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => JSON.parse(l)).reverse();
  }
}

// The chain key. Minted 0600 on first use, beside root.key and under the same
// custody: an attacker who can read it can already read the keyring.
function readOrMintKey(keyFile) {
  try { return fs.readFileSync(keyFile); } catch (_) { /* mint below */ }
  const key = crypto.randomBytes(32);
  const tmp = keyFile + '.tmp';
  fs.writeFileSync(tmp, key, { mode: 0o600 });
  fs.renameSync(tmp, keyFile);
  return key;
}

module.exports = { Audit };
