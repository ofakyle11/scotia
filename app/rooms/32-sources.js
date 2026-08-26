'use strict';
// Room 32 — Sources. The honest registry of external research services:
// what each is, how it may legally be accessed, and a record on the matter
// file of every lookup performed there — including commercial databases
// that offer no API and must never be scraped.
const { layout, esc, table, empty, tag, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 32, id: 'sources', title: 'Sources', phase: 'Always on' };

// Printing this page yields the diligence record: the shelf and the matter's
// lookup log under a dated header; entry forms and chrome drop out.
const PRINT = `<style>.print-only{display:none}@media print{
.print-only{display:block}
.side,.topbar,.flash,.noprint,form,button,h1.room,.roomsub{display:none!important}
.shell{display:block;min-height:0}.main{padding:0}
.grid2,.grid3{display:block}
body{background:#fff;color:#111}
.card{background:#fff;border-color:#bbb;color:#111;break-inside:avoid}
.empty{background:#fff;border-color:#bbb;color:#444}
table.t{background:#fff;border-color:#bbb}
table.t th{background:#eee;color:#333;border-color:#bbb}
table.t td{color:#111;border-color:#ddd}
h1.room,h2.sec{color:#111;border-color:#bbb}
.roomsub,.note,.kv dt{color:#444}.num,.kv dd{color:#111}
.tag{color:#111;border-color:#111;background:none}
a{color:#111}
}</style>`;

const ACCESS = [
  ['api', 'Official API — integrated'],
  ['credentialed', 'Credentialed account — link-out'],
  ['commercial', 'Commercial database — no API, link-out only'],
  ['open', 'Open website — link-out'],
];

const SEED = [
  { name: 'RoyaltySource', url: 'https://www.royaltysource.com', category: 'IP & contract valuation', access: 'commercial', notes: 'Royalty-rate comparables for licensing and IP damages. Subscription/pay-per-search; no public API — results are exported by the analyst and recorded here against the matter.' },
  { name: 'CanLII', url: 'https://www.canlii.org', category: 'Canadian case law', access: 'api', notes: 'Integrated as room 29 — official API + deep links. Scraping prohibited by ToS.' },
  { name: 'CourtListener / RECAP', url: 'https://www.courtlistener.com', category: 'US case law & dockets', access: 'api', notes: 'Integrated as room 30 — free Free Law Project API.' },
  { name: 'EDGAR', url: 'https://www.sec.gov/edgar/search/', category: 'SEC filings & contracts', access: 'api', notes: 'Integrated as room 31 — official SEC full-text API, fair-access UA.' },
  { name: 'PACER', url: 'https://pacer.uscourts.gov', category: 'US federal dockets', access: 'credentialed', notes: 'Fee-based, credentialed, no free API. RECAP-first workflow; purchases contributed back.' },
];

function ensureSeed(k) {
  if (k.firm.list('source').length === 0) {
    for (const s of SEED) k.firm.put('source', { ...s, seeded: true });
  }
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    ensureSeed(k);
    const sources = k.firm.list('source').sort((a, b) => a.name.localeCompare(b.name));
    const lookups = ctx.matter ? k.scope(ctx.matter.id).list('lookup').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) : [];
    const accLabel = (v) => (ACCESS.find(([k2]) => k2 === v) || ['', v])[1];
    const body = `
    ${PRINT}
    <div class="print-only"><h2 class="sec" style="margin-top:0">Research sources &amp; diligence record${ctx.matter ? ' — ' + esc(ctx.matter.title) : ''} — as at ${new Date().toISOString().slice(0, 10)}</h2></div>
    <h2 class="sec" style="margin-top:0">The shelf</h2>
    ${table(['Source', 'Category', 'Access', 'Notes'], sources.map((s) => [
      `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)} →</a>`, esc(s.category || ''),
      tag(accLabel(s.access), s.access === 'api' ? 'ok' : s.access === 'commercial' ? 'gate' : 'navy'),
      `<span class="note">${esc(s.notes || '')}</span>`,
    ]))}
    <div class="grid2 noprint">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Record a lookup${ctx.matter ? ' — ' + esc(ctx.matter.title) : ''}</h2>
        ${ctx.matter ? `<form method="POST" action="/r/sources/lookup">
          ${select('source', 'Source', sources.map((s) => [s.name, s.name]))}
          ${input('query', 'What was searched', { required: true })}
          ${textarea('result', 'What came back (reference, export name, rate found…)', { required: true })}
          <button>Record on the file</button>
        </form>
        <p class="note">Research done on a subscription service still belongs on the matter file — this is the diligence record, encrypted with the matter.</p>`
        : empty('Open a matter to record lookups against its file.')}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a source</h2>
        <form method="POST" action="/r/sources/add">
          ${input('name', 'Name', { required: true })}
          ${input('url', 'URL', { required: true, placeholder: 'https://…' })}
          ${input('category', 'Category', { placeholder: 'e.g. Expert directories' })}
          ${select('access', 'Access model', ACCESS, 'open')}
          ${textarea('notes', 'Access & licensing notes', { placeholder: 'API? Subscription? Scraping prohibited? Who holds the credentials?' })}
          <button>Add to shelf</button>
        </form>
        <p class="note">A commercial database with no API never gets scraped — it gets a link, a credential holder, and lookup records. Integration requests go to the vendor, on paper.</p>
      </div>
    </div>
    ${ctx.matter && lookups.length ? '<h2 class="sec">Lookup record</h2>' + table(['When', 'Source', 'Query', 'Result'], lookups.map((l) => [date(l.createdAt), esc(l.source), esc(l.query), esc(l.result)])) : ''}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'External research services — access models, credentials, and the diligence record', body }));
  });

  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    const name = String(ctx.body.name || '').trim(), url = String(ctx.body.url || '').trim();
    if (!name || !/^https?:\/\//.test(url)) { ctx.setFlash('Name and a full http(s) URL are required.', 'err'); redirect(res, '/r/sources'); return; }
    ctx.kernel.firm.put('source', { name, url, category: ctx.body.category, access: ACCESS.some(([v]) => v === ctx.body.access) ? ctx.body.access : 'open', notes: ctx.body.notes });
    ctx.setFlash(`Added ${name} to the shelf.`);
    redirect(res, '/r/sources');
  });

  app.route('POST', `/r/${ROOM.id}/lookup`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/sources'); return; }
    const query = String(ctx.body.query || '').trim(), result = String(ctx.body.result || '').trim();
    if (!query || !result) { ctx.setFlash('Query and result are both required — this is a diligence record.', 'err'); redirect(res, '/r/sources'); return; }
    ctx.kernel.scope(ctx.matter.id).put('lookup', { source: ctx.body.source, query, result });
    ctx.setFlash('Lookup recorded on the file.');
    redirect(res, '/r/sources');
  });
}

module.exports = { ...ROOM, register };
