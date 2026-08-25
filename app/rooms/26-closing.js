'use strict';
// Room 26 — Closing Room. Closed properly, retained on schedule, destroyed for real.
const { layout, esc, table, empty, tag, kv, input, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 26, id: 'closing', title: 'Closing Room', phase: 'Resolve' };
const RETENTION_YEARS = { on: 10, 'ca-fed': 10, 'us-fed': 7, ny: 7 }; // reference schedule
const CHECK = [['account', 'Final account rendered to the client'], ['originals', 'Original documents returned'], ['letter', 'Closing letter sent — appeal window and remaining limitation dates spelled out']];

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Closing the file properly', body: empty('Open a matter to close it.') })); return; }
    const m = ctx.matter;
    if (k.isShredded(m.id)) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Destroyed', body: `<div class="card"><h2 class="sec" style="margin-top:0">Certificate of destruction</h2>${kv([['Matter', esc(m.title)], ['Status', tag('destroyed', 'gate')], ['Effect', 'The matter’s encryption key was destroyed. Its records, documents and history are cryptographically unrecoverable — in the live store, every replica, and every backup.']])}</div>` }));
      return;
    }
    const s = k.scope(m.id);
    const bal = k.ledger.balances(m.id);
    const trust = bal['trust:bank'] || 0;
    const appealRule = k.rules.rulesFor(m.jurisdiction || 'on').find((r) => r.id.includes('appeal'));
    const years = RETENTION_YEARS[m.jurisdiction] || 10;
    const closed = m.status === 'closed';
    const destroyEligible = closed && m.closedAt ? new Date(new Date(m.closedAt).getTime() + years * 365.25 * 86400000).toISOString().slice(0, 10) : null;
    const checks = s.get('closingChecklist', 'closing') || { id: 'closing', done: [] };
    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Closing checklist — ${esc(m.title)}</h2>
        ${kv([
          ['Trust balance', trust > 0.005 ? money_(trust) + ' ' + tag('MUST BE ZERO TO CLOSE', 'gate') : tag('zeroed', 'ok')],
          ['Appeal window', appealRule ? esc(`${appealRule.days} days from ${appealRule.trigger.toLowerCase()} (${appealRule.cite})`) : '—'],
          ['Status', closed ? tag('closed ' + (m.closedAt || '').slice(0, 10), 'ok') : tag(m.status || 'open')],
        ])}
        ${!closed ? `<form method="POST" action="/r/closing/close">
          ${CHECK.map(([n, label]) => `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)"><input type="checkbox" name="${n}" style="width:auto" required>${esc(label)}</label>`).join('')}
          <button>Close the matter</button>
        </form>` : ''}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Retention &amp; destruction</h2>
        ${kv([
          ['Retention (reference)', esc(years + ' years after close — confirm against the current law society schedule')],
          ['Destroy-eligible', destroyEligible ? date(destroyEligible) : 'after closing'],
        ])}
        ${closed && k.isAdmin() ? `
        <form method="POST" action="/r/closing/shred">
          ${input('confirmTitle', 'Type the matter title exactly to destroy it', { required: true, placeholder: m.title })}
          <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)"><input type="checkbox" name="confirm" style="width:auto" required>I understand destruction is cryptographic and irreversible.</label>
          <button class="danger">Destroy — shred the encryption key</button>
        </form>
        <p class="note">Destruction deletes the matter’s key, not just the files: the encrypted history becomes unreadable everywhere at once, including backups. The audit chain keeps the certificate; the content is gone.</p>`
        : `<p class="note">${closed ? 'Only an administrator performs destruction.' : 'Close the matter before destruction becomes available.'}</p>`}
      </div>
    </div>`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Closed on checklist, retained on schedule, destroyed by key — with a certificate', body }));
  });

  app.route('POST', `/r/${ROOM.id}/close`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/closing'); return; }
    if (!CHECK.every(([n]) => ctx.body[n])) { ctx.setFlash('Every closing step is required.', 'err'); redirect(res, '/r/closing'); return; }
    const trust = k.ledger.balances(ctx.matter.id)['trust:bank'] || 0;
    if (trust > 0.005) { ctx.setFlash(`Refused: ${trust.toFixed(2)} still held in trust for this matter. Disburse it in Trust & Books first.`, 'err'); redirect(res, '/r/closing'); return; }
    k.firm.put('matter', { ...k.firm.get('matter', ctx.matter.id), status: 'closed', closedAt: new Date().toISOString() });
    k.audit('matter.closed', ctx.matter.id);
    ctx.setFlash('Matter closed. Retention clock running.');
    redirect(res, '/r/closing');
  });

  app.route('POST', `/r/${ROOM.id}/shred`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/closing'); return; }
    if (!k.isAdmin()) { ctx.setFlash('Only an administrator performs destruction.', 'err'); redirect(res, '/r/closing'); return; }
    const m = k.firm.get('matter', ctx.matter.id);
    if (!m || m.status === 'destroyed') { ctx.setFlash('Nothing to destroy.', 'err'); redirect(res, '/r/closing'); return; }
    if (m.status !== 'closed') { ctx.setFlash('Close the matter before destroying it.', 'err'); redirect(res, '/r/closing'); return; }
    if (String(ctx.body.confirmTitle || '') !== m.title || !ctx.body.confirm) { ctx.setFlash('Destruction refused: the typed title must match exactly.', 'err'); redirect(res, '/r/closing'); return; }
    k.shred(m.id);
    ctx.setFlash(`Destroyed: ${m.title}. The key is gone; the certificate is in the audit chain.`);
    redirect(res, '/r/closing');
  });
}

const money_ = (n) => `<span class="num">$${Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 })}</span>`;

module.exports = { ...ROOM, register };
