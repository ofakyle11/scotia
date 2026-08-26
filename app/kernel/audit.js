'use strict';
// Tamper-evident audit chain: plaintext metadata only (never client content),
// each line SHA-256 chained to the previous. `verify()` walks the chain.
const fs = require('fs');
const path = require('path');
const { sha256 } = require('./crypto.js');

const LOCK_STALE_MS = 10000; // a lock left by a crashed writer is broken after this
const LOCK_WAIT_MS = 5000;   // give up (and throw) rather than hang forever

class Audit {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'audit.log');
    this.lockFile = this.file + '.lock';
    fs.mkdirSync(dataDir, { recursive: true });
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
      entry.hash = sha256(this.prev + JSON.stringify([entry.ts, actor, action, object]));
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
      this.prev = entry.hash;
      return entry;
    } finally {
      this._releaseLock();
    }
  }
  verify() {
    if (!fs.existsSync(this.file)) return { ok: true, entries: 0 };
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
    let prev = 'genesis';
    for (let i = 0; i < lines.length; i++) {
      const e = JSON.parse(lines[i]);
      const expect = sha256(prev + JSON.stringify([e.ts, e.actor, e.action, e.object]));
      if (e.prev !== prev || e.hash !== expect) return { ok: false, at: i + 1, entries: lines.length };
      prev = e.hash;
    }
    return { ok: true, entries: lines.length };
  }
  tail(n = 50) {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => JSON.parse(l)).reverse();
  }
}

module.exports = { Audit };
