'use strict';
// Room 20 — Trial Book. Openings to verdict form, tabbed and ready.
const { layout, esc, table, empty, tag, input, textarea } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 20, id: 'trialbook', title: 'Trial Book', phase: 'Argue' };

const OBJECTIONS = [
  ['Leading', 'Counsel is testifying — rephrase openly on direct.'],
  ['Hearsay', 'Out-of-court statement for its truth — name the exception or withdraw.'],
  ['Foundation', 'No basis laid for knowledge or authenticity — lay it or move on.'],
  ['Speculation', 'Witness is guessing — confine to observation.'],
  ['Asked and answered', 'Covered — move along.'],
  ['Relevance', 'Connect it to an issue or leave it.'],
];
// APPEND ONLY. A saved trialChecklist stores ARRAY INDICES into this list, so
// reordering or inserting silently reinterprets every checklist already ticked.
const CHECKLIST = ['Opening drafted', 'Closing skeleton drafted', 'Witnesses confirmed and prepared', 'Exhibits tabbed and copied', 'Jury instructions requested', 'Verdict form drafted', 'Objection sheet in the binder'];

// This page IS the binder: printing yields the call order, the readiness state,
// the instructions requested, the verdict questions and the objection card —
// what counsel carries to counsel table. The shared base in kernel/html.js drops
// the chrome, the forms and the palette; stated here is only what it cannot
// know: a room heading has no place on a book handed up at trial, the two-up
// cards read as one column on paper, and the readiness ticks live inside a form
// (hidden on paper) so a print-only copy of them is rendered instead.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

