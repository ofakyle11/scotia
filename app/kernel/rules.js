'use strict';
// Rules-as-code: deadline computation per jurisdiction. Data, not prose.
// Each rule carries its citation and computes calendar- or business-day
// offsets against that jurisdiction's holiday table. Reference tranche —
// the production rulebook grows per court, versioned and effective-dated.

const HOLIDAYS = {
  // 2026 statutory/court holidays (reference tranche).
  'us-fed': ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25'],
  'on': ['2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-26'],
  'bc': ['2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03', '2026-09-07', '2026-09-30', '2026-10-12', '2026-11-11', '2026-12-25'],
  'ab': ['2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-09-07', '2026-10-12', '2026-11-11', '2026-12-25'],
  'qc': ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-18', '2026-06-24', '2026-07-01', '2026-09-07', '2026-10-12', '2026-12-25'],
  'ca-fed': ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-18', '2026-07-01', '2026-09-07', '2026-09-30', '2026-10-12', '2026-11-11', '2026-12-25', '2026-12-26'],
  'ny': ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-03', '2026-11-11', '2026-11-26', '2026-12-25'],
};

// ---- computed holidays -----------------------------------------------------
// The curated table above is the REFERENCE TRANCHE: one reviewed year (2026)
// per jurisdiction. It used to be the whole story, which meant every deadline
// outside 2026 was computed as if courts never close — the engine believed
// Canada Day 2027 was a business day, and the seeded limitation dates already
// reach 2027. Every entry in the table is a deterministic rule (a fixed date
// with a weekend-observation convention, an nth-weekday-of-month, or an
// Easter-relative day), so holidays are now COMPUTED for any year, and the
// deadline suite proves the generator reproduces the curated 2026 table
// exactly before trusting it anywhere else. The table never expires again.
const _iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const _dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const _nth = (y, m, dow, n) => { let c = 0; for (let d = 1; d <= 31; d++) { if (_dow(y, m, d) === dow && ++c === n) return d; } };
const _last = (y, m, dow) => { for (let d = 31; d >= 1; d--) { if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1 && _dow(y, m, d) === dow) return d; } };
// Anonymous Gregorian computus — Easter Sunday for any year.
function _easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const _easterPlus = (y, off) => { const d = _easter(y); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
// Canadian convention (per the curated table and r 1.03's holiday definition):
// the actual date is a holiday, and one falling on a weekend is ALSO observed
// on the next free weekday — cascading, so Christmas Sat + Boxing Sun become
// Monday and Tuesday.
function _ca(set, y, m, d) {
  set.add(_iso(y, m, d));
  const w = _dow(y, m, d);
  if (w !== 0 && w !== 6) return;
  const dt = new Date(Date.UTC(y, m - 1, d));
  for (;;) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const iso = dt.toISOString().slice(0, 10);
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6 || set.has(iso)) continue;
    set.add(iso); return;
  }
}
// US federal convention (per the curated table: July 4 2026 appears as Jul 3):
// Saturday holidays are observed the Friday before, Sunday ones the Monday
// after — the observed date replaces the actual one.
function _us(set, y, m, d) {
  const w = _dow(y, m, d);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (w === 6) dt.setUTCDate(dt.getUTCDate() - 1);
  if (w === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  set.add(dt.toISOString().slice(0, 10));
}
const _hcache = new Map();
function holidaysFor(jur, year) {
  const key = (HOLIDAYS[jur] ? jur : 'us-fed') + ':' + year;
  if (_hcache.has(key)) return _hcache.get(key);
  const y = year, j = HOLIDAYS[jur] ? jur : 'us-fed';
  const S = new Set();
  const CA = j === 'on' || j === 'bc' || j === 'ab' || j === 'qc' || j === 'ca-fed';
  if (CA) _ca(S, y, 1, 1); else _us(S, y, 1, 1);                       // New Year's
  if (j === 'us-fed' || j === 'ny') S.add(_iso(y, 1, _nth(y, 1, 1, 3)));  // MLK
  if (j !== 'qc' && j !== 'ca-fed') S.add(_iso(y, 2, _nth(y, 2, 1, 3)));  // Family Day / Washington
  if (CA) { S.add(_easterPlus(y, -2)); }                                  // Good Friday
  if (j === 'qc' || j === 'ca-fed') S.add(_easterPlus(y, 1));             // Easter Monday
  if (CA) { let d = 24; while (_dow(y, 5, d) !== 1) d--; S.add(_iso(y, 5, d)); } // Victoria Day
  if (!CA) S.add(_iso(y, 5, _last(y, 5, 1)));                             // Memorial Day
  if (!CA) _us(S, y, 6, 19);                                              // Juneteenth
  if (j === 'qc') _ca(S, y, 6, 24);                                       // St-Jean-Baptiste
  if (CA) _ca(S, y, 7, 1); else _us(S, y, 7, 4);                          // Canada Day / July 4
  if (j === 'on' || j === 'bc') S.add(_iso(y, 8, _nth(y, 8, 1, 1)));      // Civic / BC Day
  S.add(_iso(y, 9, _nth(y, 9, 1, 1)));                                    // Labour Day
  if (j === 'bc' || j === 'ca-fed') _ca(S, y, 9, 30);                     // Truth & Reconciliation
  S.add(_iso(y, 10, _nth(y, 10, 1, 2)));                                  // Thanksgiving CA / Columbus
  if (j === 'ny') S.add(_iso(y, 11, _nth(y, 11, 1, 1) + 1));              // Election Day
  if (j === 'bc' || j === 'ab' || j === 'ca-fed') _ca(S, y, 11, 11);      // Remembrance Day
  if (!CA) _us(S, y, 11, 11);                                             // Veterans Day
  if (!CA) S.add(_iso(y, 11, _nth(y, 11, 4, 4)));                         // US Thanksgiving
  // Christmas and Boxing Day pair per r 1.03's holiday definition: Christmas
  // on a Saturday makes the following Monday AND Tuesday holidays; on a Sunday,
  // the following Monday. Boxing Day gets no substitution of its own — its
  // weekend observance only ever arises through Christmas.
  if (j === 'on' || j === 'ca-fed') {
    S.add(_iso(y, 12, 25)); S.add(_iso(y, 12, 26));
    const w25 = _dow(y, 12, 25);
    if (w25 === 6) { S.add(_iso(y, 12, 27)); S.add(_iso(y, 12, 28)); }
    else if (w25 === 0) { S.add(_iso(y, 12, 26)); S.add(_iso(y, 12, 27)); }
  } else if (CA) _ca(S, y, 12, 25);
  else _us(S, y, 12, 25);                                                 // Christmas
  const out = [...S].sort();
  _hcache.set(key, out);
  return out;
}

const JURISDICTIONS = [
  ['on', 'Ontario (Superior Court of Justice)'],
  ['bc', 'British Columbia (Supreme Court)'],
  ['ab', "Alberta (Court of King's Bench)"],
  ['qc', 'Québec (Cour supérieure — civil law)'],
  ['ca-fed', 'Canada Federal Court'],
  ['us-fed', 'US Federal (FRCP)'],
  ['ny', 'New York (CPLR)'],
];

// category: 'limitation' for limitation/prescription rules — a statutory cutoff
// whose true expiry must never be silently rolled off a weekend/holiday to a
// later, false-safe date; 'procedural' for filing/response deadlines that do
// roll forward to the next business day. compute() branches on this.
const RULES = [
  { id: 'on-soc-defence', jur: 'on', category: 'procedural', trigger: 'Statement of claim served (in Ontario)', days: 20, method: 'calendar', desc: 'Statement of defence due', cite: 'Rules of Civil Procedure, r. 18.01' },
  { id: 'on-appeal', jur: 'on', category: 'procedural', trigger: 'Final order/judgment', days: 30, method: 'calendar', desc: 'Notice of appeal due', cite: 'Courts of Justice Act, s. 6; r. 61.04' },
  { id: 'on-limitation', jur: 'on', category: 'limitation', trigger: 'Claim discovered', days: 730, method: 'calendar', desc: 'Basic limitation period expires', cite: 'Limitations Act, 2002, s. 4' },
  { id: 'on-undertakings', jur: 'on', category: 'procedural', trigger: 'Examination for discovery', days: 60, method: 'calendar', desc: 'Undertakings answered (typical order)', cite: 'r. 31.07 practice' },
  { id: 'usfed-answer', jur: 'us-fed', category: 'procedural', trigger: 'Complaint served', days: 21, method: 'calendar', desc: 'Answer or Rule 12 motion due', cite: 'FRCP 12(a)(1)(A)(i)' },
  { id: 'usfed-answer-waiver', jur: 'us-fed', category: 'procedural', trigger: 'Service waived (FRCP 4(d))', days: 60, method: 'calendar', desc: 'Answer due after waiver', cite: 'FRCP 12(a)(1)(A)(ii)' },
  { id: 'usfed-rog-resp', jur: 'us-fed', category: 'procedural', trigger: 'Interrogatories served', days: 30, method: 'calendar', desc: 'Interrogatory responses due', cite: 'FRCP 33(b)(2)' },
  { id: 'usfed-rfp-resp', jur: 'us-fed', category: 'procedural', trigger: 'Requests for production served', days: 30, method: 'calendar', desc: 'RFP responses due', cite: 'FRCP 34(b)(2)(A)' },
  { id: 'usfed-appeal', jur: 'us-fed', category: 'procedural', trigger: 'Judgment entered', days: 30, method: 'calendar', desc: 'Notice of appeal due (civil)', cite: 'FRAP 4(a)(1)(A)' },
  { id: 'ny-answer', jur: 'ny', category: 'procedural', trigger: 'Complaint served (personal, in NY)', days: 20, method: 'calendar', desc: 'Answer due', cite: 'CPLR 3012(a)' },
  { id: 'ny-appeal', jur: 'ny', category: 'procedural', trigger: 'Order with notice of entry served', days: 30, method: 'calendar', desc: 'Notice of appeal due', cite: 'CPLR 5513(a)' },
  { id: 'cafed-defence', jur: 'ca-fed', category: 'procedural', trigger: 'Statement of claim served (in Canada)', days: 30, method: 'calendar', desc: 'Statement of defence due', cite: 'Federal Courts Rules, r. 204' },
  { id: 'cafed-appeal', jur: 'ca-fed', category: 'procedural', trigger: 'Federal Court final judgment', days: 30, method: 'calendar', desc: 'Notice of appeal to the FCA due', cite: 'Federal Courts Act, s. 27(2)' },
  { id: 'bc-limitation', jur: 'bc', category: 'limitation', trigger: 'Claim discovered', days: 730, method: 'calendar', desc: 'Basic limitation period expires', cite: 'Limitation Act, SBC 2012, c 13, s 6' },
  { id: 'bc-response', jur: 'bc', category: 'procedural', trigger: 'Notice of civil claim served (in Canada)', days: 21, method: 'calendar', desc: 'Response to civil claim due', cite: 'Supreme Court Civil Rules, R. 3-3(3)' },
  { id: 'ab-limitation', jur: 'ab', category: 'limitation', trigger: 'Claim discovered', days: 730, method: 'calendar', desc: 'Limitation period expires', cite: 'Limitations Act, RSA 2000, c L-12, s 3(1)(a)' },
  { id: 'ab-defence', jur: 'ab', category: 'procedural', trigger: 'Statement of claim served (in Alberta)', days: 20, method: 'calendar', desc: 'Statement of defence due', cite: 'Alberta Rules of Court, r 3.31' },
  { id: 'qc-limitation-prescription', jur: 'qc', category: 'limitation', trigger: 'Right of action arose', days: 1095, method: 'calendar', desc: 'Extinctive prescription expires (civil law — three years)', cite: 'art. 2925 CCQ' },
  { id: 'usfed-rfa-resp', jur: 'us-fed', category: 'procedural', trigger: 'Requests for admission served', days: 30, method: 'calendar', desc: 'RFA responses due — silence admits', cite: 'FRCP 36(a)(3)' },
  { id: 'usfed-posttrial', jur: 'us-fed', category: 'procedural', trigger: 'Judgment entered', days: 28, method: 'calendar', desc: 'Rule 59 new-trial / alter-or-amend motion due', cite: 'FRCP 59(b), (e)' },
  { id: 'usfed-appeal-usparty', jur: 'us-fed', category: 'procedural', trigger: 'Judgment entered (US is a party)', days: 60, method: 'calendar', desc: 'Notice of appeal due', cite: 'FRAP 4(a)(1)(B)' },
  { id: 'ny-limitation-pi', jur: 'ny', category: 'limitation', trigger: 'Cause of action accrued (personal injury)', days: 1095, method: 'calendar', desc: 'Limitation period expires', cite: 'CPLR 214(5)' },
  { id: 'ny-limitation-contract', jur: 'ny', category: 'limitation', trigger: 'Cause of action accrued (contract)', days: 2190, method: 'calendar', desc: 'Limitation period expires', cite: 'CPLR 213(2)' },
];

function isBusinessDay(d, jur) {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  return !holidaysFor(jur, d.getUTCFullYear()).includes(iso);
}

// A limitation/prescription cutoff is statutory: its expiry is a fixed date and
// must NEVER be silently rolled to a later, false-safe business day. Every other
// rule is procedural and rolls forward off weekends/holidays as before.
function isLimitation(rule) {
  if (rule && rule.category) return rule.category === 'limitation';
  // Fallback for a caller passing a rule minted without a category: never roll a
  // date that looks like a limitation/prescription period past its true expiry.
  return !!(rule && /limitation|prescription/.test(rule.id || ''));
}

// Calendar count; for procedural deadlines, if landing on a weekend/holiday roll
// forward to the next business day (the common default — court-specific
// variations live in data). For limitation/prescription rules return the true
// statutory date with NO roll; callers pair this with landsOnNonBusinessDay() to
// warn counsel to confirm any statutory extension.
function compute(rule, triggerDateISO) {
  const d = new Date(triggerDateISO + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw new Error('bad date');
  const limitation = isLimitation(rule);
  // Direction matters, and getting it wrong is malpractice-shaped. A
  // FORWARD-counted rule ("serve within 30 days") rolls a weekend/holiday
  // landing forward to the next business day — a later date is still compliant.
  // A BACKWARD-counted rule ("serve at least 90 days BEFORE trial", which is how
  // 21-calendar builds its pretrial cascade: days: -N) must roll BACKWARD:
  // rolling it forward moves the date closer to trial and silently shortens the
  // very lead time the rule exists to guarantee. Rolling always moves AWAY from
  // the anchor, never toward it.
  const step = rule.days < 0 ? -1 : 1;
  if (rule.method === 'business') {
    let left = Math.abs(rule.days);
    while (left > 0) { d.setUTCDate(d.getUTCDate() + step); if (isBusinessDay(d, rule.jur)) left--; }
  } else {
    d.setUTCDate(d.getUTCDate() + rule.days);
    if (!limitation) while (!isBusinessDay(d, rule.jur)) d.setUTCDate(d.getUTCDate() + step);
  }
  return d.toISOString().slice(0, 10);
}

// True when the given ISO date lands on a weekend or court holiday for the rule's
// jurisdiction. Callers compute() the limitation date, then flag it in the UI:
// "expires on a weekend/holiday — confirm any statutory extension."
function landsOnNonBusinessDay(rule, dateISO) {
  const d = new Date(String(dateISO).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return !isBusinessDay(d, (rule && rule.jur) || 'us-fed');
}

// Convenience: the statutory date plus whether it needs a counsel flag. compute()
// still returns a plain ISO string for existing callers; this is additive.
function computeLimitation(rule, triggerDateISO) {
  const date = compute(rule, triggerDateISO);
  return { date, weekendOrHoliday: landsOnNonBusinessDay(rule, date), limitation: isLimitation(rule) };
}

function rulesFor(jur) { return RULES.filter((r) => r.jur === jur); }
function rule(id) { return RULES.find((r) => r.id === id); }

// Is this stored DEADLINE a limitation/prescription bar? isLimitation() above
// answers that for a RULE; this answers it for a record, which is what every
// room actually holds.
//
// It lived in rooms/27-desk.js, and two other rooms needed it: 09-jurisdiction
// had its own copy whose text fallback was case-SENSITIVE, so it matched none of
// 01-intake's records ('Limitation period expires', 'Limitations Act, 2002,
// s. 4') and the bar stayed dark; 21-calendar had none at all. Rooms may only
// require html.js and http.js, so the shared home is here.
//
// Match on ANY of: the recorded flag, the rules.js id, the citation string or
// description every writer sets, or the rule standing behind the id. Never on
// ruleId alone — 01-intake, 12-discovery, 15-experts and 23-adr write no id, and
// keying off it made the limitation bar whose miss IS the claim invisible to
// both the flag and the dual-diary tick.
const LIMITATION_TEXT = /limitation|prescription/i;
function isLimitationDeadline(d) {
  if (!d) return false;
  // The recorded flag may only ADD, never subtract. 09-jurisdiction wrote
  // staleLimitation using its own case-sensitive fallback, so an existing record
  // can carry `false` on a bar that really is one; letting the stored value win
  // outright would quietly downgrade exactly the dates this exists to protect.
  if (d.staleLimitation === true) return true;
  const ruleId = String(d.ruleId || '');
  if (LIMITATION_TEXT.test(ruleId)) return true;
  if (LIMITATION_TEXT.test(String(d.rule || '') + ' ' + String(d.desc || ''))) return true;
  if (!ruleId) return false;
  let r = null;
  try { r = rule(ruleId); } catch (_) { r = null; }
  if (!r) return false;
  if (r.category === 'limitation') return true;
  return LIMITATION_TEXT.test(String(r.desc || '') + ' ' + String(r.cite || ''));
}

module.exports = { RULES, JURISDICTIONS, HOLIDAYS, holidaysFor, compute, rulesFor, rule, isBusinessDay, isLimitation, isLimitationDeadline, landsOnNonBusinessDay, computeLimitation };
