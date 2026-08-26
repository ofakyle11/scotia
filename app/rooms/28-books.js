'use strict';
// Room 28 — Trust & Books. Append-only double entry; the schema refuses commingling.
const { layout, esc, table, empty, tag, kv, input, select, money, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 28, id: 'books', title: 'Trust & Books', phase: 'Always on' };

// Printing this page yields the trust statement: position, reconciliation
// record and ledger survive; entry forms, export chrome and buttons drop out.
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

const ACCOUNTS = [
  ['trust:bank', 'Trust — bank'],
  ['trust:client', 'Trust — client liability'],
  ['operating:bank', 'Operating — bank'],
  ['operating:income:fees', 'Operating — fee income'],
  ['operating:expense:disbursements', 'Disbursements'],
  ['ar:client', 'Accounts receivable'],
];

// Money arithmetic. Every figure that reaches a total is coerced here first —
// a stored NaN (an old timeEntry written before hours/rate were validated) must
// read as zero and never poison a sum. Comparisons are made in integer cents.
const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round(num(n) * 100) / 100;
const cents = (n) => Math.round(num(n) * 100);

// R-G — pre-bill lint, aligned to 34-billing. 34's narrativeLint is the gate:
// it REFUSES to issue an invoice while any line fails it. This room's lint is
// advisory, but it used to run a looser regex, so an entry stamped lint:null
// here could still block the invoice run in 34 — the narrative passed at entry
// and failed at billing. The regex and the reason strings below are 34's
// superset verbatim (rooms/34-billing.js narrativeLint); keep them identical.
const VAGUE = /^(work on file|attend(?:ed)? to (?:the )?file|attention to (?:the )?file|misc(?:ellaneous)?|various|general|admin(?:istration)?|as discussed|review file|review of file|per instructions)\.?$/i;
function narrativeLint(n) {
  const s = String(n || '').trim();
  if (!s) return 'empty narrative';
  if (s.length < 12) return 'narrative too thin';
  if (VAGUE.test(s)) return 'narrative too vague';
  return null;
}

