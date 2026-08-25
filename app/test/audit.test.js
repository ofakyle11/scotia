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
console.log('AUDIT CHAIN: ALL PASS (two writers extend one chain; forgery still detected)');
