'use strict';
// Room 22 — Filing Room. The sign-off gate: nothing transmits, a lawyer signs.
//
// The daily action is whatever is waiting on a person — a packet awaiting a
// signature, or a signed packet whose registry confirmation has not come back —
// so those sit at the top of the page with their one control on them. The
// prepare form comes next; packets already filed fall back to one line each.
const { layout, esc, table, empty, tag, kv, input, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 22, id: 'filing', title: 'Filing Room', phase: 'Argue' };
const PREFLIGHT = [['redacted', 'Personal identifiers redacted'], ['tabs', 'Exhibits tabbed and referenced'], ['limits', 'Page/word limits checked against the Court Book']];
const SERVICE = ['email (consented)', 'courier', 'personal service', 'e-filing portal'];

const CHK = 'display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)';
const SUMMARY = 'cursor:pointer;font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft)';

// Printing yields the record of filings for the file: what was filed, when, on
// whose signature, under which registry stamp. The shared base in
// kernel/html.js drops the chrome, every form and everything marked .no-print
// and re-points the palette; the two things it cannot know are stated here —
// the room heading has no place on a document that goes in the file, and the
// prepare grid must collapse to one column on paper.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

const trim = (v) => String(v ?? '').trim();
// Round-trip an ISO date so '2026-02-31' is refused rather than rolled forward.
const isoOk = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const courtName = (c) => c.court || c.name || c.id;

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Formatted, signed, filed', body: empty('Open a matter above to assemble, sign and record its filings.') })); return; }
    const s = k.scope(ctx.matter.id);
    const clearDrafts = s.list('draft', (d) => d.citeStatus === 'clear' && d.status === 'final');
    const courts = k.firm.list('courtEntry').sort((a, b) => String(courtName(a)).localeCompare(String(courtName(b))));
    const filings = s.list('filing').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // Two states need a human; the third is history.
    const pending = filings.filter((f) => f.status !== 'filed');
    const filed = filings.filter((f) => f.status === 'filed');
    const canSign = ctx.user.role === 'lawyer' || ctx.user.role === 'admin';
    const today = new Date().toISOString().slice(0, 10);
    // The third pre-flight check is "limits checked against the Court Book" —
    // so the Court Book's own limit notes fold out here rather than sending
    // counsel to room 11 and back seconds before a filing.
    const limitBook = courts.filter((c) => trim(c.limitNote));
    const body = `
    ${PRINT}
    <div class="print-only" style="margin-bottom:14px"><h2 class="sec" style="margin-top:0">Record of filings — ${esc(ctx.matter.title)} — as at ${esc(today)}</h2></div>
    ${pending.length ? `<h2 class="sec" style="margin-top:0">Waiting on you ${tag(pending.length + (pending.length === 1 ? ' packet' : ' packets'), 'gate')}</h2>
    ${pending.map((f) => filingCard(ctx, f, canSign, today)).join('')}` : ''}
    <div class="card no-print">
      <h2 class="sec" style="margin-top:0">Prepare a filing</h2>
      ${clearDrafts.length ? `<form method="POST" action="/r/filing/prepare">
        ${select('draftId', 'Draft — final, citations clear', clearDrafts.map((d) => [d.id, d.title + (d.noCitationsFound ? '  [no citations detected]' : '')]))}
        ${clearDrafts.some((d) => d.noCitationsFound) ? '<p class="note">A draft marked <b>[no citations detected]</b> cleared the gate with zero citations found. Confirm extraction did not silently fail before you sign.</p>' : ''}
        <div class="grid2">
          <span>${courts.length ? select('court', 'Court', courts.map((c) => [courtName(c), courtName(c)])) : input('court', 'Court', { required: true })}</span>
          <span>${input('fileNo', 'Court file no.', { placeholder: 'CV-26-000123' })}</span>
        </div>
        ${input('style', 'Style of cause', { required: true, placeholder: 'Harness Holdings v. Fixture Corp.' })}
        <div class="grid2">
          <span>${input('served', 'Parties served', { required: true, placeholder: 'Opposing counsel, by name' })}</span>
          <span>${select('serviceMethod', 'Service method', SERVICE)}</span>
        </div>
        <div style="margin-top:14px">
          ${PREFLIGHT.map(([n, label]) => `<label style="${CHK}"><input type="checkbox" name="${n}" style="width:auto" required>${esc(label)}</label>`).join('')}
        </div>
        ${limitBook.length ? `<details style="margin-top:10px"><summary style="${SUMMARY}">Page &amp; word limits — from the Court Book (11)</summary>${limitBook.map((c) => `<p class="note"><b>${esc(courtName(c))}</b> — ${esc(trim(c.limitNote))}${c.verifiedOn ? ` <span class="num">verified ${esc(String(c.verifiedOn).slice(0, 10))}</span>` : ''}</p>`).join('')}</details>` : ''}
        <button>Assemble packet</button>
      </form>` : empty('No eligible drafts. A filing needs a FINAL draft with citations CLEAR: verify every citation in Citation Check (08), then mark the draft final in Brief Writer (18). The gate is the gate.')}
      <p class="note">This room prepares and records; it does not transmit. Where a portal has no API (CM/ECF, most provincial systems) a human files the packet and the confirmation is recorded back here — Build Sheet Gap 3.</p>
    </div>
    <h2 class="sec">Filed — ${esc(ctx.matter.title)}</h2>
    ${filed.length ? table(['Draft', 'Style of cause', 'Court', 'File no.', 'Filed', 'Registry ref', 'Signed by'], filed.map((f) => [
      esc(f.draftTitle || ''), esc(f.style || ''), esc(f.court || ''),
      f.fileNo ? `<span class="num">${esc(f.fileNo)}</span>` : '<span style="color:var(--ink-faint)">—</span>',
      date(f.confirmedAt), esc(f.registryRef || '') || '<span style="color:var(--ink-faint)">—</span>',
      esc(f.signedBy || ''),
    ])) : empty(pending.length ? 'Nothing filed yet — sign the packet above, file it with the court, then record the registry confirmation here.' : 'Nothing filed yet. Assemble a packet above; it is signed here and filed by hand where no portal API exists.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Formatted, signed by counsel, then filed by hand where no portal API exists', body }));
  });

  app.route('POST', `/r/${ROOM.id}/prepare`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/filing'); return; }
    const s = k.scope(ctx.matter.id);
    const d = s.get('draft', trim(ctx.body.draftId));
    if (!d || d.citeStatus !== 'clear' || d.status !== 'final') { ctx.setFlash('Blocked: only final drafts with clear citations can be filed.', 'err'); redirect(res, '/r/filing'); return; }
    const court = trim(ctx.body.court), style = trim(ctx.body.style), served = trim(ctx.body.served);
    if (!court) { ctx.setFlash('Name the court the packet is going to.', 'err'); redirect(res, '/r/filing'); return; }
    if (!style || !served) { ctx.setFlash('Style of cause and service details are required.', 'err'); redirect(res, '/r/filing'); return; }
    if (!PREFLIGHT.every(([n]) => ctx.body[n])) { ctx.setFlash('Pre-flight incomplete — every check is required.', 'err'); redirect(res, '/r/filing'); return; }
    const serviceMethod = SERVICE.includes(ctx.body.serviceMethod) ? ctx.body.serviceMethod : SERVICE[0];
    s.put('filing', {
      draftId: d.id, draftTitle: d.title, court, style, fileNo: trim(ctx.body.fileNo),
      served, serviceMethod, status: 'awaiting-signature',
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
    const f = s.get('filing', trim(ctx.body.id));
    if (!f || f.status !== 'awaiting-signature') { ctx.setFlash('Nothing awaiting signature.', 'err'); redirect(res, '/r/filing'); return; }
    if (trim(ctx.body.signature) !== ctx.user.name || !ctx.body.confirm) {
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
    const f = s.get('filing', trim(ctx.body.id));
    if (!f || f.status !== 'signed') { ctx.setFlash('Sign before recording a filing confirmation.', 'err'); redirect(res, '/r/filing'); return; }
    const confirmedAt = trim(ctx.body.confirmedAt);
    if (!confirmedAt) { ctx.setFlash('The filing date is required.', 'err'); redirect(res, '/r/filing'); return; }
    if (!isoOk(confirmedAt)) { ctx.setFlash('Filing date must be a real calendar date (YYYY-MM-DD).', 'err'); redirect(res, '/r/filing'); return; }
    s.put('filing', { ...f, status: 'filed', confirmedAt, registryRef: trim(ctx.body.registryRef) });
    k.audit('filing.confirmed', ctx.matter.id + ':' + f.id);
    ctx.setFlash('Filed — confirmation on the record. Calendar any dates the filing triggers in Trial Calendar (21).');
    redirect(res, '/r/filing');
  });
}

// One card per packet still waiting on a person. Its controls carry per-record
// ids (sig-<id>, fdate-<id>, fref-<id>) rather than the shared helper's
// name-derived id: two packets can await signature at once and duplicate DOM
// ids would point every label at the first form on the page.
function filingCard(ctx, f, canSign, today) {
  const rows = kv([
    ['Draft', esc(f.draftTitle || '')],
    ['Style of cause', esc(f.style || '')],
    ['Court', esc(f.court || '') + (f.fileNo ? ` <span class="num">${esc(f.fileNo)}</span>` : '')],
    ['Service', esc([f.served, f.serviceMethod].filter(Boolean).join(' · ')) || '—'],
    ['Provenance', f.signedBy ? esc(`drafted in Chambers · signed by ${f.signedBy} · ${String(f.signedAt).slice(0, 16).replace('T', ' ')}`) : 'unsigned'],
    ['Status', f.status === 'signed' ? tag('signed — file it with the court', 'navy') : tag('awaiting signature', 'gate')],
  ]);
  let action = '';
  if (f.status === 'awaiting-signature') {
    action = canSign ? `
    <form method="POST" action="/r/filing/sign">
      <input type="hidden" name="id" value="${esc(f.id)}">
      <label for="sig-${esc(f.id)}">Sign as lawyer of record — type your name exactly</label>
      <input id="sig-${esc(f.id)}" name="signature" type="text" autocomplete="off" placeholder="${esc(ctx.user.name)}" required>
      <label style="${CHK}"><input type="checkbox" name="confirm" style="width:auto" required>I have read this filing and take responsibility for it.</label>
      <button>Sign</button>
    </form>`
      : '<p class="note">Awaiting the signature of the lawyer of record. A clerk cannot sign a filing.</p>';
  } else if (f.status === 'signed') {
    action = `
    <form method="POST" action="/r/filing/confirm">
      <input type="hidden" name="id" value="${esc(f.id)}">
      <div class="grid2">
        <span><label for="fdate-${esc(f.id)}">Filed on</label><input id="fdate-${esc(f.id)}" name="confirmedAt" type="date" value="${esc(today)}" required></span>
        <span><label for="fref-${esc(f.id)}">Registry stamp / confirmation ref</label><input id="fref-${esc(f.id)}" name="registryRef" type="text"></span>
      </div>
      <button>Record confirmation</button>
    </form>`;
  }
  return `<div class="card">${rows}${action}</div>`;
}

module.exports = { ...ROOM, register };
