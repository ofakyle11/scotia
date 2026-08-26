'use strict';
// Room 15 — Experts. The expert file per matter: identify, retain, serve the
// report, survive the challenge. Report due dates land on the Trial Calendar.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 15, id: 'experts', title: 'Experts', phase: 'Discover' };

const SIDES = [['ours', 'Ours'], ['theirs', 'Theirs']];
const RATE_TYPES = [['hourly', 'Hourly'], ['daily', 'Daily']];
// Pipeline: identified -> retained -> report served -> challenged -> qualified | excluded
const ADVANCE = { identified: 'retained', retained: 'report served' };
const OUTCOMES = ['qualified', 'excluded'];

// Reference data — admissibility prongs by regime. Real citations, clearly
// scoped as a reference checklist; ticking a box records work, not a ruling.
const REGIMES = [
  { id: 'daubert', label: 'Daubert / FRE 702 (US federal)' },
  { id: 'mohan', label: 'Mohan / White Burgess (Canada)' },
];
const CHECKLIST = [
  { id: 'fre_facts', regime: 'daubert', label: 'Based on sufficient facts or data', cite: 'Fed. R. Evid. 702(b)' },
  { id: 'fre_principles', regime: 'daubert', label: 'Product of reliable principles and methods', cite: 'Fed. R. Evid. 702(c); Daubert v. Merrell Dow Pharms., Inc., 509 U.S. 579 (1993)' },
  { id: 'fre_application', regime: 'daubert', label: 'Reliable application of the principles and methods to the facts', cite: 'Fed. R. Evid. 702(d)' },
  { id: 'mohan_relevance', regime: 'mohan', label: 'Relevance', cite: 'R. v. Mohan, [1994] 2 S.C.R. 9' },
  { id: 'mohan_necessity', regime: 'mohan', label: 'Necessity in assisting the trier of fact', cite: 'R. v. Mohan, [1994] 2 S.C.R. 9' },
  { id: 'mohan_noexcl', regime: 'mohan', label: 'Absence of any other exclusionary rule', cite: 'R. v. Mohan, [1994] 2 S.C.R. 9' },
  { id: 'mohan_qualified', regime: 'mohan', label: 'A properly qualified expert', cite: 'R. v. Mohan, [1994] 2 S.C.R. 9' },
  { id: 'wb_duty', regime: 'mohan', label: 'Duty to the court — fair, objective and non-partisan', cite: 'White Burgess Langille Inman v. Abbott and Haliburton Co., 2015 SCC 23' },
];

// Reference data — FRCP 26(a)(2)(B) written-report contents. Real rule text,
// clearly scoped as a reference checklist; ticking a box records that the
// draft report covers the item, not that it is sufficient.
const REPORT26 = [
  { id: 'r_opinions', label: 'Complete statement of all opinions and the basis and reasons for them', cite: 'Fed. R. Civ. P. 26(a)(2)(B)(i)' },
  { id: 'r_facts', label: 'The facts or data considered in forming the opinions', cite: 'Fed. R. Civ. P. 26(a)(2)(B)(ii)' },
  { id: 'r_exhibits', label: 'Any exhibits used to summarize or support the opinions', cite: 'Fed. R. Civ. P. 26(a)(2)(B)(iii)' },
  { id: 'r_quals', label: 'Qualifications, including publications authored in the previous 10 years', cite: 'Fed. R. Civ. P. 26(a)(2)(B)(iv)' },
  { id: 'r_cases', label: 'List of cases testified in (trial or deposition) in the previous 4 years', cite: 'Fed. R. Civ. P. 26(a)(2)(B)(v)' },
  { id: 'r_comp', label: 'Statement of the compensation for the study and testimony', cite: 'Fed. R. Civ. P. 26(a)(2)(B)(vi)' },
];

