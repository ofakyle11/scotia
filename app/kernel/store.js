'use strict';
// Encrypted event-sourced store. Each scope (firm, or one matter) is an
// append-only log of AES-256-GCM sealed events, projected into memory.
// The firm log seals with the tenant KEK; each matter log with its own DEK.
const fs = require('fs');
const path = require('path');
const { seal, open, uuid } = require('./crypto.js');

class Scope {
  constructor(file, key, label) {
    this.file = file;
    this.key = key;
    this.label = label;
    this.types = new Map(); // type -> Map(id -> obj)
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      // A damaged line must cost you that line, not the whole matter.
      //
      // This loop used to parse every record with no guard, so ONE unreadable
      // line — a torn append from a crash or a full disk, a flipped bit on the
      // volume — threw out of the constructor and the matter could never be
      // opened again. Every other record in the file was intact and sealed
      // correctly; the reader simply refused to reach them. For a system whose
      // whole promise is that a client's file is still there, that is the worst
      // possible failure mode, and it is reachable without an attacker.
      //
      // Skip what cannot be read, keep what can, and COUNT the damage: a scope
      // that silently drops records is worse than one that throws, because
      // nobody learns anything is missing. `damagedLines` is surfaced so a room
      // or an operator can say so out loud.
      this.damagedLines = 0;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(open(this.key, Buffer.from(line, 'base64'), this.label).toString('utf8'));
        } catch (_) {
          // Unreadable: truncated, corrupted, or sealed under a key this scope
          // does not hold. Not decryptable now and not decryptable later.
          this.damagedLines++;
          continue;
        }
        this._apply(ev);
      }
    }
  }
  _apply(ev) {
    if (!this.types.has(ev.type)) this.types.set(ev.type, new Map());
    const m = this.types.get(ev.type);
    if (ev.t === 'put') m.set(ev.obj.id, ev.obj);
    else if (ev.t === 'del') m.delete(ev.id);
  }
  _append(ev) {
    const line = seal(this.key, Buffer.from(JSON.stringify(ev)), this.label).toString('base64');
    fs.appendFileSync(this.file, line + '\n');
    this._apply(ev);
  }
  list(type, filter) {
    const m = this.types.get(type);
    const all = m ? [...m.values()] : [];
    return filter ? all.filter(filter) : all;
  }
  get(type, id) {
    const m = this.types.get(type);
    return m ? m.get(id) : undefined;
  }
  put(type, obj, by) {
    const now = new Date().toISOString();
    const rec = { ...obj };
    if (!rec.id) { rec.id = uuid(); rec.createdAt = now; rec.createdBy = by; }
    rec.updatedAt = now; rec.updatedBy = by;
    this._append({ t: 'put', type, obj: rec });
    return rec;
  }
  del(type, id, by) {
    this._append({ t: 'del', type, id, by, ts: new Date().toISOString() });
  }
}

class Store {
  constructor(dataDir, keyring) {
    this.dataDir = dataDir;
    this.keyring = keyring;
    this.firm = new Scope(path.join(dataDir, 'firm.log'), keyring.tenantKey, 'firm');
    this._matterScopes = new Map();
  }
  matterScope(matterId) {
    if (!this._matterScopes.has(matterId)) {
      const key = this.keyring.matterKey(matterId); // throws if shredded/missing
      this._matterScopes.set(matterId, new Scope(path.join(this.dataDir, 'matters', matterId + '.log'), key, 'matter:' + matterId));
    }
    return this._matterScopes.get(matterId);
  }
  createMatter(meta, by) {
    const rec = this.firm.put('matter', meta, by);
    this.keyring.createMatterKey(rec.id);
    return rec;
  }
  shredMatter(matterId) {
    this._matterScopes.delete(matterId);
    this.keyring.destroyMatterKey(matterId);
    // Destroying the key is necessary but NOT sufficient. Leaving the ciphertext
    // on disk meant a restored keyring — from any of the 14 nightly archives
    // backup.sh keeps — could re-open a matter the firm had already certified as
    // destroyed. Removing the sealed log and blobs as well means that even a
    // full restore of an older keyring finds nothing on this box to decrypt.
    // Backups still hold their own copies; that is a retention problem the
    // runbook and the certificate now state plainly rather than deny.
    try { fs.rmSync(path.join(this.dataDir, 'matters', matterId + '.log'), { force: true }); } catch (_) { /* already gone */ }
    try { fs.rmSync(path.join(this.dataDir, 'blobs', matterId), { recursive: true, force: true }); } catch (_) { /* already gone */ }
  }
  // Encrypted blob storage under the matter DEK.
  putBlob(matterId, buf) {
    const key = this.keyring.matterKey(matterId);
    const id = uuid();
    const dir = path.join(this.dataDir, 'blobs', matterId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id), seal(key, buf, 'blob:' + id));
    return id;
  }
  getBlob(matterId, id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('bad blob id');
    const key = this.keyring.matterKey(matterId);
    const p = path.join(this.dataDir, 'blobs', matterId, id);
    return open(key, fs.readFileSync(p), 'blob:' + id);
  }
}

module.exports = { Store, Scope };
