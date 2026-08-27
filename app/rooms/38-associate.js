'use strict';
// Room 38 — the Associate's Office. Where the firm's AI junior lives and
// practices out of.
//
// The office turns the model gateway from a feature into a colleague with a
// door you can knock on: lawyers hand assignments down (draft this, research
// that, summarize the other), the associate works them through the gateway's
// one audited door, and everything comes back as UNVERIFIED work product that
// a lawyer must review — accepted drafting registers straight into the
// Citation Check gate (room 08), exactly as a pleading does via /tocite.
//
// The professional posture is structural, not decorative:
//   - The associate is NOT CALLED until the configured model has PASSED the
//     competence bench (/admin) — the office refuses new assignments until the
//     exact current model+endpoint holds a passing score. Chambers' own bar,
//     actually gating practice.
//   - Matter access is bounded like everyone else's: walls throw before any
//     key unwrap, and a matter whose data-handling policy forbids model use
//     refuses the assignment before a byte leaves the building.
//   - Nothing here files, certifies, or verifies its own citations. Accepted
//     work lands citeStatus:'unchecked'; the four-point human verification in
//     room 08 is the only path to clearance.
// The lawyer decides what to hand down: the prompt carries the matter's name
// and the written instructions ONLY — the office never scrapes the file into
// the model on its own.
const { layout, esc, empty, tag, input, textarea, select, kv } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 38, id: 'associate', title: "Associate's Office", phase: 'Always on' };

const STALE_MS = 30 * 60 * 1000;

const KINDS = [
  ['draft', 'Draft a document'],
  ['research', 'Research a question'],
  ['summarize', 'Summarize material'],
];

const CHARGE = {
  draft: { maxTokens: 1800, system:
    'You are a junior associate at a two-lawyer Toronto litigation firm, drafting to instructions from a supervising lawyer. Produce the requested document in full, in plain professional prose, ready for the lawyer to edit. Where a fact is missing, write [INSTRUCTIONS NEEDED: ...] rather than inventing one. Treat every authority you name as UNVERIFIED: if you are not certain a case exists, describe the doctrine and write "authority to be verified" instead of citing. Never fabricate a citation.' },
  research: { maxTokens: 1600, system:
    'You are a junior associate at a two-lawyer Toronto litigation firm, answering a research question from a supervising lawyer. State the governing Ontario/Canadian law, organised by issue, with the leading authorities you believe apply — and treat every citation as UNVERIFIED: where you are not certain an authority exists, describe the doctrine and write "authority to be verified". Distinguish settled law from your inference, name what you are unsure of, and end with the two or three things the lawyer should check first. Never fabricate.' },
  summarize: { maxTokens: 1400, system:
    'You are a junior associate at a two-lawyer Toronto litigation firm, summarizing material handed to you by a supervising lawyer. Produce a faithful, structured summary: what the material says, what matters for the litigation, and anything surprising or missing. Do not editorialize beyond that, do not invent content that is not in the material, and mark anything ambiguous as ambiguous.' },
};

// The bar-admission check. The associate practices ONLY when the exact
// currently-configured model+endpoint holds a passing bench score — same
// currency rule as /admin and room 37: a score for yesterday's model says
// nothing about today's.
function standing(ctx) {
  const c = ctx.kernel.ai.config();
  if (!c || !c.endpoint || !c.model) return { called: false, why: 'The model gateway is off — an administrator configures an endpoint at /admin. The office has no occupant without it.' };
  const b = ctx.kernel.firm.get('setting', 'bench');
  const current = b && b.model === c.model && b.endpoint === c.endpoint;
  if (current && b.status === 'done' && b.passed) return { called: true, model: c.model, bench: b };
  return {
    called: false, model: c.model, bench: current ? b : null,
    why: current && b.status === 'done'
      ? `The configured model FAILED the competence bench (${b.pct}% against a ${b.passLine}% line). The office is closed to new work until a model passes.`
      : 'The configured model has never passed the competence bench. Bench it at /admin — the associate is not called until it passes the Chambers bar.',
  };
}

function statusPill(a) {
  const working = a.status === 'working' && (Date.now() - (a.startedAt || 0)) < STALE_MS;
  if (working) return tag('working — refresh', '');
  if (a.status === 'working') return tag('abandoned (server restarted) — assign again', 'gate');
  if (a.status === 'queued') return tag('queued', '');
  if (a.status === 'returned') return tag('returned — awaiting review', 'navy');
  if (a.status === 'accepted') return tag('accepted', 'ok');
  if (a.status === 'declined') return tag('declined', 'gate');
  return tag('failed', 'gate');
}

