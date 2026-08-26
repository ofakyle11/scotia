'use strict';
// Room 34 — Billing. The invoice run: unbilled time + disbursements, the fee
// model applied, a numbered draft, per-line write-downs, a pre-bill lint gate,
// and issue -> receivable + time marked billed so nothing is billed twice.
const { layout, esc, table, empty, tag, kv, input, money, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 34, id: 'billing', title: 'Billing', phase: 'Always on' };

// R-G — money arithmetic. Every figure that reaches a total, a comparison, the
// ledger or the page is coerced here first. 28-books stored `hours`/`rate` from
// the form without validating them for a long time, so a legacy timeEntry can
// hold NaN, undefined or a string; a NaN that reaches a sum poisons the whole
// bill, and one that reaches the page prints "NaN" on a client's invoice.
// num() makes any of them zero. Comparisons against the ledger are made in
// integer cents, which is how kernel/api.js ledger.post checks balance.
const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round(num(n) * 100) / 100;
const cents = (n) => Math.round(num(n) * 100);
const today = () => new Date().toISOString().slice(0, 10);

// BILLED-ONCE, the gathering half. "Unbilled" is `state !== 'billed'` everywhere
// in the app, and that stays true — but this room adds the second half for its
// own gathering: an entry that already carries an `invoiceId` was claimed by an
// invoice that has been issued (nothing sets invoiceId before issue), so even if
// its state somehow reads 'draft' it must never be swept into a second bill.
const isUnbilled = (r) => r.state !== 'billed' && !r.invoiceId;

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
// 'engagement'); newest signed version wins, else newest of any status, else
// hourly. The fallback deliberately carries NO rate: an hourly invoice takes the
// rate from each timeEntry, because that is where the rate actually charged for
// that piece of work is recorded. There is no phantom firm-wide rate field here
// and there must never be one — inventing a rate would silently re-price time
// that was recorded at another rate.
const FEE_MODELS = ['hourly', 'flat', 'contingency'];
function feeModelFor(k, matterId) {
  let eng = null;
  try {
    const all = k.scope(matterId).list('engagement');
    const signed = all.filter((e) => e.status === 'signed').sort((a, b) => num(b.version) - num(a.version));
    eng = signed[0] || all.slice().sort((a, b) => num(b.version) - num(a.version))[0] || null;
  } catch (e) { eng = null; }
  if (!eng) return { feeModel: 'hourly', flatAmount: 0, contingencyPct: 0, source: 'default (no engagement on file)' };
  return {
    // An engagement carrying an unrecognised feeModel reads as hourly — which is
    // what recompute() already does with one — so the invoice stores the model it
    // will actually be billed under rather than an out-of-domain string.
    feeModel: FEE_MODELS.includes(eng.feeModel) ? eng.feeModel : 'hourly',
    flatAmount: r2(eng.flatAmount),
    contingencyPct: num(eng.contingencyPct),
    source: 'engagement v' + (eng.version || '?'),
  };
}

// Fees per the model; disbursements and totals from the invoice's own lines.
function recompute(inv) {
  const gross = (inv.lineItems || []).reduce((s, l) => s + num(l.amount), 0);
  const wd = (inv.lineItems || []).reduce((s, l) => s + num(l.writeDown), 0);
  let fees;
  if (inv.feeModel === 'flat') fees = Math.max(0, num(inv.flatAmount) - wd);
  else if (inv.feeModel === 'contingency') fees = 0; // taken from recovery in room 24, not billed hourly
  else fees = Math.max(0, gross - wd); // hourly: each line's own hours x its own rate
  const disb = (inv.disbLines || []).reduce((s, d) => s + num(d.amount), 0);
  inv.fees = r2(fees); inv.disbursements = r2(disb); inv.writeDowns = r2(wd); inv.total = r2(fees + disb);
  return inv;
}

