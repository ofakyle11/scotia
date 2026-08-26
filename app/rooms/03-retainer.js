'use strict';
// Room 03 — Retainer. Engagement records per matter: scope in, scope out,
// fee model, draft->sent->signed with dates. Scope change = new version;
// the prior version is marked superseded, never edited in place.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 3, id: 'retainer', title: 'Retainer', phase: 'Intake' };

const FEE_MODELS = [
  ['hourly', 'Hourly rate'],
  ['flat', 'Flat fee'],
  ['contingency', 'Contingency %'],
];

const CONTINGENCY_NOTE = 'Reference — contingency retainers: caps and written-agreement rules vary by '
  + 'jurisdiction. In Ontario, s. 28.1 of the Solicitors Act, R.S.O. 1990, c. S.15 requires a contingency '
  + 'fee agreement to be in writing, and O. Reg. 563/20 prescribes a mandatory standard form and client '
  + 'disclosure (in force July 1, 2021). Verify the current rules of the governing jurisdiction before sending.';

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function feeSentence(e) {
  if (e.feeModel === 'hourly') {
    return `Our fee is $${fmt(e.rate)} per hour, plus disbursements and applicable taxes, billed monthly.`;
  }
  if (e.feeModel === 'flat') {
    return `Our fee is a flat fee of $${fmt(e.flatAmount)} for the work described in section 1, plus disbursements and applicable taxes.`;
  }
  return `Our fee is ${e.contingencyPct}% of any amount recovered by settlement, judgment, or award, plus `
    + `disbursements and applicable taxes, payable only in the event of recovery. This is a contingency fee `
    + `agreement and must satisfy the written-agreement and disclosure rules of the governing jurisdiction.`;
}

function feeSummary(e) {
  if (e.feeModel === 'hourly') return `${money(e.rate)} <span class="note" style="display:inline">/ hour</span>`;
  if (e.feeModel === 'flat') return `${money(e.flatAmount)} <span class="note" style="display:inline">flat</span>`;
  return `<span class="num">${esc(String(e.contingencyPct))}%</span> <span class="note" style="display:inline">of recovery</span>`;
}

// The engagement letter is generated from the record's fields at creation
// and stored with the version, so what was sent is what stays on file.
function letterText(matter, user, e) {
  const scopeOut = String(e.scopeOut || '').trim();
  return [
    `ENGAGEMENT LETTER — ${matter.title} — version ${e.version}`,
    '',
    e.drafted,
    '',
    matter.client,
    `Re: ${matter.title}`,
    '',
    `Dear ${matter.client}:`,
    '',
    'Thank you for retaining this firm. This letter records the terms of our engagement and, once signed, governs the retainer.',
    '',
    `1. Scope of the engagement. We will act for you in the following: ${e.scopeIn}`,
    '',
    `2. Outside the scope. Our engagement does not include: ${scopeOut || 'no exclusions recorded — work not described in section 1 requires a further engagement in writing'}.`,
    '',
    `3. Fees. ${feeSentence(e)}`,
    '',
    '4. Changes to scope or fees. Any change takes effect only as a new version of this letter signed by you; prior versions are superseded, not amended.',
    '',
    'If these terms are acceptable, please sign and date below and return a copy. This engagement takes effect on the date of your signature.',
    '',
    'Yours truly,',
    '',
    user.name,
    '',
    'Acknowledged and agreed:',
    '',
    '_________________________          Date: ____________',
  ].join('\n');
}

function versionForm(action, cur) {
  const c = cur || {};
  return `<form method="POST" action="${action}">
    ${textarea('scopeIn', 'Scope in — what we will do', { required: true, value: c.scopeIn || '', placeholder: 'e.g. Defend the claim in ONSC file CV-26-00-000; advise on settlement.' })}
    ${textarea('scopeOut', 'Scope out — expressly excluded', { value: c.scopeOut || '', placeholder: 'e.g. Appeals; enforcement; tax advice; regulatory proceedings.' })}
    ${select('feeModel', 'Fee model', FEE_MODELS, c.feeModel || 'hourly')}
    <div class="grid3">
      <span>${input('rate', 'Hourly rate', { type: 'number', value: c.rate || '', placeholder: '450' })}</span>
      <span>${input('flatAmount', 'Flat fee', { type: 'number', value: c.flatAmount || '', placeholder: '7500' })}</span>
      <span>${input('contingencyPct', 'Contingency %', { type: 'number', value: c.contingencyPct || '', placeholder: '30' })}</span>
    </div>
    <button>${cur ? 'Issue new version — supersede current' : 'Draft engagement v1'}</button>
  </form>
  <p class="note">Fill only the fee field matching the chosen model. ${esc(CONTINGENCY_NOTE)}</p>`;
}

