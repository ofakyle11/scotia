'use strict';
// Room 18 — Brief Writer. CREAC scaffolds; nothing goes final past the gate.
const { layout, esc, table, empty, tag, input, textarea, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 18, id: 'briefs', title: 'Brief Writer', phase: 'Argue' };
const SECTIONS = [['conclusion', 'Conclusion'], ['rule', 'Rule'], ['explanation', 'Explanation'], ['application', 'Application'], ['counter', 'Counter-arguments'], ['closing', 'Conclusion (closing)']];

const wordsOf = (d) => SECTIONS.reduce((n, [k2]) => n + String((d.sections || {})[k2] || '').split(/\s+/).filter(Boolean).length, 0);

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The argument, assembled', body: empty('Open a matter to draft.') })); return; }
    const s = k.scope(ctx.matter.id);
    const drafts = s.list('draft').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const openId = ctx.query.get('d') || (drafts[0] && drafts[0].id);
    const d = openId ? s.get('draft', openId) : null;
    const cites = d ? s.list('citation_instance', (c) => c.draftId === d.id) : [];
    const words = d ? wordsOf(d) : 0;
    const over = d && d.wordLimit && words > Number(d.wordLimit);
    const editor = d ? `
      <h2 class="sec">${esc(d.title)} ${tag(d.status, d.status === 'final' ? 'ok' : d.status === 'cite-check' ? 'navy' : '')} ${d.citeStatus === 'clear' ? tag('citations clear', 'ok') : tag('citations unverified', 'gate')}</h2>
      <form method="POST" action="/r/briefs/save">
        <input type="hidden" name="id" value="${esc(d.id)}">
        <div class="grid3">
          <span>${input('court', 'Court', { value: d.court })}</span>
          <span>${input('wordLimit', 'Word limit', { type: 'number', value: d.wordLimit || '' })}</span>
          <span><label>Words</label><p class="num" style="font-size:18px;padding-top:6px">${words}${d.wordLimit ? ' / ' + esc(d.wordLimit) : ''} ${over ? tag('OVER LIMIT', 'gate') : ''}</p></span>
        </div>
        ${SECTIONS.map(([k2, label]) => textarea('s_' + k2, label, { value: (d.sections || {})[k2] || '' })).join('')}
        <button>Save draft</button>
      </form>
      <form method="POST" action="/r/briefs/status" style="display:inline"><input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="status" value="cite-check"><button class="quiet">Send to Citation Check</button></form>
      <form method="POST" action="/r/briefs/status" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="status" value="final"><button class="${d.citeStatus === 'clear' ? '' : 'danger'}">Mark final</button></form>
      <h2 class="sec">Table of authorities — this draft</h2>
      ${cites.length ? table(['Citation', 'Status'], cites.map((c) => [`<span class="num">${esc(c.cite)}</span>`, c.status === 'verified' ? tag('verified', 'ok') : c.status === 'failed' ? tag('failed', 'gate') : tag('unverified')])) : empty('No citations extracted yet — send to Citation Check (room 08).')}
    ` : '';
    const listCard = `<div class="card">
        <h2 class="sec" style="margin-top:0">Drafts — ${esc(ctx.matter.title)}</h2>
        ${drafts.length ? table(['Title', 'Type', 'Status', 'Citations', ''], drafts.map((x) => [esc(x.title), esc(x.type), tag(x.status, x.status === 'final' ? 'ok' : ''), x.citeStatus === 'clear' ? tag('clear', 'ok') : tag('unverified', 'gate'), `<a href="/r/briefs?d=${esc(x.id)}">open →</a>`])) : empty('No drafts on this matter yet — the first one starts beside this.')}
      </div>`;
    const newCard = `<div class="card">
        <h2 class="sec" style="margin-top:0">New draft</h2>
        <form method="POST" action="/r/briefs/new">
          ${input('title', 'Title', { required: true, placeholder: 'Factum of the Moving Party' })}
          ${select('type', 'Type', ['motion', 'factum', 'brief', 'letter'], 'factum')}
          <button>Create</button>
        </form>
      </div>`;
    // The open draft's editor is the daily action — it leads; creation and the
    // switch list follow. With nothing to edit, the New-draft form leads.
    const body = d
      ? `${editor}<div class="grid2" style="margin-top:30px">${listCard}${newCard}</div>`
      : `<div class="grid2">${newCard}${listCard}</div>`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The argument, assembled — and blocked from final until citations clear', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/briefs'); return; }
    const title = String(ctx.body.title || '').trim();
    if (!title) { ctx.setFlash('A title is required.', 'err'); redirect(res, '/r/briefs'); return; }
    const d = ctx.kernel.scope(ctx.matter.id).put('draft', { title, type: ctx.body.type || 'brief', sections: {}, status: 'draft', citeStatus: 'none', court: '', wordLimit: '' });
    redirect(res, '/r/briefs?d=' + d.id);
  });

  app.route('POST', `/r/${ROOM.id}/save`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/briefs'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const d = s.get('draft', String(ctx.body.id || ''));
    if (!d) { ctx.setFlash('Draft not found.', 'err'); redirect(res, '/r/briefs'); return; }
    const sections = {};
    for (const [k2] of SECTIONS) sections[k2] = String(ctx.body['s_' + k2] || '');
    // Only a change to the argument text reopens the citation gate — verified
    // text is the text that was verified, so edited-after-verify sections can
    // never stay 'clear'. Editing metadata alone (court, word limit) leaves a
    // cleared, final draft as it was.
    const sectionsChanged = SECTIONS.some(([k2]) => sections[k2] !== String((d.sections || {})[k2] || ''));
    const next = { ...d, sections, court: ctx.body.court, wordLimit: ctx.body.wordLimit };
    if (sectionsChanged) { next.citeStatus = 'none'; if (next.status === 'final') next.status = 'draft'; }
    s.put('draft', next);
    ctx.setFlash(sectionsChanged
      ? 'Draft saved — sections changed, citation status reset (verified text is the text that was verified).'
      : 'Draft saved.');
    redirect(res, '/r/briefs?d=' + d.id);
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/briefs'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const d = s.get('draft', String(ctx.body.id || ''));
    if (!d) { ctx.setFlash('Draft not found.', 'err'); redirect(res, '/r/briefs'); return; }
    const status = String(ctx.body.status || '');
    if (status === 'final') {
      if (d.citeStatus !== 'clear') { ctx.setFlash('Blocked: this draft has unverified citations. Clear them in Citation Check (room 08) first.', 'err'); redirect(res, '/r/briefs?d=' + d.id); return; }
      s.put('draft', { ...d, status: 'final' });
      ctx.setFlash('Marked final — eligible for the Filing Room.');
    } else if (status === 'cite-check') {
      // Genuinely mark the draft for extraction — Citation Check (room 08)
      // auto-extracts a cite-check draft with no instances yet on open. We
      // mint nothing here, so promise nothing here.
      s.put('draft', { ...d, status: 'cite-check' });
      ctx.kernel.audit('brief.cite-check', ctx.matter.id + ':' + d.id);
      ctx.setFlash('Marked for cite-check — open Citation Check (room 08) to extract and verify its citations.');
    }
    redirect(res, '/r/briefs?d=' + d.id);
  });
}

module.exports = { ...ROOM, register };
