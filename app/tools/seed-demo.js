'use strict';
// Seeds a demonstration matter so a first walkthrough has something to show.
// Refuses to run against a data directory that already has matters.
//   node tools/seed-demo.js            (uses ./data like the server)
const path = require('path');
process.env.CHAMBERS_DATA = process.env.CHAMBERS_DATA || path.join(__dirname, '..', 'data');
const { Keyring, hashPassword } = require('../kernel/crypto.js');
const { Store } = require('../kernel/store.js');
const { Audit } = require('../kernel/audit.js');
const { makeKernel } = require('../kernel/api.js');

const keyring = new Keyring(process.env.CHAMBERS_DATA);
const store = new Store(process.env.CHAMBERS_DATA, keyring);
const audit = new Audit(process.env.CHAMBERS_DATA);

if (store.firm.list('matter').length) { console.error('Refusing: matters already exist in ' + process.env.CHAMBERS_DATA); process.exit(1); }
let admin = store.firm.list('user', (u) => u.role === 'admin')[0];
if (!admin) { console.error('Refusing: enroll the founding admin first (run the server once and use the invite).'); process.exit(1); }

const k = makeKernel({ store, audit, keyring }, admin);
const m = k.createMatter({ title: 'Demo — Beaumont v. Ridgeline Logistics', client: 'A. Beaumont', adverse: ['Ridgeline Logistics Inc.'], jurisdiction: 'on', status: 'open', posture: 'discovery' });
const s = k.scope(m.id);
s.put('fact', { date: '2025-11-03', actor: 'Ridgeline driver', text: 'Collision at Queen St W and Spadina Ave; client vehicle struck in intersection.', source: 'Police report, p. 2', disputed: false, issues: ['liability'] });
s.put('fact', { date: '2025-11-04', actor: 'A. Beaumont', text: 'Attended St. Michael\'s emergency; soft-tissue injuries documented.', source: 'Hospital record, Ex. 2', disputed: false, issues: ['damages'] });
s.put('fact', { date: '2025-12-01', actor: 'Ridgeline adjuster', text: 'Denied liability by letter, alleging client ran the light.', source: 'Letter, Ex. 3', disputed: true, issues: ['liability'] });
const lim = k.rules.rule('on-limitation');
s.put('deadline', { desc: lim.desc, due: k.rules.compute(lim, '2025-11-10'), rule: lim.cite, trigger: lim.trigger + ' 2025-11-10', status: 'open', ruleId: lim.id });
const und = k.rules.rule('on-undertakings');
s.put('deadline', { desc: und.desc, due: k.rules.compute(und, new Date().toISOString().slice(0, 10)), rule: und.cite, trigger: und.trigger + ' (today)', status: 'open', ruleId: und.id });
k.ledger.post(m.id, { memo: 'Initial retainer per engagement letter', kind: 'trust-receipt', lines: [{ account: 'trust:bank', dr: 7500 }, { account: 'trust:client', cr: 7500 }] });
s.put('timeEntry', { hours: 1.2, rate: 450, utbms: 'L110 Fact investigation', narrative: 'Review police report and hospital records; open chronology and dispute map', state: 'draft', lint: null });
s.put('exhibit', { side: 'P', number: 'P-1', description: 'Police report, 3 Nov 2025', witness: 'Investigating officer', foundation: 'Business record', hearsay: 'Business records exception', status: 'listed' });
s.put('draft', { title: 'Factum — motion for undertakings', type: 'factum', sections: { conclusion: 'The undertakings should be answered within 30 days.' }, status: 'draft', citeStatus: 'none', court: '', wordLimit: '' });
console.log('Seeded demo matter:', m.title);
console.log('Open the Workflow room — deadlines, trust position and the chronology are live.');