// Firm-wide monotonic invoice counter. Holds a bare number, no matter identity,
// so it leaks nothing across the ethical wall. Never reuses a number.
function nextNumber(k) {
  const cur = k.firm.get('invoiceSeq', 'counter') || { id: 'counter', n: 0 };
  const n = num(cur.n) + 1;
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
    const net = r2(num(l.amount) - num(l.writeDown));
    const wdCell = editable
      ? `<input type="number" step="0.01" min="0" max="${esc(r2(l.amount))}" name="wd:${esc(l.timeEntryId)}" value="${esc(r2(l.writeDown))}" style="margin:0;padding:4px 6px;max-width:110px">`
      : money(l.writeDown);
    return [
      `${esc(l.narrative)} ${lint ? tag('lint: ' + lint, 'gate') : ''}<br><span class="note">${esc(String(l.utbms || '').slice(0, 4))}</span>`,
      `<span class="num">${esc(String(num(l.hours)))}</span>`,
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
      ['Fee model', esc(inv.feeModel || 'hourly') + (inv.feeModel === 'flat' ? ' — ' + money(inv.flatAmount) : inv.feeModel === 'contingency' ? ' — ' + esc(String(num(inv.contingencyPct))) + '%' : '')],
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
      ['Write-downs', num(inv.writeDowns) > 0 ? '−' + money(inv.writeDowns) : money(0)],
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

// BILLED-ONCE, the issuing half. Resolve every frozen line on the draft back to
// its live record BEFORE any money moves. A draft's lineItems are a snapshot
// taken at /draft time; by the time it is issued the underlying entry may have
// been billed by another invoice, or be gone. The old code did `if (te &&
// te.state !== 'billed') put(...)` — it silently SKIPPED marking such a line
// while still charging the client for its amount, which is a double bill with no
// trace. Anything we cannot prove unbilled refuses the whole run instead.
// An entry already stamped with THIS invoice's id is not a conflict: that is a
// prior run of this same invoice that did not finish marking, and re-marking it
// is idempotent.
function resolveBillables(sc, inv) {
  const time = [], disb = [], conflicts = [];
  const claimedElsewhere = (r) => (r.invoiceId && r.invoiceId !== inv.id) || (r.state === 'billed' && r.invoiceId !== inv.id);
  const label = (s) => String(s || '(no description)').slice(0, 40);
  for (const l of inv.lineItems || []) {
    const te = l.timeEntryId ? sc.get('timeEntry', l.timeEntryId) : null;
    if (!te) { conflicts.push(`the time entry behind "${label(l.narrative)}" is no longer on file`); continue; }
    if (claimedElsewhere(te)) { conflicts.push(`"${label(l.narrative)}" was already billed on invoice ${te.invoiceNumber || '(unnumbered)'}`); continue; }
    time.push(te);
  }
  for (const d of inv.disbLines || []) {
    const rec = d.disbId ? sc.get('disbursement', d.disbId) : null;
    if (!rec) { conflicts.push(`the disbursement behind "${label(d.desc)}" is no longer on file`); continue; }
    if (claimedElsewhere(rec)) { conflicts.push(`disbursement "${label(d.desc)}" was already billed on invoice ${rec.invoiceNumber || '(unnumbered)'}`); continue; }
    disb.push(rec);
  }
  return { time, disb, conflicts };
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
    const unbilledTime = time.filter(isUnbilled);
    const disb = sc.list('disbursement');
    const unbilledDisb = disb.filter(isUnbilled);
    const invoices = sc.list('invoice').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const openDraft = invoices.find((i) => i.status === 'draft');
    const selId = ctx.query.get('inv');
    const selected = selId ? sc.get('invoice', selId) : (openDraft || null);

    const grossUnbilled = unbilledTime.reduce((s, t) => s + num(t.hours) * num(t.rate), 0);
    const disbUnbilled = unbilledDisb.reduce((s, d) => s + num(d.amount), 0);
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
      // R-G — this room's narrativeLint IS the gate; 28-books' stored `lint` is
      // advisory. Show the gate's own verdict, so a row tagged clean here really
      // will issue, and surface a stale stored lint (written before 28 aligned to
      // this list) as a note rather than dressing it up as a blocking gate.
      const gate = narrativeLint(t.narrative);
      const stale = !gate && t.lint ? ` <span class="note">${esc(String(t.lint))} (room 28, advisory)</span>` : '';
      return [date(t.createdAt), `<span class="num">${esc(String(num(t.hours)))}</span>`, money(t.rate), money(num(t.hours) * num(t.rate)), esc(t.narrative), (gate ? tag(gate, 'gate') : tag('clean', 'ok')) + stale];
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
    const amt = num(ctx.body.amount); // garbage, empty and NaN all land on 0 and are refused below
    const incurred = String(ctx.body.incurred || '').trim() || today();
    if (!desc) { ctx.setFlash('Describe the disbursement.', 'err'); redirect(res, '/r/billing'); return; }
    if (!(amt > 0)) { ctx.setFlash('Enter a positive disbursement amount.', 'err'); redirect(res, '/r/billing'); return; }
    if (!(r2(amt) > 0)) { ctx.setFlash('That amount rounds to zero — enter at least one cent.', 'err'); redirect(res, '/r/billing'); return; }
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
    const unbilledTime = sc.list('timeEntry').filter(isUnbilled);
    const unbilledDisb = sc.list('disbursement').filter(isUnbilled);
    if (!unbilledTime.length && !unbilledDisb.length) { ctx.setFlash('Nothing unbilled to invoice on this matter.', 'err'); redirect(res, '/r/billing'); return; }
    const fm = feeModelFor(k, ctx.matter.id);
    const inv = recompute({
      number: nextNumber(k), matterId: ctx.matter.id,
      feeModel: fm.feeModel, flatAmount: fm.flatAmount, contingencyPct: fm.contingencyPct,
      // Hourly fees are hours x THIS entry's rate — the engagement carries no
      // rate and none is invented here. Both factors are coerced so a legacy
      // NaN contributes a zero line instead of a NaN total.
      lineItems: unbilledTime.map((t) => ({
        timeEntryId: t.id, narrative: String(t.narrative || ''), hours: num(t.hours),
        rate: num(t.rate), utbms: t.utbms || '', amount: r2(num(t.hours) * num(t.rate)), writeDown: 0,
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
      // Clamp against a COERCED line value. Comparing against a raw l.amount let
      // a line whose amount was NaN or undefined escape the clamp entirely (every
      // comparison with NaN is false), so an unbounded write-down could be stored.
      const cap = r2(l.amount);
      if (wd > cap) wd = cap; // cannot write down more than the line is worth
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
    const back = '/r/billing?inv=' + encodeURIComponent(inv.id);
    // BILLED-ONCE, refusal of re-issue. Only a draft may be issued: a 'sent' or
    // 'paid' invoice has already posted its receivable and marked its time, and
    // running it again would double both.
    if (inv.status !== 'draft') { ctx.setFlash(`Invoice ${inv.number} has already been issued (${inv.status}) — an issued invoice cannot be issued again.`, 'err'); redirect(res, back); return; }
    // Pre-bill lint gate: no vague/blocked narrative reaches a client's bill.
    const bad = (inv.lineItems || []).map((l) => narrativeLint(l.narrative) ? l.narrative : null).filter(Boolean);
    if (bad.length) {
      k.audit('billing.issue.blocked', ctx.matter.id + ':' + inv.number + ':lint');
      ctx.setFlash(`Cannot issue ${inv.number} — ${bad.length} narrative${bad.length === 1 ? '' : 's'} failed pre-bill lint. Fix them in Trust & Books (room 28) first.`, 'err');
      redirect(res, back); return;
    }
    // BILLED-ONCE, per line. Resolve the frozen lines back to live records first.
    const { time, disb, conflicts } = resolveBillables(sc, inv);
    if (conflicts.length) {
      k.audit('billing.issue.blocked', ctx.matter.id + ':' + inv.number + ':billed-once');
      ctx.setFlash(`Cannot issue ${inv.number} — ${conflicts.length} line${conflicts.length === 1 ? '' : 's'} cannot be proved unbilled: ${conflicts.slice(0, 3).join('; ')}. Discard this draft and generate a fresh one.`, 'err');
      redirect(res, back); return;
    }
    recompute(inv);
    if (!(num(inv.total) > 0)) { ctx.setFlash('Nothing billable to issue — total is zero.', 'err'); redirect(res, back); return; }
    // Record the receivable: client owes the total; fees to income, disbursements
    // recovered against the expense that funded them.
    const lines = [{ account: 'ar:client', dr: inv.total }];
    if (inv.fees > 0) lines.push({ account: 'operating:income:fees', cr: inv.fees });
    if (inv.disbursements > 0) lines.push({ account: 'operating:expense:disbursements', cr: inv.disbursements });
    // kernel/api.js ledger.post throws on <2 lines, on an unbalanced entry and on
    // a zero-value one. Prove all three here, in the same integer cents it uses,
    // so a rounding slip flashes a refusal instead of throwing a 500 (and, worse,
    // throwing it part-way through the transition below).
    const drc = lines.reduce((s, l) => s + cents(l.dr), 0);
    const crc = lines.reduce((s, l) => s + cents(l.cr), 0);
    if (lines.length < 2 || drc !== crc || drc === 0) {
      k.audit('billing.issue.blocked', ctx.matter.id + ':' + inv.number + ':unbalanced');
      ctx.setFlash(`Cannot issue ${inv.number} — fees plus disbursements do not balance against the total. Re-apply the write-downs and try again.`, 'err');
      redirect(res, back); return;
    }
    // THE TRANSITION. Everything above is read-only, so every refusal leaves the
    // draft exactly as it was. From here it is one synchronous run with no await
    // and therefore no interleaving: mark each resolved record billed, claim the
    // invoice as 'sent' (which is what makes the re-issue refusal above bite),
    // then post the receivable last, once it has been proved postable. Ordered
    // this way, a failure at any point leaves the money un-posted and the records
    // marked — never a posted receivable on an invoice still open to re-issue.
    for (const te of time) sc.put('timeEntry', { ...te, state: 'billed', invoiceId: inv.id, invoiceNumber: inv.number });
    for (const d of disb) sc.put('disbursement', { ...d, state: 'billed', invoiceId: inv.id, invoiceNumber: inv.number });
    inv.status = 'sent'; inv.issuedDate = today();
    sc.put('invoice', inv);
    try {
      k.ledger.post(ctx.matter.id, { date: today(), memo: 'Invoice ' + inv.number, kind: 'invoice', lines });
    } catch (e) {
      // Pre-validated, so this should be unreachable — but a swallowed 500 here
      // would hide a missing receivable, so say so plainly and audit it.
      k.audit('billing.issue.unposted', ctx.matter.id + ':' + inv.number + ':' + e.message);
      ctx.setFlash(`Invoice ${inv.number} issued and its time marked billed, but the ledger refused the receivable (${e.message}) — check Trust & Books before sending it.`, 'err');
      redirect(res, back); return;
    }
    k.audit('billing.issue', ctx.matter.id + ':' + inv.number + ':' + inv.total);
    ctx.setFlash(`Invoice ${inv.number} issued — receivable recorded, ${time.length} time entr${time.length === 1 ? 'y' : 'ies'} and ${disb.length} disbursement${disb.length === 1 ? '' : 's'} marked billed.`);
    redirect(res, back);
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/billing'); return; }
    const k = ctx.kernel, sc = k.scope(ctx.matter.id);
    const inv = ctx.body.inv ? sc.get('invoice', ctx.body.inv) : null;
    if (!inv) { ctx.setFlash('Select an invoice.', 'err'); redirect(res, '/r/billing'); return; }
    const want = String(ctx.body.status || '');
    if (want !== 'paid') { ctx.setFlash('Unknown status.', 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    if (inv.status !== 'sent') { ctx.setFlash('Only an issued invoice can be marked paid.', 'err'); redirect(res, '/r/billing?inv=' + encodeURIComponent(inv.id)); return; }
    // Coerced: a legacy invoice with a missing or NaN total must not reach the
    // ledger, which throws on a zero-value or unbalanced entry and would 500.
    const paidTotal = r2(inv.total);
    if (paidTotal > 0) {
      k.ledger.post(ctx.matter.id, {
        date: today(), memo: 'Payment — invoice ' + inv.number, kind: 'payment',
        lines: [{ account: 'operating:bank', dr: paidTotal }, { account: 'ar:client', cr: paidTotal }],
      });
    }
    inv.status = 'paid'; inv.paidDate = today();
    sc.put('invoice', inv);
    k.audit('billing.paid', ctx.matter.id + ':' + inv.number + ':' + paidTotal);
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
    L.push('Fee model: ' + (inv.feeModel || 'hourly'));
    L.push('');
    L.push('PROFESSIONAL FEES');
    L.push(pad('Narrative', 44) + pad('Hours', 8) + pad('Rate', 12) + pad('Amount', 12) + pad('Write-down', 12) + 'Net');
    // Every figure below is coerced: the statement is the document a client
    // actually receives, so a legacy field that is missing or NaN must print
    // 0.00, not "NaN" — and `inv.fees.toFixed()` on an invoice written without a
    // fees field threw a TypeError, 500ing this download outright.
    for (const l of inv.lineItems || []) {
      const net = r2(num(l.amount) - num(l.writeDown));
      L.push(pad(String(l.narrative || '').slice(0, 42), 44) + pad(String(num(l.hours)), 8) + pad(r2(l.rate).toFixed(2), 12) + pad(r2(l.amount).toFixed(2), 12) + pad(r2(l.writeDown).toFixed(2), 12) + net.toFixed(2));
    }
    L.push('');
    L.push('DISBURSEMENTS');
    for (const d of inv.disbLines || []) L.push(pad(String(d.desc || '').slice(0, 42), 44) + r2(d.amount).toFixed(2));
    L.push('');
    L.push('Fees:          ' + r2(inv.fees).toFixed(2));
    L.push('Write-downs:   ' + r2(inv.writeDowns).toFixed(2));
    L.push('Disbursements: ' + r2(inv.disbursements).toFixed(2));
    L.push('TOTAL DUE:     ' + r2(inv.total).toFixed(2));
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
