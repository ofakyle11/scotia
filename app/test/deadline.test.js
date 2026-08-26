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

console.log('DEADLINE DIRECTION: ALL PASS');
