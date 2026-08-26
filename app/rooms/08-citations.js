'use strict';
// Room 08 — Citation Check. The blocking gate: a draft does not clear this
// room while any citation in it is unverified or failed. Extraction is a
// deliberately over-broad reference-pattern pass; every row is cleared by a
// human, one confirmation at a time. Nothing here auto-verifies anything —
// the optional connector lookup reports what it found and pre-fills a URL;
// the four confirmations that open the gate are always a person's.
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
  // Rule-book citations: "FRCP 12(a)", "CPLR 213(2)", "FRE 702", "FRAP 4"
  /\b(?:FRCP|FRAP|FRCrP|FRE|CPLR|CPR)\s+\d+(?:\.\d+)*(?:\([A-Za-z0-9]+\))*/g,
  // Statutory pinpoints: "Limitations Act, 2002, s. 4", "Criminal Code, s. 718.2", "Rules, r. 3.02(1)"
  /\b[A-Z][A-Za-z.'’-]+(?:\s+(?:of|and|the|[A-Z][A-Za-z.'’-]+)){0,5}\s+(?:Act|Code|Rules)(?:,?\s*(?:19|20)\d{2})?,?\s+(?:ss?|rr?|reg|art|para)\.?\s*\d+(?:\.\d+)*(?:\([A-Za-z0-9]+\))*/g,
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
const certUrl = (draftId) => '/r/citations/certificate?draft=' + encodeURIComponent(draftId);
// Staleness — closes the verify->edit->certify loophole. Every scan/verify
// records a gateStamp holding the draft's updatedAt at the moment the gate was
// last established. A later write to the draft (an edit from Brief Writer, which
// also bumps updatedAt) leaves updatedAt ahead of the stamp: its verified
// instances no longer describe the current text, so they are stale until the
// draft is re-scanned and re-verified. A full-ISO stamp (not the date-only
// scannedAt) is what makes this comparison meaningful.
const stampAt = (s, draftId) => { const g = s.get('gateStamp', draftId); return g ? g.at : null; };
const isStale = (d, at) => !!d.scannedAt && !!at && String(d.updatedAt || '') > String(at);
// The certificate's admission test: scanned, not stale, and every instance
// verified — the same condition regate calls 'clear'. Nothing certifies a
// blocked, unscanned, or edited-since-scan draft.
const isClear = (d, inst, stale) => !!d.scannedAt && !stale && inst.every((i) => i.status === 'verified');
// A draft's text lives in THREE places and all three must be read or a draft
// extracts as empty and sails through the gate unchecked:
//   .text     — this room's registered drafts (POST /draft)
//   .body     — a pleading record's body (10-pleadings' shape); reading it here
//               is what lets a pleading be scanned once it is registered as a
//               draft, without minting a parallel type
//   .sections — the Brief Writer's six-section object (18-briefs)
const draftText = (d) => String(
  (d && d.text) || (d && d.body) ||
  (d && d.sections && typeof d.sections === 'object'
    ? Object.values(d.sections).filter(Boolean).map((v) => String(v)).join('\n\n')
    : '') || '');

// The zero-citation hole. `inst.every(...)` on an empty array is `true`, so a
// scanned draft with no detected citations regates to 'clear'. That stays
// allowed — a genuinely citation-free document exists — but a SILENT clear is
// indistinguishable from an extractor that quietly failed, and that is the
// defect. Every such draft is stamped noCitationsFound and every place this
// room shows its gate status carries the warning below.
const NO_CITE_WARN = 'no citations detected — confirm extraction did not silently fail';
// Robust to rows written before the flag existed: the stored flag OR the live
// fact (scanned, and nothing in the queue). Never relies on the flag alone.
const noCitesFound = (d, inst) => d.noCitationsFound === true || (!!d.scannedAt && inst.length === 0);

