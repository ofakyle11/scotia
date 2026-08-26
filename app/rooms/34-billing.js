'use strict';
// Room 34 — Billing. The invoice run: unbilled time + disbursements, the fee
// model applied, a numbered draft, per-line write-downs, a pre-bill lint gate,
// and issue -> receivable + time marked billed so nothing is billed twice.
const { layout, esc, table, empty, tag, kv, input, money, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 34, id: 'billing', title: 'Billing', phase: 'Always on' };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

// Pre-bill lint. A narrative a client should never see on a bill: empty, too
// thin to justify the time, or one of the boilerplate phrases that read as
// padding. Mirrors room 28's WIP lint and adds the ones a partner blocks by hand.
const VAGUE = /^(work on file|attend(?:ed)? to (?:the )?file|attention to (?:the )?file|misc(?:ellaneous)?|various|general|admin(?:istration)?|as discussed|review file|review of file|per instructions)\.?$/i;
function narrativeLint(n) {
  const s = String(n || '').trim();
  if (!s) return 'empty narrative';
  if (s.length < 12) return 'narrative too thin';
  if (VAGUE.test(s)) return 'narrative too vague';
  return null;
}

// The fee model comes from the signed engagement letter (room 03, scope type
// 'engagement'); newest signed version wins, else newest draft, else hourly.
function feeModelFor(k, matterId) {
  let eng = null;
  try {
    const all = k.scope(matterId).list('engagement');
    const signed = all.filter((e) => e.status === 'signed').sort((a, b) => (b.version || 0) - (a.version || 0));
    eng = signed[0] || all.slice().sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
  } catch (e) { eng = null; }
  if (!eng) return { feeModel: 'hourly', flatAmount: 0, contingencyPct: 0, source: 'default (no engagement on file)' };
  return {
    feeModel: eng.feeModel || 'hourly', flatAmount: Number(eng.flatAmount) || 0,
    contingencyPct: Number(eng.contingencyPct) || 0, source: 'engagement v' + (eng.version || '?'),
  };
}

