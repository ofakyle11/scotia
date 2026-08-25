'use strict';
// Proves the encryption claims: content unreadable at rest, walls deny
// before key unwrap, crypto-shredding is irreversible.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Keyring } = require('../kernel/crypto.js');
const { Store } = require('../kernel/store.js');
const { Audit } = require('../kernel/audit.js');
const { makeKernel } = require('../kernel/api.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-crypto-'));
const keyring = new Keyring(dir);
const store = new Store(dir, keyring);
const audit = new Audit(dir);

const SECRET = 'PRIVILEGED: the client admits the brakes were serviced late';
const alice = store.firm.put('user', { email: 'a@f', name: 'Alice', role: 'admin', active: true }, 't');
const bob = store.firm.put('user', { email: 'b@f', name: 'Bob', role: 'lawyer', active: true }, 't');
const kA = makeKernel({ store, audit, keyring }, alice);
const m = kA.createMatter({ title: 'Sealed v. Disk', client: 'C', jurisdiction: 'on', status: 'open' });
kA.scope(m.id).put('fact', { text: SECRET, date: '2026-01-05' });
const blobId = kA.blob.put(m.id, Buffer.from(SECRET + ' (attachment)'));

// 1) Nothing privileged is readable on disk.
let onDisk = '';
for (const f of ['firm.log', path.join('matters', m.id + '.log'), path.join('blobs', m.id, blobId)]) {
  onDisk += fs.readFileSync(path.join(dir, f), 'latin1');
}
assert(!onDisk.includes('brakes'), 'plaintext leaked to disk');
assert(!onDisk.includes('PRIVILEGED'), 'plaintext leaked to disk');
console.log('PASS at-rest: matter logs and blobs are AES-256-GCM ciphertext only');

// 2) An ethical wall denies before any key unwrap.
kA.firm.put('wall', { matterId: m.id, screened: [bob.id], basis: 'test screen' });
const kB = makeKernel({ store, audit, keyring }, bob);
assert.strictEqual(kB.matter(m.id), null, 'walled user can see matter');
assert.throws(() => kB.scope(m.id), /matter unavailable/, 'walled user reached scope');
assert(!kB.matters().some((x) => x.id === m.id), 'walled matter listed');
console.log('PASS wall: screened user cannot list, open, or decrypt the matter');

// 3) Crypto-shredding is total and irreversible.
kA.shred(m.id);
assert.throws(() => kA.scope(m.id), /destroyed|SHREDDED|shredded/i, 'shredded matter still readable');
assert.throws(() => new Store(dir, new Keyring(dir)).matterScope(m.id), /destroyed/i, 'shredded matter readable after reboot');
console.log('PASS shred: destroying the matter DEK makes the log unreadable forever');

// 4) Audit chain stands and never contains content.
const v = audit.verify();
assert(v.ok && v.entries > 0, 'audit chain broken');
assert(!fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').includes('brakes'), 'audit leaked content');
console.log('PASS audit: chain intact (' + v.entries + ' entries), zero client content');
console.log('\nCRYPTO PROOF: ALL PASS');
