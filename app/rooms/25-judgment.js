'use strict';
// Room 25 — Judgment & Enforcement. A judgment is not money: interest runs from
// the day it was entered, enforcement takes steps, and the file is not finished
// until the debt is actually satisfied.
const { layout, esc, table, empty, tag, input, select, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 25, id: 'judgment', title: 'Judgment & Enforcement', phase: 'Resolve' };
const STEPS = ['demand letter', 'garnishment', 'writ of seizure / judgment lien', 'examination in aid of execution', 'domestication (other jurisdiction)'];

// Printing yields the statement of judgment debt: principal, interest to today,
// recoveries and what is still owing, per debtor. The shared base in
// kernel/html.js drops the chrome, every form and everything marked .no-print
// and re-points the palette; only what it cannot know is stated here — the room
// heading has no place on a statement handed to a debtor or filed on an
// examination in aid of execution, and the intake grids collapse on paper.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

const trim = (v) => String(v ?? '').trim();
const isoOk = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Counsel types money and rates the way counsel writes them — '$1,500.50',
// '5.25%'. Strip the ornament, then insist on a real non-negative figure;
// anything else is refused with a flash, never coerced into a silent 0.
const parseMoney = (v) => {
  const s = trim(v).replace(/[$,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : null;
};
const parseRate = (v) => {
  const s = trim(v).replace(/[%,\s]/g, '');
  return /^\d+(\.\d{1,4})?$/.test(s) ? Number(s) : null;
};

// Simple post-judgment interest — computed, never stored (CONTRACT SHEET):
// amount * rate/100 * days/365. A record whose entry date will not parse
// accrues nothing rather than poisoning every column with NaN.
const perDiem = (j) => (n(j.amount) * (n(j.rate) / 100)) / 365;
const accrued = (j) => {
  const d = String(j.dateEntered || '').slice(0, 10);
  if (!isoOk(d)) return 0;
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(d + 'T00:00:00Z')) / 86400000));
  return perDiem(j) * days;
};
const owingOf = (j) => n(j.amount) + accrued(j) - n(j.recovered);
const rcell = (h) => `<div style="text-align:right">${h}</div>`;
// The appeal clock, read-only. 21-calendar owns the computation and 27-desk
// raises the firm-wide alarm; this is the same test at the place counsel is
// standing when the judgment goes on the file, so the walk to the calendar is
// one click. Matches on the rules.js id, the citation string or the
// description, because only 21-calendar ever writes a ruleId.
const isAppealClock = (d) => /appeal/i.test(String(d.ruleId || '') + ' ' + String(d.rule || '') + ' ' + String(d.desc || ''));

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Getting paid after you win', body: empty('Open a matter above to record its judgment, run interest and work the enforcement steps.') }));
      return;
    }
    // A destroyed matter has no key left to read with — say so instead of
    // throwing on the way into the scope.
    if (k.isShredded(ctx.matter.id)) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Destroyed', body: empty('This matter has been destroyed — the certificate of destruction in the Closing Room is the whole of the record.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const judgments = s.list('judgment');
    const today = new Date().toISOString().slice(0, 10);
    // Outstanding debts first, oldest entry first — the one accruing longest
    // is the one to chase.
    const ordered = judgments.slice().sort((a, b) => (a.satisfied ? 1 : 0) - (b.satisfied ? 1 : 0)
      || String(a.dateEntered || '').localeCompare(String(b.dateEntered || '')));
    const outstanding = judgments.filter((j) => !j.satisfied);
    const totalOwing = outstanding.reduce((t, j) => t + Math.max(0, owingOf(j)), 0);
    const totalRecovered = judgments.reduce((t, j) => t + n(j.recovered), 0);

    // Judgment on the file with no open appeal deadline anywhere on the matter:
    // the appeal period is running and nothing is diarised.
    let appealAlarm = '';
    if (judgments.length) {
      let open = [];
      try { open = s.list('deadline', (d) => d.status === 'open'); } catch { open = []; }
      if (!open.some(isAppealClock)) {
        appealAlarm = `<div class="card no-print" style="border-color:var(--oxide);padding:12px 16px">${tag('APPEAL CLOCK UNCALENDARED', 'gate')} <span class="note">a judgment sits on this file with no open appeal deadline — the period runs whether or not it is diarised.</span> <a href="/r/calendar">Calendar the appeal clock &rarr;</a></div>`;
      }
    }

    const addCard = `<div class="card no-print">
      <h2 class="sec" style="margin-top:0">Record a judgment</h2>
      ${judgments.length ? '' : '<p class="note" style="margin:0 0 4px">Nothing recorded yet. Enter the judgment as it was signed — the interest column and the appeal-clock check both run off the entry date.</p>'}
      <form method="POST" action="/r/judgment/new">
        <div class="grid2">
          <span>${input('debtor', 'Judgment debtor', { required: true, placeholder: 'as named in the order' })}</span>
          <span>${input('court', 'Court', { required: true, placeholder: 'Ontario Superior Court of Justice' })}</span>
        </div>
        <div class="grid3">
          <span>${input('amount', 'Amount', { required: true, placeholder: '1500.50' })}</span>
          <span>${input('dateEntered', 'Entered', { type: 'date', required: true })}</span>
          <span>${input('rate', 'Post-judgment interest %', { required: true, placeholder: '5.0' })}</span>
        </div>
        <p class="note">Interest runs at the rate the order fixes, or at the rate prescribed by the jurisdiction as at the date of entry — enter that figure; nothing here guesses a rate. Enter 0 if none runs.</p>
        <button>Record</button>
      </form>
    </div>`;

    const summary = judgments.length
      ? `<p class="note" style="margin:0 0 16px">${outstanding.length ? tag(outstanding.length + ' outstanding', 'gate') : tag('all satisfied', 'ok')} ${tag(judgments.length + (judgments.length === 1 ? ' judgment' : ' judgments'))} &nbsp; Owing today ${money(totalOwing)} &middot; recovered to date ${money(totalRecovered)}.</p>`
      : '';

    const body = `
    ${PRINT}
    <div class="print-only"><h2 class="sec" style="margin-top:0">Statement of judgment debt — ${esc(ctx.matter.title)} — as at ${esc(today)}</h2></div>
    ${appealAlarm}
    ${judgments.length
      ? `<p class="note no-print" style="margin:0 0 16px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the statement of judgment debt alone — figures as at today, forms and chrome dropped.</p>
      ${summary}${ordered.map((j) => card(s, j)).join('')}${addCard}`
      : addCard}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Interest accruing, enforcement stepping, satisfaction recorded', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/judgment'); return; }
    if (ctx.kernel.isShredded(ctx.matter.id)) { ctx.setFlash('This matter has been destroyed — there is nothing left to record against.', 'err'); redirect(res, '/r/judgment'); return; }
    const amount = parseMoney(ctx.body.amount);
    const rate = parseRate(ctx.body.rate);
    const dateEntered = trim(ctx.body.dateEntered).slice(0, 10);
    const court = trim(ctx.body.court);
    const debtor = trim(ctx.body.debtor);
    if (!debtor) { ctx.setFlash('Name the judgment debtor — enforcement runs against a named person or corporation.', 'err'); redirect(res, '/r/judgment'); return; }
    if (!court) { ctx.setFlash('Name the court that entered the judgment — domestication and enforcement both turn on it.', 'err'); redirect(res, '/r/judgment'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { ctx.setFlash('Enter the judgment amount as a positive figure, e.g. 1500.50.', 'err'); redirect(res, '/r/judgment'); return; }
    if (!isoOk(dateEntered)) { ctx.setFlash('Entry date must be a real calendar date (YYYY-MM-DD) — interest and the appeal clock both run from it.', 'err'); redirect(res, '/r/judgment'); return; }
    if (rate === null) { ctx.setFlash('Enter the post-judgment interest rate as a number, e.g. 5 or 5.25. Enter 0 if no interest runs.', 'err'); redirect(res, '/r/judgment'); return; }
    ctx.kernel.scope(ctx.matter.id).put('judgment', { amount, rate, dateEntered, court, debtor, recovered: 0, satisfied: false });
    ctx.setFlash(`Judgment recorded against ${debtor}. Calendar the appeal period next if it is not already diarised.`);
    redirect(res, '/r/judgment');
  });

  app.route('POST', `/r/${ROOM.id}/step`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/judgment'); return; }
    if (ctx.kernel.isShredded(ctx.matter.id)) { ctx.setFlash('This matter has been destroyed — there is nothing left to enforce against here.', 'err'); redirect(res, '/r/judgment'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const j = s.get('judgment', trim(ctx.body.id));
    const step = trim(ctx.body.step);
    if (!j || !STEPS.includes(step)) { ctx.setFlash('Pick a judgment and one of the listed enforcement steps.', 'err'); redirect(res, '/r/judgment'); return; }
    if (s.list('enfStep', (e) => e.judgmentId === j.id && e.step === step && e.status === 'active').length) {
      ctx.setFlash(`Already running: ${step} against ${j.debtor}. Nothing recorded twice.`, 'err');
      redirect(res, '/r/judgment'); return;
    }
    s.put('enfStep', { judgmentId: j.id, step, started: new Date().toISOString().slice(0, 10), status: 'active' });
    ctx.setFlash(`Enforcement step started: ${step}.`);
    redirect(res, '/r/judgment');
  });

  app.route('POST', `/r/${ROOM.id}/payment`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/judgment'); return; }
    if (k.isShredded(ctx.matter.id)) { ctx.setFlash('This matter has been destroyed — recoveries cannot be recorded against it.', 'err'); redirect(res, '/r/judgment'); return; }
    const s = k.scope(ctx.matter.id);
    const j = s.get('judgment', trim(ctx.body.id));
    const amt = parseMoney(ctx.body.paid);
    if (!j) { ctx.setFlash('Pick the judgment the money came in on.', 'err'); redirect(res, '/r/judgment'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { ctx.setFlash('Enter the amount received as a positive figure, e.g. 250.00.', 'err'); redirect(res, '/r/judgment'); return; }
    // The ledger entry is posted BEFORE the judgment is updated: if the books
    // refuse the transaction, the recovery is not recorded on the judgment.
    k.ledger.post(ctx.matter.id, {
      memo: `Enforcement recovery — ${j.debtor}`, kind: 'recovery',
      lines: [{ account: 'operating:bank', dr: amt }, { account: 'ar:client', cr: amt }],
    });
    const recovered = n(j.recovered) + amt;
    const owing = n(j.amount) + accrued(j) - recovered;
    s.put('judgment', { ...j, recovered, satisfied: owing <= 0.005 });
    ctx.setFlash(`Recovery posted: ${amt.toFixed(2)}. ${owing <= 0.005 ? 'Judgment satisfied.' : 'Still owing ~' + owing.toFixed(2) + '.'}`);
    redirect(res, '/r/judgment');
  });
}

function card(s, j) {
  const int = accrued(j);
  const owing = Math.max(0, owingOf(j));
  const steps = s.list('enfStep', (e) => e.judgmentId === j.id)
    .sort((a, b) => String(a.started || '').localeCompare(String(b.started || '')));
  return `<div class="card">
    <h2 class="sec" style="margin-top:0">${esc(j.debtor || '(debtor not named)')}${j.court ? ' — ' + esc(j.court) : ''} ${j.satisfied ? tag('SATISFIED', 'ok') : tag('outstanding', 'gate')}</h2>
    ${table(['Entered', 'Rate', 'Principal', 'Interest to today', 'Per diem', 'Recovered', 'Owing today'], [[
      date(j.dateEntered),
      rcell(`<span class="num">${esc(String(n(j.rate)))}%</span>`),
      rcell(money(j.amount)),
      rcell(money(int)),
      rcell(money(perDiem(j))),
      rcell(money(j.recovered || 0)),
      rcell(`<b>${money(owing)}</b>`),
    ]])}
    <p class="note">Simple interest, computed to today and never stored. Exemption schedules, garnishment procedure and reciprocal-enforcement routes are per-jurisdiction reference data — check the debtor's jurisdiction before you levy.</p>
    ${steps.length ? table(['Step', 'Started', 'Status'], steps.map((e) => [esc(e.step), date(e.started), tag(e.status)])) : ''}
    ${!j.satisfied ? `
    <div class="grid2 no-print">
      <form method="POST" action="/r/judgment/payment">
        <input type="hidden" name="id" value="${esc(j.id)}">
        ${input('paid', 'Payment received', { required: true, placeholder: '250.00' })}
        <p class="note" style="margin-top:6px">Posts to operating (dr operating:bank / cr ar:client) — a recovery is not trust money.</p>
        <button>Post recovery</button>
      </form>
      <form method="POST" action="/r/judgment/step">
        <input type="hidden" name="id" value="${esc(j.id)}">
        ${select('step', 'Enforcement step', STEPS)}
        <button>Start step</button>
      </form>
    </div>` : ''}
  </div>`;
}

module.exports = { ...ROOM, register };
