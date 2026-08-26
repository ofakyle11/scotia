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
        computed deadlines are not retroactively recomputed — revisit them after a change.</p>
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
    k.firm.put('matter', { ...ctx.matter, jurisdiction: jur });
    ctx.setFlash(`Governing jurisdiction set to ${found[1]} for ${ctx.matter.title}. Deadline rooms now compute against this rulebook.`);
    redirect(res, '/r/jurisdiction');
  });
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
