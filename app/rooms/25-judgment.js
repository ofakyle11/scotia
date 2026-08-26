'use strict';
// Room 25 — Judgment & Enforcement. A judgment is not money.
const { layout, esc, table, empty, tag, input, select, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 25, id: 'judgment', title: 'Judgment & Enforcement', phase: 'Resolve' };
const STEPS = ['demand letter', 'garnishment', 'writ of seizure / judgment lien', 'examination in aid of execution', 'domestication (other jurisdiction)'];

// Printing this page yields a statement of judgment debt: chrome, forms and
// buttons drop out, leaving a dated document header plus per-judgment tables.
const PRINT = `<style>.print-only{display:none}@media print{
.print-only{display:block}
.side,.topbar,.flash,.noprint,form,button,h1.room,.roomsub{display:none!important}
.shell{display:block;min-height:0}.main{padding:0}
.grid2,.grid3{display:block}
body{background:#fff;color:#111}
.card{background:#fff;border-color:#bbb;color:#111;break-inside:avoid}
.empty{background:#fff;border-color:#bbb;color:#444}
table.t{background:#fff;border-color:#bbb}
table.t th{background:#eee;color:#333;border-color:#bbb}
table.t td{color:#111;border-color:#ddd}
h1.room,h2.sec{color:#111;border-color:#bbb}
.roomsub,.note,.kv dt{color:#444}.num,.kv dd{color:#111}
.tag{color:#111;border-color:#111;background:none}
a{color:#111}
}</style>`;

const accrued = (j) => {
  const days = Math.max(0, Math.floor((Date.now() - new Date(j.dateEntered + 'T00:00:00Z')) / 86400000));
  return j.amount * (j.rate / 100) * (days / 365);
};

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Getting paid after you win', body: empty('Open a matter to track its judgments.') })); return; }
    const s = k.scope(ctx.matter.id);
    const judgments = s.list('judgment');
    const today = new Date().toISOString().slice(0, 10);
    const body = `
    ${PRINT}
    <div class="print-only"><h2 class="sec" style="margin-top:0">Statement of judgment debt — ${esc(ctx.matter.title)} — as at ${today}</h2></div>
    ${judgments.map((j) => card(ctx, s, j)).join('') || empty('No judgments recorded — record the first below.')}
    <div class="card noprint">
      <h2 class="sec" style="margin-top:0">Record a judgment</h2>
      <form method="POST" action="/r/judgment/new">
        <div class="grid3">
          <span>${input('amount', 'Amount', { type: 'number', required: true })}</span>
          <span>${input('dateEntered', 'Entered', { type: 'date', required: true })}</span>
          <span>${input('rate', 'Post-judgment interest % (jurisdiction-set)', { type: 'number', required: true })}</span>
        </div>
        ${input('court', 'Court', { required: true })}
        ${input('debtor', 'Judgment debtor', { required: true })}
        <button>Record</button>
      </form>
    </div>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Interest accruing, enforcement stepping, satisfaction recorded', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/judgment'); return; }
    const amount = Number(ctx.body.amount), rate = Number(ctx.body.rate);
    if (!(amount > 0) || !(rate >= 0) || !ctx.body.dateEntered || !ctx.body.debtor) { ctx.setFlash('Amount, date, rate and debtor are required.', 'err'); redirect(res, '/r/judgment'); return; }
    ctx.kernel.scope(ctx.matter.id).put('judgment', { amount, rate, dateEntered: ctx.body.dateEntered, court: ctx.body.court, debtor: ctx.body.debtor, recovered: 0, satisfied: false });
    redirect(res, '/r/judgment');
  });

  app.route('POST', `/r/${ROOM.id}/step`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/judgment'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const j = s.get('judgment', String(ctx.body.id || ''));
    if (!j || !STEPS.includes(ctx.body.step)) { ctx.setFlash('Pick a judgment and a step.', 'err'); redirect(res, '/r/judgment'); return; }
    s.put('enfStep', { judgmentId: j.id, step: ctx.body.step, started: new Date().toISOString().slice(0, 10), status: 'active' });
    redirect(res, '/r/judgment');
  });

  app.route('POST', `/r/${ROOM.id}/payment`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/judgment'); return; }
    const s = k.scope(ctx.matter.id);
    const j = s.get('judgment', String(ctx.body.id || ''));
    const amt = Number(ctx.body.amount);
    if (!j || !(amt > 0)) { ctx.setFlash('A judgment and a positive amount are required.', 'err'); redirect(res, '/r/judgment'); return; }
    k.ledger.post(ctx.matter.id, {
      memo: `Enforcement recovery — ${j.debtor}`, kind: 'recovery',
      lines: [{ account: 'operating:bank', dr: amt }, { account: 'ar:client', cr: amt }],
    });
    const recovered = (j.recovered || 0) + amt;
    const owing = j.amount + accrued(j) - recovered;
    s.put('judgment', { ...j, recovered, satisfied: owing <= 0.005 });
    ctx.setFlash(`Recovery posted: ${amt.toFixed(2)}. ${owing <= 0.005 ? 'Judgment satisfied.' : 'Still owing ~' + owing.toFixed(2) + '.'}`);
    redirect(res, '/r/judgment');
  });
}

function card(ctx, s, j) {
  const int = accrued(j);
  const owing = j.amount + int - (j.recovered || 0);
  const steps = s.list('enfStep', (e) => e.judgmentId === j.id);
  return `<div class="card">
    <h2 class="sec" style="margin-top:0">${esc(j.debtor)} — ${esc(j.court)} ${j.satisfied ? tag('SATISFIED', 'ok') : tag('outstanding', 'gate')}</h2>
    ${table(['Principal', 'Interest accrued', 'Recovered', 'Owing today'], [[money(j.amount), money(int), money(j.recovered || 0), `<b>${money(Math.max(0, owing))}</b>`]])}
    <p class="note">Entered ${esc(j.dateEntered)} at ${esc(String(j.rate))}% (simple, per-diem ${money(j.amount * (j.rate / 100) / 365)}). Exemption schedules and domestication procedures are per-jurisdiction reference data.</p>
    ${steps.length ? table(['Step', 'Started', 'Status'], steps.map((e) => [esc(e.step), date(e.started), tag(e.status)])) : ''}
    ${!j.satisfied ? `
    <div class="grid2">
      <form method="POST" action="/r/judgment/step"><input type="hidden" name="id" value="${esc(j.id)}">${select('step', 'Enforcement step', STEPS)}<button>Start step</button></form>
      <form method="POST" action="/r/judgment/payment"><input type="hidden" name="id" value="${esc(j.id)}">${input('amount', 'Payment received', { type: 'number', required: true })}<button>Post recovery</button></form>
    </div>` : ''}
  </div>`;
}

module.exports = { ...ROOM, register };
