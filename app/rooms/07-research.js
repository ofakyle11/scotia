'use strict';
// Room 07 — Research Desk. Issue framed, conclusion stated, authority weighed.
// Adverse authority renders FIRST — the candour duty is a layout rule here.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 7, id: 'research', title: 'Research Desk', phase: 'Build' };
const SUB = 'Memos per matter — issue, conclusion, authorities; adverse first';

const weightTag = (a) => a.weight === 'binding' ? tag('binding', 'navy') : tag('persuasive');
const byAdverseFirst = (a, b) =>
  ((b.adverse ? 1 : 0) - (a.adverse ? 1 : 0)) ||
  ((b.weight === 'binding' ? 1 : 0) - (a.weight === 'binding' ? 1 : 0)) ||
  (a.createdAt || '').localeCompare(b.createdAt || '');

function checkCell(a) {
  if (a.checkId) return tag('in citation check', 'ok');
  return `<form method="POST" action="/r/research/send" style="display:inline"><input type="hidden" name="id" value="${esc(a.id)}"><button class="quiet">send to Citation Check</button></form>`;
}

function authorityRow(a) {
  return [
    `<span class="num">${esc(a.cite)}</span>`,
    esc(a.court || '—'),
    a.year ? `<span class="num">${esc(a.year)}</span>` : '—',
    weightTag(a),
    a.adverse ? tag('adverse', 'gate') : tag('for us', 'ok'),
    esc(a.proposition),
    `${checkCell(a)}
     <form method="POST" action="/r/research/drop" style="display:inline;margin-left:6px"><input type="hidden" name="id" value="${esc(a.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form>`,
  ];
}