// Reference data — real expert-disclosure timing rules. The record written per
// expert is a plain 'deadline' {desc,due,rule,trigger,status}; counsel enters
// the date and confirms it against the court's scheduling/case-management order.
const DISCLOSURE_RULES = [
  { id: 'on_5303_1', label: "Ontario — expert's report served", cite: 'Rules of Civil Procedure (Ont.), r. 53.03(1) — not less than 90 days before pre-trial conference' },
  { id: 'on_5303_2', label: 'Ontario — responding report served', cite: 'Rules of Civil Procedure (Ont.), r. 53.03(2) — not less than 60 days before pre-trial conference' },
  { id: 'frcp_26d_i', label: 'US federal — expert disclosure', cite: 'Fed. R. Civ. P. 26(a)(2)(D)(i) — at least 90 days before trial' },
  { id: 'frcp_26d_ii', label: 'US federal — rebuttal disclosure', cite: "Fed. R. Civ. P. 26(a)(2)(D)(ii) — within 30 days of the other party's disclosure" },
];
function defaultDiscRule(matter) {
  const j = matter && matter.jurisdiction;
  if (j && String(j).startsWith('us')) return 'frcp_26d_i';
  return 'on_5303_1';
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    let body;
    if (!ctx.matter) {
      body = `${empty('Open a matter to build its expert file.')}
      <h2 class="sec">Qualification reference</h2>
      <div class="card">${referenceHtml()}</div>`;
    } else {
      const experts = k.scope(ctx.matter.id).list('expert')
        .sort((a, b) => (a.side || '').localeCompare(b.side || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
      const ours = experts.filter((x) => x.side !== 'theirs');
      const theirs = experts.filter((x) => x.side === 'theirs');
      body = `
      <div class="grid2">
        <div class="card">
          <h2 class="sec" style="margin-top:0">Roster — ${esc(ctx.matter.title)}</h2>
          ${experts.length ? table(['Expert', 'Discipline', 'Side', 'Rate', 'Status', 'Report due', 'Checklist'],
            experts.map((x) => [
              esc(x.name), esc(x.discipline || '—'),
              x.side === 'theirs' ? tag('theirs') : tag('ours', 'navy'),
              x.rate ? `${money(x.rate)}<span class="note" style="display:inline"> / ${x.rateType === 'daily' ? 'day' : 'hr'}</span>` : '—',
              statusTag(x.status), x.reportDue ? date(x.reportDue) : '—',
              `<span class="num">${checkCount(x)}/${CHECKLIST.length}</span>`,
            ])) : empty('No experts on this matter yet — open the first expert file with the form.')}
          <p class="note">Ours: ${ours.length} · Theirs: ${theirs.length}. The checklist column counts reference items ticked across both regimes.</p>
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">Add expert</h2>
          <form method="POST" action="/r/experts/new">
            <div class="grid2">
              <span>${input('name', 'Name', { required: true })}</span>
              <span>${input('discipline', 'Discipline', { placeholder: 'Forensic accounting, biomechanics…' })}</span>
              <span>${select('side', 'Side', SIDES, 'ours')}</span>
              <span>${input('reportDue', 'Report due', { type: 'date' })}</span>
              <span>${select('rateType', 'Rate basis', RATE_TYPES, 'hourly')}</span>
              <span>${input('rate', 'Rate', { type: 'number', placeholder: '450' })}</span>
            </div>
            ${textarea('scope', 'Scope of retainer / opinion sought', { placeholder: 'Questions the expert is asked to answer — nothing broader.' })}
            <button>Open expert file</button>
          </form>
          <p class="note">A report due date is also inserted as a deadline record, so the Trial Calendar (room 21) sees it.</p>
        </div>
      </div>
      ${experts.length
        ? `<h2 class="sec">Expert files</h2>${experts.map((x) => expertCard(x, ctx.matter)).join('')}`
        : `<h2 class="sec">Qualification reference</h2><div class="card">${referenceHtml()}</div>`}`;
    }
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Retain, serve, survive the challenge', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/experts'); return; }
    const name = String(ctx.body.name || '').trim();
    if (!name) { ctx.setFlash('Expert name is required.', 'err'); redirect(res, '/r/experts'); return; }
    const sc = ctx.kernel.scope(ctx.matter.id);
    const side = ctx.body.side === 'theirs' ? 'theirs' : 'ours';
    const rate = Number(ctx.body.rate);
    const reportDue = validDate(ctx.body.reportDue);
    let deadlineId = null;
    if (reportDue) {
      deadlineId = sc.put('deadline', {
        desc: `Expert report due — ${name}`, due: reportDue, rule: 'expert report',
        trigger: `Expert file opened (${side})`, status: 'open',
      }).id;
    }
    sc.put('expert', {
      name, discipline: String(ctx.body.discipline || '').trim(), side,
      rateType: ctx.body.rateType === 'daily' ? 'daily' : 'hourly',
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      reportDue, deadlineId, scope: String(ctx.body.scope || '').trim(),
      status: 'identified', checklist: {}, challenge: null,
    });
    ctx.setFlash(`Expert file opened for ${name}` + (reportDue ? ` — report due ${reportDue}, posted to the Trial Calendar.` : '.'));
    redirect(res, '/r/experts');
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    const to = ADVANCE[x.status];
    if (!to || ctx.body.to !== to) { ctx.setFlash('That expert cannot advance from its current stage.', 'err'); redirect(res, '/r/experts'); return; }
    ctx.kernel.scope(ctx.matter.id).put('expert', { ...x, status: to });
    ctx.setFlash(`${x.name}: ${to}.`);
    redirect(res, '/r/experts');
  });

  app.route('POST', `/r/${ROOM.id}/check`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    const checklist = {};
    for (const c of CHECKLIST) if (ctx.body['ck_' + c.id]) checklist[c.id] = true;
    ctx.kernel.scope(ctx.matter.id).put('expert', { ...x, checklist });
    ctx.setFlash(`Checklist saved for ${x.name} — ${Object.keys(checklist).length}/${CHECKLIST.length} items.`);
    redirect(res, '/r/experts');
  });

  app.route('POST', `/r/${ROOM.id}/challenge`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    if (OUTCOMES.includes(x.status)) { ctx.setFlash('Qualification has already been ruled on.', 'err'); redirect(res, '/r/experts'); return; }
    const by = ctx.body.by === 'theirs' ? 'theirs' : 'ours';
    ctx.kernel.scope(ctx.matter.id).put('expert', {
      ...x, status: 'challenged',
      challenge: { by, ground: String(ctx.body.ground || '').trim(), outcome: null },
    });
    ctx.setFlash(`Challenge recorded — brought by ${by === 'ours' ? 'us' : 'the other side'}.`);
    redirect(res, '/r/experts');
  });

  app.route('POST', `/r/${ROOM.id}/outcome`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    const outcome = ctx.body.outcome;
    if (!OUTCOMES.includes(outcome)) { ctx.setFlash('Outcome must be qualified or excluded.', 'err'); redirect(res, '/r/experts'); return; }
    if (x.status !== 'challenged') { ctx.setFlash('Record the challenge before its outcome.', 'err'); redirect(res, '/r/experts'); return; }
    ctx.kernel.scope(ctx.matter.id).put('expert', {
      ...x, status: outcome, challenge: { ...(x.challenge || { by: null, ground: '' }), outcome },
    });
    ctx.setFlash(`${x.name}: ${outcome}.`);
    redirect(res, '/r/experts');
  });

  app.route('POST', `/r/${ROOM.id}/due`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    const due = validDate(ctx.body.reportDue);
    if (!due) { ctx.setFlash('Enter a valid report due date.', 'err'); redirect(res, '/r/experts'); return; }
    const sc = ctx.kernel.scope(ctx.matter.id);
    let deadlineId = x.deadlineId || null;
    const existing = deadlineId ? sc.get('deadline', deadlineId) : null;
    if (existing) sc.put('deadline', { ...existing, due });
    else {
      deadlineId = sc.put('deadline', {
        desc: `Expert report due — ${x.name}`, due, rule: 'expert report',
        trigger: `Report date set (${x.side})`, status: 'open',
      }).id;
    }
    sc.put('expert', { ...x, reportDue: due, deadlineId });
    ctx.setFlash(`Report due ${due} — posted to the Trial Calendar.`);
    redirect(res, '/r/experts');
  });

  // Ontario Form 53 — Acknowledgment of Expert's Duty. Records the signed
  // acknowledgment and any independence disclosure on the expert file.
  app.route('POST', `/r/${ROOM.id}/form53`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    const acknowledged = ctx.body.acknowledged === '1' || ctx.body.acknowledged === 'on';
    if (!acknowledged) { ctx.setFlash("Tick the acknowledgment box to record Form 53.", 'err'); redirect(res, '/r/experts'); return; }
    const party = String(ctx.body.party || '').trim() || (ctx.matter.client || '');
    if (!party) { ctx.setFlash('Name the party engaging the expert.', 'err'); redirect(res, '/r/experts'); return; }
    const signedDate = validDate(ctx.body.signedDate);
    const independence = String(ctx.body.independence || '').trim();
    ctx.kernel.scope(ctx.matter.id).put('expert', {
      ...x, form53: { party, signedDate, acknowledged: true, independence, recordedAt: new Date().toISOString() },
    });
    ctx.kernel.audit('experts.form53', ctx.matter.id + ':' + x.id);
    ctx.setFlash(`Form 53 acknowledgment recorded for ${x.name}.`);
    redirect(res, '/r/experts');
  });

  // FRCP 26(a)(2)(B) written-report contents checklist.
  app.route('POST', `/r/${ROOM.id}/report`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    const report26 = {};
    for (const c of REPORT26) if (ctx.body['rc_' + c.id]) report26[c.id] = true;
    ctx.kernel.scope(ctx.matter.id).put('expert', { ...x, report26 });
    ctx.setFlash(`Report-contents checklist saved for ${x.name} — ${Object.keys(report26).length}/${REPORT26.length} items.`);
    redirect(res, '/r/experts');
  });

  // Expert-disclosure deadline — a 'deadline' record the Trial Calendar reads.
  app.route('POST', `/r/${ROOM.id}/disclosure`, (req, res, ctx) => {
    const x = loadExpert(ctx);
    if (!x) { redirect(res, '/r/experts'); return; }
    const due = validDate(ctx.body.due);
    if (!due) { ctx.setFlash('Enter a valid disclosure deadline date.', 'err'); redirect(res, '/r/experts'); return; }
    const ruleObj = DISCLOSURE_RULES.find((r) => r.id === ctx.body.rule) || DISCLOSURE_RULES[0];
    const sc = ctx.kernel.scope(ctx.matter.id);
    let disclosureDeadlineId = x.disclosureDeadlineId || null;
    const existing = disclosureDeadlineId ? sc.get('deadline', disclosureDeadlineId) : null;
    const trigger = `Expert disclosure (${x.side}) — ${ruleObj.label}`;
    if (existing) sc.put('deadline', { ...existing, due, rule: ruleObj.cite, trigger, status: 'open' });
    else {
      disclosureDeadlineId = sc.put('deadline', {
        desc: `Expert disclosure served — ${x.name}`, due, rule: ruleObj.cite, trigger, status: 'open',
      }).id;
    }
    sc.put('expert', { ...x, disclosureDeadlineId, disclosureRule: ruleObj.id });
    ctx.kernel.audit('experts.disclosure', ctx.matter.id + ':' + x.id + ':' + due);
    ctx.setFlash(`Disclosure deadline ${due} — posted to the Trial Calendar (${ruleObj.cite}).`);
    redirect(res, '/r/experts');
  });

  // Download the Form 53 acknowledgment as a working draft. Sets Content-Type
  // and Content-Disposition; a null matter or bad id flashes and returns.
  app.route('GET', `/r/${ROOM.id}/form53/download`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/experts'); return; }
    const id = ctx.query.get('id');
    const x = id ? ctx.kernel.scope(ctx.matter.id).get('expert', id) : null;
    if (!x) { ctx.setFlash('Expert not found on this matter.', 'err'); redirect(res, '/r/experts'); return; }
    ctx.kernel.audit('experts.form53.download', ctx.matter.id + ':' + x.id);
    const slug = String(x.name || 'expert').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'expert';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="form-53-acknowledgment-${slug}.txt"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(form53Text(x, ctx.matter));
  });
}

