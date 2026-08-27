'use strict';
// Room 13 — Document Review. Encrypted review set: paste text in, code it,
// keep the privilege log honest, and cut the production list. Document text
// lives in per-matter encrypted blobs; only metadata rides in the index.
const { layout, esc, table, empty, tag, input, textarea, select, date, kv } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 13, id: 'review', title: 'Document Review', phase: 'Discover' };

const PRIVILEGE = [['none', 'No privilege'], ['solicitor-client', 'Solicitor-client'], ['litigation', 'Litigation']];
const RESPONSIVE = [['yes', 'Responsive'], ['no', 'Not responsive']];
const PRIV_BASIS = { 'solicitor-client': 'Solicitor-client privilege', litigation: 'Litigation privilege' };

const today = () => new Date().toISOString().slice(0, 10);

// Shape and calendar both. '2026-02-31' clears the ISO regex but rolls forward
// to March 3 inside Date, so the slice is compared back and the impossible day
// is refused — the document date is the Created column of the privilege log and
// the sort key 35-affidavit reads for Schedules A and B, and a day nobody lived
// is a date the other side can put to a deponent.
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Printing this page yields the two documents that leave the room — the
// privilege log and the production list. Search, coding and intake drop out;
// the shared print base in kernel/html.js does the palette and the chrome.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

function nextBates(docs) {
  let max = 0;
  for (const d of docs) {
    // Match ANY digit width, not exactly six. Pinned at six, the first document
    // past DEF-999999 was issued 'DEF-1000000' — which this regex then no longer
    // matched, so the scan fell back to 999999 and handed the SAME number to the
    // next document. Two documents sharing a bates number breaks document
    // identity in a production and on the privilege log. padStart below still
    // keeps six the minimum width, so existing numbering is unchanged.
    const m = /^DEF-(\d+)$/.exec(d.bates || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'DEF-' + String(max + 1).padStart(6, '0');
}

const parseIssues = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const issuesOf = (d) => (Array.isArray(d.issues) ? d.issues : []);
const privOf = (d) => d.privilege || 'none';
const respOf = (d) => d.responsive === 'yes' ? 'yes' : 'no';
// Privilege-log descriptors, captured on the document. Author/recipients fall
// back to the mail metadata for .eml intake; created date falls back to the
// document date. The description is a neutral account of the withheld subject —
// existence and basis only, never the content itself.
const authorOf = (d) => d.author || d.custodian || '';
const recipientsOf = (d) => d.recipients || d.to || '';
const createdOf = (d) => d.dateCreated || d.date || '';
const privDescOf = (d) => d.privDesc || '';
// A withheld document whose log entry cannot yet stand on its own: the log
// must name who wrote it and describe the subject, or the claim is untestable.
const logGap = (d) => privOf(d) !== 'none' && !(authorOf(d).trim() && privDescOf(d).trim());
const logCell = (v) => (String(v || '').trim() ? esc(v) : tag('missing', 'gate'));

function findSnippet(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - 45), end = Math.min(text.length, i + q.length + 45);
  return {
    pre: (start > 0 ? '…' : '') + text.slice(start, i),
    hit: text.slice(i, i + q.length),
    post: text.slice(i + q.length, end) + (end < text.length ? '…' : ''),
  };
}
const snippetHtml = (sn) => sn
  ? `<span class="note">${esc(sn.pre)}<b style="color:var(--ink)">${esc(sn.hit)}</b>${esc(sn.post)}</span>`
  : '—';

function privTag(d) {
  const p = privOf(d);
  return p === 'none' ? tag('none') : tag(p, 'gate');
}
const respTag = (d) => respOf(d) === 'yes' ? tag('responsive', 'ok') : tag('not responsive');

// ---- tolerant RFC822 (.eml) parsing — small, in-room, never trusted ----
// Hard ceilings on the intake: one hostile message stuffed with MIME stubs
// must not fan out into unbounded encrypted blobs, document records and
// append-only audit entries. Exceeding a cap throws a flagged error and
// nothing is persisted — the caps live in the parser so the handler can
// never write a single blob for an over-limit message.
const EML_MAX_PARTS = 1000; // MIME parts examined per message
const EML_MAX_ATTACHMENTS = 100; // attachments persisted per message
const EML_MAX_ATTACH_BYTES = 25 * 1024 * 1024; // total decoded attachment bytes
function emlLimit(msg) { const e = new Error(msg); e.limit = true; return e; }

// Split at the first blank line; no blank line means the whole input is body.
function splitAtBlank(src) {
  const m = /\r?\n\r?\n/.exec(src);
  return m ? { head: src.slice(0, m.index), body: src.slice(m.index + m[0].length) } : { head: '', body: src };
}
// Unfold continuation lines, then read headers case-insensitively (first value wins).
function parseHeaderBlock(head) {
  const out = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in out)) out[name] = line.slice(i + 1).trim();
  }
  return out;
}
// Pull one parameter (boundary=, filename=, name=) out of a structured header value.
function headerParam(val, key) {
  const m = new RegExp(key + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i').exec(val || '');
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}
function decodeQuotedPrintable(s) {
  const joined = s.replace(/=\r?\n/g, ''); // soft line breaks
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16)); i += 2;
    } else bytes.push(joined.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}