function memoCard(m, auths) {
  const mine = auths.filter((a) => a.memoId === m.id).sort(byAdverseFirst);
  const adverseCount = mine.filter((a) => a.adverse).length;
  return `<div class="card">
    ${kv([
      ['Issue', `<b style="color:var(--ink)">${esc(m.issue)}</b>`],
      ['Conclusion', m.conclusion ? esc(m.conclusion) : tag('unresolved', 'gate')],
      ['Framed', date(m.createdAt) || '—'],
      ['Authorities', `${tag(`${mine.length} cited`)} ${adverseCount ? tag(`${adverseCount} adverse`, 'gate') : ''}`],
    ])}
    ${mine.length
      ? table(['Citation', 'Court', 'Year', 'Weight', 'Cuts', 'Proposition', ''], mine.map(authorityRow))
      : empty('No authorities on this memo yet. A conclusion without authority is a hunch.')}
    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-soft)">Add authority</summary>
      <form method="POST" action="/r/research/authority">
        <input type="hidden" name="memoId" value="${esc(m.id)}">
        <div class="grid3">
          <span>${input('cite', 'Citation string', { required: true, placeholder: 'Style of cause, neutral or reporter cite' })}</span>
          <span>${input('court', 'Court', { placeholder: 'e.g. ONCA, SCC, BCSC' })}</span>
          <span>${input('year', 'Year', { placeholder: '2021' })}</span>
        </div>
        <div class="grid2">
          <span>${select('weight', 'Weight', [['binding', 'Binding on this court'], ['persuasive', 'Persuasive only']], 'binding')}</span>
          <span>${select('adverse', 'Adverse?', [['no', 'Supports our position'], ['yes', 'Adverse — cuts against us']], 'no')}</span>
        </div>
        ${textarea('proposition', 'Proposition it stands for', { required: true, placeholder: 'One sentence: what this case actually decides that matters here.' })}
        <button>Cite it</button>
      </form>
    </details>
    <details style="margin-top:8px">
      <summary style="cursor:pointer;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-soft)">${m.conclusion ? 'Revise conclusion' : 'Record conclusion'}</summary>
      <form method="POST" action="/r/research/conclude">
        <input type="hidden" name="id" value="${esc(m.id)}">
        ${textarea('conclusion', 'Conclusion', { required: true, value: m.conclusion || '', placeholder: 'Answer the issue as framed — likely / unlikely / turns on X.' })}
        <button>Save conclusion</button>
      </form>
    </details>
  </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body: empty('Open a matter to work its research memos.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const memos = s.list('memo').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const auths = s.list('authority');
    const memoById = Object.fromEntries(memos.map((m) => [m.id, m]));
    const adverse = auths.filter((a) => a.adverse).sort(byAdverseFirst);
    const pending = s.list('citation_instance', (c) => c.source === 'research' && c.status === 'unverified').length;

    // Candour duty: authority against us renders before anything else on the page.
    const adverseBlock = adverse.length ? `
    <div class="card" style="border-color:var(--oxide)">
      <h2 class="sec" style="margin-top:0;border-bottom-color:var(--oxide)">Adverse authority ${tag('candour duty', 'gate')}</h2>
      ${table(['Citation', 'Court', 'Year', 'Weight', 'Against us on', 'Memo', ''], adverse.map((a) => {
        const m = memoById[a.memoId];
        return [
          `<span class="num">${esc(a.cite)}</span>`,
          esc(a.court || '—'),
          a.year ? `<span class="num">${esc(a.year)}</span>` : '—',
          weightTag(a),
          esc(a.proposition),
          esc(m ? m.issue : '—'),
          checkCell(a),
        ];
      }))}
      <p class="note">These cut against our position. Candour to the tribunal means each one gets disclosed and distinguished — never buried. Binding adverse authority sorts to the top; it renders here, first, until the memo deals with it.</p>
    </div>` : '';

    const body = `
    ${adverseBlock}
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Frame a new memo</h2>
        <form method="POST" action="/r/research/memo">
          ${textarea('issue', 'Issue as framed', { required: true, placeholder: 'Whether... — one question, precisely put. A vague issue produces a vague memo.' })}
          ${textarea('conclusion', 'Conclusion (leave blank if still open)', { placeholder: 'Answer the issue, or leave it unresolved until the authorities are in.' })}
          <button>Open memo</button>
        </form>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Desk state — ${esc(ctx.matter.title)}</h2>
        <p>
          ${tag(`${memos.length} memo${memos.length === 1 ? '' : 's'}`)}
          ${tag(`${auths.length} authorities`)}
          ${tag(`${auths.filter((a) => a.weight === 'binding').length} binding`, 'navy')}
          ${adverse.length ? tag(`${adverse.length} adverse`, 'gate') : tag('no adverse authority recorded', 'ok')}
          ${pending ? tag(`${pending} awaiting citation check`, 'gate') : ''}
        </p>
        <p class="note">Every authority carries the proposition it stands for and whether it binds this court. Sending it to Citation Check records an <b>unverified</b> citation instance in this matter — nothing cited here is treated as good law until it comes back verified.</p>
        <p class="note">Retrieval against the CourtListener / Caselaw Access Project corpora wires in here — Build Sheet L07. Until it lands, authorities are entered by hand and verified in Citation Check; this room does not fabricate search results.</p>
      </div>
    </div>
    <h2 class="sec">Memos</h2>
    ${memos.length ? memos.map((m) => memoCard(m, auths)).join('') : empty('No memos yet. Research starts with an issue framed as a question.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });

  app.route('POST', `/r/${ROOM.id}/memo`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const issue = String(ctx.body.issue || '').trim();
    if (!issue) { ctx.setFlash('Frame the issue — a memo without a question answers nothing.', 'err'); redirect(res, '/r/research'); return; }
    ctx.kernel.scope(ctx.matter.id).put('memo', { issue, conclusion: String(ctx.body.conclusion || '').trim() });
    ctx.setFlash('Memo opened. Now find the authority — including the authority against you.');
    redirect(res, '/r/research');
  });

  app.route('POST', `/r/${ROOM.id}/conclude`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const m = ctx.body.id ? s.get('memo', ctx.body.id) : null;
    if (!m) { ctx.setFlash('Memo not found.', 'err'); redirect(res, '/r/research'); return; }
    const conclusion = String(ctx.body.conclusion || '').trim();
    if (!conclusion) { ctx.setFlash('State the conclusion, or leave the memo unresolved as it is.', 'err'); redirect(res, '/r/research'); return; }
    s.put('memo', { ...m, conclusion });
    ctx.setFlash('Conclusion recorded.');
    redirect(res, '/r/research');
  });

  app.route('POST', `/r/${ROOM.id}/authority`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const m = ctx.body.memoId ? s.get('memo', ctx.body.memoId) : null;
    if (!m) { ctx.setFlash('Pick a memo to cite the authority under.', 'err'); redirect(res, '/r/research'); return; }
    const cite = String(ctx.body.cite || '').trim();
    if (!cite) { ctx.setFlash('An authority needs its citation string.', 'err'); redirect(res, '/r/research'); return; }
    const proposition = String(ctx.body.proposition || '').trim();
    if (!proposition) { ctx.setFlash('State the proposition — without one, that is a citation, not research.', 'err'); redirect(res, '/r/research'); return; }
    const year = String(ctx.body.year || '').trim();
    if (year && !/^\d{4}$/.test(year)) { ctx.setFlash('Year must be four digits (or blank).', 'err'); redirect(res, '/r/research'); return; }
    const adverse = ctx.body.adverse === 'yes';
    s.put('authority', {
      memoId: m.id, cite,
      court: String(ctx.body.court || '').trim(),
      year,
      weight: ctx.body.weight === 'persuasive' ? 'persuasive' : 'binding',
      adverse,
      proposition,
      checkId: null,
    });
    ctx.setFlash(adverse
      ? `Adverse authority recorded — ${cite} now renders first on this desk until the memo deals with it.`
      : `Authority recorded: ${cite}.`);
    redirect(res, '/r/research');
  });

  app.route('POST', `/r/${ROOM.id}/send`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const a = ctx.body.id ? s.get('authority', ctx.body.id) : null;
    if (!a) { ctx.setFlash('Authority not found.', 'err'); redirect(res, '/r/research'); return; }
    if (a.checkId) { ctx.setFlash('Already sent — that citation is with Citation Check.', 'err'); redirect(res, '/r/research'); return; }
    const ci = s.put('citation_instance', {
      cite: a.cite, source: 'research', status: 'unverified',
      court: a.court || '', year: a.year || '', memoId: a.memoId, authorityId: a.id,
    });
    s.put('authority', { ...a, checkId: ci.id });
    ctx.setFlash(`Sent to Citation Check — ${a.cite} stands unverified until it comes back.`);
    redirect(res, '/r/research');
  });

  app.route('POST', `/r/${ROOM.id}/drop`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/research'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const a = ctx.body.id ? s.get('authority', ctx.body.id) : null;
    if (!a) { ctx.setFlash('Authority not found.', 'err'); redirect(res, '/r/research'); return; }
    s.del('authority', a.id);
    ctx.setFlash(`Dropped ${a.cite} from the memo.`);
    redirect(res, '/r/research');
  });
}

module.exports = { ...ROOM, register };
