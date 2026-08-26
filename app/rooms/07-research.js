'use strict';
// Room 07 — Research Desk. Issue framed, conclusion stated, authority weighed.
// Adverse authority renders FIRST — the candour duty is a layout rule here.
//
// Two seams this room owns, both written down in the contract sheet §(f):
//
//   1. `citation_instance` is 08-citations' type, and every gate 08 runs is
//      keyed on `draftId` (regate() lists instances by it; 18-briefs builds its
//      table of authorities from it). An instance minted here without one is
//      orphaned: never gated, never verifiable, "awaiting citation check"
//      forever. So this room never mints one without a draft — the send form
//      carries a draft selector and the route REFUSES when nothing is picked.
//   2. `authority` is written by three rooms in three shapes. 29-canlii stamps
//      source:'canlii-api', 30-uscourts stamps source:'courtlistener', and each
//      reads back only its own. This room stamps source:'research' and reads
//      back only its own (plus sourceless rows written before the stamp
//      existed) — an unfiltered list rendered connector rows with a blank
//      proposition and a 'persuasive' weight tag nobody ever assigned them.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 7, id: 'research', title: 'Research Desk', phase: 'Build' };
const SUB = 'Memos per matter — issue, conclusion, authorities; adverse first';

// This desk's own authorities: the ones it wrote (source:'research') plus the
// ones it wrote before the stamp existed (no source at all). Connector rows —
// 29-canlii's and 30-uscourts' — carry neither memoId, proposition, weight nor
// adverse, and belong to their own rooms. They are counted and pointed at, never
// rendered here as though a lawyer had weighed them.
const isOurs = (a) => !a.source || a.source === 'research';
const gateUrl = (draftId) => '/r/citations?draft=' + encodeURIComponent(draftId);
const draftLabel = (d) => (d.title || '(untitled draft)') + (d.citeStatus === 'clear' ? ' — gate currently clear' : '');

const weightTag = (a) => a.weight === 'binding' ? tag('binding', 'navy') : tag('persuasive');
const byAdverseFirst = (a, b) =>
  ((b.adverse ? 1 : 0) - (a.adverse ? 1 : 0)) ||
  ((b.weight === 'binding' ? 1 : 0) - (a.weight === 'binding' ? 1 : 0)) ||
  (a.createdAt || '').localeCompare(b.createdAt || '');

// Send-to-gate. A citation instance belongs TO A DRAFT; without one 08-citations
// can never gate it and no room can ever verify it. The draft is therefore
// picked here, deliberately (no pre-selected default), and the route refuses a
// blank one. With no draft on the matter at all there is nothing to attach to,
// so no button is offered — the note says where to make one.
function checkCell(a, drafts) {
  if (a.checkId) {
    return tag('in citation check', 'ok') +
      (a.draftId ? ` <a href="${esc(gateUrl(a.draftId))}">open the gate →</a>` : '');
  }
  if (!drafts.length) {
    return `<span class="note">No draft on this matter yet — register one in Citation Check (08), or send one from Brief Writer (18), then this authority can be attached to it.</span>`;
  }
  return `<form method="POST" action="/r/research/send" class="mselect">
    <input type="hidden" name="id" value="${esc(a.id)}">
    <select name="draftId" aria-label="Draft this authority is cited in">
      <option value="">— which draft cites it? —</option>
      ${drafts.map((d) => `<option value="${esc(d.id)}">${esc(draftLabel(d))}</option>`).join('')}
    </select>
    <button class="quiet">send to Citation Check</button>
  </form>`;
}

function authorityRow(a, drafts) {
  return [
    `<span class="num">${esc(a.cite)}</span>`,
    esc(a.court || '—'),
    a.year ? `<span class="num">${esc(a.year)}</span>` : '—',
    weightTag(a),
    a.adverse ? tag('adverse', 'gate') : tag('for us', 'ok'),
    esc(a.proposition),
    `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${checkCell(a, drafts)}
     <form method="POST" action="/r/research/drop" style="margin:0"><input type="hidden" name="id" value="${esc(a.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form></div>`,
  ];
}

