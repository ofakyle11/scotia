'use strict';
// Room 16 — Evidence Room. Every exhibit with its foundation and hearsay path.
const { layout, esc, table, empty, tag, input, textarea, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 16, id: 'evidence', title: 'Evidence Room', phase: 'Discover' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Exhibits, with foundation', body: empty('Open a matter to manage its exhibits.') })); return; }
    const s = k.scope(ctx.matter.id);
    const exhibits = s.list('exhibit').sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
    const limine = s.list('inLimine');
    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add exhibit</h2>
        <form method="POST" action="/r/evidence/add">
          ${select('side', 'Side', [['P', 'Plaintiff / Applicant'], ['D', 'Defendant / Respondent']], 'P')}
          ${input('description', 'Description', { required: true, placeholder: 'Service invoice, 12 March 2025' })}
          ${input('witness', 'Sponsoring witness (who authenticates)')}
          ${input('foundation', 'Foundation', { placeholder: 'Business record — maker or qualified witness' })}
          ${input('hearsay', 'Hearsay path', { placeholder: 'Business records exception / not for truth' })}
          <button>Number &amp; list</button>
        </form>
        <p class="note">Numbers are assigned per side (P-1, P-2… / D-1…) and never reused. Foundation and hearsay rules per evidence code are reference data in production (FRE / provincial evidence acts).</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Motions in limine</h2>
        <form method="POST" action="/r/evidence/limine">
          ${input('target', 'Target evidence', { required: true })}
          ${input('ground', 'Ground', { required: true, placeholder: 'Prejudice outweighs probative value' })}
          <button>Add motion</button>
        </form>
        ${limine.length ? table(['Target', 'Ground', 'Status', ''], limine.map((l) => [esc(l.target), esc(l.ground), tag(l.status || 'draft', l.status === 'granted' ? 'ok' : l.status === 'denied' ? 'gate' : ''),
          `<form method="POST" action="/r/evidence/limine-status" style="margin:0"><input type="hidden" name="id" value="${esc(l.id)}"><select name="status" style="width:auto"><option>draft</option><option>filed</option><option>granted</option><option>denied</option></select><button class="quiet">Set</button></form>`])) : empty('No motions in limine yet.')}
      </div>
    </div>
    <h2 class="sec">Exhibit list — ${esc(ctx.matter.title)}</h2>
    ${exhibits.length ? table(['No.', 'Description', 'Witness', 'Foundation', 'Hearsay path', 'Status', ''], exhibits.map((e) => [
      `<span class="num">${esc(e.number)}</span>`, esc(e.description), esc(e.witness || ''), esc(e.foundation || ''), esc(e.hearsay || ''),
      tag(e.status || 'listed', e.status === 'admitted' ? 'ok' : e.status === 'refused' ? 'gate' : ''),
      `<form method="POST" action="/r/evidence/status" style="margin:0"><input type="hidden" name="id" value="${esc(e.id)}"><select name="status" style="width:auto"><option>listed</option><option>offered</option><option>admitted</option><option>refused</option></select><button class="quiet">Set</button></form>`,
    ])) : empty('No exhibits listed yet.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Exhibits, with foundation — who authenticates, under what, and the hearsay path', body }));
  });

  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/evidence'); return; }
    const desc = String(ctx.body.description || '').trim();
    if (!desc) { ctx.setFlash('A description is required.', 'err'); redirect(res, '/r/evidence'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const side = ctx.body.side === 'D' ? 'D' : 'P';
    const n = s.list('exhibit', (e) => e.side === side).length + 1;
    s.put('exhibit', { side, number: `${side}-${n}`, description: desc, witness: ctx.body.witness, foundation: ctx.body.foundation, hearsay: ctx.body.hearsay, status: 'listed' });
    ctx.setFlash(`Exhibit ${side}-${n} listed.`);
    redirect(res, '/r/evidence');
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    if (ctx.matter) {
      const s = ctx.kernel.scope(ctx.matter.id);
      const e = s.get('exhibit', String(ctx.body.id || ''));
      if (e && ['listed', 'offered', 'admitted', 'refused'].includes(ctx.body.status)) s.put('exhibit', { ...e, status: ctx.body.status });
    }
    redirect(res, '/r/evidence');
  });

  app.route('POST', `/r/${ROOM.id}/limine`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/evidence'); return; }
    const target = String(ctx.body.target || '').trim(), ground = String(ctx.body.ground || '').trim();
    if (!target || !ground) { ctx.setFlash('Target and ground are required.', 'err'); redirect(res, '/r/evidence'); return; }
    ctx.kernel.scope(ctx.matter.id).put('inLimine', { target, ground, status: 'draft' });
    redirect(res, '/r/evidence');
  });

  app.route('POST', `/r/${ROOM.id}/limine-status`, (req, res, ctx) => {
    if (ctx.matter) {
      const s = ctx.kernel.scope(ctx.matter.id);
      const l = s.get('inLimine', String(ctx.body.id || ''));
      if (l && ['draft', 'filed', 'granted', 'denied'].includes(ctx.body.status)) s.put('inLimine', { ...l, status: ctx.body.status });
    }
    redirect(res, '/r/evidence');
  });
}

module.exports = { ...ROOM, register };
