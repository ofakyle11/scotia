'use strict';
// Room 31 — EDGAR. The SEC's official full-text search, fair-access compliant.
// Searches run on demand only; every hit links to the primary document on
// sec.gov, and what counsel keeps is written to the matter's encrypted file.
const { layout, esc, table, empty, tag, kv, input, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 31, id: 'edgar', title: 'EDGAR', phase: 'Always on' };

// A url that came back from EDGAR — or that was stored from one — is re-rendered
// as a clickable link, and esc() cannot neutralise a javascript: URI. Nothing
// that is not http(s) ever becomes an href.
const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));
const linkOut = (url, label) => (isWeb(url) ? `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)} &rarr;</a>` : esc(label));
const trim = (v) => String(v ?? '').trim();

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => render(res, ctx, null));

  app.route('POST', `/r/${ROOM.id}/contact`, (req, res, ctx) => {
    if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); redirect(res, '/r/edgar'); return; }
    const contact = trim(ctx.body.contact);
    if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) { ctx.setFlash('Enter a valid contact email.', 'err'); redirect(res, '/r/edgar'); return; }
    ctx.kernel.firm.put('setting', { id: 'edgar', contact: contact || null });
    // The same audit line rooms 29 and 30 write for their connectors: who turned
    // this one up or down, never the credential itself.
    ctx.kernel.audit('edgar.contact.' + (contact ? 'set' : 'cleared'), 'setting:edgar');
    ctx.setFlash(contact ? 'Fair-access contact declared — EDGAR searches enabled.' : 'Contact cleared — searches disabled until one is set.');
    redirect(res, '/r/edgar');
  });

  app.route('POST', `/r/${ROOM.id}/search`, async (req, res, ctx) => {
    const q = trim(ctx.body.q);
    const forms = trim(ctx.body.forms);
    if (!q) { ctx.setFlash('Enter a search.', 'err'); redirect(res, '/r/edgar'); return; }
    const out = await ctx.kernel.edgar.search(q, { forms: forms || undefined, contact: ctx.kernel.edgar.contact() });
    if (!out.ok) { ctx.setFlash('EDGAR: ' + out.message, 'err'); redirect(res, '/r/edgar'); return; }
    render(res, ctx, { q, forms, ...out });
  });

  app.route('POST', `/r/${ROOM.id}/save`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter to save filings to its file.', 'err'); redirect(res, '/r/edgar'); return; }
    const company = trim(ctx.body.company), form = trim(ctx.body.form), url = trim(ctx.body.url);
    const filed = trim(ctx.body.date), description = trim(ctx.body.description), adsh = trim(ctx.body.adsh);
    if (!company || !url) { ctx.setFlash('Nothing to save.', 'err'); redirect(res, '/r/edgar'); return; }
    // Scheme allowlist: the stored value is re-rendered as a clickable link on
    // the shared matter view, and esc() cannot neutralize a javascript: URI.
    if (!isWeb(url)) { ctx.setFlash('Refused: only http(s) links can be saved to the file.', 'err'); redirect(res, '/r/edgar'); return; }
    // Running the same search twice is normal; filing the same document twice is
    // not. One row per filing on the file, keyed on its sec.gov url.
    const s = k.scope(ctx.matter.id);
    if (s.list('secFiling', (x) => x.url === url).length) {
      ctx.setFlash(`Already on ${ctx.matter.title}: ${company} ${form}`.trim());
      redirect(res, '/r/edgar'); return;
    }
    s.put('secFiling', { company, form, date: filed, description, url, adsh, source: 'edgar' });
    ctx.setFlash(`Saved to ${ctx.matter.title}: ${company} ${form}`.trim());
    redirect(res, '/r/edgar');
  });
}