function memoCard(m, auths, drafts) {
  const mine = auths.filter((a) => a.memoId === m.id).sort(byAdverseFirst);
  const adverseCount = mine.filter((a) => a.adverse).length;
  return `<div class="card">
    ${kv([
      ['Issue', `<b style="color:var(--ink)">${esc(m.issue)}</b>`],
      ['Conclusion', m.conclusion ? esc(m.conclusion) : tag('unresolved', 'gate')],
      ['Framed', date(m.createdAt) || '—'],
      ['Authorities', `${tag(`${mine.length} cited`)} ${adverseCount ? tag(`${adverseCount} adverse`, 'gate') : ''}`],
    ])}
    ${mine.length
      ? table(['Citation', 'Court', 'Year', 'Weight', 'Cuts', 'Proposition', ''], mine.map((a) => authorityRow(a, drafts)))
      : empty('No authorities on this memo yet — cite the first one below.')}
    <details style="margin-top:12px" ${mine.length ? '' : 'open'}>
      <summary style="cursor:pointer;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-soft)">Add authority</summary>
      <form method="POST" action="/r/research/authority">
        <input type="hidden" name="memoId" value="${esc(m.id)}">
        <div class="grid3">
          <span>${input('cite', 'Citation string', { required: true, placeholder: 'Style of cause, neutral or reporter cite' })}</span>
          <span>${input('court', 'Court', { placeholder: 'e.g. ONCA, SCC, BCSC' })}</span>
          <span>${input('year', 'Year', { placeholder: '2021' })}</span>
        </div>
        <div class="grid2">
          <span>${select('weight', 'Weight', [['binding', 'Binding on this court'], ['persuasive', 'Persuasive only']], 'binding')}</span>
          <span>${select('adverse', 'Adverse?', [['no', 'Supports our position'], ['yes', 'Adverse — cuts against us']], 'no')}</span>
        </div>
        ${textarea('proposition', 'Proposition it stands for', { required: true, placeholder: 'One sentence: what this case actually decides that matters here.' })}
        <button>Cite it</button>
      </form>
    </details>
    <details style="margin-top:8px">
      <summary style="cursor:pointer;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-soft)">${m.conclusion ? 'Revise conclusion' : 'Record conclusion'}</summary>
      <form method="POST" action="/r/research/conclude">
        <input type="hidden" name="id" value="${esc(m.id)}">
        ${textarea('conclusion', 'Conclusion', { required: true, value: m.conclusion || '', placeholder: 'Answer the issue as framed — likely / unlikely / turns on X.' })}
        <button>Save conclusion</button>
      </form>
    </details>
  </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body: empty('Open a matter to work its research memos.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const memos = s.list('memo').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // Filtered, not unfiltered: connector rows are counted below and left to
    // their own rooms rather than rendered here with a blank proposition.
    const auths = s.list('authority', isOurs);
    const connectorCount = s.list('authority', (a) => !isOurs(a)).length;
    // Drafts this matter can attach a citation to. 08-registered drafts and
    // 18-briefs drafts both live in the same type; either can be cited into.
    const drafts = s.list('draft').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const memoById = Object.fromEntries(memos.map((m) => [m.id, m]));
    const adverse = auths.filter((a) => a.adverse).sort(byAdverseFirst);
    const pending = s.list('citation_instance', (c) => c.source === 'research' && c.status === 'unverified').length;

    // Candour duty: authority against us renders before anything else on the page.
    const adverseBlock = adverse.length ? `
    <div class="card" style="border-color:var(--oxide)">
      <h2 class="sec" style="margin-top:0;border-bottom-color:var(--oxide)">Adverse authority ${tag('candour duty', 'gate')}</h2>
      ${table(['Citation', 'Court', 'Year', 'Weight', 'Against us on', 'Memo', ''], adverse.map((a) => {
        const m = memoById[a.memoId];
        return [
          `<span class="num">${esc(a.cite)}</span>`,
          esc(a.court || '—'),
          a.year ? `<span class="num">${esc(a.year)}</span>` : '—',
          weightTag(a),
          esc(a.proposition),
          esc(m ? m.issue : '—'),
          checkCell(a, drafts),
        ];
      }))}
      <p class="note">Candour to the tribunal: each of these gets disclosed and distinguished — never buried. They render here, first, until the memo deals with them.</p>
    </div>` : '';

    const body = `
    ${adverseBlock}
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Frame a new memo</h2>
        <form method="POST" action="/r/research/memo">
          ${textarea('issue', 'Issue as framed', { required: true, placeholder: 'Whether... — one question, precisely put. A vague issue produces a vague memo.' })}
          ${textarea('conclusion', 'Conclusion (leave blank if still open)', { placeholder: 'Answer the issue, or leave it unresolved until the authorities are in.' })}
          <button>Open memo</button>
        </form>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Desk state — ${esc(ctx.matter.title)}</h2>
        <p>
          ${tag(`${memos.length} memo${memos.length === 1 ? '' : 's'}`)}
          ${tag(`${auths.length} authorities`)}
          ${tag(`${auths.filter((a) => a.weight === 'binding').length} binding`, 'navy')}
          ${adverse.length ? tag(`${adverse.length} adverse`, 'gate') : tag('no adverse authority recorded', 'ok')}
          ${pending ? tag(`${pending} awaiting citation check`, 'gate') : ''}
        </p>
        <p class="note">Sending an authority to Citation Check records an <b>unverified</b> instance <b>against a named draft</b> — that draft is blocked from filing until the citation comes back verified, and nothing cited here is good law until it does. An instance with no draft could never be gated by Citation Check (08) or verified by anyone, so the draft is picked when you send it. Retrieval against CourtListener / CAP wires in here — Build Sheet L07; until it lands, authorities are entered by hand and this room fabricates no search results.</p>
        ${connectorCount ? `<p class="note"><span class="num">${connectorCount}</span> further ${connectorCount === 1 ? 'authority' : 'authorities'} on this matter came from the CanLII (29) / CourtListener (30) connectors. They carry no memo, no proposition and no weight — nobody has weighed them — so they are not listed here as research. Open those rooms to see them, or re-enter one under a memo above with the proposition it actually stands for.</p>` : ''}
      </div>
    </div>
    <h2 class="sec">Memos</h2>
    ${memos.length ? memos.map((m) => memoCard(m, auths, drafts)).join('') : empty('No memos yet — frame the first issue above.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });

  app.route('POST', `/r/${ROOM.id}/memo`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const issue = String(ctx.body.issue || '').trim();
    if (!issue) { ctx.setFlash('Frame the issue — a memo without a question answers nothing.', 'err'); redirect(res, '/r/research'); return; }
    ctx.kernel.scope(ctx.matter.id).put('memo', { issue, conclusion: String(ctx.body.conclusion || '').trim() });
    ctx.setFlash('Memo opened. Now find the authority — including the authority against you.');
    redirect(res, '/r/research');
  });

  app.route('POST', `/r/${ROOM.id}/conclude`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const m = ctx.body.id ? s.get('memo', ctx.body.id) : null;
    if (!m) { ctx.setFlash('Memo not found.', 'err'); redirect(res, '/r/research'); return; }
    const conclusion = String(ctx.body.conclusion || '').trim();
    if (!conclusion) { ctx.setFlash('State the conclusion, or leave the memo unresolved as it is.', 'err'); redirect(res, '/r/research'); return; }
    s.put('memo', { ...m, conclusion });
    ctx.setFlash('Conclusion recorded.');
    redirect(res, '/r/research');
  });

  app.route('POST', `/r/${ROOM.id}/authority`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const m = ctx.body.memoId ? s.get('memo', ctx.body.memoId) : null;
    if (!m) { ctx.setFlash('Pick a memo to cite the authority under.', 'err'); redirect(res, '/r/research'); return; }
    const cite = String(ctx.body.cite || '').trim();
    if (!cite) { ctx.setFlash('An authority needs its citation string.', 'err'); redirect(res, '/r/research'); return; }
    const proposition = String(ctx.body.proposition || '').trim();
    if (!proposition) { ctx.setFlash('State the proposition — without one, that is a citation, not research.', 'err'); redirect(res, '/r/research'); return; }
    const year = String(ctx.body.year || '').trim();
    if (year && !/^\d{4}$/.test(year)) { ctx.setFlash('Year must be four digits (or blank).', 'err'); redirect(res, '/r/research'); return; }
    const adverse = ctx.body.adverse === 'yes';
    s.put('authority', {
      memoId: m.id, cite,
      court: String(ctx.body.court || '').trim(),
      year,
      weight: ctx.body.weight === 'persuasive' ? 'persuasive' : 'binding',
      adverse,
      proposition,
      checkId: null,
      draftId: null,
      // Provenance stamp — the same field 29-canlii and 30-uscourts set, so
      // every reader of `authority` can tell a weighed research authority from
      // a connector result instead of guessing from which fields are missing.
      source: 'research',
    });
    ctx.setFlash(adverse
      ? `Adverse authority recorded — ${cite} now renders first on this desk until the memo deals with it.`
      : `Authority recorded: ${cite}.`);
    redirect(res, '/r/research');
  });

  // Send an authority to the citation gate. The draft is REQUIRED: 08-citations
  // gates a draft by listing the citation_instances that carry its draftId, and
  // 18-briefs builds its table of authorities the same way. An instance without
  // one is invisible to both — it can never block, never be verified, and never
  // clear. So: no draft picked, nothing minted.
  app.route('POST', `/r/${ROOM.id}/send`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const a = ctx.body.id ? s.get('authority', ctx.body.id) : null;
    if (!a) { ctx.setFlash('Authority not found.', 'err'); redirect(res, '/r/research'); return; }
    if (!isOurs(a)) { ctx.setFlash('That authority came from a connector, not from a memo — re-enter it under a memo with the proposition it stands for before sending it to the gate.', 'err'); redirect(res, '/r/research'); return; }
    if (a.checkId) { ctx.setFlash('Already sent — that citation is with Citation Check.', 'err'); redirect(res, '/r/research'); return; }
    const draftId = String(ctx.body.draftId || '').trim();
    if (!draftId) {
      ctx.setFlash('Pick the draft this authority is cited in. A citation instance with no draft can never be gated by Citation Check or verified by anyone — so nothing was sent.', 'err');
      redirect(res, '/r/research'); return;
    }
    const draft = s.get('draft', draftId);
    if (!draft) {
      ctx.setFlash('That draft is not on this matter — pick one from the list, or register it in Citation Check (08) first.', 'err');
      redirect(res, '/r/research'); return;
    }
    // 08-citations' duplicate guard is per (draftId, cite), case-insensitive.
    // Honour it from this side too: if that cite is already queued on the draft,
    // link this authority to the existing instance rather than minting a second
    // row for the same citation.
    const existing = s.list('citation_instance', (i) => i.draftId === draft.id &&
      String(i.cite || '').toLowerCase() === String(a.cite || '').toLowerCase())[0];
    const ci = existing || s.put('citation_instance', {
      cite: a.cite, draftId: draft.id, source: 'research', status: 'unverified',
      // Same field set 08-citations mints, so its queue and certificate render
      // a Research-sent row exactly like an extracted one.
      pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null,
      court: a.court || '', year: a.year || '', memoId: a.memoId || null, authorityId: a.id,
    });
    s.put('authority', { ...a, checkId: ci.id, draftId: draft.id });
    // regate() lives in 08-citations and a room may not require another room, so
    // the authoritative recompute happens there. What this room must not do is
    // leave a draft reading 'clear' while it holds a citation nobody has
    // verified — 22-filing files on that flag alone. Move it in the BLOCKING
    // direction only; the gate is never opened from here.
    const inst = s.list('citation_instance', (i) => i.draftId === draft.id);
    if (draft.citeStatus === 'clear' && !inst.every((i) => i.status === 'verified')) {
      s.put('draft', { ...s.get('draft', draft.id), citeStatus: 'blocked', noCitationsFound: false });
      ctx.kernel.audit('research.gate.blocked', ctx.matter.id + ':' + draft.id);
    }
    ctx.setFlash(existing
      ? `${a.cite} was already on “${draft.title || '(untitled draft)'}” in Citation Check — this authority now points at that instance. It stands unverified until it comes back.`
      : `Sent to Citation Check against “${draft.title || '(untitled draft)'}” — ${a.cite} stands unverified, and that draft is blocked from filing until it comes back verified.`);
    redirect(res, '/r/research');
  });

  app.route('POST', `/r/${ROOM.id}/drop`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const a = ctx.body.id ? s.get('authority', ctx.body.id) : null;
    if (!a) { ctx.setFlash('Authority not found.', 'err'); redirect(res, '/r/research'); return; }
    s.del('authority', a.id);
    // Deliberately does NOT delete the citation instance: once a cite is in the
    // gate it is the gate's to dispose of (verify or fail in 08), and dropping a
    // row here must never be a way to make a blocked draft clear itself.
    ctx.setFlash(a.checkId
      ? `Dropped ${a.cite} from the memo. Its citation instance stays in Citation Check — the draft stays blocked until someone verifies or fails it there.`
      : `Dropped ${a.cite} from the memo.`);
    redirect(res, '/r/research');
  });
}

module.exports = { ...ROOM, register };
