'use strict';
// Room 30 — PACER / RECAP. Free RECAP archive first; PACER linked, never scraped.
const { layout, esc, table, empty, tag, kv, input, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 30, id: 'uscourts', title: 'PACER / RECAP', phase: 'Always on' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => render(res, ctx, null));

  app.route('POST', `/r/${ROOM.id}/token`, (req, res, ctx) => {
    if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); redirect(res, '/r/uscourts'); return; }
    const token = String(ctx.body.token || '').trim();
    ctx.kernel.firm.put('setting', { id: 'courtlistener', token: token || null });
    ctx.setFlash(token ? 'CourtListener token stored (encrypted at rest) — higher rate limits.' : 'Token cleared — anonymous rate limits apply.');
    redirect(res, '/r/uscourts');
  });

  app.route('POST', `/r/${ROOM.id}/search`, async (req, res, ctx) => {
    const q = String(ctx.body.q || '').trim();
    const type = ctx.body.type === 'r' ? 'r' : 'o';
    if (!q) { ctx.setFlash('Enter a search.', 'err'); redirect(res, '/r/uscourts'); return; }
    const out = await ctx.kernel.uscourts.search(q, type, ctx.kernel.uscourts.token());
    if (!out.ok) { ctx.setFlash('CourtListener: ' + out.message, 'err'); redirect(res, '/r/uscourts'); return; }
    render(res, ctx, { q, type, ...out });
  });

  app.route('POST', `/r/${ROOM.id}/save`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter to save results to its file.', 'err'); redirect(res, '/r/uscourts'); return; }
    const { caseName, court, dateFiled, docketNumber, citation, url, kind } = ctx.body;
    if (!caseName || !url) { ctx.setFlash('Nothing to save.', 'err'); redirect(res, '/r/uscourts'); return; }
    if (kind === 'r') {
      k.scope(ctx.matter.id).put('docketRef', { caseName, court, dateFiled, docketNumber, url, source: 'recap' });
    } else {
      k.scope(ctx.matter.id).put('authority', { cite: citation || caseName, title: caseName, court, decisionDate: dateFiled, url, source: 'courtlistener', resolved: true });
    }
    ctx.setFlash(`Saved to ${ctx.matter.title}: ${caseName}`);
    redirect(res, '/r/uscourts');
  });
}

function render(res, ctx, search) {
  const k = ctx.kernel;
  const token = k.uscourts.token();
  const saved = ctx.matter ? [
    ...k.scope(ctx.matter.id).list('authority', (a) => a.source === 'courtlistener').map((a) => ({ ...a, _k: 'Opinion' })),
    ...k.scope(ctx.matter.id).list('docketRef', (d) => d.source === 'recap').map((d) => ({ ...d, _k: 'Docket' })),
  ] : [];

  // Results render first — after a search, what you asked for tops the page.
  const results = search ? `
    <h2 class="sec" style="margin-top:0">Results — ${esc(String(search.count))} match${search.count === 1 ? '' : 'es'} for “${esc(search.q)}” (${search.type === 'r' ? 'RECAP dockets' : 'opinions'})</h2>
    ${search.results.length ? table(['Case', 'Court', 'Filed', search.type === 'r' ? 'Docket' : 'Citation', 'Cited by', ''], search.results.map((r) => [
      `<a href="${esc(r.url)}" rel="noopener" target="_blank">${esc(r.caseName)}</a>`,
      esc(r.court), esc(r.dateFiled), `<span class="num">${esc(search.type === 'r' ? r.docketNumber : (r.citation[0] || ''))}</span>`,
      r.citeCount != null ? `<span class="num">${r.citeCount}</span>` : '',
      `<form method="POST" action="/r/uscourts/save" style="margin:0">
        <input type="hidden" name="caseName" value="${esc(r.caseName)}"><input type="hidden" name="court" value="${esc(r.court)}">
        <input type="hidden" name="dateFiled" value="${esc(r.dateFiled)}"><input type="hidden" name="docketNumber" value="${esc(r.docketNumber)}">
        <input type="hidden" name="citation" value="${esc(r.citation[0] || '')}"><input type="hidden" name="url" value="${esc(r.url)}">
        <input type="hidden" name="kind" value="${esc(search.type)}"><button class="quiet">Save to matter</button></form>`,
    ])) : empty('No matches in the archive — try the PACER Case Locator link for live federal dockets.')}` : '';

  const body = `
  ${results}
  <div class="grid2">
    <div class="card">
      <h2 class="sec" style="margin-top:0">Search the RECAP archive</h2>
      <form method="POST" action="/r/uscourts/search">
        ${input('q', 'Query — party, case name, keywords', { required: true, value: search ? search.q : '', placeholder: 'e.g. Twombly, or "restrictive covenant" tire' })}
        ${select('type', 'Corpus', [['o', 'Opinions (case law)'], ['r', 'RECAP dockets & filings']], search ? search.type : 'o')}
        <button>Search</button>
      </form>
      <p class="note">Powered by the Free Law Project's CourtListener API — free and public, covering millions of federal opinions and every PACER document the RECAP community has archived. Check here before paying PACER for the same pages.</p>
    </div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Connector status</h2>
      ${kv([
        ['RECAP / CourtListener', tag('live — official API', 'ok')],
        ['API token', token ? `<span class="num">····${esc(token.slice(-4))}</span>` : 'anonymous (rate-limited)'],
        ['PACER', `<a href="${esc(k.uscourts.links.pacerLocator)}" rel="noopener" target="_blank">Case Locator →</a> · <a href="${esc(k.uscourts.links.pacer)}" rel="noopener" target="_blank">pacer.uscourts.gov →</a>`],
      ])}
      <p class="note">PACER itself has no free API: access is credentialed and billed per page, and scraping it breaches its terms. The workflow is RECAP-first (free), then PACER by hand for what the archive lacks — new purchases can be contributed back to RECAP so the next lookup is free.</p>
      ${ctx.user.role === 'admin' ? `<form method="POST" action="/r/uscourts/token">${input('token', 'CourtListener API token (optional, blank to clear)')}<button>Save token</button></form>` : ''}
    </div>
  </div>
  ${ctx.matter ? `<h2 class="sec">On the file — ${esc(ctx.matter.title)}</h2>` + (saved.length
    ? table(['Kind', 'Case', 'Court', 'Date', 'Link'], saved.map((s) => [tag(s._k, s._k === 'Opinion' ? 'navy' : ''), esc(s.title || s.caseName), esc(s.court || ''), esc(s.decisionDate || s.dateFiled || ''), `<a href="${esc(s.url)}" rel="noopener" target="_blank">open →</a>`]))
    : empty('Nothing saved from US courts to this matter yet.')) : ''}
  `;
  html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'US federal court records — RECAP archive first, PACER linked', body }));
}

module.exports = { ...ROOM, register };
