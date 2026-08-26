'use strict';
// Room 19 — Moot Room. The other side's best case, before they make it.
const { layout, esc, table, empty, tag, textarea, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 19, id: 'moot', title: 'Moot Room', phase: 'Argue' };

// The six section keys a Brief Writer draft is built from (18-briefs). An
// attack is filed against one of them so it can be answered where it lands.
const TARGETS = [['conclusion', 'Conclusion'], ['rule', 'Rule'], ['explanation', 'Explanation'], ['application', 'Application'], ['counter', 'Counter-arguments'], ['closing', 'Closing']];
const TARGET_KEYS = TARGETS.map(([v]) => v);
const SEVERITIES = ['fatal', 'serious', 'minor'];
// Triage order: anything still open outranks anything resolved, then fatal
// before serious before minor. What can lose the motion sorts to the top.
const RANK = { fatal: 0, serious: 1, minor: 2 };

// What this room yields on paper is the podium sheet: the attacks still
// standing and the bench questions with their prepared answers. The shared base
// in kernel/html.js drops the chrome, the forms and the palette; stated here is
// only what it cannot know — a room heading has no place on a sheet carried to
// the podium, and the two-up entry cards read as one column on paper.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

const trim = (v) => String(v ?? '').trim();
const sevTag = (sv) => tag(sv, sv === 'fatal' ? 'gate' : sv === 'serious' ? 'navy' : '');
// A draft may come from the Brief Writer (status + citeStatus) or be registered
// in Citation Check (citeStatus only) — label whichever fields it carries.
const draftLabel = (x) => trim(x.title) + (x.status ? ' · ' + x.status : '') + (x.citeStatus && x.citeStatus !== 'none' ? ' · cite ' + x.citeStatus : '');

