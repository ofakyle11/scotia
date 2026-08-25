'use strict';
// Room 08 — Citation Check. The blocking gate: a draft does not clear this
// room while any citation in it is unverified or failed. Extraction is a
// deliberately over-broad reference-pattern pass; every row is cleared by a
// human, one confirmation at a time. Nothing here auto-verifies anything.
const { layout, esc, table, empty, tag, kv, input, textarea, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 8, id: 'citations', title: 'Citation Check', phase: 'Build' };

// Reference extraction patterns — heuristic, meant to over-capture. A human
// dismisses false positives by failing them; a machine never promotes a row.
const CITE_PATTERNS = [
  // Style of cause: "R. v. Jordan", "Donoghue v. Stevenson", "Carter v. Canada"
  /\b(?:R\.|[A-Z][A-Za-z'’.-]+(?:\s+(?:of|the|[A-Z][A-Za-z'’.-]+)){0,4})\s+v\.\s+[A-Z][A-Za-z'’.-]+(?:\s+(?:of|the|[A-Z][A-Za-z'’.-]+)){0,4}/g,
  // Bracket-year reports: "[1990] 2 S.C.R. 1199", "[1932] A.C. 562", "[2019] UKSC 38"
  /\[(?:19|20)\d{2}\]\s+(?:\d+\s+)?[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,2}\s+\d{1,5}\b/g,
  // Neutral citations: "2016 SCC 27", "2019 ONCA 241", "2008 BCSC 1416"
  /\b(?:19|20)\d{2}\s+[A-Z]{2,6}\s+\d{1,5}\b/g,
  // Volume–reporter–page: "376 F.3d 1113", "543 U.S. 220", "58 O.R. (3d) 165", "153 D.L.R. (4th) 193"
  /\b\d{1,4}\s+(?:F\.\s?(?:2d|3d|4th)|F\.\s?Supp\.(?:\s?[23]d)?|U\.S\.|S\.\s?Ct\.|S\.C\.R\.|O\.R\.|D\.L\.R\.|C\.C\.C\.|W\.W\.R\.|A\.C\.)(?:\s?\(\d(?:d|st|nd|rd|th)\))?\s+\d{1,5}\b/g,
];

function extractCites(text) {
  const found = [];
  const seen = new Set();
  for (const rx of CITE_PATTERNS) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const cite = m[0].replace(/\s+/g, ' ').trim();
      const key = cite.toLowerCase();
      if (!seen.has(key)) { seen.add(key); found.push(cite); }
      if (found.length >= 200) break;
    }
    if (found.length >= 200) break;
  }
  // Drop a match wholly contained in another (e.g. "1 S.C.R. 87" inside "[2014] 1 S.C.R. 87").
  return found.filter((c) => !found.some((o) => o !== c && o.toLowerCase().includes(c.toLowerCase())));
}

const today = () => new Date().toISOString().slice(0, 10);
const roomUrl = (draftId) => '/r/citations' + (draftId ? '?draft=' + encodeURIComponent(draftId) : '');
const draftText = (d) => String(d.text || d.body || '');

// Recompute the gate for one draft and write citeStatus back onto the draft
// record. Verified-all (and only that) opens the gate.
function regate(s, draftId) {
  const draft = s.get('draft', draftId);
  if (!draft) return null;
  const inst = s.list('citation_instance', (i) => i.draftId === draftId);
  const citeStatus = inst.every((i) => i.status === 'verified') ? 'clear' : 'blocked';
  s.put('draft', { ...draft, citeStatus });
  return citeStatus;
}

function gateTag(d, inst) {
  if (!inst.length && !d.scannedAt) return d.citeStatus === 'clear' ? tag('clear', 'ok') : tag('unchecked');
  if (inst.some((i) => i.status === 'failed')) return tag('blocked — failed cites', 'gate');
  if (inst.some((i) => i.status === 'unverified')) return tag('blocked — unverified', 'gate');
  return tag('clear', 'ok');
}

const CHECKS = [
  ['resolves', 'Resolves to a real case — looked up, not assumed'],
  ['quoteOk', 'Quoted / paraphrased passage matches the source'],
  ['treatment', 'Treatment current — not overruled, reversed or negatively treated'],
];
const checkboxes = () => CHECKS.map(([n, l]) =>
  `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13px;color:var(--ink-soft)"><input type="checkbox" name="${n}" value="1" style="width:auto"> ${esc(l)}</label>`).join('');

