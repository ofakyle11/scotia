'use strict';
// Room 04 — Case Value. The money, before the case: outcome modelling, honestly
// banded. Recovery is always a range — a point estimate on a case value is a
// number somebody will quote back to you in a deposition.
const { layout, esc, table, empty, tag, kv, input, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 4, id: 'value', title: 'Case Value', phase: 'Intake' };

// null = absent, NaN = present but not a number, otherwise a finite number.
const parseNum = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const amt = (n) => n < 0
  ? `<span class="num">−$${Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`
  : money(n);
const band = (lo, hi) => `${amt(lo)} – ${amt(hi)}`;

// All arithmetic on counsel's own inputs — no invented comparables.
function model(s) {
  const L = (s.liability || 0) / 100;
  const spent = s.costsToDate || 0;
  const total = spent + (s.budget || 0);
  const gross = [s.dLow, s.dLikely, s.dHigh].map((d) => d * L);   // P-low / P-mid / P-high
  const tryNet = gross.map((g) => g - total);
  const contNet = s.contingency == null ? null : gross.map((g) => g * (1 - s.contingency / 100));
  const settleNet = s.offer == null ? null : s.offer - spent;
  return { gross, tryNet, contNet, settleNet, spent, total };
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    let body;
    if (!ctx.matter) {
      body = empty('Open a matter to model its value.');
    } else {
      const scenarios = ctx.kernel.scope(ctx.matter.id).list('scenario')
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      body = `
      <div class="grid2">
        <div class="card">
          <h2 class="sec" style="margin-top:0">New scenario — ${esc(ctx.matter.title)}</h2>
          <form method="POST" action="/r/value/new">
            ${input('name', 'Scenario name', { placeholder: 'e.g. Liability contested, conservative damages' })}
            <div class="grid3">
              <span>${input('dLow', 'Damages — low', { type: 'number', required: true, placeholder: '50000' })}</span>
              <span>${input('dLikely', 'Damages — likely', { type: 'number', required: true, placeholder: '120000' })}</span>
              <span>${input('dHigh', 'Damages — high', { type: 'number', required: true, placeholder: '300000' })}</span>
            </div>
            ${input('liability', 'Liability (%)', { type: 'number', required: true, placeholder: '70' })}
            <div class="grid2">
              <span>${input('costsToDate', 'Costs to date', { type: 'number', placeholder: '15000' })}</span>
              <span>${input('budget', 'Further budget to trial', { type: 'number', placeholder: '85000' })}</span>
            </div>
            <div class="grid2">
              <span>${input('contingency', 'Contingency % (blank if hourly)', { type: 'number', placeholder: '33' })}</span>
              <span>${input('offer', 'Offer on the table (optional)', { type: 'number', placeholder: '90000' })}</span>
            </div>
            <button>Model it</button>
          </form>
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">How the bands are built</h2>
          ${kv([
            ['Expected recovery', 'damages band × liability % — P-low / P-mid / P-high'],
            ['Try (net)', 'each band − costs to date − budget to trial'],
            ['Settle (net)', 'offer on the table − costs to date'],
            ['Contingency', 'each band × (100% − fee) — disbursements and liens come out in Settlement Waterfall (24)'],
          ])}
          <p class="note">Comparable verdict &amp; settlement data (claim type × venue) wires in here — Build Sheet Gap 5; until it lands, bands are computed from counsel&rsquo;s own inputs only. Offer-to-settle cost consequences (e.g. Ont. R. 49.10) are not modelled here — run them in Mediation &amp; ADR (23).</p>
        </div>
      </div>
      <h2 class="sec">Scenarios</h2>
      ${scenarios.length ? scenarios.map(scenarioCard).join('') : empty('No scenarios yet — model the first one above.')}
      `;
    }
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The money, before the case — banded, never a point estimate', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    const bad = (msg) => { ctx.setFlash(msg, 'err'); redirect(res, '/r/value'); };
    if (!ctx.matter) { bad('Open a matter first — scenarios live in the matter file.'); return; }
    const b = ctx.body;
    const dLow = parseNum(b.dLow), dLikely = parseNum(b.dLikely), dHigh = parseNum(b.dHigh), liability = parseNum(b.liability);
    if ([dLow, dLikely, dHigh, liability].some((n) => n == null || Number.isNaN(n))) {
      bad('Damages low / likely / high and liability % are required, as numbers.'); return;
    }
    if (dLow < 0 || dLikely < dLow || dHigh < dLikely) { bad('Damages must run low ≤ likely ≤ high, all zero or more.'); return; }
    if (liability < 0 || liability > 100) { bad('Liability must be between 0 and 100%.'); return; }
    const costsToDate = parseNum(b.costsToDate) ?? 0;
    const budget = parseNum(b.budget) ?? 0;
    if (Number.isNaN(costsToDate) || costsToDate < 0 || Number.isNaN(budget) || budget < 0) { bad('Costs to date and budget must be numbers, zero or more.'); return; }
    const contingency = parseNum(b.contingency);
    if (contingency != null && (Number.isNaN(contingency) || contingency < 0 || contingency > 100)) { bad('Contingency must be between 0 and 100%, or left blank.'); return; }
    const offer = parseNum(b.offer);
    if (offer != null && (Number.isNaN(offer) || offer < 0)) { bad('Offer must be a number, zero or more, or left blank.'); return; }
    ctx.kernel.scope(ctx.matter.id).put('scenario', {
      name: String(b.name || '').trim() || 'Unnamed scenario',
      dLow, dLikely, dHigh, liability, costsToDate, budget, contingency, offer,
    });
    ctx.setFlash('Scenario modelled — recovery reported as a band, not a number.');
    redirect(res, '/r/value');
  });

  app.route('POST', `/r/${ROOM.id}/del`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/value'); return; }
    const sc = ctx.kernel.scope(ctx.matter.id);
    const s = ctx.body.id ? sc.get('scenario', ctx.body.id) : null;
    if (s) { sc.del('scenario', s.id); ctx.setFlash('Scenario removed.'); }
    redirect(res, '/r/value');
  });
}

