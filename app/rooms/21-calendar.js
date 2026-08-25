'use strict';
// Room 21 — Trial Calendar. Deadlines computed from rules, never typed.
const { layout, esc, table, empty, tag, input, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 21, id: 'calendar', title: 'Trial Calendar', phase: 'Argue' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Computed back from the trial date', body: empty('Open a matter to see its calendar.') })); return; }
    const s = k.scope(ctx.matter.id);
    const deadlines = s.list('deadline').sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const jur = ctx.matter.jurisdiction || 'on';
    const jrules = k.rules.rulesFor(jur);
    const today = new Date().toISOString().slice(0, 10);
    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Compute a deadline</h2>
        <form method="POST" action="/r/calendar/compute">
          ${select('rule', 'Rule (' + esc(jur) + ')', jrules.map((r) => [r.id, r.trigger + ' → ' + r.desc]))}
          ${input('trigger', 'Trigger date', { type: 'date', required: true })}
          <button>Compute &amp; calendar</button>
        </form>
        <p class="note">Dates are computed from the rule — counting method, weekend and holiday rolls — and every entry shows the rule it came from. Nothing on this calendar was typed by hand.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">The rulebook — ${esc(jur)}</h2>
        ${table(['Trigger', 'Days', 'Deadline', 'Authority'], jrules.map((r) => [esc(r.trigger), `<span class="num">${r.days}</span>`, esc(r.desc), `<span class="note">${esc(r.cite)}</span>`]))}
      </div>
    </div>
    <h2 class="sec">Calendar — ${esc(ctx.matter.title)}</h2>
    ${deadlines.length ? table(['Due', 'Deadline', 'Trigger', 'Authority', 'Status', ''], deadlines.map((d) => [
      date(d.due) + (d.due < today && d.status === 'open' ? ' ' + tag('OVERDUE', 'gate') : (daysOut(d.due) <= 14 && d.status === 'open' ? ' ' + tag(daysOut(d.due) + 'd', 'navy') : '')),
      esc(d.desc), esc(d.trigger || ''), `<span class="note">${esc(d.rule || '')}</span>`,
      d.status === 'done' ? tag('done', 'ok') : tag('open'),
      d.status === 'open' ? `<form method="POST" action="/r/calendar/done" style="margin:0"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet">Done</button></form>` : '',
    ])) : empty('No deadlines calendared for this matter yet.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Computed back from the trial date — rule shown per date', body }));
  });

  app.route('POST', `/r/${ROOM.id}/compute`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { redirect(res, '/r/calendar'); return; }
    const rule = k.rules.rule(ctx.body.rule);
    if (!rule || !ctx.body.trigger) { ctx.setFlash('Pick a rule and a trigger date.', 'err'); redirect(res, '/r/calendar'); return; }
    const due = k.rules.compute(rule, ctx.body.trigger);
    k.scope(ctx.matter.id).put('deadline', {
      desc: rule.desc, due, rule: rule.cite, trigger: rule.trigger + ' ' + ctx.body.trigger, status: 'open', ruleId: rule.id,
    });
    ctx.setFlash(`Calendared: ${rule.desc} — ${due} (${rule.cite}).`);
    redirect(res, '/r/calendar');
  });

  app.route('POST', `/r/${ROOM.id}/done`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (ctx.matter) {
      const s = k.scope(ctx.matter.id);
      const d = s.get('deadline', ctx.body.id);
      if (d) s.put('deadline', { ...d, status: 'done' });
    }
    redirect(res, '/r/calendar');
  });
}

function daysOut(iso) { return Math.ceil((new Date(iso) - Date.now()) / 86400000); }

module.exports = { ...ROOM, register };
