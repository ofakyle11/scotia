'use strict';
// Two writers, one chain: interleaved appends from separate Audit handles
// must extend a single verifiable chain — while real tampering still trips it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Audit } = require('../kernel/audit.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-audit-'));
const a = new Audit(dir);
const b = new Audit(dir); // second handle, e.g. the console invite tool
a.log('server', 'one', 'x');
b.log('tool', 'two', 'y');
a.log('server', 'three', 'z');
b.log('tool', 'four', 'w');
const v = a.verify();
assert(v.ok && v.entries === 4, 'interleaved writers must form one intact chain, got ' + JSON.stringify(v));

// Tampering still detected: rewrite an old entry's object.
const file = path.join(dir, 'audit.log');
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
const e = JSON.parse(lines[1]); e.object = 'FORGED'; lines[1] = JSON.stringify(e);
fs.writeFileSync(file, lines.join('\n') + '\n');
assert(!new Audit(dir).verify().ok, 'tampered entry must break the chain');
console.log('PASS: two writers extend one chain; an edited entry still trips verify()');

// --- the two attacks a bare hash chain does NOT stop -----------------------
// A chain that verifies only by walking itself from 'genesis' proves internal
// consistency and nothing else. Both of these left verify() reporting ok:true.

// 1) TAIL TRUNCATION. The realistic insider move is not editing an entry, it is
//    deleting your own — cut the last N lines and what remains is a shorter,
//    perfectly consistent chain.
{
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-audit-trunc-'));
  const w = new Audit(d2);
  for (let i = 0; i < 6; i++) w.log('user', 'act' + i, 'obj' + i);
  assert(w.verify().ok, 'baseline chain should verify');
  const f2 = path.join(d2, 'audit.log');
  const kept = fs.readFileSync(f2, 'utf8').trim().split('\n').slice(0, 3);
  fs.writeFileSync(f2, kept.join('\n') + '\n');
  const v2 = new Audit(d2).verify();
  assert(!v2.ok, 'TRUNCATION: three entries were deleted and verify() still reported intact');
  console.log('PASS: deleting entries off the tail is detected (' + (v2.reason || 'chain mismatch') + ')');
}

// 2) WHOLE-CHAIN REWRITE. With an unkeyed hash, anyone who can write the file
//    can recompute every link from 'genesis' and produce a clean chain that
//    says whatever they like.
{
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-audit-rewrite-'));
  const w = new Audit(d3);
  w.log('dan', 'matter.opened', 'm1');
  w.log('dan', 'trust.payment', 'm1:5000');
  const f3 = path.join(d3, 'audit.log');
  // Rebuild the log from scratch the way an attacker would, using the same
  // public algorithm the old verify() trusted.
  const { sha256 } = require('../kernel/crypto.js');
  let prev = 'genesis';
  const forged = [];
  for (const [actor, action, object] of [['dan', 'matter.opened', 'm1'], ['dan', 'nothing.happened', 'm1']]) {
    const ts = new Date().toISOString();
    const hash = sha256(prev + JSON.stringify([ts, actor, action, object]));
    forged.push(JSON.stringify({ ts, actor, action, object, prev, hash }));
    prev = hash;
  }
  fs.writeFileSync(f3, forged.join('\n') + '\n');
  const v3 = new Audit(d3).verify();
  assert(!v3.ok, 'REWRITE: a fully recomputed chain verified as intact');
  console.log('PASS: a recomputed chain is rejected (' + (v3.reason || 'chain mismatch') + ')');
}

console.log('AUDIT CHAIN: ALL PASS (one chain, edits + truncation + rewrite all detected)');