function statusTag(s) {
  if (s === 'signed') return tag('signed', 'ok');
  if (s === 'sent') return tag('sent', 'navy');
  if (s === 'superseded') return tag('superseded');
  return tag('draft');
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    let body;
    if (!ctx.matter) {
      body = empty('Open a matter to record its engagement terms.');
    } else {
      const all = k.scope(ctx.matter.id).list('engagement').sort((a, b) => (b.version || 0) - (a.version || 0));
      const cur = all.find((e) => e.status !== 'superseded') || null;
      const next = cur && cur.status === 'draft' ? ['sent', 'Record sent'] : cur && cur.status === 'sent' ? ['signed', 'Record signed'] : null;
      body = `
      <div class="grid2">
        <div class="card">
          <h2 class="sec" style="margin-top:0">Current engagement — ${esc(ctx.matter.title)}</h2>
          ${cur ? `
          ${kv([
            ['Version', `<span class="num">v${esc(String(cur.version))}</span> ${statusTag(cur.status)}`],
            ['Scope in', esc(cur.scopeIn)],
            ['Scope out', esc(cur.scopeOut || '') || '—'],
            ['Fee', feeSummary(cur)],
            ['Drafted', date(cur.drafted)],
            ['Sent', cur.sentAt ? date(cur.sentAt) : '—'],
            ['Signed', cur.signedAt ? date(cur.signedAt) : '—'],
          ])}
          ${next ? `<form method="POST" action="/r/${ROOM.id}/status">
            <input type="hidden" name="id" value="${esc(cur.id)}"><input type="hidden" name="to" value="${next[0]}">
            ${input('on', `Date ${next[0]}`, { type: 'date', value: today() })}
            <button>${next[1]}</button>
          </form>` : '<p class="note">Signed and in force. A scope change issues a new version below.</p>'}
          ` : empty('No engagement yet — draft version 1 on the right.')}
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">${cur ? 'Scope change — new version' : 'Draft the engagement'}</h2>
          ${versionForm(`/r/${ROOM.id}/new`, cur)}
        </div>
      </div>
      ${cur ? `
      <h2 class="sec">Engagement letter — v${esc(String(cur.version))} <span class="tag">generated from the record</span></h2>
      <div class="card"><pre style="white-space:pre-wrap;font-family:var(--f-mono);font-size:12px;line-height:1.7;margin:0">${esc(cur.letter || '')}</pre></div>
      ` : ''}
      <h2 class="sec">Versions</h2>
      ${table(['Version', 'Drafted', 'Scope in', 'Fee', 'Status', 'Sent', 'Signed', 'Superseded'],
        all.map((e) => [
          `<span class="num">v${esc(String(e.version))}</span>`, date(e.drafted), esc(e.scopeIn), feeSummary(e),
          statusTag(e.status), e.sentAt ? date(e.sentAt) : '—', e.signedAt ? date(e.signedAt) : '—',
          e.supersededAt ? `${date(e.supersededAt)} <span class="note" style="display:inline">by v${esc(String(e.supersededBy))}</span>` : '—',
        ])) || empty('No versions yet — draft v1 above.')}
      `;
    }
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Scope in, scope out, fee terms — versioned, never edited', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const scopeIn = String(ctx.body.scopeIn || '').trim();
    const feeModel = FEE_MODELS.some(([v]) => v === ctx.body.feeModel) ? ctx.body.feeModel : null;
    if (!scopeIn || !feeModel) { ctx.setFlash('Scope in and a fee model are required.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const rate = Number(ctx.body.rate), flatAmount = Number(ctx.body.flatAmount), pct = Number(ctx.body.contingencyPct);
    if (feeModel === 'hourly' && !(Number.isFinite(rate) && rate > 0)) { ctx.setFlash('Hourly model needs a positive hourly rate.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    if (feeModel === 'flat' && !(Number.isFinite(flatAmount) && flatAmount > 0)) { ctx.setFlash('Flat model needs a positive flat fee.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    if (feeModel === 'contingency' && !(Number.isFinite(pct) && pct > 0 && pct <= 100)) { ctx.setFlash('Contingency model needs a percentage between 0 and 100.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const sc = k.scope(ctx.matter.id);
    const all = sc.list('engagement');
    const version = all.reduce((m, e) => Math.max(m, e.version || 0), 0) + 1;
    const e = {
      version, scopeIn, scopeOut: String(ctx.body.scopeOut || '').trim(), feeModel,
      rate: feeModel === 'hourly' ? rate : null,
      flatAmount: feeModel === 'flat' ? flatAmount : null,
      contingencyPct: feeModel === 'contingency' ? pct : null,
      status: 'draft', drafted: today(), sentAt: null, signedAt: null, supersededAt: null, supersededBy: null,
    };
    e.letter = letterText(ctx.matter, ctx.user, e);
    sc.put('engagement', e);
    // Prior versions: content untouched, only marked superseded.
    for (const prior of all.filter((p) => p.status !== 'superseded')) {
      sc.put('engagement', { ...prior, status: 'superseded', supersededAt: today(), supersededBy: version });
    }
    k.audit('engagement.version', ctx.matter.id + ':v' + version);
    ctx.setFlash(`Engagement v${version} drafted${all.length ? ' — prior version marked superseded' : ''}. Letter generated from the record.`);
    redirect(res, `/r/${ROOM.id}`);
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const sc = k.scope(ctx.matter.id);
    const e = ctx.body.id ? sc.get('engagement', ctx.body.id) : null;
    if (!e) { ctx.setFlash('No such engagement version.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const onRaw = String(ctx.body.on || '');
    const on = /^\d{4}-\d{2}-\d{2}$/.test(onRaw) && !Number.isNaN(Date.parse(onRaw)) ? onRaw : today();
    if (ctx.body.to === 'sent' && e.status === 'draft') {
      sc.put('engagement', { ...e, status: 'sent', sentAt: on });
      ctx.setFlash(`Engagement v${e.version} recorded as sent ${on}.`);
    } else if (ctx.body.to === 'signed' && e.status === 'sent') {
      sc.put('engagement', { ...e, status: 'signed', signedAt: on });
      ctx.setFlash(`Engagement v${e.version} recorded as signed ${on} — retainer in force.`);
    } else {
      ctx.setFlash('Invalid status transition — engagements move draft to sent to signed.', 'err');
    }
    redirect(res, `/r/${ROOM.id}`);
  });
}

module.exports = { ...ROOM, register };
