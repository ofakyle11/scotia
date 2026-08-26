'use strict';
// SEEDED harness. test/harness.js creates ONE matter and no room records, so it
// only ever proves each room renders its EMPTY state — that is how 15-experts
// sat hard-broken (HTTP 500 whenever a matter had an expert) while the suite
// reported ALL PASS. This test populates every room's record types with
// realistic data and re-renders all 36 rooms, so a room that only breaks WITH
// data cannot pass silently again.
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-seeded-'));
process.env.PORT = String(31000 + Math.floor(Math.random() * 3000));
const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');
const registry = require('../kernel/registry.js');

const admin = store.firm.put('user', { email: 'seed@firm.local', name: 'Seed Admin', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 'seed');
const m = store.createMatter({ title: 'Seeded v. Fixture', client: 'Seed Holdings', adverse: ['Fixture Corp'], jurisdiction: 'on', status: 'open', posture: 'discovery', budget: 50000 }, admin.id);
const s = store.matterScope(m.id);
const S = (t, o) => s.put(t, o, admin.id);
const F = (t, o) => store.firm.put(t, o, admin.id);
const today = new Date().toISOString().slice(0, 10);

// --- firm scope ---
const inq = F('inquiry', { client: 'Seed Holdings', adverse: ['Fixture Corp'], jurisdiction: 'on', claimType: 'Commercial dispute', discovered: '2025-01-10', summary: 'seeded', limitation: '2027-01-10', status: 'screening' });
F('conflictRun', { inquiryId: inq.id, matterId: m.id, parties: ['Seed Holdings', 'Fixture Corp'], outcome: 'clear', ranBy: admin.id, ranAt: today });
F('party', { matterId: m.id, name: 'Fixture Corp', role: 'defendant', adverse: true });
F('watchName', { name: 'Fixture Corp', addedBy: admin.id });
F('courtEntry', { name: 'Ontario Superior Court of Justice', jurisdiction: 'on', level: 'superior', portal: 'Civil Submissions Online', fees: '$229 claim', limits: '30 pages', verifiedOn: today });
F('source', { name: 'RoyaltySource', url: 'https://www.royaltysource.com', category: 'IP valuation', access: 'commercial', notes: 'no API' });
F('letter', { kind: 'non-engagement', to: 'Someone Else', text: 'Seeded letter.' });
F('engagementSigned', { matterId: m.id, signedOn: today, feeModel: 'hourly', version: 1 });
F('canliiCase', { id: 'csc-scc/2008scc9', databaseId: 'csc-scc', caseId: '2008scc9', meta: { title: 'Dunsmuir v. New Brunswick', citation: '2008 SCC 9 (CanLII)', decisionDate: '2008-03-07', url: 'https://canlii.ca/t/1vxsm' }, fetched: today });
F('reconciliation', { statementDate: today, statementBalance: 7500, ledger: 7500, liabilities: 7500, ok: true, byName: 'Seed Admin' });

// --- matter scope ---
const f1 = S('fact', { date: '2025-11-03', actor: 'Fixture driver', text: 'Collision at Queen and Spadina.', source: 'Police report p.2', disputed: false, issues: ['liability'] });
S('fact', { date: '2025-12-01', actor: 'Adjuster', text: 'Liability denied.', source: 'Ex. 3', disputed: true, issues: ['liability'] });
S('deadline', { desc: 'Basic limitation period expires', due: '2027-01-10', rule: 'Limitations Act, 2002, s. 4', ruleId: 'on-limitation', trigger: 'Claim discovered', status: 'open' });
S('deadline', { desc: 'Statement of defence due', due: '2026-09-20', rule: 'r. 18.01', ruleId: 'on-soc-defence', trigger: 'Claim served', status: 'open' });
const draft = S('draft', { title: 'Factum on the motion', type: 'factum', sections: { rule: 'Per Dunsmuir v. New Brunswick, 2008 SCC 9, deference applies.' }, status: 'cite-check', citeStatus: 'blocked', court: 'ONSC', wordLimit: '5000' });
S('citation_instance', { cite: '2008 SCC 9', draftId: draft.id, status: 'unverified', pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null });
S('authority', { cite: '2008 SCC 9', title: 'Dunsmuir v. New Brunswick', court: 'SCC', year: '2008', weight: 'binding', adverse: false, proposition: 'Standard of review', source: 'research' });
const doc = S('document', { title: 'Service invoice', custodian: 'Seed Holdings', date: '2025-10-01', bates: 'DEF-000001', privilege: 'none', responsive: 'yes', issues: ['damages'], author: 'A. Clerk', recipients: 'Ops', dateCreated: '2025-10-01', privDesc: '' });
S('document', { title: 'Counsel memo', custodian: 'Seed Holdings', date: '2025-10-05', bates: 'DEF-000002', privilege: 'solicitor-client', responsive: 'yes', author: 'Counsel', recipients: 'Client', privDesc: 'Legal advice re claim' });
S('exhibit', { side: 'P', number: 'P-1', description: 'Police report', witness: 'Investigating officer', foundation: 'Business record', hearsay: 'Business records exception', status: 'listed', documentId: doc.id });
S('inLimine', { target: 'Prior conviction', ground: 'Prejudice outweighs probative value', status: 'draft' });
S('timeEntry', { hours: 1.2, rate: 450, utbms: 'L110 Fact investigation', narrative: 'Review police report and open the chronology', state: 'draft', lint: null });
S('expert', { name: 'Dr. Expert', discipline: 'Engineering', side: 'ours', rate: 500, status: 'retained', scope: 'Collision reconstruction', reportDue: '2026-10-01' });
S('trialWitness', { name: 'Investigating officer', minsDirect: 30, minsCross: 20, order: 1 });
S('juryInstruction', { topic: 'Burden of proof', source: 'CJC model' });
S('verdictQ', { question: 'Has the plaintiff proven liability?' });
S('critique', { draftId: draft.id, target: 'application', attack: 'Causation is thin on the pleaded facts.', severity: 'serious', response: '', status: 'open' });
S('benchQ', { draftId: draft.id, question: 'What is your best authority on causation?', answer: '', drilled: false });
S('undertaking', { text: 'Produce maintenance records', givenBy: 'defendant', given: today, due: '2026-10-15', status: 'open' });
S('adrSession', { process: 'mediation', provider: 'ADR Chambers', date: '2026-11-01', briefDue: '2026-10-20' });
S('offer', { direction: 'received', amount: 45000, date: today, expiry: '2026-10-01', terms: 'Full and final' });
S('waterfall', { gross: 200000, feePct: 33, costs: 12000, liens: [{ name: 'OHIP subrogation', amount: 4200 }], staged: false });
S('judgment', { amount: 150000, rate: 5, dateEntered: '2026-06-01', court: 'ONSC', debtor: 'Fixture Corp', recovered: 0, satisfied: false });
S('cause', { label: 'Negligence', jurisdiction: 'on', elements: [{ key: 'duty', label: 'Duty of care', factIds: [f1.id] }, { key: 'breach', label: 'Breach', factIds: [] }] });
S('affdefence', { label: 'Contributory negligence', pleaded: true, note: 'Seeded' });
S('pleading', { title: 'Statement of Claim', ptype: 'claim', body: 'The plaintiff relies on Dunsmuir v. New Brunswick, 2008 SCC 9.' });
S('instrument', { type: 'RFP', direction: 'outbound', served: today, due: '2026-10-01', status: 'open', objections: [] });
S('discoveryPlan', { scope: 'Email and maintenance records', custodians: 'Ops, Fleet', dateRange: '2024-2025', formats: 'native + load file', proportionality: 'Proportionate to $200k claim' });
S('meetConfer', { date: today, attendees: 'Both counsel', issues: 'Custodian list', resolutions: 'Agreed' });
S('production', { volume: 'PROD001', batesStart: 'DEF-000001', batesEnd: 'DEF-000002', recipient: 'Fixture Corp', servedDate: today, documentIds: [doc.id], status: 'served' });
S('invoice', { number: 'INV-0001', matterId: m.id, lineItems: [], fees: 540, disbursements: 0, writeDowns: 0, total: 540, status: 'draft', issuedDate: today });
S('clientUpdate', { text: 'We served the claim and are awaiting a defence.', sentOn: today, sentBy: admin.id, grade: 8 });
S('decisionMemo', { question: 'Accept the $45,000 offer?', options: 'Accept / counter / proceed', decision: 'Counter at 90k', decidedOn: today, recordedBy: admin.id });
S('scenario', { damagesLow: 100000, damagesLikely: 200000, damagesHigh: 350000, liabilityPct: 70, costsToDate: 12000, budgetToTrial: 60000, contingencyPct: 33 });
S('secFiling', { company: 'Fixture Corp', form: '10-K', date: '2025-03-01', description: 'Annual report', url: 'https://www.sec.gov/', adsh: '0001' });
S('lookup', { source: 'RoyaltySource', query: 'tire royalty rates', result: 'Range 3-5%' });
S('docketRef', { caseName: 'Fixture v. Another', court: 'SDNY', dateFiled: '2025-02-02', docketNumber: '1:25-cv-1', url: 'https://www.courtlistener.com/', source: 'recap' });
S('closingChecklist', { id: 'closing', done: [0] });
S('trialChecklist', { id: 'checklist', done: [0, 1] });

const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { console.error('SERVER ERROR:', e.message); });
const base = 'http://localhost:' + process.env.PORT;

