'use strict';
// Room 19 — Moot Room. The other side's best case, before they make it.
const { layout, esc, table, empty, tag, input, textarea, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 19, id: 'moot', title: 'Moot Room', phase: 'Argue' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The other side’s best brief', body: empty('Open a matter to moot its drafts.') })); return; }
    const s = k.scope(ctx.matter.id);
    const drafts = s.list('draft');
    const openId = ctx.query.get('d') || (drafts[0] && drafts[0].id);
    const d = openId ? s.get('draft', openId) : null;
    const critiques = d ? s.list('critique', (c) => c.draftId === d.id) : [];
    const bench = d ? s.list('benchQ', (q) => q.draftId === d.id) : [];
    const fatal = critiques.filter((c) => c.severity === 'fatal' && c.status !== 'resolved');
    const body = `
    <div class="card">
      <h2 class="sec" style="margin-top:0">Draft under attack</h2>
      ${drafts.length ? `<form method="GET" action="/r/moot" class="mselect"><select name="d">${drafts.map((x) => `<option value="${esc(x.id)}" ${d && d.id === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select><button class="quiet">Open</button></form>` : empty('No drafts on this matter — write one in the Brief Writer first.')}
      ${d ? `<p class="note" style="margin-top:10px">Vulnerabilities: ${tag(String(critiques.filter((c) => c.severity === 'fatal').length) + ' fatal', fatal.length ? 'gate' : 'ok')} ${tag(String(critiques.filter((c) => c.severity === 'serious').length) + ' serious', 'navy')} ${tag(String(critiques.filter((c) => c.severity === 'minor').length) + ' minor')} — ${fatal.length ? 'unresolved fatal attacks stand. Do not file past them.' : 'no unresolved fatal attacks.'}</p>` : ''}
      <p class="note">Model-generated opposition wires in behind the gateway (Build Sheet L08); whether written by machine or colleague, the attack lands here as the record.</p>
    </div>
    ${d ? `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Log an attack</h2>
        <form method="POST" action="/r/moot/critique">
          <input type="hidden" name="draftId" value="${esc(d.id)}">
          ${select('target', 'Target section', [['conclusion', 'Conclusion'], ['rule', 'Rule'], ['explanation', 'Explanation'], ['application', 'Application'], ['counter', 'Counter-arguments'], ['closing', 'Closing']])}
          ${textarea('attack', 'The strongest opposing argument', { required: true })}
          ${select('severity', 'Severity', ['fatal', 'serious', 'minor'], 'serious')}
          ${textarea('response', 'Our response')}
          <button>Log it</button>
        </form>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Hot bench</h2>
        <form method="POST" action="/r/moot/bench">
          <input type="hidden" name="draftId" value="${esc(d.id)}">
          ${textarea('question', 'Question the bench will ask', { required: true })}
          ${textarea('answer', 'Prepared answer')}
          <button>Add question</button>
        </form>
        ${bench.length ? table(['Question', 'Answer', 'Drilled', ''], bench.map((q) => [esc(q.question), esc(q.answer || ''), q.drilled ? tag('yes', 'ok') : tag('no'),
          `<form method="POST" action="/r/moot/drill" style="margin:0"><input type="hidden" name="id" value="${esc(q.id)}"><button class="quiet">${q.drilled ? 'Un-drill' : 'Drilled'}</button></form>`])) : ''}
      </div>
    </div>
    <h2 class="sec">The attacks — ${esc(d.title)}</h2>
    ${critiques.length ? table(['Target', 'Attack', 'Severity', 'Response', 'Status', ''], critiques.map((c) => [
      esc(c.target), esc(c.attack), tag(c.severity, c.severity === 'fatal' ? 'gate' : c.severity === 'serious' ? 'navy' : ''), esc(c.response || ''),
      c.status === 'resolved' ? tag('resolved', 'ok') : tag('open'),
      `<form method="POST" action="/r/moot/resolve" style="margin:0"><input type="hidden" name="id" value="${esc(c.id)}"><button class="quiet">${c.status === 'resolved' ? 'Reopen' : 'Resolve'}</button></form>`,
    ])) : empty('No attacks logged against this draft yet — that is not the same as none existing.')}` : ''}`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Attacked in-house before filing — vulnerabilities, responses, hot-bench drills', body }));
  });

  app.route('POST', `/r/${ROOM.id}/critique`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const attack = String(ctx.body.attack || '').trim(), draftId = String(ctx.body.draftId || '');
    if (!attack || !draftId) { ctx.setFlash('An attack needs substance and a draft.', 'err'); redirect(res, '/r/moot'); return; }
    ctx.kernel.scope(ctx.matter.id).put('critique', { draftId, target: ctx.body.target, attack, severity: ['fatal', 'serious', 'minor'].includes(ctx.body.severity) ? ctx.body.severity : 'serious', response: ctx.body.response, status: 'open' });
    redirect(res, '/r/moot?d=' + draftId);
  });
  app.route('POST', `/r/${ROOM.id}/bench`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const question = String(ctx.body.question || '').trim(), draftId = String(ctx.body.draftId || '');
    if (!question || !draftId) { ctx.setFlash('A question is required.', 'err'); redirect(res, '/r/moot'); return; }
    ctx.kernel.scope(ctx.matter.id).put('benchQ', { draftId, question, answer: ctx.body.answer, drilled: false });
    redirect(res, '/r/moot?d=' + draftId);
  });
  app.route('POST', `/r/${ROOM.id}/resolve`, (req, res, ctx) => {
    if (ctx.matter) { const s = ctx.kernel.scope(ctx.matter.id); const c = s.get('critique', String(ctx.body.id || '')); if (c) s.put('critique', { ...c, status: c.status === 'resolved' ? 'open' : 'resolved' }); }
    redirect(res, '/r/moot');
  });
  app.route('POST', `/r/${ROOM.id}/drill`, (req, res, ctx) => {
    if (ctx.matter) { const s = ctx.kernel.scope(ctx.matter.id); const q = s.get('benchQ', String(ctx.body.id || '')); if (q) s.put('benchQ', { ...q, drilled: !q.drilled }); }
    redirect(res, '/r/moot');
  });
}

module.exports = { ...ROOM, register };
