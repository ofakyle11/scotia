'use strict';
// Room 35 — Affidavit of Documents. Ontario r. 30.03 / Form 30A: the sworn
// disclosure list a party serves in discovery (the Canadian analogue to a US
// privilege log + document list). It is ASSEMBLED, not re-typed: Schedules A
// and B are derived directly from Document Review (room 13) coding, so the
// sworn affidavit can never drift from the coded set. Schedule C — documents
// that were, but are no longer, in the party's possession — has no analogue in
// review coding, so it is captured here. Nothing here modifies room 13; the
// review set is read through the encrypted per-matter scope only.
const { layout, esc, table, empty, tag, input, textarea, select, date, kv } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 35, id: 'affidavit', title: 'Affidavit of Documents', phase: 'Discover' };

// ---- room 13 document record shape (read-only; mirrors 13-review.js) ----
const privOf = (d) => d.privilege || 'none';
const respOf = (d) => (d.responsive === 'yes' ? 'yes' : 'no');
const authorOf = (d) => d.author || d.custodian || '';
const recipientsOf = (d) => d.recipients || d.to || '';
const createdOf = (d) => d.dateCreated || d.date || '';
const privDescOf = (d) => d.privDesc || '';
// Real grounds language for the two privileges room 13 codes. Reference: the
// two heads of privilege recognised in Ontario civil discovery.
const PRIV_BASIS = { 'solicitor-client': 'Solicitor-client privilege', litigation: 'Litigation privilege' };
const basisOf = (d) => PRIV_BASIS[privOf(d)] || privOf(d);

const byBates = (a, b) => (a.bates || '').localeCompare(b.bates || '');

// Form 30A recitals — quoted from the Ontario Rules of Civil Procedure,
// R.R.O. 1990, Reg. 194, Form 30A (Affidavit of Documents (Individual)) and
// r. 30.03. Reference text, reproduced verbatim so counsel can confirm it
// against the current Form; the deponent's particulars are the only inserts.
const RECITALS = [
  'I have conducted a diligent search of my records and made appropriate enquiries of others to inform myself in order to make this affidavit. This affidavit discloses, to the full extent of my knowledge, information and belief, all documents relating to any matter in issue in this action that are or have been in my possession, control or power.',
  'I have listed in Schedule A those documents that are in my possession, control or power and that I do not object to producing for inspection.',
  'I have listed in Schedule B those documents that are or were in my possession, control or power and that I object to producing because I claim they are privileged, and I have set out in Schedule B the grounds for each such claim.',
  'I have listed in Schedule C those documents that were formerly in my possession, control or power but are no longer in my possession, control or power, and I have stated in Schedule C when and how I lost possession or control of or power over them and their present location.',
  'I have never had in my possession, control or power any document relating to any matter in issue in this action other than those listed in Schedules A, B and C.',
];

