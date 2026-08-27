'use strict';
// A single torn line in audit.log stopped Chambers from starting.
//
// Every read of the log was a bare JSON.parse, and the one in the constructor
// runs at module load in server.js — so a crash mid-append or a full disk left a
// half-written last line that threw before the server could listen. The firm
// could not open its own practice, and the diagnosis on screen was a JSON syntax
// error. verify() had the same problem from the other side: the function whose
// entire job is to report that the chain is not what it should be CRASHED
// instead of reporting it.
//
// This is the same defect, in the same shape, that once bricked a whole matter
// in kernel/store.js. Damage must cost the damaged line and nothing else — and
// it must stay visible afterwards, because this is tamper-evidence, not a cache.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { Audit } = require('../kernel/audit.js');

const fails = [];
const APP = path.join(__dirname, '..');

// A healthy chain, then a last line torn in half — exactly what a crash between
// write() and the newline leaves behind.
function damagedDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'auditboot-'));
  const a = new Audit(d);
  a.log('u1', 'user.enrolled', 'seat:1');
  a.log('u1', 'matter.opened', 'm1');
  a.log('u2', 'deadline.calendared', 'm1:d1');
  const f = path.join(d, 'audit.log');
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 3, 'setup: expected three entries, got ' + lines.length);
  lines[2] = lines[2].slice(0, Math.floor(lines[2].length / 2)); // torn mid-JSON
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return d;
}

(async () => {
// 1. Constructing the audit over a damaged log must not throw.
const d1 = damagedDir();
let a1 = null;
try { a1 = new Audit(d1); } catch (e) { fails.push('a torn last line threw out of the Audit constructor — the server cannot start: ' + e.message); }

if (a1) {
  // 2. The damage is counted, not hidden.
  if (a1.damagedLines !== 1) fails.push(`damagedLines is ${a1.damagedLines}, expected 1 — damage must be counted, since a reader that silently drops entries is worse than one that throws`);

  // 3. verify() REPORTS it rather than throwing, and says where.
  let v = null;
  try { v = a1.verify(); } catch (e) { fails.push('verify() threw on a damaged log instead of reporting the damage: ' + e.message); }
  if (v) {
    if (v.ok) fails.push('verify() called a log with an unreadable entry intact');
    if (!/unreadable/i.test(String(v.reason))) fails.push('verify() does not say the entry is unreadable: ' + v.reason);
    if (v.at !== 3) fails.push(`verify() reports the damage at line ${v.at}, expected 3`);
  }

  // 4. The view still works — a damaged log is exactly when someone looks.
  let t = null;
  try { t = a1.tail(10); } catch (e) { fails.push('tail() threw on a damaged log: ' + e.message); }
  if (t && t.length !== 2) fails.push(`tail() returned ${t.length} entries, expected the 2 that are readable`);

  // 5. A later append chains from the last entry that reads, and the damage is
  //    NOT healed by it: this is evidence, so it has to stay reported.
  a1.log('u1', 'later.entry', 'after-damage');
  const after = a1.verify();
  if (after.ok) fails.push('the damage disappeared from verify() after a later append — tamper evidence must not heal itself');
  if (!a1.tail(10).some((e) => e.action === 'later.entry')) fails.push('an entry appended after the damage is not readable');
}

// 6. The real server must BOOT over a damaged audit log. This is the whole
//    point: the Audit constructor runs at module load in server.js, so a unit
//    test on Audit alone would not prove the firm can get back in. It has to be
//    spawned as the main module — requiring server.js does not listen.
{
  const d = damagedDir();
  const port = 34100 + Math.floor(Math.random() * 700);
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: APP, env: { ...process.env, CHAMBERS_DATA: d, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  srv.stderr.on('data', (x) => { err += x; });
  const status = await (async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (srv.exitCode !== null) return 'exited ' + srv.exitCode;
      try { const r = await fetch(`http://localhost:${port}/`); return r.status; } catch (_) { /* not up yet */ }
    }
    return 'never listened';
  })();
  try { srv.kill(); } catch (_) {}
  if (status !== 200) {
    fails.push(`the server did not boot and serve a page over a damaged audit log (${status}): ${err.trim().split('\n').filter(Boolean).slice(-1)[0] || 'no stderr'}`);
  }
}

if (fails.length) { console.log('AUDIT BOOT FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('AUDIT BOOT: ALL PASS (a torn line costs that line only; the server boots; verify reports the damage and never heals it)');
process.exit(0);
})().catch((e) => { console.error('auditboot crash:', e); process.exit(1); });
