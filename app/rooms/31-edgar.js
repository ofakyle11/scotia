'use strict';
// Room 31 — EDGAR. The SEC's official full-text search, fair-access compliant.
const { layout, esc, table, empty, tag, kv, input } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 31, id: 'edgar', title: 'EDGAR', phase: 'Always on' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => render(res, ctx, null));

  app.route('POST', `/r/${ROOM.id}/contact`, (req, res, ctx) => {
    if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); redirect(res, '/r/edgar'); return; }
    const contact = String(ctx.body.contact || '').trim();
    if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) { ctx.setFlash('Enter a valid contact email.', 'err'); redirect(res, '/r/edgar'); return; }
    ctx.kernel.firm.put('setting', { id: 'edgar', contact: contact || null });
    ctx.setFlash(contact ? 'Fair-access contact declared — EDGAR searches enabled.' : 'Contact cleared — searches disabled until one is set.');
    redirect(res, '/r/edgar');
  });

  app.route('POST', `/r/${ROOM.id}/search`, async (req, res, ctx) => {
    const q = String(ctx.body.q || '').trim();
    const forms = String(ctx.body.forms || '').trim();
    if (!q) { ctx.setFlash('Enter a search.', 'err'); redirect(res, '/r/edgar'); return; }
    const out = await ctx.kernel.edgar.search(q, { forms: forms || undefined, contact: ctx.kernel.edgar.contact() });
    if (!out.ok) { ctx.setFlash('EDGAR: ' + out.message, 'err'); redirect(res, '/r/edgar'); return; }
    render(res, ctx, { q, forms, ...out });
  });

  app.route('POST', `/r/${ROOM.id}/save`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter to save filings to its file.', 'err'); redirect(res, '/r/edgar'); return; }
    const { company, form, date, description, url, adsh } = ctx.body;
    if (!company || !url) { ctx.setFlash('Nothing to save.', 'err'); redirect(res, '/r/edgar'); return; }
    ctx.kernel.scope(ctx.matter.id).put('secFiling', { company, form, date, description, url, adsh, source: 'edgar' });
    ctx.setFlash(`Saved to ${ctx.matter.title}: ${company} ${form || ''}`);
    redirect(res, '/r/edgar');
  });
}

function render(res, ctx, search) {
  const k = ctx.kernel;
  const contact = k.edgar.contact();
  const saved = ctx.matter ? k.scope(ctx.matter.id).list('secFiling') : [];

  // Results render first — after a search, what you asked for tops the page.
  const results = search ? `
    <h2 class="sec" style="margin-top:0">Results — ${esc(String(search.total))} filings for “${esc(search.q)}”${search.forms ? ' in ' + esc(search.forms) : ''}</h2>
    ${search.results.length ? table(['Company', 'Form', 'Filed', 'Document', ''], search.results.map((r) => [
      esc(r.company), tag(r.form || '?', 'navy'), esc(r.date),
      `<a href="${esc(r.url)}" rel="noopener" target="_blank">${esc(r.description || r.doc || r.adsh)}</a>`,
      `<form method="POST" action="/r/edgar/save" style="margin:0">
        <input type="hidden" name="company" value="${esc(r.company)}"><input type="hidden" name="form" value="${esc(r.form || '')}">
        <input type="hidden" name="date" value="${esc(r.date)}"><input type="hidden" name="description" value="${esc(r.description || '')}">
        <input type="hidden" name="url" value="${esc(r.url)}"><input type="hidden" name="adsh" value="${esc(r.adsh)}">
        <button class="quiet">Save to matter</button></form>`,
    ])) : empty('No filings matched.')}` : '';

  const body = `
  ${results}
  <div class="grid2">
    <div class="card">
      <h2 class="sec" style="margin-top:0">Full-text search of SEC filings</h2>
      <form method="POST" action="/r/edgar/search">
        ${input('q', 'Query — use quotes for exact phrases', { required: true, value: search ? search.q : '', placeholder: '"change of control" royalty' })}
        ${input('forms', 'Form filter (optional)', { value: search ? search.forms : '', placeholder: '10-K,8-K,S-1,DEF 14A' })}
        <button>Search EDGAR</button>
      </form>
      <p class="note">Litigation gold sits in here: material agreements as exhibits (EX-10), disclosed lawsuits, related-party dealings, executive contracts — searchable to 2001. Every result links to the primary document on sec.gov.</p>
    </div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Connector status</h2>
      ${kv([
        ['EDGAR full-text API', tag('official — free & public', 'ok')],
        ['Fair-access contact', contact ? `<span class="num">${esc(contact)}</span>` : tag('required before searching', 'gate')],
        ['Search UI', `<a href="${esc(k.edgar.links.fullTextUi)}" rel="noopener" target="_blank">sec.gov/edgar/search →</a>`],
      ])}
      <p class="note">The SEC's fair-access policy asks every automated client to identify itself with a contact and stay under 10 requests/second. This module declares the contact on every request and searches only on demand — no bulk pulls.</p>
      ${ctx.user.role === 'admin' ? `<form method="POST" action="/r/edgar/contact">${input('contact', 'Declared contact email', { type: 'email', value: contact || '' })}<button>Save contact</button></form>` : ''}
    </div>
  </div>
  ${ctx.matter ? `<h2 class="sec">On the file — ${esc(ctx.matter.title)}</h2>` + (saved.length
    ? table(['Company', 'Form', 'Filed', 'Document'], saved.map((s) => [esc(s.company), tag(s.form || '?', 'navy'), esc(s.date || ''), `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.description || s.adsh || 'open')} →</a>`]))
    : empty('No SEC filings saved to this matter yet.')) : ''}
  `;
  html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'SEC filings — contracts, disclosures, and exhibits at the source', body }));
}

module.exports = { ...ROOM, register };
