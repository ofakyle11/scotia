'use strict';
// Room 11 — Court Book. Firm-level verified court directory: where you file,
// how they want it, and when somebody last checked. No matter required.
//
// The daily use is a lookup seconds before a filing, so the directory reads
// one line per court and the four standing notes fold away behind a summary.
// The daily *action* is reverification, so anything past the staleness clock
// is lifted into a queue at the top of the page with the stamp button on it.
const { layout, esc, table, empty, tag, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 11, id: 'courtbook', title: 'Court Book', phase: 'Build' };

const STALE_DAYS = 180;
const LEVELS = ['Trial', 'Appellate', 'Final appellate', 'Tribunal', 'Other'];
const SUMMARY = 'cursor:pointer;font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft)';

// Printing this page yields the directory as a reference sheet. The shared base
// in kernel/html.js drops the chrome and the forms; the one thing it cannot know
// is that the standing notes fold away on screen — a printed entry with its fees,
// limits and standing orders collapsed behind a <details> is worse than useless,
// so each row also carries the same notes unfolded in a .print-only block.
const PRINT = `<style>@media print{
.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

// Reference tranche — seeded once, clearly labeled. Verified-on is set to the
// seed date; the staleness clock starts running immediately, on purpose.
const SEEDS = [
  {
    court: 'Ontario Superior Court of Justice (Toronto region)',
    jurisdiction: 'Ontario, Canada', level: 'Trial',
    portal: 'Civil Claims Online Portal (civil e-filing)',
    feeNote: 'Court fees set by regulation under the Administration of Justice Act — confirm the current schedule on ontario.ca before filing.',
    limitNote: 'Facta are generally capped at 30 pages absent leave — confirm the current Rules of Civil Procedure text and the Toronto region practice direction.',
    formatNote: 'Follow the Consolidated Practice Direction for the Toronto region; documents filed electronically must be text-searchable.',
    standingNote: 'Check the current Toronto region notices and practice directions on the SCJ website before every filing.',
    reference: true,
  },
  {
    court: 'Federal Court of Canada',
    jurisdiction: 'Canada (federal)', level: 'Trial',
    portal: 'Federal Court E-Filing portal',
    feeNote: 'Tariff A of the Federal Courts Rules governs filing fees — confirm current amounts on the Court’s website.',
    limitNote: 'Memoranda of fact and law are capped at 30 pages (Federal Courts Rules, r 70(4)) — confirm the current rule text.',
    formatNote: 'Federal Courts Rules formatting requirements apply; see the Court’s Consolidated General Practice Guidelines for e-filing specifics.',
    standingNote: 'Review the Court’s current notices to the parties and the profession before filing.',
    reference: true,
  },
  {
    court: 'U.S. District Court, Southern District of New York',
    jurisdiction: 'United States (federal) — New York', level: 'Trial',
    portal: 'CM/ECF (NextGen)',
    feeNote: 'Civil filing fee per the Judicial Conference fee schedule — confirm the current amount on nysd.uscourts.gov.',
    limitNote: 'Memoranda of law: 25 pages — verify per judge; individual practices control and often differ.',
    formatNote: 'S.D.N.Y. ECF Rules & Instructions govern electronic filing; local civil rules set typeface and spacing requirements.',
    standingNote: 'Check the assigned judge’s Individual Rules & Practices before every filing — they override the general local-rule defaults.',
    reference: true,
  },
];

function seedOnce(k) {
  if (k.firm.get('setting', 'courtbook-seed')) return;
  const today = new Date().toISOString().slice(0, 10);
  for (const s of SEEDS) k.firm.put('courtEntry', { ...s, verifiedOn: today });
  k.firm.put('setting', { id: 'courtbook-seed', done: true });
  k.audit('courtbook.seeded', 'reference-tranche');
}

function staleDays(verifiedOn) {
  const t = Date.parse(verifiedOn || '');
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

const isStale = (e) => { const d = staleDays(e.verifiedOn); return d === null || d > STALE_DAYS; };

function verifiedCell(e) {
  const d = staleDays(e.verifiedOn);
  if (d === null) return tag('never verified', 'gate');
  return `${date(e.verifiedOn)} ${d > STALE_DAYS ? tag(`stale — ${d}d`, 'gate') : tag(`${d}d ago`, 'ok')}`;
}

const verifyBtn = (e, label) => `<form method="POST" action="/r/courtbook/verify" style="display:inline"><input type="hidden" name="id" value="${esc(e.id)}"><button class="quiet">${esc(label)}</button></form>`;

// Four standing notes per court would make every row six lines tall, so they
// fold behind a summary that names which of them are actually on file.
function notesCell(e) {
  const rows = [
    ['Fees', e.feeNote], ['Limits', e.limitNote], ['Format', e.formatNote], ['Standing orders', e.standingNote],
  ].filter(([, v]) => v);
  if (!rows.length) return '<span class="note">none recorded</span>';
  const notes = rows.map(([k2, v]) => `<div class="note" style="margin-top:4px"><b>${esc(k2)}:</b> ${esc(v)}</div>`).join('');
  return `<details class="no-print"><summary style="${SUMMARY}">${rows.map(([k2]) => esc(k2.toLowerCase())).join(' · ')}</summary>${notes}</details>`
    + `<div class="print-only">${notes}</div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    seedOnce(k);
    const entries = k.firm.list('courtEntry').sort((a, b) => (a.court || '').localeCompare(b.court || ''));
    const stale = entries.filter(isStale);
    const editId = ctx.query.get('edit');
    const editing = editId ? k.firm.get('courtEntry', editId) : null;
    const e = editing || {};

    // Only the block that renders first loses its top margin.
    const top = (isFirst) => (isFirst && !editing ? ' style="margin-top:0"' : '');

    // The action, first and only when there is one: courts whose fees, limits
    // or standing orders nobody has reconfirmed inside the staleness window.
    const staleCard = stale.length ? `
    <h2 class="sec"${top(true)}>Reverify before you file ${tag(`${stale.length} of ${entries.length} stale`, 'gate')}</h2>
    <div class="card">
      ${table(['Court', 'Last verified', ''], stale.map((c) => [
        `<b>${esc(c.court)}</b><div class="note">${esc(c.jurisdiction || '—')}</div>`,
        verifiedCell(c),
        `<span class="no-print">${verifyBtn(c, 'Verified today')} <a href="/r/courtbook?edit=${esc(c.id)}" style="margin-left:8px">edit</a></span>`,
      ]))}
      <p class="note">Reconfirm against the court’s own site, then stamp it here. The stamp is the record that a human checked — nothing in this book is fetched.</p>
    </div>` : '';

    const dirSection = `
    <h2 class="sec"${top(!stale.length)}>Directory — <span class="num">${entries.length}</span> ${!stale.length && entries.length ? tag('all verified inside ' + STALE_DAYS + 'd', 'ok') : ''}</h2>
    ${entries.length ? table(['Court', 'Jurisdiction', 'Level', 'E-filing', 'Notes', 'Verified', ''], entries.map((c) => [
      `<b>${esc(c.court)}</b>${c.reference ? ' ' + tag('reference', 'navy') : ''}`,
      esc(c.jurisdiction || '—'),
      esc(c.level || '—'),
      esc(c.portal || '—'),
      notesCell(c),
      verifiedCell(c),
      `<span class="no-print">${verifyBtn(c, 'Verified today')}
       <a href="/r/courtbook?edit=${esc(c.id)}" style="margin-left:6px">edit</a>
       <form method="POST" action="/r/courtbook/del" style="display:inline;margin-left:6px"><input type="hidden" name="id" value="${esc(c.id)}"><button class="quiet danger" style="margin-top:0;padding:4px 10px">Delete</button></form></span>`,
    ])) : empty('No courts in the book yet — add the court you file in below: its name, its portal, and the date you last confirmed its rules.')}
    <p class="note">Fees, page limits and standing orders drift constantly, so every entry carries the date a human last confirmed it against the court’s own site and anything older than ${STALE_DAYS} days is flagged until reverified. <span class="tag navy">reference</span> marks the seeded tranche — starting points, not gospel. Nothing here is fetched: Juriscraper / RECAP integration wires in per the Build Sheet.</p>`;

    const formCard = `
    <div class="card no-print">
      <h2 class="sec" style="margin-top:0">${editing ? `Edit — ${esc(editing.court)}` : 'Add a court'}</h2>
      <form method="POST" action="/r/courtbook/save">
        ${editing ? `<input type="hidden" name="id" value="${esc(editing.id)}">` : ''}
        <div class="grid2">
          <span>${input('court', 'Court name', { required: true, value: e.court, placeholder: 'Ontario Court of Appeal' })}</span>
          <span>${input('verifiedOn', 'Verified on', { type: 'date', required: true, value: e.verifiedOn || new Date().toISOString().slice(0, 10) })}</span>
          <span>${input('jurisdiction', 'Jurisdiction', { value: e.jurisdiction, placeholder: 'Ontario, Canada' })}</span>
          <span>${select('level', 'Level', LEVELS, e.level || 'Trial')}</span>
          <span>${input('feeNote', 'Filing fee note', { value: e.feeNote })}</span>
          <span>${input('limitNote', 'Page / word limit note', { value: e.limitNote })}</span>
        </div>
        ${input('portal', 'E-filing portal', { value: e.portal, placeholder: 'CM/ECF, Civil Claims Online…' })}
        <div class="grid2">
          <span>${textarea('formatNote', 'Formatting notes', { value: e.formatNote })}</span>
          <span>${textarea('standingNote', 'Standing-order notes', { value: e.standingNote })}</span>
        </div>
        <button>${editing ? 'Save changes' : 'Add to court book'}</button>
        ${editing ? '<a class="btn" href="/r/courtbook" style="margin-left:8px">Cancel</a>' : ''}
      </form>
      <p class="note">Verified-on is the date a human last confirmed this entry against the court’s own site — it is required, because an entry nobody has checked is worse than no entry. Editing an entry by hand drops its <span class="tag navy">reference</span> label.</p>
    </div>`;

    const body = PRINT + (editing ? formCard + staleCard + dirSection : staleCard + dirSection + formCard);
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Firm-wide verified court directory — fees, limits, portals, standing orders', body }));
  });

  app.route('POST', `/r/${ROOM.id}/save`, (req, res, ctx) => {
    const k = ctx.kernel;
    const court = String(ctx.body.court || '').trim();
    const verifiedOn = String(ctx.body.verifiedOn || '').trim();
    if (!court) { ctx.setFlash('Court name is required.', 'err'); redirect(res, '/r/courtbook'); return; }
    // Round-trip the date: an ISO shape that Date accepts but that is not a real
    // calendar day ('2026-02-31') must be refused, never rolled forward.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn) || new Date(verifiedOn + 'T00:00:00Z').toISOString().slice(0, 10) !== verifiedOn) {
      ctx.setFlash('Verified-on must be a real date — an unverified entry is worse than no entry.', 'err');
      redirect(res, '/r/courtbook'); return;
    }
    const existing = ctx.body.id ? k.firm.get('courtEntry', ctx.body.id) : null;
    k.firm.put('courtEntry', {
      ...(existing || {}),
      ...(existing ? { id: existing.id } : {}),
      court,
      jurisdiction: String(ctx.body.jurisdiction || '').trim(),
      level: LEVELS.includes(ctx.body.level) ? ctx.body.level : 'Other',
      portal: String(ctx.body.portal || '').trim(),
      feeNote: String(ctx.body.feeNote || '').trim(),
      limitNote: String(ctx.body.limitNote || '').trim(),
      formatNote: String(ctx.body.formatNote || '').trim(),
      standingNote: String(ctx.body.standingNote || '').trim(),
      verifiedOn,
      reference: existing ? false : undefined, // any hand edit ends the "reference" label
    });
    ctx.setFlash(`${existing ? 'Updated' : 'Added'} ${court} — verified as of ${verifiedOn}.`);
    redirect(res, '/r/courtbook');
  });

  app.route('POST', `/r/${ROOM.id}/verify`, (req, res, ctx) => {
    const k = ctx.kernel;
    const c = ctx.body.id ? k.firm.get('courtEntry', ctx.body.id) : null;
    if (!c) { ctx.setFlash('Entry not found.', 'err'); redirect(res, '/r/courtbook'); return; }
    const today = new Date().toISOString().slice(0, 10);
    k.firm.put('courtEntry', { ...c, verifiedOn: today });
    k.audit('courtbook.verified', c.id);
    ctx.setFlash(`${c.court} marked verified as of ${today}.`);
    redirect(res, '/r/courtbook');
  });

  app.route('POST', `/r/${ROOM.id}/del`, (req, res, ctx) => {
    const k = ctx.kernel;
    const c = ctx.body.id ? k.firm.get('courtEntry', ctx.body.id) : null;
    if (!c) { ctx.setFlash('Entry not found.', 'err'); redirect(res, '/r/courtbook'); return; }
    k.firm.del('courtEntry', c.id);
    ctx.setFlash(`Removed ${c.court} from the court book.`);
    redirect(res, '/r/courtbook');
  });
}

module.exports = { ...ROOM, register };