function verifyCard(inst) {
  return `<div style="border:1px solid var(--rule);padding:12px 14px;margin-bottom:10px;background:var(--ground)">
    <b class="num">${esc(inst.cite)}</b>
    <form method="POST" action="/r/citations/verify">
      <input type="hidden" name="id" value="${esc(inst.id)}">
      ${input('pinpoint', 'Pinpoint relied on (para / page)', { required: true, placeholder: 'e.g. para 27 — or “none: cited generally”' })}
      ${checkboxes()}
      <button>Mark verified — all four confirmed</button>
    </form>
    <form method="POST" action="/r/citations/fail" style="margin-top:10px">
      <input type="hidden" name="id" value="${esc(inst.id)}">
      ${input('reason', 'Failure reason', { placeholder: 'does not resolve / quote mismatch / negative treatment / hallucinated' })}
      <button class="danger">Mark failed</button>
    </form>
  </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const sub = 'The blocking gate — nothing files with an unverified citation';
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub, body: empty('Open a matter to run the citation gate.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const drafts = s.list('draft').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const all = s.list('citation_instance');
    const want = ctx.query.get('draft');
    const sel = drafts.find((d) => d.id === want) || drafts[0] || null;
    const selInst = sel ? all.filter((i) => i.draftId === sel.id) : [];
    const queue = selInst.filter((i) => i.status === 'unverified');
    const decided = selInst.filter((i) => i.status !== 'unverified');

    const board = drafts.length ? table(['Draft', 'Cites', 'Unverified', 'Failed', 'Gate', ''], drafts.map((d) => {
      const inst = all.filter((i) => i.draftId === d.id);
      return [
        esc(d.title || '(untitled draft)'),
        `<span class="num">${inst.length}</span>`,
        `<span class="num">${inst.filter((i) => i.status === 'unverified').length}</span>`,
        `<span class="num">${inst.filter((i) => i.status === 'failed').length}</span>`,
        gateTag(d, inst),
        `<a href="${esc(roomUrl(d.id))}">open queue →</a>`,
      ];
    })) : empty('No drafts on this matter yet. Brief Writer (Room 18) sends drafts here — or register one alongside.');

    const selBlock = sel ? `
    <h2 class="sec">Queue — ${esc(sel.title || '(untitled draft)')} ${gateTag(sel, selInst)}</h2>
    <div class="card">
      ${kv([
        ['Draft', esc(sel.title || '(untitled draft)')],
        ['Text', `<span class="num">${draftText(sel).length}</span> characters`],
        ['Last extracted', sel.scannedAt ? date(sel.scannedAt) : '— not yet run'],
        ['Gate', gateTag(sel, selInst)],
      ])}
      <form method="POST" action="/r/citations/scan"><input type="hidden" name="draftId" value="${esc(sel.id)}"><button>Extract citations from draft</button></form>
      <p class="note">Extraction is a reference-regex pass (styles of cause “v.” / “R. v.”, bracket-year reports like [2019] 2 S.C.R., neutral cites like 2016 SCC 27, volume cites like 376 F.3d 1113 or 58 O.R. (3d) 165). It over-captures on purpose; a human clears every row. eyecite extraction and CourtListener/CAP resolution wire in here (Build Sheet L07) — treatment classification stays human-confirmed (Build Sheet, Gap 2).</p>
    </div>
    ${queue.length ? `<h2 class="sec">Awaiting verification — ${queue.length}</h2>` + queue.map(verifyCard).join('')
      : (selInst.length ? '' : empty('No citation instances yet — run the extractor.'))}
    ${decided.length ? `<h2 class="sec">Decided</h2>` + table(['Cite', 'Status', 'Pinpoint', 'Quote', 'Treatment', 'By', ''], decided.map((i) => [
      `<span class="num">${esc(i.cite)}</span>`,
      i.status === 'verified' ? tag('verified', 'ok') : tag('failed' + (i.failReason ? ': ' + i.failReason : ''), 'gate'),
      esc(i.pinpoint || '—'),
      i.quoteOk === true ? tag('match', 'ok') : i.quoteOk === false ? tag('mismatch', 'gate') : '—',
      i.treatmentCurrent === true ? tag('current', 'ok') : i.treatmentCurrent === false ? tag('bad', 'gate') : '—',
      esc(i.checkedBy || ''),
      i.status === 'failed' ? `<form method="POST" action="/r/citations/reopen" style="margin:0"><input type="hidden" name="id" value="${esc(i.id)}"><button class="quiet">Re-queue</button></form>` : '',
    ])) : ''}` : '';

    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Draft gate board — ${esc(ctx.matter.title)}</h2>
        ${board}
        <p class="note">A draft is <b>blocked</b> while any citation instance is unverified or failed. Only verified-all opens the gate (citeStatus: clear) — the Filing Room reads that flag.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Register a draft for checking</h2>
        <form method="POST" action="/r/citations/draft">
          ${input('title', 'Draft title', { required: true, placeholder: 'Factum — motion to strike' })}
          ${textarea('text', 'Draft text', { required: true, placeholder: 'Paste the draft. e.g. …as held in R. v. Jordan, 2016 SCC 27 at para 46…' })}
          <button>Register draft</button>
        </form>
        <p class="note">Drafts normally arrive from Brief Writer (Room 18); this intake exists so any document can be gated before filing.</p>
      </div>
    </div>
    ${selBlock}`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub, body }));
  });

  // Register a draft directly (Brief Writer is the usual source).
  app.route('POST', `/r/${ROOM.id}/draft`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const title = String(ctx.body.title || '').trim();
    const text = String(ctx.body.text || '').trim();
    if (!title || !text) { ctx.setFlash('A draft needs a title and its text.', 'err'); redirect(res, roomUrl()); return; }
    const d = ctx.kernel.scope(ctx.matter.id).put('draft', { title, text, citeStatus: 'unchecked' });
    ctx.setFlash('Draft registered — run the extractor, then verify each citation.');
    redirect(res, roomUrl(d.id));
  });

  // Extract citation-like strings and mint unverified instances.
  app.route('POST', `/r/${ROOM.id}/scan`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const draft = ctx.body.draftId ? s.get('draft', ctx.body.draftId) : null;
    if (!draft) { ctx.setFlash('Pick a draft to extract from.', 'err'); redirect(res, roomUrl()); return; }
    const cites = extractCites(draftText(draft));
    const have = new Set(s.list('citation_instance', (i) => i.draftId === draft.id).map((i) => i.cite.toLowerCase()));
    let created = 0;
    for (const cite of cites) {
      if (have.has(cite.toLowerCase())) continue;
      s.put('citation_instance', { cite, draftId: draft.id, status: 'unverified', pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null });
      created++;
    }
    s.put('draft', { ...s.get('draft', draft.id), scannedAt: today() });
    const st = regate(s, draft.id);
    ctx.kernel.audit('citation.scan', ctx.matter.id + ':' + draft.id + ':' + created);
    ctx.setFlash(cites.length
      ? `Extracted ${cites.length} citation-like string${cites.length === 1 ? '' : 's'} (${created} new). Gate is ${st === 'clear' ? 'clear' : 'BLOCKED until each is verified'}.`
      : 'No citation-like strings found — gate is clear for this draft.');
    redirect(res, roomUrl(draft.id));
  });

  // Human verification: all four confirmations or nothing.
  app.route('POST', `/r/${ROOM.id}/verify`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('citation_instance', ctx.body.id) : null;
    if (!inst) { ctx.setFlash('Pick a citation from the queue.', 'err'); redirect(res, roomUrl()); return; }
    const pinpoint = String(ctx.body.pinpoint || '').trim();
    if (!pinpoint || ctx.body.resolves !== '1' || ctx.body.quoteOk !== '1' || ctx.body.treatment !== '1') {
      ctx.setFlash('Refused: verification needs all four — real case, pinpoint, quote match, treatment current. Otherwise mark it failed.', 'err');
      redirect(res, roomUrl(inst.draftId)); return;
    }
    s.put('citation_instance', { ...inst, status: 'verified', pinpoint, quoteOk: true, treatmentCurrent: true, resolved: true, failReason: null, checkedBy: ctx.user.name, checkedAt: today() });
    const st = regate(s, inst.draftId);
    ctx.kernel.audit('citation.verified', ctx.matter.id + ':' + inst.id);
    ctx.setFlash(st === 'clear' ? 'Verified — every citation on this draft is clear. Gate OPEN (citeStatus: clear).' : 'Verified. Gate still blocked — citations remain in the queue.');
    redirect(res, roomUrl(inst.draftId));
  });

  app.route('POST', `/r/${ROOM.id}/fail`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('citation_instance', ctx.body.id) : null;
    if (!inst) { ctx.setFlash('Pick a citation from the queue.', 'err'); redirect(res, roomUrl()); return; }
    s.put('citation_instance', { ...inst, status: 'failed', failReason: String(ctx.body.reason || '').trim() || 'failed verification', checkedBy: ctx.user.name, checkedAt: today() });
    regate(s, inst.draftId);
    ctx.kernel.audit('citation.failed', ctx.matter.id + ':' + inst.id);
    ctx.setFlash('Marked failed — the draft stays blocked until this cite is fixed and re-verified.', 'err');
    redirect(res, roomUrl(inst.draftId));
  });

  // A failed cite, once fixed in the draft, goes back through the queue.
  app.route('POST', `/r/${ROOM.id}/reopen`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('citation_instance', ctx.body.id) : null;
    if (!inst) { ctx.setFlash('Nothing to re-queue.', 'err'); redirect(res, roomUrl()); return; }
    s.put('citation_instance', { ...inst, status: 'unverified', pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null, failReason: null });
    regate(s, inst.draftId);
    ctx.setFlash('Back in the queue — verify it fresh.');
    redirect(res, roomUrl(inst.draftId));
  });
}

module.exports = { ...ROOM, register };
