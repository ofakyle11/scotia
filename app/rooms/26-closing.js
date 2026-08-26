'use strict';
// Room 26 — Closing Room. Closed properly, retained on schedule, destroyed for real.
const { layout, esc, table, empty, tag, kv, input, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 26, id: 'closing', title: 'Closing Room', phase: 'Resolve' };
const RETENTION_YEARS = { on: 10, 'ca-fed': 10, 'us-fed': 7, ny: 7 }; // reference schedule
const CHECK = [['account', 'Final account rendered to the client'], ['originals', 'Original documents returned'], ['letter', 'Closing letter sent — appeal window and remaining limitation dates spelled out']];

// The closing checklist is a RECORD, not a per-submission formality: a fixed-id
// singleton ('closing'), mirroring 20-trialbook's trialChecklist. `done` holds
// CHECK KEYS — not array indices — so CHECK can be reordered without silently
// reinterpreting a saved checklist; renaming a key retires that step's tick.
// Shape: {id:'closing', done:[key…], by:<user name>, at:<ISO>}.
const doneSet = (rec) => new Set((Array.isArray(rec && rec.done) ? rec.done : []).map(String));
const orderedDone = (set) => CHECK.filter(([n]) => set.has(n)).map(([n]) => n);

// Printing this page yields the paper record: the certificate of destruction
// on a shredded matter, or the closing/retention summary on a live one.
// Chrome, forms and buttons drop out.
const PRINT = `<style>.print-only{display:none}@media print{
.print-only{display:block}
.side,.topbar,.flash,.noprint,form,button,h1.room,.roomsub{display:none!important}
.shell{display:block;min-height:0}.main{padding:0}
.grid2,.grid3{display:block}
body{background:#fff;color:#111}
.card{background:#fff;border-color:#bbb;color:#111;break-inside:avoid}
.empty{background:#fff;border-color:#bbb;color:#444}
table.t{background:#fff;border-color:#bbb}
table.t th{background:#eee;color:#333;border-color:#bbb}
table.t td{color:#111;border-color:#ddd}
h1.room,h2.sec{color:#111;border-color:#bbb}
.roomsub,.note,.kv dt{color:#444}.num,.kv dd{color:#111}
.tag{color:#111;border-color:#111;background:none}
a{color:#111}
}</style>`;

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Closing the file properly', body: empty('Open a matter to close it.') })); return; }
    const m = ctx.matter;
    if (k.isShredded(m.id)) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Destroyed', body: `${PRINT}<div class="card"><h2 class="sec" style="margin-top:0">Certificate of destruction</h2>${kv([['Matter', esc(m.title)], ['Status', tag('destroyed', 'gate')], ['Effect', 'The matter’s encryption key was destroyed. Its records, documents and history are cryptographically unrecoverable — in the live store, every replica, and every backup.']])}<p class="note print-only">Printed ${new Date().toISOString().slice(0, 10)}.</p></div>` }));
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
    const done = doneSet(checks);
    const outstanding = CHECK.filter(([n]) => !done.has(n));
    // Rendered outside any form so the tick record prints on the paper closing
    // summary — the print CSS drops every form.
    const checkState = CHECK.map(([n, label]) => `<div style="display:flex;gap:8px;align-items:baseline;padding:3px 0"><span>${done.has(n) ? tag('recorded', 'ok') : tag('outstanding', 'gate')}</span><span style="font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)">${esc(label)}</span></div>`).join('');
    const body = `
    ${PRINT}
    <div class="print-only"><h2 class="sec" style="margin-top:0">Closing &amp; retention — ${esc(m.title)} — as at ${new Date().toISOString().slice(0, 10)}</h2></div>
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Closing checklist — ${esc(m.title)}</h2>
        ${kv([
          ['Trust balance', trust > 0.005 ? money(trust) + ' ' + tag('MUST BE ZERO TO CLOSE', 'gate') : tag('zeroed', 'ok')],
          ['Appeal window', appealRule ? esc(`${appealRule.days} days from ${appealRule.trigger.toLowerCase()} (${appealRule.cite})`) : '—'],
          ['Status', closed ? tag('closed ' + (m.closedAt || '').slice(0, 10), 'ok') : tag(m.status || 'open')],
          ['Closing steps', `${CHECK.length - outstanding.length}/${CHECK.length} recorded ${outstanding.length ? tag(outstanding.length + ' outstanding', 'gate') : tag('complete', 'ok')}`],
        ])}
        ${checkState}
        ${checks.at ? `<p class="note">Recorded by ${esc(checks.by || '—')} on ${esc(String(checks.at).slice(0, 10))}.</p>` : '<p class="note">Nothing recorded yet — tick each step as it is actually done. The ticks are kept on the file.</p>'}
        ${!closed ? `<form method="POST" action="/r/closing/check">
          ${CHECK.map(([n, label]) => `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)"><input type="checkbox" name="${n}" style="width:auto" ${done.has(n) ? 'checked' : ''}>${esc(label)}</label>`).join('')}
          <button class="quiet">Save checklist</button>
        </form>` : ''}
        ${!closed ? (outstanding.length
          ? `<p class="note">Closing is refused until every step above is recorded — ${outstanding.length} outstanding.</p>`
          : `<form method="POST" action="/r/closing/close"><button>Close the matter</button></form>`) : ''}
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
    </div>
    <div class="card noprint">
      <h2 class="sec" style="margin-top:0">Transfer of file</h2>
      ${k.isAdmin() ? `
      <p class="note">On discharge or withdrawal the file belongs to the client (LSO Rules of Professional Conduct r. 3.5, r. 3.7): this bundle goes to successor counsel, or to a client demanding their file. Documents export as metadata only — encrypted document text and files transfer by separate secure handover, never inside a browser download. The audit chain keeps who exported what, and when.</p>
      <form method="POST" action="/r/closing/export">
        ${input('confirmTitle', 'Type the matter title exactly to export it', { required: true, placeholder: m.title })}
        <button>Export transfer bundle (JSON)</button>
      </form>`
      : '<p class="note">Transfer export is an administrator function. On discharge or withdrawal the file belongs to the client — ask an administrator to export the bundle for successor counsel or the client.</p>'}
    </div>`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Closed on checklist, retained on schedule, destroyed by key — with a certificate', body }));
  });

  // Record the ticks. Partial progress is allowed and kept — the checklist is
  // the file's record of what was actually done, with who recorded it and when.
  app.route('POST', `/r/${ROOM.id}/check`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/closing'); return; }
    if (k.isShredded(ctx.matter.id)) { ctx.setFlash('This matter has been destroyed — there is nothing left to record against.', 'err'); redirect(res, '/r/closing'); return; }
    const m = k.firm.get('matter', ctx.matter.id);
    if (!m) { ctx.setFlash('Matter unavailable.', 'err'); redirect(res, '/r/closing'); return; }
    if (m.status === 'closed') { ctx.setFlash('The matter is closed — its checklist is the closing record and no longer editable.', 'err'); redirect(res, '/r/closing'); return; }
    const done = orderedDone(new Set(CHECK.filter(([n]) => ctx.body[n]).map(([n]) => n)));
    k.scope(m.id).put('closingChecklist', { id: 'closing', done, by: ctx.user.name, at: new Date().toISOString() });
    ctx.setFlash(`Closing checklist recorded — ${done.length}/${CHECK.length} steps done.`);
    redirect(res, '/r/closing');
  });

  app.route('POST', `/r/${ROOM.id}/close`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/closing'); return; }
    if (k.isShredded(ctx.matter.id)) { ctx.setFlash('This matter has been destroyed — the certificate of destruction is the record.', 'err'); redirect(res, '/r/closing'); return; }
    const m = k.firm.get('matter', ctx.matter.id);
    if (!m) { ctx.setFlash('Matter unavailable.', 'err'); redirect(res, '/r/closing'); return; }
    if (m.status === 'closed') { ctx.setFlash('Already closed — the retention clock is running from ' + String(m.closedAt || '').slice(0, 10) + '.', 'err'); redirect(res, '/r/closing'); return; }
    // The gate reads the RECORDED checklist, not just this submission. Anything
    // ticked on the close form itself is merged in and persisted first, so the
    // one-shot path still works and no tick is lost on a refusal.
    const s = k.scope(m.id);
    const prev = s.get('closingChecklist', 'closing') || { id: 'closing', done: [] };
    const done = doneSet(prev);
    let added = 0;
    for (const [n] of CHECK) if (ctx.body[n] && !done.has(n)) { done.add(n); added++; }
    if (added) s.put('closingChecklist', { id: 'closing', done: orderedDone(done), by: ctx.user.name, at: new Date().toISOString() });
    const missing = CHECK.filter(([n]) => !done.has(n));
    if (missing.length) { ctx.setFlash(`Refused: ${missing.length} of ${CHECK.length} closing steps are not recorded. Tick them on the closing checklist first.`, 'err'); redirect(res, '/r/closing'); return; }
    const trust = k.ledger.balances(m.id)['trust:bank'] || 0;
    if (trust > 0.005) { ctx.setFlash(`Refused: ${trust.toFixed(2)} still held in trust for this matter. Disburse it in Trust & Books first.`, 'err'); redirect(res, '/r/closing'); return; }
    k.firm.put('matter', { ...m, status: 'closed', closedAt: new Date().toISOString() });
    k.audit('matter.closed', ctx.matter.id);
    ctx.setFlash('Matter closed on a recorded checklist. Retention clock running.');
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

  // Transfer-of-file bundle: everything reads through k.scope(matterId) and the
  // matter-filtered ledger, so no other matter's data can enter the bundle.
  app.route('POST', `/r/${ROOM.id}/export`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/closing'); return; }
    if (!k.isAdmin()) { ctx.setFlash('Transfer export is an administrator function.', 'err'); redirect(res, '/r/closing'); return; }
    const m = k.firm.get('matter', ctx.matter.id);
    if (!m) { ctx.setFlash('Matter unavailable.', 'err'); redirect(res, '/r/closing'); return; }
    if (k.isShredded(m.id)) { ctx.setFlash('Destroyed matters have no exportable record — the certificate of destruction is the record.', 'err'); redirect(res, '/r/closing'); return; }
    if (String(ctx.body.confirmTitle || '') !== m.title) { ctx.setFlash('Export refused: the typed title must match the matter title exactly.', 'err'); redirect(res, '/r/closing'); return; }
    const s = k.scope(m.id);
    const records = {};
    let count = 0;
    for (const type of EXPORT_TYPES) {
      let rows = s.list(type) || [];
      // Documents export as metadata only — decrypted blob content never
      // enters a browser download; that is exactly what the vault prevents.
      if (type === 'document') rows = rows.map((d) => ({ id: d.id, title: d.title, bates: d.bates, custodian: d.custodian, date: d.date, privilege: d.privilege, issues: d.issues, createdAt: d.createdAt }));
      records[type] = rows;
      count += rows.length;
    }
    const ledger = k.ledger.list(m.id);
    count += ledger.length;
    const bundle = {
      exportedAt: new Date().toISOString(),
      exportedBy: ctx.user.name,
      manifest: 'Transfer-of-file bundle. Documents are listed as metadata only (title, bates, custodian, date, privilege, issues); encrypted document text and files transfer by separate secure handover between counsel — they are never bundled into this download.',
      matter: m,
      records,
      ledger,
      balances: k.ledger.balances(m.id),
    };
    k.audit('matter.exported', m.id + ':' + count);
    const today = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="transfer-${m.id}-${today}.json"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(bundle, null, 2));
  });
}

const EXPORT_TYPES = ['fact', 'deadline', 'bf', 'document', 'witness', 'depoTopic', 'digest', 'undertaking', 'adrSession', 'offer', 'judgment', 'enfStep', 'timeEntry', 'draft', 'citation_instance'];


module.exports = { ...ROOM, register };