function renderAssignment(a, roomUrl) {
  const head = kv([
    ['Assignment', esc(a.title)],
    ['Kind', esc(a.kind)],
    ['Status', statusPill(a)],
    ['Model', `<span class="num">${esc(a.model || '')}</span>${a.finishedAt ? ' · ' + esc(String(a.finishedAt).slice(0, 16).replace('T', ' ')) : ''}`],
  ]);
  let body = '';
  if (a.status === 'failed') body = `<p class="note">${esc(a.error || 'The gateway refused.')}</p>`;
  if (a.status === 'queued') body = `
    <form method="POST" action="${roomUrl}/work"><input type="hidden" name="id" value="${esc(a.id)}"><button>Have the associate take this up now</button></form>`;
  if (a.status === 'returned') body = `
    <p>${tag('UNVERIFIED work product — not legal advice until a lawyer adopts it', 'gate')}</p>
    <div style="white-space:pre-wrap">${esc(a.output || '')}</div>
    <form method="POST" action="${roomUrl}/review" style="margin-top:10px">
      <input type="hidden" name="id" value="${esc(a.id)}">
      ${input('reviewNote', 'Review note (kept on the assignment)', { placeholder: 'e.g. usable with edits; limitation analysis needs the discovery date checked' })}
      <button name="verdict" value="accept">Accept — register for citation check</button>
      <button name="verdict" value="decline" class="danger">Decline</button>
    </form>`;
  if (a.status === 'accepted') body = `
    <p class="note">Accepted by ${esc(a.reviewedBy || '')}${a.reviewNote ? ' — ' + esc(a.reviewNote) : ''}. Registered in Citation Check (room 08) as an unchecked draft: scan and verify there before anything leaves the building.</p>`;
  if (a.status === 'declined') body = `<p class="note">Declined${a.reviewNote ? ' — ' + esc(a.reviewNote) : ''}. The output is kept for the file.</p>
    <details><summary class="note">Declined output</summary><div style="white-space:pre-wrap">${esc(a.output || '')}</div></details>`;
  return `<div class="card">${head}${body}</div>`;
}

