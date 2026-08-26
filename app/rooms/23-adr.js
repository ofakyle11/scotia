'use strict';
// Room 23 — Mediation & ADR. Where most matters actually end.
const { layout, esc, table, empty, tag, input, textarea, select, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 23, id: 'adr', title: 'Mediation & ADR', phase: 'Resolve' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Where most cases end', body: empty('Open a matter to manage its ADR track.') })); return; }
    const s = k.scope(ctx.matter.id);
    const sessions = s.list('adrSession').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const offers = s.list('offer').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const scenarios = s.list('r49scenario').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const today = new Date().toISOString().slice(0, 10);
    const body = `
    <div class="grid3">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Log an offer</h2>
        <form method="POST" action="/r/adr/offer">
          ${select('direction', 'Direction', [['made', 'We made it'], ['received', 'We received it']], 'received')}
          ${input('amount', 'Amount', { type: 'number', required: true })}
          ${input('date', 'Date', { type: 'date', required: true })}
          ${input('expiry', 'Open until', { type: 'date' })}
          ${textarea('terms', 'Terms')}
          <button>Log offer</button>
        </form>
        <p class="note">Formal offers carry cost consequences — in Ontario, r. 49 shifts costs against a party who beats their own rejected offer. Log everything; the file remembers.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Rule 49 position</h2>
        ${offers.length ? `<form method="POST" action="/r/adr/rule49">
          ${select('offerId', 'Logged offer', offers.map((o) => [o.id, `${o.direction} · $${Number(o.amount).toLocaleString('en-CA')} · ${String(o.date || '').slice(0, 10)}`]))}
          ${select('offeror', 'Offeror', [['plaintiff', 'Plaintiff’s offer'], ['defendant', 'Defendant’s offer']], 'plaintiff')}
          ${input('judgment', 'Hypothetical judgment', { type: 'number', required: true })}
          ${input('hearingDate', 'Hearing date (optional)', { type: 'date' })}
          <button>Price the consequences</button>
        </form>` : empty('Log an offer first — r. 49 runs on what is on file.')}
        <p class="note">The arithmetic shows the presumptive r. 49.10 switch on the dates and amounts entered. Entitlement and quantum remain r. 49.13 discretion and counsel's call. No dollar costs figures are computed because none exist on file.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Schedule a session</h2>
        <form method="POST" action="/r/adr/session">
          ${select('process', 'Process', ['mediation', 'arbitration', 'judicial dispute resolution'], 'mediation')}
          ${input('provider', 'Provider / neutral', { required: true })}
          ${input('date', 'Date', { type: 'date', required: true })}
          ${input('briefDue', 'Brief due', { type: 'date' })}
          <button>Schedule</button>
        </form>
        <p class="note">A brief-due date is calendared as a deadline so Trial Calendar and Workflow see it. Mandatory-mediation regimes apply in some jurisdictions (e.g. parts of Ontario) — reference note.</p>
      </div>
    </div>
    <h2 class="sec">Rule 49 scenarios</h2>
    ${scenarios.length ? table(['Offer', 'Offeror', 'Judgment', 'Outcome', 'Flags', 'Logged'], scenarios.map((sc) => {
      const off = offers.find((o) => o.id === sc.offerId);
      const who = k.firm.get('user', sc.createdBy);
      return [
        off ? `${off.direction === 'made' ? tag('made', 'navy') : tag('received')} ${money(off.amount)} · ${date(off.date)}` : tag('offer removed'),
        esc(sc.offeror), money(sc.judgment), esc(sc.outcome),
        (sc.flags && sc.flags.length) ? sc.flags.map((f) => `<div class="note" style="margin-top:0;color:var(--oxide)">${esc(f)}</div>`).join('') : tag('qualifies', 'ok'),
        `${esc(who ? who.name : (sc.createdBy || ''))}<div class="note" style="margin-top:0">${date(sc.createdAt)}</div>`,
      ];
    })) : empty('No scenarios yet — price the consequences before the pre-trial, not in the corridor.')}
    <h2 class="sec">Sessions</h2>
    ${sessions.length ? table(['Process', 'Provider', 'Date', 'Brief due', 'Outcome', ''], sessions.map((x) => [
      tag(x.process, 'navy'), esc(x.provider), date(x.date), date(x.briefDue), x.outcome ? esc(x.outcome) : tag('pending'),
      x.outcome ? '' : `<form method="POST" action="/r/adr/outcome" style="margin:0"><input type="hidden" name="id" value="${esc(x.id)}"><input name="outcome" placeholder="settled at $… / no resolution" style="width:200px"><button class="quiet">Record</button></form>`,
    ])) : empty('No ADR sessions yet.')}
    <h2 class="sec">Offer history</h2>
    ${offers.length ? table(['Direction', 'Amount', 'Date', 'Open until', 'Terms', 'r. 49 status'], offers.map((o) => [
      o.direction === 'made' ? tag('made', 'navy') : tag('received'), money(o.amount), date(o.date), date(o.expiry), esc(o.terms || ''),
      offerChip(o, today),
    ])) : empty('No offers logged.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Sessions, offers, and the cost consequences of saying no', body }));
  });

  app.route('POST', `/r/${ROOM.id}/session`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/adr'); return; }
    const provider = String(ctx.body.provider || '').trim();
    if (!provider || !ctx.body.date) { ctx.setFlash('Provider and date are required.', 'err'); redirect(res, '/r/adr'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    s.put('adrSession', { process: ctx.body.process, provider, date: ctx.body.date, briefDue: ctx.body.briefDue });
    // A brief-due date is set by the ADR schedule the parties agree with the
    // neutral — no kernel/rules.js rule computes it — so `ruleId` is written as an
    // explicit null rather than omitted. 27-desk's limitation flag and dual-diary
    // tick, 09-jurisdiction's recompute list and the appeal watchdog all resolve a
    // deadline's source through `ruleId`; null tells them this row is manual by
    // design, where a missing field would only mean "written before the field
    // existed". Never a placeholder id: it would read as a rule on file that isn't.
    if (ctx.body.briefDue) s.put('deadline', { desc: `${ctx.body.process} brief due (${provider})`, due: ctx.body.briefDue, rule: 'ADR schedule', ruleId: null, trigger: 'Session ' + ctx.body.date, status: 'open' });
    ctx.setFlash('Session scheduled' + (ctx.body.briefDue ? ' — brief deadline calendared.' : '.'));
    redirect(res, '/r/adr');
  });
  app.route('POST', `/r/${ROOM.id}/offer`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/adr'); return; }
    const amount = Number(ctx.body.amount);
    if (!(amount > 0) || !ctx.body.date) { ctx.setFlash('A positive amount and a date are required.', 'err'); redirect(res, '/r/adr'); return; }
    ctx.kernel.scope(ctx.matter.id).put('offer', { direction: ctx.body.direction === 'made' ? 'made' : 'received', amount, date: ctx.body.date, expiry: ctx.body.expiry, terms: ctx.body.terms });
    redirect(res, '/r/adr');
  });
  app.route('POST', `/r/${ROOM.id}/rule49`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/adr'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const offer = s.get('offer', String(ctx.body.offerId || ''));
    const judgment = Number(ctx.body.judgment);
    if (!offer || !(judgment > 0)) { ctx.setFlash('Pick a logged offer and enter a hypothetical judgment above zero.', 'err'); redirect(res, '/r/adr'); return; }
    const hdRaw = String(ctx.body.hearingDate || '').trim();
    if (hdRaw && !/^\d{4}-\d{2}-\d{2}$/.test(hdRaw)) { ctx.setFlash('Hearing date must be an ISO date (YYYY-MM-DD).', 'err'); redirect(res, '/r/adr'); return; }
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
    if (ctx.matter) {
      const s = ctx.kernel.scope(ctx.matter.id);
      const x = s.get('adrSession', String(ctx.body.id || ''));
      const outcome = String(ctx.body.outcome || '').trim();
      if (x && outcome) s.put('adrSession', { ...x, outcome });
    }
    redirect(res, '/r/adr');
  });
}

// Status chip for our own offers: r. 49 leverage lives and dies on the expiry date.
function offerChip(o, today) {
  if (o.direction !== 'made') return '';
  const exp = String(o.expiry || '').slice(0, 10);
  if (exp && exp < today) return tag('expired');
  if (exp) {
    const soon = new Date(Date.parse(today) + 14 * 86400000).toISOString().slice(0, 10);
    if (exp <= soon) return tag('expires ' + exp, 'gate');
  }
  return tag('r. 49 live', 'ok');
}

module.exports = { ...ROOM, register };
