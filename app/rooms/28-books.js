'use strict';
// Room 28 — Trust & Books. Append-only double entry; the schema refuses commingling.
const { layout, esc, table, empty, tag, input, select, money, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 28, id: 'books', title: 'Trust & Books', phase: 'Always on' };

const ACCOUNTS = [
  ['trust:bank', 'Trust — bank'],
  ['trust:client', 'Trust — client liability'],
  ['operating:bank', 'Operating — bank'],
  ['operating:income:fees', 'Operating — fee income'],
  ['operating:expense:disbursements', 'Disbursements'],
  ['ar:client', 'Accounts receivable'],
];

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const txns = k.ledger.list(ctx.matter ? ctx.matter.id : undefined).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const bal = k.ledger.balances(ctx.matter ? ctx.matter.id : undefined);
    const trustBank = bal['trust:bank'] || 0;
    const trustLiab = -(bal['trust:client'] || 0);
    const reconciled = Math.abs(trustBank - trustLiab) < 0.005;
    const time = ctx.matter ? k.scope(ctx.matter.id).list('timeEntry') : [];
    const unbilled = time.filter((t) => t.state !== 'billed').reduce((s, t) => s + (t.hours * t.rate), 0);

    const body = `
    <div class="grid3">
      <div class="card"><h2 class="sec" style="margin-top:0">Trust position${ctx.matter ? ' — this matter' : ' — firm'}</h2>
        ${table(['', ''], [
          ['Trust bank', money(trustBank)],
          ['Owed to clients', money(trustLiab)],
          ['Three-way check', reconciled ? tag('reconciled', 'ok') : tag('OUT OF BALANCE', 'gate')],
        ])}
        <p class="note">Client funds are liabilities, never income. The ledger refuses any transaction that would take fees from trust without an explicit, flagged transfer.</p>
      </div>
      <div class="card"><h2 class="sec" style="margin-top:0">Receive retainer into trust</h2>
        <form method="POST" action="/r/books/retainer">
          ${input('amount', 'Amount', { type: 'number', required: true, placeholder: '5000.00' })}
          ${input('memo', 'Memo', { placeholder: 'Initial retainer per engagement letter' })}
          <button>Post to trust</button>
        </form>
      </div>
      <div class="card"><h2 class="sec" style="margin-top:0">Transfer earned fees</h2>
        <form method="POST" action="/r/books/transfer">
          ${input('amount', 'Amount (invoiced & earned)', { type: 'number', required: true })}
          ${input('memo', 'Invoice reference', { required: true, placeholder: 'Invoice 2026-014' })}
          <button class="danger">Trust → operating (flagged)</button>
        </form>
        <p class="note">Posts as an explicit <b>trust-transfer</b> — the only path from trust to fees, and it is audit-flagged.</p>
      </div>
    </div>
    ${ctx.matter ? `
    <h2 class="sec">Time — ${esc(ctx.matter.title)} <span class="tag navy">unbilled ${money(unbilled)}</span></h2>
    <div class="card"><form method="POST" action="/r/books/time" class="grid3" style="align-items:end">
      <span>${input('hours', 'Hours', { type: 'number', required: true, placeholder: '0.3' })}</span>
      <span>${input('rate', 'Rate', { type: 'number', required: true, placeholder: '450' })}</span>
      <span>${select('utbms', 'UTBMS', ['L110 Fact investigation', 'L120 Analysis & strategy', 'L190 Other case assessment', 'L210 Pleadings', 'L310 Written discovery', 'L330 Depositions', 'L430 Trial & hearing'])}</span>
      <span style="grid-column:1/-1">${input('narrative', 'Narrative (specific — pre-bill lint rejects vagueness)', { required: true })}</span>
      <button>Record time</button>
    </form></div>
    ${time.length ? table(['Date', 'Hours', 'Rate', 'Code', 'Narrative', 'State'], time.slice().reverse().map((t) => [date(t.createdAt), `<span class="num">${t.hours}</span>`, money(t.rate), esc((t.utbms || '').slice(0, 4)), esc(t.narrative), t.lint ? tag('lint: ' + t.lint, 'gate') : tag(t.state || 'draft')])) : empty('No time recorded on this matter.')}
    ` : ''}
    <h2 class="sec">Ledger${ctx.matter ? ' — this matter' : ''}</h2>
    ${txns.length ? table(['Date', 'Kind', 'Memo', 'Lines'], txns.map((t) => [
      date(t.date), t.kind === 'trust-transfer' ? tag('trust-transfer', 'gate') : tag(t.kind),
      esc(t.memo || ''), t.lines.map((l) => `<span class="num">${esc(l.account)} ${l.dr ? 'DR ' + money(l.dr) : 'CR ' + money(l.cr)}</span>`).join('<br>'),
    ])) : empty('No ledger activity yet.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The ledger and the vault — append-only, dual-entry, audited', body }));
  });

  app.route('POST', `/r/${ROOM.id}/retainer`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/books'); return; }
    const amt = Number(ctx.body.amount);
    if (!(amt > 0)) { ctx.setFlash('Enter a positive amount.', 'err'); redirect(res, '/r/books'); return; }
    ctx.kernel.ledger.post(ctx.matter.id, {
      memo: ctx.body.memo || 'Retainer received', kind: 'trust-receipt',
      lines: [{ account: 'trust:bank', dr: amt }, { account: 'trust:client', cr: amt }],
    });
    ctx.setFlash(`Posted ${amt.toFixed(2)} to trust — held for the client, not earned.`);
    redirect(res, '/r/books');
  });

  app.route('POST', `/r/${ROOM.id}/transfer`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/books'); return; }
    const amt = Number(ctx.body.amount);
    const bal = ctx.kernel.ledger.balances(ctx.matter.id);
    if (!(amt > 0)) { ctx.setFlash('Enter a positive amount.', 'err'); redirect(res, '/r/books'); return; }
    if (amt > (bal['trust:bank'] || 0) + 0.005) { ctx.setFlash('Refused: transfer exceeds trust balance for this matter.', 'err'); redirect(res, '/r/books'); return; }
    ctx.kernel.ledger.post(ctx.matter.id, {
      memo: ctx.body.memo, kind: 'trust-transfer',
      lines: [
        { account: 'trust:client', dr: amt }, { account: 'trust:bank', cr: amt },
        { account: 'operating:bank', dr: amt }, { account: 'operating:income:fees', cr: amt },
      ],
    });
    ctx.setFlash(`Transferred ${amt.toFixed(2)} of earned fees — flagged as trust-transfer in the audit chain.`);
    redirect(res, '/r/books');
  });

  app.route('POST', `/r/${ROOM.id}/time`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/books'); return; }
    const narrative = String(ctx.body.narrative || '').trim();
    const vague = /^(work on file|attend to file|misc|various|review file)\.?$/i.test(narrative) || narrative.length < 12;
    ctx.kernel.scope(ctx.matter.id).put('timeEntry', {
      hours: Number(ctx.body.hours), rate: Number(ctx.body.rate), utbms: ctx.body.utbms,
      narrative, state: 'draft', lint: vague ? 'narrative too vague' : null,
    });
    ctx.setFlash(vague ? 'Recorded, but pre-bill lint flagged the narrative as too vague.' : 'Time recorded.');
    redirect(res, '/r/books');
  });
}

module.exports = { ...ROOM, register };
