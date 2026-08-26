'use strict';
// Trust accounting is regulated (LSO By-Law 9). The controls that matter are the
// double-entry invariant in kernel/api.js ledger.post and the s.7 overdraw gate
// in kernel/trust.js, and both were defeated by a single non-finite amount.
//
// Math.round(Infinity * 100) is Infinity, so dr and cr both became Infinity and
// the balance check `dr !== cr` was FALSE — Infinity !== Infinity is false — so
// an infinite transaction posted cleanly. The matter's trust balance then became
// Infinity, and since the overdraw gate asks `cents(amount) <= cents(held)`,
// every subsequent payment out of trust passed forever. NaN was already caught
// (NaN !== NaN is true); only Infinity slipped through.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { Keyring } = require('../kernel/crypto.js');
const { Store } = require('../kernel/store.js');
const { Audit } = require('../kernel/audit.js');
const { makeKernel } = require('../kernel/api.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-money-'));
const keyring = new Keyring(dir);
const store = new Store(dir, keyring);
const audit = new Audit(dir);
const me = store.firm.put('user', { email: 'a@f', name: 'A', role: 'admin', active: true }, 't');
const k = makeKernel({ store, audit, keyring }, me);
const m = k.createMatter({ title: 'Money v. Money', client: 'C', jurisdiction: 'on', status: 'open' });

// Sign conventions per kernel/trust.js: trust:bank is debit-normal and holds the
// per-matter position; trust:client is credit-normal and carries the liability.
const held = () => (k.ledger.balances(m.id) || {})['trust:bank'] || 0;

// A real retainer into trust, so there is a genuine balance to protect.
k.ledger.post(m.id, { memo: 'Retainer', kind: 'trust-receipt', lines: [
  { account: 'trust:bank', dr: 5000 }, { account: 'trust:client', cr: 5000 },
] });
assert.strictEqual(held(), 5000, 'retainer did not land in trust');

// Every non-finite shape must be refused outright.
for (const bad of [Infinity, -Infinity, NaN, '1e400']) {
  assert.throws(
    () => k.ledger.post(m.id, { memo: 'poison', kind: 'trust-receipt', lines: [
      { account: 'trust:bank', dr: bad }, { account: 'trust:client', cr: bad },
    ] }),
    /finite|unbalanced|amount/i,
    `ledger.post accepted a non-finite amount: ${String(bad)}`);
}
console.log('PASS ledger: non-finite amounts (Infinity, -Infinity, NaN, 1e400) are refused');

// The balance must be untouched by those attempts...
assert.strictEqual(held(), 5000, `trust balance corrupted by refused posts: ${held()}`);
assert(Number.isFinite(held()), 'trust balance is no longer a finite number');

// ...and the By-Law 9 s.7 overdraw gate must still bite.
assert.strictEqual(k.trust.wouldNotOverdraw(m.id, 4000), true, 'gate refused a payment that fits');
assert.strictEqual(k.trust.wouldNotOverdraw(m.id, 5000), true, 'gate refused a payment equal to the balance');
assert.strictEqual(k.trust.wouldNotOverdraw(m.id, 5000.01), false, 'OVERDRAW: gate allowed more than is held');
assert.strictEqual(k.trust.wouldNotOverdraw(m.id, 1e9), false, 'OVERDRAW: gate allowed a huge payment');
console.log('PASS trust: s.7 overdraw gate holds after the refused posts');

// A legitimate balanced post must still work, so the guard is not over-broad.
k.ledger.post(m.id, { memo: 'Disbursement paid from trust', kind: 'trust-payment', lines: [
  { account: 'trust:client', dr: 250 }, { account: 'trust:bank', cr: 250 },
] });
assert.strictEqual(held(), 4750, `legitimate trust payment did not apply: ${held()}`);
console.log('PASS ledger: legitimate balanced postings still work');

// By-Law 9 s.7 admits no slack at all: a licensee may not pay out more than is
// held for that client. perMatterTrustBalance() rounds HALF-UP, so a position of
// 99.996 presented as 100.00 and a 100.00 disbursement passed the gate while
// overdrawing the client by a fraction of a cent. The gate must floor what is
// available, never round it up.
{
  const m2 = k.createMatter({ title: 'Subcent v. Rounding', client: 'C2', jurisdiction: 'on', status: 'open' });
  k.ledger.post(m2.id, { memo: 'Retainer', kind: 'trust-receipt', lines: [
    { account: 'trust:bank', dr: 99.996 }, { account: 'trust:client', cr: 99.996 },
  ] });
  assert.strictEqual(k.trust.wouldNotOverdraw(m2.id, 100), false,
    'OVERDRAW: 100.00 allowed against a 99.996 position (half-up rounding created money)');
  assert.strictEqual(k.trust.wouldNotOverdraw(m2.id, 99.99), true,
    'gate refused a payment that genuinely fits inside the position');
  console.log('PASS trust: sub-cent positions cannot be rounded up into spendable money');
}

// ...and exact-equality payments must still be allowed, so the floor is not
// quietly refusing legitimate disbursements.
{
  const m3 = k.createMatter({ title: 'Exact v. Equal', client: 'C3', jurisdiction: 'on', status: 'open' });
  for (const amt of [1000, 250.25, 0.01, 3333.33]) {
    const mx = k.createMatter({ title: 'Exact ' + amt, client: 'C', jurisdiction: 'on', status: 'open' });
    k.ledger.post(mx.id, { memo: 'Retainer', kind: 'trust-receipt', lines: [
      { account: 'trust:bank', dr: amt }, { account: 'trust:client', cr: amt },
    ] });
    assert.strictEqual(k.trust.wouldNotOverdraw(mx.id, amt), true,
      `gate refused an exact-balance payment of ${amt}`);
    assert.strictEqual(k.trust.wouldNotOverdraw(mx.id, amt + 0.01), false,
      `gate allowed one cent more than the ${amt} held`);
  }
  void m3;
  console.log('PASS trust: exact-balance payments still allowed, one cent over still refused');
}

console.log('MONEY: ALL PASS (non-finite refused, balance intact, overdraw gate holds)');
