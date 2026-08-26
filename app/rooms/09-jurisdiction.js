'use strict';
// Room 09 — Jurisdiction Desk. Firm-level reference: which rulebook governs,
// what it says, and which days the courthouse is dark. Works with no matter open.
//
// Page order is the working order: the recompute alarm (a jurisdiction change
// has already broken somebody's limitation math) comes before the reference
// tables, and one compare control drives both the rulebook and the dark-day
// calendar for the pair being read.
const { layout, esc, table, empty, tag, kv, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 9, id: 'jurisdiction', title: 'Jurisdiction Desk', phase: 'Build' };
const SUB = 'Which rulebook governs — and which days the court is dark';

// Civil law is a hard boundary, not a footnote: common-law doctrine, precedent
// structure and the deadline rules below do not cross it. Rendered beside the
// tranche table, where the qc row actually appears.
const QC_BOUNDARY = `<div style="border:1px solid var(--oxide);background:var(--oxide-wash);padding:12px 14px;margin-top:14px">
  ${tag('civil law boundary', 'gate')}
  <p style="margin:8px 0 0"><b>Québec is civil law.</b> Procedure and prescription there run under the Code of Civil Procedure and the Civil Code of Québec — do not carry common-law doctrine, precedent structure or the rules below across that line.</p>
  <p class="note">Only extinctive prescription (art. 2925 CCQ) is loaded in this tranche; the rest of the Québec rulebook is not. Compute nothing else against qc here.</p>
</div>`;

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const jurs = k.rules.JURISDICTIONS; // [[code, label], ...]
    const label = (code) => { const j = jurs.find(([c]) => c === code); return j ? j[1] : code; };
    const validOr = (code, fallback) => jurs.some(([c]) => c === code) ? code : fallback;
    const here = ctx.matter ? ctx.matter.jurisdiction : null;
    const a = validOr(ctx.query.get('a'), validOr(here, 'on'));
    const b = validOr(ctx.query.get('b'), a === 'us-fed' ? 'on' : 'us-fed');

    // Deadlines computed under the matter's prior governing law, flagged stale
    // when the jurisdiction changed here (see the govern handler). A jurisdiction
    // change is exactly when limitation math breaks — surface it as a control,
    // above everything else on the page.
    let stale = [];
    if (ctx.matter) {
      try { stale = k.scope(ctx.matter.id).list('deadline', (d) => d.stale && d.status !== 'done'); } catch { stale = []; }
    }

    const tranche = table(['Code', 'Court', 'Rules', 'Holidays'], jurs.map(([code, name]) => [
      `<span class="num">${esc(code)}</span>` + (code === here ? ' ' + tag('this matter', 'navy') : ''),
      esc(name),
      `<span class="num" style="display:block;text-align:right">${k.rules.rulesFor(code).length}</span>`,
      k.rules.HOLIDAYS[code]
        ? `<span class="num" style="display:block;text-align:right">${k.rules.holidaysFor(code, new Date().getUTCFullYear()).length}</span>`
        : tag('falls back to us-fed'),
    ]));

    const body = `
    ${recomputeCard(k, stale)}

    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Governing law — this matter</h2>
        ${ctx.matter ? `
        ${kv([
          ['Matter', esc(ctx.matter.title)],
          ['Client', esc(ctx.matter.client || '—')],
          ['Governing', `${esc(label(here))} <span class="num">${esc(here || '—')}</span>`],
          ['Posture', esc(ctx.matter.posture || '—')],
        ])}
        <form method="POST" action="/r/jurisdiction/govern">
          ${select('jurisdiction', 'Set governing jurisdiction', jurs, here)}
          <button>Set governing law</button>
        </form>
        <p class="note">This picks the rulebook every deadline room computes against. Change it and every open computed deadline is flagged stale here for rebuild in <a href="/r/calendar">Trial Calendar</a> — a jurisdiction change is exactly where limitation math breaks.</p>
        ` : empty('Open a matter to set its governing jurisdiction. The reference tables below need no matter.')}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Courts in the tranche</h2>
        ${tranche}
        <p class="note">Reference tranche — real citations, deliberately small; the production rulebook is versioned per court and effective-dated. A court with no holiday table of its own computes business days against the US federal table.</p>
        ${QC_BOUNDARY}
      </div>
    </div>

    <h2 class="sec">Side by side — rules and dark days</h2>
    <div class="card">
      <form method="GET" action="/r/jurisdiction" class="grid3" style="align-items:end">
        <span>${select('a', 'Court A', jurs, a)}</span>
        <span>${select('b', 'Court B', jurs, b)}</span>
        <span><button style="margin-top:0">Compare</button></span>
      </form>
      <p class="note">A defaults to the open matter&rsquo;s governing law. Changing the pair swaps both the rulebook and the holiday table below it.</p>
    </div>
    <div class="grid2">
      ${[a, b].map((j) => `<div class="card">
        <h2 class="sec" style="margin-top:0">${esc(label(j))} <span class="num">${esc(j)}</span></h2>
        ${rulesTable(k, j)}
        <h2 class="sec">Court dark days — 2026</h2>
        ${holidayTable(k, j)}
      </div>`).join('')}
    </div>
    <p class="note"><b>Procedural</b> deadlines landing on a weekend or a listed holiday roll forward to the next business day.
    A <b>limitation bar</b> does not roll — its statutory expiry stands on the day it falls, and counsel is warned rather than
    handed a later, false-safe date. Court-specific variations live in the versioned rulebook, not in code.</p>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });

  app.route('POST', `/r/${ROOM.id}/govern`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first — governing law attaches to a matter.', 'err'); redirect(res, '/r/jurisdiction'); return; }
    const jur = String(ctx.body.jurisdiction || '');
    const found = k.rules.JURISDICTIONS.find(([code]) => code === jur);
    if (!found) { ctx.setFlash('Pick a jurisdiction from the tranche.', 'err'); redirect(res, '/r/jurisdiction'); return; }
    const prev = ctx.matter.jurisdiction || null;
    k.firm.put('matter', { ...ctx.matter, jurisdiction: jur });
    if (prev === jur) {
      ctx.setFlash(`Governing jurisdiction is already ${found[1]} for ${ctx.matter.title} — no change.`);
      redirect(res, '/r/jurisdiction'); return;
    }
    // The rulebook changed under every deadline already computed for this matter.
    // Flag each open computed deadline stale so it is recomputed against the new
    // rules — limitation/prescription bars especially, where the roll never applied.
    let staleN = 0, limN = 0;
    try {
      const s = k.scope(ctx.matter.id);
      const at = new Date().toISOString();
      for (const d of s.list('deadline', (x) => x.status !== 'done')) {
        const r = d.ruleId ? k.rules.rule(d.ruleId) : null;
        const lim = r ? k.rules.isLimitation(r) : /limitation|prescription/.test(String(d.rule || '') + ' ' + String(d.desc || ''));
        s.put('deadline', { ...d, stale: true, staleReason: `governing law changed ${prev || '—'} → ${jur}`, staleFrom: prev, staleTo: jur, staleAt: at, staleLimitation: lim });
        staleN++; if (lim) limN++;
      }
    } catch { /* shredded/unavailable scope — the jurisdiction change is still recorded */ }
    k.audit('jurisdiction.change', ctx.matter.id + ':' + (prev || '—') + '->' + jur + ':stale=' + staleN + ':lim=' + limN);
    ctx.setFlash(`Governing jurisdiction set to ${found[1]} for ${ctx.matter.title}.` + (staleN
      ? ` ${staleN} computed deadline${staleN > 1 ? 's' : ''}${limN ? ` (${limN} limitation bar${limN > 1 ? 's' : ''})` : ''} flagged for recompute — rebuild them in Trial Calendar.`
      : ' Deadline rooms now compute against this rulebook.'));
    redirect(res, '/r/jurisdiction');
  });

  // Acknowledge a stale flag once counsel has recomputed the date in Trial
  // Calendar. Clears the flag only — it never edits or invents a deadline date.
  app.route('POST', `/r/${ROOM.id}/recompute-clear`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/jurisdiction'); return; }
    const id = String(ctx.body.id || '').trim();
    if (!id) { ctx.setFlash('Nothing to clear.', 'err'); redirect(res, '/r/jurisdiction'); return; }
    let d = null;
    try { d = k.scope(ctx.matter.id).get('deadline', id); } catch { d = null; }
    if (!d) { ctx.setFlash('That deadline is no longer on this matter.', 'err'); redirect(res, '/r/jurisdiction'); return; }
    k.scope(ctx.matter.id).put('deadline', { ...d, stale: false, staleClearedAt: new Date().toISOString() });
    k.audit('jurisdiction.recompute.cleared', ctx.matter.id + ':' + id);
    ctx.setFlash('Recompute flag cleared — confirm the rebuilt date is calendared in Trial Calendar.');
    redirect(res, '/r/jurisdiction');
  });
}

// A stale computed deadline is a limitation/prescription bar when its source
// rule carries category 'limitation'; fall back to the recorded flag or the
// citation/description text for records minted before the flag existed.
function isLimitationDeadline(k, d) {
  if (d.staleLimitation != null) return !!d.staleLimitation;
  const r = d.ruleId ? k.rules.rule(d.ruleId) : null;
  if (r) return k.rules.isLimitation(r);
  return /limitation|prescription/.test(String(d.rule || '') + ' ' + String(d.desc || ''));
}

// The recompute list: every open deadline computed under the matter's prior
// governing law, flagged when the jurisdiction changed here. Empty -> no card.
function recomputeCard(k, stale) {
  if (!stale.length) return '';
  const ordered = stale.slice().sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const limN = ordered.filter((d) => isLimitationDeadline(k, d)).length;
  const rows = ordered.map((d) => {
    const lim = isLimitationDeadline(k, d);
    return [
      date(d.due),
      esc(d.desc || '—'),
      lim ? tag('LIMITATION BAR', 'gate') : tag('procedural'),
      `<span class="note">${esc(d.rule || d.ruleId || '—')}${d.staleFrom ? ` &middot; was ${esc(d.staleFrom)}` : ''}</span>`,
      `<form method="POST" action="/r/jurisdiction/recompute-clear" style="margin:0"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet">Clear flag</button></form>`,
    ];
  });
  return `<div class="card" style="border-color:var(--oxide);background:var(--oxide-wash)">
    <h2 class="sec" style="margin-top:0">Recompute needed ${tag(ordered.length + ' stale', 'gate')}${limN ? ' ' + tag(limN + ' limitation', 'gate') : ''}</h2>
    <p style="margin:6px 0 0">The governing law changed, so these already-computed deadlines were rolled against a rulebook that no longer governs${limN ? ' — including a limitation/prescription bar, exactly where a jurisdiction change breaks the math' : ''}. Rebuild each from the current rules in <a href="/r/calendar">Trial Calendar</a>, mark the superseded entry done, then clear its flag here.</p>
    ${table(['Was due', 'Deadline', 'Kind', 'Computed under', ''], rows)}
    <p class="note">Clearing a flag acknowledges it — it does not recompute the date.</p>
  </div>`;
}