function decodeTransfer(text, cte) {
  const enc = String(cte || '').trim().toLowerCase();
  if (enc === 'base64') return Buffer.from(text.replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') return decodeQuotedPrintable(text);
  return Buffer.from(text, 'utf8');
}
function splitMultipart(body, boundary) {
  const parts = [];
  const pieces = body.split('--' + boundary);
  for (let i = 1; i < pieces.length; i++) {
    if (pieces[i].startsWith('--')) break; // closing delimiter --boundary--
    const p = pieces[i].replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, '');
    if (p.trim()) parts.push(p);
    if (parts.length > EML_MAX_PARTS) throw emlLimit(`message has more than ${EML_MAX_PARTS} MIME parts`);
  }
  return parts;
}
// One level deep on multipart/*: first text/* part is the body; any part with a
// filename or Content-Disposition: attachment becomes a decoded attachment Buffer.
function parseEml(src) {
  const { head, body } = splitAtBlank(src);
  const h = parseHeaderBlock(head);
  const out = { from: h.from || '', to: h.to || '', subject: h.subject || '', dateHeader: h.date || '', body: null, attachments: [] };
  const ct = h['content-type'] || '';
  const boundary = /^\s*multipart\//i.test(ct) ? headerParam(ct, 'boundary') : '';
  const parts = boundary ? splitMultipart(body, boundary) : [];
  let attachBytes = 0;
  for (const part of parts) {
    const seg = splitAtBlank(part);
    const ph = parseHeaderBlock(seg.head);
    const pct = (ph['content-type'] || 'text/plain').trim();
    const disp = ph['content-disposition'] || '';
    const filename = headerParam(disp, 'filename') || headerParam(ph['content-type'] || '', 'name');
    const buf = decodeTransfer(seg.body, ph['content-transfer-encoding']);
    if (filename || /^attachment/i.test(disp.trim())) {
      if (!buf.length) continue; // empty attachment stubs carry no evidence — never persisted
      if (out.attachments.length >= EML_MAX_ATTACHMENTS) throw emlLimit(`message has more than ${EML_MAX_ATTACHMENTS} attachments`);
      attachBytes += buf.length;
      if (attachBytes > EML_MAX_ATTACH_BYTES) throw emlLimit('decoded attachments exceed the size ceiling');
      out.attachments.push({ filename: filename || 'attachment', buf });
    } else if (!out.body && /^text\//i.test(pct)) out.body = buf;
  }
  if (!out.body) out.body = parts.length ? Buffer.from('', 'utf8') : decodeTransfer(body, h['content-transfer-encoding']);
  return out;
}

// Date cell. For an .eml row the sent time IS the service timestamp, so the
// clock time rides beside the date and an unreadable Date header is flagged on
// the row itself — the rule that makes it matter is stated once, under the table.
function dateCell(d) {
  const day = date(d.date) || '—';
  if (d.source !== 'eml') return day;
  if (!d.sentAt) return `${day} ${tag('sent time unknown', 'gate')}`;
  const t = String(d.sentAt).slice(11, 16);
  return `${day} <span class="note" style="display:inline;margin:0">${esc(t)}Z</span>`;
}

const EML_NOTE = '<p class="note">An .eml row carries its Date header as the service timestamp — use the sent time as the trigger when you compute a responding deadline in <a href="/r/calendar">Trial Calendar</a> (Ontario deems email served after 4:30 p.m. effective the next day, r. 16.06.1). A row flagged <b>sent time unknown</b> had no readable Date header: confirm service before diarising off it.</p>';

// Row coding. The three coding calls are always live; the privilege-log
// descriptors appear only once a privilege is claimed — the POST preserves any
// field the row does not submit, so nothing already captured is lost.
function codeForm(d) {
  const opts = (list, sel) => list.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const withheld = privOf(d) !== 'none';
  return `<form method="POST" action="/r/review/code" style="display:flex;flex-direction:column;gap:4px;min-width:150px">
    <input type="hidden" name="id" value="${esc(d.id)}">
    <select name="privilege" aria-label="Privilege">${opts(PRIVILEGE, privOf(d))}</select>
    <select name="responsive" aria-label="Responsive">${opts(RESPONSIVE, respOf(d))}</select>
    <input name="issues" aria-label="Issue tags" placeholder="issue tags" value="${esc(issuesOf(d).join(', '))}">${withheld ? `
    <input name="author" aria-label="Author (privilege log)" placeholder="author — for the log" value="${esc(authorOf(d))}">
    <input name="recipients" aria-label="Recipients (privilege log)" placeholder="recipients — for the log" value="${esc(recipientsOf(d))}">
    <input name="privDesc" aria-label="Privilege-log description" placeholder="withheld subject — never content" value="${esc(privDescOf(d))}">` : ''}
    <button class="quiet">Recode</button>
  </form>`;
}

// The two intake forms, shared by the empty state and the working page.
function intakeCards() {
  return `
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add document</h2>
        <form method="POST" action="/r/review/add">
          ${input('title', 'Title', { required: true, placeholder: 'Email re: schedule slippage' })}
          <div class="grid2">
            <span>${input('custodian', 'Custodian', { placeholder: 'Who held it' })}</span>
            <span>${input('docDate', 'Document date', { type: 'date' })}</span>
            <span>${select('privilege', 'Privilege call', PRIVILEGE, 'none')}</span>
            <span>${select('responsive', 'Responsive', RESPONSIVE, 'no')}</span>
          </div>
          ${textarea('text', 'Document text (pasted)', { required: true, placeholder: 'Paste the text. It is stored as an encrypted blob under this matter’s key — never in the metadata index.' })}
          ${input('issues', 'Issue tags', { placeholder: 'delay, notice, damages' })}
          <div class="grid3">
            <span>${input('author', 'Author', { placeholder: 'Who wrote it' })}</span>
            <span>${input('recipients', 'Recipients', { placeholder: 'Who received it' })}</span>
            <span>${input('privDesc', 'Withheld subject', { placeholder: 'Neutral — never the content' })}</span>
          </div>
          <p class="note" style="margin-top:4px">The last row is the privilege-log entry; fill it only when you claim privilege.</p>
          <button>Add — next bates auto-assigned</button>
        </form>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Intake an email (.eml)</h2>
        <form method="POST" action="/r/review/eml">
          ${textarea('eml', 'Raw RFC822 source', { required: true, placeholder: 'Paste the full raw source (File → Save As .eml, or “Show original”). Headers, body and attachments are parsed here and stored encrypted under this matter’s key.' })}
          <button>Intake email — service timestamp preserved</button>
        </form>
        <p class="note">Command line works too: POST the file itself as the request body — curl --data-binary @served.eml -H 'content-type: message/rfc822' /r/review/eml. Attachments each get their own Bates number.</p>
      </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const render = (body) => html(res, layout({ ...ctx, room: ROOM.id },
      { title: ROOM.title, sub: 'Encrypted review set — code, log privilege, produce', body }));
    if (!ctx.matter) { render(empty('Open a matter to build its review set.')); return; }

    const s = k.scope(ctx.matter.id);
    const all = s.list('document').sort((a, b) => (a.bates || '').localeCompare(b.bates || ''));
    const q = (ctx.query.get('q') || '').trim();
    const fCust = ctx.query.get('custodian') || '';
    const fPriv = ctx.query.get('privilege') || '';
    const fResp = ctx.query.get('responsive') || '';

    let docs = all.filter((d) =>
      (!fCust || d.custodian === fCust) &&
      (!fPriv || privOf(d) === fPriv) &&
      (!fResp || respOf(d) === fResp));

    // Full-text search: decrypt each candidate blob and scan in-memory.
    const snippets = {};
    if (q) {
      docs = docs.filter((d) => {
        if (!d.blobId) return false;
        let text = '';
        try { text = k.blob.get(ctx.matter.id, d.blobId).toString('utf8'); } catch (e) { return false; }
        const sn = findSnippet(text, q);
        if (sn) snippets[d.id] = sn;
        return !!sn;
      });
    }

    const custodians = [...new Set(all.map((d) => d.custodian).filter(Boolean))].sort();
    const withheld = all.filter((d) => privOf(d) !== 'none');
    const production = all.filter((d) => respOf(d) === 'yes' && privOf(d) === 'none');
    const gaps = withheld.filter(logGap).length;
    const filtered = !!(q || fCust || fPriv || fResp);

    // Nothing in the set yet: lead with the two ways in, and say what the
    // coding done here decides downstream.
    if (!all.length) {
      render(`<div class="grid2">${intakeCards()}</div>
      <p class="note">Nothing in the review set yet. Coding here decides the rest: the privilege log and production list on this page, Schedules A and B of the <a href="/r/affidavit">Affidavit of Documents</a>, and the volumes cut in <a href="/r/production">Production</a>. Bates numbers are assigned on intake and never reused.</p>`);
      return;
    }

    const cols = ['Bates', 'Title', 'Custodian', 'Date', 'Privilege', 'Responsive', 'Issues'];
    if (q) cols.push('Match');
    cols.push('Coding');
    const rows = docs.map((d) => {
      const r = [
        `<span class="num">${esc(d.bates || '—')}</span>`,
        `<a href="/r/review/doc/${encodeURIComponent(d.id)}">${esc(d.title || '(untitled)')}</a>` + (d.source === 'eml' ? ' ' + tag('eml', 'navy') : ''),
        esc(d.custodian || '—'),
        dateCell(d),
        privTag(d),
        respTag(d),
        issuesOf(d).map((i) => tag(i, 'navy')).join(' ') || '—',
      ];
      if (q) r.push(snippetHtml(snippets[d.id]));
      r.push(codeForm(d));
      return r;
    });

    const body = `
    ${PRINT}
    <div class="print-only" style="margin-bottom:16px">
      <b>${esc(ctx.matter.title)}</b> — privilege log and production list<br>
      <span class="num">${esc(today())}</span>${ctx.matter.client ? ` · ${esc(ctx.matter.client)}` : ''}
    </div>

    <div class="no-print">
      <div class="card">
        <form method="GET" action="/r/review" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
          <span style="flex:2 1 240px">${input('q', 'Search document text', { value: q, placeholder: 'Word or phrase' })}</span>
          <span style="flex:1 1 150px">${select('custodian', 'Custodian', [['', 'All custodians'], ...custodians.map((c) => [c, c])], fCust)}</span>
          <span style="flex:1 1 140px">${select('privilege', 'Privilege', [['', 'All'], ...PRIVILEGE], fPriv)}</span>
          <span style="flex:1 1 140px">${select('responsive', 'Responsive', [['', 'All'], ...RESPONSIVE], fResp)}</span>
          <button style="margin-top:0">Apply</button>
          ${filtered ? '<a class="btn" href="/r/review" style="margin-top:0">Clear</a>' : ''}
        </form>
        <p class="note">Search decrypts each candidate body in memory — nothing is indexed in the clear.</p>
      </div>

      <h2 class="sec">Review set <span class="num">${all.length}</span> ${filtered ? tag(`${docs.length} shown`, 'navy') : ''} ${gaps ? tag(`${gaps} log entr${gaps === 1 ? 'y' : 'ies'} incomplete`, 'gate') : ''}</h2>
      ${table(cols, rows) || empty('Nothing matches this filter — clear it to see the whole set.')}
      ${docs.some((d) => d.source === 'eml') ? EML_NOTE : ''}

      <div class="grid2" style="margin-top:18px">${intakeCards()}</div>
    </div>

    <h2 class="sec">Privilege log ${withheld.length ? tag(withheld.length + ' withheld', 'gate') : ''}</h2>
    ${table(['Bates', 'Created', 'Author', 'Recipients', 'Description', 'Basis'], withheld.map((d) => [
      `<span class="num">${esc(d.bates || '—')}</span>`,
      date(createdOf(d)) || '—',
      logCell(authorOf(d)),
      esc(recipientsOf(d) || '—'),
      logCell(privDescOf(d)),
      esc(PRIV_BASIS[privOf(d)] || privOf(d)),
    ])) || empty('Nothing withheld — no privilege claim coded on this set.')}
    <p class="note">Generated from the coding, so it cannot drift from the set; it discloses existence and basis only, never content. An entry marked <b>missing</b> does not yet stand on its own — fill the author and the withheld subject in that row&rsquo;s coding form.</p>

    <h2 class="sec">Production list ${production.length ? tag(production.length + ' to produce', 'ok') : ''}</h2>
    ${table(['Bates', 'Title', 'Custodian', 'Date'], production.map((d) => [
      `<span class="num">${esc(d.bates || '—')}</span>`,
      esc(d.title || ''),
      esc(d.custodian || '—'),
      date(d.date) || '—',
    ])) || empty('Nothing coded responsive and unprivileged yet — code the set above and this list fills itself.')}
    <p class="note no-print">Responsive and not privileged, by definition — a document cannot sit here and on the privilege log at once. OpenSearch indexing with Tika extraction, Presidio PII flags and X-Ray dedupe wire in at scale — Build Sheet L06.</p>
    `;
    render(body);
  });

  // Document view — the reviewer reads the FULL decrypted body, not the 45-char
  // search snippet. Text is fetched from the encrypted blob at request time and
  // escaped before it reaches the page; nothing is written.
  app.route('GET', `/r/${ROOM.id}/doc/:id`, (req, res, ctx) => {
    const k = ctx.kernel;
    const render = (title, body) => html(res, layout({ ...ctx, room: ROOM.id },
      { title: ROOM.title, sub: title, body }));
    if (!ctx.matter) { render('Document view', empty('Open a matter to view its documents.')); return; }

    const s = k.scope(ctx.matter.id);
    const id = String(ctx.params.id || '').trim();
    const doc = id ? s.get('document', id) : null;
    if (!doc) {
      render('Document view', empty('Document not found in this matter.')
        + `<p class="note"><a href="/r/review">Back to the review set</a></p>`);
      return;
    }

    let text = '', err = null;
    if (doc.blobId) {
      try { text = k.blob.get(ctx.matter.id, doc.blobId).toString('utf8'); }
      catch (e) { err = 'The stored body could not be decrypted for this record.'; }
    } else {
      err = 'This record carries no stored body.';
    }
    k.audit('review.view', ctx.matter.id + ':' + (doc.bates || doc.id));

    const meta = kv([
      ['Bates', `<span class="num">${esc(doc.bates || '—')}</span>`],
      ['Title', esc(doc.title || '(untitled)')],
      ['Custodian', esc(doc.custodian || '—')],
      ['Author', esc(authorOf(doc) || '—')],
      ['Recipients', esc(recipientsOf(doc) || '—')],
      ['Created', date(createdOf(doc)) || '—'],
      ['Privilege', privTag(doc)],
      ['Responsive', respTag(doc)],
      ['Issues', issuesOf(doc).map((i) => tag(i, 'navy')).join(' ') || '—'],
    ].concat(doc.source === 'eml' ? [
      ['Source', tag('eml', 'navy')],
      // The service timestamp in full — the index shows the clock time, the
      // record keeps the second.
      ['Sent', doc.sentAt ? `<span class="num">${esc(doc.sentAt)}</span>` : tag('unknown — Date header unreadable', 'gate')],
    ] : []));

    const bodyBlock = err
      ? empty(err)
      : `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;overflow-x:auto;background:var(--ground);border:1px solid var(--rule);padding:14px;margin:0;font-family:var(--f-mono);font-size:12.5px;line-height:1.6">${esc(text)}</pre>`;

    // Code it here, while it is on screen — the call is made reading the
    // document, not from memory back on the index.
    const body = `
    <p class="note no-print"><a href="/r/review">&larr; Back to the review set</a></p>
    <div class="grid2">
      <div class="card">${meta}</div>
      <div class="card no-print">
        <h2 class="sec" style="margin-top:0">Code it</h2>
        <form method="POST" action="/r/review/code">
          <input type="hidden" name="id" value="${esc(doc.id)}">
          <input type="hidden" name="back" value="doc">
          <div class="grid2">
            <span>${select('privilege', 'Privilege', PRIVILEGE, privOf(doc))}</span>
            <span>${select('responsive', 'Responsive', RESPONSIVE, respOf(doc))}</span>
          </div>
          ${input('issues', 'Issue tags', { value: issuesOf(doc).join(', '), placeholder: 'delay, notice, damages' })}
          <div class="grid3">
            <span>${input('author', 'Author', { value: authorOf(doc) })}</span>
            <span>${input('recipients', 'Recipients', { value: recipientsOf(doc) })}</span>
            <span>${input('privDesc', 'Withheld subject', { value: privDescOf(doc), placeholder: 'Neutral — never the content' })}</span>
          </div>
          <button>Save coding</button>
        </form>
        ${logGap(doc) ? '<p class="note">Withheld, but the privilege log entry is incomplete — it needs the author and the withheld subject to stand on its own.</p>' : ''}
      </div>
    </div>
    <h2 class="sec">Full text${err ? '' : ` <span class="num">${text.length}</span> chars`}</h2>
    ${bodyBlock}
    <p class="note">Decrypted from this matter’s key at request time and escaped before display — the plaintext is never written back to the index or the page source.</p>
    `;
    render('Document view — full decrypted text', body);
  });

  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/review'); return; }
    const title = String(ctx.body.title || '').trim();
    const text = String(ctx.body.text || '');
    if (!title || !text.trim()) { ctx.setFlash('A title and pasted document text are both required.', 'err'); redirect(res, '/r/review'); return; }
    // Validate before a single encrypted blob is written — a refused intake
    // must leave nothing behind, the same contract the .eml caps hold to.
    const docDate = String(ctx.body.docDate || '').trim().slice(0, 10);
    if (docDate && !isRealDate(docDate)) { ctx.setFlash('Document date must be a real calendar date (YYYY-MM-DD) — nothing was stored.', 'err'); redirect(res, '/r/review'); return; }
    const s = k.scope(ctx.matter.id);
    const blobId = k.blob.put(ctx.matter.id, Buffer.from(text, 'utf8'));
    const bates = nextBates(s.list('document'));
    const doc = s.put('document', {
      title,
      custodian: String(ctx.body.custodian || '').trim(),
      date: docDate,
      blobId,
      bates,
      privilege: PRIVILEGE.some(([v]) => v === ctx.body.privilege) ? ctx.body.privilege : 'none',
      responsive: ctx.body.responsive === 'yes' ? 'yes' : 'no',
      issues: parseIssues(ctx.body.issues),
      author: String(ctx.body.author || '').trim(),
      recipients: String(ctx.body.recipients || '').trim(),
      privDesc: String(ctx.body.privDesc || '').trim(),
    });
    ctx.setFlash(`${doc.bates} added — text encrypted under this matter’s key.`);
    redirect(res, '/r/review');
  });

  app.route('POST', `/r/${ROOM.id}/code`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/review'); return; }
    const id = String(ctx.body.id || '').trim();
    const doc = id ? k.scope(ctx.matter.id).get('document', id) : null;
    if (!doc) { ctx.setFlash('Document not found in this matter.', 'err'); redirect(res, '/r/review'); return; }
    // Coding from the document view returns to the document, not the index —
    // two fixed destinations, never a caller-supplied path.
    const backTo = ctx.body.back === 'doc' ? '/r/review/doc/' + encodeURIComponent(doc.id) : '/r/review';
    k.scope(ctx.matter.id).put('document', {
      ...doc,
      privilege: PRIVILEGE.some(([v]) => v === ctx.body.privilege) ? ctx.body.privilege : privOf(doc),
      responsive: ctx.body.responsive === 'yes' || ctx.body.responsive === 'no' ? ctx.body.responsive : respOf(doc),
      issues: 'issues' in ctx.body ? parseIssues(ctx.body.issues) : issuesOf(doc),
      author: 'author' in ctx.body ? String(ctx.body.author).trim() : (doc.author || ''),
      recipients: 'recipients' in ctx.body ? String(ctx.body.recipients).trim() : (doc.recipients || ''),
      privDesc: 'privDesc' in ctx.body ? String(ctx.body.privDesc).trim() : (doc.privDesc || ''),
    });
    ctx.setFlash(`${doc.bates || 'Document'} recoded.`);
    redirect(res, backTo);
  });

  // Email intake: textarea paste OR a raw-body upload (kernel/http.js readBody
  // hands any non-form content-type to us as ctx.body._raw, a Buffer).
  app.route('POST', `/r/${ROOM.id}/eml`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/review'); return; }
    const raw = Buffer.isBuffer(ctx.body._raw) ? ctx.body._raw.toString('utf8') : String(ctx.body.eml || '');
    if (!raw.trim()) { ctx.setFlash('Paste the raw .eml source first (or POST the file itself as the request body).', 'err'); redirect(res, '/r/review'); return; }

    let eml, sentAt = null;
    try {
      eml = parseEml(raw);
      if (eml.dateHeader) {
        const t = Date.parse(eml.dateHeader);
        if (!Number.isNaN(t)) sentAt = new Date(t).toISOString();
      }
    } catch (e) {
      ctx.setFlash(e && e.limit
        ? `Refused: ${e.message} — nothing was stored.`
        : 'That could not be parsed as an email — nothing was stored.', 'err');
      redirect(res, '/r/review'); return;
    }

    const s = k.scope(ctx.matter.id);
    const common = {
      custodian: eml.from, date: sentAt ? sentAt.slice(0, 10) : '',
      source: 'eml', from: eml.from, to: eml.to, sentAt,
      privilege: 'none', responsive: 'no', issues: [],
    };
    const blobId = k.blob.put(ctx.matter.id, eml.body);
    const bates = nextBates(s.list('document'));
    s.put('document', { ...common, title: eml.subject || '(no subject)', blobId, bates });
    for (const a of eml.attachments) {
      const aBlobId = k.blob.put(ctx.matter.id, a.buf);
      s.put('document', { ...common, title: a.filename, blobId: aBlobId, bates: nextBates(s.list('document')) });
    }
    k.audit('review.eml', ctx.matter.id + ':' + bates + ':' + eml.attachments.length);

    const extra = eml.attachments.length ? ` + ${eml.attachments.length} attachment${eml.attachments.length === 1 ? '' : 's'}` : '';
    if (sentAt) ctx.setFlash(`${bates}${extra} intaken — sent ${sentAt}. Headers preserved, everything encrypted under this matter’s key.`);
    else ctx.setFlash(`${bates}${extra} intaken, but the service timestamp could not be read from the Date header — sent time stored as unknown; verify it before computing deadlines.`, 'err');
    redirect(res, '/r/review');
  });
}

module.exports = { ...ROOM, register };