// Recompute the gate for one draft and write citeStatus back onto the draft
// record. Verified-all (and only that) opens the gate.
function regate(s, draftId) {
  const draft = s.get('draft', draftId);
  if (!draft) return null;
  // Every instance carrying this draftId counts — including one minted by
  // Research (07), which now sends its citations with a draftId. An
  // unverified cite from any room blocks this draft like any other.
  const inst = s.list('citation_instance', (i) => i.draftId === draftId);
  const citeStatus = inst.every((i) => i.status === 'verified') ? 'clear' : 'blocked';
  // Write citeStatus last, then stamp the gate to that write's own updatedAt —
  // so a subsequent content edit (a later updatedAt) reads as stale.
  const rec = s.put('draft', { ...draft, citeStatus, noCitationsFound: inst.length === 0 });
  s.put('gateStamp', { id: draftId, at: rec.updatedAt });
  return citeStatus;
}

// Automated citation resolution, wired ONLY through the kernel facade — a room
// may require nothing but html.js/http.js, so kernel/cite-resolve.js can never
// be required here. It is optional: when the facade does not expose it the
// action is simply not offered and every flow below is unchanged.
// The underlying helper is resolve(kernel, cite); a facade that has already
// bound the kernel exposes the one-argument form, so arity tells them apart.
function citeResolver(k) {
  const c = k && (k.citeResolve || k.cite || null);
  if (!c) return null;
  const fn = typeof c === 'function' ? c : (c && typeof c.resolve === 'function' ? c.resolve : null);
  if (typeof fn !== 'function') return null;
  return (cite) => Promise.resolve(fn.length >= 2 ? fn(k, cite) : fn(cite));
}

// Extract, mint unverified instances for anything new, mark scanned, regate.
// Shared by the manual Extract button and by auto-extract-on-open.
function runScan(s, draft) {
  const cites = extractCites(draftText(draft));
  // String() guard: this list now also holds instances written by Research
  // (07), so nothing here may assume a field this room wrote itself.
  const have = new Set(s.list('citation_instance', (i) => i.draftId === draft.id).map((i) => String(i.cite || '').toLowerCase()));
  let created = 0;
  for (const cite of cites) {
    if (have.has(cite.toLowerCase())) continue;
    s.put('citation_instance', { cite, draftId: draft.id, status: 'unverified', pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null });
    created++;
  }
  s.put('draft', { ...s.get('draft', draft.id), scannedAt: today() });
  const st = regate(s, draft.id);
  return { cites, created, st };
}

function gateTag(d, inst, stale) {
  // A clear gate reached with nothing in the queue always carries the
  // zero-citation warning beside it — never a bare 'clear'.
  const clear = () => tag('clear', 'ok') + (noCitesFound(d, inst) ? ' ' + tag(NO_CITE_WARN, 'gate') : '');
  if (!inst.length && !d.scannedAt) return d.citeStatus === 'clear' ? clear() : tag('unchecked');
  if (inst.some((i) => i.status === 'failed')) return tag('blocked — failed cites', 'gate');
  if (inst.some((i) => i.status === 'unverified')) return tag('blocked — unverified', 'gate');
  if (stale) return tag('blocked — edited since scan', 'gate');
  return clear();
}

const CHECKS = [
  ['resolves', 'Resolves to a real case — looked up, not assumed'],
  ['quoteOk', 'Quoted / paraphrased passage matches the source'],
  ['treatment', 'Treatment current — not overruled, reversed or negatively treated'],
];
const checkboxes = () => CHECKS.map(([n, l]) =>
  `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13px;color:var(--ink-soft)"><input type="checkbox" name="${n}" value="1" style="width:auto"> ${esc(l)}</label>`).join('');

// Provenance chip — an instance sent over from Research (07) reads differently
// from one this room's extractor minted, and the verifier should see which.
const provenance = (i) => (i.source === 'research' ? ' ' + tag('from Research (07)', 'navy') : '');

