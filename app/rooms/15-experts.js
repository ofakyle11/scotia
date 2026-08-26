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
        ? `<h2 class="sec">Expert files</h2>${experts.map((x) => expertCard(x)).join('')}`
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

function expertCard(x) {
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
  </div>`;
}

function referenceHtml() {
  return `<div class="grid2">
    ${REGIMES.map((rg) => `<div>
      <h2 class="sec" style="margin-top:0">${esc(rg.label)}</h2>
      ${table(['Item', 'Authority'], CHECKLIST.filter((c) => c.regime === rg.id).map((c) => [esc(c.label), `<span class="note" style="margin:0">${esc(c.cite)}</span>`]))}
    </div>`).join('')}
  </div>
  <p class="note">Reference tranche only: the prongs above track FRE 702(b)–(d) as construed in Daubert, and the Mohan criteria with the White Burgess duty threshold. Ticking an item on an expert file records that the work is done — it is not a ruling.</p>`;
}

module.exports = { ...ROOM, register };