// CSV for the accountant handoff. Every field is double-quoted with embedded
// quotes doubled, rows end CRLF, and any field starting with = + - or @ gets an
// apostrophe prefix — memo and narrative are user text, so the formula-injection
// guard is non-negotiable.
function csvField(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
const csvRow = (fields) => fields.map(csvField).join(',');

// Wall- and shred-aware ledger reads. The kernel's ledger.list keeps walled
// matters out of firm-wide reads, but the transactions of a shredded
// (destroyed) matter survive in the firm log — and this room must never
// resurrect them, on screen or in the accountant CSVs. Belt and braces:
// only transactions of matters this caller can see, and never a shredded one.
function visibleTxns(ctx, k, matterId) {
  const allowed = new Set((ctx.matters || []).map((m) => m.id));
  return k.ledger.list(matterId).filter((t) => allowed.has(t.matterId) && !k.isShredded(t.matterId));
}
function visibleBalances(ctx, k, matterId) {
  const bal = {};
  for (const t of visibleTxns(ctx, k, matterId)) for (const l of t.lines) {
    bal[l.account] = (bal[l.account] || 0) + (l.dr || 0) - (l.cr || 0);
  }
  return bal;
}

// ---- LSO By-Law 9 trust controls (kernel/trust.js), via the kernel facade ----
// s.7 (no client's money funds another's) and s.18 (monthly three-way trust
// comparison) are implemented once, in kernel/trust.js. A room may not require
// that module directly (CONTRACT: only ../kernel/html.js and ../kernel/http.js),
// so we take it off ctx.kernel where the facade exposes it as `k.trust` and fall
// back to this room's original inline arithmetic where it does not — the checks
// must hold either way, so nothing here depends on the facade being wired.
const trustFacade = (k) => (k && k.trust && typeof k.trust === 'object') ? k.trust : null;
const fn = (o, ...names) => { for (const n of names) if (o && typeof o[n] === 'function') return o[n].bind(o); return null; };

// kernel/trust.js reads exactly one thing — kernel.ledger.balances(matterId) —
// so it is handed a ledger view narrowed to matters this caller may see and
// never a shredded one, the same belt-and-braces filter visibleTxns applies.
// Passing the raw kernel would widen the trust legs to matters this room
// deliberately withholds; the facade may standardise the arithmetic, not the
// visibility rule.
const trustView = (ctx, k) => ({ ledger: { balances: (matterId) => visibleBalances(ctx, k, matterId) } });

// Leg 1 / leg 2 / leg 3 of the three-way comparison. `statementBalance` may be
// undefined when only the ledger and liability legs are being displayed.
function threeWay(ctx, k, statementBalance) {
  const call = fn(trustFacade(k), 'threeWayCheck');
  if (call) return call(trustView(ctx, k), statementBalance);
  const bal = visibleBalances(ctx, k);
  const ledger = r2(bal['trust:bank'] || 0);
  const liabilities = r2(-(bal['trust:client'] || 0));
  const stmt = Number(statementBalance);
  const statement = Number.isFinite(stmt) ? r2(stmt) : null;
  return {
    ledger, liabilities, statement,
    ok: statement !== null && Math.abs(ledger - liabilities) < 0.005 && Math.abs(ledger - statement) < 0.005,
  };
}
// What this matter holds in trust, in dollars.
function heldInTrust(ctx, k, matterId) {
  if (!matterId) return 0;
  const call = fn(trustFacade(k), 'perMatterTrustBalance');
  if (call) return call(trustView(ctx, k), matterId);
  return r2(visibleBalances(ctx, k, matterId)['trust:bank'] || 0);
}
// By-Law 9 s.7: paying `amount` out of this matter's trust must not overdraw it.
function noOverdraw(ctx, k, matterId, amount) {
  const call = fn(trustFacade(k), 'wouldNotOverdraw', 'wouldNoverdraw');
  if (call) return !!call(trustView(ctx, k), matterId, amount);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return false;
  return cents(amt) <= cents(heldInTrust(ctx, k, matterId));
}
// Trust held has fallen below the retainer the signed engagement expects.
function needsReplenishment(ctx, k, matterId, floor) {
  const f = Number(floor);
  if (!Number.isFinite(f) || f <= 0) return false;
  const call = fn(trustFacade(k), 'replenishmentNeeded');
  if (call) return !!call(trustView(ctx, k), matterId, f);
  return cents(heldInTrust(ctx, k, matterId)) < cents(f);
}

// ---- the executed engagement, read from 03-retainer's firm-scope marker ----
// 03-retainer posts `engagementSigned` on signature "so Trust & Books sees the
// commitment"; until now nothing read it. Newest version wins, the same way
// 34-billing's feeModelFor picks the governing engagement.
function signedEngagement(k, matterId) {
  if (!matterId) return null;
  const rows = k.firm.list('engagementSigned', (r) => r.matterId === matterId) || [];
  return rows.slice().sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0)
    || String(b.signedAt || b.createdAt || '').localeCompare(String(a.signedAt || a.createdAt || '')))[0] || null;
}
function feeTerms(sig) {
  const model = String(sig.feeModel || 'hourly');
  if (model === 'hourly') return Number(sig.rate) > 0 ? `hourly at ${money(sig.rate)}/hr` : 'hourly — no rate recorded on the marker';
  if (model === 'flat') return Number(sig.flatAmount) > 0 ? `flat fee ${money(sig.flatAmount)}` : 'flat fee — no amount recorded on the marker';
  if (model === 'contingency') return Number(sig.contingencyPct) > 0 ? `contingency ${esc(String(sig.contingencyPct))}%` : 'contingency — no percentage recorded on the marker';
  return esc(model);
}
function engagementCard(ctx, k) {
  if (!ctx.matter) return '';
  const sig = signedEngagement(k, ctx.matter.id);
  if (!sig) {
    return `<div class="card"><h2 class="sec" style="margin-top:0">Fee commitment</h2>
      ${empty('No signed engagement on file for this matter. Retainer & Scope (room 03) posts the executed terms here on signature; until then this room bills against no recorded agreement.')}</div>`;
  }
  const held = heldInTrust(ctx, k, ctx.matter.id);
  const expected = Number(sig.expectedRetainer);
  const hasExpected = Number.isFinite(expected) && expected > 0;
  const short = hasExpected && needsReplenishment(ctx, k, ctx.matter.id, expected);
  const rows = [
    ['Engagement', `${tag('signed ' + esc(String(sig.signedAt || '').slice(0, 10)), 'ok')} v${esc(String(sig.version ?? '?'))}${sig.signedBy ? ' — recorded by ' + esc(sig.signedBy) : ''}`],
    ['Fee model', feeTerms(sig)],
  ];
  if (hasExpected) {
    rows.push(['Expected retainer', `${money(expected)} — ${money(held)} held in trust ${short ? tag('REPLENISH', 'gate') : tag('funded', 'ok')}`]);
  }
  return `<div class="card"><h2 class="sec" style="margin-top:0">Fee commitment</h2>
    ${kv(rows)}
    <p class="note">From the engagement marker room 03 posts on signature — the terms of record, not a transaction. ${hasExpected ? 'The expected retainer is the engagement’s own flat figure; ' : ''}no funds move until they are posted below.</p>
  </div>`;
}

