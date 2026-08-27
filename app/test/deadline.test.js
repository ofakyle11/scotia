'use strict';
// The deadline engine is a SAFETY system, not a feature: a date computed wrong
// is a missed limitation or a late service, which is malpractice.
//
// Defect this pins: rules.js compute() rolled EVERY weekend/holiday landing
// FORWARD. That is right for a forward-counted rule ("serve within 30 days"),
// but 21-calendar.js back-calculates the pretrial cascade with a synthetic
// negative-offset rule (days: -m.before). Rolling a backward-counted deadline
// forward moves it CLOSER to trial, so a milestone that must be served at least
// N days before trial silently became N-1 or N-2 days before trial — the engine
// shortening the very lead time it exists to guarantee, and presenting the
// result as correct.
const assert = require('assert');
const rules = require('../kernel/rules.js');

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / DAY);

let checked = 0, weekendLandings = 0;

// Property: for a backward-counted rule, the computed date must be AT LEAST
// `before` days ahead of trial. Rolling may only ever move it earlier.
for (const jur of ['on', 'us-fed']) {
  for (const before of [7, 10, 14, 30, 45, 60, 90, 120]) {
    // Sweep a whole year of trial dates so weekend and holiday landings are hit.
    for (let i = 0; i < 365; i += 1) {
      const trial = iso(new Date(Date.UTC(2026, 0, 1) + i * DAY));
      const rule = { id: 'trial-back', jur, category: 'procedural', method: 'calendar', days: -before };
      const got = rules.compute(rule, trial);
      const lead = days(trial, got);
      checked++;
      const naive = iso(new Date(new Date(trial + 'T00:00:00Z') - before * DAY));
      if (got !== naive) weekendLandings++;
      assert(lead >= before,
        `backward rule lost lead time: trial ${trial}, must be >= ${before} days before, got ${got} (${lead} days) [${jur}]`);
      // It must also still land on a business day.
      assert(rules.isBusinessDay(new Date(got + 'T00:00:00Z'), jur),
        `backward rule landed on a non-business day: ${got} [${jur}]`);
    }
  }
}
console.log(`PASS backward-counted: ${checked} cascade dates, ${weekendLandings} needed a roll, none lost lead time`);

// Forward-counted rules must be UNCHANGED by the fix: they still roll forward.
const fwd = { id: 'fwd', jur: 'on', category: 'procedural', method: 'calendar', days: 30 };
for (let i = 0; i < 200; i += 1) {
  const trigger = iso(new Date(Date.UTC(2026, 0, 1) + i * DAY));
  const got = rules.compute(fwd, trigger);
  assert(days(got, trigger) >= 30, `forward rule came due too early: ${trigger} -> ${got}`);
  assert(rules.isBusinessDay(new Date(got + 'T00:00:00Z'), 'on'), `forward rule landed off-business: ${got}`);
}
console.log('PASS forward-counted: still rolls forward, never earlier than the interval');

// A backward-counted BUSINESS-day rule must count business days backward, not
// return the trigger untouched (the `while (left > 0)` loop never ran for
// negative days, so such a rule silently produced the trial date itself).
const back5 = { id: 'back-biz', jur: 'on', category: 'procedural', method: 'business', days: -5 };
const trial = '2026-06-15';
const got5 = rules.compute(back5, trial);
assert(got5 < trial, `backward business rule did not go backward: ${trial} -> ${got5}`);
assert(rules.isBusinessDay(new Date(got5 + 'T00:00:00Z'), 'on'), `backward business rule landed off-business: ${got5}`);
{
  // Exactly five business days must separate the two dates.
  let n = 0; const d = new Date(got5 + 'T00:00:00Z');
  while (iso(d) < trial) { d.setUTCDate(d.getUTCDate() + 1); if (rules.isBusinessDay(d, 'on')) n++; }
  assert.strictEqual(n, 5, `expected 5 business days of lead, got ${n} (${got5} -> ${trial})`);
}
console.log('PASS backward business-day: counts business days backward from the anchor');

// --- holidays must exist for EVERY year, not just the one the table was
// hand-written for -----------------------------------------------------------
// The curated table covered 2026 only, so the engine believed Canada Day 2027
// was a business day: every deadline past 2026 could roll ONTO a court holiday
// and be served a day late. The seeded limitation dates already reach 2027.
{
  const H = rules.holidaysFor || null;
  assert(typeof H === 'function', 'rules.holidaysFor(jur, year) must exist — holidays cannot expire');

  // The generator must reproduce the curated 2026 table EXACTLY, per
  // jurisdiction — that table is the reviewed reference tranche, so agreement
  // with it is what makes the generator trustworthy for every other year.
  for (const [jur, curated] of Object.entries(rules.HOLIDAYS)) {
    const gen = H(jur, 2026).slice().sort();
    assert.deepStrictEqual(gen, curated.slice().sort(),
      `generator disagrees with the curated 2026 table for ${jur}:\n  gen ${gen}\n  cur ${curated.slice().sort()}`);
  }
  console.log('PASS holidays: generator reproduces the curated 2026 reference exactly, all 7 jurisdictions');

  // Known 2027 facts, computed not hand-written.
  const on27 = H('on', 2027), us27 = H('us-fed', 2027);
  assert(on27.includes('2027-07-01'), 'Canada Day 2027 (Thursday) missing');
  assert(on27.includes('2027-03-26'), 'Good Friday 2027 (Easter Mar 28) missing');
  assert(on27.includes('2027-05-24'), 'Victoria Day 2027 (Monday before May 25) missing');
  assert(on27.includes('2027-02-15'), 'Family Day 2027 (3rd Monday Feb) missing');
  assert(on27.includes('2027-10-11'), 'Thanksgiving 2027 (2nd Monday Oct) missing');
  assert(us27.includes('2027-01-18'), 'MLK Day 2027 missing');
  assert(us27.includes('2027-05-31'), 'Memorial Day 2027 missing');
  assert(us27.includes('2027-11-25'), 'US Thanksgiving 2027 missing');
  assert(us27.includes('2027-07-05'), 'July 4 2027 falls Sunday — observed Monday Jul 5 missing');
  assert(!rules.isBusinessDay(new Date('2027-07-01T00:00:00Z'), 'on'), 'engine still thinks Canada Day 2027 is a business day');
  console.log('PASS holidays: 2027 computed correctly (Easter, nth-Monday, weekend observation)');

  // A procedural deadline landing ON a 2027 holiday must roll off it.
  const due = rules.compute(rules.rule('on-soc-defence'), '2027-06-11'); // +20 = Thu Jul 1 2027
  assert.strictEqual(due, '2027-07-02', `defence due rolled wrong: ${due} (Jul 1 2027 is Canada Day)`);
  console.log('PASS holidays: a 2027 deadline landing on Canada Day rolls to July 2');

  // No expiry, ever: a far-future year still computes, including weekend
  // substitution (Jan 1 2033 is a Saturday -> Ontario observes Monday Jan 3).
  const on33 = H('on', 2033);
  assert(on33.length >= 9, '2033 has almost no holidays: ' + on33.length);
  assert(on33.includes('2033-01-03'), 'New Year 2033 (Saturday) — observed Monday Jan 3 missing');
  console.log('PASS holidays: 2033 computes with weekend substitution — the table never expires again');
}

console.log('DEADLINE DIRECTION: ALL PASS');
