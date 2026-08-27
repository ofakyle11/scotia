'use strict';
// Room 27 — Workflow. Mission control: reads every room, owns nothing.
// Carries the firm-wide limitation diary: every open deadline across every
// visible matter, limitation/prescription dates flagged for the second-lawyer
// tick (the LawPRO dual-diary control), bring-forwards kept visibly apart, and
// an appeal-clock watchdog per matter with a judgment on the record but
// nothing calendared.
const { layout, esc, table, empty, tag, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 27, id: 'desk', title: 'Workflow', phase: 'Always on' };

// Robust deadline classification. `ruleId` is a kernel/rules.js id and ONLY
// 21-calendar ever writes one; 01-intake, 12-discovery, 15-experts and 23-adr
// write the citation string (`rule`) and `desc` alone. Keying either control
// below off `ruleId` made 01-intake's limitation bar — the one date whose miss
// is a claim — invisible to the LIMITATION flag and to the dual-diary tick.
// So match on ANY of: the rules.js id, the citation string or description that
// every writer sets, or the rules.js record standing behind the id (its
// category, else its own desc/cite). Never on `ruleId` alone.
//
// The text test is case-INSENSITIVE by necessity, not by taste: 01-intake
// stores `desc: 'Limitation period expires'` and cites such as 'Limitations
// Act, 2002, s. 4' / 'CPLR 214(5)', so a case-sensitive /limitation/ (what
// 09-jurisdiction falls back to) matches none of them and the bar stays dark.
function classify(k, d, rx, category) {
  if (!d) return false;
  const ruleId = String(d.ruleId || '');
  if (rx.test(ruleId)) return true;                                            // (a) rules.js id
  if (rx.test(String(d.rule || '') + ' ' + String(d.desc || ''))) return true;  // (b) citation string / desc
  if (!ruleId) return false;
  let r = null;                                                                // (c) the rule behind the id
  try { r = k && k.rules && typeof k.rules.rule === 'function' ? k.rules.rule(ruleId) : null; } catch { r = null; }
  if (!r) return false;
  if (category && r.category === category) return true;
  return rx.test(String(r.desc || '') + ' ' + String(r.cite || ''));
}

const APPEAL_RX = /appeal/i;
// One definition, shared: kernel/rules.js now owns it, so this room, the
// calendar's close route and 09-jurisdiction all decide "is this a limitation
// bar" the same way. This room's version was the correct one and is what moved.
const isLimitation = (k, d) => k.rules.isLimitationDeadline(d);
// The appeal clock counts as calendared however it was written — by 21-calendar
// with a ruleId, or by hand with only 'Notice of appeal due' on it.
const isAppealClock = (k, d) => classify(k, d, APPEAL_RX, null);

// A deadline whose governing law moved after the date was computed.
// 09-jurisdiction stamps `stale` on every open deadline when the matter's
// jurisdiction changes — but that flag lived ONLY on that room's own recompute
// card. This page is where a lawyer actually reads deadlines, and it showed a
// superseded date with no mark on it and offered it the dual-diary tick, so the
// stale date came out of the control rendered `verified` in green: certified
// under a rulebook that no longer governs, and looking better for it.
const isStale = (d) => !!(d && d.stale);

// Printing this page yields the Monday-meeting paper: the dated firm diary,
// the appeal alarms and the bring-forwards. The shared base in kernel/html.js
// drops the chrome, every form and everything marked .no-print and re-points
// the palette; only what it cannot know is stated here — the room heading has
// no place on a diary handed round a meeting table.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

