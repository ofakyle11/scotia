'use strict';
// Room 19 — Moot Room. The other side's best case, before they make it.
const { layout, esc, table, empty, tag, input, textarea, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 19, id: 'moot', title: 'Moot Room', phase: 'Argue' };

function modelCard(ctx, k, d, s) {
  const enabled = k.ai.enabled();
  const policy = ctx.matter.aiPolicy || 'allowed';
  const oppositions = s.list('oppositionDraft', (o) => o.draftId === d.id);
  return `<div class="card">
    <h2 class="sec" style="margin-top:0">Model adversary</h2>
    <p>${enabled ? tag('gateway configured', 'ok') : tag('gateway off — admin configures at /admin', 'gate')}
       ${policy === 'forbidden' ? tag('model use FORBIDDEN on this matter', 'gate') : tag('model use allowed on this matter', 'navy')}</p>
    <div class="grid2">
      <form method="POST" action="/r/moot/ai-policy" style="margin:0">
        <input type="hidden" name="policy" value="${policy === 'forbidden' ? 'allowed' : 'forbidden'}">
        <input type="hidden" name="draftId" value="${esc(d.id)}">
        <button class="quiet">${policy === 'forbidden' ? 'Allow model use on this matter' : 'Forbid model use on this matter'}</button>
      </form>
      ${enabled && policy !== 'forbidden' ? `<form method="POST" action="/r/moot/ai-oppose" style="margin:0">
        <input type="hidden" name="draftId" value="${esc(d.id)}">
        <button>Generate opposition draft</button>
      </form>` : ''}
    </div>
    ${oppositions.map((o) => `<div style="border:1px solid var(--rule);padding:12px 14px;margin-top:12px;background:var(--ground)">
      ${tag('model-generated — ' + (o.model || 'unknown'), 'gate')} <span class="note">${esc((o.createdAt || '').slice(0, 16).replace('T', ' '))} — a starting point for the record, never the record itself. Log real attacks above.</span>
      <p style="white-space:pre-wrap;font-size:13px;color:var(--ink-soft);margin-top:8px">${esc(o.text)}</p>
    </div>`).join('')}
    <p class="note">The gateway is policy-checked and audited per call. On a local endpoint nothing leaves the building; forbid per matter where the engagement requires it.</p>
  </div>`;
}

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
      <p class="note">Whether written by machine or colleague, the attack lands here as the record.</p>
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
    ])) : empty('No attacks logged against this draft yet — that is not the same as none existing.')}
    ${modelCard(ctx, k, d, s)}` : ''}`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Attacked in-house before filing — vulnerabilities, responses, hot-bench drills', body }));
  });

  app.route('POST', `/r/${ROOM.id}/critique`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const attack = String(ctx.body.attack || '').trim(), draftId = String(ctx.body.draftId || '');
    if (!attack || !draftId) { ctx.setFlash('An attack needs substance and a draft.', 'err'); redirect(res, '/r/moot'); return; }
    ctx.kernel.scope(ctx.matter.id).put('critique', { draftId, target: ctx.body.target, attack, severity: ['fatal', 'serious', 'minor'].includes(ctx.body.severity) ? ctx.body.severity : 'serious', response: ctx.body.response, status: 'open' });
    redirect(res, '/r/moot?d=' + encodeURIComponent(draftId));
  });
  app.route('POST', `/r/${ROOM.id}/bench`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const question = String(ctx.body.question || '').trim(), draftId = String(ctx.body.draftId || '');
    if (!question || !draftId) { ctx.setFlash('A question is required.', 'err'); redirect(res, '/r/moot'); return; }
    ctx.kernel.scope(ctx.matter.id).put('benchQ', { draftId, question, answer: ctx.body.answer, drilled: false });
    redirect(res, '/r/moot?d=' + encodeURIComponent(draftId));
  });
  app.route('POST', `/r/${ROOM.id}/resolve`, (req, res, ctx) => {
    let back = '/r/moot';
    if (ctx.matter) { const s = ctx.kernel.scope(ctx.matter.id); const c = s.get('critique', String(ctx.body.id || '')); if (c) { s.put('critique', { ...c, status: c.status === 'resolved' ? 'open' : 'resolved' }); back += '?d=' + encodeURIComponent(c.draftId); } }
    redirect(res, back);
  });
  app.route('POST', `/r/${ROOM.id}/ai-policy`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const k = ctx.kernel;
    const m2 = k.firm.get('matter', ctx.matter.id);
    const policy = ctx.body.policy === 'forbidden' ? 'forbidden' : 'allowed';
    k.firm.put('matter', { ...m2, aiPolicy: policy });
    k.audit('matter.aiPolicy', ctx.matter.id + ':' + policy);
    ctx.setFlash(policy === 'forbidden' ? 'Model use forbidden on this matter — the gateway will refuse.' : 'Model use allowed on this matter.');
    redirect(res, '/r/moot' + (ctx.body.draftId ? '?d=' + encodeURIComponent(String(ctx.body.draftId)) : ''));
  });

  app.route('POST', `/r/${ROOM.id}/ai-oppose`, async (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const k = ctx.kernel;
    const s = k.scope(ctx.matter.id);
    const d = s.get('draft', String(ctx.body.draftId || ''));
    if (!d) { ctx.setFlash('Pick a draft first.', 'err'); redirect(res, '/r/moot'); return; }
    const sections = Object.entries(d.sections || {}).map(([k2, v]) => v ? `## ${k2}\n${v}` : '').filter(Boolean).join('\n\n');
    if (!sections.trim()) { ctx.setFlash('That draft has no content to attack yet.', 'err'); redirect(res, '/r/moot?d=' + d.id); return; }
    const out = await k.ai.chat(ctx.matter.id, [
      { role: 'system', content: 'You are opposing counsel of the highest calibre. Write the strongest, most specific attack on the draft argument you are given: identify the weakest factual assertions, the doctrinal gaps, the authority that likely cuts the other way (describe it by doctrine — do NOT fabricate citations), and the three questions a hot bench would ask. Be ruthless and concrete. End with the single most dangerous vulnerability.' },
      { role: 'user', content: sections.slice(0, 24000) },
    ]);
    if (!out.ok) { ctx.setFlash('Model: ' + out.message, 'err'); redirect(res, '/r/moot?d=' + d.id); return; }
    s.put('oppositionDraft', { draftId: d.id, text: out.text, model: out.model });
    ctx.setFlash('Opposition draft generated — model-tagged, on the record. Convert what survives your judgment into logged attacks.');
    redirect(res, '/r/moot?d=' + d.id);
  });

  app.route('POST', `/r/${ROOM.id}/drill`, (req, res, ctx) => {
    let back = '/r/moot';
    if (ctx.matter) { const s = ctx.kernel.scope(ctx.matter.id); const q = s.get('benchQ', String(ctx.body.id || '')); if (q) { s.put('benchQ', { ...q, drilled: !q.drilled }); back += '?d=' + encodeURIComponent(q.draftId); } }
    redirect(res, back);
  });
}

module.exports = { ...ROOM, register };