// Printing this page yields the affidavit alone: the recitals, the three
// schedules and the jurat survive; the chrome, the editors and the Schedule C
// tools drop out. Mirrors the print discipline in room 28.
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
.affiant{color:#111}
}</style>`;

function partition(docs) {
  // Schedule A: relevant, produced — responsive and not privileged (exactly the
  // room 13 production list). Schedule B: withheld on privilege. A document can
  // sit in only one — B claims win, then A. Non-responsive documents are not
  // listed in the affidavit at all.
  const schedA = [];
  const schedB = [];
  for (const d of docs) {
    if (privOf(d) !== 'none') schedB.push(d);
    else if (respOf(d) === 'yes') schedA.push(d);
  }
  schedA.sort(byBates); schedB.sort(byBates);
  return { schedA, schedB };
}

// The party this affidavit speaks for. The matter carries the client; the
// deponent record carries how the client is described in the proceeding
// (e.g. "the Defendant", "a director of the Defendant"). We never invent it —
// blank stays blank and the affidavit flags it.
function loadMeta(k, matterId) {
  const all = k.scope(matterId).list('affidavitMeta');
  return all.length ? all.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] : null;
}

function schedRows(list, cols) { return table(cols, list); }

function affidavitDoc(ctx, meta, schedA, schedB, schedC) {
  const m = ctx.matter;
  const nm = meta && meta.deponentName ? meta.deponentName : '';
  const cap = meta && meta.capacity ? meta.capacity : '';
  const place = meta && meta.swornPlace ? meta.swornPlace : '';
  const sworn = meta && meta.swornDate ? meta.swornDate : '';
  const need = (v, what) => v ? esc(v) : `<span class="tag gate">${esc(what)}</span>`;

  const aRows = schedA.map((d, i) => [
    `<span class="num">${i + 1}</span>`,
    `<span class="num">${esc(d.bates || '—')}</span>`,
    date(createdOf(d)) || '—',
    esc(d.title || '(untitled)'),
    esc(d.custodian || '—'),
  ]);
  const bRows = schedB.map((d, i) => [
    `<span class="num">${i + 1}</span>`,
    `<span class="num">${esc(d.bates || '—')}</span>`,
    date(createdOf(d)) || '—',
    esc(privDescOf(d) || '(description of subject required — never the content)'),
    esc(authorOf(d) || '—'),
    esc(recipientsOf(d) || '—'),
    tag(basisOf(d), 'gate'),
  ]);
  const cRows = schedC.map((c, i) => [
    `<span class="num">${i + 1}</span>`,
    date(c.docDate) || '—',
    esc(c.description || ''),
    esc(c.lostWhenHow || ''),
    esc(c.presentLocation || ''),
  ]);

  return `
  <div class="card">
    <div style="text-align:center;margin-bottom:14px">
      <div class="note" style="margin:0">Court File No. ${m.fileNo ? esc(m.fileNo) : '________________'}</div>
      <h2 class="sec" style="border:0;text-align:center;margin:6px 0 2px">${esc(m.title)}</h2>
      <div class="roomsub" style="margin:0">Affidavit of Documents &middot; Ontario r. 30.03 / Form 30A</div>
    </div>
    <p class="affiant">I, ${need(nm, 'deponent name required')}${cap ? ', ' + esc(cap) + ',' : ' '} MAKE OATH AND SAY (or AFFIRM):</p>
    <ol>
      ${RECITALS.map((r) => `<li style="margin-bottom:6px">${esc(r)}</li>`).join('')}
    </ol>

    <h2 class="sec">Schedule A — documents produced ${schedA.length ? tag(schedA.length + ' listed', 'ok') : ''}</h2>
    <p class="note">Relevant documents in the party's possession, control or power, produced for inspection. Derived from Document Review coding: responsive and not privileged.</p>
    ${schedRows(aRows, ['No.', 'Bates', 'Date', 'Description', 'Custodian']) || empty('No documents coded responsive and unprivileged in Document Review (room 13).')}

    <h2 class="sec">Schedule B — documents withheld on privilege ${schedB.length ? tag(schedB.length + ' listed', 'gate') : ''}</h2>
    <p class="note">Relevant documents withheld from production on a claim of privilege. Each states its grounds; the description discloses the subject only, never the content. Derived from Document Review privilege coding.</p>
    ${schedRows(bRows, ['No.', 'Bates', 'Date', 'Description of subject', 'Author', 'Recipients', 'Grounds']) || empty('No documents coded privileged in Document Review (room 13).')}

    <h2 class="sec">Schedule C — documents no longer in possession ${schedC.length ? tag(schedC.length + ' listed', 'navy') : ''}</h2>
    <p class="note">Documents that were, but are no longer, in the party's possession, control or power — with when and how possession was lost and their present location. Captured here (no analogue in review coding).</p>
    ${schedRows(cRows, ['No.', 'Date', 'Description', 'When &amp; how possession lost', 'Present location']) || empty('No Schedule C documents recorded.')}

    <div style="margin-top:26px" class="affiant">
      <p>Sworn (or Affirmed) before me at ${need(place, 'place required')}, this ${sworn ? esc(String(sworn).slice(0, 10)) : '________'} day.</p>
      <div class="grid2" style="margin-top:24px">
        <div style="border-top:1px solid var(--rule);padding-top:6px">A Commissioner for Taking Affidavits</div>
        <div style="border-top:1px solid var(--rule);padding-top:6px">${need(nm, 'deponent name required')}</div>
      </div>
    </div>
  </div>`;
}

// Plain-text rendering of the same affidavit for the downloadable file.
function affidavitText(ctx, meta, schedA, schedB, schedC) {
  const m = ctx.matter;
  const L = [];
  const line = (s) => L.push(s == null ? '' : String(s));
  const nm = (meta && meta.deponentName) || '[DEPONENT NAME]';
  const cap = (meta && meta.capacity) || '';
  const place = (meta && meta.swornPlace) || '____________________';
  const sworn = (meta && meta.swornDate) ? String(meta.swornDate).slice(0, 10) : '________';

  line('AFFIDAVIT OF DOCUMENTS');
  line('Ontario Rules of Civil Procedure, r. 30.03 / Form 30A');
  line('');
  line('Court File No. ' + (m.fileNo || '________________'));
  line(m.title);
  line('');
  line('I, ' + nm + (cap ? ', ' + cap + ',' : '') + ' MAKE OATH AND SAY (or AFFIRM):');
  line('');
  RECITALS.forEach((r, i) => { line((i + 1) + '. ' + r); line(''); });

  line('SCHEDULE A — Documents produced (responsive, not privileged)');
  if (schedA.length) schedA.forEach((d, i) => line(`  ${i + 1}. [${d.bates || '—'}] ${dtxt(createdOf(d))}  ${d.title || '(untitled)'}${d.custodian ? '  — custodian: ' + d.custodian : ''}`));
  else line('  (none)');
  line('');

  line('SCHEDULE B — Documents withheld on privilege');
  if (schedB.length) schedB.forEach((d, i) => line(`  ${i + 1}. [${d.bates || '—'}] ${dtxt(createdOf(d))}  ${privDescOf(d) || '(subject description required)'}  — author: ${authorOf(d) || '—'}; recipients: ${recipientsOf(d) || '—'}; grounds: ${basisOf(d)}`));
  else line('  (none)');
  line('');

  line('SCHEDULE C — Documents formerly in possession, control or power');
  if (schedC.length) schedC.forEach((c, i) => line(`  ${i + 1}. ${dtxt(c.docDate)}  ${c.description || ''}  — lost: ${c.lostWhenHow || '—'}; present location: ${c.presentLocation || '—'}`));
  else line('  (none)');
  line('');

  line('Sworn (or Affirmed) before me at ' + place + ', this ' + sworn + ' day.');
  line('');
  line('_________________________________     _________________________________');
  line('A Commissioner for Taking Affidavits     ' + nm);
  return L.join('\n') + '\n';
}
const dtxt = (d) => (d ? String(d).slice(0, 10) : '—');

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const render = (body) => html(res, layout({ ...ctx, room: ROOM.id },
      { title: ROOM.title, sub: 'Sworn disclosure, assembled from coding — r. 30.03 / Form 30A', body }));
    if (!ctx.matter) { render(empty('Open a matter to assemble its affidavit of documents.')); return; }

    const s = k.scope(ctx.matter.id);
    const docs = s.list('document');
    const { schedA, schedB } = partition(docs);
    const schedC = s.list('scheduleC').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const meta = loadMeta(k, ctx.matter.id);
    const nonResp = docs.filter((d) => privOf(d) === 'none' && respOf(d) !== 'yes').length;
    const onOntario = (ctx.matter.jurisdiction || 'on') === 'on';

    const body = `
    ${PRINT}
    <div class="print-only"><div class="note">Assembled ${new Date().toISOString().slice(0, 10)} — confirm against the current Form 30A before swearing.</div></div>

    <div class="noprint">
    ${onOntario ? '' : `<div class="flash err">This matter's jurisdiction is <b>${esc(ctx.matter.jurisdiction || '?')}</b>. Form 30A and r. 30.03 are the Ontario procedure; other jurisdictions use a different form and grounds — treat this as a working draft only.</div>`}
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Deponent &amp; swearing</h2>
        <form method="POST" action="/r/${ROOM.id}/deponent">
          ${input('deponentName', 'Deponent (who swears the affidavit)', { value: meta ? meta.deponentName : '', required: true, placeholder: ctx.matter.client || 'Full legal name' })}
          ${input('capacity', 'Capacity in the proceeding', { value: meta ? meta.capacity : '', placeholder: 'the Defendant / a director of the Defendant' })}
          <div class="grid2">
            <span>${input('swornPlace', 'Place sworn (city/town)', { value: meta ? meta.swornPlace : '', placeholder: 'Toronto' })}</span>
            <span>${input('swornDate', 'Date sworn', { type: 'date', value: meta ? String(meta.swornDate || '').slice(0, 10) : '' })}</span>
          </div>
          <button>Save deponent</button>
        </form>
        <p class="note">The affidavit is sworn by the party (or its authorised representative), not by counsel. It is printed here for the client to swear before a commissioner.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a Schedule C document</h2>
        <form method="POST" action="/r/${ROOM.id}/scheduleC">
          ${input('description', 'Description of the document', { required: true, placeholder: 'Original signed lease, executed 2019' })}
          ${input('docDate', 'Document date', { type: 'date' })}
          ${input('lostWhenHow', 'When & how possession was lost', { placeholder: 'Delivered to landlord on closing, March 2021' })}
          ${input('presentLocation', 'Present location', { placeholder: 'In the possession of the landlord' })}
          <button>Add to Schedule C</button>
        </form>
        <p class="note">Schedule C lists documents that were, but are no longer, in the party's possession — there is no coding value for this in Document Review, so add them here.</p>
      </div>
    </div>

    ${schedC.length ? `<h2 class="sec">Schedule C entries</h2>
    ${table(['Date', 'Description', 'When & how lost', 'Present location', ''], schedC.map((c) => [
      date(c.docDate) || '—', esc(c.description || ''), esc(c.lostWhenHow || '—'), esc(c.presentLocation || '—'),
      `<form method="POST" action="/r/${ROOM.id}/scheduleC/del" style="margin:0"><input type="hidden" name="id" value="${esc(c.id)}"><button class="danger quiet">Remove</button></form>`,
    ]))}` : ''}

    <div class="card">
      <h2 class="sec" style="margin-top:0">Print &amp; download</h2>
      ${kv([
        ['Schedule A', `${schedA.length} produced`],
        ['Schedule B', `${schedB.length} withheld on privilege`],
        ['Schedule C', `${schedC.length} no longer held`],
        ['Not listed', `${nonResp} coded not responsive (excluded from the affidavit)`],
      ])}
      <p style="margin-top:12px">
        <a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a>
        <form method="POST" action="/r/${ROOM.id}/download" style="display:inline;margin-left:8px">
          <button style="margin-top:0">Download affidavit (.txt)</button>
        </form>
      </p>
      <p class="note">Schedules A and B are assembled live from Document Review coding — code or recode there (room 13) and the affidavit follows. Reference: Ontario Rules of Civil Procedure, r. 30.03 and Form 30A; confirm the wording against the current form before it is sworn.</p>
    </div>
    </div>

    ${affidavitDoc(ctx, meta, schedA, schedB, schedC)}
    `;
    render(body);
  });

  app.route('POST', `/r/${ROOM.id}/deponent`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const deponentName = String(ctx.body.deponentName || '').trim();
    if (!deponentName) { ctx.setFlash('The deponent name is required — the party swears the affidavit.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const s = k.scope(ctx.matter.id);
    const existing = loadMeta(k, ctx.matter.id);
    const rec = {
      deponentName,
      capacity: String(ctx.body.capacity || '').trim(),
      swornPlace: String(ctx.body.swornPlace || '').trim(),
      swornDate: String(ctx.body.swornDate || '').slice(0, 10),
    };
    s.put('affidavitMeta', existing ? { ...existing, ...rec } : rec);
    ctx.setFlash(`Deponent set: ${deponentName}.`);
    redirect(res, `/r/${ROOM.id}`);
  });

  app.route('POST', `/r/${ROOM.id}/scheduleC`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const description = String(ctx.body.description || '').trim();
    if (!description) { ctx.setFlash('A Schedule C entry needs a document description.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    k.scope(ctx.matter.id).put('scheduleC', {
      description,
      docDate: String(ctx.body.docDate || '').slice(0, 10),
      lostWhenHow: String(ctx.body.lostWhenHow || '').trim(),
      presentLocation: String(ctx.body.presentLocation || '').trim(),
    });
    ctx.setFlash('Added to Schedule C.');
    redirect(res, `/r/${ROOM.id}`);
  });

  app.route('POST', `/r/${ROOM.id}/scheduleC/del`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const id = String(ctx.body.id || '').trim();
    const rec = id ? k.scope(ctx.matter.id).get('scheduleC', id) : null;
    if (!rec) { ctx.setFlash('That Schedule C entry was not found.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    k.scope(ctx.matter.id).del('scheduleC', id);
    ctx.setFlash('Schedule C entry removed.');
    redirect(res, `/r/${ROOM.id}`);
  });

  // Download the assembled affidavit as a text file. Responds directly with the
  // document (never a 500): with no deponent set yet it still renders, with the
  // missing particulars left as blanks to fill in on the sworn copy.
  app.route('POST', `/r/${ROOM.id}/download`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const s = k.scope(ctx.matter.id);
    const { schedA, schedB } = partition(s.list('document'));
    const schedC = s.list('scheduleC').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const meta = loadMeta(k, ctx.matter.id);
    const text = affidavitText(ctx, meta, schedA, schedB, schedC);
    k.audit('affidavit.download', ctx.matter.id + ':A' + schedA.length + ':B' + schedB.length + ':C' + schedC.length);
    const today = new Date().toISOString().slice(0, 10);
    const slug = String(ctx.matter.title || 'matter').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'matter';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="affidavit-of-documents-${slug}-${today}.txt"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(text);
  });
}

module.exports = { ...ROOM, register };