const mlink = (room, id) => `/r/${room}?m=${encodeURIComponent(String(id))}`;

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const matters = ctx.matters;
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    // Signed days-remaining; null when the due date is not a real date.
    const daysLeft = (due) => {
      const s = String(due || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const t = Date.parse(s + 'T00:00:00Z');
      if (Number.isNaN(t)) return null;
      return Math.round((t - Date.parse(today + 'T00:00:00Z')) / 86400000);
    };

    // One walk across every visible matter; a shredded or otherwise
    // unreachable scope is skipped, never fatal.
    let dueSoon = 0, overdue = 0, diary = [], bfs = [], appealAlarms = [];
    for (const m of matters) {
      if (k.isShredded(m.id)) continue;
      let ds = [], bs = [], js = [];
      try {
        const s = k.scope(m.id);
        ds = s.list('deadline', (d) => d.status === 'open');
        bs = s.list('bf', (b) => b.status === 'open');
        js = s.list('judgment');
      } catch { continue; }
      for (const d of ds) {
        diary.push({ matter: m, d });
        if (d.due < today) overdue++;
        else if (d.due <= soon) dueSoon++;
      }
      for (const b of bs) bfs.push({ matter: m, b });
      // Judgment on the record but no open appeal deadline anywhere on the
      // matter: the appeal clock is running with nothing calendared.
      if (js.length && !ds.some((d) => isAppealClock(k, d))) appealAlarms.push(m);
    }
    // One diary, sorted by date: the overdue rows lead it, so there is no
    // second table restating them.
    diary.sort((a, b) => String(a.d.due || '').localeCompare(String(b.d.due || '')));
    bfs.sort((a, b) => String(a.b.due || '').localeCompare(String(b.b.due || '')));

    // Limitation bars still awaiting the second tick — the dual-diary control
    // as a number, so a missed one is visible without reading the table.
    const limUnticked = diary.filter((r) => isLimitation(k, r.d) && !r.d.verifiedBy).length;
    // Deadlines computed under a rulebook that no longer governs the matter.
    const staleN = diary.filter((r) => isStale(r.d)).length;

    const inquiries = k.firm.list('inquiry', (i) => i.status === 'screening');
    const trust = k.ledger.balances()['trust:bank'] || 0;
    const chain = k.auditTrail().verify();

    const statCard = (n, l, kind, href) => `<div class="card" style="text-align:center;margin:0">`
      + `<div style="font-family:var(--f-display);font-size:30px;font-weight:600;color:${kind === 'bad' ? 'var(--oxide)' : 'var(--ink)'}">${href ? `<a href="${href}" style="color:inherit">${n}</a>` : n}</div>`
      + `<div class="note" style="font-family:var(--f-mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;margin-top:2px">${esc(l)}</div></div>`;

    // The Limitation column: flag + dual-diary state. Unverified limitation
    // rows carry the second-lawyer tick; verified rows show who and when.
    const limCell = (m, d) => {
      const parts = [];
      const lim = isLimitation(k, d);
      if (lim) parts.push(tag('LIMITATION', 'gate'));
      if (d.verifiedBy) {
        parts.push(tag('verified — ' + d.verifiedBy + ' ' + String(d.verifiedAt || '').slice(0, 10), 'ok'));
      } else if (isStale(d)) {
        // No tick on a superseded date. Recompute first — certifying it is the
        // failure mode, not the fix, and the button is withheld as well as the
        // POST refused because a control that only hides is not a control.
        parts.push(`<a class="quiet" href="/r/jurisdiction?m=${encodeURIComponent(String(m.id))}">Recompute before verifying &rarr;</a>`);
      } else if (lim) {
        parts.push(`<form method="POST" action="/r/desk/verify" style="margin:6px 0 0"><input type="hidden" name="matterId" value="${esc(m.id)}"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet">Verify date</button></form>`);
      }
      return parts.join(' ');
    };
    // A limitation date landing on a weekend or court holiday is NOT rolled
    // forward — kernel/rules.js deliberately refuses to push a statutory expiry
    // to a later, false-safe day. 21-calendar computes and stores that on the
    // record, then announced it in one flash to whoever happened to be at the
    // keyboard; the stored flag was read back on no page at all. The warning has
    // to travel with the date every time anyone looks at it.
    const dueCell = (d) => date(d.due)
      + (d.nonBusinessDay ? '<br>' + tag('weekend/holiday — not rolled forward', 'gate') : '');
    // Which rulebook computed this date; a stale flag means: not the one that
    // governs the matter now.
    const authorityCell = (d) => `<span class="note">${esc(d.rule || '')}</span>`
      + (isStale(d) ? '<br>' + tag('STALE — ' + (d.staleReason || 'governing law changed'), 'gate') : '');
    const daysCell = (due) => {
      const n = daysLeft(due);
      if (n === null) return '';
      const chip = n < 0 ? tag('OVERDUE', 'gate') : n <= 14 ? tag('soon', 'navy') : '';
      return `<div style="text-align:right"><span class="num">${n > 0 ? '+' + n : n}</span>${chip ? '<br>' + chip : ''}</div>`;
    };

    const diaryTable = diary.length
      ? table(['Due', 'Days', 'Matter', 'Deadline', 'Authority', 'Limitation'], diary.map((r) => [
          dueCell(r.d),
          daysCell(r.d.due),
          `<a href="${mlink('calendar', r.matter.id)}">${esc(r.matter.title)}</a>`,
          esc(r.d.desc),
          authorityCell(r.d),
          limCell(r.matter, r.d),
        ]))
      : empty('No open deadline on any visible matter — compute the next one from its rule in Trial Calendar (21).');

    const appealRows = appealAlarms.map((m) => `<div class="card" style="border-color:var(--oxide);padding:12px 16px;margin:12px 0 0">${tag('APPEAL CLOCK UNCALENDARED', 'gate')} <b style="margin:0 6px">${esc(m.title)}</b> <span class="note">judgment sits on the record with no open appeal deadline (Courts of Justice Act, s. 6; r. 61.04) —</span> <a href="${mlink('calendar', m.id)}">calendar the appeal clock &rarr;</a></div>`).join('');

    const bfTable = bfs.length
      ? table(['Note', 'Due', 'Matter'], bfs.map((r) => [
          tag('BF', 'navy') + ' ' + esc(r.b.note),
          date(r.b.due) + (r.b.due < today ? ' ' + tag('OVERDUE', 'gate') : ''),
          `<a href="${mlink('calendar', r.matter.id)}">${esc(r.matter.title)}</a>`,
        ]))
      : empty('No bring-forward pending — set a tickler in Trial Calendar (21) for anything you want back on the desk.');

    const body = `
    ${PRINT}
    <div class="print-only"><h2 class="sec" style="margin-top:0">Firm diary — as at ${esc(today)}</h2></div>
    <div class="no-print" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:12px;margin-bottom:8px">
      ${statCard(overdue, 'Overdue', overdue ? 'bad' : '')}
      ${statCard(dueSoon, 'Due in 14 days')}
      ${statCard(limUnticked, 'Limitation bars unticked', limUnticked ? 'bad' : '')}
      ${statCard(staleN, 'Stale — rulebook changed', staleN ? 'bad' : '', '/r/jurisdiction')}
      ${statCard(matters.filter((m) => m.status === 'open').length, 'Open matters')}
      ${statCard(inquiries.length, 'In screening', '', '/r/intake')}
      ${statCard(money(trust), 'Held in trust', '', '/r/books')}
      ${statCard(chain.ok ? 'intact' : 'BROKEN', 'Audit chain — ' + chain.entries + ' entries', chain.ok ? '' : 'bad')}
    </div>
    ${appealRows}
    <h2 class="sec">Firm diary — every open deadline, every visible matter</h2>
    <p class="note no-print" style="margin:0 0 12px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Overdue dates lead the table. Limitation and prescription dates (Limitations Act, 2002, s. 4 · art. 2925 CCQ) carry the dual-diary tick: a second lawyer — never the one who calendared it — verifies each date by name and day. Printing yields the dated diary, the appeal alarms and the bring-forwards.</p>
    ${diaryTable}
    <h2 class="sec">Bring-forwards ${tag('BF', 'navy')} — ticklers, never computed deadlines</h2>
    ${bfTable}
    <div class="no-print">
      <h2 class="sec">Matters</h2>
      ${matters.length
        ? table(['Matter', 'Client', 'Jurisdiction', 'Posture', 'Status'], matters.map((m) => [
            `<a href="${mlink('client', m.id)}">${esc(m.title)}</a>`,
            esc(m.client || ''),
            esc(m.jurisdiction || ''),
            esc(m.posture || ''),
            m.status === 'destroyed' ? tag('destroyed', 'gate') : tag(m.status || 'open', m.status === 'open' ? 'ok' : ''),
          ]))
        : empty('No matters yet — open the first inquiry at the Intake Desk (01).')}
      ${ctx.user.role === 'admin' ? '<p class="note"><a href="/admin">Firm administration →</a></p>' : ''}
    </div>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Mission control — the read across every room', body }));
  });

  // The dual-diary tick. A limitation date goes out of the danger column
  // only when a second person — never the lawyer who calendared it — puts
  // their name and the date on it. That is the control LawPRO expects of a
  // two-lawyer shop, and it is enforced here, not merely displayed.
  app.route('POST', `/r/${ROOM.id}/verify`, (req, res, ctx) => {
    const k = ctx.kernel;
    const matterId = String(ctx.body.matterId || '').trim();
    const id = String(ctx.body.id || '').trim();
    if (!matterId || !id) { ctx.setFlash('Nothing to verify — the form arrived without its deadline.', 'err'); redirect(res, '/r/desk'); return; }
    let d = null;
    try { d = k.scope(matterId).get('deadline', id); } catch { d = null; }
    if (!d) { ctx.setFlash('That deadline is not available to verify.', 'err'); redirect(res, '/r/desk'); return; }
    if (d.verifiedBy) { ctx.setFlash('Already verified — ' + d.verifiedBy + ' ticked it on ' + String(d.verifiedAt || '').slice(0, 10) + '.', 'err'); redirect(res, '/r/desk'); return; }
    // The whole point of the second tick is that it certifies the date. A date
    // computed under superseded law is the one thing that must never collect it:
    // once ticked it renders `verified` and reads as the most trustworthy row on
    // the diary. Recompute in Trial Calendar, then clear the flag.
    if (d.stale) {
      ctx.setFlash('Dual diary refused: this date was computed under a rulebook that no longer governs this matter'
        + (d.staleReason ? ' (' + d.staleReason + ')' : '')
        + '. Rebuild it in Trial Calendar (21) and clear the flag in Governing Law (09) before it can be verified.', 'err');
      redirect(res, '/r/desk'); return;
    }
    if (ctx.user.id === d.createdBy) {
      ctx.setFlash('Dual diary refused: the verifying lawyer must be a different person than the one who calendared the date. Ask your colleague for the second tick.', 'err');
      redirect(res, '/r/desk'); return;
    }
    k.scope(matterId).put('deadline', { ...d, verifiedBy: ctx.user.name, verifiedById: ctx.user.id, verifiedAt: new Date().toISOString() });
    k.audit('diary.verified', matterId + ':' + id);
    ctx.setFlash('Second diary tick recorded — ' + (d.desc || 'deadline') + ' verified under your name.');
    redirect(res, '/r/desk');
  });
}

module.exports = { ...ROOM, register };