// Guarded load: never throws on a null matter or an empty/garbage body.
function loadExpert(ctx) {
  if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); return null; }
  const id = ctx.body.id;
  if (!id) { ctx.setFlash('No expert selected.', 'err'); return null; }
  const x = ctx.kernel.scope(ctx.matter.id).get('expert', id);
  if (!x) { ctx.setFlash('Expert not found on this matter.', 'err'); return null; }
  return x;
}

function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null;
}

function checkCount(x) {
  const done = x.checklist || {};
  return CHECKLIST.filter((c) => done[c.id]).length;
}

function reportCount(x) {
  const done = x.report26 || {};
  return REPORT26.filter((c) => done[c.id]).length;
}

// Working draft of Ontario Form 53. Real form text (O. Reg. under the Rules of
// Civil Procedure), clearly labelled as a draft to verify before signing.
function form53Text(x, matter) {
  const party = (x.form53 && x.form53.party) || (matter && matter.client) || '__________';
  const L = [];
  L.push("FORM 53 — ACKNOWLEDGMENT OF EXPERT'S DUTY");
  L.push('(Ontario Rules of Civil Procedure, Form 53; see rr. 4.1.01 and 53.03(2.1))');
  L.push('');
  L.push('Court proceeding: ' + ((matter && matter.title) || '__________'));
  L.push('');
  L.push('1. My name is ' + (x.name || '__________') + '. I live at __________ (municipality), in the');
  L.push('   __________ of __________.');
  L.push('');
  L.push('2. I have been engaged by or on behalf of ' + party + ' to provide evidence in');
  L.push('   relation to the above-noted court proceeding.');
  L.push('');
  L.push('3. I acknowledge that it is my duty to provide evidence in relation to this');
  L.push('   proceeding as follows:');
  L.push('   (a) to provide opinion evidence that is fair, objective and non-partisan;');
  L.push('   (b) to provide opinion evidence that is related only to matters that are');
  L.push('       within my area of expertise; and');
  L.push('   (c) to provide such additional assistance as the court may reasonably require');
  L.push('       to determine a matter in issue.');
  L.push('');
  L.push('4. I acknowledge that the duty referred to above prevails over any obligation');
  L.push('   which I may owe to any party by whom or on whose behalf I am engaged.');
  L.push('');
  L.push('Date: ' + ((x.form53 && x.form53.signedDate) || '__________') + '      Signature: __________________________');
  L.push('');
  if (x.form53 && x.form53.independence) {
    L.push('Independence — connections to a party disclosed by the expert:');
    L.push(x.form53.independence);
    L.push('');
  }
  L.push("NOTE: This acknowledgment must be attached to the expert's report (r. 53.03(2.1)).");
  L.push('');
  L.push('--- Generated by Chambers as a WORKING DRAFT of Form 53. Verify against the current');
  L.push('    prescribed form before signing or serving. Reference text, not legal advice. ---');
  return L.join('\n') + '\n';
}

