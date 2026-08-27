'use strict';
// Room 37 — Counsel Panel. One mind that knows every syllabus; three that
// advise what to do with what it knows.
//
// A question asked here fans out through the model gateway as FOUR charges:
//   1. DOCTRINE  — senior counsel across the whole bar syllabus states the
//                  governing law the question touches, every area at once.
//   2. STRATEGY  — takes the doctrine and advises what to DO procedurally:
//                  next steps, motions, sequencing, leverage, timing.
//   3. RISK      — takes the doctrine and advises on exposure and settlement:
//                  ranges, cost against recovery, offer posture, what breaks.
//   4. CLIENT    — takes the doctrine and advises on duties and the client:
//                  professional responsibility, what to tell them, when.
// The three advisers do not re-derive the law; each is handed the doctrine
// brief and charged with a different answer to "so what do we do".
//
// What this room is NOT: an attorney. The panel prepares the licensee; the
// licensee advises the client. Every authority the panel names is UNVERIFIED
// until it clears the Citation Check gate (room 08), and the page says so on
// every panel. Model use is policy-checked per matter and audited per call —
// matter content leaves the building only through the gateway's one door.
const { layout, esc, empty, tag, textarea, kv } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 37, id: 'counsel', title: 'Counsel Panel', phase: 'Always on' };

const CHARGES = [
  { lens: 'doctrine', title: 'The law — every syllabus at once', maxTokens: 1600,
    system: 'You are senior counsel with complete command of every subject on the bar syllabus — limitations, procedure, evidence, contracts, torts, property, remedies, professional responsibility, and the rest. State the governing Ontario/Canadian law that the question touches, across EVERY relevant area at once, organised by area. Name leading authorities by case name and doctrine, and treat every citation you name as UNVERIFIED — where you are not certain an authority exists, describe the doctrine and write "authority to be verified" instead of guessing. Do not fabricate. Do not advise what to do; state what the law IS.' },
  { lens: 'strategy', title: 'Strategy — what to do with it', maxTokens: 1000,
    system: 'You are a litigation strategist. You are handed a question and a doctrine brief. Advise what to DO: the concrete next steps in order, the motions or procedural tools available, sequencing and timing against the limitation and procedural clocks, and where the leverage is. Be specific and decisive; flag anything in the doctrine brief that changes the plan if it turns out wrong.' },
  { lens: 'risk', title: 'Risk & settlement — what it is worth', maxTokens: 1000,
    system: 'You are a risk and settlement adviser. You are handed a question and a doctrine brief. Advise on exposure and resolution: the realistic range of outcomes, cost against recovery, how a Rule 49 offer changes the calculus and when to make one, and the two or three ways this most plausibly goes wrong. Numbers and ranges where possible; name your assumptions.' },
  { lens: 'client', title: 'Client & duty — what to tell them', maxTokens: 1000,
    system: 'You are an adviser on professional duty and the client relationship. You are handed a question and a doctrine brief. Advise the lawyer on their duties here — confidentiality, conflicts, candour, trust money if it arises — what the client needs to be told and when, what requires informed written consent or instructions, and what belongs in the file to evidence the advice. Practical and blunt.' },
];

const STALE_MS = 30 * 60 * 1000;

function benchWarning(ctx) {
  // Tie-in with /admin's competence bench: if the configured model has never
  // been benched — or failed — say so where the advice appears, not just where
  // the admin configures it.
  const c = ctx.kernel.ai.config();
  if (!c || !c.endpoint || !c.model) return '';
  const b = ctx.kernel.firm.get('setting', 'bench');
  const current = b && b.model === c.model && b.endpoint === c.endpoint;
  if (current && b.status === 'done' && b.passed) return '';
  const msg = current && b.status === 'done'
    ? `The configured model FAILED the competence bench (${esc(String(b.pct))}% against a ${esc(String(b.passLine))}% line). Its answers below cost more time than they save.`
    : 'The configured model has never passed the competence bench. Bench it at /admin before leaning on this panel.';
  return `<p>${tag('model unbenched', 'gate')} ${msg}</p>`;
}

