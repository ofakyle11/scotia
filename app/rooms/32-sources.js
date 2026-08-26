'use strict';
// Room 32 — Sources. The honest registry of external research services:
// what each is, how it may legally be accessed, and a record on the matter
// file of every lookup performed there — including commercial databases
// that offer no API and must never be scraped.
const { layout, esc, table, empty, tag, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 32, id: 'sources', title: 'Sources', phase: 'Always on' };

// Printing yields the diligence record: the matter's lookup log and the shelf
// it was searched on, under a dated header. The shared base in kernel/html.js
// drops the chrome, every form and everything marked .no-print and re-points
// the palette; only what it cannot know is stated here — the room heading has
// no place on a record produced to a taxing officer or an opponent, and the
// intake grids collapse on paper.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
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

// A stored url is re-rendered as a clickable link and esc() cannot neutralise a
// javascript: URI. POST /add already refuses anything that is not http(s); the
// render guards again so a record from any other era of this file cannot bite.
const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));
const trim = (v) => String(v ?? '').trim();
const accLabel = (v) => (ACCESS.find(([k]) => k === v) || ['', v])[1];
const accKind = (v) => (v === 'api' ? 'ok' : v === 'commercial' ? 'gate' : 'navy');

function ensureSeed(k) {
  if (k.firm.list('source').length === 0) {
    for (const s of SEED) k.firm.put('source', { ...s, seeded: true });
  }
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    ensureSeed(k);
    const sources = k.firm.list('source').sort((a, b) => trim(a.name).localeCompare(trim(b.name)));
    const lookups = ctx.matter ? k.scope(ctx.matter.id).list('lookup').sort((a, b) => trim(b.createdAt).localeCompare(trim(a.createdAt))) : [];

    const recordCard = `
      <div class="card no-print">
        <h2 class="sec" style="margin-top:0">Record a lookup${ctx.matter ? ' — ' + esc(ctx.matter.title) : ''}</h2>
        ${ctx.matter ? `<form method="POST" action="/r/sources/lookup">
          <div class="grid2">
            <span>${select('source', 'Source searched', sources.map((s) => [s.name, s.name]))}</span>
            <span>${input('query', 'What was searched', { required: true, placeholder: 'Royalty rates, tire retreading licences, 2018–2024' })}</span>
          </div>
          ${textarea('result', 'What came back — reference, export name, rate found', { required: true, placeholder: 'Export RS-44812: 11 comparables, median 4.5% of net sales. Saved to the client folder.' })}
          <button>Record on the file</button>
        </form>
        <p class="note">Research done on a subscription service still belongs on the matter file — this is the diligence record, encrypted with the matter, and it answers "what did you actually search?" years later.</p>`
        : empty('Open a matter to record lookups against its file. The shelf below is firm-wide and needs no matter.')}
      </div>`;

    const logSection = ctx.matter
      ? `<h2 class="sec">Lookup record — ${esc(ctx.matter.title)} ${lookups.length ? tag(lookups.length + ' recorded', 'navy') : ''}</h2>`
        + (lookups.length
          ? table(['When', 'Source', 'Query', 'Result'], lookups.map((l) => [
            date(l.createdAt) || '—', esc(l.source || '—'), esc(l.query || ''), esc(l.result || ''),
          ]))
          : empty('No lookup recorded on this matter yet — run the search on the service, then record what you searched and what came back above.'))
      : '';

    const body = `
    ${PRINT}
    <div class="print-only"><h2 class="sec" style="margin-top:0">Research sources &amp; diligence record${ctx.matter ? ' — ' + esc(ctx.matter.title) : ''} — as at ${new Date().toISOString().slice(0, 10)}</h2></div>
    <p class="note no-print" style="margin:0 0 14px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the diligence record — this matter's lookup log and the shelf it was searched on, under a dated header.</p>
    ${recordCard}
    ${logSection}
    <h2 class="sec">The shelf ${tag(sources.length + ' source' + (sources.length === 1 ? '' : 's'), 'navy')}</h2>
    ${table(['Source', 'Category', 'Access', 'Notes'], sources.map((s) => [
      isWeb(s.url) ? `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)} &rarr;</a>` : esc(s.name || ''),
      esc(s.category || '—'),
      tag(accLabel(s.access), accKind(s.access)),
      `<span class="note">${esc(s.notes || '')}</span>`,
    ])) || empty('The shelf is empty — add the first source below.')}
    <p class="note">A commercial database with no API never gets scraped — it gets a link, a credential holder, and lookup records. Integration requests go to the vendor, on paper.</p>
    <details class="no-print" style="margin-top:18px">
      <summary style="cursor:pointer;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-soft)">Add a source to the shelf</summary>
      <div class="card" style="margin-top:12px">
        <form method="POST" action="/r/sources/add">
          <div class="grid2">
            <span>${input('name', 'Name', { required: true })}</span>
            <span>${input('url', 'URL', { required: true, placeholder: 'https://…' })}</span>
          </div>
          <div class="grid2">
            <span>${input('category', 'Category', { placeholder: 'e.g. Expert directories' })}</span>
            <span>${select('access', 'Access model', ACCESS, 'open')}</span>
          </div>
          ${textarea('notes', 'Access & licensing notes', { placeholder: 'API? Subscription? Scraping prohibited? Who holds the credentials?' })}
          <button>Add to shelf</button>
        </form>
      </div>
    </details>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'External research services — access models, credentials, and the diligence record', body }));
  });

  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    const name = trim(ctx.body.name), url = trim(ctx.body.url);
    if (!name || !isWeb(url)) { ctx.setFlash('Name and a full http(s) URL are required.', 'err'); redirect(res, '/r/sources'); return; }
    ctx.kernel.firm.put('source', {
      name,
      url,
      category: trim(ctx.body.category),
      access: ACCESS.some(([v]) => v === ctx.body.access) ? ctx.body.access : 'open',
      notes: trim(ctx.body.notes),
    });
    ctx.setFlash(`Added ${name} to the shelf.`);
    redirect(res, '/r/sources');
  });

  app.route('POST', `/r/${ROOM.id}/lookup`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/sources'); return; }
    const query = trim(ctx.body.query), result = trim(ctx.body.result), source = trim(ctx.body.source);
    if (!query || !result) { ctx.setFlash('Query and result are both required — this is a diligence record.', 'err'); redirect(res, '/r/sources'); return; }
    // A lookup names a source that is actually on the shelf: an unattributable
    // search is not a diligence record.
    if (!k.firm.list('source', (s) => s.name === source).length) {
      ctx.setFlash('Choose a source from the shelf — add it below first if it is not there.', 'err'); redirect(res, '/r/sources'); return;
    }
    k.scope(ctx.matter.id).put('lookup', { source, query, result });
    ctx.setFlash(`Lookup on ${source} recorded on the file.`);
    redirect(res, '/r/sources');
  });
}

module.exports = { ...ROOM, register };
