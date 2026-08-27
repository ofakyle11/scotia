'use strict';
// Room 23 — Mediation & ADR. Where most matters actually end.
//
// Three daily actions sit across the top: log an offer, price its cost
// consequences, book the session. Everything below is the record those three
// build — and the record is what gets handed up on costs, so it prints.
const { layout, esc, table, empty, tag, input, textarea, select, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 23, id: 'adr', title: 'Mediation & ADR', phase: 'Resolve' };
const PROCESSES = ['mediation', 'arbitration', 'judicial dispute resolution'];

// Printing yields the settlement record — offers, sessions and the r. 49
// scenarios — the schedule that goes up on a costs submission. The shared base
// in kernel/html.js drops the chrome, the forms and everything marked
// .no-print; only the room heading (no place on a schedule handed to a court)
// and the intake grid's collapse are stated here.
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
const dash = '<span style="color:var(--ink-faint)">—</span>';
const dirTag = (d) => (d === 'made' ? tag('we made', 'navy') : tag('we received'));

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Where most cases end', body: empty('Open a matter above to log its offers, book its sessions and price the cost consequences.') })); return; }
    const s = k.scope(ctx.matter.id);
    const sessions = s.list('adrSession').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const offers = s.list('offer').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const scenarios = s.list('r49scenario').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const today = new Date().toISOString().slice(0, 10);
    // One firm lookup per distinct author instead of one per scenario row.
    const names = new Map();
    const authorOf = (id) => {
      if (!id) return '';
      if (!names.has(id)) { const u = k.firm.get('user', id); names.set(id, u ? u.name : id); }
      return names.get(id);
    };
    const body = `
    ${PRINT}
    <div class="print-only" style="margin-bottom:14px"><h2 class="sec" style="margin-top:0">Settlement record — ${esc(ctx.matter.title)} — as at ${esc(today)}</h2></div>
    <div class="grid3 no-print">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Log an offer</h2>
        <form method="POST" action="/r/adr/offer">
          ${select('direction', 'Direction', [['made', 'We made it'], ['received', 'We received it']], 'received')}
          ${input('amount', 'Amount', { type: 'number', required: true })}
          ${input('date', 'Served / received on', { type: 'date', required: true })}
          ${input('expiry', 'Open until', { type: 'date' })}
          ${textarea('terms', 'Terms')}
          <button>Log offer</button>
        </form>
        <p class="note">Formal offers carry cost consequences — in Ontario, r. 49 shifts costs against a party who beats their own rejected offer. Log everything; the file remembers.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Rule 49 position</h2>
        ${offers.length ? `<form method="POST" action="/r/adr/rule49">
          ${select('offerId', 'Logged offer', offers.map((o) => [o.id, `${o.direction === 'made' ? 'we made' : 'we received'} · $${Number(o.amount || 0).toLocaleString('en-CA')} · ${String(o.date || '').slice(0, 10)}`]))}
          ${select('offeror', 'Offeror', [['plaintiff', 'Plaintiff’s offer'], ['defendant', 'Defendant’s offer']], 'plaintiff')}
          ${input('judgment', 'Hypothetical judgment', { type: 'number', required: true })}
          ${input('hearingDate', 'Hearing date', { type: 'date' })}
          <button>Price the consequences</button>
        </form>` : empty('Log an offer first — r. 49 runs on what is on file.')}
        <p class="note">The arithmetic shows the presumptive r. 49.10 switch on the dates and amounts entered. Entitlement and quantum remain r. 49.13 discretion and counsel's call. No dollar costs figures are computed because none exist on file.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Schedule a session</h2>
        <form method="POST" action="/r/adr/session">
          ${select('process', 'Process', PROCESSES, 'mediation')}
          ${input('provider', 'Provider / neutral', { required: true })}
          ${input('date', 'Session date', { type: 'date', required: true })}
          ${input('briefDue', 'Brief due', { type: 'date' })}
          <button>Schedule</button>
        </form>
        <p class="note">A brief-due date is calendared as a deadline so Trial Calendar (21) and Workflow (27) see it. Mandatory-mediation regimes apply in some jurisdictions (e.g. parts of Ontario) — reference note.</p>
      </div>
    </div>
    <h2 class="sec">Offers on file</h2>
    ${offers.length ? table(['Date', 'Direction', 'Amount', 'Open until', 'r. 49 status', 'Terms'], offers.map((o) => [
      date(o.date), dirTag(o.direction), money(o.amount), date(o.expiry) || dash, offerChip(o, today), esc(o.terms || '') || dash,
    ])) : empty('No offers logged. Log every offer either side makes — the dates are what r. 49 runs on.')}
    <h2 class="sec">Rule 49 scenarios</h2>
    ${scenarios.length ? table(['Offer', 'Offeror', 'Judgment', 'Qualifies', 'Outcome', 'Priced by'], scenarios.map((sc) => {
      const off = offers.find((o) => o.id === sc.offerId);
      return [
        off ? `${dirTag(off.direction)} ${money(off.amount)} · ${date(off.date)}` : tag('offer removed', 'gate'),
        tag(sc.offeror === 'plaintiff' ? 'plaintiff' : 'defendant'),
        money(sc.judgment),
        (sc.flags && sc.flags.length)
          ? sc.flags.map((f) => `<div class="note" style="margin-top:0;color:var(--oxide)">${esc(f)}</div>`).join('')
          : tag('qualifies', 'ok'),
        esc(sc.outcome || ''),
        `${esc(authorOf(sc.createdBy))}<div class="note" style="margin-top:0">${date(sc.createdAt)}</div>`,
      ];
    })) : empty('No scenarios yet — price the consequences before the pre-trial, not in the corridor.')}
    <h2 class="sec">Sessions</h2>
    ${sessions.length ? table(['Date', 'Process', 'Provider', 'Brief due', 'Outcome', ''], sessions.map((x) => [
      date(x.date), tag(x.process, 'navy'), esc(x.provider || ''), date(x.briefDue) || dash,
      x.outcome ? esc(x.outcome) : tag(String(x.date || '') < today ? 'outcome not recorded' : 'upcoming', String(x.date || '') < today ? 'gate' : ''),
      x.outcome ? '' : `<form method="POST" action="/r/adr/outcome" style="margin:0"><input type="hidden" name="id" value="${esc(x.id)}"><input name="outcome" aria-label="Outcome of the ${esc(x.process || 'ADR')} session on ${esc(String(x.date || ''))}" placeholder="settled at $… / no resolution" style="width:200px"><button class="quiet">Record</button></form>`,
    ])) : empty('No sessions booked. Mediators book out months ahead — get the date first, then work back to the brief.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Sessions, offers, and the cost consequences of saying no', body }));
  });

  app.route('POST', `/r/${ROOM.id}/session`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/adr'); return; }
    const provider = trim(ctx.body.provider), when = trim(ctx.body.date), briefDue = trim(ctx.body.briefDue);
    if (!provider || !when) { ctx.setFlash('Provider and session date are required.', 'err'); redirect(res, '/r/adr'); return; }
    if (!isoOk(when)) { ctx.setFlash('Session date must be a real calendar date (YYYY-MM-DD).', 'err'); redirect(res, '/r/adr'); return; }
    if (briefDue && !isoOk(briefDue)) { ctx.setFlash('Brief-due date must be a real calendar date (YYYY-MM-DD).', 'err'); redirect(res, '/r/adr'); return; }
    const process = PROCESSES.includes(ctx.body.process) ? ctx.body.process : PROCESSES[0];
    const s = ctx.kernel.scope(ctx.matter.id);
    s.put('adrSession', { process, provider, date: when, briefDue });
    // A brief-due date is set by the ADR schedule the parties agree with the
    // neutral — no kernel/rules.js rule computes it — so `ruleId` is written as an
    // explicit null rather than omitted. 27-desk's limitation flag and dual-diary
    // tick, 09-jurisdiction's recompute list and the appeal watchdog all resolve a
    // deadline's source through `ruleId`; null tells them this row is manual by
    // design, where a missing field would only mean "written before the field
    // existed". Never a placeholder id: it would read as a rule on file that isn't.
    if (briefDue) s.put('deadline', { desc: `${process} brief due (${provider})`, due: briefDue, rule: 'ADR schedule', ruleId: null, trigger: 'Session ' + when, status: 'open' });
    ctx.setFlash('Session scheduled' + (briefDue ? ' — brief deadline calendared in room 21.' : '.'));
    redirect(res, '/r/adr');
  });

  app.route('POST', `/r/${ROOM.id}/offer`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/adr'); return; }
    const amount = Number(ctx.body.amount), when = trim(ctx.body.date), expiry = trim(ctx.body.expiry);
    if (!Number.isFinite(amount) || amount <= 0 || !when) { ctx.setFlash('A positive amount and a date are required.', 'err'); redirect(res, '/r/adr'); return; }
    if (!isoOk(when)) { ctx.setFlash('Offer date must be a real calendar date (YYYY-MM-DD).', 'err'); redirect(res, '/r/adr'); return; }
    if (expiry && !isoOk(expiry)) { ctx.setFlash('Expiry must be a real calendar date (YYYY-MM-DD).', 'err'); redirect(res, '/r/adr'); return; }
    ctx.kernel.scope(ctx.matter.id).put('offer', { direction: ctx.body.direction === 'made' ? 'made' : 'received', amount, date: when, expiry, terms: trim(ctx.body.terms) });
    ctx.setFlash('Offer logged.');
    redirect(res, '/r/adr');
  });

  app.route('POST', `/r/${ROOM.id}/rule49`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/adr'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const offer = s.get('offer', trim(ctx.body.offerId));
    const judgment = Number(ctx.body.judgment);
    if (!offer || !Number.isFinite(judgment) || judgment <= 0) { ctx.setFlash('Pick a logged offer and enter a hypothetical judgment above zero.', 'err'); redirect(res, '/r/adr'); return; }
    const hdRaw = trim(ctx.body.hearingDate);
    if (hdRaw && !isoOk(hdRaw)) { ctx.setFlash('Hearing date must be a real calendar date (YYYY-MM-DD).', 'err'); redirect(res, '/r/adr'); return; }
    const hearingDate = hdRaw || null;
    const offeror = ctx.body.offeror === 'plaintiff' ? 'plaintiff' : 'defendant';
    // Qualification gates — computed from the record, never assumed (r. 49.10(1)(b)/(2)(b) conditions).
    const flags = [];
    const opensAt = hearingDate || new Date().toISOString().slice(0, 10);
    const expiry = String(offer.expiry || '').slice(0, 10);
    if (expiry && expiry < opensAt) flags.push('expired before trial opens — carries no r. 49 consequences');
    if (hearingDate) {
      const days = (Date.parse(hearingDate) - Date.parse(String(offer.date || '').slice(0, 10))) / 86400000;
      if (Number.isFinite(days) && days < 7) flags.push('served fewer than 7 days before the hearing — outside r. 49.10');
    }
    const qualifies = flags.length === 0;
    let outcome;
    if (!qualifies) outcome = `offer does not qualify under r. 49.10 (${flags.join('; ')}) — costs in the court's discretion (r. 49.13)`;
    else if (offeror === 'plaintiff' && judgment >= offer.amount) outcome = `defendant pays partial-indemnity costs to ${offer.date}, substantial indemnity from that date (r. 49.10(1))`;
    else if (offeror === 'defendant' && judgment <= offer.amount) outcome = `plaintiff recovers partial indemnity only to ${offer.date}; defendant recovers partial indemnity from that date (r. 49.10(2))`;
    else outcome = `no presumptive shift — costs in the court's discretion (r. 49.13)`;
    s.put('r49scenario', { offerId: offer.id, offeror, judgment, hearingDate, qualifies, flags, outcome });
    ctx.kernel.audit('r49.scenario', ctx.matter.id + ':' + offer.id);
    ctx.setFlash('Scenario stored — ' + outcome);
    redirect(res, '/r/adr');
  });

  app.route('POST', `/r/${ROOM.id}/outcome`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/adr'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const x = s.get('adrSession', trim(ctx.body.id));
    const outcome = trim(ctx.body.outcome);
    if (!x || !outcome) { ctx.setFlash('Pick a session and say how it ended.', 'err'); redirect(res, '/r/adr'); return; }
    s.put('adrSession', { ...x, outcome });
    ctx.setFlash('Outcome recorded.');
    redirect(res, '/r/adr');
  });
}

// Status chip on the offer table. For our own offers this is r. 49 leverage and
// it lives and dies on the expiry date; an offer we received is chipped on the
// same arithmetic but claims nothing about leverage — whose costs move is the
// r. 49 scenario's answer, not this cell's.
function offerChip(o, today) {
  const exp = String(o.expiry || '').slice(0, 10);
  if (o.direction !== 'made') {
    if (!exp) return tag('open — no expiry');
    return exp < today ? tag('expired') : tag('open to ' + exp);
  }
  if (exp && exp < today) return tag('expired');
  if (exp) {
    const soon = new Date(Date.parse(today) + 14 * 86400000).toISOString().slice(0, 10);
    if (exp <= soon) return tag('expires ' + exp, 'gate');
  }
  return tag('r. 49 live', 'ok');
}

module.exports = { ...ROOM, register };
