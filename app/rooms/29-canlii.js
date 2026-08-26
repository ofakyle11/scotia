'use strict';
// Room 29 — CanLII connector. Official API + deep links; never scraping.
// Resolves Canadian citations to real cases, pulls the citator, and feeds
// verified authorities to Citation Check and the Research Desk.
const { layout, esc, table, empty, tag, kv, input, textarea } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 29, id: 'canlii', title: 'CanLII', phase: 'Always on' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, async (req, res, ctx) => {
    render(res, ctx, null);
  });

  // Admin: set or clear the API key (stored in the encrypted firm log).
  app.route('POST', `/r/${ROOM.id}/key`, (req, res, ctx) => {
    if (!ctx.kernel.isAdmin()) { ctx.setFlash('Administrators only.', 'err'); redirect(res, '/r/canlii'); return; }
    const key = String(ctx.body.apiKey || '').trim();
    ctx.kernel.firm.put('setting', { id: 'canlii', apiKey: key || null });
    ctx.kernel.audit('canlii.key.' + (key ? 'set' : 'cleared'), 'setting:canlii');
    ctx.setFlash(key ? 'CanLII API key stored (encrypted at rest). Live mode on.' : 'API key cleared — link-out mode.');
    redirect(res, '/r/canlii');
  });

  // Scan pasted text for Canadian citations; render results inline.
  app.route('POST', `/r/${ROOM.id}/scan`, (req, res, ctx) => {
    const text = String(ctx.body.text || '').trim();
    if (!text) { ctx.setFlash('Paste some text to scan.', 'err'); redirect(res, '/r/canlii'); return; }
    const cites = ctx.kernel.canlii.parseCitations(text);
    render(res, ctx, { cites, scanned: text.length });
  });

  // Resolve one citation against the official API; save as a verified authority.
  app.route('POST', `/r/${ROOM.id}/resolve`, async (req, res, ctx) => {
    const k = ctx.kernel;
    const cite = String(ctx.body.cite || '').trim();
    const databaseId = String(ctx.body.databaseId || '').trim();
    const caseId = String(ctx.body.caseId || '').trim();
    if (!cite || !databaseId || !caseId || !/^[a-z0-9-]+$/.test(databaseId) || !/^[a-z0-9.-]+$/.test(caseId)) {
      ctx.setFlash('Nothing to resolve — scan text first (SCR-style cites are link-out only).', 'err');
      redirect(res, '/r/canlii'); return;
    }
    const key = k.canlii.apiKey();
    if (!key) { ctx.setFlash('Link-out mode: no API key. Use the CanLII search link, or an admin can add a key for live resolution.', 'err'); redirect(res, '/r/canlii'); return; }
    const cached = k.firm.get('canliiCase', databaseId + '/' + caseId);
    const out = cached ? { ok: true, data: cached.meta, cached: true } : await k.canlii.fetchCase({ databaseId, caseId }, key);
    if (!out.ok) { ctx.setFlash('CanLII: ' + out.message, 'err'); redirect(res, '/r/canlii'); return; }
    if (!cached) k.firm.put('canliiCase', { id: databaseId + '/' + caseId, databaseId, caseId, meta: out.data, fetched: new Date().toISOString() });
    if (ctx.matter) {
      k.scope(ctx.matter.id).put('authority', {
        cite, title: out.data.title, url: out.data.url, court: databaseId,
        decisionDate: out.data.decisionDate, docket: out.data.docketNumber,
        source: 'canlii-api', resolved: true,
      });
    }
    ctx.setFlash(`Resolved${out.cached ? ' (cache)' : ''}: ${out.data.title}, ${out.data.citation} — ${ctx.matter ? 'saved to ' + ctx.matter.title + '.' : 'no matter open, not saved.'}`);
    redirect(res, '/r/canlii');
  });

  // Citator pull for a cached case: what cites it, what it cites.
  app.route('POST', `/r/${ROOM.id}/citator`, async (req, res, ctx) => {
    const k = ctx.kernel;
    const id = String(ctx.body.id || '');
    const rec = k.firm.get('canliiCase', id);
    if (!rec) { ctx.setFlash('Resolve the case first.', 'err'); redirect(res, '/r/canlii'); return; }
    const key = k.canlii.apiKey();
    if (!key) { ctx.setFlash('Citator needs live mode (API key).', 'err'); redirect(res, '/r/canlii'); return; }
    const ids = { databaseId: rec.databaseId, caseId: rec.caseId };
    const citing = await k.canlii.fetchCitator(ids, 'citingCases', key);
    const cited = await k.canlii.fetchCitator(ids, 'citedCases', key);
    if (!citing.ok && !cited.ok) { ctx.setFlash('CanLII: ' + citing.message, 'err'); redirect(res, '/r/canlii'); return; }
    k.firm.put('canliiCase', {
      ...rec,
      citator: {
        citingCount: citing.ok ? (citing.data.citingCases || []).length : null,
        citedCount: cited.ok ? (cited.data.citedCases || []).length : null,
        citingSample: citing.ok ? (citing.data.citingCases || []).slice(0, 10) : [],
        pulled: new Date().toISOString(),
      },
    });
    ctx.setFlash('Citator pulled — a citation count is a signal, not editorial treatment; Citation Check stays human-confirmed.');
    redirect(res, '/r/canlii');
  });
}

