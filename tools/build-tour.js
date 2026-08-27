#!/usr/bin/env node
'use strict';
// ---------------------------------------------------------------------------
// build-tour.js — the demo site, rebuilt from the repo.
//
//   node tools/build-tour.js [publish-dir]        default: <repo>/dist-tour
//
// Boots the REAL Chambers server on a throwaway temp data directory, seeds one
// fictional demonstration matter, crawls every room in kernel/registry.js plus
// /admin and /account as a signed-in seat, and writes the rendered pages out as
// flat static HTML. Netlify runs this on every push (see netlify.toml), so the
// public tour is always the current build instead of a hand-made snapshot.
//
// Zero dependencies, like the app. Node 20+ (Netlify pins 22 in netlify.toml).
//
// WHAT MAKES THIS SAFE TO PUBLISH — every one of these is enforced below and
// re-checked by a leak scan that FAILS THE BUILD (exit 1, nothing published)
// rather than shipping a page it is unsure about:
//   * the data directory is a fresh mkdtemp, never app/data — an inherited
//     CHAMBERS_DATA is overridden, so a real firm's store can never be crawled;
//   * the two seats are pre-created before server.js loads, so first boot never
//     mints seat invites; no invite record exists, so /admin has none to render.
//     console.log is additionally filtered for /invite/ URLs in case that ever
//     changes (Netlify build logs are not a place for a live invite code);
//   * no calendar feed token is minted, no TOTP secret is enrolled, no API keys
//     or model-gateway settings are stored — none of those can reach a page;
//   * every internal link is rewritten to a flat .html file; any deeper route
//     (downloads, /r/calendar/feed/:token, /r/portal/pack/:id) becomes an inert
//     link with its path — and therefore any id or token in it — DELETED;
//   * per-response CSP nonces are stripped (they are meaningless in a static
//     file and look exactly like a secret);
//   * every form is neutered twice: the POST action and method are rewritten in
//     the markup, and a small inline script cancels submissions and no-ops
//     HTMLFormElement.prototype.submit;
//   * every page carries <meta name="robots" content="noindex,nofollow"> (the
//     app's own layout emits it; the build asserts it) and robots.txt disallows
//     everything. netlify.toml adds X-Robots-Tag: noindex on top.
//
// Optional courtesy gate: set TOUR_GATE_PASS in the Netlify build environment
// and the cover page asks for it before the tour opens (SHA-256 of the phrase is
// embedded, never the phrase). It is a speed bump, NOT security — everything on
// the site is fictional, and no password should ever be committed to this repo.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
const APP = path.join(REPO, 'app');
const OUT = path.resolve(process.cwd(), process.argv[2] || path.join(REPO, 'dist-tour'));

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(NODE_MAJOR) || NODE_MAJOR < 20) {
  console.error(`build-tour: needs Node 20+ (global fetch, fs.rmSync); running ${process.version}.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(APP, 'server.js'))) {
  console.error(`build-tour: no app/server.js under ${REPO} — run this from the repo it lives in.`);
  process.exit(1);
}

// --- output directory, wiped so a previous run can never leak into this one --
{
  const root = path.parse(OUT).root;
  if (OUT === root || OUT === REPO || OUT === APP || fs.existsSync(path.join(OUT, '.git'))) {
    console.error(`build-tour: refusing to use ${OUT} as the publish directory.`);
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
}

// --- an isolated, throwaway store ------------------------------------------
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-tour-'));
process.env.CHAMBERS_DATA = DATA; // deliberately overrides any inherited value
process.env.CHAMBERS_INSECURE_COOKIES = '1'; // the crawler talks plain http to 127.0.0.1
delete process.env.PORT; // we bind an ephemeral port ourselves

// Every exit from here on takes the throwaway store with it — a build host has
// no business keeping a sealed demo log around after the pages are written.
const wipeData = () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) { /* best effort */ } };
const die = (msg) => { console.error(msg); wipeData(); process.exit(1); };

// Belt and braces: nothing that looks like an invite URL reaches the build log.
const INVITE_RX = /\/invite\/[A-Za-z0-9._~-]+/g;
for (const stream of ['log', 'error', 'warn', 'info']) {
  const real = console[stream].bind(console);
  console[stream] = (...args) => real(...args.map((a) => (typeof a === 'string' ? a.replace(INVITE_RX, '/invite/[redacted]') : a)));
}

// --- the two seats, created BEFORE server.js loads --------------------------
// server.js mints one seat invite per seat on a virgin store. Creating the users
// first means that branch never runs, so no invite code is ever generated, held,
// printed or rendered.
const { Keyring } = require(path.join(APP, 'kernel', 'crypto.js'));
const { Store } = require(path.join(APP, 'kernel', 'store.js'));
{
  const kr = new Keyring(DATA);
  const st = new Store(DATA, kr);
  // .invalid is reserved by RFC 2606: these addresses cannot exist. No password
  // hash is stored — the tour never signs in through the login form.
  st.firm.put('user', { email: 'dan@chambers.invalid', name: 'Dan G', role: 'admin', active: true }, 'tour');
  st.firm.put('user', { email: 'matt@chambers.invalid', name: 'Matt D', role: 'admin', active: true }, 'tour');
}

const { app, makeCtx, store, audit, auth, keyring } = require(path.join(APP, 'server.js'));
const { makeKernel } = require(path.join(APP, 'kernel', 'api.js'));
const registry = require(path.join(APP, 'kernel', 'registry.js'));

const dan = store.firm.list('user', (u) => u.name === 'Dan G')[0];
const matt = store.firm.list('user', (u) => u.name === 'Matt D')[0];
if (!dan || !matt) die('build-tour: seat pre-seed failed.');
if (store.firm.list('invite').length) die('build-tour: an invite exists — refusing to publish.');

// ---------------------------------------------------------------------------
// The demonstration matter. Entirely fictional: invented parties, invented
// facts, invented figures. Real citations only where the app quotes real law.
// ---------------------------------------------------------------------------
const k = makeKernel({ store, audit, keyring }, dan);
const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const m = k.createMatter({
  title: 'Beaumont v. Ridgeline Logistics (demonstration)',
  client: 'A. Beaumont', adverse: ['Ridgeline Logistics Inc.'],
  jurisdiction: 'on', status: 'open', posture: 'discovery', budget: 60000,
});
const m2 = k.createMatter({
  title: 'Harrow Bay Condominium Corp. — retainer (demonstration)',
  client: 'Harrow Bay Condominium Corp. No. 411', adverse: ['Pell & Sons Restoration Ltd.'],
  jurisdiction: 'on', status: 'open', posture: 'pleadings', budget: 25000,
});
const s = k.scope(m.id);
const S = (t, o) => s.put(t, o);
const F = (t, o) => k.firm.put(t, o);

// --- firm scope -------------------------------------------------------------
const inq = F('inquiry', {
  client: 'A. Beaumont', adverse: ['Ridgeline Logistics Inc.'], jurisdiction: 'on',
  claimType: 'Motor vehicle — personal injury', discovered: '2025-11-03',
  summary: 'Intersection collision; liability denied by the carrier’s adjuster.',
  limitation: '2027-11-03', status: 'opened', matterId: m.id,
});
F('inquiry', {
  client: 'Q. Ferreira', adverse: ['Northbridge Property Group'], jurisdiction: 'on',
  claimType: 'Commercial lease — arrears', discovered: plus(-6),
  summary: 'Landlord alleges arrears; enquirer says the premises were unusable for two months.',
  limitation: '', status: 'screening',
});
F('conflictRun', { inquiryId: inq.id, matterId: m.id, parties: ['A. Beaumont', 'Ridgeline Logistics Inc.'], outcome: 'clear', runBy: dan.name, ranBy: dan.name, ranAt: today });
F('party', { matterId: m.id, name: 'Ridgeline Logistics Inc.', role: 'defendant', adverse: true });
F('party', { matterId: m.id, name: 'A. Beaumont', role: 'plaintiff', adverse: false });
F('watchName', { name: 'Ridgeline Logistics Inc.', addedBy: dan.id });
F('courtEntry', { name: 'Ontario Superior Court of Justice (Toronto)', jurisdiction: 'on', level: 'superior', portal: 'Civil Submissions Online', fees: '$229 statement of claim', limits: 'Factum 30 pages', verifiedOn: today });
F('source', { name: 'CanLII', url: 'https://www.canlii.org', category: 'Primary law', access: 'free', notes: 'API key configured per firm; nothing is sent without one.' });
F('source', { name: 'CourtListener / RECAP', url: 'https://www.courtlistener.com', category: 'US dockets', access: 'free tier', notes: 'Link-out only until a token is set.' });
F('letter', { kind: 'non-engagement', to: 'Enquirer declined at intake (demonstration)', text: 'We are not able to act on this matter. No limitation period has been calculated for you and none is being watched by this office.' });
// NB: no engagementSigned marker is written by hand. 03-retainer mints it as
// part of signing, and the crawl below walks that route so the marker Trust &
// Books reads is the exact one the product writes (CONTRACT-SHEET §(c)).
F('canliiCase', { id: 'csc-scc/2008scc9', databaseId: 'csc-scc', caseId: '2008scc9', meta: { title: 'Dunsmuir v. New Brunswick', citation: '2008 SCC 9 (CanLII)', decisionDate: '2008-03-07', url: 'https://canlii.ca/t/1vxsm' }, fetched: today });
F('reconciliation', { statementDate: today, statementBalance: 7500, ledger: 7500, liabilities: 7500, ok: true, byName: 'Matt D' });

// --- the matter -------------------------------------------------------------
const f1 = S('fact', { date: '2025-11-03', actor: 'Ridgeline driver', text: 'Tractor-trailer entered the intersection at Queen St W and Spadina Ave and struck the client’s vehicle.', source: 'Police report, p. 2', disputed: false, issues: ['liability'] });
S('fact', { date: '2025-11-03', actor: 'A. Beaumont', text: 'Attended hospital the same evening; soft-tissue injury to neck and shoulder documented.', source: 'Hospital record, Ex. 2', disputed: false, issues: ['damages'] });
S('fact', { date: '2025-12-01', actor: 'Ridgeline adjuster', text: 'Liability denied by letter, alleging the client entered on a stale amber.', source: 'Letter, Ex. 3', disputed: true, issues: ['liability'] });
S('fact', { date: '2026-02-14', actor: 'Ridgeline dispatch', text: 'Maintenance log for unit 8814 not produced with the affidavit of documents.', source: 'Affidavit of documents, Sch. A', disputed: true, issues: ['liability', 'production'] });

const lim = k.rules.rule('on-limitation');
const und = k.rules.rule('on-undertakings');
const def = k.rules.rule('on-soc-defence');
S('deadline', { desc: lim.desc, due: k.rules.compute(lim, '2025-11-03'), rule: lim.cite, ruleId: lim.id, trigger: lim.trigger + ' 2025-11-03', status: 'open' });
S('deadline', { desc: und.desc, due: k.rules.compute(und, plus(-14)), rule: und.cite, ruleId: und.id, trigger: und.trigger + ' at discovery', status: 'open' });
S('deadline', { desc: def.desc, due: k.rules.compute(def, plus(-5)), rule: def.cite, ruleId: def.id, trigger: def.trigger + ' (claim served)', status: 'open' });
S('bf', { note: 'Chase the maintenance log for unit 8814', due: plus(9), owner: dan.id, status: 'open' });

const draft = S('draft', {
  title: 'Factum — motion to compel undertakings', type: 'factum',
  sections: {
    overview: 'The plaintiff moves for an order compelling answers to undertakings given on discovery.',
    rule: 'Reasonableness review is governed by Dunsmuir v. New Brunswick, 2008 SCC 9, as reframed in Canada (Minister of Citizenship and Immigration) v. Vavilov, 2019 SCC 65.',
    conclusion: 'The undertakings should be answered within thirty days.',
  },
  status: 'cite-check', citeStatus: 'blocked', court: 'ONSC', wordLimit: '5000',
});
S('citation_instance', { cite: '2008 SCC 9', draftId: draft.id, status: 'verified', pinpoint: 'para 47', quoteOk: true, treatmentCurrent: true, resolved: true, checkedBy: 'Dan G', checkedAt: today });
S('citation_instance', { cite: '2019 SCC 65', draftId: draft.id, status: 'unverified', pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null });
S('authority', { cite: '2008 SCC 9', title: 'Dunsmuir v. New Brunswick', court: 'SCC', year: '2008', weight: 'binding', adverse: false, proposition: 'Standard of review framework', source: 'research' });
S('authority', { cite: '2019 SCC 65', title: 'Canada (Minister of Citizenship and Immigration) v. Vavilov', court: 'SCC', year: '2019', weight: 'binding', adverse: false, proposition: 'Reasonableness as the presumptive standard', source: 'research' });
S('memo', { issue: 'Can an answer refused on relevance be compelled where the undertaking was given without reservation?', conclusion: 'Yes on these facts — the undertaking was given without qualification and the document goes to the pleaded standard of care.' });

// A second draft that has cleared the citation gate, so the Filing Room shows
// the packet path rather than only the gate that blocks it.
const finalDraft = S('draft', {
  title: 'Notice of motion — undertakings', type: 'motion',
  sections: { relief: 'An order that the defendant answer the undertakings given on 14 October, within thirty days.' },
  status: 'final', citeStatus: 'clear', noCitationsFound: false, court: 'ONSC', wordLimit: '',
});
S('citation_instance', { cite: '2019 SCC 65', draftId: finalDraft.id, status: 'verified', pinpoint: 'para 23', quoteOk: true, treatmentCurrent: true, resolved: true, checkedBy: 'Matt D', checkedAt: today });

// 13-review codes responsiveness as the STRING 'yes'/'no' (respOf), not a
// boolean — a boolean reads as "not responsive" and empties the review set,
// the production index and Schedule A of the affidavit.
const doc = S('document', { title: 'Dispatch log, 3 Nov 2025', custodian: 'Ridgeline Logistics Inc.', date: '2025-11-03', bates: 'RID-000001', privilege: 'none', responsive: 'yes', issues: ['liability'], author: 'Dispatch', recipients: 'Fleet', dateCreated: '2025-11-03', privDesc: '' });
const doc2 = S('document', { title: 'Adjuster’s denial letter', custodian: 'Ridgeline Logistics Inc.', date: '2025-12-01', bates: 'RID-000014', privilege: 'none', responsive: 'yes', issues: ['liability'], author: 'Adjuster', recipients: 'A. Beaumont', dateCreated: '2025-12-01', privDesc: '' });
S('document', { title: 'Maintenance record, unit 8814', custodian: 'Ridgeline Logistics Inc.', date: '2025-09-18', bates: 'RID-000021', privilege: 'none', responsive: 'yes', issues: ['liability'], author: 'Fleet Maintenance', recipients: 'Dispatch', dateCreated: '2025-09-18', privDesc: '' });
S('document', { title: 'Memo to file — theory of liability', custodian: 'Our office', date: '2026-01-08', bates: 'PLF-000102', privilege: 'solicitor-client', responsive: 'no', author: 'Dan G', recipients: 'File', privDesc: 'Legal advice on the merits of the claim' });
S('exhibit', { side: 'P', number: 'P-1', description: 'Police report, 3 Nov 2025', witness: 'Investigating officer', foundation: 'Business record', hearsay: 'Business records exception', status: 'listed', documentId: doc.id });
S('exhibit', { side: 'P', number: 'P-2', description: 'Adjuster’s denial letter', witness: 'A. Beaumont', foundation: 'Received in the ordinary course', hearsay: 'Not for its truth — state of mind', status: 'listed', documentId: doc2.id });
S('inLimine', { target: 'Reference to collateral benefits', ground: 'Statutory deductibility is for the judge, not the jury', status: 'draft' });

S('timeEntry', { hours: 1.2, rate: 450, utbms: 'L110 Fact investigation', narrative: 'Review police report and hospital records; open the chronology and the dispute map', state: 'draft', lint: null });
S('timeEntry', { hours: 2.4, rate: 450, utbms: 'L250 Written motions', narrative: 'Draft factum on the motion to compel undertakings; assemble authorities', state: 'draft', lint: null });
S('expert', { name: 'Dr. K. Osei, P.Eng.', discipline: 'Collision reconstruction', side: 'ours', rate: 500, status: 'retained', scope: 'Speed and sightline analysis at the intersection', reportDue: plus(45) });
S('trialWitness', { name: 'Investigating officer', minsDirect: 30, minsCross: 20, order: 1 });
S('trialWitness', { name: 'A. Beaumont', minsDirect: 60, minsCross: 45, order: 2 });
S('juryInstruction', { topic: 'Burden of proof', source: 'Model jury instruction' });
S('verdictQ', { question: 'Has the plaintiff proven that the defendant’s driver was negligent?' });
S('critique', { draftId: draft.id, target: 'causation', attack: 'The causation chain rests on one disputed fact and no expert opinion yet.', severity: 'serious', response: '', status: 'open' });
S('benchQ', { draftId: draft.id, question: 'What is your best authority for compelling an answer refused on relevance?', answer: '', drilled: false });

// 14-depositions works off `witness` records; undertakings hang off the
// examination they were given in, by witnessId.
const wDefendant = S('witness', { name: 'R. Calderón', side: 'theirs', role: 'Dispatch supervisor, Ridgeline', examDate: plus(-14) });
S('witness', { name: 'A. Beaumont', side: 'ours', role: 'Plaintiff', examDate: plus(-14) });
S('depoTopic', { witnessId: wDefendant.id, order: 1, topic: 'Dispatch practice for unit 8814 on 3 Nov 2025', source: 'Police report, p. 2', factId: f1.id });
S('depoTopic', { witnessId: wDefendant.id, order: 2, topic: 'Retention period for telematics and GPS traces', source: 'Discovery plan' });
S('digest', { witnessId: wDefendant.id, pl: '42:11', quote: 'I could not say whether the maintenance log was pulled that week.', kind: 'admission', contraFactId: null });
S('undertaking', { text: 'Produce the maintenance log for unit 8814', givenBy: 'defendant', witnessId: wDefendant.id, given: plus(-14), due: plus(16), status: 'open' });
S('undertaking', { text: 'Advise whether the dispatch system retains GPS traces', givenBy: 'defendant', witnessId: wDefendant.id, given: plus(-14), due: plus(16), status: 'open' });
S('instrument', { type: 'RFP', direction: 'outbound', served: plus(-30), due: plus(-2), status: 'open', objections: [] });
S('discoveryPlan', { scope: 'Dispatch, maintenance and telematics records for unit 8814', custodians: 'Dispatch, Fleet Maintenance', dateRange: '2024-01-01 to 2025-12-31', formats: 'Native with load file', proportionality: 'Proportionate to a claim pleaded at $200,000' });
S('meetConfer', { date: plus(-21), attendees: 'Both counsel', issues: 'Custodian list and telematics retention', resolutions: 'Defendant to confirm retention period in writing' });
S('production', { volume: 'PROD001', batesStart: 'RID-000001', batesEnd: 'RID-000014', recipient: 'Ridgeline Logistics Inc.', servedDate: plus(-10), documentIds: [doc.id, doc2.id], status: 'served' });

S('adrSession', { process: 'mediation', provider: 'ADR Chambers', date: plus(60), briefDue: plus(45) });
S('offer', { direction: 'received', amount: 45000, date: plus(-3), expiry: plus(25), terms: 'Full and final, inclusive of costs and interest' });
S('waterfall', { gross: 200000, feePct: 33, costs: 12000, liens: [{ name: 'OHIP subrogated interest', amount: 4200 }], staged: false });
S('judgment', { amount: 150000, rate: 5, dateEntered: plus(-1), court: 'ONSC', debtor: 'Ridgeline Logistics Inc.', recovered: 0, satisfied: false });
S('cause', { label: 'Negligence', jurisdiction: 'on', elements: [{ key: 'duty', label: 'Duty of care', factIds: [f1.id] }, { key: 'breach', label: 'Breach of the standard', factIds: [f1.id] }, { key: 'causation', label: 'Causation', factIds: [] }, { key: 'damage', label: 'Damage', factIds: [] }] });
S('affdefence', { label: 'Contributory negligence', pleaded: true, note: 'Pleaded in the statement of defence at para 14.' });
S('pleading', { title: 'Statement of Claim', ptype: 'claim', body: 'The plaintiff claims damages for negligence. The applicable standard of review on the pending motion is that in Dunsmuir v. New Brunswick, 2008 SCC 9.' });

S('invoice', { number: 'INV-0001', matterId: m.id, lineItems: [], fees: 1620, disbursements: 229, writeDowns: 0, total: 1849, status: 'draft', issuedDate: today });
S('clientUpdate', { text: 'The claim is served and the defence is in. We are moving to compel two outstanding undertakings.', sentOn: plus(-7), sentBy: dan.id, grade: 8 });
S('decisionMemo', { question: 'Accept the $45,000 offer or proceed to mediation?', options: 'Accept · counter at $90,000 · proceed', decision: 'Counter at $90,000; mediation is already booked', decidedOn: plus(-2), recordedBy: dan.id });
S('scenario', { damagesLow: 90000, damagesLikely: 180000, damagesHigh: 320000, liabilityPct: 70, costsToDate: 12000, budgetToTrial: 60000, contingencyPct: 33 });
S('secFiling', { company: 'Ridgeline Logistics Inc. (illustrative)', form: '10-K', date: '2025-03-01', description: 'Annual report — fleet and insurance disclosure', url: 'https://www.sec.gov/edgar', adsh: '0000000000-00-000000' });
S('lookup', { source: 'CanLII', query: 'undertakings compelled Rule 34.15', result: 'Reviewed three ONSC endorsements; two on point.' });
S('docketRef', { caseName: 'Illustrative cross-border carrier action', court: 'S.D.N.Y.', dateFiled: '2025-02-02', docketNumber: '1:25-cv-00001', url: 'https://www.courtlistener.com', source: 'recap' });
S('closingChecklist', { id: 'closing', done: [0] });
S('trialChecklist', { id: 'checklist', done: [0, 1] });

k.ledger.post(m.id, { date: plus(-40), memo: 'Retainer received into trust per the engagement letter', kind: 'trust-receipt', lines: [{ account: 'trust:bank', dr: 7500 }, { account: 'trust:client', cr: 7500 }] });
k.ledger.post(m.id, { date: plus(-12), memo: 'Statement of claim — court filing fee', kind: 'disbursement', lines: [{ account: 'operating:disbursements', dr: 229 }, { account: 'operating:bank', cr: 229 }] });
k.ledger.post(m2.id, { date: plus(-20), memo: 'Retainer received into trust', kind: 'trust-receipt', lines: [{ account: 'trust:bank', dr: 5000 }, { account: 'trust:client', cr: 5000 }] });

// Nothing below this line may create an invite, a calendar feed token, a TOTP
// secret or an API-key setting. The leak scan checks for all four anyway.

// ---------------------------------------------------------------------------
// Static rewriting
// ---------------------------------------------------------------------------
const ROOM_IDS = new Set(registry.map((r) => r.id));
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DEAD = '#" data-tour-dead="1';

// Absolute in-app path -> flat file, or null for "not part of the static tour".
// Anything deeper than /r/<room> (downloads, ICS feeds, per-record viewers)
// resolves to null, which DELETES the path — and any id or token inside it.
function mapPath(u) {
  if (u === '/' || u === '/logout-form') return 'index.html';
  if (u === '/admin' || u.startsWith('/admin?')) return 'admin.html';
  if (u === '/account' || u.startsWith('/account?')) return 'account.html';
  if (u.startsWith('/r/')) {
    const rest = u.slice(3);
    const room = rest.split(/[/?#]/)[0];
    if (!ROOM_IDS.has(room)) return null;
    return /[/]/.test(rest.split('#')[0].split('?')[0].slice(room.length)) ? null : `r-${room}.html`;
  }
  return null;
}

const PREVIEW_SCRIPT = [
  '<script>',
  '/* Static preview: every form is inert and every action is a no-op. */',
  '(function(){',
  '  function toast(msg){',
  '    var el=document.getElementById("tour-toast");',
  '    if(!el){el=document.createElement("div");el.id="tour-toast";el.setAttribute("role","status");',
  '      el.className="no-print";',
  '      el.style.cssText="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;max-width:min(560px,92vw);background:#131822;color:#E8EBF1;border:1px solid #2C4A7C;padding:11px 16px;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.5)";',
  '      document.body.appendChild(el);}',
  '    el.textContent=msg;el.style.display="block";',
  '    clearTimeout(el._t);el._t=setTimeout(function(){el.style.display="none";},2800);',
  '  }',
  '  var SAVE="Static preview — this page is a rendered snapshot. Saving, filing, computing and every other action work in the running application.";',
  '  var GONE="Not part of the static preview — downloads, exports and token-authenticated feeds exist only in the running application.";',
  '  document.addEventListener("submit",function(e){e.preventDefault();e.stopPropagation();toast(SAVE);},true);',
  '  try{HTMLFormElement.prototype.submit=function(){toast(SAVE);};}catch(err){}',
  '  document.addEventListener("click",function(e){',
  '    var t=e.target,a=null;',
  '    while(t&&t!==document){if(t.tagName==="A"){a=t;break;}t=t.parentNode;}',
  '    if(a&&a.hasAttribute("data-tour-dead")){e.preventDefault();toast(GONE);}',
  '  },true);',
  '  var b=document.createElement("div");',
  '  b.className="no-print";',
  '  b.textContent="STATIC PREVIEW · FICTIONAL DEMONSTRATION MATTER";',
  // Bottom RIGHT, over .main's own 60px bottom padding: the sidebar is its own
  // sticky scroll container, so a badge in the left corner would permanently
  // sit on top of the last room in the nav.
  '  b.style.cssText="position:fixed;right:0;bottom:0;z-index:9998;pointer-events:none;background:rgba(11,14,20,.85);color:#6E7886;font:10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;padding:7px 11px;border-top:1px solid #273043;border-left:1px solid #273043";',
  '  document.body.appendChild(b);',
  '})();',
  '</script>',
].join('\n');

const GATE_PASS = String(process.env.TOUR_GATE_PASS || '').trim();
const GATE_HASH = GATE_PASS ? crypto.createHash('sha256').update(GATE_PASS).digest('hex') : '';
const GATE_GUARD = GATE_HASH
  ? `<script>try{if(sessionStorage.getItem("chambers-tour")!=="${GATE_HASH}")location.replace("index.html");}catch(e){location.replace("index.html");}</script>`
  : '';

function staticize(html, label) {
  let h = String(html);
  // Per-response CSP nonces: meaningless in a file, and shaped like a secret.
  h = h.replace(/\s+nonce="[^"]*"/g, '');
  // Links.
  h = h.replace(/href="(\/[^"]*)"/g, (full, u) => {
    const to = mapPath(u);
    return `href="${to === null ? DEAD : to}"`;
  });
  // Forms: no POST target survives in the markup at all.
  h = h.replace(/<form\b[^>]*>/gi, (t) => t
    .replace(/\saction="[^"]*"/gi, ' action="#"')
    .replace(/\smethod="[^"]*"/gi, ' method="get"')
    .replace(/<form\b/i, '<form data-tour-inert="1"'));
  // The shell's quick-open palette navigates by script.
  h = h.replace(/location\.href\s*=\s*'\/r\/'\s*\+\s*encodeURIComponent\(([^)]*)\)/g, "location.href = 'r-' + encodeURIComponent($1) + '.html'");
  h = h.replace(/location\.href\s*=\s*'\/r\/([a-z0-9-]+)'/g, "location.href = 'r-$1.html'");
  if (/location\.href\s*=\s*['"]\//.test(h)) throw new Error(`${label}: an absolute script navigation survived rewriting`);
  if (!/<meta name="robots" content="noindex,nofollow">/.test(h)) throw new Error(`${label}: page is missing the noindex meta tag`);
  if (GATE_GUARD) h = h.replace('<head>', '<head>' + GATE_GUARD);
  if (!h.includes('</body>')) throw new Error(`${label}: no </body> to anchor the preview script to`);
  return h.replace('</body>', PREVIEW_SCRIPT + '\n</body>');
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------
function coverPage() {
  const phases = [];
  for (const r of registry) {
    let g = phases.find((p) => p.name === r.phase);
    if (!g) { g = { name: r.phase, rooms: [] }; phases.push(g); }
    g.rooms.push(r);
  }
  const grid = phases.map((p) => `<section><h2>${esc(p.name)}<span>${p.rooms.length}</span></h2><ul>`
    + p.rooms.map((r) => `<li><a href="r-${esc(r.id)}.html"><b>${String(r.num).padStart(2, '0')}</b> ${esc(r.title)}</a></li>`).join('')
    + '</ul></section>').join('');
  const gateForm = GATE_HASH ? `
  <form id="gate" autocomplete="off">
    <label for="gp">Passphrase</label>
    <input id="gp" type="password" autocomplete="current-password" required>
    <button>Open the preview</button>
    <p class="err" id="gerr" hidden>That is not the passphrase for this preview.</p>
  </form>` : '<p class="cta"><a class="btn" href="r-desk.html">Open the preview &rarr;</a></p>';
  const gateScript = GATE_HASH ? `<script>
(function(){
  var f=document.getElementById('gate'),i=document.getElementById('gp'),e=document.getElementById('gerr');
  f.addEventListener('submit',function(ev){
    ev.preventDefault();
    if(!(window.crypto&&crypto.subtle)){e.textContent='Open this preview over https.';e.hidden=false;return;}
    crypto.subtle.digest('SHA-256',new TextEncoder().encode(i.value)).then(function(buf){
      var h=Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      if(h==='${GATE_HASH}'){try{sessionStorage.setItem('chambers-tour',h);}catch(err){}location.href='r-desk.html';}
      else{e.hidden=false;i.value='';i.focus();}
    });
  });
})();
</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Chambers — static preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,600;1,700&family=Public+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
*{box-sizing:border-box}
body{margin:0;background:#0B0E14;color:#E8EBF1;font-family:'Public Sans',system-ui,sans-serif;line-height:1.55}
.wrap{max-width:960px;margin:0 auto;padding:64px 24px 96px}
.rule{height:2px;background:#2C4A7C;width:64px;margin-bottom:26px}
h1{font-family:'Spectral',Georgia,serif;font-style:italic;font-weight:700;font-size:40px;margin:0 0 4px}
.sub{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#6E7886;margin:0 0 30px}
p{max-width:64ch;color:#C3CAD6}
.note{border-left:2px solid #2C4A7C;padding:12px 0 12px 16px;background:rgba(44,74,124,.09);color:#C3CAD6;font-size:14px;max-width:66ch}
.cta{margin:30px 0 8px}
.btn,button{display:inline-block;background:#2C4A7C;border:1px solid #2C4A7C;color:#fff;padding:11px 20px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.13em;text-transform:uppercase;text-decoration:none;cursor:pointer}
.btn:hover,button:hover{filter:brightness(1.15)}
form{margin:28px 0 8px;max-width:320px}
label{display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#6E7886;margin:0 0 6px}
input{width:100%;background:#0B0E14;border:1px solid #273043;color:#E8EBF1;padding:10px;font:inherit;margin-bottom:14px}
input:focus{outline:2px solid #8FB3E6;outline-offset:1px}
.err{color:#E08379;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:26px;margin-top:44px;border-top:1px solid #273043;padding-top:32px}
h2{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#6E7886;margin:0 0 10px;display:flex;justify-content:space-between}
h2 span{color:#3C4658}
ul{list-style:none;margin:0;padding:0}
li{margin:0 0 5px}
li a{color:#E8EBF1;text-decoration:none;font-size:14px;display:block;padding:3px 0;border-bottom:1px solid transparent}
li a:hover{border-bottom-color:#2C4A7C}
li b{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6E7886;margin-right:9px;font-weight:500}
footer{margin-top:44px;border-top:1px solid #273043;padding-top:20px;color:#6E7886;font-size:12px}
</style></head><body>
<div class="wrap">
  <div class="rule"></div>
  <h1>Chambers</h1>
  <p class="sub">Static preview &middot; ${registry.length} rooms</p>
  <p>A rendered walk-through of the practice platform: every room, drawn by the real
     application from a seeded file, then frozen to flat HTML and published here.</p>
  <div class="note"><b>Nothing here is a client record.</b> The matter, the parties,
     the figures and the documents are invented for the demonstration. Forms are
     inert, downloads and calendar feeds are omitted, and the pages are marked
     noindex. The working application is encrypted, provisioned by invitation only,
     and runs on the firm's own server — never on this host.</div>
  ${gateForm}
  <div class="grid">${grid}
    <section><h2>Kernel<span>2</span></h2><ul>
      <li><a href="admin.html"><b>&mdash;</b> Firm administration</a></li>
      <li><a href="account.html"><b>&mdash;</b> Account security</a></li>
    </ul></section>
  </div>
  <footer>Built from the repository on ${esc(today)}. Every push rebuilds this page.</footer>
</div>
${gateScript}
</body></html>`;
}

function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Not part of the preview</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B0E14;color:#E8EBF1;font-family:ui-sans-serif,system-ui,sans-serif;text-align:center;padding:24px}
a{color:#8FB3E6}</style></head><body><div>
<p style="font:10px/1 ui-monospace,monospace;letter-spacing:.24em;color:#6E7886">CHAMBERS &middot; STATIC PREVIEW</p>
<h1 style="font-weight:600;font-size:22px">That page is not part of the preview.</h1>
<p style="color:#C3CAD6">Only the ${registry.length} rooms and the two kernel surfaces are published here.</p>
<p><a href="/index.html">Back to the cover</a></p></div></body></html>`;
}

// ---------------------------------------------------------------------------
// Crawl, write, verify
// ---------------------------------------------------------------------------
const SESSION = auth.createSession(dan.id);

const write = (name, body) => fs.writeFileSync(path.join(OUT, name), body);

(async () => {
  const server = app.listen(0, makeCtx, (err) => { console.error('server error:', err.message); }, '127.0.0.1');
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // ---- enrichment through the product's own routes -------------------------
  // Some records are shaped by the room that owns them — the engagement letter
  // is generated, versioned and marked as it moves draft -> sent -> signed, and
  // only the signing route writes the firm-scope marker Trust & Books reads.
  // Driving those routes is how a lawyer would create them, so the demo carries
  // exactly what the product writes. Deliberately non-fatal: if a form changes,
  // the tour still builds and that room simply shows its own empty state.
  const post = async (url, fields) => {
    const r = await fetch(base + url, {
      method: 'POST',
      headers: { cookie: `s=${SESSION}; m=${m.id}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      redirect: 'manual',
    });
    await r.text();
    if (r.status !== 303) throw new Error(`POST ${url} -> HTTP ${r.status}`);
  };
  try {
    await post('/r/retainer/new', {
      scopeIn: 'Act for A. Beaumont in the claim against Ridgeline Logistics Inc. arising from the collision of 3 November 2025, through trial.',
      scopeOut: 'No appeal, no accident-benefits claim, no property damage subrogation.',
      feeModel: 'contingency', contingencyPct: '33',
    });
    const eng = k.scope(m.id).list('engagement')[0];
    if (!eng) throw new Error('engagement was not written');
    await post('/r/retainer/status', { id: eng.id, to: 'sent', on: today });
    await post('/r/retainer/status', { id: eng.id, to: 'signed', on: today });
    if (!k.firm.list('engagementSigned', (r) => r.matterId === m.id).length) throw new Error('signature left no marker');
  } catch (err) {
    console.warn('  note: retainer walk-through skipped —', err.message);
  }

  const targets = registry.map((r) => ({ url: `/r/${r.id}`, file: `r-${r.id}.html`, label: r.title }))
    .concat([{ url: '/admin', file: 'admin.html', label: 'Firm administration' },
      { url: '/account', file: 'account.html', label: 'Account security' }]);

  const failures = [];
  let rooms = 0;
  for (const t of targets) {
    let body = '';
    try {
      const r = await fetch(base + t.url, { headers: { cookie: `s=${SESSION}; m=${m.id}` }, redirect: 'manual' });
      body = await r.text();
      if (r.status !== 200) { failures.push(`${t.url}: HTTP ${r.status}`); continue; }
      if (!body.includes('class="shell"')) { failures.push(`${t.url}: did not render the app shell`); continue; }
      if (/Internal error|Handler did not respond/i.test(body)) { failures.push(`${t.url}: rendered an error page`); continue; }
      write(t.file, staticize(body, t.url));
      if (t.file.startsWith('r-')) rooms++;
    } catch (e) {
      failures.push(`${t.url}: ${e.message}`);
    }
  }
  server.close();

  write('index.html', coverPage());
  write('404.html', notFoundPage());
  write('robots.txt', 'User-agent: *\nDisallow: /\n');
  // Keeps a build run out of `git status`; the publish dir is an artifact.
  write('.gitignore', '*\n');

  if (failures.length) die('BUILD FAILED — pages did not render:\n  ' + failures.join('\n  '));
  if (rooms !== registry.length) die(`BUILD FAILED — ${rooms} room pages written, registry has ${registry.length}.`);
  for (const r of registry) {
    if (!fs.existsSync(path.join(OUT, `r-${r.id}.html`))) die(`BUILD FAILED — no page for room ${r.id}.`);
  }

  // ---- leak scan: fail the deploy rather than publish something doubtful ----
  const rx = (str) => new RegExp(str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const FORBIDDEN = [
    [/\/invite\//i, 'an invite path'],
    [/localhost/i, 'a localhost URL'],
    [/\b127\.0\.0\.1\b/, 'a loopback URL'],
    [/\/r\/[a-z]+\/feed\/[A-Za-z0-9._~-]{8,}/i, 'a calendar feed token'],
    [/otpauth:\/\//i, 'a TOTP enrolment URI'],
    [/\bs2\$/, 'a password hash'],
    [/\bnonce="/i, 'a CSP nonce'],
    [/\bmethod="post"/i, 'a live POST form'],
    [/\baction="\/[^"]*"/i, 'a live form action'],
    [rx(SESSION), 'the crawler session token'],
    [rx(DATA), 'the temporary data directory path'],
    [rx(`:${port}`), 'the build-time port'],
  ];
  // Literal, reviewed exceptions — deleted from the text BEFORE it is scanned,
  // so each one is narrow and visible here rather than buried in a loose regex.
  const SCAN_ALLOW = [
    // server.js's /admin model-gateway placeholder. A hint that a LOCAL model
    // endpoint is the private option — a fixed string in the source, not data.
    'http://localhost:11434/v1  (local Ollama)',
  ];
  // Anything long and opaque is treated as a secret. Record ids (UUIDs) are the
  // one expected exception: they are stripped out, and what remains has to be
  // both long and varied before it counts — that clears runs of rule dashes and
  // prefixed anchor ids like id="c-<uuid>" without blunting the check.
  const CANDIDATE = /[A-Za-z0-9_-]{28,}/g;
  const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const opaque = (cand) => {
    if (GATE_HASH && cand === GATE_HASH) return false; // published on purpose
    const rest = cand.replace(UUID_ANY, '');
    return rest.length >= 28 && new Set(rest).size >= 10;
  };
  const leaks = [];
  const files = fs.readdirSync(OUT).filter((f) => /\.(html|txt)$/.test(f));
  for (const f of files) {
    let body = fs.readFileSync(path.join(OUT, f), 'utf8');
    for (const allowed of SCAN_ALLOW) body = body.split(allowed).join('');
    for (const [pattern, what] of FORBIDDEN) {
      const hit = body.match(pattern);
      if (hit) leaks.push(`${f}: ${what} (${String(hit[0]).slice(0, 32)})`);
    }
    for (const cand of body.match(CANDIDATE) || []) {
      if (opaque(cand)) leaks.push(`${f}: opaque high-entropy string "${cand.slice(0, 24)}…"`);
    }
  }
  if (leaks.length) {
    fs.rmSync(OUT, { recursive: true, force: true });
    die('BUILD FAILED — leak scan tripped, publish directory deleted:\n  ' + leaks.slice(0, 40).join('\n  '));
  }

  wipeData();
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`tour built: ${rooms}/${registry.length} rooms + admin + account + cover + 404`);
  console.log(`            ${fs.readdirSync(OUT).length} files, ${(bytes / 1024).toFixed(0)} KB, in ${OUT}`);
  console.log(`            forms inert · noindex on every page · robots.txt disallow all · leak scan clean${GATE_HASH ? ' · passphrase gate on' : ''}`);
  process.exit(0);
})().catch((e) => {
  console.error('BUILD FAILED —', e && e.stack ? e.stack : e);
  wipeData();
  process.exit(1);
});
