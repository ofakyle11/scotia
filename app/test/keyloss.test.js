'use strict';
// The root key is the whole practice. docs/GO-LIVE.md tells Mark that escrowing
// it is the one step nobody can undo for him afterwards — and the code did not
// behave as though that were true.
//
// Keyring minted a fresh root key whenever root.key was absent, with no
// first-boot marker and no fail-closed check, so "the key file is missing" and
// "this is a brand new firm" were indistinguishable. After a bad restore, a
// partial rsync, or someone deleting what looked like a stray file:
//
//   * root.key gone, keyring.json present -> a new key is minted and the tenant
//     unwrap fails with an opaque crypto error;
//   * both gone, matter logs present -> a new root AND a new tenant key are
//     minted, and Chambers boots as an EMPTY FIRM offering first-boot invites
//     while every matter sits on disk permanently unreadable.
//
// The second is the one that matters: the lawyer is shown a brand new practice
// on the morning they most need to be told to fetch the escrow copy.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { Keyring } = require('../kernel/crypto.js');
const { Store } = require('../kernel/store.js');

const fails = [];
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keyloss-'));

// A real firm: a user, a matter, and a sealed record inside it.
function firm() {
  const d = mk();
  const k = new Keyring(d);
  const s = new Store(d, k);
  const u = s.firm.put('user', { email: 'u@f', name: 'U', role: 'admin', active: true }, 't');
  const m = s.createMatter({ title: 'Keyloss v. Escrow', client: 'C', jurisdiction: 'on', status: 'open' }, u.id);
  s.matterScope(m.id).put('deadline', { desc: 'Limitation', due: '2028-01-01', status: 'open' }, u.id);
  return { d, m };
}

const refused = (d) => {
  try { new Keyring(d); return null; } catch (e) { return e.message; }
};

// 1. root.key alone is gone. There is still a keyring.json and a matter log, so
//    this is unmistakably an existing firm.
{
  const { d, m } = firm();
  fs.rmSync(path.join(d, 'root.key'));
  const msg = refused(d);
  if (!msg) fails.push('a missing root.key was silently replaced with a NEW one over an existing firm');
  else {
    if (!/root\.key is missing/i.test(msg)) fails.push('the refusal does not say the root key is missing: ' + msg.split('\n')[0]);
    if (!/escrow/i.test(msg)) fails.push('the refusal does not point at the escrowed copy — that is the only thing that helps here');
  }
  if (fs.existsSync(path.join(d, 'root.key'))) fails.push('a new root.key was written despite the refusal');
  // Nothing may be touched on the way out: the data must still be there for the
  // restored key to open.
  if (!fs.existsSync(path.join(d, 'matters', m.id + '.log'))) fails.push('the matter log was removed');
  if (!fs.existsSync(path.join(d, 'keyring.json'))) fails.push('keyring.json was removed');
}

// 2. Both key files gone, matter logs still present — the virgin-firm case.
{
  const { d, m } = firm();
  fs.rmSync(path.join(d, 'root.key'));
  fs.rmSync(path.join(d, 'keyring.json'));
  const msg = refused(d);
  if (!msg) fails.push('VIRGIN FIRM: both key files were missing and Chambers re-initialised as an empty practice while the matter logs sat on disk unreadable');
  else if (!/matter log/i.test(msg)) fails.push('the refusal does not mention the matter logs it found: ' + msg.split('\n')[0]);
  if (fs.existsSync(path.join(d, 'root.key'))) fails.push('a new root.key was written despite the refusal');
  if (!fs.existsSync(path.join(d, 'matters', m.id + '.log'))) fails.push('the matter log was removed');
}

// 3. A genuinely empty directory must still initialise, or no one can ever
//    install this. Without this the fix would be indistinguishable from
//    breaking first boot.
{
  const d = mk();
  let ok = true;
  try { new Keyring(d); } catch (e) { ok = false; fails.push('a brand new empty data directory was refused: ' + e.message.split('\n')[0]); }
  if (ok && !fs.existsSync(path.join(d, 'root.key'))) fails.push('first boot did not mint a root key');
}

// 4. And a deliberate re-init stays possible for someone who means it.
{
  const { d } = firm();
  fs.rmSync(path.join(d, 'root.key'));
  process.env.CHAMBERS_NEW_FIRM = '1';
  try { new Keyring(d); } catch (e) { fails.push('CHAMBERS_NEW_FIRM=1 did not allow a deliberate re-init: ' + e.message.split('\n')[0]); }
  delete process.env.CHAMBERS_NEW_FIRM;
}

// 5. The restore actually works: put the escrowed key back and the matter opens.
{
  const { d, m } = firm();
  const escrow = fs.readFileSync(path.join(d, 'root.key'));
  fs.rmSync(path.join(d, 'root.key'));
  assert(refused(d), 'setup: expected a refusal before the restore');
  fs.writeFileSync(path.join(d, 'root.key'), escrow, { mode: 0o600 });
  const k = new Keyring(d);
  const s = new Store(d, k);
  const back = s.matterScope(m.id).list('deadline');
  if (back.length !== 1 || back[0].due !== '2028-01-01') {
    fails.push('after restoring the escrowed root key the matter did not come back: ' + JSON.stringify(back));
  }
}

if (fails.length) { console.log('KEYLOSS FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('KEYLOSS: ALL PASS (a missing root key over an existing firm fails closed and names the escrow; first boot and a deliberate re-init both still work; restoring the key brings the matter back)');
