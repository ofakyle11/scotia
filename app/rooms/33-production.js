'use strict';
// Room 33 — Production. Assemble a production volume from documents coded
// responsive and not-privileged in Document Review (room 13), cut a
// Concordance-style load file (.dat + a matching Opticon .opt image-reference
// stub), carry the privilege log for what was withheld, and log an immutable
// audit record of WHAT was produced, to WHOM, and WHEN. All document content
// lives in this matter's encrypted scope; nothing here reaches firm storage.
const { layout, esc, table, empty, tag, input, date, kv } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 33, id: 'production', title: 'Production', phase: 'Discover' };

// --- room-13 document coding, read the same way it is written there ---
const privOf = (d) => d.privilege || 'none';
const respOf = (d) => (d.responsive === 'yes' ? 'yes' : 'no');
const authorOf = (d) => d.author || d.custodian || '';
const recipientsOf = (d) => d.recipients || d.to || '';
const createdOf = (d) => d.dateCreated || d.date || '';
const privDescOf = (d) => d.privDesc || '';
const PRIV_BASIS = { 'solicitor-client': 'Solicitor-client privilege', litigation: 'Litigation privilege' };
const byBates = (a, b) => String(a.bates || '').localeCompare(String(b.bates || ''));
// A withheld document whose log entry cannot stand on its own: the log must name
// who wrote it and describe the withheld subject, or the claim is untestable by
// the party it is served on. Same test room 13 applies to the same set.
const logGap = (d) => !(String(authorOf(d)).trim() && String(privDescOf(d)).trim());
const logCell = (v) => (String(v || '').trim() ? esc(v) : tag('missing', 'gate'));

// Production-eligible: responsive AND not privileged — a document cannot be
// both produced and on the privilege log.
const isProducible = (d) => respOf(d) === 'yes' && privOf(d) === 'none';
const isWithheld = (d) => privOf(d) !== 'none';