function register(app) {
  const roomUrl = `/r/${ROOM.id}`;

  app.route('GET', roomUrl, (req, res, ctx) => {
    const render = (body) => html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The firm’s AI junior — supervised, gated, and only as good as its last bench', body }));
    if (!ctx.matter) { render(empty('Open a matter — the associate is briefed per file, never across the firm.')); return; }
    const k = ctx.kernel;
    const st = standing(ctx);
    const assignments = k.scope(ctx.matter.id).list('assignment')
      .sort((a, b) => (b.startedAt || Date.parse(b.createdAt || 0) || 0) - (a.startedAt || Date.parse(a.createdAt || 0) || 0));
    const awaiting = assignments.filter((a) => a.status === 'returned').length;

    // The name plate: who practices here, and on what standing.
    const plate = `<div class="card"><h2 class="sec" style="margin-top:0">The occupant</h2>
      ${kv([
        ['Occupant', st.model ? `<span class="num">${esc(st.model)}</span> — the firm’s AI junior associate` : '—'],
        ['Standing', st.called
          ? tag(`called to the Chambers bar — bench ${st.bench.pct}% (line ${st.bench.passLine}%)`, 'ok')
          : tag('NOT CALLED — office closed to new work', 'gate')],
        ['Supervision', awaiting
          ? tag(`${awaiting} returned item${awaiting > 1 ? 's' : ''} awaiting your review`, 'navy')
          : 'nothing awaiting review'],
      ])}
      ${st.called ? '' : `<p class="note">${esc(st.why)}</p>`}
      <p class="note">Office rules: the associate drafts, researches and summarizes to written instructions; it never files, never certifies, never verifies its own citations, and never sees a walled matter. Everything it returns is unverified work product until a lawyer reviews it — accepted drafting goes to Citation Check (room 08) with its gate unchecked. Every model call is audited, and a matter whose data-handling policy forbids model use refuses the assignment before anything leaves the building.</p></div>`;

    const desk = st.called ? `<div class="card"><h2 class="sec" style="margin-top:0">Hand down an assignment</h2>
      <form method="POST" action="${roomUrl}/assign">
        ${input('title', 'Assignment', { required: true, placeholder: 'e.g. First draft — demand letter to Ridgeline re unpaid invoices' })}
        <span>${select('kind', 'Kind', KINDS, 'draft')}</span>
        ${textarea('instructions', 'Instructions — everything the associate may rely on goes here', { rows: 6, required: true, placeholder: 'The associate is briefed ONLY on what you write here (plus the matter name). Paste the facts, the ask, and any material to work from.' })}
        <button>Assign</button>
      </form>
      <p class="note">One model call through the gateway per assignment, audited against this matter. The associate is briefed only on these instructions — it does not read the file on its own.</p></div>` : '';

    render(plate + desk + (assignments.length ? assignments.map((a) => renderAssignment(a, roomUrl)).join('') : ''));
  });

  app.route('POST', `${roomUrl}/assign`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, roomUrl); return; }
    const st = standing(ctx);
    // The bar-admission gate. Not a warning — a refusal.
    if (!st.called) { ctx.setFlash(st.why, 'err'); redirect(res, roomUrl); return; }
    const title = String(ctx.body.title || '').trim().slice(0, 300);
    const instructions = String(ctx.body.instructions || '').trim().slice(0, 24000);
    const kind = CHARGE[ctx.body.kind] ? ctx.body.kind : 'draft';
    if (!title || !instructions) { ctx.setFlash('An assignment needs a title and instructions.', 'err'); redirect(res, roomUrl); return; }
    ctx.kernel.scope(ctx.matter.id).put('assignment', { title, kind, instructions, status: 'queued', model: st.model });
    ctx.setFlash('Assigned. Take it up from the docket when ready — the associate works one file at a time.');
    redirect(res, roomUrl);
  });

  app.route('POST', `${roomUrl}/work`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, roomUrl); return; }
    const k = ctx.kernel;
    const st = standing(ctx);
    if (!st.called) { ctx.setFlash(st.why, 'err'); redirect(res, roomUrl); return; }
    const s = k.scope(ctx.matter.id);
    const a = s.list('assignment').find((x) => x.id === ctx.body.id && x.status === 'queued');
    if (!a) { ctx.setFlash('That assignment is not queued.', 'err'); redirect(res, roomUrl); return; }
    const rec = s.put('assignment', { ...a, id: a.id, status: 'working', startedAt: Date.now(), model: st.model });
    const matterId = ctx.matter.id;
    const charge = CHARGE[a.kind] || CHARGE.draft;
    const user = `Matter: ${ctx.matter.title} (${ctx.matter.jurisdiction || 'on'}).\n\nAssignment: ${a.title}\n\nInstructions from the supervising lawyer:\n${a.instructions}`;
    // Fire-and-forget, the room-37 pattern: a local model can take minutes and
    // a room POST must not hang for it. The call goes through k.ai.chat, so the
    // per-matter policy check runs before any network and the audit chain
    // records that matter content left through the gateway's one door.
    (async () => {
      const out = await k.ai.chat(matterId, [
        { role: 'system', content: charge.system },
        { role: 'user', content: user },
      ], { maxTokens: charge.maxTokens, temperature: 0.3 });
      if (!out.ok) { s.put('assignment', { ...rec, id: rec.id, status: 'failed', error: out.message, finishedAt: new Date().toISOString() }); return; }
      s.put('assignment', { ...rec, id: rec.id, status: 'returned', output: out.text, finishedAt: new Date().toISOString() });
    })().catch((e) => {
      try { s.put('assignment', { ...rec, id: rec.id, status: 'failed', error: String(e.message || e), finishedAt: new Date().toISOString() }); } catch (_) { /* shredded mid-run */ }
    });
    ctx.setFlash('The associate has taken it up — refresh in a minute.');
    redirect(res, roomUrl);
  });

  app.route('POST', `${roomUrl}/review`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, roomUrl); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const a = s.list('assignment').find((x) => x.id === ctx.body.id && x.status === 'returned');
    if (!a) { ctx.setFlash('That item is not awaiting review.', 'err'); redirect(res, roomUrl); return; }
    const note = String(ctx.body.reviewNote || '').trim().slice(0, 2000);
    const stamp = { reviewedBy: ctx.user.name || ctx.user.email, reviewedAt: new Date().toISOString(), reviewNote: note };

    if (ctx.body.verdict !== 'accept') {
      s.put('assignment', { ...a, id: a.id, status: 'declined', ...stamp });
      ctx.setFlash('Declined — kept on the assignment for the file.');
      redirect(res, roomUrl); return;
    }

    // Accepting adopts the text as a working document — which is exactly when
    // its citations become dangerous. Register it into the Citation Check gate
    // the same way 10-pleadings' /tocite does: find-or-create the draft, reset
    // the gate on re-accept so stale clearance cannot survive new text. ALL
    // kinds register — a research memo's invented authority is as lethal as a
    // pleading's (Ko v. Li is the whole reason the gate exists).
    const existing = s.list('draft').find((d) => d.assignmentId === a.id);
    const draft = existing
      ? s.put('draft', { ...existing, id: existing.id, title: a.title, text: a.output, citeStatus: 'unchecked', scannedAt: null, status: 'draft' })
      : s.put('draft', { title: a.title, type: a.kind === 'draft' ? 'associate-draft' : 'associate-memo', text: a.output, status: 'draft', citeStatus: 'unchecked', assignmentId: a.id });
    s.put('assignment', { ...a, id: a.id, status: 'accepted', draftId: draft.id, ...stamp });
    ctx.kernel.audit('associate.accepted', ctx.matter.id + ':' + a.id);
    ctx.setFlash('Accepted and registered in Citation Check (room 08) — scan it there; nothing clears without the four-point human verification.');
    redirect(res, roomUrl);
  });
}

module.exports = { ...ROOM, register };