function statusTag(s) {
  if (s === 'qualified') return tag('qualified', 'ok');
  if (s === 'excluded') return tag('excluded', 'gate');
  if (s === 'challenged') return tag('challenged', 'gate');
  if (s === 'retained' || s === 'report served') return tag(s, 'navy');
  return tag(s || 'identified');
}

function challengeLine(x) {
  if (!x.challenge) return '—';
  const who = x.challenge.by === 'ours' ? 'brought by us' : 'brought by the other side';
  const ground = x.challenge.ground ? ` — ${esc(x.challenge.ground)}` : '';
  const out = x.challenge.outcome ? ` ${tag(x.challenge.outcome, x.challenge.outcome === 'excluded' ? 'gate' : 'ok')}` : ` ${tag('pending')}`;
  return `${esc(who)}${ground}${out}`;
}

function checkboxRow(c, done) {
  return `<label style="display:flex;gap:8px;align-items:baseline;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13px;color:var(--ink-soft);margin:6px 0 0">
    <input type="checkbox" name="ck_${c.id}" value="1" ${done[c.id] ? 'checked' : ''} style="width:auto;margin:0">
    <span>${esc(c.label)} <span class="note" style="display:inline;margin:0">${esc(c.cite)}</span></span>
  </label>`;
}

function reportRow(c, done) {
  return `<label style="display:flex;gap:8px;align-items:baseline;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13px;color:var(--ink-soft);margin:6px 0 0">
    <input type="checkbox" name="rc_${c.id}" value="1" ${done[c.id] ? 'checked' : ''} style="width:auto;margin:0">
    <span>${esc(c.label)} <span class="note" style="display:inline;margin:0">${esc(c.cite)}</span></span>
  </label>`;
}

