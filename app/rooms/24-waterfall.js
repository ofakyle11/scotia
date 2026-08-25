'use strict';
// Room 24 — Settlement Waterfall. Gross to net, honestly, then into trust.
const { layout, esc, table, empty, tag, input, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 24, id: 'waterfall', title: 'Settlement Waterfall', phase: 'Resolve' };

function compute(w) {
  const gross = w.gross, liens = (w.liens || []).reduce((s, l) => s + l.amount, 0);
  const feeBaseGross = gross * (w.feePct / 100);
  const feeBaseNet = (gross - liens) * (w.feePct / 100);
  const lines = (feeOn) => {
    const fee = feeOn === 'gross' ? feeBaseGross : feeBaseNet;
    const net = gross - liens - w.costs - fee;
    return { fee, net };
  };
  return { liens, gross: lines('gross'), netOfLiens: lines('net') };
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'What it nets, honestly', body: empty('Open a matter to run its waterfall.') })); return; }
    const s = k.scope(ctx.matter.id);
    const scenarios = s.list('waterfall').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const body = `
    <div class="card">
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
    ${scenarios.map((w) => card(ctx, w)).join('') || empty('No waterfalls run yet.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Gross to net, through everyone with a prior claim on it', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/waterfall'); return; }
    const gross = Number(ctx.body.gross), feePct = Number(ctx.body.feePct), costs = Number(ctx.body.costs) || 0;
    if (!(gross > 0) || !(feePct >= 0 && feePct <= 100)) { ctx.setFlash('Need a positive gross and a fee between 0 and 100%.', 'err'); redirect(res, '/r/waterfall'); return; }
    const liens = String(ctx.body.liens || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.lastIndexOf(':');
      return { name: i > 0 ? x.slice(0, i).trim() : x, amount: Number(i > 0 ? x.slice(i + 1) : 0) || 0 };
    });
    ctx.kernel.scope(ctx.matter.id).put('waterfall', { gross, feePct, costs, liens, staged: false });
    redirect(res, '/r/waterfall');
  });

  app.route('POST', `/r/${ROOM.id}/stage`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/waterfall'); return; }
    const s = k.scope(ctx.matter.id);
    const w = s.get('waterfall', String(ctx.body.id || ''));
    if (!w) { ctx.setFlash('Waterfall not found.', 'err'); redirect(res, '/r/waterfall'); return; }
    if (w.staged) { ctx.setFlash('Already staged to trust.', 'err'); redirect(res, '/r/waterfall'); return; }
    k.ledger.post(ctx.matter.id, {
      memo: 'Settlement funds received in trust (waterfall ' + w.id.slice(0, 8) + ')', kind: 'trust-receipt',
      lines: [{ account: 'trust:bank', dr: w.gross }, { account: 'trust:client', cr: w.gross }],
    });
    s.put('waterfall', { ...w, staged: true });
    ctx.setFlash(`Staged: ${w.gross.toFixed(2)} received into trust. Disburse liens, costs and fees from Trust & Books — fees only by flagged trust-transfer.`);
    redirect(res, '/r/waterfall');
  });
}

function card(ctx, w) {
  const c = compute(w);
  const rows = [
    ['Gross settlement', money(w.gross), ''],
    ...(w.liens || []).map((l) => [esc('Less lien — ' + l.name), '', '(' + money(l.amount) + ')']),
    ['Less costs advanced', '', '(' + money(w.costs) + ')'],
    [`Less fee ${w.feePct}% on gross`, '', '(' + money(c.gross.fee) + ')'],
    ['NET TO CLIENT (fee on gross)', money(c.gross.net), ''],
    [`— or fee ${w.feePct}% on net-of-liens`, '', '(' + money(c.netOfLiens.fee) + ')'],
    ['NET TO CLIENT (fee on net)', money(c.netOfLiens.net), ''],
  ];
  return `<div class="card">
    <h2 class="sec" style="margin-top:0">Statement ${w.staged ? tag('staged to trust', 'ok') : ''}</h2>
    ${table(['', 'To client', 'Deductions'], rows)}
    ${!w.staged ? `<form method="POST" action="/r/waterfall/stage"><input type="hidden" name="id" value="${esc(w.id)}"><button>Stage gross into trust</button></form>` : ''}
  </div>`;
}

module.exports = { ...ROOM, register };
