'use strict';
// Room 30 — PACER / RECAP. Free RECAP archive first; PACER linked, never scraped.
const { layout, esc, table, empty, tag, kv, input, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 30, id: 'uscourts', title: 'PACER / RECAP', phase: 'Always on' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => render(res, ctx, null));

  app.route('POST', `/r/${ROOM.id}/token`, (req, res, ctx) => {
    if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); redirect(res, '/r/uscourts'); return; }
    const token = String(ctx.body.token || '').trim();
    ctx.kernel.firm.put('setting', { id: 'courtlistener', token: token || null });
    // Same audit line room 29 writes for its API key: who turned the connector
    // up or down, never the credential itself.
    ctx.kernel.audit('courtlistener.token.' + (token ? 'set' : 'cleared'), 'setting:courtlistener');
    ctx.setFlash(token ? 'CourtListener token stored (encrypted at rest) — higher rate limits.' : 'Token cleared — anonymous rate limits apply.');
    redirect(res, '/r/uscourts');
  });

  app.route('POST', `/r/${ROOM.id}/search`, async (req, res, ctx) => {
    const q = String(ctx.body.q || '').trim();
    const type = ctx.body.type === 'r' ? 'r' : 'o';
    if (!q) { ctx.setFlash('Enter a search.', 'err'); redirect(res, '/r/uscourts'); return; }
    // Matter content is leaving the building. Every other egress in this product
    // is audited per call (the model gateway most of all), and these four
    // connector calls were not audited at all — so a client's name could be sent
    // to a third party with nothing in the record that it ever happened.
    // The QUERY TEXT is deliberately not recorded: operator-typed search text can
    // name a client or an adverse party, and the audit log is plaintext, survives
    // crypto-shredding and rides in every backup. What the record needs is that a
    // disclosure occurred, to whom, on which matter, by whom and when — so the
    // line carries the target and the query's length, never its words.
    ctx.kernel.audit('courtlistener.search', (ctx.matter ? ctx.matter.id : 'no-matter') + ':' + type + ':qlen=' + q.length);
    const out = await ctx.kernel.uscourts.search(q, type, ctx.kernel.uscourts.token());
    if (!out.ok) { ctx.setFlash('CourtListener: ' + out.message, 'err'); redirect(res, '/r/uscourts'); return; }
    render(res, ctx, { q, type, ...out });
  });

  app.route('POST', `/r/${ROOM.id}/save`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter to save results to its file.', 'err'); redirect(res, '/r/uscourts'); return; }
    const { caseName, court, dateFiled, docketNumber, citation, kind } = ctx.body;
    const url = String(ctx.body.url || '').trim();
    if (!caseName || !url) { ctx.setFlash('Nothing to save.', 'err'); redirect(res, '/r/uscourts'); return; }
    // Scheme allowlist: the stored value is re-rendered as a clickable link on
    // the shared matter view, and esc() cannot neutralize a javascript: URI.
    if (!isWeb(url)) { ctx.setFlash('Refused: only http(s) links can be saved to the file.', 'err'); redirect(res, '/r/uscourts'); return; }
    // Running the same search twice is normal; saving the same record twice is
    // not. One row per document on the file, keyed on its CourtListener url.
    const s = k.scope(ctx.matter.id);
    const type = kind === 'r' ? 'docketRef' : 'authority';
    const src = kind === 'r' ? 'recap' : 'courtlistener';
    if (s.list(type, (x) => x.source === src && x.url === url).length) {
      ctx.setFlash(`Already on ${ctx.matter.title}: ${caseName}`);
      redirect(res, '/r/uscourts'); return;
    }
    if (kind === 'r') {
      s.put('docketRef', { caseName, court, dateFiled, docketNumber, url, source: 'recap' });
      ctx.setFlash(`Saved to ${ctx.matter.title}: ${caseName} — a docket reference. The archive's copy is not the court's record; pull the filing itself before you rely on it.`);
    } else {
      s.put('authority', { cite: citation || caseName, title: caseName, court, decisionDate: dateFiled, url, source: 'courtlistener', resolved: true });
      ctx.setFlash(`Saved to ${ctx.matter.title}: ${caseName} — an authority. Citation Check (room 08) still verifies it before it reaches a filed document.`);
    }
    redirect(res, '/r/uscourts');
  });
}

// A url that came back from the archive — or that was stored from one — is
// re-rendered as a clickable link, and esc() cannot neutralise a javascript:
// URI. Nothing that is not http(s) becomes an href.
const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));
const linkOut = (url, label) => (isWeb(url) ? `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)} →</a>` : esc(label));
// Figures read down a column.
const rcell = (h) => `<div style="text-align:right">${h}</div>`;

