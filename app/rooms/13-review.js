'use strict';
// Room 13 — Document Review. Encrypted review set: paste text in, code it,
// keep the privilege log honest, and cut the production list. Document text
// lives in per-matter encrypted blobs; only metadata rides in the index.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
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
        esc(d.title || ''),
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
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add document</h2>
        <form method="POST" action="/r/review/add">
          ${input('title', 'Title', { required: true, placeholder: 'Email re: schedule slippage' })}
          ${input('custodian', 'Custodian', { placeholder: 'Who held this document' })}
          ${input('docDate', 'Document date', { type: 'date' })}
          ${textarea('text', 'Document text (pasted)', { required: true, placeholder: 'Paste the text. It is stored as an encrypted blob under this matter’s key — never in the metadata index.' })}
          ${select('privilege', 'Privilege call', PRIVILEGE, 'none')}
          ${select('responsive', 'Responsive', RESPONSIVE, 'no')}
          ${input('issues', 'Issue tags (comma-separated)', { placeholder: 'delay, notice, damages' })}
          <button>Add — next bates auto-assigned</button>
        </form>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Filter &amp; search</h2>
        <form method="GET" action="/r/review">
          ${input('q', 'Full-text search', { value: q, placeholder: 'Runs across decrypted document text, in memory' })}
          ${select('custodian', 'Custodian', [['', 'All custodians'], ...custodians.map((c) => [c, c])], fCust)}
          ${select('privilege', 'Privilege', [['', 'All'], ...PRIVILEGE], fPriv)}
          ${select('responsive', 'Responsive', [['', 'All'], ...RESPONSIVE], fResp)}
          <button>Apply</button> <a class="btn" href="/r/review">Clear</a>
        </form>
        ${kv([
          ['In review set', `<span class="num">${all.length}</span>`],
          ['Withheld', `<span class="num">${withheld.length}</span>`],
          ['For production', `<span class="num">${production.length}</span>`],
        ])}
      </div>
    </div>

    <h2 class="sec">Review set ${filtered ? tag(`${docs.length} of ${all.length} shown`, 'navy') : ''}</h2>
    ${table(cols, rows) || empty(all.length ? 'No documents match the current filter.' : 'No documents in the review set yet — paste the first one in.')}

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
}

module.exports = { ...ROOM, register };
