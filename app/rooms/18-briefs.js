'use strict';
// Room 18 — Brief Writer. CREAC scaffolds; nothing goes final past the gate.
const { layout, esc, table, empty, tag, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 18, id: 'briefs', title: 'Brief Writer', phase: 'Argue' };
const SECTIONS = [['conclusion', 'Conclusion'], ['rule', 'Rule'], ['explanation', 'Explanation'], ['application', 'Application'], ['counter', 'Counter-arguments'], ['closing', 'Conclusion (closing)']];

// Printing yields the assembled brief — the sections in CREAC order under the
// draft's own heading, followed by its table of authorities. That is the one
// thing this room cannot otherwise show: on screen the argument lives in six
// textareas, and the shared print base in kernel/html.js drops every form. The
// base handles the chrome and the palette; only the paper face of the argument
// itself is set here.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
.brief-sheet h3{font-family:var(--f-display);font-size:12.5pt;font-weight:600;margin:15pt 0 5pt;page-break-after:avoid}
.brief-sheet p.body{white-space:pre-wrap;font-family:Georgia,"Times New Roman",serif;font-size:11.5pt;line-height:1.5;margin:0}
}</style>`;

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const sectionText = (d) => SECTIONS.map(([k2]) => String((d.sections || {})[k2] || '')).join('\n\n').trim();
// A draft registered by Citation Check or Pleadings carries its body in `text`
// (08-citations reads `text || body || sections`) — read all three here too, or
// a registered draft prints and counts as if it were empty.
const registeredBody = (d) => String(d.text || d.body || '');
const wordsOf = (d) => words(sectionText(d) || registeredBody(d));

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The argument, assembled', body: empty('Open a matter above to start a factum, motion or brief.') })); return; }
    const s = k.scope(ctx.matter.id);
    const drafts = s.list('draft').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const openId = ctx.query.get('d') || (drafts[0] && drafts[0].id);
    const d = openId ? s.get('draft', openId) : null;
    const cites = d ? s.list('citation_instance', (c) => c.draftId === d.id) : [];
    const wc = d ? wordsOf(d) : 0;
    const over = d && d.wordLimit && wc > Number(d.wordLimit);
    const today = new Date().toISOString().slice(0, 10);
    // A draft minted by another room has no workflow status — the Filing Room
    // only takes drafts marked 'final', so say so rather than render a blank tag.
    const statusTag = (x) => (x.status ? tag(x.status, x.status === 'final' ? 'ok' : x.status === 'cite-check' ? 'navy' : '') : tag('no status', 'gate'));
    const citeTag = (x) => (x.citeStatus === 'clear'
      ? (x.noCitationsFound ? tag('clear — none found', 'gate') : tag('citations clear', 'ok'))
      : tag('citations unverified', 'gate'));

    const sheet = d ? `
      <div class="print-only brief-sheet">
        <h2 class="sec" style="margin-top:0">${esc(d.title)}</h2>
        <p class="note">${esc(ctx.matter.title)}${d.court ? ' &middot; ' + esc(d.court) : ''} &middot; ${wc} words${d.wordLimit ? ' of ' + esc(d.wordLimit) : ''} &middot; printed ${esc(today)}</p>
        ${sectionText(d)
        ? SECTIONS.filter(([k2]) => String((d.sections || {})[k2] || '').trim()).map(([k2, label]) => `<h3>${esc(label)}</h3><p class="body">${esc(String((d.sections || {})[k2]))}</p>`).join('')
        : (registeredBody(d) ? `<p class="body">${esc(registeredBody(d))}</p>` : '<p class="note">This draft has no text yet.</p>')}
      </div>` : '';

    const bodyBlock = (!sectionText(d || {}) && d && registeredBody(d)) ? `
      <h2 class="sec no-print">Registered body ${tag('written elsewhere', 'navy')}</h2>
      <p class="no-print" style="white-space:pre-wrap;font-family:var(--f-mono);font-size:12px;color:var(--ink-soft);background:var(--ground);border:1px solid var(--rule);padding:12px 14px;margin:0">${esc(registeredBody(d))}</p>
      <p class="note no-print">This draft was registered from another room (Pleadings, or Citation Check directly) and its text lives there. Editing it there re-registers it and resets the citation gate; the CREAC sections below are empty and saving them would not touch this text.</p>` : '';

    const editor = d ? `
      ${sheet}
      <div class="no-print">
        <h2 class="sec" style="margin-top:0">${esc(d.title)} ${statusTag(d)} ${citeTag(d)}</h2>
        ${d.citeStatus === 'clear' && d.noCitationsFound ? '<p class="note">No citations were detected in this draft. Confirm that is correct and that extraction did not silently fail before filing.</p>' : ''}
        ${d.status ? '' : '<p class="note">This draft has no workflow status — it was registered by another room. Send it to Citation Check below to give it one; the Filing Room only takes a draft marked <b>final</b>.</p>'}
        <p class="note" style="margin:0 0 14px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the assembled brief &mdash; sections in order, then the table of authorities.</p>
        <form method="POST" action="/r/briefs/save">
          <input type="hidden" name="id" value="${esc(d.id)}">
          <div class="grid3">
            <span>${input('court', 'Court', { value: d.court, placeholder: 'ONSC (Toronto)' })}</span>
            <span>${input('wordLimit', 'Word limit', { type: 'number', value: d.wordLimit || '' })}</span>
            <span><label>Words</label><p class="num" style="font-size:18px;padding-top:6px">${wc}${d.wordLimit ? ' / ' + esc(d.wordLimit) : ''} ${over ? tag('OVER LIMIT', 'gate') : ''}</p></span>
          </div>
          ${SECTIONS.map(([k2, label]) => textarea('s_' + k2, label, { value: (d.sections || {})[k2] || '' })).join('')}
          <button>Save draft</button>
        </form>
        <form method="POST" action="/r/briefs/status" style="display:inline"><input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="status" value="cite-check"><button class="quiet">Send to Citation Check</button></form>
        <form method="POST" action="/r/briefs/status" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="status" value="final"><button class="${d.citeStatus === 'clear' ? '' : 'danger'}">Mark final</button></form>
        <p class="note">Editing any of the six sections resets citation clearance and demotes a final draft back to draft &mdash; verified text is the text that was verified. Court and word limit are metadata and leave a cleared draft alone.</p>
      </div>
      ${bodyBlock}
      <h2 class="sec">Table of authorities &mdash; this draft ${cites.length ? tag(`${cites.filter((c) => c.status === 'verified').length} of ${cites.length} verified`, cites.every((c) => c.status === 'verified') ? 'ok' : 'gate') : ''}</h2>
      ${cites.length ? table(['Citation', 'Pinpoint', 'Status', 'Checked by'], cites.map((c) => [
      `<span class="num">${esc(c.cite)}</span>`,
      c.pinpoint ? esc(c.pinpoint) : '<span style="color:var(--ink-faint)">—</span>',
      (c.status === 'verified' ? tag('verified', 'ok') : c.status === 'failed' ? tag('failed', 'gate') : tag('unverified'))
        + (c.status === 'failed' && c.failReason ? `<div class="note" style="margin:3px 0 0">${esc(c.failReason)}</div>` : ''),
      esc(c.checkedBy || ''),
    ])) : empty('No citations extracted yet — press Send to Citation Check, then open room 08 to extract and verify them.')}
    ` : '<div class="print-only">Nothing to print from this page until a draft is open — the paper this room yields is one assembled brief.</div>';

    const listCard = `<div class="card">
        <h2 class="sec" style="margin-top:0">Drafts &mdash; ${esc(ctx.matter.title)}</h2>
        ${drafts.length ? table(['Title', 'Type', 'Updated', 'Words', 'Status', 'Citations', ''], drafts.map((x) => [
      esc(x.title || '(untitled)'), esc(x.type || ''), date(x.updatedAt), `<span class="num">${wordsOf(x)}</span>`,
      statusTag(x),
      x.citeStatus === 'clear' ? (x.noCitationsFound ? tag('clear — none found', 'gate') : tag('clear', 'ok')) : tag('unverified', 'gate'),
      `<a href="/r/briefs?d=${esc(x.id)}">open →</a>`,
    ])) : empty('No drafts on this matter yet — name one in the form beside this and the CREAC scaffold opens.')}
      </div>`;
    const newCard = `<div class="card">
        <h2 class="sec" style="margin-top:0">New draft</h2>
        <form method="POST" action="/r/briefs/new">
          ${input('title', 'Title', { required: true, placeholder: 'Factum of the Moving Party' })}
          ${select('type', 'Type', ['motion', 'factum', 'brief', 'letter'], 'factum')}
          <button>Create</button>
        </form>
        <p class="note">Six sections in CREAC order open empty: conclusion first, so the reader knows where the argument lands before it starts.</p>
      </div>`;
    // The open draft's editor is the daily action — it leads; creation and the
    // switch list follow. With nothing to edit, the New-draft form leads.
    const body = PRINT + (d
      ? `${editor}<div class="grid2 no-print" style="margin-top:30px">${listCard}${newCard}</div>`
      : `${editor}<div class="grid2">${newCard}${listCard}</div>`);
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The argument, assembled — and blocked from final until citations clear', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/briefs'); return; }
    const title = String(ctx.body.title || '').trim();
    if (!title) { ctx.setFlash('A title is required — name the document as the court will see it.', 'err'); redirect(res, '/r/briefs'); return; }
    const type = ['motion', 'factum', 'brief', 'letter'].includes(String(ctx.body.type || '')) ? String(ctx.body.type) : 'brief';
    const d = ctx.kernel.scope(ctx.matter.id).put('draft', { title, type, sections: {}, status: 'draft', citeStatus: 'none', court: '', wordLimit: '' });
    ctx.setFlash(`"${title}" opened — write the conclusion first.`);
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
    } else {
      ctx.setFlash('A draft moves to cite-check or to final — nothing else from here.', 'err');
    }
    redirect(res, '/r/briefs?d=' + d.id);
  });
}

module.exports = { ...ROOM, register };
