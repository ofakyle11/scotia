'use strict';
// Room 27 — Workflow. Mission control: reads every room, owns nothing.
// Now carries the firm-wide limitation diary: every open deadline across
// every visible matter, limitation/prescription dates flagged for the
// second-lawyer tick (the LawPRO dual-diary control), bring-forwards kept
// visibly apart, and an appeal-clock watchdog per matter with a judgment
// on the record but nothing calendared.
const { layout, esc, table, empty, tag, kv, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 27, id: 'desk', title: 'Workflow', phase: 'Always on' };

const isLimitation = (d) => /limitation|prescription/.test(String(d.ruleId || ''));

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const matters = ctx.matters;
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const printMode = ctx.query.get('print') === '1';

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
    let dueSoon = [], overdue = [], diary = [], bfs = [], appealAlarms = [];
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
        const row = { matter: m, d };
        diary.push(row);
        if (d.due < today) overdue.push(row);
        else if (d.due <= soon) dueSoon.push(row);
      }
      for (const b of bs) bfs.push({ matter: m, b });
      // Judgment on the record but no open appeal deadline anywhere on the
      // matter: the appeal clock is running with nothing calendared.
      if (js.length && !ds.some((d) => String(d.ruleId || '').includes('appeal'))) appealAlarms.push(m);
    }
    overdue.sort((a, b) => a.d.due.localeCompare(b.d.due));
    dueSoon.sort((a, b) => a.d.due.localeCompare(b.d.due));
    diary.sort((a, b) => String(a.d.due || '').localeCompare(String(b.d.due || '')));
    bfs.sort((a, b) => String(a.b.due || '').localeCompare(String(b.b.due || '')));

    const inquiries = k.firm.list('inquiry', (i) => i.status === 'screening');
    const bal = k.ledger.balances();
    const trust = bal['trust:bank'] || 0;
    const chain = k.auditTrail().verify();

    const statCard = (n, l, kind) => `<div class="card" style="text-align:center"><div style="font-family:var(--f-display);font-size:30px;font-weight:600;color:${kind === 'bad' ? 'var(--oxide)' : 'var(--ink)'}">${n}</div><div class="note" style="font-family:var(--f-mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase">${esc(l)}</div></div>`;

    // The Limitation column: flag + dual-diary state. Unverified limitation
    // rows carry the second-lawyer tick; verified rows show who and when.
    const limCell = (m, d) => {
      const parts = [];
      if (isLimitation(d)) parts.push(tag('LIMITATION', 'gate'));
      if (d.verifiedBy) {
        parts.push(tag('verified — ' + d.verifiedBy + ' ' + String(d.verifiedAt || '').slice(0, 10), 'ok'));
      } else if (isLimitation(d)) {
        parts.push(`<form method="POST" action="/r/desk/verify" style="margin:6px 0 0"><input type="hidden" name="matterId" value="${esc(m.id)}"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet">Verify date</button></form>`);
      }
      return parts.join(' ');
    };
    const daysCell = (due) => {
      const n = daysLeft(due);
      if (n === null) return '';
      return `<span class="num">${n > 0 ? '+' + n : n}</span>` + (n < 0 ? ' ' + tag('OVERDUE', 'gate') : '');
    };

    const diaryTable = diary.length
      ? table(['Due', 'Days', 'Matter', 'Deadline', 'Authority', 'Limitation'], diary.map((r) => [
          date(r.d.due),
          daysCell(r.d.due),
          esc(r.matter.title),
          esc(r.d.desc),
          `<span class="note">${esc(r.d.rule || '')}</span>`,
          limCell(r.matter, r.d),
        ]))
      : empty('No open deadlines anywhere — the diary is clear.');

    const appealRows = appealAlarms.map((m) => `<div class="card" style="border-color:var(--oxide);padding:12px 16px;margin:12px 0 0">${tag('APPEAL CLOCK UNCALENDARED', 'gate')} <b style="margin:0 6px">${esc(m.title)}</b> <span class="note">judgment sits on the record with no open appeal deadline (Courts of Justice Act, s. 6; r. 61.04) —</span> <a href="/r/calendar?m=${esc(m.id)}">calendar the appeal clock →</a></div>`).join('');

    const bfTable = bfs.length
      ? table(['Note', 'Due', 'Matter'], bfs.map((r) => [
          tag('BF', 'navy') + ' ' + esc(r.b.note),
          date(r.b.due) + (r.b.due < today ? ' ' + tag('OVERDUE', 'gate') : ''),
          esc(r.matter.title),
        ]))
      : empty('No bring-forwards pending.');

    // Print kit: same page, plus @media print rules that strip the chrome —
    // nav, stat tiles, matter list — leaving diary and BFs under the header.
    const printKit = printMode ? `
    <style>
      @media print{
        .side,.topbar,.flash,.screen-only,h1.room,.roomsub,button{display:none !important}
        .shell{display:block;min-height:0}
        .main{padding:0}
        body{background:#fff;color:#111}
        .card{background:#fff;color:#111;border-color:#bbb}
        table.t{background:#fff;border-color:#bbb}
        table.t th{background:#eee;color:#333;border-color:#bbb}
        table.t td{color:#111;border-color:#ddd}
        h2.sec{color:#111;border-color:#bbb}
        .note{color:#444}
        .num{color:#111}
        .tag{color:#111;border-color:#111;background:none}
        a{color:#111}
      }
    </style>
    <div class="card" style="border-color:var(--navy)">
      <h2 class="sec" style="margin-top:0">Diary as at ${esc(today)}</h2>
      <p class="note screen-only">Print view for the Monday meeting — the browser's print dialog outputs only the firm diary and bring-forwards under this header. <a href="/r/desk">Back to the working desk →</a></p>
    </div>` : '';

    const body = `
    ${printKit}
    <h2 class="sec" style="margin-top:0">Firm diary — every open deadline, every visible matter</h2>
    <p class="note screen-only">Limitation and prescription dates (Limitations Act, 2002, s. 4 · art. 2925 CCQ) carry the dual-diary tick: a second lawyer — never the one who calendared it — verifies each date by name and day. <a href="/r/desk?print=1">Print diary →</a></p>
    ${diaryTable}
    ${appealRows}
    <h2 class="sec">Bring-forwards ${tag('BF', 'navy')} — ticklers, never computed deadlines</h2>
    ${bfTable}
    <div class="screen-only">
    <h2 class="sec">The desk</h2>
    <div class="grid3">
      ${statCard(matters.filter((m) => m.status === 'open').length, 'Open matters')}
      ${statCard(overdue.length, 'Overdue deadlines', overdue.length ? 'bad' : '')}
      ${statCard(dueSoon.length, 'Due within 14 days')}
      ${statCard(inquiries.length, 'In screening')}
      ${statCard(money(trust), 'Held in trust')}
      ${statCard(chain.ok ? 'intact' : 'BROKEN', 'Audit chain — ' + chain.entries + ' entries', chain.ok ? '' : 'bad')}
    </div>
    ${overdue.length ? `<h2 class="sec">Overdue — act today</h2>` + table(['Due', 'Matter', 'Deadline', 'Authority'], overdue.map((r) => [date(r.d.due) + ' ' + tag('OVERDUE', 'gate'), esc(r.matter.title), esc(r.d.desc), `<span class="note">${esc(r.d.rule || '')}</span>`])) : ''}
    <h2 class="sec">Next 14 days</h2>
    ${dueSoon.length ? table(['Due', 'Matter', 'Deadline', 'Authority'], dueSoon.map((r) => [date(r.d.due), esc(r.matter.title), esc(r.d.desc), `<span class="note">${esc(r.d.rule || '')}</span>`])) : empty('Nothing due in the next two weeks.')}
    <h2 class="sec">Matters</h2>
    ${matters.length ? table(['Matter', 'Client', 'Jurisdiction', 'Posture', 'Status'], matters.map((m) => [esc(m.title), esc(m.client || ''), esc(m.jurisdiction || ''), esc(m.posture || ''), m.status === 'destroyed' ? tag('destroyed', 'gate') : tag(m.status || 'open', m.status === 'open' ? 'ok' : '')])) : empty('No matters yet — start at the Intake Desk.')}
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
