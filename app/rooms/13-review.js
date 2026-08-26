'use strict';
// Room 13 — Document Review. Encrypted review set: paste text in, code it,
// keep the privilege log honest, and cut the production list. Document text
// lives in per-matter encrypted blobs; only metadata rides in the index.
const { layout, esc, table, empty, tag, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 13, id: 'review', title: 'Document Review', phase: 'Discover' };

const PRIVILEGE = [['none', 'No privilege'], ['solicitor-client', 'Solicitor-client'], ['litigation', 'Litigation']];
const RESPONSIVE = [['yes', 'Responsive'], ['no', 'Not responsive']];
const PRIV_BASIS = { 'solicitor-client': 'Solicitor-client privilege', litigation: 'Litigation privilege' };

function nextBates(docs) {
  let max = 0;
  for (const d of docs) {
    const m = /^DEF-(\d{6})$/.exec(d.bates || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'DEF-' + String(max + 1).padStart(6, '0');
}

const parseIssues = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const issuesOf = (d) => (Array.isArray(d.issues) ? d.issues : []);
const privOf = (d) => d.privilege || 'none';
const respOf = (d) => d.responsive === 'yes' ? 'yes' : 'no';

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

// The sentAt line rendered beside eml rows — the evidence in a deemed-service fight.
function sentNote(d) {
  if (!d.sentAt) {
    return '<span class="note" style="display:block">Sent time unknown — the Date header could not be read; confirm the service timestamp before computing deadlines.</span>';
  }
  return `<span class="note" style="display:block">Sent <span class="num">${esc(d.sentAt)}</span> — use this as the trigger date when computing the responding deadline in <a href="/r/calendar">Trial Calendar</a> (Ontario deems email service after 4:30 p.m. effective the next day — r. 16.06.1)</span>`;
}

function codeForm(d) {
  const opts = (list, sel) => list.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
  return `<form method="POST" action="/r/review/code" style="display:flex;flex-direction:column;gap:4px;min-width:170px">
    <input type="hidden" name="id" value="${esc(d.id)}">
    <select name="privilege" aria-label="Privilege">${opts(PRIVILEGE, privOf(d))}</select>
    <select name="responsive" aria-label="Responsive">${opts(RESPONSIVE, respOf(d))}</select>
    <input name="issues" aria-label="Issue tags" placeholder="issue tags, comma-separated" value="${esc(issuesOf(d).join(', '))}">
    <button class="quiet">Recode</button>
  </form>`;
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
    const filtered = q || fCust || fPriv || fResp;

    const cols = ['Bates', 'Title', 'Custodian', 'Date', 'Privilege', 'Responsive', 'Issues'];
    if (q) cols.push('Match');
    cols.push('Coding');
    const rows = docs.map((d) => {
      const r = [
        `<span class="num">${esc(d.bates || '—')}</span>`,
        esc(d.title || '') + (d.source === 'eml' ? ' ' + tag('eml', 'navy') + sentNote(d) : ''),
        esc(d.custodian || '—'),
        date(d.date) || '—',
        privTag(d),
        respTag(d),
        issuesOf(d).map((i) => tag(i, 'navy')).join(' ') || '—',
      ];
      if (q) r.push(snippetHtml(snippets[d.id]));
      r.push(codeForm(d));
      return r;
    });

    const body = `
    <div class="card">
      <form method="GET" action="/r/review" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <span style="flex:2 1 240px">${input('q', 'Full-text search', { value: q, placeholder: 'Runs across decrypted text, in memory' })}</span>
        <span style="flex:1 1 150px">${select('custodian', 'Custodian', [['', 'All custodians'], ...custodians.map((c) => [c, c])], fCust)}</span>
        <span style="flex:1 1 140px">${select('privilege', 'Privilege', [['', 'All'], ...PRIVILEGE], fPriv)}</span>
        <span style="flex:1 1 140px">${select('responsive', 'Responsive', [['', 'All'], ...RESPONSIVE], fResp)}</span>
        <button style="margin-top:0">Apply</button>
        <a class="btn" href="/r/review" style="margin-top:0">Clear</a>
      </form>
    </div>

    <h2 class="sec">Review set — <span class="num">${all.length}</span> ${filtered ? tag(`${docs.length} of ${all.length} shown`, 'navy') : ''}</h2>
    ${table(cols, rows) || empty(all.length ? 'No documents match the current filter.' : 'No documents in the review set yet — paste the first one in below.')}

    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add document</h2>
        <form method="POST" action="/r/review/add">
          ${input('title', 'Title', { required: true, placeholder: 'Email re: schedule slippage' })}
          <div class="grid2">
            <span>${input('custodian', 'Custodian', { placeholder: 'Who held this document' })}</span>
            <span>${input('docDate', 'Document date', { type: 'date' })}</span>
            <span>${select('privilege', 'Privilege call', PRIVILEGE, 'none')}</span>
            <span>${select('responsive', 'Responsive', RESPONSIVE, 'no')}</span>
          </div>
          ${textarea('text', 'Document text (pasted)', { required: true, placeholder: 'Paste the text. It is stored as an encrypted blob under this matter’s key — never in the metadata index.' })}
          ${input('issues', 'Issue tags (comma-separated)', { placeholder: 'delay, notice, damages' })}
          <button>Add — next bates auto-assigned</button>
        </form>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Intake an email (.eml)</h2>
        <form method="POST" action="/r/review/eml">
          ${textarea('eml', 'Raw RFC822 source', { required: true, placeholder: 'Paste the full raw source (File → Save As .eml, or “Show original”). Headers, body and attachments are parsed here, stored encrypted under this matter’s key, and the Date header is preserved as the service timestamp.' })}
          <button>Intake email — service timestamp preserved</button>
        </form>
        <p class="note">Command line works too: POST the file itself as the request body — curl --data-binary @served.eml -H 'content-type: message/rfc822' /r/review/eml. Attachments each get their own Bates number.</p>
      </div>
    </div>

    <h2 class="sec">Privilege log ${withheld.length ? tag(withheld.length + ' withheld', 'gate') : ''}</h2>
    ${table(['Bates', 'Date', 'Custodian', 'Basis'], withheld.map((d) => [
      `<span class="num">${esc(d.bates || '—')}</span>`,
      date(d.date) || '—',
      esc(d.custodian || '—'),
      esc(PRIV_BASIS[privOf(d)] || privOf(d)),
    ])) || empty('Nothing withheld — no privilege claims coded.')}
    <p class="note">The log discloses existence and basis only — never content. It is generated from coding, so it cannot drift from the set.</p>

    <h2 class="sec">Production list ${production.length ? tag(production.length + ' to produce', 'ok') : ''}</h2>
    ${table(['Bates', 'Title', 'Custodian', 'Date'], production.map((d) => [
      `<span class="num">${esc(d.bates || '—')}</span>`,
      esc(d.title || ''),
      esc(d.custodian || '—'),
      date(d.date) || '—',
    ])) || empty('Nothing marked responsive and unprivileged yet.')}
    <p class="note">Responsive and not privileged, by definition — a document cannot appear here and in the privilege log at once. OpenSearch indexing with Tika extraction, Presidio PII flags and X-Ray dedupe wire in at scale — Build Sheet L06.</p>
    `;
    render(body);
  });

  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/review'); return; }
    const title = String(ctx.body.title || '').trim();
    const text = String(ctx.body.text || '');
    if (!title || !text.trim()) { ctx.setFlash('A title and pasted document text are both required.', 'err'); redirect(res, '/r/review'); return; }
    const s = k.scope(ctx.matter.id);
    const blobId = k.blob.put(ctx.matter.id, Buffer.from(text, 'utf8'));
    const bates = nextBates(s.list('document'));
    const doc = s.put('document', {
      title,
      custodian: String(ctx.body.custodian || '').trim(),
      date: String(ctx.body.docDate || '').slice(0, 10),
      blobId,
      bates,
      privilege: PRIVILEGE.some(([v]) => v === ctx.body.privilege) ? ctx.body.privilege : 'none',
      responsive: ctx.body.responsive === 'yes' ? 'yes' : 'no',
      issues: parseIssues(ctx.body.issues),
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
    k.scope(ctx.matter.id).put('document', {
      ...doc,
      privilege: PRIVILEGE.some(([v]) => v === ctx.body.privilege) ? ctx.body.privilege : privOf(doc),
      responsive: ctx.body.responsive === 'yes' || ctx.body.responsive === 'no' ? ctx.body.responsive : respOf(doc),
      issues: 'issues' in ctx.body ? parseIssues(ctx.body.issues) : issuesOf(doc),
    });
    ctx.setFlash(`${doc.bates || 'Document'} recoded.`);
    redirect(res, '/r/review');
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