// Fees per the model; disbursements and totals from the invoice's own lines.
function recompute(inv) {
  const gross = (inv.lineItems || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const wd = (inv.lineItems || []).reduce((s, l) => s + (Number(l.writeDown) || 0), 0);
  let fees;
  if (inv.feeModel === 'flat') fees = Math.max(0, (Number(inv.flatAmount) || 0) - wd);
  else if (inv.feeModel === 'contingency') fees = 0; // taken from recovery in room 24, not billed hourly
  else fees = Math.max(0, gross - wd);
  const disb = (inv.disbLines || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  inv.fees = r2(fees); inv.disbursements = r2(disb); inv.writeDowns = r2(wd); inv.total = r2(fees + disb);
  return inv;
}

// Firm-wide monotonic invoice counter. Holds a bare number, no matter identity,
// so it leaks nothing across the ethical wall. Never reuses a number.
function nextNumber(k) {
  const cur = k.firm.get('invoiceSeq', 'counter') || { id: 'counter', n: 0 };
  const n = (Number(cur.n) || 0) + 1;
  k.firm.put('invoiceSeq', { id: 'counter', n });
  return new Date().getFullYear() + '-' + String(n).padStart(3, '0');
}

function modelLabel(fm) {
  if (fm.feeModel === 'flat') return 'Flat fee — ' + money(fm.flatAmount);
  if (fm.feeModel === 'contingency') return 'Contingency — ' + esc(String(fm.contingencyPct)) + '% of recovery';
  return 'Hourly — time × rate';
}

// Print styles: Ctrl-P on an open invoice yields a clean statement — the sheet
// survives, all app chrome and controls drop out.
const PRINT = `<style>@media print{
.side,.topbar,.flash,.noprint,form,button{display:none!important}
.shell{display:block;min-height:0}.main{padding:0}
.grid2,.grid3{display:block}
h1.room,.roomsub{display:none!important}
body{background:#fff;color:#111}
.invoice-sheet{border:0!important;background:#fff!important;color:#111!important}
.card{background:#fff;border-color:#bbb;color:#111;break-inside:avoid}
table.t{background:#fff;border-color:#bbb}
table.t th{background:#eee;color:#333;border-color:#bbb}
table.t td{color:#111;border-color:#ddd}
h2.sec{color:#111;border-color:#bbb}
.roomsub,.note,.kv dt{color:#444}.num,.kv dd{color:#111}
.tag{color:#111;border-color:#111;background:none}
a{color:#111}
}</style>`;

function statusTag(s) {
  if (s === 'paid') return tag('paid', 'ok');
  if (s === 'sent') return tag('issued', 'navy');
  return tag('draft');
}

function lineRows(inv, editable) {
  return (inv.lineItems || []).map((l) => {
    const lint = narrativeLint(l.narrative);
    const net = r2((Number(l.amount) || 0) - (Number(l.writeDown) || 0));
    const wdCell = editable
      ? `<input type="number" step="0.01" min="0" name="wd:${esc(l.timeEntryId)}" value="${esc(r2(l.writeDown))}" style="margin:0;padding:4px 6px;max-width:110px">`
      : money(l.writeDown);
    return [
      `${esc(l.narrative)} ${lint ? tag('lint: ' + lint, 'gate') : ''}<br><span class="note">${esc((l.utbms || '').slice(0, 4))}</span>`,
      `<span class="num">${esc(String(l.hours))}</span>`,
      money(l.rate), money(l.amount), wdCell, money(net),
    ];
  });
}

function invoiceSheet(ctx, inv) {
  const m = ctx.matter;
  const editable = inv.status === 'draft';
  const rows = lineRows(inv, editable);
  const disbRows = (inv.disbLines || []).map((d) => [esc(d.desc), money(d.amount)]);
  const lintHits = (inv.lineItems || []).filter((l) => narrativeLint(l.narrative)).length;
  const linesTable = `<table class="t"><thead><tr>
      <th>Narrative</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Write-down</th><th>Net</th>
    </tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="6"><span class="note">No time on this invoice.</span></td></tr>'}</tbody></table>`;
  const wdForm = editable
    ? `<form method="POST" action="/r/billing/writedown" class="noprint">
        <input type="hidden" name="inv" value="${esc(inv.id)}">${linesTable}
        <button class="quiet">Apply write-downs</button>
      </form>`
    : linesTable;
  return `<div class="card invoice-sheet">
    <h2 class="sec" style="margin-top:0">Invoice ${esc(inv.number)} ${statusTag(inv.status)}</h2>
    ${kv([
      ['Matter', esc(m.title)],
      ['Client', esc(m.client || '')],
      ['Fee model', esc(inv.feeModel || 'hourly') + (inv.feeModel === 'flat' ? ' — ' + money(inv.flatAmount) : inv.feeModel === 'contingency' ? ' — ' + esc(String(inv.contingencyPct)) + '%' : '')],
      ['Issued', inv.issuedDate ? date(inv.issuedDate) : '<span class="note">not yet issued</span>'],
      inv.paidDate ? ['Paid', date(inv.paidDate)] : null,
    ].filter(Boolean))}
    <h2 class="sec">Professional fees</h2>
    ${wdForm}
    ${inv.feeModel === 'contingency' ? '<p class="note">Contingency retainer: fees are drawn from the recovery in Settlement Waterfall (room 24), not billed hourly here. Time above is recorded for the file; this invoice bills disbursements only.</p>' : ''}
    <h2 class="sec">Disbursements</h2>
    ${disbRows.length ? table(['Item', 'Amount'], disbRows) : empty('No disbursements on this invoice.')}
    ${kv([
      ['Fees', money(inv.fees)],
      ['Write-downs', inv.writeDowns > 0 ? '−' + money(inv.writeDowns).replace('<span class="num">', '<span class="num">') : money(0)],
      ['Disbursements', money(inv.disbursements)],
      ['Total due', `<b>${money(inv.total)}</b>`],
    ])}
    <div class="noprint" style="margin-top:14px">
      ${editable ? `<form method="POST" action="/r/billing/issue" style="display:inline">
        <input type="hidden" name="inv" value="${esc(inv.id)}">
        <button ${lintHits ? 'class="danger"' : ''}>Issue invoice</button>
      </form>` : ''}
      ${inv.status === 'sent' ? `<form method="POST" action="/r/billing/status" style="display:inline">
        <input type="hidden" name="inv" value="${esc(inv.id)}"><input type="hidden" name="status" value="paid">
        <button>Mark paid</button>
      </form>` : ''}
      ${editable ? `<form method="POST" action="/r/billing/discard" style="display:inline;margin-left:8px">
        <input type="hidden" name="inv" value="${esc(inv.id)}">
        <button class="danger quiet">Discard draft</button>
      </form>` : ''}
      <a class="btn" href="#" onclick="window.print();return false" style="margin-left:8px">Print / save as PDF</a>
      <a class="btn" href="/r/billing/download?inv=${esc(inv.id)}" style="margin-left:8px">Download .txt</a>
      ${editable && lintHits ? `<p class="note">${lintHits} line${lintHits === 1 ? '' : 's'} flagged by pre-bill lint — issuing is blocked until the narrative is fixed in Trust &amp; Books (room 28).</p>` : ''}
    </div>
  </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      const body = PRINT + empty('Open a matter to run a bill — the invoice run gathers that matter\'s unbilled time and disbursements.');
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Invoice run — time in, numbered invoice out', body }));
      return;
    }
    const sc = k.scope(ctx.matter.id);
    const fm = feeModelFor(k, ctx.matter.id);
    const time = sc.list('timeEntry');
    const unbilledTime = time.filter((t) => t.state !== 'billed');
    const disb = sc.list('disbursement');
    const unbilledDisb = disb.filter((d) => d.state !== 'billed');
    const invoices = sc.list('invoice').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const openDraft = invoices.find((i) => i.status === 'draft');
    const selId = ctx.query.get('inv');
    const selected = selId ? sc.get('invoice', selId) : (openDraft || null);

    const grossUnbilled = unbilledTime.reduce((s, t) => s + (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
    const disbUnbilled = unbilledDisb.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const feePreview = fm.feeModel === 'flat' ? money(fm.flatAmount)
      : fm.feeModel === 'contingency' ? '<span class="note">from recovery (room 24)</span>'
      : money(grossUnbilled);

    const body = `
    ${PRINT}
    <div class="grid2">
      <div class="card noprint">
        <h2 class="sec" style="margin-top:0">Run a bill — ${esc(ctx.matter.title)}</h2>
        ${kv([
          ['Fee model', modelLabel(fm) + ` <span class="note">${esc(fm.source)}</span>`],
          ['Unbilled time', `${money(grossUnbilled)} <span class="note">${unbilledTime.length} entr${unbilledTime.length === 1 ? 'y' : 'ies'}</span>`],
          ['Fees at this model', feePreview],
          ['Unbilled disbursements', `${money(disbUnbilled)} <span class="note">${unbilledDisb.length} item${unbilledDisb.length === 1 ? '' : 's'}</span>`],
        ])}
        ${openDraft
          ? `<p class="note">A draft invoice (<a href="/r/billing?inv=${esc(openDraft.id)}">${esc(openDraft.number)}</a>) is already open — issue or discard it before starting another.</p>`
          : `<form method="POST" action="/r/billing/draft"><button>Generate draft invoice</button></form>
             <p class="note">Gathers every unbilled entry above into one numbered draft. Write down any line before issuing; issuing marks the time billed so it cannot be billed twice.</p>`}
      </div>
      <div class="card noprint">
        <h2 class="sec" style="margin-top:0">Record a disbursement</h2>
        <form method="POST" action="/r/billing/disb">
          ${input('desc', 'Description', { required: true, placeholder: 'Court filing fee — statement of claim' })}
          <div class="grid2">
            <span>${input('amount', 'Amount', { type: 'number', required: true, placeholder: '229.00' })}</span>
            <span>${input('incurred', 'Date incurred', { type: 'date', value: today() })}</span>
          </div>
          <button>Record disbursement</button>
        </form>
        <p class="note">Posts the firm's out-of-pocket cost to the ledger (expense against operating bank) and holds it as unbilled until it lands on an invoice.</p>
      </div>
    </div>

    ${selected ? invoiceSheet(ctx, selected) : (invoices.length ? empty('Select an invoice below to view or print it.') : '')}

    <h2 class="sec">Unbilled time</h2>
    ${unbilledTime.length ? table(['Date', 'Hours', 'Rate', 'Value', 'Narrative', 'Lint'], unbilledTime.slice().reverse().map((t) => {
      const lint = t.lint || narrativeLint(t.narrative);
      return [date(t.createdAt), `<span class="num">${esc(String(t.hours))}</span>`, money(t.rate), money((Number(t.hours) || 0) * (Number(t.rate) || 0)), esc(t.narrative), lint ? tag(lint, 'gate') : tag('clean', 'ok')];
    })) : empty('No unbilled time — record time in Trust & Books (room 28).')}

    <h2 class="sec">Unbilled disbursements</h2>
    ${unbilledDisb.length ? table(['Date', 'Item', 'Amount'], unbilledDisb.slice().reverse().map((d) => [date(d.incurred || d.createdAt), esc(d.desc), money(d.amount)])) : empty('No unbilled disbursements.')}

    <h2 class="sec">Invoices — ${esc(ctx.matter.title)}</h2>
    ${invoices.length ? table(['Number', 'Issued', 'Fees', 'Disb.', 'Total', 'Status', ''], invoices.map((i) => [
      esc(i.number), i.issuedDate ? date(i.issuedDate) : '<span class="note">—</span>',
      money(i.fees), money(i.disbursements), money(i.total), statusTag(i.status),
      `<a href="/r/billing?inv=${esc(i.id)}">view</a>`,
    ])) : empty('No invoices yet — generate a draft above.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Invoice run — time in, numbered invoice out', body }));
  });

  app.route('POST', `/r/${ROOM.id}/disb`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const desc = String(ctx.body.desc || '').trim();
    const amt = Number(ctx.body.amount);
    const incurred = String(ctx.body.incurred || '').trim() || today();
    if (!desc) { ctx.setFlash('Describe the disbursement.', 'err'); redirect(res, '/r/billing'); return; }
    if (!(amt > 0)) { ctx.setFlash('Enter a positive disbursement amount.', 'err'); redirect(res, '/r/billing'); return; }
    ctx.kernel.ledger.post(ctx.matter.id, {
      date: incurred, memo: 'Disbursement — ' + desc, kind: 'disbursement',
      lines: [{ account: 'operating:expense:disbursements', dr: r2(amt) }, { account: 'operating:bank', cr: r2(amt) }],
    });
    ctx.kernel.scope(ctx.matter.id).put('disbursement', { desc, amount: r2(amt), incurred, state: 'unbilled' });
    ctx.setFlash(`Disbursement recorded — ${desc} (${money(amt).replace(/<[^>]+>/g, '')}), held unbilled.`);
    redirect(res, '/r/billing');
  });

  app.route('POST', `/r/${ROOM.id}/draft`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const k = ctx.kernel, sc = k.scope(ctx.matter.id);
    const invoices = sc.list('invoice');
    const openDraft = invoices.find((i) => i.status === 'draft');
    if (openDraft) { ctx.setFlash(`A draft invoice (${openDraft.number}) is already open — issue or discard it first.`, 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(openDraft.id)); return; }
    const unbilledTime = sc.list('timeEntry').filter((t) => t.state !== 'billed');
    const unbilledDisb = sc.list('disbursement').filter((d) => d.state !== 'billed');
    if (!unbilledTime.length && !unbilledDisb.length) { ctx.setFlash('Nothing unbilled to invoice on this matter.', 'err'); redirect(res, '/r/billing'); return; }
    const fm = feeModelFor(k, ctx.matter.id);
    const inv = recompute({
      number: nextNumber(k), matterId: ctx.matter.id,
      feeModel: fm.feeModel, flatAmount: fm.flatAmount, contingencyPct: fm.contingencyPct,
      lineItems: unbilledTime.map((t) => ({
        timeEntryId: t.id, narrative: String(t.narrative || ''), hours: Number(t.hours) || 0,
        rate: Number(t.rate) || 0, utbms: t.utbms || '', amount: r2((Number(t.hours) || 0) * (Number(t.rate) || 0)), writeDown: 0,
      })),
      disbLines: unbilledDisb.map((d) => ({ disbId: d.id, desc: String(d.desc || ''), amount: r2(d.amount) })),
      status: 'draft', issuedDate: null, paidDate: null,
    });
    const saved = sc.put('invoice', inv);
    k.audit('billing.draft', ctx.matter.id + ':' + inv.number + ':' + inv.total);
    ctx.setFlash(`Draft invoice ${inv.number} generated — review, write down any line, then issue.`);
    redirect(res, '/r/billing?inv=' + encodeURIComponent(saved.id));
  });

  app.route('POST', `/r/${ROOM.id}/writedown`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const sc = ctx.kernel.scope(ctx.matter.id);
    const inv = ctx.body.inv ? sc.get('invoice', ctx.body.inv) : null;
    if (!inv) { ctx.setFlash('Select an invoice to adjust.', 'err'); redirect(res, '/r/billing'); return; }
    if (inv.status !== 'draft') { ctx.setFlash('Only a draft invoice can be adjusted.', 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    for (const l of inv.lineItems || []) {
      const raw = ctx.body['wd:' + l.timeEntryId];
      if (raw === undefined) continue;
      let wd = Number(raw);
      if (!Number.isFinite(wd) || wd < 0) wd = 0;
      if (wd > l.amount) wd = l.amount; // cannot write down more than the line is worth
      l.writeDown = r2(wd);
    }
    recompute(inv);
    sc.put('invoice', inv);
    ctx.kernel.audit('billing.writedown', ctx.matter.id + ':' + inv.number + ':' + inv.writeDowns);
    ctx.setFlash(`Write-downs applied — net fees ${money(inv.fees).replace(/<[^>]+>/g, '')}.`);
    redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id));
  });

  app.route('POST', `/r/${ROOM.id}/issue`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const k = ctx.kernel, sc = k.scope(ctx.matter.id);
    const inv = ctx.body.inv ? sc.get('invoice', ctx.body.inv) : null;
    if (!inv) { ctx.setFlash('Select an invoice to issue.', 'err'); redirect(res, '/r/billing'); return; }
    if (inv.status !== 'draft') { ctx.setFlash(`Invoice ${inv.number} has already been issued.`, 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    // Pre-bill lint gate: no vague/blocked narrative reaches a client's bill.
    const bad = (inv.lineItems || []).map((l) => narrativeLint(l.narrative) ? l.narrative : null).filter(Boolean);
    if (bad.length) {
      k.audit('billing.issue.blocked', ctx.matter.id + ':' + inv.number + ':lint');
      ctx.setFlash(`Cannot issue ${inv.number} — ${bad.length} narrative${bad.length === 1 ? '' : 's'} failed pre-bill lint. Fix them in Trust & Books (room 28) first.`, 'err');
      redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return;
    }
    recompute(inv);
    if (!(inv.total > 0)) { ctx.setFlash('Nothing billable to issue — total is zero.', 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    // Record the receivable: client owes the total; fees to income, disbursements
    // recovered against the expense that funded them.
    const lines = [{ account: 'ar:client', dr: inv.total }];
    if (inv.fees > 0) lines.push({ account: 'operating:income:fees', cr: inv.fees });
    if (inv.disbursements > 0) lines.push({ account: 'operating:expense:disbursements', cr: inv.disbursements });
    k.ledger.post(ctx.matter.id, { date: today(), memo: 'Invoice ' + inv.number, kind: 'invoice', lines });
    // Mark the included time and disbursements billed so they can never be re-billed.
    for (const l of inv.lineItems || []) {
      const te = sc.get('timeEntry', l.timeEntryId);
      if (te && te.state !== 'billed') sc.put('timeEntry', { ...te, state: 'billed', invoiceId: inv.id, invoiceNumber: inv.number });
    }
    for (const d of inv.disbLines || []) {
      const dr = sc.get('disbursement', d.disbId);
      if (dr && dr.state !== 'billed') sc.put('disbursement', { ...dr, state: 'billed', invoiceId: inv.id, invoiceNumber: inv.number });
    }
    inv.status = 'sent'; inv.issuedDate = today();
    sc.put('invoice', inv);
    k.audit('billing.issue', ctx.matter.id + ':' + inv.number + ':' + inv.total);
    ctx.setFlash(`Invoice ${inv.number} issued — receivable recorded and its time marked billed.`);
    redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id));
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const k = ctx.kernel, sc = k.scope(ctx.matter.id);
    const inv = ctx.body.inv ? sc.get('invoice', ctx.body.inv) : null;
    if (!inv) { ctx.setFlash('Select an invoice.', 'err'); redirect(res, '/r/billing'); return; }
    const want = String(ctx.body.status || '');
    if (want !== 'paid') { ctx.setFlash('Unknown status.', 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    if (inv.status !== 'sent') { ctx.setFlash('Only an issued invoice can be marked paid.', 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    if (inv.total > 0) {
      k.ledger.post(ctx.matter.id, {
        date: today(), memo: 'Payment — invoice ' + inv.number, kind: 'payment',
        lines: [{ account: 'operating:bank', dr: inv.total }, { account: 'ar:client', cr: inv.total }],
      });
    }
    inv.status = 'paid'; inv.paidDate = today();
    sc.put('invoice', inv);
    k.audit('billing.paid', ctx.matter.id + ':' + inv.number + ':' + inv.total);
    ctx.setFlash(`Invoice ${inv.number} marked paid — receivable cleared to operating.`);
    redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id));
  });

  app.route('POST', `/r/${ROOM.id}/discard`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const sc = ctx.kernel.scope(ctx.matter.id);
    const inv = ctx.body.inv ? sc.get('invoice', ctx.body.inv) : null;
    if (!inv) { ctx.setFlash('Select an invoice to discard.', 'err'); redirect(res, '/r/billing'); return; }
    if (inv.status !== 'draft') { ctx.setFlash('Only a draft invoice can be discarded — issued invoices are permanent.', 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    sc.del('invoice', inv.id);
    ctx.kernel.audit('billing.discard', ctx.matter.id + ':' + inv.number);
    ctx.setFlash(`Draft invoice ${inv.number} discarded — its time and disbursements stay unbilled.`);
    redirect(res, '/r/billing');
  });

  // Invoice as a downloadable statement. Content-Type + Content-Disposition set;
  // no matter or bad id lands the user back on the room with a flash.
  app.route('GET', `/r/${ROOM.id}/download`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const sc = ctx.kernel.scope(ctx.matter.id);
    const id = ctx.query.get('inv');
    const inv = id ? sc.get('invoice', id) : null;
    if (!inv) { ctx.setFlash('Invoice not found.', 'err'); redirect(res, '/r/billing'); return; }
    const pad = (s, n) => String(s).padEnd(n);
    const L = [];
    L.push('INVOICE ' + inv.number);
    L.push('Matter:  ' + (ctx.matter.title || ''));
    L.push('Client:  ' + (ctx.matter.client || ''));
    L.push('Status:  ' + inv.status + (inv.issuedDate ? '  issued ' + inv.issuedDate : '') + (inv.paidDate ? '  paid ' + inv.paidDate : ''));
    L.push('Fee model: ' + inv.feeModel);
    L.push('');
    L.push('PROFESSIONAL FEES');
    L.push(pad('Narrative', 44) + pad('Hours', 8) + pad('Rate', 12) + pad('Amount', 12) + pad('Write-down', 12) + 'Net');
    for (const l of inv.lineItems || []) {
      const net = r2((Number(l.amount) || 0) - (Number(l.writeDown) || 0));
      L.push(pad(String(l.narrative || '').slice(0, 42), 44) + pad(String(l.hours), 8) + pad(Number(l.rate).toFixed(2), 12) + pad(Number(l.amount).toFixed(2), 12) + pad(Number(l.writeDown || 0).toFixed(2), 12) + net.toFixed(2));
    }
    L.push('');
    L.push('DISBURSEMENTS');
    for (const d of inv.disbLines || []) L.push(pad(String(d.desc || '').slice(0, 42), 44) + Number(d.amount).toFixed(2));
    L.push('');
    L.push('Fees:          ' + inv.fees.toFixed(2));
    L.push('Write-downs:   ' + inv.writeDowns.toFixed(2));
    L.push('Disbursements: ' + inv.disbursements.toFixed(2));
    L.push('TOTAL DUE:     ' + inv.total.toFixed(2));
    ctx.kernel.audit('billing.download', ctx.matter.id + ':' + inv.number);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="invoice-${inv.number}.txt"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(L.join('\n') + '\n');
  });
}

module.exports = { ...ROOM, register };
