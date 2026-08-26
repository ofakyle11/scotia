'use strict';
// Room 33 — Production. Assemble a production volume from documents coded
// responsive and not-privileged in Document Review (room 13), cut a
// Concordance-style load file (.dat + a matching Opticon .opt image-reference
// stub), carry the privilege log for what was withheld, and log an immutable
// audit record of WHAT was produced, to WHOM, and WHEN. All document content
// lives in this matter's encrypted scope; nothing here reaches firm storage.
const { layout, esc, table, empty, tag, input, select, date, kv } = require('../kernel/html.js');
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

// Production-eligible: responsive AND not privileged — a document cannot be
// both produced and on the privilege log.
const isProducible = (d) => respOf(d) === 'yes' && privOf(d) === 'none';
const isWithheld = (d) => privOf(d) !== 'none';

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
const DAT_Q = '\xFE'; // þ  text qualifier (ASCII 254)
const DAT_D = ''; //    field delimiter (ASCII 20)
const DAT_FIELDS = ['BATESBEGIN', 'BATESEND', 'CUSTODIAN', 'DATE', 'DOCTITLE'];
const datClean = (v) => String(v ?? '').replace(/[þ®\r\n]/g, ' ').trim();
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
  return table(['Bates', 'Created', 'Author', 'Recipients', 'Description', 'Basis'], withheld.map((d) => [
    `<span class="num">${esc(d.bates || '—')}</span>`,
    date(createdOf(d)) || '—',
    esc(authorOf(d) || '—'),
    esc(recipientsOf(d) || '—'),
    esc(privDescOf(d) || '—'),
    esc(PRIV_BASIS[privOf(d)] || privOf(d)),
  ])) || empty('Nothing withheld — no privilege claims coded in this set.');
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const render = (body) => html(res, layout({ ...ctx, room: ROOM.id },
      { title: ROOM.title, sub: 'Assemble the volume, cut the load file, log what went to whom', body }));
    if (!ctx.matter) { render(empty('Open a matter to assemble its production volumes.')); return; }

    const s = k.scope(ctx.matter.id);
    const docs = s.list('document');
    const producible = docs.filter(isProducible).sort(byBates);
    const withheld = docs.filter(isWithheld).sort(byBates);
    const prods = s.list('production').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Nothing coded yet, and nothing produced yet — the empty state that names
    // the prerequisite: code documents in Document Review first.
    if (!producible.length && !prods.length) {
      render(empty('No documents are coded responsive and not-privileged yet — code the review set in Document Review (room 13) before you can assemble a production.')
        + `<p class="note"><a href="/r/review">Go to Document Review</a> to code documents, then return here to cut the volume.</p>`);
      return;
    }

    const rangeNote = producible.length
      ? `<span class="num">${esc(producible[0].bates || '—')}</span> – <span class="num">${esc(producible[producible.length - 1].bates || '—')}</span>`
      : '—';

    const assembleCard = producible.length ? `
      <div class="card">
        <h2 class="sec" style="margin-top:0">Assemble a volume</h2>
        ${kv([
          ['Producible now', `<span class="num">${producible.length}</span> document${producible.length === 1 ? '' : 's'} ${tag('responsive · not privileged', 'ok')}`],
          ['Bates range', rangeNote],
          ['Withheld', withheld.length ? tag(withheld.length + ' on privilege log', 'gate') : tag('none')],
        ])}
        <form method="POST" action="/r/production/assemble">
          ${input('recipient', 'Produce to (opposing party / counsel)', { required: true, placeholder: 'Smith LLP (counsel for the plaintiff)' })}
          ${input('servedDate', 'Date served', { type: 'date' })}
          <button>Assemble &amp; serve this volume</button>
        </form>
        <p class="note">Assembly snapshots the current producible set and the current privilege log into a fixed volume, then writes an immutable audit record of what was produced, to whom, and when. Recode in Document Review before assembling; a served volume does not change afterward.</p>
      </div>` : `
      <div class="card">
        <h2 class="sec" style="margin-top:0">Assemble a volume</h2>
        ${empty('No documents are currently coded responsive and not-privileged — code more in Document Review (room 13) to assemble another volume.')}
      </div>`;

    const prodRows = prods.map((p) => {
      const dl = (fmt, label) => `<form method="POST" action="/r/production/loadfile" style="display:inline;margin-right:6px">
        <input type="hidden" name="id" value="${esc(p.id)}">
        <input type="hidden" name="format" value="${fmt}">
        <button class="quiet">${label}</button></form>`;
      return [
        `<b>${esc(p.volume || '—')}</b>`,
        `<span class="num">${esc(p.batesStart || '—')}</span> – <span class="num">${esc(p.batesEnd || '—')}</span>`,
        esc(p.recipient || '—'),
        date(p.servedDate) || '—',
        `<span class="num">${(p.documentIds || []).length}</span>`,
        (p.withheldIds || []).length ? tag((p.withheldIds || []).length + ' withheld', 'gate') : '—',
        tag(p.status || 'served', p.status === 'served' ? 'ok' : ''),
        dl('dat', 'Load .dat') + dl('opt', 'Images .opt'),
      ];
    });

    const body = `
    <div class="grid2">
      ${assembleCard}
      <div class="card">
        <h2 class="sec" style="margin-top:0">Producible set — <span class="num">${producible.length}</span></h2>
        ${table(['Bates', 'Title', 'Custodian', 'Date'], producible.map((d) => [
          `<span class="num">${esc(d.bates || '—')}</span>`,
          esc(d.title || '(untitled)'),
          esc(d.custodian || '—'),
          date(createdOf(d)) || '—',
        ])) || empty('Nothing coded responsive and not-privileged.')}
      </div>
    </div>

    <h2 class="sec">Volumes produced ${prods.length ? tag(prods.length + ' served', 'navy') : ''}</h2>
    ${table(['Volume', 'Bates range', 'Produced to', 'Served', 'Docs', 'Privilege log', 'Status', 'Load file'], prodRows)
      || empty('No volumes assembled yet — cut the first one on the left.')}
    <p class="note">The load file is the Concordance <b>.dat</b> (BATESBEGIN/BATESEND/CUSTODIAN/DATE/DOCTITLE, ASCII&nbsp;254 text qualifier, ASCII&nbsp;20 delimiter — the real e-discovery convention) plus a matching Opticon <b>.opt</b> image cross-reference stub. The .opt paths point at where the imaging &amp; Bates-endorsement step writes each TIFF — actual rendering/endorsement wires in here, Build Sheet L06. Both download as plain text over an audited POST.</p>

    <h2 class="sec">Privilege log ${withheld.length ? tag(withheld.length + ' withheld', 'gate') : ''}</h2>
    ${privilegeLog(withheld)}
    <p class="note">Auto-generated from coding: every document coded solicitor-client or litigation privilege in Document Review, with its author, recipients, created date and a neutral description of the withheld subject. It discloses existence and basis only, never content, and travels with the production so it cannot drift from the set.</p>
    `;
    render(body);
  });

  // Assemble & serve a volume from the currently-producible set. Validates,
  // then flashes + redirects — never 500 on empty or garbage input.
  app.route('POST', `/r/${ROOM.id}/assemble`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/production'); return; }
    const recipient = String(ctx.body.recipient || '').trim();
    if (!recipient) { ctx.setFlash('A production must name who it is produced to.', 'err'); redirect(res, '/r/production'); return; }
    const servedDate = String(ctx.body.servedDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    const s = k.scope(ctx.matter.id);
    const docs = s.list('document');
    const producible = docs.filter(isProducible).sort(byBates);
    if (!producible.length) {
      ctx.setFlash('Nothing to produce — no documents are coded responsive and not-privileged. Code the set in Document Review (room 13) first.', 'err');
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
    ctx.setFlash(`${volume} assembled and served to ${recipient} on ${servedDate}: ${producible.length} document${producible.length === 1 ? '' : 's'} (${rec.batesStart}–${rec.batesEnd}), ${withheld.length} withheld on the privilege log.`);
    redirect(res, '/r/production');
  });

  // Download a volume's load file (.dat or .opt). Responds with the text
  // directly; a missing/garbage request flashes + redirects rather than 500.
  app.route('POST', `/r/${ROOM.id}/loadfile`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/production'); return; }
    const id = String(ctx.body.id || '').trim();
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

module.exports = { ...ROOM, register };