function render(res, ctx, scan) {
  const k = ctx.kernel;
  const key = k.canlii.apiKey();
  const cache = k.firm.list('canliiCase').sort((a, b) => (b.fetched || '').localeCompare(a.fetched || ''));
  const authorities = ctx.matter ? k.scope(ctx.matter.id).list('authority', (a) => a.source === 'canlii-api') : [];

  const scanBlock = scan ? `
    <h2 class="sec">Scan results — ${scan.cites.length} citation${scan.cites.length === 1 ? '' : 's'} found</h2>
    ${scan.cites.length ? table(['Citation', 'Kind', 'CanLII ids', 'Actions'], scan.cites.map((c) => [
      `<span class="num">${esc(c.cite)}</span>`, esc(c.kind),
      c.ids ? `<span class="num">${esc(c.ids.databaseId)}/${esc(c.ids.caseId)}</span>` : tag('link-out only'),
      `<a href="${esc(k.canlii.searchUrl(c.cite))}" rel="noopener" target="_blank">Open on CanLII →</a>` +
      (c.ids ? ` <form method="POST" action="/r/canlii/resolve" style="display:inline;margin-left:10px"><input type="hidden" name="cite" value="${esc(c.cite)}"><input type="hidden" name="databaseId" value="${esc(c.ids.databaseId)}"><input type="hidden" name="caseId" value="${esc(c.ids.caseId)}"><button class="quiet">${key ? 'Resolve via API' : 'Resolve (needs key)'}</button></form>` : ''),
    ])) : empty('No Canadian citations recognized.')}` : '';

  const body = `
  <div class="grid2">
    <div class="card">
      <h2 class="sec" style="margin-top:0">Citation scanner</h2>
      <form method="POST" action="/r/canlii/scan">
        ${textarea('text', 'Paste any text — factum, memo, opposing brief', { placeholder: 'e.g. ... as held in Dunsmuir v. New Brunswick, 2008 SCC 9 ...' })}
        <button>Scan for Canadian citations</button>
      </form>
      <p class="note">Recognizes neutral citations (2008 SCC 9), CanLII citations (1999 CanLII 1527 (ON CA)), and SCR citations. Neutral and CanLII cites resolve deterministically to CanLII ids — no search required.</p>
    </div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Connector status</h2>
      ${kv([
        ['Mode', key ? tag('live — official API', 'ok') : tag('link-out (no key)', 'navy')],
        ['API key', key ? `<span class="num">····${esc(key.slice(-4))}</span> (encrypted at rest)` : '—'],
        ['Resolved cache', `<span class="num">${cache.length}</span> cases`],
      ])}
      <p class="note">This module never scrapes canlii.org — their Terms of Use prohibit scraping and bulk downloading. It uses the official REST API (metadata + citator) and citation deep links, which CanLII encourages. A key is requested from CanLII via their feedback form; commercial-scale use is a licensing conversation with CanLII (Build Sheet, Gap 4).</p>
      ${ctx.user.role === 'admin' ? `<form method="POST" action="/r/canlii/key">${input('apiKey', 'API key (blank to clear)', { placeholder: 'paste CanLII api_key' })}<button>Save key</button></form>` : '<p class="note">An administrator can add the firm’s API key.</p>'}
    </div>
  </div>
  ${scanBlock}
  ${ctx.matter ? `<h2 class="sec">Resolved authorities — ${esc(ctx.matter.title)}</h2>` +
    (authorities.length ? table(['Citation', 'Case', 'Decided', 'Docket', 'Link'], authorities.map((a) => [
      `<span class="num">${esc(a.cite)}</span>`, esc(a.title), esc(a.decisionDate || ''), esc(a.docket || ''),
      a.url ? `<a href="${esc(a.url)}" rel="noopener" target="_blank">canlii.ca →</a>` : '',
    ])) : empty('No CanLII-resolved authorities on this matter yet.')) : ''}
  <h2 class="sec">Resolution cache (firm-wide)</h2>
  ${cache.length ? table(['Case', 'Citation', 'Citator', ''], cache.slice(0, 25).map((c) => [
    esc(c.meta.title), `<span class="num">${esc(c.meta.citation || '')}</span>`,
    c.citator ? `<span class="num">cited by ${c.citator.citingCount ?? '?'}</span> · <span class="num">cites ${c.citator.citedCount ?? '?'}</span>` : tag('not pulled'),
    `<form method="POST" action="/r/canlii/citator" style="margin:0"><input type="hidden" name="id" value="${esc(c.id)}"><button class="quiet">${c.citator ? 'Refresh citator' : 'Pull citator'}</button></form>`,
  ])) : empty('Nothing resolved yet — scan a document and resolve its citations.')}
  `;
  html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Official API + deep links — resolution and citator for Canadian authority', body }));
}

module.exports = { ...ROOM, register };