// Disclosure & independence instruments: Form 53 acknowledgment, the FRCP
// 26(a)(2)(B) report-contents checklist, and the disclosure-deadline poster.
function disclosureBlock(x, matter) {
  const f = x.form53 || null;
  const rdone = x.report26 || {};
  const discSel = x.disclosureRule || defaultDiscRule(matter);
  const form53Status = f && f.acknowledged
    ? `${tag('Form 53 signed', 'ok')} <span class="note" style="display:inline;margin:0">${f.signedDate ? esc(f.signedDate) + ' · ' : ''}engaged by ${esc(f.party || '—')}</span> · <a href="/r/experts/form53/download?id=${encodeURIComponent(x.id)}">download draft</a>`
    : `${tag('Form 53 not on file', 'gate')} <span class="note" style="display:inline;margin:0">Rule 53.03(2.1) requires the acknowledgment attached to the report.</span>`;
  return `<div style="border-top:1px solid var(--rule-soft);margin-top:12px;padding-top:12px">
    <span class="tag navy">Disclosure &amp; independence</span>
    <div style="margin:8px 0 4px">${form53Status}</div>
    ${f && f.independence ? `<p class="note" style="margin:2px 0 0">Independence disclosed: ${esc(f.independence)}</p>` : ''}
    <div class="grid2" style="margin-top:10px">
      <form method="POST" action="/r/experts/form53">
        <input type="hidden" name="id" value="${esc(x.id)}">
        <span class="tag">Ontario Form 53 — Acknowledgment of Expert's Duty</span>
        ${input('party', 'Engaged by (party)', { value: (f && f.party) || (matter && matter.client) || '' })}
        ${input('signedDate', 'Date acknowledged', { type: 'date', value: (f && f.signedDate) || '' })}
        ${textarea('independence', 'Independence — connections to a party disclosed', { value: (f && f.independence) || '', placeholder: 'Prior retainers, relationships, financial interest — or "none disclosed".' })}
        <label style="display:flex;gap:8px;align-items:baseline;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13px;color:var(--ink-soft);margin:10px 0 0">
          <input type="checkbox" name="acknowledged" value="1" ${f && f.acknowledged ? 'checked' : ''} style="width:auto;margin:0">
          <span>Expert has signed the fair, objective and non-partisan duty (rr. 4.1.01, 53.03).</span>
        </label>
        <button class="quiet" style="margin-top:12px">Record Form 53</button>
      </form>
      <div>
        <form method="POST" action="/r/experts/report">
          <input type="hidden" name="id" value="${esc(x.id)}">
          <span class="tag">Written report contents — FRCP 26(a)(2)(B)</span>
          ${REPORT26.map((c) => reportRow(c, rdone)).join('')}
          <button class="quiet" style="margin-top:12px">Save report checklist (${reportCount(x)}/${REPORT26.length})</button>
        </form>
        <form method="POST" action="/r/experts/disclosure" style="margin-top:12px">
          <input type="hidden" name="id" value="${esc(x.id)}">
          ${select('rule', 'Disclosure rule', DISCLOSURE_RULES.map((r) => [r.id, r.cite]), discSel)}
          ${input('due', x.disclosureDeadlineId ? 'Move disclosure deadline' : 'Set disclosure deadline', { type: 'date' })}
          <button class="quiet" style="margin-top:12px">Post disclosure deadline</button>
        </form>
        ${x.disclosureDeadlineId ? `<p class="note" style="margin:8px 0 0">A disclosure deadline is on the Trial Calendar for this expert.</p>` : ''}
      </div>
    </div>
  </div>`;
}