function render(res, ctx, search) {
  const k = ctx.kernel;
  const contact = k.edgar.contact();
  const saved = ctx.matter ? k.scope(ctx.matter.id).list('secFiling') : [];

  // Results render first — after a search, what you asked for tops the page.
  const total = Number(search && search.total);
  const results = search ? `
    <h2 class="sec" style="margin-top:0">Results &mdash; ${Number.isFinite(total) ? esc(total.toLocaleString('en-CA')) + ` filing${total === 1 ? '' : 's'}` : esc(String(search.results.length)) + ' shown'} for &ldquo;${esc(search.q)}&rdquo;${search.forms ? ' in ' + esc(search.forms) : ''}</h2>
    ${search.results.length ? table(['Company', 'Form', 'Filed', 'Document', ''], search.results.map((r) => [
      esc(r.company || '(unnamed filer)'),
      tag(r.form || '?', 'navy'),
      date(r.date) || '—',
      linkOut(r.url, r.description || r.doc || r.adsh || 'open on sec.gov'),
      !ctx.matter ? '<span class="note">open a matter to save</span>' : !isWeb(r.url) ? '' : `<form method="POST" action="/r/edgar/save" style="margin:0">
        <input type="hidden" name="company" value="${esc(r.company)}"><input type="hidden" name="form" value="${esc(r.form || '')}">
        <input type="hidden" name="date" value="${esc(r.date)}"><input type="hidden" name="description" value="${esc(r.description || '')}">
        <input type="hidden" name="url" value="${esc(r.url)}"><input type="hidden" name="adsh" value="${esc(r.adsh)}">
        <button class="quiet">Save to matter</button></form>`,
    ])) : empty('Nothing matched. Try the company name alone, drop the form filter, or unquote the phrase — full-text coverage starts at 2001; older filings are in the browse UI linked under Connector.')}` : '';

  const searchCard = `
    <div class="card">
      <h2 class="sec" style="margin-top:0">Full-text search of SEC filings ${contact ? '' : tag('contact required', 'gate')}</h2>
      ${contact ? `<form method="POST" action="/r/edgar/search" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <span style="flex:2 1 280px">${input('q', 'Query — quotes for an exact phrase', { required: true, value: search ? search.q : '', placeholder: '"change of control" royalty' })}</span>
        <span style="flex:1 1 180px">${input('forms', 'Form filter (optional)', { value: search ? search.forms : '', placeholder: '10-K,8-K,S-1,DEF 14A' })}</span>
        <button style="margin-top:0">Search EDGAR</button>
      </form>` : empty('EDGAR refuses automated requests that do not identify themselves. Declare the firm’s fair-access contact in Connector above — an administrator sets it once — and search opens here.')}
      <p class="note">Litigation gold sits in here: material agreements filed as exhibits (EX-10), disclosed lawsuits, related-party dealings, executive contracts — searchable to 2001. Every result links to the primary document on sec.gov.</p>
    </div>`;

  const connectorCard = `
    <div class="card">
      <h2 class="sec" style="margin-top:0">Connector ${contact ? tag('live', 'ok') : tag('idle — no contact', 'gate')}</h2>
      ${kv([
        ['EDGAR full-text API', tag('official — free & public', 'ok')],
        ['Fair-access contact', contact ? `<span class="num">${esc(contact)}</span>` : tag('required before searching', 'gate')],
        ['Search UI', linkOut(k.edgar.links.fullTextUi, 'sec.gov/edgar/search')],
      ])}
      <p class="note">The SEC's fair-access policy asks every automated client to identify itself with a contact and stay under 10 requests/second. This module declares the contact on every request and searches only on demand — no bulk pulls.</p>
      ${ctx.user.role === 'admin'
        ? `<form method="POST" action="/r/edgar/contact">${input('contact', 'Declared contact email (blank to clear)', { type: 'email', value: contact || '' })}<button>Save contact</button></form>`
        : '<p class="note">An administrator declares the firm’s contact. Until one is set the SEC declines the request and nothing here searches.</p>'}
    </div>`;

  const onFile = ctx.matter
    ? `<h2 class="sec">On the file — ${esc(ctx.matter.title)} ${saved.length ? tag(saved.length + ' filing' + (saved.length === 1 ? '' : 's'), 'navy') : ''}</h2>`
      + (saved.length
        ? table(['Company', 'Form', 'Filed', 'Document'], saved.map((s) => [
          esc(s.company || ''), tag(s.form || '?', 'navy'), date(s.date) || '—',
          linkOut(s.url, s.description || s.adsh || 'open'),
        ]))
        : empty('Nothing saved from EDGAR to this matter yet — search above and save the filing; the stored link points at the primary document on sec.gov.'))
    : empty('No matter open — searching still works, but nothing can be saved to a file. Open a matter to keep what you find.');

  // Most-used control first: normally the search box, but with no fair-access
  // contact declared nothing can search, so the connector leads instead.
  const body = `
  ${results}
  ${contact ? searchCard : connectorCard}
  ${onFile}
  ${contact ? connectorCard : searchCard}
  `;
  html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'SEC filings — contracts, disclosures, and exhibits at the source', body }));
}

module.exports = { ...ROOM, register };