function modelCard(ctx, k, d, s) {
  const enabled = k.ai.enabled();
  const policy = ctx.matter.aiPolicy || 'allowed';
  const oppositions = s.list('oppositionDraft', (o) => o.draftId === d.id).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return `<div class="card">
    <h2 class="sec" style="margin-top:0">Model adversary</h2>
    <p>${enabled ? tag('gateway configured', 'ok') : tag('gateway off — admin configures at /admin', 'gate')}
       ${policy === 'forbidden' ? tag('model use FORBIDDEN on this matter', 'gate') : tag('model use allowed on this matter', 'navy')}</p>
    <div class="grid2 no-print">
      <form method="POST" action="/r/moot/ai-policy" style="margin:0">
        <input type="hidden" name="policy" value="${policy === 'forbidden' ? 'allowed' : 'forbidden'}">
        <input type="hidden" name="draftId" value="${esc(d.id)}">
        <button class="quiet">${policy === 'forbidden' ? 'Allow model use on this matter' : 'Forbid model use on this matter'}</button>
      </form>
      ${enabled && policy !== 'forbidden' ? `<form method="POST" action="/r/moot/ai-oppose" style="margin:0">
        <input type="hidden" name="draftId" value="${esc(d.id)}">
        <button>Generate opposition draft</button>
      </form>` : ''}
    </div>
    ${oppositions.map((o) => `<div style="border:1px solid var(--rule);padding:12px 14px;margin-top:12px;background:var(--ground)">
      ${tag('model-generated — ' + (o.model || 'unknown'), 'gate')} <span class="note">${esc((o.createdAt || '').slice(0, 16).replace('T', ' '))} — a starting point for the record, never the record itself. Log real attacks above.</span>
      <p style="white-space:pre-wrap;font-size:13px;color:var(--ink-soft);margin-top:8px">${esc(o.text)}</p>
    </div>`).join('')}
    <p class="note">The gateway is policy-checked and audited per call. On a local endpoint nothing leaves the building; forbid per matter where the engagement requires it.</p>
  </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The other side’s best brief', body: empty('Open a matter above to moot its drafts — the Brief Writer writes them, this room attacks them.') })); return; }
    const s = k.scope(ctx.matter.id);
    const drafts = s.list('draft');
    const openId = ctx.query.get('d') || (drafts[0] && drafts[0].id);
    const d = openId ? s.get('draft', openId) : null;
    const critiques = d ? s.list('critique', (c) => c.draftId === d.id) : [];
    const bench = d ? s.list('benchQ', (q) => q.draftId === d.id) : [];
    const today = new Date().toISOString().slice(0, 10);
    const openC = critiques.filter((c) => c.status !== 'resolved');
    const fatal = openC.filter((c) => c.severity === 'fatal');
    const unanswered = bench.filter((q) => !trim(q.answer));
    const undrilled = bench.filter((q) => !q.drilled);
    const sorted = critiques.slice().sort((a, b) =>
      (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0)
      || (RANK[a.severity] ?? 1) - (RANK[b.severity] ?? 1)
      || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const chips = d ? SEVERITIES.map((sv) => {
      const n = openC.filter((c) => c.severity === sv).length;
      return n ? sevTag(`${n} ${sv} open`) + ' ' : '';
    }).join('') + (critiques.length - openC.length ? tag(`${critiques.length - openC.length} resolved`, 'ok') : '') : '';

    const attacksSection = d ? `
    <h2 class="sec">Attacks — ${esc(trim(d.title) || '(untitled draft)')} ${chips}</h2>
    ${critiques.length ? table(['Severity', 'Target', 'The attack', 'Our response', 'Status', ''], sorted.map((c) => [
      sevTag(SEVERITIES.includes(c.severity) ? c.severity : 'serious'),
      esc(c.target || ''),
      esc(c.attack),
      trim(c.response) ? esc(trim(c.response)) : tag('none yet', 'gate'),
      c.status === 'resolved' ? tag('resolved', 'ok') : tag('open'),
      `<span class="no-print"><form method="POST" action="/r/moot/resolve" style="margin:0"><input type="hidden" name="id" value="${esc(c.id)}"><button class="quiet">${c.status === 'resolved' ? 'Reopen' : 'Resolve'}</button></form></span>`,
    ])) : empty('No attacks logged against this draft — that is not the same as none existing. Put the strongest opposing argument on the record below, then answer it.')}` : '';

    const benchSection = d ? `
    <h2 class="sec">Hot bench ${bench.length ? (unanswered.length ? tag(`${unanswered.length} without an answer`, 'gate') + ' ' : '') + (undrilled.length ? tag(`${undrilled.length} undrilled`, 'navy') : tag('all drilled', 'ok')) : ''}</h2>
    ${bench.length ? table(['The question', 'Prepared answer', 'Drilled', ''], bench.map((q) => [
      esc(q.question),
      trim(q.answer) ? esc(trim(q.answer)) : tag('none yet', 'gate'),
      q.drilled ? tag('yes', 'ok') : tag('no'),
      `<span class="no-print"><form method="POST" action="/r/moot/drill" style="margin:0"><input type="hidden" name="id" value="${esc(q.id)}"><button class="quiet">${q.drilled ? 'Un-drill' : 'Drilled'}</button></form></span>`,
    ])) : empty('No bench questions yet — write down the three you least want asked, then answer them out loud.')}` : '';

    const forms = d ? `
    <div class="grid2 no-print">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Log an attack</h2>
        <form method="POST" action="/r/moot/critique">
          <input type="hidden" name="draftId" value="${esc(d.id)}">
          <div class="grid2">
            <span>${select('target', 'Target section', TARGETS)}</span>
            <span>${select('severity', 'Severity', SEVERITIES, 'serious')}</span>
          </div>
          ${textarea('attack', 'The strongest opposing argument', { required: true, placeholder: 'Put it as they would put it, at its best — not as you would rebut it.' })}
          ${textarea('response', 'Our response')}
          <button>Log it</button>
        </form>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a bench question</h2>
        <form method="POST" action="/r/moot/bench">
          <input type="hidden" name="draftId" value="${esc(d.id)}">
          ${textarea('question', 'Question the bench will ask', { required: true, placeholder: 'What is your best authority for that proposition?' })}
          ${textarea('answer', 'Prepared answer')}
          <button>Add question</button>
        </form>
      </div>
    </div>` : '';

    const body = `${PRINT}
    <div class="print-only" style="margin-bottom:14px"><h2 class="sec" style="margin-top:0">Moot record — ${esc(ctx.matter.title)}${d ? ' — ' + esc(trim(d.title) || '(untitled draft)') : ''} — as at ${esc(today)}</h2></div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Draft under attack</h2>
      ${drafts.length ? `<form method="GET" action="/r/moot" class="mselect no-print"><select name="d" aria-label="Draft">${drafts.map((x) => `<option value="${esc(x.id)}" ${d && d.id === x.id ? 'selected' : ''}>${esc(draftLabel(x))}</option>`).join('')}</select><button class="quiet">Open</button></form>`
        : empty('No drafts on this matter — write one in the Brief Writer, then bring it here before anyone else sees it.')}
      ${d && fatal.length ? `<p class="note" style="margin-top:10px">${tag('UNRESOLVED FATAL', 'gate')} ${fatal.length} attack${fatal.length === 1 ? '' : 's'} that could lose this motion ${fatal.length === 1 ? 'is' : 'are'} still open. This room records the risk and shows it here; it does not stop the Filing Desk — that judgment stays with counsel.</p>` : ''}
      <p class="note">Whether written by machine or colleague, the attack lands here as the record.</p>
    </div>
    ${critiques.length || bench.length ? attacksSection + benchSection + forms : forms + attacksSection + benchSection}
    ${d ? modelCard(ctx, k, d, s) : ''}`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Attacked in-house before filing — vulnerabilities, responses, hot-bench drills', body }));
  });

  app.route('POST', `/r/${ROOM.id}/critique`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const attack = trim(ctx.body.attack), draftId = String(ctx.body.draftId || '');
    if (!attack || !draftId) { ctx.setFlash('An attack needs substance and a draft.', 'err'); redirect(res, '/r/moot'); return; }
    const severity = SEVERITIES.includes(ctx.body.severity) ? ctx.body.severity : 'serious';
    ctx.kernel.scope(ctx.matter.id).put('critique', {
      draftId,
      target: TARGET_KEYS.includes(ctx.body.target) ? ctx.body.target : 'conclusion',
      attack, severity, response: trim(ctx.body.response), status: 'open',
    });
    ctx.setFlash(`Attack logged as ${severity}${severity === 'fatal' ? ' — answer it or the draft does not go out.' : '.'}`, severity === 'fatal' ? 'err' : undefined);
    redirect(res, '/r/moot?d=' + encodeURIComponent(draftId));
  });
  app.route('POST', `/r/${ROOM.id}/bench`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const question = trim(ctx.body.question), draftId = String(ctx.body.draftId || '');
    if (!question || !draftId) { ctx.setFlash('A question is required.', 'err'); redirect(res, '/r/moot'); return; }
    const answer = trim(ctx.body.answer);
    ctx.kernel.scope(ctx.matter.id).put('benchQ', { draftId, question, answer, drilled: false });
    ctx.setFlash(answer ? 'Bench question added.' : 'Bench question added — no prepared answer yet.');
    redirect(res, '/r/moot?d=' + encodeURIComponent(draftId));
  });
  app.route('POST', `/r/${ROOM.id}/resolve`, (req, res, ctx) => {
    let back = '/r/moot';
    if (ctx.matter) {
      const s = ctx.kernel.scope(ctx.matter.id);
      const c = s.get('critique', String(ctx.body.id || ''));
      if (c) {
        const status = c.status === 'resolved' ? 'open' : 'resolved';
        s.put('critique', { ...c, status });
        back += '?d=' + encodeURIComponent(c.draftId);
        ctx.setFlash(status === 'resolved' ? 'Attack marked resolved — the response on the record is the answer.' : 'Attack reopened.');
      }
    }
    redirect(res, back);
  });
  app.route('POST', `/r/${ROOM.id}/ai-policy`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const k = ctx.kernel;
    const m2 = k.firm.get('matter', ctx.matter.id);
    if (!m2) { ctx.setFlash('Matter unavailable.', 'err'); redirect(res, '/r/moot'); return; }
    const policy = ctx.body.policy === 'forbidden' ? 'forbidden' : 'allowed';
    k.firm.put('matter', { ...m2, aiPolicy: policy });
    k.audit('matter.aiPolicy', ctx.matter.id + ':' + policy);
    ctx.setFlash(policy === 'forbidden' ? 'Model use forbidden on this matter — the gateway will refuse.' : 'Model use allowed on this matter.');
    redirect(res, '/r/moot' + (ctx.body.draftId ? '?d=' + encodeURIComponent(String(ctx.body.draftId)) : ''));
  });

  app.route('POST', `/r/${ROOM.id}/ai-oppose`, async (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/moot'); return; }
    const k = ctx.kernel;
    const s = k.scope(ctx.matter.id);
    const draftId = String(ctx.body.draftId || '');
    const d = draftId ? s.get('draft', draftId) : null;
    if (!d) { ctx.setFlash('Pick a draft first.', 'err'); redirect(res, '/r/moot'); return; }
    const back = '/r/moot?d=' + encodeURIComponent(d.id);
    const sections = Object.entries(d.sections || {}).map(([k2, v]) => v ? `## ${k2}\n${v}` : '').filter(Boolean).join('\n\n');
    if (!sections.trim()) { ctx.setFlash('That draft has no content to attack yet.', 'err'); redirect(res, back); return; }
    const out = await k.ai.chat(ctx.matter.id, [
      { role: 'system', content: 'You are opposing counsel of the highest calibre. Write the strongest, most specific attack on the draft argument you are given: identify the weakest factual assertions, the doctrinal gaps, the authority that likely cuts the other way (describe it by doctrine — do NOT fabricate citations), and the three questions a hot bench would ask. Be ruthless and concrete. End with the single most dangerous vulnerability.' },
      { role: 'user', content: sections.slice(0, 24000) },
    ]);
    if (!out.ok) { ctx.setFlash('Model: ' + out.message, 'err'); redirect(res, back); return; }
    s.put('oppositionDraft', { draftId: d.id, text: out.text, model: out.model });
    ctx.setFlash('Opposition draft generated — model-tagged, on the record. Convert what survives your judgment into logged attacks.');
    redirect(res, back);
  });

  app.route('POST', `/r/${ROOM.id}/drill`, (req, res, ctx) => {
    let back = '/r/moot';
    if (ctx.matter) {
      const s = ctx.kernel.scope(ctx.matter.id);
      const q = s.get('benchQ', String(ctx.body.id || ''));
      if (q) { s.put('benchQ', { ...q, drilled: !q.drilled }); back += '?d=' + encodeURIComponent(q.draftId); }
    }
    redirect(res, back);
  });
}

module.exports = { ...ROOM, register };
