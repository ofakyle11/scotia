'use strict';
// Room 09 — Jurisdiction Desk. Firm-level reference: which rulebook governs,
// what it says, and which days the courthouse is dark. Works with no matter open.
const { layout, esc, table, empty, tag, kv, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 9, id: 'jurisdiction', title: 'Jurisdiction Desk', phase: 'Build' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const jurs = k.rules.JURISDICTIONS; // [[code, label], ...]
    const label = (code) => { const j = jurs.find(([c]) => c === code); return j ? j[1] : code; };
    const validOr = (code, fallback) => jurs.some(([c]) => c === code) ? code : fallback;
    const a = validOr(ctx.query.get('a'), validOr(ctx.matter ? ctx.matter.jurisdiction : null, 'on'));
    const b = validOr(ctx.query.get('b'), a === 'us-fed' ? 'on' : 'us-fed');

    // Deadlines computed under the matter's prior governing law, flagged stale
    // when the jurisdiction changed here (see the govern handler). A jurisdiction
    // change is exactly when limitation math breaks — surface it as a control.
    let stale = [];
    if (ctx.matter) {
      try { stale = k.scope(ctx.matter.id).list('deadline', (d) => d.stale && d.status !== 'done'); } catch { stale = []; }
    }
    const staleReCard = recomputeCard(k, stale);

    const body = `
    <div class="card" style="border-color:var(--oxide);background:var(--oxide-wash)">
      ${tag('civil law boundary', 'gate')}
      <p style="margin:10px 0 0"><b>Québec is civil law — common-law reasoning does not apply.</b>
      Procedure and prescription there run under the Code of Civil Procedure and the Civil Code of Québec;
      do not carry common-law doctrine, precedent structure, or these deadline rules across that line.
      Québec is deliberately absent from this tranche until its own rulebook is loaded.</p>
      <p class="note">The rules below are a <b>reference tranche</b> — real citations, deliberately small.
      The production rulebook is versioned per court, effective-dated, and grows one court at a time.</p>
    </div>

    ${staleReCard}

    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Governing law — this matter</h2>
        ${ctx.matter ? `
        ${kv([
          ['Matter', esc(ctx.matter.title)],
          ['Client', esc(ctx.matter.client || '—')],
          ['Governing', `${esc(label(ctx.matter.jurisdiction))} <span class="num">${esc(ctx.matter.jurisdiction || '—')}</span>`],
          ['Posture', esc(ctx.matter.posture || '—')],
        ])}
        <form method="POST" action="/r/jurisdiction/govern">
          ${select('jurisdiction', 'Set governing jurisdiction', jurs, ctx.matter.jurisdiction)}
          <button>Set governing law</button>
        </form>
        <p class="note">Changing this changes which rulebook every deadline room computes against. Existing
        computed deadlines are flagged stale for recompute — a jurisdiction change is exactly when limitation
        math breaks. Rebuild each flagged date in <a href="/r/calendar">Trial Calendar</a>.</p>
        ` : empty('Open a matter to set its governing jurisdiction. The reference tables here need no matter.')}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Jurisdictions in the tranche</h2>
        ${table(['Code', 'Jurisdiction', 'Rules', 'Holiday table'], jurs.map(([code, name]) => [
          `<span class="num">${esc(code)}</span>`, esc(name),
          `<span class="num">${k.rules.rulesFor(code).length}</span>`,
          k.rules.HOLIDAYS[code] ? tag('loaded', 'ok') : tag('falls back to us-fed'),
        ]))}
        <p class="note">A jurisdiction without its own holiday table computes roll-forward dates against the
        US federal table — replace before relying on business-day math for that court.</p>
      </div>
    </div>

    <h2 class="sec">Rules — side by side</h2>
    <div class="card">
      <form method="GET" action="/r/jurisdiction" class="grid3" style="align-items:end">
        <span>${select('a', 'Jurisdiction A', jurs, a)}</span>
        <span>${select('b', 'Jurisdiction B', jurs, b)}</span>
        <span><button style="margin-top:0">Compare</button></span>
      </form>
    </div>
    <div class="grid2">
      ${[a, b].map((j) => `<div class="card">
        <h2 class="sec" style="margin-top:0">${esc(label(j))} <span class="num">${esc(j)}</span></h2>
        ${rulesTable(k, j)}
      </div>`).join('')}
    </div>
    <p class="note">Jurisdiction A defaults to the open matter&rsquo;s governing law — pick any pair above to read the full reference tranche for those courts.</p>

    <h2 class="sec">Court holidays — 2026 tranche</h2>
    <div class="grid2">
      ${Object.keys(k.rules.HOLIDAYS).map((code) => `<div class="card">
        <h2 class="sec" style="margin-top:0">${esc(label(code))} <span class="num">${esc(code)}</span></h2>
        ${table(['Date', 'Day'], k.rules.HOLIDAYS[code].map((d) => [date(d), esc(weekday(d))]))}
      </div>`).join('')}
    </div>
    <p class="note">Deadlines landing on a weekend or listed holiday roll forward to the next business day —
    the common default; court-specific variations live in the versioned rulebook, not in code.</p>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Which rulebook governs — and which days the court is dark', body }));
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
    <p style="margin:6px 0 0">The governing law changed, so these already-computed deadlines were rolled against a rulebook that no longer governs${limN ? ' — including a limitation/prescription bar, exactly where a jurisdiction change breaks the math' : ''}. Recompute each from the current rules in <a href="/r/calendar">Trial Calendar</a>, then clear its flag here.</p>
    ${table(['Was due', 'Deadline', 'Kind', 'Computed under', ''], rows)}
    <p class="note">Clearing a flag only acknowledges it — it does not recompute the date. Rebuild the date in <a href="/r/calendar">Trial Calendar</a> (nothing there is typed by hand) and mark the superseded entry done.</p>
  </div>`;
}

function rulesTable(k, jur) {
  const rows = k.rules.rulesFor(jur).map((r) => [
    esc(r.trigger),
    esc(r.desc),
    `<span class="num">${r.days} ${esc(r.method)}</span>`,
    `<span class="num">${esc(r.cite)}</span>`,
  ]);
  return table(['Trigger', 'Deadline', 'Days', 'Citation'], rows) || empty('No rules in the reference tranche for this jurisdiction yet.');
}

function weekday(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? '' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}

module.exports = { ...ROOM, register };
