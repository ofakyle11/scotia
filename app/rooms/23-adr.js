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
    const body = `
    <div class="grid2">
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
    </div>
    <h2 class="sec">Sessions</h2>
    ${sessions.length ? table(['Process', 'Provider', 'Date', 'Brief due', 'Outcome', ''], sessions.map((x) => [
      tag(x.process, 'navy'), esc(x.provider), date(x.date), date(x.briefDue), x.outcome ? esc(x.outcome) : tag('pending'),
      x.outcome ? '' : `<form method="POST" action="/r/adr/outcome" style="margin:0"><input type="hidden" name="id" value="${esc(x.id)}"><input name="outcome" placeholder="settled at $… / no resolution" style="width:200px"><button class="quiet">Record</button></form>`,
    ])) : empty('No ADR sessions yet.')}
    <h2 class="sec">Offer history</h2>
    ${offers.length ? table(['Direction', 'Amount', 'Date', 'Open until', 'Terms', 'Response'], offers.map((o) => [
      o.direction === 'made' ? tag('made', 'navy') : tag('received'), money(o.amount), date(o.date), date(o.expiry), esc(o.terms || ''), esc(o.response || 'open'),
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
    if (ctx.body.briefDue) s.put('deadline', { desc: `${ctx.body.process} brief due (${provider})`, due: ctx.body.briefDue, rule: 'ADR schedule', trigger: 'Session ' + ctx.body.date, status: 'open' });
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

module.exports = { ...ROOM, register };