// What a connector reported, rendered as a FINDING and never as a check.
// It pre-fills the source-URL box and states what was seen; it ticks nothing,
// verifies nothing, and the four confirmations below it remain entirely human.
function lookupBlock(l) {
  if (!l || typeof l !== 'object') return '';
  const link = /^https?:\/\//i.test(String(l.url || '')) ? `<br><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.url)} ↗</a>` : '';
  return `<div style="border-left:2px solid var(--rule);padding:2px 0 2px 10px;margin:10px 0;color:var(--ink-soft);font-size:13px">
    ${l.resolved ? tag('connector found a match', 'navy') : tag('connector found no match', '')}
    ${l.source ? ' ' + tag(String(l.source), '') : ''}
    <span class="note" style="margin-left:6px">looked up by ${esc(l.by || '')} ${esc(l.at || '')}</span>
    ${l.title ? `<br><b>${esc(l.title)}</b>` : ''}
    ${l.note ? `<br>${esc(l.note)}` : ''}${link}
    <br><span class="note">This is a machine lookup, not a verification. Open it, read it, and confirm all four points yourself.</span>
  </div>`;
}

function verifyCard(inst, canResolve) {
  // Citation deep link into CanLII's search — the kind of linking room 29's
  // note records CanLII permits. No fetching, no fabricated resolution: the
  // human follows it, looks, and confirms.
  const lookup = 'https://www.canlii.org/en/#search/text=' + encodeURIComponent(inst.cite);
  const found = inst.lookup && typeof inst.lookup === 'object' ? inst.lookup : null;
  const prefillUrl = found && /^https?:\/\//i.test(String(found.url || '')) ? String(found.url) : '';
  return `<div style="border:1px solid var(--rule);padding:12px 14px;margin-bottom:10px;background:var(--ground)">
    <b class="num">${esc(inst.cite)}</b>${provenance(inst)} &nbsp; <a href="${esc(lookup)}" target="_blank" rel="noopener noreferrer">Look up on CanLII ↗</a>
    ${canResolve ? `<form method="POST" action="/r/citations/resolve" style="display:inline;margin-left:8px">
      <input type="hidden" name="id" value="${esc(inst.id)}">
      <button class="quiet">Resolve via connectors</button>
    </form>` : ''}
    ${lookupBlock(found)}
    <form method="POST" action="/r/citations/verify">
      <input type="hidden" name="id" value="${esc(inst.id)}">
      ${input('pinpoint', 'Pinpoint relied on (para / page)', { required: true, placeholder: 'e.g. para 27 — or “none: cited generally”' })}
      ${input('resolvedUrl', 'Source URL / neutral citation seen (optional)', { value: prefillUrl, placeholder: 'e.g. https://www.canlii.org/en/ca/scc/doc/2016/2016scc27/2016scc27.html' })}
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
    // Present only when the kernel facade exposes cite-resolve; absent, the
    // room degrades to exactly the manual flow it has always had.
    const canResolve = !!citeResolver(k);
    // Auto-extract on open: a draft sent from Brief Writer arrives as
    // 'cite-check' with no instances and no scan — run the pass now so the
    // queue reliably appears without a second click. Guarded by !scannedAt, it
    // runs once per draft.
    // Guarded by !scannedAt alone (runScan dedupes by cite), so a draft that
    // already carries an instance sent from Research (07) still gets its own
    // extraction pass instead of silently never being scanned.
    for (const d of s.list('draft')) {
      if (d.status === 'cite-check' && !d.scannedAt) {
        const r = runScan(s, d);
        k.audit('citation.autoscan', ctx.matter.id + ':' + d.id + ':' + r.created);
      }
    }
    // Re-gate defensively, in the BLOCKING DIRECTION ONLY. Another room may
    // mint a citation_instance against a draft that already read 'clear'
    // (Research sends its citations here with a draftId) without calling
    // regate; without this the stale 'clear' would let 22-filing file a draft
    // carrying an unverified cite. Never the reverse: a draft is never
    // re-opened to 'clear' from here, so 18-briefs' edit-resets-the-gate
    // control and the gateStamp staleness test are left untouched.
    for (const d of s.list('draft')) {
      if (d.citeStatus !== 'clear') continue;
      const inst = s.list('citation_instance', (i) => i.draftId === d.id);
      if (inst.every((i) => i.status === 'verified')) continue;
      regate(s, d.id);
      k.audit('citation.regate.tightened', ctx.matter.id + ':' + d.id);
    }
    const drafts = s.list('draft').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const all = s.list('citation_instance');
    const want = ctx.query.get('draft');
    const sel = drafts.find((d) => d.id === want) || drafts[0] || null;
    const selInst = sel ? all.filter((i) => i.draftId === sel.id) : [];
    const selStale = sel ? isStale(sel, stampAt(s, sel.id)) : false;
    const queue = selInst.filter((i) => i.status === 'unverified');
    const decided = selInst.filter((i) => i.status !== 'unverified');

    // Count columns right-aligned: .num is inline, so the cell wrapper aligns it.
    const ncell = (n) => `<span class="num" style="display:block;text-align:right">${n}</span>`;
    const board = drafts.length ? table(['Draft', 'Cites', 'Unverified', 'Failed', 'Gate', ''], drafts.map((d) => {
      const inst = all.filter((i) => i.draftId === d.id);
      const stale = isStale(d, stampAt(s, d.id));
      return [
        esc(d.title || '(untitled draft)'),
        ncell(inst.length),
        ncell(inst.filter((i) => i.status === 'unverified').length),
        ncell(inst.filter((i) => i.status === 'failed').length),
        gateTag(d, inst, stale),
        `<a href="${esc(roomUrl(d.id))}">open queue →</a>` +
          (inst.length && isClear(d, inst, stale) ? ` &middot; <a href="${esc(certUrl(d.id))}">Print certificate →</a>` : ''),
      ];
    })) : empty('No drafts on this matter yet — register one on the right, or send one from Brief Writer (18).');

    // Secondary forms. They live at the FOOT of the page when a draft is open —
    // the day's work is the verification queue, not registering another draft.
    const registerCard = `<div class="card">
      <h2 class="sec" style="margin-top:0">Register a draft for checking</h2>
      <form method="POST" action="/r/citations/draft">
        ${input('title', 'Draft title', { required: true, placeholder: 'Factum — motion to strike' })}
        ${textarea('text', 'Draft text', { required: true, placeholder: 'Paste the draft. e.g. …as held in R. v. Jordan, 2016 SCC 27 at para 46…' })}
        <button>Register draft</button>
      </form>
      <p class="note">Drafts normally arrive from Brief Writer (18) — paste one here to gate any other document before filing.</p>
    </div>`;

    // The open draft, at a glance: gate, size, when it was last read, and the
    // two things you do to it — extract, and (once clear) certify.
    const canCert = sel && selInst.length && isClear(sel, selInst, selStale);
    const draftCard = sel ? `<div class="card">
      <h2 class="sec" style="margin-top:0">${esc(sel.title || '(untitled draft)')} ${gateTag(sel, selInst, selStale)}</h2>
      ${kv([
        ['Unverified', `<span class="num">${queue.length}</span>`],
        ['Failed', `<span class="num">${selInst.filter((i) => i.status === 'failed').length}</span>`],
        ['Verified', `<span class="num">${selInst.filter((i) => i.status === 'verified').length}</span>`],
        ['Last extracted', sel.scannedAt ? date(sel.scannedAt) : '— not yet run'],
        ['Draft text', `<span class="num">${draftText(sel).length}</span> characters`],
      ])}
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">
        <form method="POST" action="/r/citations/scan" style="margin:0"><input type="hidden" name="draftId" value="${esc(sel.id)}"><button style="margin-top:0">${sel.scannedAt ? 'Re-extract citations' : 'Extract citations from draft'}</button></form>
        ${canCert ? `<a class="btn" href="${esc(certUrl(sel.id))}" style="margin-top:0">Print certificate →</a>` : ''}
      </div>
      <p class="note">Extraction is a reference-regex pass (styles of cause, bracket-year reports, neutral, volume, rule-book and statutory cites) that over-captures on purpose; a human clears every row. ${canResolve ? 'Connector resolution sits on each row below — it reports what it found and pre-fills the source URL, and promotes nothing.' : 'eyecite extraction and CourtListener/CAP resolution wire in here (Build Sheet L07).'} Treatment classification stays human-confirmed (Gap 2).</p>
    </div>` : '';

    const warnings = sel ? `
    ${selStale ? `<div class="flash err">This draft was edited after its citations were verified — those verifications are stale. Re-extract and re-verify before certifying.</div>` : ''}
    ${noCitesFound(sel, selInst) ? `<div class="flash err">Gate cleared with an empty queue: ${esc(NO_CITE_WARN)}. The extractor ran over <span class="num">${draftText(sel).length}</span> characters and matched nothing. Confirm the draft really cites no authority — if it does, the text may not have reached this room, and any missed cite must be added by hand below before this draft is filed.</div>` : ''}` : '';

    const queueBlock = queue.length
      ? `<h2 class="sec">Awaiting verification — ${queue.length}</h2>`
        + (canResolve ? `<p class="note">“Resolve via connectors” runs this citation through the CanLII / CourtListener connectors and records what came back. It pre-fills the source URL and nothing else: no box is ticked for you and no row is ever promoted by a machine. All four confirmations remain yours.</p>` : '')
        + queue.map((i) => verifyCard(i, canResolve)).join('')
      // Only an UNSCANNED draft gets the "run the extractor" prompt. A scanned
      // draft with an empty queue is the zero-citation case, already carrying
      // its own warning above — repeating "run the extractor" there would read
      // as though the pass had never happened.
      : (sel && !selInst.length && !sel.scannedAt
        ? empty('Nothing to verify yet — run “Extract citations from draft” above to pull this draft’s cites into the queue.')
        : '');

    const decidedBlock = decided.length
      ? `<h2 class="sec">Decided — ${decided.length}</h2>` + table(['Cite', 'Status', 'Pinpoint', 'Quote', 'Treatment', 'By', ''], decided.map((i) => [
        `<span class="num">${esc(i.cite)}</span>` + provenance(i),
        i.status === 'verified' ? tag('verified', 'ok') : tag('failed' + (i.failReason ? ': ' + i.failReason : ''), 'gate'),
        esc(i.pinpoint || '—'),
        i.quoteOk === true ? tag('match', 'ok') : i.quoteOk === false ? tag('mismatch', 'gate') : '—',
        i.treatmentCurrent === true ? tag('current', 'ok') : i.treatmentCurrent === false ? tag('bad', 'gate') : '—',
        esc(i.checkedBy || ''),
        i.status === 'failed' ? `<form method="POST" action="/r/citations/reopen" style="margin:0"><input type="hidden" name="id" value="${esc(i.id)}"><button class="quiet">Re-queue</button></form>` : '',
      ]))
      : '';

    const footBlock = sel ? `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a citation the extractor missed</h2>
        <form method="POST" action="/r/citations/add">
          <input type="hidden" name="draftId" value="${esc(sel.id)}">
          ${input('cite', 'Citation text', { required: true, placeholder: 'e.g. Limitations Act, 2002, s. 4' })}
          <button>Add to queue</button>
        </form>
        <p class="note">Nothing files unlisted — if the pass missed a case or statute, add it here so it must be verified too. The draft stays blocked until it is.</p>
      </div>
      ${registerCard}
    </div>` : '';

    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Draft gate board — ${esc(ctx.matter.title)}</h2>
        ${board}
        <p class="note">A draft is <b>blocked</b> while any citation instance is unverified or failed — including a citation sent over from Research (07), which counts here like any other. Only verified-all opens the gate (citeStatus: clear) — the Filing Room reads that flag. A draft that clears with an <b>empty</b> queue is flagged “${esc(NO_CITE_WARN)}”: a citation-free document is possible, but so is an extraction that found nothing when it should have.</p>
      </div>
      ${sel ? draftCard : registerCard}
    </div>
    ${warnings}
    ${queueBlock}
    ${decidedBlock}
    ${footBlock}`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub, body }));
  });

  // Register a draft directly (Brief Writer is the usual source).
  app.route('POST', `/r/${ROOM.id}/draft`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const title = String(ctx.body.title || '').trim();
    const text = String(ctx.body.text || '').trim();
    if (!title || !text) { ctx.setFlash('A draft needs a title and its text.', 'err'); redirect(res, roomUrl()); return; }
    // status:'draft' is not decoration. 22-filing's prepare gate reads
    // `citeStatus==='clear' && status==='final'`, and 18-briefs' /status route
    // is what promotes a draft to 'final'. A draft registered here without a
    // status could never satisfy either test, so it could clear this gate and
    // still never be filed — and 18-briefs rendered its status as blank.
    // Registered drafts therefore carry BOTH shapes' fields.
    const d = ctx.kernel.scope(ctx.matter.id).put('draft', { title, text, status: 'draft', citeStatus: 'unchecked' });
    ctx.setFlash('Draft registered — run the extractor, then verify each citation.');
    redirect(res, roomUrl(d.id));
  });

  // Extract citation-like strings and mint unverified instances.
  app.route('POST', `/r/${ROOM.id}/scan`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const draft = ctx.body.draftId ? s.get('draft', ctx.body.draftId) : null;
    if (!draft) { ctx.setFlash('Pick a draft to extract from.', 'err'); redirect(res, roomUrl()); return; }
    const { cites, created, st } = runScan(s, draft);
    ctx.kernel.audit('citation.scan', ctx.matter.id + ':' + draft.id + ':' + created);
    ctx.setFlash(cites.length
      ? `Extracted ${cites.length} citation-like string${cites.length === 1 ? '' : 's'} (${created} new). Gate is ${st === 'clear' ? 'clear' : 'BLOCKED until each is verified'}.`
      : 'No citation-like strings found — gate is clear for this draft.');
    redirect(res, roomUrl(draft.id));
  });

  // Manual add — a cite the over-capturing pass still missed. It enters the
  // queue as unverified like any other, so nothing reaches filing unlisted.
  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const draft = ctx.body.draftId ? s.get('draft', ctx.body.draftId) : null;
    if (!draft) { ctx.setFlash('Pick a draft to add the citation to.', 'err'); redirect(res, roomUrl()); return; }
    const cite = String(ctx.body.cite || '').replace(/\s+/g, ' ').trim();
    if (!cite) { ctx.setFlash('Enter the citation text to add.', 'err'); redirect(res, roomUrl(draft.id)); return; }
    const have = new Set(s.list('citation_instance', (i) => i.draftId === draft.id).map((i) => String(i.cite || '').toLowerCase()));
    if (have.has(cite.toLowerCase())) { ctx.setFlash('That citation is already on this draft’s queue.', 'err'); redirect(res, roomUrl(draft.id)); return; }
    s.put('citation_instance', { cite, draftId: draft.id, status: 'unverified', pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null });
    if (!draft.scannedAt) s.put('draft', { ...s.get('draft', draft.id), scannedAt: today() });
    regate(s, draft.id);
    ctx.kernel.audit('citation.added', ctx.matter.id + ':' + draft.id);
    ctx.setFlash('Added to the queue — verify it like any extracted cite. The draft stays blocked until it is.');
    redirect(res, roomUrl(draft.id));
  });

  // Automated resolution — a LOOKUP, never a verification. It asks the kernel's
  // connectors (CanLII / CourtListener) what this citation resolves to and
  // records the answer beside the row so the verifier has something real to
  // open. It writes only the advisory `lookup` field: `status`, `resolved`,
  // `quoteOk` and `treatmentCurrent` are untouched, so the gate value cannot
  // move here and regate() is deliberately NOT called (calling it would
  // re-stamp gateStamp and wash out a staleness flag no one re-verified).
  // Absent the facade this route only ever flashes — it never 500s.
  app.route('POST', `/r/${ROOM.id}/resolve`, async (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('citation_instance', ctx.body.id) : null;
    if (!inst) { ctx.setFlash('Pick a citation from the queue to resolve.', 'err'); redirect(res, roomUrl()); return; }
    const run = citeResolver(ctx.kernel);
    if (!run) { ctx.setFlash('Automated resolution is not available on this installation — look the citation up and verify it by hand.', 'err'); redirect(res, roomUrl(inst.draftId)); return; }
    if (inst.status === 'verified') { ctx.setFlash('That citation is already verified — re-queue it first if it needs looking at again.', 'err'); redirect(res, roomUrl(inst.draftId)); return; }
    let out = null;
    try { out = await run(String(inst.cite || '')); } catch (e) { out = null; }
    if (!out || typeof out !== 'object') {
      ctx.setFlash('The connector returned nothing for that citation — look it up and verify it by hand.', 'err');
      redirect(res, roomUrl(inst.draftId)); return;
    }
    // Only an http(s) URL is stored: it is re-rendered as a link and esc()
    // does not neutralise a javascript: URI.
    const url = String(out.url || '');
    const lookup = {
      resolved: out.resolved === true,
      source: String(out.source || '') || null,
      title: String(out.title || ''),
      url: /^https?:\/\//i.test(url) ? url : '',
      note: String(out.note || ''),
      at: today(),
      by: ctx.user.name,
    };
    s.put('citation_instance', { ...inst, lookup });
    ctx.kernel.audit('citation.lookup', ctx.matter.id + ':' + inst.id + ':' + (lookup.resolved ? 'match' : 'no-match'));
    ctx.setFlash(lookup.resolved
      ? `Connector matched ${lookup.title || inst.cite}. That is a lookup, NOT a verification — the source URL is pre-filled, but you still confirm all four points yourself.`
      : `No automated match: ${lookup.note || 'the connector found nothing.'} The citation stays unverified — check it by hand.`,
      lookup.resolved ? undefined : 'err');
    redirect(res, roomUrl(inst.draftId));
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
    // What the verifier actually looked at survives on the record (and
    // prints on the certificate) — optional, never fabricated.
    const resolvedUrl = String(ctx.body.resolvedUrl || '').trim();
    s.put('citation_instance', { ...inst, status: 'verified', pinpoint, quoteOk: true, treatmentCurrent: true, resolved: true, resolvedUrl: resolvedUrl || null, failReason: null, checkedBy: ctx.user.name, checkedAt: today() });
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
    s.put('citation_instance', { ...inst, status: 'unverified', pinpoint: '', quoteOk: null, treatmentCurrent: null, resolved: null, resolvedUrl: null, failReason: null });
    regate(s, inst.draftId);
    ctx.setFlash('Back in the queue — verify it fresh.');
    redirect(res, roomUrl(inst.draftId));
  });

  // Certificate of citation verification — converts a clear gate into the
  // compliance artifact courts now ask for (Ont. r. 4.06.1(2.1) authenticity
  // certification, the Federal Court's Notice on the Use of AI, Ko v. Li,
  // 2025 ONSC 2766). Renders ONLY when the draft has been scanned and every
  // instance is human-verified; nothing certifies a blocked or unscanned draft.
  app.route('GET', `/r/${ROOM.id}/certificate`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl()); return; }
    const s = k.scope(ctx.matter.id);
    const want = ctx.query.get('draft');
    const draft = want ? s.get('draft', want) : null;
    if (!draft) { ctx.setFlash('Certificate refused — pick a draft to certify.', 'err'); redirect(res, roomUrl()); return; }
    const inst = s.list('citation_instance', (i) => i.draftId === draft.id);
    const stale = isStale(draft, stampAt(s, draft.id));
    if (!isClear(draft, inst, stale)) {
      ctx.setFlash(stale
        ? 'Certificate refused — the draft was edited since its citations were verified. Re-extract and re-verify first.'
        : 'Certificate refused — the gate is not clear.', 'err');
      redirect(res, roomUrl(draft.id));
      return;
    }
    k.audit('citation.certificate', ctx.matter.id + ':' + draft.id);
    const gen = today();
    const rows = [...inst].sort((a, b) => String(a.cite).localeCompare(String(b.cite), 'en', { sensitivity: 'base' }));
    const confirm = (ok, label) => `${ok === true ? '✓' : '✗'} ${esc(label)}`;
    const confirmations = (i) => [
      confirm(i.resolved === true, 'resolves to a real case'),
      confirm(!!String(i.pinpoint || '').trim(), 'pinpoint stated'),
      confirm(i.quoteOk === true, 'quoted passage matches'),
      confirm(i.treatmentCurrent === true, 'treatment current'),
    ].join('<br>');
    const source = (u) => !u ? '—' : (/^https?:\/\//i.test(u) ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u));
    const authorities = rows.length
      ? table(['Cite', 'Pinpoint relied on', 'Confirmations', 'Verified by', 'Date', 'Source seen'], rows.map((i) => [
          `<span class="num">${esc(i.cite)}</span>`,
          esc(i.pinpoint || '—'),
          confirmations(i),
          esc(i.checkedBy || '—'),
          date(i.checkedAt),
          source(i.resolvedUrl),
        ]))
      : `<p><b>No citation-like strings were detected on extraction</b> (run ${date(draft.scannedAt)}). The over-capturing extractor found no citation-like string in the <span class="num">${draftText(draft).length}</span> characters of this draft; there was nothing to verify. <b>${esc(NO_CITE_WARN)}</b> — this certificate attests that the pass found nothing, not that the draft was read and found to cite no authority.</p>`;
    // The shared print base (kernel/html.js) already drops the chrome, repoints
    // the palette to black-on-white and keeps a card off a page break. Only the
    // certificate's own two needs are stated here.
    const body = `
    <style>@media print{
      .roomsub{display:none}
      .sigblock{break-inside:avoid;page-break-inside:avoid}
    }</style>
    <p class="no-print" style="margin:0 0 16px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; <a href="${esc(roomUrl(draft.id))}">← back to the gate</a></p>
    ${noCitesFound(draft, inst) ? `<div class="card" style="border-color:var(--oxide);background:var(--oxide-wash)">
      ${tag(NO_CITE_WARN, 'gate')}
      <p style="margin:8px 0 0">This draft cleared the gate with an <b>empty queue</b>. The certificate below attests that the extraction pass found nothing — not that the draft was read and found to cite no authority. This caveat prints with the certificate; do not sign or serve it without confirming the draft really cites nothing.</p>
    </div>` : ''}
    <div class="card">
      ${kv([
        ['Matter', esc(ctx.matter.title)],
        ['Draft', esc(draft.title || '(untitled draft)')],
        ['Generated', date(gen)],
        ['Extraction run', date(draft.scannedAt)],
        ['Citations verified', `<span class="num">${rows.length}</span>`],
      ])}
    </div>
    <h2 class="sec">Authorities verified</h2>
    ${authorities}
    <h2 class="sec">Method</h2>
    <p>Citation extraction was a deliberately over-capturing reference-pattern pass over the draft text. Every confirmation above — that each citation resolves to a real case, that the pinpoint relied on is stated, that the quoted or paraphrased passage matches the source, and that its treatment is current — was made by the named human verifier; no machine verified anything, this room's founding rule. The firm's hash-chained audit trail holds the citation.verified event behind each row of this certificate.</p>
    <div class="sigblock" style="margin-top:36px">
      <p>Verified as above.</p>
      <p style="margin-top:40px">____________<br>Lawyer of record — <span class="num">${esc(gen)}</span></p>
    </div>`;
    html(res, layout({ ...ctx, room: ROOM.id }, {
      title: 'Certificate of citation verification',
      sub: 'Human-verified table of authorities — print-ready',
      body,
    }));
  });
}

module.exports = { ...ROOM, register };
