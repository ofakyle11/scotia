'use strict';
// LSO By-Law 9 trust controls — pure helpers over the kernel ledger.
//
// Reference (real, labeled): Law Society of Ontario By-Law 9 ("Financial
// Transactions and Records") governs a licensee's trust account. Two duties
// this module supports in code:
//   - s.7  A licensee shall not pay out of a trust account more money than is
//          held there on behalf of that client — no client's money funds
//          another's. (perMatterTrustBalance / wouldNotOverdraw)
//   - s.18 Monthly trust comparison ("three-way reconciliation"): the trust
//          ledger balance, the total of client trust liabilities, and the bank
//          statement balance must agree. (threeWayCheck)
// This file computes those positions; it does not invent balances or file
// anything. All numbers come from the audited kernel ledger.
//
// Ledger sign conventions (see kernel/api.js, rooms/28-books.js):
//   trust:bank   debit-normal  -> per-matter holdings = balances[trust:bank]
//   trust:client credit-normal -> client liability     = -balances[trust:client]
// balances[acct] = sum(dr) - sum(cr).
//
// Pure functions: read-only, no side effects, no audit, no room, no I/O.

const TOL = 0.005;                                   // half a cent
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const cents = (n) => Math.round(Number(n || 0) * 100);
const finite = (n) => { const x = Number(n); return Number.isFinite(x) ? x : null; };

// What this matter holds in trust, in dollars. Never negative in a compliant
// firm (the ledger refuses fee-taking from trust without a flagged transfer),
// but computed honestly so a negative surfaces rather than hides. A falsy
// matterId (e.g. null ctx.matter) yields an empty position of 0.
function perMatterTrustBalance(kernel, matterId) {
  if (!kernel || !kernel.ledger || typeof kernel.ledger.balances !== 'function' || !matterId) return 0;
  const bal = kernel.ledger.balances(matterId) || {};
  return round2(bal['trust:bank'] || 0);
}

// True iff paying `amount` out of this matter's trust would NOT overdraw it —
// a disbursement must not exceed the matter's own trust holdings. Garbage or
// non-positive amounts are refused (false): an invalid disbursement is unsafe.
function wouldNotOverdraw(kernel, matterId, amount) {
  const amt = finite(amount);
  if (amt === null || amt <= 0) return false;
  return cents(amt) <= cents(perMatterTrustBalance(kernel, matterId));
}
// Name per task spelling; keep the clear alias too.
const wouldNoverdraw = wouldNotOverdraw;

// True iff the matter's trust position has fallen below `floor` and needs
// topping up. A non-positive/garbage floor means "no floor set" -> false.
function replenishmentNeeded(kernel, matterId, floor) {
  const f = finite(floor);
  if (f === null || f <= 0) return false;
  return cents(perMatterTrustBalance(kernel, matterId)) < cents(f);
}

// Firm-wide monthly trust comparison. Returns the three legs plus agreement.
// `statement` is null for a garbage/absent bank figure, and ok is then false.
function threeWayCheck(kernel, statementBalance) {
  const bal = (kernel && kernel.ledger && typeof kernel.ledger.balances === 'function')
    ? (kernel.ledger.balances() || {}) : {};
  const ledger = round2(bal['trust:bank'] || 0);          // leg 1: trust ledger
  const liabilities = round2(-(bal['trust:client'] || 0)); // leg 2: client liabilities
  const stmt = finite(statementBalance);                   // leg 3: bank statement
  const statement = stmt === null ? null : round2(stmt);
  const ok = statement !== null
    && Math.abs(ledger - liabilities) < TOL
    && Math.abs(ledger - statement) < TOL;
  return { ledger, liabilities, statement, ok };
}

module.exports = {
  perMatterTrustBalance,
  wouldNotOverdraw,
  wouldNoverdraw,
  replenishmentNeeded,
  threeWayCheck,
};

// ---- self-test: node kernel/trust.js ----
if (require.main === module) {
  const assert = (label, cond) => { if (!cond) { console.error('FAIL: ' + label); process.exit(1); } };

  // In-memory fake kernel: two matters funded into trust, plus a disbursement.
  const txns = [
    { matterId: 'A', lines: [{ account: 'trust:bank', dr: 7500 }, { account: 'trust:client', cr: 7500 }] },
    { matterId: 'B', lines: [{ account: 'trust:bank', dr: 3000 }, { account: 'trust:client', cr: 3000 }] },
    // A pays a $500 filing fee out of its own trust (bank down, liability down).
    { matterId: 'A', lines: [{ account: 'trust:client', dr: 500 }, { account: 'trust:bank', cr: 500 }] },
  ];
  const fake = {
    ledger: {
      balances(matterId) {
        const b = {};
        for (const t of txns) {
          if (matterId && t.matterId !== matterId) continue;
          for (const l of t.lines) b[l.account] = (b[l.account] || 0) + (l.dr || 0) - (l.cr || 0);
        }
        return b;
      },
    },
  };

  // perMatterTrustBalance
  assert('A holds 7000', perMatterTrustBalance(fake, 'A') === 7000);
  assert('B holds 3000', perMatterTrustBalance(fake, 'B') === 3000);
  assert('null matter -> 0', perMatterTrustBalance(fake, null) === 0);
  assert('no kernel -> 0', perMatterTrustBalance(null, 'A') === 0);

  // wouldNotOverdraw — no client's money funds another's
  assert('A: $500 ok', wouldNotOverdraw(fake, 'A', 500) === true);
  assert('A: exactly $7000 ok', wouldNotOverdraw(fake, 'A', 7000) === true);
  assert('A: $7000.01 refused', wouldNotOverdraw(fake, 'A', 7000.01) === false);
  assert('B: $5000 refused (only 3000 held)', wouldNotOverdraw(fake, 'B', 5000) === false);
  assert('garbage amount refused', wouldNotOverdraw(fake, 'A', 'abc') === false);
  assert('negative amount refused', wouldNotOverdraw(fake, 'A', -5) === false);
  assert('zero amount refused', wouldNotOverdraw(fake, 'A', 0) === false);
  assert('alias wouldNoverdraw matches', wouldNoverdraw(fake, 'A', 500) === true);

  // replenishmentNeeded
  assert('A below 10000 floor', replenishmentNeeded(fake, 'A', 10000) === true);
  assert('A above 5000 floor', replenishmentNeeded(fake, 'A', 5000) === false);
  assert('floor at exact balance not needed', replenishmentNeeded(fake, 'A', 7000) === false);
  assert('garbage floor -> false', replenishmentNeeded(fake, 'A', 'x') === false);
  assert('zero floor -> false', replenishmentNeeded(fake, 'A', 0) === false);

  // threeWayCheck — firm-wide: ledger 10000, liabilities 10000
  const good = threeWayCheck(fake, 10000);
  assert('leg1 ledger 10000', good.ledger === 10000);
  assert('leg2 liabilities 10000', good.liabilities === 10000);
  assert('leg3 statement 10000', good.statement === 10000);
  assert('all three agree', good.ok === true);
  const bad = threeWayCheck(fake, 9000);
  assert('statement mismatch not ok', bad.ok === false);
  assert('bad still reports statement 9000', bad.statement === 9000);
  const garbage = threeWayCheck(fake, 'nope');
  assert('garbage statement -> null', garbage.statement === null);
  assert('garbage statement not ok', garbage.ok === false);
  assert('empty kernel three-way ok at zero', threeWayCheck({}, 0).ok === true);

  console.log('PASS');
}