function renderPanel(p) {
  const running = p.status === 'running' && (Date.now() - (p.startedAt || 0)) < STALE_MS;
  const head = kv([
    ['Question', esc(p.question)],
    ['Status', running ? tag('panel deliberating — refresh', '') : p.status === 'done' ? tag('complete', 'ok') : tag(p.status === 'running' ? 'abandoned (server restarted mid-panel) — ask again' : 'failed', 'gate')],
    ['Model', `<span class="num">${esc(p.model || '')}</span>${p.finishedAt ? ' · ' + esc(String(p.finishedAt).slice(0, 16).replace('T', ' ')) : ''}`],
  ]);
  if (p.status === 'failed') return `<div class="card">${head}<p class="note">${esc(p.error || 'The gateway refused.')}</p></div>`;
  if (running || p.status === 'running') return `<div class="card">${head}</div>`;
  const sections = (p.sections || []).map((s) => `
    <h2 class="sec">${esc(s.title)}</h2>
    <div style="white-space:pre-wrap">${esc(s.text)}</div>`).join('');
  return `<div class="card">${head}
    <p>${tag('UNVERIFIED — preparation material for counsel, not advice', 'gate')}</p>
    ${sections}
    <p class="note">The panel prepares the lawyer; the lawyer advises the client. Every authority named above is unverified until it clears Citation Check (room 08) — the four-point human verification applies to anything that leaves this page.</p>
  </div>`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const render = (body) => html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'One mind for the law, three for what to do with it', body }));
    if (!ctx.matter) { render(empty('Open a matter to convene its panel.')); return; }
    const k = ctx.kernel;
    const enabled = k.ai.enabled();
    const panels = k.scope(ctx.matter.id).list('counselPanel')
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const form = enabled ? `
      <div class="card"><h2 class="sec" style="margin-top:0">Convene the panel</h2>
      ${benchWarning(ctx)}
      <form method="POST" action="/r/${ROOM.id}/ask">
        ${textarea('question', 'The question on this matter', { rows: 4, required: true, placeholder: 'e.g. Our client was served with a defence and counterclaim yesterday — what does the law require of us now, and what should we do first?' })}
        <button>Ask — doctrine brief, then strategy, risk and duty</button>
      </form>
      <p class="note">Four model calls through the gateway, each audited and policy-checked against this matter. The doctrine brief states the law across every area the question touches; the three advisers each take that brief and answer "so what do we do" from a different chair.</p></div>`
      : `<div class="card">${empty('The model gateway is off — an administrator configures an endpoint at /admin. Nothing in this room works without it, by design: the panel has no knowledge of its own.')}</div>`;
    render(form + (panels.length ? panels.map(renderPanel).join('') : ''));
  });

  app.route('POST', `/r/${ROOM.id}/ask`, (req, res, ctx) => {
    const back = `/r/${ROOM.id}`;
    if (!ctx.matter) { redirect(res, back); return; }
    const k = ctx.kernel;
    if (!k.ai.enabled()) { ctx.setFlash('Configure the model gateway at /admin first.', 'err'); redirect(res, back); return; }
    const question = String(ctx.body.question || '').trim().slice(0, 8000);
    if (!question) { ctx.setFlash('Ask a question.', 'err'); redirect(res, back); return; }
    const s = k.scope(ctx.matter.id);
    const cfg = k.ai.config();
    const rec = s.put('counselPanel', { question, status: 'running', startedAt: Date.now(), model: cfg.model, sections: [] });
    const matterId = ctx.matter.id;
    const context = `Matter: ${ctx.matter.title} (${ctx.matter.jurisdiction || 'on'}, posture: ${ctx.matter.posture || 'unspecified'}).\n\nQuestion from counsel:\n${question}`;
    // Fire-and-forget, like the bench: four sequential calls against a local
    // model can take minutes and a room POST must not hang for them. Each call
    // still goes through k.ai.chat, so per-call policy checks and audit entries
    // apply — matter content is leaving the building, and the chain must say so.
    (async () => {
      const sections = [];
      let doctrine = '';
      for (const c of CHARGES) {
        const user = c.lens === 'doctrine' ? context
          : `${context}\n\nThe doctrine brief you are advising on:\n${doctrine.slice(0, 20000)}`;
        const out = await k.ai.chat(matterId, [
          { role: 'system', content: c.system },
          { role: 'user', content: user },
        ], { maxTokens: c.maxTokens, temperature: 0.3 });
        if (!out.ok) { s.put('counselPanel', { ...rec, id: rec.id, status: 'failed', error: out.message, finishedAt: new Date().toISOString() }); return; }
        sections.push({ lens: c.lens, title: c.title, text: out.text });
        if (c.lens === 'doctrine') doctrine = out.text;
      }
      s.put('counselPanel', { ...rec, id: rec.id, status: 'done', sections, finishedAt: new Date().toISOString() });
    })().catch((e) => {
      try { s.put('counselPanel', { ...rec, id: rec.id, status: 'failed', error: String(e.message || e), finishedAt: new Date().toISOString() }); } catch (_) { /* shredded mid-run */ }
    });
    ctx.setFlash('Panel convened — four charges through the gateway. Refresh in a minute or two.');
    redirect(res, back);
  });
}

module.exports = { ...ROOM, register };
