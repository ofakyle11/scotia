'use strict';
// Room 27 — Workflow. Mission control: reads every room, owns nothing.
const { layout, esc, table, empty, tag, kv, date, money } = require('../kernel/html.js');
const { html } = require('../kernel/http.js');

const ROOM = { num: 27, id: 'desk', title: 'Workflow', phase: 'Always on' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const matters = ctx.matters;
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    let dueSoon = [], overdue = [];
    for (const m of matters) {
      if (k.isShredded(m.id)) continue;
      let ds = [];
      try { ds = k.scope(m.id).list('deadline', (d) => d.status === 'open'); } catch { continue; }
      for (const d of ds) {
        const row = { matter: m, d };
        if (d.due < today) overdue.push(row);
        else if (d.due <= soon) dueSoon.push(row);
      }
    }
    overdue.sort((a, b) => a.d.due.localeCompare(b.d.due));
    dueSoon.sort((a, b) => a.d.due.localeCompare(b.d.due));

    const inquiries = k.firm.list('inquiry', (i) => i.status === 'screening');
    const bal = k.ledger.balances();
    const trust = bal['trust:bank'] || 0;
    const chain = k.auditTrail().verify();

    const statCard = (n, l, kind) => `<div class="card" style="text-align:center"><div style="font-family:var(--f-display);font-size:30px;font-weight:600;color:${kind === 'bad' ? 'var(--oxide)' : 'var(--ink)'}">${n}</div><div class="note" style="font-family:var(--f-mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase">${esc(l)}</div></div>`;

    const body = `
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
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Mission control — the read across every room', body }));
  });
}

module.exports = { ...ROOM, register };