function exportCard(ctx) {
  const scopeOpts = [['firm', 'Whole firm'], ['matter', 'This matter']];
  const form = (report, labelTxt, btn) => `<div><form method="POST" action="/r/books/export">
    <input type="hidden" name="report" value="${report}">
    ${select('scope', labelTxt, scopeOpts, ctx.matter ? 'matter' : 'firm')}
    <button>${btn}</button>
  </form></div>`;
  return `<div class="noprint"><h2 class="sec">Accountant handoff</h2>
  <div class="card">
    <div class="grid3">
      ${form('gl', 'General ledger', 'Download GL CSV')}
      ${form('trust', 'Trust ledger + balances', 'Download trust CSV')}
      ${form('time', 'Time entries', 'Download time CSV')}
    </div>
    <p class="note">These CSVs disclose memos and time narratives — they are for the firm's accountant, not for production. The trust export (trust ledger lines plus per-matter held-for-client balances) supports the annual three-way-reconciliation review.</p>
  </div></div>`;
}

function reconCard(ctx, k) {
  // Legs 1 and 2 come from the shared trust control (kernel/trust.js) when the
  // facade exposes it, so the displayed comparison and the recorded one are the
  // same computation.
  const legs = threeWay(ctx, k);
  const ledgerTrust = legs.ledger;
  const liabTotal = legs.liabilities;
  // Per-matter breakdown of leg 2: what the trust account owes, and to whom.
  const perMatter = new Map();
  for (const t of visibleTxns(ctx, k)) for (const l of t.lines) {
    if (l.account === 'trust:client') {
      const cur = perMatter.get(t.matterId) || 0;
      perMatter.set(t.matterId, cur + (l.cr || 0) - (l.dr || 0));
    }
  }
  const liabRows = [...perMatter.entries()].filter(([, v]) => Math.abs(v) > 0.004).map(([mid, v]) => {
    const m = k.firm.get('matter', mid);
    return [esc(m ? m.title : mid), money(v)];
  });
  const recons = k.firm.list('reconciliation').sort((a, b2) => (b2.statementDate || '').localeCompare(a.statementDate || '')).slice(0, 6);
  return `<div class="card">
    <h2 class="sec" style="margin-top:0">Three-way reconciliation — firm trust account</h2>
    <div class="grid2">
      <div>
        ${table(['Leg', 'Balance'], [
          ['1 · Trust ledger (trust:bank)', money(ledgerTrust)],
          ['2 · Client trust liabilities (sum of matters)', money(liabTotal)],
          ['Ledger vs liabilities', Math.abs(ledgerTrust - liabTotal) < 0.005 ? tag('agree', 'ok') : tag('DISAGREE', 'gate')],
        ])}
        ${liabRows.length ? table(['Matter', 'Held for client'], liabRows) : ''}
      </div>
      <div>
        <form method="POST" action="/r/books/reconcile">
          ${input('statementBalance', '3 · Bank statement balance', { type: 'number', required: true })}
          ${input('statementDate', 'Statement date', { type: 'date', required: true })}
          <button>Run three-way reconciliation</button>
        </form>
        <p class="note">Leg 3 is the bank's own number. All three must agree; a signed reconciliation record is kept either way — law societies audit the misses too.</p>
      </div>
    </div>
    ${recons.length ? table(['Statement date', 'Bank', 'Ledger', 'Liabilities', 'Result', 'By'], recons.map((r) => [
      date(r.statementDate), money(r.statementBalance), money(r.ledger), money(r.liabilities),
      r.ok ? tag('RECONCILED', 'ok') : tag('OUT OF BALANCE', 'gate'), esc(r.byName || ''),
    ])) : ''}
  </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const txns = visibleTxns(ctx, k, ctx.matter ? ctx.matter.id : undefined).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const bal = visibleBalances(ctx, k, ctx.matter ? ctx.matter.id : undefined);
    const trustBank = ctx.matter ? heldInTrust(ctx, k, ctx.matter.id) : r2(bal['trust:bank'] || 0);
    const trustLiab = r2(-(bal['trust:client'] || 0));
    const reconciled = Math.abs(trustBank - trustLiab) < 0.005;
    const time = ctx.matter ? k.scope(ctx.matter.id).list('timeEntry') : [];
    // R-G — WIP is money: coerce both factors. An entry stored with a NaN hours
    // or rate (they were unvalidated before) must contribute nothing, not turn
    // the whole unbilled figure into NaN. 34/05/36 all read it this way.
    const unbilled = time.filter((t) => t.state !== 'billed').reduce((s, t) => s + num(t.hours) * num(t.rate), 0);

    const body = `
    ${PRINT}
    <div class="print-only"><h2 class="sec" style="margin-top:0">Trust statement — ${ctx.matter ? esc(ctx.matter.title) : 'firm'} — as at ${new Date().toISOString().slice(0, 10)}</h2></div>
    ${ctx.matter ? `
    ${engagementCard(ctx, k)}
    <h2 class="sec">Time — ${esc(ctx.matter.title)} <span class="tag navy">unbilled ${money(unbilled)}</span></h2>
    <div class="card noprint"><form method="POST" action="/r/books/time" class="grid3" style="align-items:end">
      <span>${input('hours', 'Hours', { type: 'number', required: true, placeholder: '0.3' })}</span>
      <span>${input('rate', 'Rate', { type: 'number', required: true, placeholder: '450' })}</span>
      <span>${select('utbms', 'UTBMS', ['L110 Fact investigation', 'L120 Analysis & strategy', 'L190 Other case assessment', 'L210 Pleadings', 'L310 Written discovery', 'L330 Depositions', 'L430 Trial & hearing'])}</span>
      <span style="grid-column:1/-1">${input('narrative', 'Narrative (specific — pre-bill lint rejects vagueness)', { required: true })}</span>
      <button>Record time</button>
    </form></div>
    ${time.length ? table(['Date', 'Hours', 'Rate', 'Value', 'Code', 'Narrative', 'State'], time.slice().reverse().map((t) => [
      date(t.createdAt), `<span class="num">${num(t.hours).toFixed(1)}</span>`, money(num(t.rate)), money(num(t.hours) * num(t.rate)),
      esc((t.utbms || '').slice(0, 4)), esc(t.narrative),
      t.lint ? tag('lint: ' + t.lint, 'gate') : tag(t.state || 'draft'),
    ])) : empty('No time recorded on this matter.')}
    <h2 class="sec">Trust</h2>` : ''}
    <div class="grid3">
      <div class="card"><h2 class="sec" style="margin-top:0">Trust position${ctx.matter ? ' — this matter' : ' — firm'}</h2>
        ${table(['', ''], [
          ['Trust bank', money(trustBank)],
          ['Owed to clients', money(trustLiab)],
          ['Three-way check', reconciled ? tag('reconciled', 'ok') : tag('OUT OF BALANCE', 'gate')],
        ])}
        <p class="note">Client funds are liabilities, never income. The ledger refuses any transaction that would take fees from trust without an explicit, flagged transfer.</p>
      </div>
      <div class="card noprint"><h2 class="sec" style="margin-top:0">Receive retainer into trust</h2>
        <form method="POST" action="/r/books/retainer">
          ${input('amount', 'Amount', { type: 'number', required: true, placeholder: '5000.00' })}
          ${input('memo', 'Memo', { placeholder: 'Initial retainer per engagement letter' })}
          <button>Post to trust</button>
        </form>
      </div>
      <div class="card noprint"><h2 class="sec" style="margin-top:0">Transfer earned fees</h2>
        <form method="POST" action="/r/books/transfer">
          ${input('amount', 'Amount (invoiced & earned)', { type: 'number', required: true })}
          ${input('memo', 'Invoice reference', { required: true, placeholder: 'Invoice 2026-014' })}
          <button class="danger">Trust → operating (flagged)</button>
        </form>
        <p class="note">Posts as an explicit <b>trust-transfer</b> — the only path from trust to fees, and it is audit-flagged.</p>
      </div>
    </div>
    ${reconCard(ctx, k)}
    <h2 class="sec">Ledger${ctx.matter ? ' — this matter' : ''}</h2>
    ${txns.length ? table(['Date', 'Kind', 'Memo', 'Lines'], txns.map((t) => [
      date(t.date), t.kind === 'trust-transfer' ? tag('trust-transfer', 'gate') : tag(t.kind),
      esc(t.memo || ''), t.lines.map((l) => `<span class="num">${esc(l.account)} ${l.dr ? 'DR ' + money(l.dr) : 'CR ' + money(l.cr)}</span>`).join('<br>'),
    ])) : empty('No ledger activity yet.')}
    ${exportCard(ctx)}
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
    const k = ctx.kernel;
    const amt = Number(ctx.body.amount);
    if (!(amt > 0)) { ctx.setFlash('Enter a positive amount.', 'err'); redirect(res, '/r/books'); return; }
    // GATE — By-Law 9 s.7: no client's money funds another's. Decided by the
    // shared trust control where the facade exposes it, by the same test inline
    // where it does not.
    if (!noOverdraw(ctx, k, ctx.matter.id, amt)) {
      ctx.setFlash(`Refused: ${amt.toFixed(2)} exceeds the ${heldInTrust(ctx, k, ctx.matter.id).toFixed(2)} held in trust for this matter. No client's money funds another's (LSO By-Law 9 s.7).`, 'err');
      redirect(res, '/r/books'); return;
    }
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

  app.route('POST', `/r/${ROOM.id}/reconcile`, (req, res, ctx) => {
    const k = ctx.kernel;
    const stmt = Number(ctx.body.statementBalance);
    const sdate = String(ctx.body.statementDate || '');
    if (!Number.isFinite(stmt) || !sdate) { ctx.setFlash('Statement balance and date are required.', 'err'); redirect(res, '/r/books'); return; }
    // By-Law 9 s.18 monthly trust comparison — one implementation, shared with
    // the card above and (where wired) with kernel/trust.js.
    const { ledger, liabilities, statement, ok } = threeWay(ctx, k, stmt);
    k.firm.put('reconciliation', {
      statementDate: sdate, statementBalance: statement === null ? stmt : statement,
      ledger, liabilities, ok, byName: ctx.user.name,
    });
    k.audit('trust.reconciliation', sdate + ':' + (ok ? 'ok' : 'OUT-OF-BALANCE'));
    ctx.setFlash(ok ? `Three-way reconciliation for ${sdate}: all legs agree.` : `Reconciliation for ${sdate} is OUT OF BALANCE — investigate before any further trust activity.`, ok ? undefined : 'err');
    redirect(res, '/r/books');
  });

  app.route('POST', `/r/${ROOM.id}/time`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/books'); return; }
    const narrative = String(ctx.body.narrative || '').trim();
    // R-G — hours and rate are money. Coerce, then refuse the garbage rather
    // than storing a NaN every downstream reader has to defend against.
    const hours = num(ctx.body.hours), rate = num(ctx.body.rate);
    if (!(hours > 0)) { ctx.setFlash('Enter the hours worked (greater than zero).', 'err'); redirect(res, '/r/books'); return; }
    if (rate < 0) { ctx.setFlash('A negative rate is not a rate — enter 0 for no-charge time.', 'err'); redirect(res, '/r/books'); return; }
    const lint = narrativeLint(narrative);
    ctx.kernel.scope(ctx.matter.id).put('timeEntry', {
      hours, rate, utbms: ctx.body.utbms,
      narrative, state: 'draft', lint,
    });
    ctx.setFlash(lint ? `Recorded, but pre-bill lint flagged it: ${lint}. Billing (room 34) refuses to issue an invoice while a line reads like this — fix the narrative before the bill run.` : 'Time recorded.', lint ? 'err' : undefined);
    redirect(res, '/r/books');
  });

  // Accountant handoff — responds directly with the CSV, no redirect. Unknown
  // or empty report/scope defaults to gl/firm so a garbage POST still gets a
  // valid CSV (header row at minimum), never a 500.
  app.route('POST', `/r/${ROOM.id}/export`, (req, res, ctx) => {
    const k = ctx.kernel;
    const report = ['gl', 'trust', 'time'].includes(ctx.body.report) ? ctx.body.report : 'gl';
    const scope = ['matter', 'firm'].includes(ctx.body.scope) ? ctx.body.scope : 'firm';
    const matterId = scope === 'matter' && ctx.matter ? ctx.matter.id : undefined;
    let header;
    const rows = [];
    if (report === 'time') {
      header = ['date', 'matter', 'hours', 'rate', 'value', 'utbms', 'narrative', 'state'];
      for (const m of (matterId ? [ctx.matter] : (ctx.matters || []))) {
        let entries;
        try { entries = k.scope(m.id).list('timeEntry'); } catch (e) { continue; } // walled or shredded — skip
        for (const t of entries) {
          const hours = num(t.hours), rate = num(t.rate);
          rows.push([String(t.createdAt || '').slice(0, 10), m.title, hours, rate.toFixed(2), (hours * rate).toFixed(2), t.utbms || '', t.narrative || '', t.state || 'draft']);
        }
      }
    } else {
      header = ['txnId', 'date', 'matter', 'kind', 'memo', 'account', 'dr', 'cr'];
      // Same discipline as the time report: only matters visible to this
      // caller, never a shredded one — the CSV is bulk disclosure, so the
      // wall and the shredder both apply to it.
      const txns = visibleTxns(ctx, k, matterId);
      for (const t of txns) {
        const m = k.firm.get('matter', t.matterId);
        const title = m ? m.title : t.matterId;
        for (const l of t.lines) {
          if (report === 'trust' && !/^trust/.test(l.account)) continue;
          rows.push([t.id, t.date || '', title, t.kind || '', t.memo || '', l.account, l.dr ? Number(l.dr).toFixed(2) : '', l.cr ? Number(l.cr).toFixed(2) : '']);
        }
      }
      if (report === 'trust') {
        // Trailing per-matter held-for-client balances, computed as reconCard does.
        const perMatter = new Map();
        for (const t of txns) for (const l of t.lines) if (l.account === 'trust:client') {
          perMatter.set(t.matterId, (perMatter.get(t.matterId) || 0) + (l.cr || 0) - (l.dr || 0));
        }
        for (const [mid, v] of perMatter) {
          if (Math.abs(v) <= 0.004) continue;
          const m = k.firm.get('matter', mid);
          rows.push(['', '', m ? m.title : mid, 'balance', 'held for client', 'trust:client', '', v.toFixed(2)]);
        }
      }
    }
    k.audit('books.export', report + ':' + (matterId || 'firm') + ':' + rows.length);
    const today = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chambers-${report}-${scope}-${today}.csv"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end([header, ...rows].map(csvRow).join('\r\n') + '\r\n');
  });
}

module.exports = { ...ROOM, register };
