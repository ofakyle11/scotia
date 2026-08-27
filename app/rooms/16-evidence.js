'use strict';
// Room 16 — Evidence Room. Every exhibit with its foundation and hearsay path.
const { layout, esc, table, empty, tag, input, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 16, id: 'evidence', title: 'Evidence Room', phase: 'Discover' };

const STATUSES = ['listed', 'offered', 'admitted', 'refused'];
const LIMINE_STATUSES = ['draft', 'filed', 'granted', 'denied'];

// Printing yields the two things counsel carries into the courtroom: the exhibit
// list and the in-limine register. The shared base in kernel/html.js drops the
// chrome, every form and everything marked .no-print, and re-points the palette;
// only what it cannot know is stated here — the room heading has no place on a
// list handed up to a trial coordinator.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

const trim = (v) => String(v ?? '').trim();
const statusOf = (e) => (STATUSES.includes(e.status) ? e.status : 'listed');
const statusTag = (st) => tag(st, st === 'admitted' ? 'ok' : st === 'refused' ? 'gate' : st === 'offered' ? 'navy' : '');
// The admission gate, stated once and read in three places: the row cells that
// show what is missing, the readiness chip, and POST /status which enforces it.
const admissible = (e) => !!trim(e.foundation) && !!trim(e.witness);

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Exhibits, with foundation', body: empty('Open a matter above to number its exhibits and log its motions in limine.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const exhibits = s.list('exhibit').sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
    const limine = s.list('inLimine');
    const today = new Date().toISOString().slice(0, 10);
    // Reviewed documents from Document Review (room 13, same matter scope) an
    // exhibit can point to by id — so its Bates/title is carried, not retyped.
    const docs = s.list('document').sort((a, b) => (a.bates || '').localeCompare(b.bates || ''));
    const docById = new Map(docs.map((d) => [d.id, d]));
    const docOpts = docs.length
      ? [['', '— none —'], ...docs.map((d) => [d.id, `${d.bates || '?'} — ${d.title || '(untitled)'}`])]
      : [['', '— nothing coded in Document Review yet —']];
    const docCell = (e) => {
      if (!e.documentId) return '<span style="color:var(--ink-faint)">—</span>';
      const d = docById.get(e.documentId);
      if (!d) return tag('doc removed', 'gate');
      return `<a href="/r/review/doc/${encodeURIComponent(d.id)}"><span class="num">${esc(d.bates || '—')}</span> ${esc(d.title || '(untitled)')}</a>`;
    };
    const missing = (v) => (trim(v) ? esc(trim(v)) : tag('missing', 'gate'));
    const setForm = (e) => `<span class="no-print"><form method="POST" action="/r/evidence/status" style="margin:0">`
      + `<input type="hidden" name="id" value="${esc(e.id)}">`
      + `<select name="status" style="width:auto" aria-label="Status for exhibit ${esc(e.number)}">`
      + STATUSES.map((v) => `<option${v === statusOf(e) ? ' selected' : ''}>${v}</option>`).join('')
      + `</select><button class="quiet">Set</button></form></span>`;
    const limineSetForm = (l) => `<span class="no-print"><form method="POST" action="/r/evidence/limine-status" style="margin:0">`
      + `<input type="hidden" name="id" value="${esc(l.id)}">`
      + `<select name="status" style="width:auto" aria-label="Status for motion targeting ${esc(l.target)}">`
      + LIMINE_STATUSES.map((v) => `<option${v === (LIMINE_STATUSES.includes(l.status) ? l.status : 'draft') ? ' selected' : ''}>${v}</option>`).join('')
      + `</select><button class="quiet">Set</button></form></span>`;

    const count = (st) => exhibits.filter((e) => statusOf(e) === st).length;
    const notReady = exhibits.filter((e) => statusOf(e) !== 'admitted' && !admissible(e));
    const chips = exhibits.length
      ? [tag(`${exhibits.filter((e) => e.side === 'P').length} P · ${exhibits.filter((e) => e.side === 'D').length} D`),
        count('offered') ? tag(`${count('offered')} offered`, 'navy') : '',
        count('admitted') ? tag(`${count('admitted')} admitted`, 'ok') : '',
        count('refused') ? tag(`${count('refused')} refused`, 'gate') : '',
        notReady.length ? tag(`${notReady.length} not yet admissible`, 'gate') : ''].filter(Boolean).join(' ')
      : '';

    const listSection = `
    <h2 class="sec" style="margin-top:0">Exhibit list ${chips}</h2>
    ${exhibits.length ? table(['No.', 'Description', 'Document', 'Witness', 'Foundation', 'Hearsay path', 'Status', ''], exhibits.map((e) => [
      `<span class="num">${esc(e.number)}</span>`,
      esc(e.description || ''),
      docCell(e),
      missing(e.witness),
      missing(e.foundation),
      trim(e.hearsay) ? esc(trim(e.hearsay)) : '<span style="color:var(--ink-faint)">—</span>',
      statusTag(statusOf(e)),
      setForm(e),
    ])) : empty('No exhibits yet — number the first one with the Add exhibit form below.')}
    <p class="note">A <b>missing</b> witness or foundation cell is the admission gate showing its teeth: an exhibit cannot be marked <b>admitted</b> until both a foundation note and a sponsoring witness are on the record. Numbers are assigned per side (P-1, P-2… / D-1…) and are never reused.</p>`;

    const addCard = `<div class="card">
        <h2 class="sec" style="margin-top:0">Add exhibit</h2>
        <form method="POST" action="/r/evidence/add">
          ${input('description', 'Description', { required: true, placeholder: 'Service invoice, 12 March 2025' })}
          <div class="grid2">
            <span>${select('side', 'Side', [['P', 'Plaintiff / Applicant'], ['D', 'Defendant / Respondent']], 'P')}</span>
            <span>${input('witness', 'Sponsoring witness (who authenticates)')}</span>
          </div>
          ${select('documentId', 'Link a reviewed document — carries its Bates and title', docOpts, '')}
          <div class="grid2">
            <span>${input('foundation', 'Foundation', { placeholder: 'Business record — maker or qualified witness' })}</span>
            <span>${input('hearsay', 'Hearsay path', { placeholder: 'Business records exception / not for truth' })}</span>
          </div>
          <button>Number &amp; list</button>
        </form>
        <p class="note">Link from <a href="/r/review">Document Review</a> rather than retyping a Bates number. An evidence-code lookup for foundation and hearsay routes (FRE, the provincial evidence acts) wires in here — Build Sheet; until it does, both fields are counsel's own words.</p>
      </div>`;

    const limineCard = `<div class="card">
        <h2 class="sec" style="margin-top:0">Move to exclude</h2>
        <form method="POST" action="/r/evidence/limine">
          ${input('target', 'Target evidence', { required: true, placeholder: 'Surveillance video, 4 April 2025' })}
          ${input('ground', 'Ground', { required: true, placeholder: 'Prejudice outweighs probative value' })}
          <button>Add motion</button>
        </form>
      </div>`;

    const limineSection = `
    <h2 class="sec">Motions in limine ${limine.length ? tag(`${limine.filter((l) => l.status === 'granted').length} granted`, 'ok') : ''}</h2>
    ${limine.length ? table(['Target', 'Ground', 'Status', ''], limine.map((l) => [
      esc(l.target || ''), esc(l.ground || ''),
      tag(LIMINE_STATUSES.includes(l.status) ? l.status : 'draft', l.status === 'granted' ? 'ok' : l.status === 'denied' ? 'gate' : l.status === 'filed' ? 'navy' : ''),
      limineSetForm(l),
    ])) : empty('No motions in limine yet — name the evidence you want kept out, and the ground, in the form above.')}`;

    const body = `${PRINT}
    <div class="print-only" style="margin-bottom:14px"><h2 class="sec" style="margin-top:0">Exhibit list — ${esc(ctx.matter.title)} — as at ${esc(today)}</h2></div>
    <p class="note no-print" style="margin:0 0 18px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the exhibit list and the in-limine register alone — the forms and the chrome drop out.</p>
    ${exhibits.length
      ? listSection + `<div class="grid2 no-print" style="margin-top:26px">${addCard}${limineCard}</div>`
      : `<div class="grid2 no-print">${addCard}${limineCard}</div>` + listSection}
    ${limineSection}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Exhibits, with foundation — who authenticates, under what, and the hearsay path', body }));
  });

  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/evidence'); return; }
    const desc = trim(ctx.body.description);
    if (!desc) { ctx.setFlash('A description is required — name the exhibit as it will be called on the record.', 'err'); redirect(res, '/r/evidence'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const side = ctx.body.side === 'D' ? 'D' : 'P';
    const n = s.list('exhibit', (e) => e.side === side).length + 1;
    // Optional link to a reviewed document — kept only if it resolves in this matter.
    const documentId = trim(ctx.body.documentId);
    const linkedDoc = documentId ? s.get('document', documentId) : null;
    const witness = trim(ctx.body.witness), foundation = trim(ctx.body.foundation);
    s.put('exhibit', {
      side, number: `${side}-${n}`, description: desc, witness, foundation,
      hearsay: trim(ctx.body.hearsay), documentId: linkedDoc ? linkedDoc.id : '', status: 'listed',
    });
    const gap = !witness || !foundation;
    ctx.setFlash(`Exhibit ${side}-${n} listed.${linkedDoc ? ` Linked to ${linkedDoc.bates || 'document'}.` : ''}`
      + (gap ? ` It cannot be admitted until it has ${!foundation && !witness ? 'a foundation note and a sponsoring witness' : !foundation ? 'a foundation note' : 'a sponsoring witness'}.` : ''), gap ? 'err' : undefined);
    redirect(res, '/r/evidence');
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/evidence'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const e = s.get('exhibit', trim(ctx.body.id));
    const status = ctx.body.status;
    if (!e) { ctx.setFlash('That exhibit is no longer on this matter.', 'err'); redirect(res, '/r/evidence'); return; }
    if (!STATUSES.includes(status)) { ctx.setFlash('Pick one of: listed, offered, admitted, refused.', 'err'); redirect(res, '/r/evidence'); return; }
    // An exhibit cannot be admitted without a foundation note AND a sponsoring witness.
    if (status === 'admitted' && !admissible(e)) {
      ctx.setFlash(`Exhibit ${e.number} cannot be admitted without both a foundation note and a sponsoring witness.`, 'err');
      redirect(res, '/r/evidence'); return;
    }
    s.put('exhibit', { ...e, status });
    if (status === 'admitted') ctx.kernel.audit('evidence.admitted', ctx.matter.id + ':' + e.number);
    ctx.setFlash(`Exhibit ${e.number} marked ${status}.`);
    redirect(res, '/r/evidence');
  });

  app.route('POST', `/r/${ROOM.id}/limine`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/evidence'); return; }
    const target = trim(ctx.body.target), ground = trim(ctx.body.ground);
    if (!target || !ground) { ctx.setFlash('Name both the target evidence and the ground for excluding it.', 'err'); redirect(res, '/r/evidence'); return; }
    ctx.kernel.scope(ctx.matter.id).put('inLimine', { target, ground, status: 'draft' });
    ctx.setFlash(`Motion in limine recorded against ${target}.`);
    redirect(res, '/r/evidence');
  });

  app.route('POST', `/r/${ROOM.id}/limine-status`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/evidence'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const l = s.get('inLimine', trim(ctx.body.id));
    if (!l) { ctx.setFlash('That motion is no longer on this matter.', 'err'); redirect(res, '/r/evidence'); return; }
    if (!LIMINE_STATUSES.includes(ctx.body.status)) { ctx.setFlash('Pick one of: draft, filed, granted, denied.', 'err'); redirect(res, '/r/evidence'); return; }
    s.put('inLimine', { ...l, status: ctx.body.status });
    ctx.setFlash(`Motion against ${l.target} marked ${ctx.body.status}.`);
    redirect(res, '/r/evidence');
  });
}

module.exports = { ...ROOM, register };