function expertCard(x, matter) {
  const done = x.checklist || {};
  const next = ADVANCE[x.status];
  const ruled = OUTCOMES.includes(x.status);
  return `<div class="card">
    <b>${esc(x.name)}</b> · ${esc(x.discipline || 'discipline unstated')}
    ${x.side === 'theirs' ? tag('their expert') : tag('our expert', 'navy')} ${statusTag(x.status)}
    ${kv([
      ['Rate', x.rate ? `${money(x.rate)} / ${x.rateType === 'daily' ? 'day' : 'hour'}` : '—'],
      ['Report due', x.reportDue ? `${date(x.reportDue)} <span class="note" style="display:inline;margin:0">on the Trial Calendar</span>` : '—'],
      ['Scope', esc(x.scope || '—')],
      ['Challenge', challengeLine(x)],
    ])}
    <form method="POST" action="/r/experts/check">
      <input type="hidden" name="id" value="${esc(x.id)}">
      <div class="grid2">
        ${REGIMES.map((rg) => `<div>
          <span class="tag">${esc(rg.label)}</span>
          ${CHECKLIST.filter((c) => c.regime === rg.id).map((c) => checkboxRow(c, done)).join('')}
        </div>`).join('')}
      </div>
      <button class="quiet" style="margin-top:12px">Save checklist (${checkCount(x)}/${CHECKLIST.length})</button>
    </form>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:4px">
      ${next ? `<form method="POST" action="/r/experts/status"><input type="hidden" name="id" value="${esc(x.id)}"><input type="hidden" name="to" value="${esc(next)}"><button>Mark ${esc(next)}</button></form>` : ''}
      ${ruled ? '' : `<form method="POST" action="/r/experts/challenge" style="display:flex;gap:8px;align-items:flex-end">
        <input type="hidden" name="id" value="${esc(x.id)}">
        <span style="min-width:130px">${select('by', 'Challenge by', [['ours', 'Us'], ['theirs', 'Other side']], x.side === 'theirs' ? 'ours' : 'theirs')}</span>
        <span style="min-width:220px">${input('ground', 'Ground', { placeholder: 'Methodology; independence; necessity…' })}</span>
        <button class="danger">Record challenge</button>
      </form>`}
      ${x.status === 'challenged' ? `<form method="POST" action="/r/experts/outcome" style="display:flex;gap:8px;align-items:flex-end">
        <input type="hidden" name="id" value="${esc(x.id)}">
        <span style="min-width:130px">${select('outcome', 'Ruling', OUTCOMES, 'qualified')}</span>
        <button>Record ruling</button>
      </form>` : ''}
      ${ruled ? '' : `<form method="POST" action="/r/experts/due" style="display:flex;gap:8px;align-items:flex-end">
        <input type="hidden" name="id" value="${esc(x.id)}">
        <span style="min-width:150px">${input('reportDue', x.reportDue ? 'Move report due' : 'Set report due', { type: 'date' })}</span>
        <button class="quiet" style="margin-top:0;padding:8px 12px">Post deadline</button>
      </form>`}
    </div>
    ${disclosureBlock(x, matter)}
  </div>`;
}

