'use strict';
// Rules-as-code: deadline computation per jurisdiction. Data, not prose.
// Each rule carries its citation and computes calendar- or business-day
// offsets against that jurisdiction's holiday table. Reference tranche —
// the production rulebook grows per court, versioned and effective-dated.

const HOLIDAYS = {
  // 2026 statutory/court holidays (reference tranche).
  'us-fed': ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25'],
  'on': ['2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-26'],
};

const JURISDICTIONS = [
  ['on', 'Ontario (Superior Court of Justice)'],
  ['us-fed', 'US Federal (FRCP)'],
  ['ny', 'New York (CPLR)'],
  ['ca-fed', 'Canada Federal Court'],
];

const RULES = [
  { id: 'on-soc-defence', jur: 'on', trigger: 'Statement of claim served (in Ontario)', days: 20, method: 'calendar', desc: 'Statement of defence due', cite: 'Rules of Civil Procedure, r. 18.01' },
  { id: 'on-appeal', jur: 'on', trigger: 'Final order/judgment', days: 30, method: 'calendar', desc: 'Notice of appeal due', cite: 'Courts of Justice Act, s. 6; r. 61.04' },
  { id: 'on-limitation', jur: 'on', trigger: 'Claim discovered', days: 730, method: 'calendar', desc: 'Basic limitation period expires', cite: 'Limitations Act, 2002, s. 4' },
  { id: 'on-undertakings', jur: 'on', trigger: 'Examination for discovery', days: 60, method: 'calendar', desc: 'Undertakings answered (typical order)', cite: 'r. 31.07 practice' },
  { id: 'usfed-answer', jur: 'us-fed', trigger: 'Complaint served', days: 21, method: 'calendar', desc: 'Answer or Rule 12 motion due', cite: 'FRCP 12(a)(1)(A)(i)' },
  { id: 'usfed-answer-waiver', jur: 'us-fed', trigger: 'Service waived (FRCP 4(d))', days: 60, method: 'calendar', desc: 'Answer due after waiver', cite: 'FRCP 12(a)(1)(A)(ii)' },
  { id: 'usfed-rog-resp', jur: 'us-fed', trigger: 'Interrogatories served', days: 30, method: 'calendar', desc: 'Interrogatory responses due', cite: 'FRCP 33(b)(2)' },
  { id: 'usfed-rfp-resp', jur: 'us-fed', trigger: 'Requests for production served', days: 30, method: 'calendar', desc: 'RFP responses due', cite: 'FRCP 34(b)(2)(A)' },
  { id: 'usfed-appeal', jur: 'us-fed', trigger: 'Judgment entered', days: 30, method: 'calendar', desc: 'Notice of appeal due (civil)', cite: 'FRAP 4(a)(1)(A)' },
  { id: 'ny-answer', jur: 'ny', trigger: 'Complaint served (personal, in NY)', days: 20, method: 'calendar', desc: 'Answer due', cite: 'CPLR 3012(a)' },
  { id: 'ny-appeal', jur: 'ny', trigger: 'Order with notice of entry served', days: 30, method: 'calendar', desc: 'Notice of appeal due', cite: 'CPLR 5513(a)' },
  { id: 'cafed-defence', jur: 'ca-fed', trigger: 'Statement of claim served (in Canada)', days: 30, method: 'calendar', desc: 'Statement of defence due', cite: 'Federal Courts Rules, r. 204' },
];

function isBusinessDay(d, jur) {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  return !(HOLIDAYS[jur] || HOLIDAYS['us-fed']).includes(iso);
}

// Calendar count; if landing on weekend/holiday, roll forward to the next
// business day (the common default — court-specific variations live in data).
function compute(rule, triggerDateISO) {
  const d = new Date(triggerDateISO + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw new Error('bad date');
  if (rule.method === 'business') {
    let left = rule.days;
    while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (isBusinessDay(d, rule.jur)) left--; }
  } else {
    d.setUTCDate(d.getUTCDate() + rule.days);
    while (!isBusinessDay(d, rule.jur)) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function rulesFor(jur) { return RULES.filter((r) => r.jur === jur); }
function rule(id) { return RULES.find((r) => r.id === id); }

module.exports = { RULES, JURISDICTIONS, HOLIDAYS, compute, rulesFor, rule, isBusinessDay };
