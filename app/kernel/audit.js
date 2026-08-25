'use strict';
// Tamper-evident audit chain: plaintext metadata only (never client content),
// each line SHA-256 chained to the previous. `verify()` walks the chain.
const fs = require('fs');
const path = require('path');
const { sha256 } = require('./crypto.js');

class Audit {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'audit.log');
    fs.mkdirSync(dataDir, { recursive: true });
    this.prev = 'genesis';
    if (fs.existsSync(this.file)) {
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length) this.prev = JSON.parse(lines[lines.length - 1]).hash;
    }
  }
  log(actor, action, object) {
    const entry = { ts: new Date().toISOString(), actor, action, object, prev: this.prev };
    entry.hash = sha256(this.prev + JSON.stringify([entry.ts, actor, action, object]));
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    this.prev = entry.hash;
    return entry;
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