function render(res, ctx, search) {
  const k = ctx.kernel;
  const token = k.uscourts.token();
  const saved = ctx.matter ? [
    ...k.scope(ctx.matter.id).list('authority', (a) => a.source === 'courtlistener').map((a) => ({ ...a, _k: 'Opinion' })),
    ...k.scope(ctx.matter.id).list('docketRef', (d) => d.source === 'recap').map((d) => ({ ...d, _k: 'Docket' })),
  ] : [];

  // Results render first — after a search, what you asked for tops the page.
  const count = Number(search && search.count);
  const results = search ? `
    <h2 class="sec" style="margin-top:0">Results — ${Number.isFinite(count) ? esc(count.toLocaleString('en-CA')) + ` match${count === 1 ? '' : 'es'}` : esc(String(search.results.length)) + ' shown'} for “${esc(search.q)}” (${search.type === 'r' ? 'RECAP dockets' : 'opinions'})</h2>
    ${search.results.length ? table(['Case', 'Court', 'Filed', search.type === 'r' ? 'Docket' : 'Citation', 'Cited by', ''], search.results.map((r) => [
      linkOut(r.url, r.caseName || '(unnamed)'),
      esc(r.court), date(r.dateFiled), `<span class="num">${esc(search.type === 'r' ? r.docketNumber : (r.citation[0] || ''))}</span>`,
      r.citeCount != null ? rcell(`<span class="num">${esc(String(r.citeCount))}</span>`) : '',
      !ctx.matter ? '<span class="note">open a matter to save</span>' : !isWeb(r.url) ? '' : `<form method="POST" action="/r/uscourts/save" style="margin:0">
        <input type="hidden" name="caseName" value="${esc(r.caseName)}"><input type="hidden" name="court" value="${esc(r.court)}">
        <input type="hidden" name="dateFiled" value="${esc(r.dateFiled)}"><input type="hidden" name="docketNumber" value="${esc(r.docketNumber)}">
        <input type="hidden" name="citation" value="${esc(r.citation[0] || '')}"><input type="hidden" name="url" value="${esc(r.url)}">
        <input type="hidden" name="kind" value="${esc(search.type)}"><button class="quiet">Save to matter</button></form>`,
    ])) : empty('Nothing in the archive matches that. Try a party name alone, drop the quotes, or switch corpus — then the PACER Case Locator below for dockets RECAP has never seen.')}` : '';

  const body = `
  ${results}
  <div class="card">
    <h2 class="sec" style="margin-top:0">Search the RECAP archive ${token ? tag('token — higher limits', 'ok') : tag('anonymous — rate-limited', 'navy')}</h2>
    <form method="POST" action="/r/uscourts/search" class="grid2" style="align-items:end">
      <span>${input('q', 'Query — party, case name, keywords', { required: true, value: search ? search.q : '', placeholder: 'e.g. Twombly, or "restrictive covenant" tire' })}</span>
      <span>${select('type', 'Corpus', [['o', 'Opinions (case law)'], ['r', 'RECAP dockets & filings']], search ? search.type : 'o')}</span>
      <button>Search</button>
    </form>
    <p class="note">The Free Law Project's CourtListener API — free and public, covering millions of federal opinions and every PACER document the RECAP community has archived. Check here before paying PACER for the same pages.</p>
  </div>
  ${ctx.matter ? `<h2 class="sec">On the file — ${esc(ctx.matter.title)}</h2>` + (saved.length
    ? table(['Case', 'Kind', 'Court', 'Date', 'Link'], saved.map((s) => [
      esc(s.title || s.caseName || ''), tag(s._k, s._k === 'Opinion' ? 'navy' : ''),
      esc(s.court || ''), date(s.decisionDate || s.dateFiled), linkOut(s.url, 'open'),
    ]))
    : empty('Nothing saved from US courts to this matter yet — search above and save a result; an opinion lands as an authority, a docket as a docket reference.'))
    : empty('No matter open — searching still works, but nothing can be saved to a file. Open a matter to keep what you find.')}
  <h2 class="sec">Connector</h2>
  <div class="card">
    ${kv([
      ['RECAP / CourtListener', tag('live — official API', 'ok')],
      ['API token', token ? `<span class="num">····${esc(token.slice(-4))}</span> (encrypted at rest)` : 'anonymous (rate-limited)'],
      ['PACER', `${linkOut(k.uscourts.links.pacerLocator, 'Case Locator')} · ${linkOut(k.uscourts.links.pacer, 'pacer.uscourts.gov')}`],
    ])}
    <p class="note">PACER itself has no free API: access is credentialed and billed per page, and scraping it breaches its terms. The workflow is RECAP-first (free), then PACER by hand for what the archive lacks — new purchases can be contributed back to RECAP so the next lookup is free.</p>
    ${ctx.user.role === 'admin'
      ? `<form method="POST" action="/r/uscourts/token">${input('token', 'CourtListener API token (optional, blank to clear)')}<button>Save token</button></form>`
      : '<p class="note">An administrator can add the firm’s CourtListener token. Without one the archive is still searchable, just rate-limited.</p>'}
  </div>
  `;
  html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'US federal court records — RECAP archive first, PACER linked', body }));
}

module.exports = { ...ROOM, register };