// Money columns right-aligned: .num is inline, so the cell wrapper aligns it.
const rcell = (h) => `<div class="num" style="text-align:right">${h}</div>`;

function scenarioCard(s) {
  const m = model(s);
  const rows = [
    ['Expected recovery (damages × liability)', rcell(amt(m.gross[0])), rcell(amt(m.gross[1])), rcell(amt(m.gross[2]))],
    ['Net if tried (after all costs)', rcell(amt(m.tryNet[0])), rcell(amt(m.tryNet[1])), rcell(amt(m.tryNet[2]))],
  ];
  if (m.contNet) rows.push([`Net to client under ${s.contingency}% contingency`, rcell(amt(m.contNet[0])), rcell(amt(m.contNet[1])), rcell(amt(m.contNet[2]))]);
  let settle;
  if (m.settleNet == null) {
    settle = '<p class="note">No offer recorded — add one to compare settling now (net of costs to date) against trying to judgment.</p>';
  } else {
    let verdict;
    if (m.settleNet >= m.tryNet[2]) verdict = tag('offer nets above the whole try band', 'ok');
    else if (m.settleNet >= m.tryNet[1]) verdict = tag('offer nets above mid band', 'navy');
    else if (m.settleNet >= m.tryNet[0]) verdict = tag('offer nets inside the try band');
    else verdict = tag('offer nets below the try band', 'gate');
    settle = `<p><b>Settle vs try.</b> Settling at the offer of ${money(s.offer)} nets ${amt(m.settleNet)} after ${money(m.spent)} costs to date. Trying to judgment nets ${band(m.tryNet[0], m.tryNet[2])} across the band, after ${money(m.total)} total costs. ${verdict}</p>`;
  }
  return `<div class="card">
    <b>${esc(s.name)}</b> ${s.contingency != null ? tag(`contingency ${s.contingency}%`, 'navy') : tag('hourly retainer')}
    ${kv([
      ['Damages band', `${band(s.dLow, s.dHigh)} <span class="note">likely ${amt(s.dLikely)}</span>`],
      ['Liability', `<span class="num">${s.liability}%</span>`],
      ['Costs', `${amt(s.costsToDate)} to date + ${amt(s.budget)} budgeted to trial = ${amt(m.total)}`],
      ['Expected recovery', `<b>${band(m.gross[0], m.gross[2])}</b> <span class="note">mid ${amt(m.gross[1])} — a band, on purpose</span>`],
    ])}
    ${table(['', 'P-low', 'P-mid', 'P-high'], rows)}
    ${settle}
    <form method="POST" action="/r/value/del" style="display:inline"><input type="hidden" name="id" value="${esc(s.id)}"><button class="quiet">Remove scenario</button></form>
  </div>`;
}

module.exports = { ...ROOM, register };
