'use strict';
// Room 24 — Settlement Waterfall. Gross to net, honestly, then into trust.
//
// The daily action is running the number for a client on the phone, so the
// form is first and every statement below it is a standing document: printing
// the page yields the settlement statements themselves, which is what the
// client signs off on.
const { layout, esc, table, empty, tag, input, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 24, id: 'waterfall', title: 'Settlement Waterfall', phase: 'Resolve' };

// Printing yields the statements alone — the intake form and the room heading
// drop out, the entry grid collapses. Everything else the shared print base in
// kernel/html.js already does: chrome out, black on white, no card split
// across a page.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Numbers in a statement read down a column, so every figure is right-aligned.
const rcell = (h) => `<div style="text-align:right">${h}</div>`;
const ded = (v) => rcell('(' + money(v) + ')');

function compute(w) {
  const gross = n(w.gross), costs = n(w.costs), feePct = n(w.feePct);
  const liens = (w.liens || []).reduce((s, l) => s + n(l.amount), 0);
  const feeBaseGross = gross * (feePct / 100);
  const feeBaseNet = (gross - liens) * (feePct / 100);
  const lines = (feeOn) => {
    const fee = feeOn === 'gross' ? feeBaseGross : feeBaseNet;
    const net = gross - liens - costs - fee;
    return { fee, net };
  };
  return { liens, costs, gross: lines('gross'), netOfLiens: lines('net') };
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'What it nets, honestly', body: empty('Open a matter above to run its settlement waterfall.') })); return; }
    const s = k.scope(ctx.matter.id);
    const scenarios = s.list('waterfall').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const today = new Date().toISOString().slice(0, 10);
    const body = `
    ${PRINT}
    <div class="card no-print">
      <h2 class="sec" style="margin-top:0">New waterfall</h2>
      <form method="POST" action="/r/waterfall/new">
        <div class="grid3">
          <span>${input('gross', 'Gross settlement', { type: 'number', required: true })}</span>
          <span>${input('feePct', 'Contingency fee %', { type: 'number', required: true })}</span>
          <span>${input('costs', 'Costs advanced', { type: 'number' })}</span>
        </div>
        ${input('liens', 'Liens — name:amount, comma-separated', { placeholder: 'OHIP subrogation:4200, Medical lien:1800' })}
        <button>Compute</button>
      </form>
      <p class="note">Both fee conventions are shown — fee on gross and fee on net-of-liens — because the retainer governs which applies. Statutory reductions and approval requirements vary by jurisdiction.</p>
    </div>
    <div class="print-only" style="margin-bottom:14px"><h2 class="sec" style="margin-top:0">Settlement statement — ${esc(ctx.matter.title)} — as at ${esc(today)}</h2></div>
    ${scenarios.length ? scenarios.map((w) => card(w)).join('') : empty('No waterfall run yet. Enter the gross, the fee percentage and every lien above — the client sees the net before anyone signs.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Gross to net, through everyone with a prior claim on it', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/waterfall'); return; }
    const gross = Number(ctx.body.gross), feePct = Number(ctx.body.feePct), costs = Number(ctx.body.costs) || 0;
    if (!(gross > 0) || !(feePct >= 0 && feePct <= 100)) { ctx.setFlash('Need a positive gross and a fee between 0 and 100%.', 'err'); redirect(res, '/r/waterfall'); return; }
    if (!(costs >= 0)) { ctx.setFlash('Costs advanced cannot be negative.', 'err'); redirect(res, '/r/waterfall'); return; }
    const liens = String(ctx.body.liens || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.lastIndexOf(':');
      return { name: i > 0 ? x.slice(0, i).trim() : x, amount: Number(i > 0 ? x.slice(i + 1) : 0) || 0 };
    });
    ctx.kernel.scope(ctx.matter.id).put('waterfall', { gross, feePct, costs, liens, staged: false });
    ctx.setFlash('Statement computed — both fee conventions are shown; the retainer says which one governs.');
    redirect(res, '/r/waterfall');
  });

  app.route('POST', `/r/${ROOM.id}/stage`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/waterfall'); return; }
    const s = k.scope(ctx.matter.id);
    const w = s.get('waterfall', String(ctx.body.id || ''));
    if (!w) { ctx.setFlash('Waterfall not found.', 'err'); redirect(res, '/r/waterfall'); return; }
    // GATE — STAGE ONCE. A second receipt would double the trust liability.
    if (w.staged) { ctx.setFlash('Already staged to trust.', 'err'); redirect(res, '/r/waterfall'); return; }
    if (!(Number(w.gross) > 0)) { ctx.setFlash('Nothing to stage — this statement has no gross figure.', 'err'); redirect(res, '/r/waterfall'); return; }
    k.ledger.post(ctx.matter.id, {
      memo: 'Settlement funds received in trust (waterfall ' + w.id.slice(0, 8) + ')', kind: 'trust-receipt',
      lines: [{ account: 'trust:bank', dr: w.gross }, { account: 'trust:client', cr: w.gross }],
    });
    s.put('waterfall', { ...w, staged: true });
    ctx.setFlash(`Staged: ${Number(w.gross).toFixed(2)} received into trust. Disburse liens, costs and fees from Trust & Books (28) — fees only by flagged trust-transfer.`);
    redirect(res, '/r/waterfall');
  });
}

function card(w) {
  const c = compute(w);
  const liens = w.liens || [];
  const rows = [
    ['Gross settlement', '', rcell(`<b>${money(w.gross)}</b>`)],
    ...liens.map((l) => [esc('Less lien — ' + (l.name || 'unnamed')), ded(l.amount), '']),
    ...(liens.length > 1 ? [['Total liens', ded(c.liens), '']] : []),
    ['Less costs advanced', ded(c.costs), ''],
    [`Less fee ${esc(String(w.feePct))}% <b>on gross</b>`, ded(c.gross.fee), ''],
    ['<b>NET TO CLIENT — fee on gross</b>', '', rcell(`<b>${money(c.gross.net)}</b>`)],
    [`Or fee ${esc(String(w.feePct))}% <b>on net of liens</b>`, ded(c.netOfLiens.fee), ''],
    ['<b>NET TO CLIENT — fee on net of liens</b>', '', rcell(`<b>${money(c.netOfLiens.net)}</b>`)],
  ];
  const underwater = c.gross.net < 0 || c.netOfLiens.net < 0;
  return `<div class="card">
    <h2 class="sec" style="margin-top:0">${money(w.gross)} gross &middot; ${esc(String(w.feePct))}% fee ${w.staged ? tag('staged to trust', 'ok') : tag('not yet in trust', 'gate')}</h2>
    <p class="note" style="margin-top:0">${w.createdAt ? 'Computed ' + date(w.createdAt) : 'Computed'}${liens.length ? ` &middot; ${liens.length} lien${liens.length === 1 ? '' : 's'} totalling ${money(c.liens)}` : ' &middot; no liens recorded'}</p>
    ${table(['', 'Deduction', 'To client'], rows)}
    ${underwater ? '<p class="note" style="color:var(--oxide)">Deductions exceed the settlement — on these figures the client nets nothing. Do not present this as a recovery; renegotiate the liens or the fee before the client signs.</p>' : ''}
    ${w.staged
    ? '<p class="note">Gross is in trust against this matter. Every disbursement out of it runs through Trust &amp; Books (28); fees leave only by a flagged trust-transfer.</p>'
    : `<form method="POST" action="/r/waterfall/stage"><input type="hidden" name="id" value="${esc(w.id)}"><button>Stage gross into trust</button></form>
       <p class="note">Posts a balanced trust receipt for the gross figure. Once staged it cannot be staged again.</p>`}
  </div>`;
}

module.exports = { ...ROOM, register };