function referenceHtml() {
  return `<div class="grid2">
    ${REGIMES.map((rg) => `<div>
      <h2 class="sec" style="margin-top:0">${esc(rg.label)}</h2>
      ${table(['Item', 'Authority'], CHECKLIST.filter((c) => c.regime === rg.id).map((c) => [esc(c.label), `<span class="note" style="margin:0">${esc(c.cite)}</span>`]))}
    </div>`).join('')}
  </div>
  <p class="note">Reference tranche only: the prongs above track FRE 702(b)–(d) as construed in Daubert, and the Mohan criteria with the White Burgess duty threshold. Ticking an item on an expert file records that the work is done — it is not a ruling.</p>
  <div class="grid2" style="margin-top:16px">
    <div>
      <h2 class="sec" style="margin-top:0">Written report contents — FRCP 26(a)(2)(B)</h2>
      ${table(['Required content', 'Authority'], REPORT26.map((c) => [esc(c.label), `<span class="note" style="margin:0">${esc(c.cite)}</span>`]))}
    </div>
    <div>
      <h2 class="sec" style="margin-top:0">Ontario Form 53 — Acknowledgment of Expert's Duty</h2>
      ${table(['Disclosure instrument', 'Authority'], [
        ['Expert acknowledges a fair, objective and non-partisan duty to the court', '<span class="note" style="margin:0">Rules of Civil Procedure (Ont.), Form 53; rr. 4.1.01, 53.03(2.1)</span>'],
        ['That duty prevails over any obligation to the engaging party', '<span class="note" style="margin:0">Form 53, para. 4</span>'],
        ['Acknowledgment attached to the served report', '<span class="note" style="margin:0">r. 53.03(2.1)</span>'],
      ])}
      <h2 class="sec">Disclosure timing (case-management order controls)</h2>
      ${table(['Rule', 'Reference'], DISCLOSURE_RULES.map((r) => [esc(r.label), `<span class="note" style="margin:0">${esc(r.cite)}</span>`]))}
    </div>
  </div>
  <p class="note">Real reference text, clearly scoped. Form 53 renders here as a working draft to verify against the current prescribed form; disclosure dates are confirmed against the court's scheduling/case-management order.</p>`;
}

module.exports = { ...ROOM, register };