// Kind first-class: a limitation bar and a filing deadline are not the same
// animal and only one of them rolls off a dark day.
function rulesTable(k, jur) {
  const rows = k.rules.rulesFor(jur).map((r) => [
    esc(r.trigger),
    esc(r.desc),
    k.rules.isLimitation(r) ? tag('limitation bar', 'gate') : tag('procedural'),
    `<span class="num" style="display:block;text-align:right">${Number(r.days) || 0} ${esc(r.method === 'business' ? 'bus.' : 'cal.')}</span>`,
    `<span class="num">${esc(r.cite)}</span>`,
  ]);
  return table(['Trigger', 'Deadline', 'Kind', 'Days', 'Citation'], rows)
    || empty('No rules loaded for this court — compute nothing against it here; work from the court’s own rulebook.');
}

function holidayTable(k, jur) {
  if (!k.rules.HOLIDAYS[jur]) return `<p class="note">No holiday rules for this court — business-day math falls back to the US federal set. Load its own rules before relying on a rolled date.</p>`;
  // Computed for this year and next, so the diary a lawyer plans against in
  // December already shows January — the old page froze on one reference year.
  const y = new Date().getUTCFullYear();
  const hs = [...k.rules.holidaysFor(jur, y), ...k.rules.holidaysFor(jur, y + 1)];
  return table(['Date', 'Day'], hs.map((d) => [date(d), esc(weekday(d))]));
}

function weekday(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? '' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}

module.exports = { ...ROOM, register };