const trim = (v) => String(v ?? '').trim();
const today = () => new Date().toISOString().slice(0, 10);
// A served date is a date on a certificate of service: round-trip it so
// '2026-02-31' is refused rather than silently rolled forward.
const isoOk = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// Printing yields the two documents that are served with a production: the
// schedule of volumes and the privilege log — or, on a volume's own page, that
// volume's frozen index and log. The shared base in kernel/html.js drops the
// chrome, every form and everything marked .no-print and re-points the palette;
// only what it cannot know is stated here — the room heading has no place on a
// document served on an opponent, the working grids collapse on paper, and the
// schedule's last column is nothing but download buttons, so it goes too rather
// than printing as a blank strip beside the volumes.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
.vols th:nth-child(8),.vols td:nth-child(8){display:none}
}</style>`;

function nextVolume(prods) {
  let max = 0;
  for (const p of prods) {
    const m = /^PROD(\d{3,})$/.exec(p.volume || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'PROD' + String(max + 1).padStart(3, '0');
}

// ---- Concordance / Opticon load-file builders ----
// The Concordance "DAT" standard uses ASCII 254 (þ) as the text qualifier and
// ASCII 20 as the field delimiter — the real convention every e-discovery
// platform (Relativity, Concordance) reads. Records end CRLF. Field values are
// stripped of those control characters so user text can never break the frame.
const DAT_Q = '\xFE'; // þ   text qualifier (ASCII 254)
const DAT_D = '\x14'; //     field delimiter (ASCII 20)
const DAT_FIELDS = ['BATESBEGIN', 'BATESEND', 'CUSTODIAN', 'DATE', 'DOCTITLE'];
// Escaped by code point, never as a literal control character in source: a
// qualifier or delimiter that survived into a field value would break the frame.
const datClean = (v) => String(v ?? '').replace(/[\xFE\x14\xAE\r\n]/g, ' ').trim();
function buildDat(docs) {
  const row = (vals) => vals.map((v) => DAT_Q + datClean(v) + DAT_Q).join(DAT_D);
  const lines = [row(DAT_FIELDS)];
  for (const d of docs) {
    const bates = d.bates || '';
    lines.push(row([bates, bates, d.custodian || '', String(createdOf(d) || '').slice(0, 10), d.title || '']));
  }
  return lines.join('\r\n') + '\r\n';
}
// Opticon (.opt) image cross-reference: ImageKey,Volume,FullPath,DocBreak,
// FolderBreak,BoxBreak,PageCount. One page per document record here — an honest
// stub: the image paths point at where the imaging/Bates-endorsement step would
// write each TIFF. Commas are stripped from keys so the CSV frame holds.
const optClean = (v) => String(v ?? '').replace(/[,\r\n]/g, ' ').trim();
function buildOpt(docs, volume) {
  const vol = optClean(volume);
  const lines = docs.map((d) => {
    const key = optClean(d.bates || '');
    return [key, vol, `\\IMAGES\\${vol}\\${key}.TIF`, 'Y', '', '', '1'].join(',');
  });
  return lines.join('\r\n') + '\r\n';
}

function privilegeLog(withheld) {
  return table(['Bates', 'Created', 'Author', 'Recipients', 'Description of subject', 'Basis'], withheld.map((d) => [
    `<span class="num">${esc(d.bates || '—')}</span>`,
    date(createdOf(d)) || '—',
    logCell(authorOf(d)),
    esc(recipientsOf(d) || '—'),
    logCell(privDescOf(d)),
    esc(PRIV_BASIS[privOf(d)] || privOf(d)),
  ])) || empty('Nothing withheld — no privilege claim coded on this set.');
}

const docIndex = (docs) => table(['Bates', 'Title', 'Custodian', 'Date'], docs.map((d) => [
  `<a href="/r/review/doc/${esc(d.id)}"><span class="num">${esc(d.bates || '—')}</span></a>`,
  esc(d.title || '(untitled)'),
  esc(d.custodian || '—'),
  date(createdOf(d)) || '—',
]));

// Load-file buttons for one volume. Both download as plain text over an
// audited POST; the shared print base drops them on paper.
const loadFileForms = (p) => [['dat', 'Load .dat'], ['opt', 'Images .opt']].map(([fmt, label]) =>
  `<form method="POST" action="/r/production/loadfile" style="display:inline;margin-right:6px">
    <input type="hidden" name="id" value="${esc(p.id)}">
    <input type="hidden" name="format" value="${fmt}">
    <button class="quiet" style="margin-top:0">${label}</button></form>`).join('');

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const render = (body, sub) => html(res, layout({ ...ctx, room: ROOM.id },
      { title: ROOM.title, sub: sub || 'Assemble the volume, cut the load file, log what went to whom', body }));
    if (!ctx.matter) { render(empty('Open a matter to assemble its production volumes.')); return; }

    const s = k.scope(ctx.matter.id);
    const docs = s.list('document');
    const producible = docs.filter(isProducible).sort(byBates);
    const withheld = docs.filter(isWithheld).sort(byBates);
    const unlisted = docs.length - producible.length - withheld.length;
    const prods = s.list('production').sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    // One volume open: what was actually served, rebuilt from the ids frozen at
    // assembly. This is the page that prints as the served index and log.
    const vid = trim(ctx.query && ctx.query.get('v'));
    const vol = vid ? prods.find((p) => p.id === vid) : null;
    if (vol) { render(volumeView(ctx, s, vol), `${vol.volume || 'Volume'} — served ${vol.servedDate || '—'} to ${vol.recipient || '—'}`); return; }

    // Nothing coded yet, and nothing produced yet — the empty state that names
    // the prerequisite: code documents in Document Review first.
    if (!producible.length && !prods.length) {
      render(empty('No document is coded responsive and not-privileged yet — code the review set in Document Review (room 13), then return here to cut the first volume.')
        + `<p class="note"><a href="/r/review">Go to Document Review &rarr;</a></p>`);
      return;
    }

    const rangeNote = producible.length
      ? `<span class="num">${esc(producible[0].bates || '—')}</span> – <span class="num">${esc(producible[producible.length - 1].bates || '—')}</span>`
      : '—';
    const gaps = withheld.filter(logGap).length;

    const assembleCard = producible.length ? `
      <div class="card">
        <h2 class="sec" style="margin-top:0">Assemble a volume</h2>
        ${kv([
          ['Producible now', `<span class="num">${producible.length}</span> document${producible.length === 1 ? '' : 's'} ${tag('responsive · not privileged', 'ok')}`],
          ['Bates range', rangeNote],
          ['Withheld', withheld.length ? tag(withheld.length + ' on privilege log', 'gate') : tag('none')],
          ['Not listed', `<span class="num">${unlisted}</span> coded not responsive — produced nowhere, logged nowhere`],
        ])}
        <form method="POST" action="/r/production/assemble">
          <div class="grid2">
            <span>${input('recipient', 'Produce to (opposing party / counsel)', { required: true, placeholder: 'Smith LLP (counsel for the plaintiff)' })}</span>
            <span>${input('servedDate', 'Date served', { type: 'date', value: today() })}</span>
          </div>
          <button>Assemble &amp; serve this volume</button>
        </form>
        ${gaps ? `<p class="note">${tag(gaps + ' privilege log entr' + (gaps === 1 ? 'y' : 'ies') + ' incomplete', 'gate')} An entry with no author or no description of the subject cannot be tested by the party it is served on — fill those in Document Review before this volume goes out.</p>` : ''}
        <p class="note">Assembly freezes the current producible set and the current privilege log into a fixed volume and writes an immutable audit record of what was produced, to whom, and when. Recode in Document Review <em>before</em> assembling; a served volume never changes afterward.</p>
      </div>` : `
      <div class="card">
        <h2 class="sec" style="margin-top:0">Assemble a volume</h2>
        ${empty('Nothing is currently coded responsive and not-privileged — code more in Document Review (room 13) to assemble another volume.')}
      </div>`;

    const prodRows = prods.map((p) => [
      `<a href="/r/production?v=${esc(p.id)}"><b>${esc(p.volume || '—')}</b></a>`,
      `<span class="num">${esc(p.batesStart || '—')}</span> – <span class="num">${esc(p.batesEnd || '—')}</span>`,
      esc(p.recipient || '—'),
      date(p.servedDate) || '—',
      `<span class="num">${(p.documentIds || []).length}</span>`,
      (p.withheldIds || []).length ? tag((p.withheldIds || []).length + ' withheld', 'gate') : '—',
      tag(p.status || 'served', p.status === 'served' ? 'ok' : ''),
      loadFileForms(p),
    ]);

    const body = `
    ${PRINT}
    <div class="print-only" style="margin-bottom:16px">
      <b>${esc(ctx.matter.title)}</b> — schedule of productions and privilege log<br>
      <span class="num">${esc(today())}</span>${ctx.matter.client ? ` · ${esc(ctx.matter.client)}` : ''}
    </div>

    <div class="no-print">
      <div class="grid2">
        ${assembleCard}
        <div class="card">
          <h2 class="sec" style="margin-top:0">Producible set <span class="num">${producible.length}</span></h2>
          ${docIndex(producible) || empty('Nothing coded responsive and not-privileged.')}
          <p class="note">The live set, straight from coding — it moves every time a document is recoded in room 13. What is served is the frozen copy inside a volume.</p>
        </div>
      </div>
    </div>

    <h2 class="sec">Volumes produced ${prods.length ? tag(prods.length + ' served', 'navy') : ''}</h2>
    <div class="vols">${table(['Volume', 'Bates range', 'Produced to', 'Served', 'Docs', 'Privilege log', 'Status', 'Load file'], prodRows)
      || empty('No volume assembled yet — name the recipient on the left and cut the first one.')}</div>
    <p class="note no-print">Open a volume to read exactly what was served in it. The load file is the Concordance <b>.dat</b> (BATESBEGIN/BATESEND/CUSTODIAN/DATE/DOCTITLE, ASCII&nbsp;254 text qualifier, ASCII&nbsp;20 delimiter — the real e-discovery convention) plus a matching Opticon <b>.opt</b> image cross-reference stub. The .opt paths point at where the imaging &amp; Bates-endorsement step writes each TIFF — actual rendering and endorsement wire in here, Build Sheet L06.</p>

    <h2 class="sec">Privilege log ${withheld.length ? tag(withheld.length + ' withheld', 'gate') : ''} ${gaps ? tag(gaps + ' incomplete', 'gate') : ''}</h2>
    ${privilegeLog(withheld)}
    <p class="note">Auto-generated from coding: every document coded solicitor-client or litigation privilege in Document Review, with its author, recipients, created date and a neutral description of the withheld subject. It discloses existence and basis only, never content, and travels with the production so it cannot drift from the set.</p>
    <p class="note no-print"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the schedule of productions and the privilege log; the working cards drop out.</p>
    `;
    render(body);
  });

  // Assemble & serve a volume from the currently-producible set. Validates,
  // then flashes + redirects — never 500 on empty or garbage input.
  app.route('POST', `/r/${ROOM.id}/assemble`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/production'); return; }
    const recipient = trim(ctx.body.recipient);
    if (!recipient) { ctx.setFlash('A production must name who it is produced to.', 'err'); redirect(res, '/r/production'); return; }
    const typed = trim(ctx.body.servedDate).slice(0, 10);
    if (typed && !isoOk(typed)) { ctx.setFlash('Enter the service date as a real calendar date (YYYY-MM-DD).', 'err'); redirect(res, '/r/production'); return; }
    const servedDate = typed || today();

    const s = k.scope(ctx.matter.id);
    const docs = s.list('document');
    const producible = docs.filter(isProducible).sort(byBates);
    if (!producible.length) {
      ctx.setFlash('Nothing to produce — no document is coded responsive and not-privileged. Code the set in Document Review (room 13) first.', 'err');
      redirect(res, '/r/production'); return;
    }
    const withheld = docs.filter(isWithheld).sort(byBates);
    const volume = nextVolume(s.list('production'));
    const rec = s.put('production', {
      volume,
      batesStart: producible[0].bates || '',
      batesEnd: producible[producible.length - 1].bates || '',
      recipient,
      servedDate,
      documentIds: producible.map((d) => d.id),
      withheldIds: withheld.map((d) => d.id),
      status: 'served',
    });
    // Immutable audit record: WHAT (volume + bates range + count), to WHOM, WHEN.
    k.audit('production.served', `${ctx.matter.id}:${volume}:to=${recipient}:on=${servedDate}:${producible.length} docs ${rec.batesStart}-${rec.batesEnd}:withheld=${withheld.length}`);
    const gaps = withheld.filter(logGap).length;
    ctx.setFlash(`${volume} assembled and served to ${recipient} on ${servedDate}: ${producible.length} document${producible.length === 1 ? '' : 's'} (${rec.batesStart}–${rec.batesEnd}), ${withheld.length} withheld on the privilege log.`
      + (gaps ? ` ${gaps} log entr${gaps === 1 ? 'y needs' : 'ies need'} an author and a subject description in room 13.` : ''));
    redirect(res, '/r/production');
  });

  // Download a volume's load file (.dat or .opt). Responds with the text
  // directly; a missing/garbage request flashes + redirects rather than 500.
  app.route('POST', `/r/${ROOM.id}/loadfile`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/production'); return; }
    const id = trim(ctx.body.id);
    const format = ctx.body.format === 'opt' ? 'opt' : 'dat';
    const s = k.scope(ctx.matter.id);
    const rec = id ? s.get('production', id) : null;
    if (!rec) { ctx.setFlash('Select a produced volume to export its load file.', 'err'); redirect(res, '/r/production'); return; }

    const docs = (rec.documentIds || []).map((did) => s.get('document', did)).filter(Boolean).sort(byBates);
    const text = format === 'opt' ? buildOpt(docs, rec.volume) : buildDat(docs);
    k.audit('production.loadfile', `${ctx.matter.id}:${rec.volume}:${format}:${docs.length} docs`);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${rec.volume}.${format}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(text);
  });
}

// One served volume, rebuilt from the ids frozen at assembly — the answer to
// "what exactly did we produce, and what did we hold back?" months later.
function volumeView(ctx, s, p) {
  const ids = p.documentIds || [], wIds = p.withheldIds || [];
  const docs = ids.map((id) => s.get('document', id)).filter(Boolean).sort(byBates);
  const held = wIds.map((id) => s.get('document', id)).filter(Boolean).sort(byBates);
  const goneDocs = ids.length - docs.length, goneHeld = wIds.length - held.length;
  const gone = goneDocs + goneHeld;

  return `
  ${PRINT}
  <div class="print-only" style="margin-bottom:16px">
    <b>${esc(ctx.matter.title)}</b> — ${esc(p.volume || 'volume')}: index of documents produced and privilege log<br>
    <span class="num">${esc(String(p.servedDate || ''))}</span> · produced to ${esc(p.recipient || '—')}${ctx.matter.client ? ` · ${esc(ctx.matter.client)}` : ''}
  </div>
  <p class="note no-print" style="margin:0 0 14px"><a href="/r/production">&larr; All volumes</a></p>

  <div class="card">
    <h2 class="sec" style="margin-top:0">${esc(p.volume || 'Volume')} ${tag(p.status || 'served', p.status === 'served' ? 'ok' : '')}</h2>
    ${kv([
      ['Produced to', esc(p.recipient || '—')],
      ['Served', date(p.servedDate) || '—'],
      ['Documents', `<span class="num">${ids.length}</span>`],
      ['Bates range', `<span class="num">${esc(p.batesStart || '—')}</span> – <span class="num">${esc(p.batesEnd || '—')}</span>`],
      ['Withheld', wIds.length ? tag(wIds.length + ' on privilege log', 'gate') : tag('none')],
    ])}
    <p class="no-print" style="margin-top:12px">${loadFileForms(p)}</p>
    <p class="note">Membership was frozen when this volume was served and does not follow later recoding in Document Review. The rows below are rebuilt from those frozen ids and show each document as it reads today — if a description has since changed, the served copy governs.</p>
  </div>

  <h2 class="sec">Index of documents produced <span class="num">${docs.length}</span></h2>
  ${docIndex(docs) || empty('No document in this volume is still in the review set.')}
  ${goneDocs ? `<p class="note">${tag(goneDocs + ' no longer in the review set', 'gate')} They were produced; the record of what went out is the audit line and the bates range above.</p>` : ''}

  <h2 class="sec">Privilege log as served ${wIds.length ? tag(wIds.length + ' withheld', 'gate') : ''}</h2>
  ${privilegeLog(held)}
  ${goneHeld ? `<p class="note">${tag(goneHeld + ' withheld document no longer in the review set', 'gate')}</p>` : ''}
  <p class="note">Existence and basis only, never content. This is the log that travelled with ${esc(p.volume || 'this volume')}.</p>
  <p class="note no-print"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the index and the log under a header naming the volume, the recipient and the date served${gone ? ' — noting that ' + gone + ' record(s) have since left the review set' : ''}.</p>
  `;
}

module.exports = { ...ROOM, register };