(async () => {
  const failures = [];
  for (const room of registry) {
    const r = await fetch(base + '/r/' + room.id, { headers: { cookie: `s=${session}; m=${m.id}` } });
    const body = await r.text();
    if (r.status !== 200) { failures.push(`${room.id}: HTTP ${r.status}`); continue; }
    if (/Internal error|Handler did not respond/i.test(body)) { failures.push(`${room.id}: rendered an error page WITH DATA`); continue; }
    if (!body.includes('class="shell"')) failures.push(`${room.id}: did not render the app shell`);
  }
  // Rendering 200 + shell only proves a room does not CRASH with data present.
  // It does not prove the seeded data actually reached the room. It did not:
  // this file seeded `responsive: true` (boolean) while 13-review, 33-production
  // and 35-affidavit all code responsiveness as the STRING 'yes', so every
  // seeded document was silently coded not-responsive and three rooms rendered
  // their EMPTY state while the suite reported ALL PASS — the R9 blind spot one
  // layer down. These expectations close it: each room below owns seeded records
  // that MUST reach it, asserted via the empty-state copy that must NOT appear.
  const EXPECT = [
    ['production', 'No document is coded responsive and not-privileged yet',
      'seeded responsive documents did not reach the production index'],
    ['production', 'Nothing coded responsive and not-privileged.',
      'seeded responsive documents did not reach the volume document index'],
    ['affidavit', 'Nothing coded responsive and unprivileged yet',
      'seeded responsive documents did not reach Schedule A'],
    ['affidavit', 'Nothing coded privileged yet',
      'the seeded solicitor-client document did not reach Schedule B'],
  ];
  for (const [room, emptyCopy, why] of EXPECT) {
    const r = await fetch(base + '/r/' + room, { headers: { cookie: `s=${session}; m=${m.id}` } });
    const body = await r.text();
    if (body.includes(emptyCopy)) failures.push(`${room}: ${why} (empty state rendered: "${emptyCopy}")`);
  }

  // Admin + account surfaces too.
  for (const p of ['/admin', '/account']) {
    const r = await fetch(base + p, { headers: { cookie: `s=${session}` } });
    if (r.status !== 200) failures.push(`${p}: HTTP ${r.status}`);
  }
  server.close();
  if (failures.length) { console.error('SEEDED FAIL:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log(`SEEDED: ALL PASS (${registry.length} rooms rendered with real records of every major type)`);
  process.exit(0);
})().catch((e) => { console.error('SEEDED ERROR:', e.message); try { server.close(); } catch (_) {} process.exit(1); });
