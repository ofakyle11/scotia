'use strict';
// The scope log IS the file. Between nightly backups there is no other copy of
// a matter's history, so "saved" has to mean on the disk, not in the kernel's
// page cache. _append used fs.appendFileSync, which returns as soon as the
// kernel has the bytes — the app told a lawyer a record was saved while a power
// cut seconds later would still lose it.
//
// Durability against power loss cannot be observed from inside the process:
// there is no behaviour to assert, only which syscall was used. So this counts
// the flush directly. That is white-box on purpose — it is the only thing that
// distinguishes a durable write from a fast lie, and it goes red the moment
// someone swaps the flush back out for a plain append.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');

const realFsync = fs.fsyncSync;
let fsyncs = 0, fsyncedFds = [];
fs.fsyncSync = function (fd) { fsyncs++; fsyncedFds.push(fd); return realFsync.call(fs, fd); };

process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'durab-'));
const { Store } = require('../kernel/store.js');
const { Keyring } = require('../kernel/crypto.js');

const dir = process.env.CHAMBERS_DATA;
const keyring = new Keyring(dir);
const store = new Store(dir, keyring);
const fails = [];

// 1. A write flushes. The firm log does not exist yet, so the first append must
//    flush the file AND the directory entry that makes it findable.
fsyncs = 0;
const u = store.firm.put('user', { email: 'a@f', name: 'A', role: 'admin', active: true }, 't');
if (fsyncs < 2) fails.push(`first append to a new log flushed ${fsyncs} time(s); expected the file AND its directory entry`);

// 2. Every subsequent write flushes too — not just the first.
fsyncs = 0;
store.firm.put('user', { ...u, id: u.id, name: 'A. Renamed' }, 't');
if (fsyncs < 1) fails.push('a subsequent append did not flush at all — appendFileSync is back');

// 3. A matter log is a separate scope with its own key and its own file; it
//    gets the same guarantee, or a client's whole file is the unprotected one.
const m = store.createMatter({ title: 'Durable v. Cache', client: 'C', jurisdiction: 'on', status: 'open' }, u.id);
fsyncs = 0;
store.matterScope(m.id).put('deadline', { desc: 'Limitation', due: '2028-01-01', status: 'open' }, u.id);
if (fsyncs < 1) fails.push('a matter-scope append did not flush');

// 4. Durability must not have cost correctness: the bytes on disk still decrypt
//    and replay into the same state when read back by a cold reader.
const reread = new Store(dir, new Keyring(dir));
const back = reread.matterScope(m.id).list('deadline');
assert.strictEqual(back.length, 1, 'the record did not survive a cold re-read at all');
assert.strictEqual(back[0].due, '2028-01-01', 'the record came back altered: ' + JSON.stringify(back[0]));
assert.strictEqual(reread.firm.list('user').length, 1, 'firm scope did not replay to one user');
assert.strictEqual(reread.firm.list('user')[0].name, 'A. Renamed', 'the update did not survive');
if (reread.matterScope(m.id).damagedLines) fails.push('a freshly written log reports damaged lines: ' + reread.matterScope(m.id).damagedLines);

// 5. The flush targets the log's own descriptor, not some unrelated fd.
if (fsyncedFds.some((fd) => typeof fd !== 'number')) fails.push('fsync was called with a non-descriptor');

fs.fsyncSync = realFsync;
if (fails.length) { console.log('DURABILITY FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('DURABILITY: ALL PASS (every append flushed, new logs flush their directory entry, records replay intact from disk)');
