'use strict';
// Room 22 — Filing Room. The sign-off gate: nothing transmits, a lawyer signs.
const { layout, esc, table, empty, tag, kv, input, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 22, id: 'filing', title: 'Filing Room', phase: 'Argue' };
const PREFLIGHT = [['redacted', 'Personal identifiers redacted'], ['tabs', 'Exhibits tabbed and referenced'], ['limits', 'Page/word limits checked against the Court Book']];

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Formatted, signed, filed', body: empty('Open a matter to prepare filings.') })); return; }
    const s = k.scope(ctx.matter.id);
    const clearDrafts = s.list('draft', (d) => d.citeStatus === 'clear' && d.status === 'final');
    const courts = k.firm.list('courtEntry');
    const filings = s.list('filing').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const body = `
    <div class="card">
      <h2 class="sec" style="margin-top:0">Prepare a filing</h2>
      ${clearDrafts.length ? `<form method="POST" action="/r/filing/prepare">
        ${select('draftId', 'Draft (final + citations clear only)', clearDrafts.map((d) => [d.id, d.title]))}
        ${courts.length ? select('court', 'Court', courts.map((c) => [c.name || c.court || c.id, c.name || c.court || c.id])) : input('court', 'Court', { required: true })}
        ${input('style', 'Style of cause', { required: true, placeholder: 'Harness Holdings v. Fixture Corp.' })}
        ${input('fileNo', 'Court file no.', { placeholder: 'CV-26-000123' })}
        ${input('served', 'Parties served (certificate of service)', { required: true })}
        ${select('serviceMethod', 'Service method', ['email (consented)', 'courier', 'personal service', 'e-filing portal'])}
        ${PREFLIGHT.map(([n, label]) => `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)"><input type="checkbox" name="${n}" style="width:auto" required>${esc(label)}</label>`).join('')}
        <button>Assemble packet</button>
      </form>` : empty('No eligible drafts. A filing needs a draft that is FINAL with its citations CLEAR — the gate is the gate.')}
      <p class="note">This room prepares and records; it does not transmit. Where a portal has no API (CM/ECF, most provincial systems) a human files the packet and the confirmation is recorded back here — Build Sheet Gap 3.</p>
    </div>
    <h2 class="sec">Filings — ${esc(ctx.matter.title)}</h2>
    ${filings.length ? filings.map((f) => filingCard(ctx, f)).join('') : empty('No filings prepared yet.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Formatted, signed by counsel, then filed by hand where no portal API exists', body }));
  });

  app.route('POST', `/r/${ROOM.id}/prepare`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/filing'); return; }
    const s = k.scope(ctx.matter.id);
    const d = s.get('draft', String(ctx.body.draftId || ''));
    if (!d || d.citeStatus !== 'clear' || d.status !== 'final') { ctx.setFlash('Blocked: only final drafts with clear citations can be filed.', 'err'); redirect(res, '/r/filing'); return; }
    if (!ctx.body.style || !ctx.body.served) { ctx.setFlash('Style of cause and service details are required.', 'err'); redirect(res, '/r/filing'); return; }
    if (!PREFLIGHT.every(([n]) => ctx.body[n])) { ctx.setFlash('Pre-flight incomplete — every check is required.', 'err'); redirect(res, '/r/filing'); return; }
    s.put('filing', {
      draftId: d.id, draftTitle: d.title, court: ctx.body.court, style: ctx.body.style, fileNo: ctx.body.fileNo,
      served: ctx.body.served, serviceMethod: ctx.body.serviceMethod, status: 'awaiting-signature',
    });
    k.audit('filing.assembled', ctx.matter.id + ':' + d.id);
    ctx.setFlash('Packet assembled — awaiting the signature of the lawyer of record.');
    redirect(res, '/r/filing');
  });

  app.route('POST', `/r/${ROOM.id}/sign`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/filing'); return; }
    if (ctx.user.role !== 'lawyer' && ctx.user.role !== 'admin') { ctx.setFlash('Only a lawyer signs a filing.', 'err'); redirect(res, '/r/filing'); return; }
    const s = k.scope(ctx.matter.id);
    const f = s.get('filing', String(ctx.body.id || ''));
    if (!f || f.status !== 'awaiting-signature') { ctx.setFlash('Nothing awaiting signature.', 'err'); redirect(res, '/r/filing'); return; }
    if (String(ctx.body.signature || '').trim() !== ctx.user.name || !ctx.body.confirm) {
      ctx.setFlash(`Signature refused: type your name exactly as provisioned (“${ctx.user.name}”) and confirm.`, 'err');
      redirect(res, '/r/filing'); return;
    }
    s.put('filing', { ...f, status: 'signed', signedBy: ctx.user.name, signedAt: new Date().toISOString() });
    k.audit('filing.signed', ctx.matter.id + ':' + f.id + ':' + ctx.user.id);
    ctx.setFlash('Signed. Provenance sealed to the audit chain — the packet is ready to file with the court.');
    redirect(res, '/r/filing');
  });

  app.route('POST', `/r/${ROOM.id}/confirm`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/filing'); return; }
    const s = k.scope(ctx.matter.id);
    const f = s.get('filing', String(ctx.body.id || ''));
    if (!f || f.status !== 'signed') { ctx.setFlash('Sign before recording a filing confirmation.', 'err'); redirect(res, '/r/filing'); return; }
    if (!ctx.body.confirmedAt) { ctx.setFlash('The filing date is required.', 'err'); redirect(res, '/r/filing'); return; }
    s.put('filing', { ...f, status: 'filed', confirmedAt: ctx.body.confirmedAt, registryRef: ctx.body.registryRef });
    k.audit('filing.confirmed', ctx.matter.id + ':' + f.id);
    ctx.setFlash('Filed — confirmation on the record. Calendar any dates the filing triggers in room 21.');
    redirect(res, '/r/filing');
  });
}

function filingCard(ctx, f) {
  const rows = kv([
    ['Draft', esc(f.draftTitle)], ['Court', esc(f.court || '')], ['Style of cause', esc(f.style || '')],
    ['File no.', esc(f.fileNo || '—')], ['Service', esc((f.served || '') + ' · ' + (f.serviceMethod || ''))],
    ['Provenance', f.signedBy ? esc(`drafted in Chambers · signed by ${f.signedBy} · ${String(f.signedAt).slice(0, 16).replace('T', ' ')}`) : 'unsigned'],
    ['Status', f.status === 'filed' ? tag('filed ' + (f.confirmedAt || ''), 'ok') : f.status === 'signed' ? tag('signed — ready to file', 'navy') : tag('awaiting signature', 'gate')],
  ]);
  let action = '';
  if (f.status === 'awaiting-signature') action = `
    <form method="POST" action="/r/filing/sign">
      <input type="hidden" name="id" value="${esc(f.id)}">
      ${input('signature', 'Type your full name to sign as lawyer of record', { required: true })}
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)"><input type="checkbox" name="confirm" style="width:auto" required>I have read this filing and take responsibility for it.</label>
      <button>Sign</button>
    </form>`;
  else if (f.status === 'signed') action = `
    <form method="POST" action="/r/filing/confirm">
      <input type="hidden" name="id" value="${esc(f.id)}">
      ${input('confirmedAt', 'Filed on', { type: 'date', required: true })}
      ${input('registryRef', 'Registry stamp / confirmation ref')}
      <button>Record confirmation</button>
    </form>`;
  return `<div class="card">${rows}${action}</div>`;
}

module.exports = { ...ROOM, register };
