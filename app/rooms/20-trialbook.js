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
const CHECKLIST = ['Opening drafted', 'Closing skeleton drafted', 'Witnesses confirmed and prepared', 'Exhibits tabbed and copied', 'Jury instructions requested', 'Verdict form drafted', 'Objection sheet in the binder'];

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Openings to verdict form', body: empty('Open a matter to build its trial book.') })); return; }
    const s = k.scope(ctx.matter.id);
    const witnesses = s.list('trialWitness').sort((a, b) => (a.order || 0) - (b.order || 0));
    const exhibits = s.list('exhibit');
    const instructions = s.list('juryInstruction');
    const verdictQs = s.list('verdictQ');
    const checks = s.get('trialChecklist', 'checklist') || { id: 'checklist', done: [] };
    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Witness order</h2>
        <form method="POST" action="/r/trialbook/witness">
          ${input('name', 'Witness', { required: true })}${input('minsDirect', 'Direct (mins)', { type: 'number' })}${input('minsCross', 'Cross est. (mins)', { type: 'number' })}
          <button>Add in order</button>
        </form>
        ${witnesses.length ? table(['#', 'Witness', 'Direct', 'Cross est.'], witnesses.map((w, i) => [`<span class="num">${i + 1}</span>`, esc(w.name), `<span class="num">${esc(String(w.minsDirect || ''))}</span>`, `<span class="num">${esc(String(w.minsCross || ''))}</span>`])) : empty('No witnesses ordered yet.')}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Readiness</h2>
        <form method="POST" action="/r/trialbook/check">
          ${CHECKLIST.map((c, i) => `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft)"><input type="checkbox" name="c${i}" style="width:auto" ${checks.done.includes(i) ? 'checked' : ''}>${esc(c)}</label>`).join('')}
          <button>Save readiness</button>
        </form>
        <p class="note">${checks.done.length}/${CHECKLIST.length} ready · Exhibits on the list: <span class="num">${exhibits.length}</span> (managed in the Evidence Room).</p>
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Jury instructions</h2>
        <form method="POST" action="/r/trialbook/instruction">
          ${input('topic', 'Topic', { required: true, placeholder: 'Burden of proof — balance of probabilities' })}${input('source', 'Pattern source (reference)', { placeholder: 'e.g. CJC model instructions' })}
          <button>Request</button>
        </form>
        ${instructions.length ? table(['#', 'Topic', 'Source'], instructions.map((x, i) => [`<span class="num">${i + 1}</span>`, esc(x.topic), esc(x.source || '')])) : ''}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Verdict form</h2>
        <form method="POST" action="/r/trialbook/verdict">
          ${textarea('question', 'Question for the trier of fact', { required: true, placeholder: 'Q1. Has the plaintiff proven, on a balance of probabilities, that…' })}
          <button>Add question</button>
        </form>
        ${verdictQs.length ? table(['#', 'Question'], verdictQs.map((x, i) => [`<span class="num">Q${i + 1}</span>`, esc(x.question)])) : ''}
      </div>
    </div>
    <h2 class="sec">Objection sheet — the binder card</h2>
    ${table(['Objection', 'The move'], OBJECTIONS.map(([o, m]) => [tag(o, 'navy'), esc(m)]))}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Openings to verdict form — printed, tabbed, and on the tablet', body }));
  });

  app.route('POST', `/r/${ROOM.id}/witness`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const name = String(ctx.body.name || '').trim();
    if (!name) { ctx.setFlash('A witness needs a name.', 'err'); redirect(res, '/r/trialbook'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    s.put('trialWitness', { name, minsDirect: Number(ctx.body.minsDirect) || 0, minsCross: Number(ctx.body.minsCross) || 0, order: s.list('trialWitness').length + 1 });
    redirect(res, '/r/trialbook');
  });
  app.route('POST', `/r/${ROOM.id}/instruction`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const topic = String(ctx.body.topic || '').trim();
    if (!topic) { ctx.setFlash('A topic is required.', 'err'); redirect(res, '/r/trialbook'); return; }
    ctx.kernel.scope(ctx.matter.id).put('juryInstruction', { topic, source: ctx.body.source });
    redirect(res, '/r/trialbook');
  });
  app.route('POST', `/r/${ROOM.id}/verdict`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const question = String(ctx.body.question || '').trim();
    if (!question) { ctx.setFlash('A question is required.', 'err'); redirect(res, '/r/trialbook'); return; }
    ctx.kernel.scope(ctx.matter.id).put('verdictQ', { question });
    redirect(res, '/r/trialbook');
  });
  app.route('POST', `/r/${ROOM.id}/check`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/trialbook'); return; }
    const done = [];
    for (let i = 0; i < CHECKLIST.length; i++) if (ctx.body['c' + i]) done.push(i);
    ctx.kernel.scope(ctx.matter.id).put('trialChecklist', { id: 'checklist', done });
    ctx.setFlash(`Readiness saved — ${done.length}/${CHECKLIST.length}.`);
    redirect(res, '/r/trialbook');
  });
}

module.exports = { ...ROOM, register };