// Minutes typed into an estimate: a whole non-negative number or nothing.
const mins = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const hm = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');
const num = (n) => `<span class="num">${esc(String(n))}</span>`;

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Call order, readiness, instructions, verdict form', body: empty('Open a matter above to build its trial book — call order first, then the verdict questions.') })); return; }
    const s = k.scope(ctx.matter.id);
    const witnesses = s.list('trialWitness').sort((a, b) => (a.order || 0) - (b.order || 0));
    const exhibits = s.list('exhibit');
    const instructions = s.list('juryInstruction');
    const verdictQs = s.list('verdictQ');
    const saved = s.get('trialChecklist', 'checklist');
    // A saved checklist is a list of indices into CHECKLIST; anything outside
    // the current list is ignored rather than counted, so a stale record can
    // never report the book more ready than it is.
    const doneSet = new Set((saved && Array.isArray(saved.done) ? saved.done : []).filter((i) => Number.isInteger(i) && i >= 0 && i < CHECKLIST.length));
    const today = new Date().toISOString().slice(0, 10);
    const admitted = exhibits.filter((e) => e.status === 'admitted').length;
    const evidenceMins = witnesses.reduce((t, w) => t + mins(w.minsDirect) + mins(w.minsCross), 0);
    const readyTag = tag(`${doneSet.size}/${CHECKLIST.length} ready`, doneSet.size === CHECKLIST.length ? 'ok' : doneSet.size ? 'navy' : 'gate');

    const body = `${PRINT}
    <div class="print-only" style="margin-bottom:14px"><h2 class="sec" style="margin-top:0">Trial book — ${esc(ctx.matter.title)} — as at ${esc(today)}</h2></div>
    <p class="note no-print" style="margin:0 0 18px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the binder — call order, readiness, instructions, verdict questions and the objection card — with the chrome and the forms dropped out.</p>
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Call order ${witnesses.length ? tag(hm(evidenceMins) + ' of evidence', 'navy') : ''}</h2>
        <form method="POST" action="/r/trialbook/witness">
          ${input('name', 'Witness', { required: true, placeholder: 'Surname, then how they are called' })}
          <div class="grid2">
            <span>${input('minsDirect', 'Direct (mins)', { type: 'number' })}</span>
            <span>${input('minsCross', 'Cross est. (mins)', { type: 'number' })}</span>
          </div>
          <button>Add next in order</button>
        </form>
        ${witnesses.length ? table(['#', 'Witness', 'Direct', 'Cross est.', 'Total'], witnesses.map((w, i) => [
          num(i + 1), esc(w.name), num(mins(w.minsDirect)), num(mins(w.minsCross)), num(mins(w.minsDirect) + mins(w.minsCross)),
        ])) : empty('No witnesses in the call order yet — add the first above. They are called in the order entered.')}
        ${witnesses.length ? `<p class="note">${witnesses.length} witness${witnesses.length === 1 ? '' : 'es'}, ${hm(evidenceMins)} of evidence estimated — exclusive of openings, argument, objections and rulings. Give the trial coordinator this figure, not a guess.</p>` : ''}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Readiness ${readyTag}</h2>
        <form method="POST" action="/r/trialbook/check">
          ${CHECKLIST.map((c, i) => `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)"><input type="checkbox" name="c${i}" style="width:auto" ${doneSet.has(i) ? 'checked' : ''}>${esc(c)}</label>`).join('')}
          <button>Save readiness</button>
        </form>
        <div class="print-only">${CHECKLIST.map((c, i) => `<p style="margin:2px 0;font-size:11pt">${doneSet.has(i) ? '&#9745;' : '&#9744;'} ${esc(c)}</p>`).join('')}</div>
        <p class="note">Exhibits numbered: ${num(exhibits.length)}${exhibits.length ? ` · admitted ${num(admitted)}` : ''} — numbered, founded and ruled on in the <a href="/r/evidence">Evidence Room</a>${exhibits.length ? '.' : '; nothing is numbered yet.'}</p>
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Jury instructions</h2>
        <form method="POST" action="/r/trialbook/instruction">
          <div class="grid2">
            <span>${input('topic', 'Topic', { required: true, placeholder: 'Burden of proof — balance of probabilities' })}</span>
            <span>${input('source', 'Pattern source (reference)', { placeholder: 'e.g. CJC model instructions' })}</span>
          </div>
          <button>Request</button>
        </form>
        ${instructions.length ? table(['#', 'Topic', 'Source'], instructions.map((x, i) => [num(i + 1), esc(x.topic), esc(x.source || '')]))
          : empty('No instructions requested yet — start with the burden of proof, then one per element of each cause pleaded.')}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Verdict form</h2>
        <form method="POST" action="/r/trialbook/verdict">
          ${textarea('question', 'Question for the trier of fact', { required: true, placeholder: 'Q1. Has the plaintiff proven, on a balance of probabilities, that…' })}
          <button>Add question</button>
        </form>
        ${verdictQs.length ? table(['#', 'Question'], verdictQs.map((x, i) => [num('Q' + (i + 1)), esc(x.question)]))
          : empty('No verdict questions yet — draft one question for each element the trier must decide, in the order they must decide them.')}
      </div>
    </div>
    <h2 class="sec">Objection sheet — the binder card</h2>
    ${table(['Objection', 'The move'], OBJECTIONS.map(([o, m]) => [tag(o, 'navy'), esc(m)]))}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Call order, readiness, jury instructions, verdict form — the binder itself', body }));
  });

  app.route('POST', `/r/${ROOM.id}/witness`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const name = String(ctx.body.name || '').trim();
    if (!name) { ctx.setFlash('A witness needs a name.', 'err'); redirect(res, '/r/trialbook'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const order = s.list('trialWitness').length + 1;
    s.put('trialWitness', { name, minsDirect: mins(ctx.body.minsDirect), minsCross: mins(ctx.body.minsCross), order });
    ctx.setFlash(`${name} added — called ${order}${order === 1 ? 'st' : order === 2 ? 'nd' : order === 3 ? 'rd' : 'th'}.`);
    redirect(res, '/r/trialbook');
  });
  app.route('POST', `/r/${ROOM.id}/instruction`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const topic = String(ctx.body.topic || '').trim();
    if (!topic) { ctx.setFlash('A topic is required.', 'err'); redirect(res, '/r/trialbook'); return; }
    ctx.kernel.scope(ctx.matter.id).put('juryInstruction', { topic, source: String(ctx.body.source || '').trim() });
    ctx.setFlash(`Instruction requested: ${topic}.`);
    redirect(res, '/r/trialbook');
  });
  app.route('POST', `/r/${ROOM.id}/verdict`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const question = String(ctx.body.question || '').trim();
    if (!question) { ctx.setFlash('A question is required.', 'err'); redirect(res, '/r/trialbook'); return; }
    ctx.kernel.scope(ctx.matter.id).put('verdictQ', { question });
    ctx.setFlash('Verdict question added.');
    redirect(res, '/r/trialbook');
  });
  app.route('POST', `/r/${ROOM.id}/check`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const done = [];
    for (let i = 0; i < CHECKLIST.length; i++) if (ctx.body['c' + i]) done.push(i);
    ctx.kernel.scope(ctx.matter.id).put('trialChecklist', { id: 'checklist', done });
    const left = CHECKLIST.filter((c, i) => !done.includes(i));
    ctx.setFlash(`Readiness saved — ${done.length}/${CHECKLIST.length}${left.length ? '. Outstanding: ' + left.join('; ') + '.' : '. The book is ready.'}`);
    redirect(res, '/r/trialbook');
  });
}

module.exports = { ...ROOM, register };
