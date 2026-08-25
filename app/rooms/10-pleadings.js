'use strict';
// Room 10 — Pleadings. Element-to-fact coverage: a cause of action is only as
// good as the facts pleaded under each element. Unsupported elements get flagged
// before the other side's motion to strike does it for you.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 10, id: 'pleadings', title: 'Pleadings', phase: 'Build' };

const SUB = 'Element-to-fact coverage — plead facts, not conclusions';

// Reference element sets — real, labeled reference data (see kernel/rules.js style).
// Citations are to the leading statements of each test; contract elements carry
// no single leading citation and are labeled as the standard formulation.
const CAUSES = [
  {
    id: 'on-negligence', jur: 'ON', label: 'Negligence (Ontario)',
    ref: 'Mustapha v. Culligan of Canada Ltd., 2008 SCC 27 at para 3',
    elements: [
      { key: 'duty', label: 'Duty of care' },
      { key: 'breach', label: 'Breach of the standard of care' },
      { key: 'causation', label: 'Causation — in fact and in law' },
      { key: 'damage', label: 'Damage' },
    ],
  },
  {
    id: 'on-contract', jur: 'ON', label: 'Breach of contract',
    ref: 'Standard common-law formulation — plead each element to facts',
    elements: [
      { key: 'contract', label: 'A binding contract' },
      { key: 'performance', label: 'Performance, or readiness and willingness to perform' },
      { key: 'breach', label: 'Breach by the defendant' },
      { key: 'damages', label: 'Damages flowing from the breach' },
    ],
  },
  {
    id: 'on-unjust-enrichment', jur: 'ON', label: 'Unjust enrichment',
    ref: "Garland v. Consumers' Gas Co., 2004 SCC 25 at para 30; Kerr v. Baranow, 2011 SCC 10",
    elements: [
      { key: 'enrichment', label: 'Enrichment of the defendant' },
      { key: 'deprivation', label: 'Corresponding deprivation of the plaintiff' },
      { key: 'no-juristic-reason', label: 'Absence of juristic reason for the enrichment' },
    ],
  },
  {
    id: 'us-negligence', jur: 'US', label: 'Negligence (US common law)',
    ref: 'Restatement (Second) of Torts § 281 (1965)',
    elements: [
      { key: 'duty', label: 'Duty' },
      { key: 'breach', label: 'Breach' },
      { key: 'causation', label: 'Causation' },
      { key: 'damages', label: 'Damages' },
    ],
  },
];

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body: empty('Open a matter to map its causes of action to the chronology.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const facts = s.list('fact').slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const causes = s.list('cause').slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const drafts = s.list('pleading').slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a cause of action</h2>
        <form method="POST" action="/r/pleadings/cause">
          ${select('set', 'Cause of action', CAUSES.map((c) => [c.id, `${c.label} — ${c.elements.length} elements`]))}
          <button>Add to matter</button>
        </form>
        <p class="note"><b>Reference element sets</b> — the four sets below ship as labeled reference data; the citations are to the leading statements of each test. Every element must eventually point at a sourced fact in the Chronology (room 06).</p>
        ${table(['Cause', 'Elements', 'Reference'], CAUSES.map((c) => [
          `${esc(c.label)} ${tag(c.jur)}`,
          c.elements.map((e) => esc(e.label)).join('<br>'),
          `<span class="note">${esc(c.ref)}</span>`,
        ]))}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Draft a pleading</h2>
        <form method="POST" action="/r/pleadings/draft">
          ${input('title', 'Title', { required: true, placeholder: 'Statement of Claim — draft 1' })}
          ${select('ptype', 'Type', [['claim', 'Claim'], ['defence', 'Defence']])}
          ${textarea('body', 'Body', { required: true, placeholder: 'Material facts, pleaded plainly. Evidence stays out; conclusions of law stay out.' })}
          <button>Save draft</button>
        </form>
        <p class="note">Drafts live in this matter's encrypted scope. The coverage matrix on the left tells you whether the claim you are drafting can survive its first motion.</p>
      </div>
    </div>
    <h2 class="sec">Coverage — ${esc(ctx.matter.title)}</h2>
    ${causes.length ? causes.map((c) => causeSection(c, facts)).join('') : empty('No causes of action on this matter yet. Add one above, then map each element to chronology facts.')}
    <h2 class="sec">Pleading drafts</h2>
    ${drafts.length ? table(['Title', 'Type', 'Saved', 'Body', ''], drafts.map((d) => [
      esc(d.title),
      d.ptype === 'defence' ? tag('defence') : tag('claim', 'navy'),
      date(d.createdAt),
      `<span class="note">${esc(String(d.body || '').slice(0, 160))}${String(d.body || '').length > 160 ? '…' : ''}</span>`,
      `<form method="POST" action="/r/pleadings/deldraft" style="display:inline"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form>`,
    ])) : empty('No pleading drafts yet.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });

  app.route('POST', `/r/${ROOM.id}/cause`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/pleadings'); return; }
    const set = CAUSES.find((c) => c.id === ctx.body.set);
    if (!set) { ctx.setFlash('Pick a cause of action from the reference list.', 'err'); redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    if (s.list('cause').some((c) => c.setId === set.id)) {
      ctx.setFlash(`${set.label} is already on this matter — map its elements below.`, 'err');
      redirect(res, '/r/pleadings'); return;
    }
    s.put('cause', {
      setId: set.id, label: set.label, jur: set.jur, ref: set.ref,
      elements: set.elements.map((e) => ({ ...e })), mapping: {},
    });
    ctx.setFlash(`${set.label} added — ${set.elements.length} elements, none supported yet.`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/delcause`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const c = ctx.body.id ? s.get('cause', ctx.body.id) : null;
    if (!c) { ctx.setFlash('Cause not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    s.del('cause', c.id);
    ctx.setFlash(`${c.label} removed from the matter.`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/link`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const c = ctx.body.cause ? s.get('cause', ctx.body.cause) : null;
    if (!c) { ctx.setFlash('Cause not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    const el = (c.elements || []).find((e) => e.key === ctx.body.element);
    if (!el) { ctx.setFlash('Pick an element of the cause.', 'err'); redirect(res, '/r/pleadings'); return; }
    const f = ctx.body.fact ? s.get('fact', ctx.body.fact) : null;
    if (!f) { ctx.setFlash('Pick a chronology fact — an element cannot rest on a fact that is not in the record.', 'err'); redirect(res, '/r/pleadings'); return; }
    const mapping = { ...(c.mapping || {}) };
    const ids = (mapping[el.key] || []).slice();
    if (ids.includes(f.id)) { ctx.setFlash('That fact is already mapped to this element.', 'err'); redirect(res, '/r/pleadings'); return; }
    ids.push(f.id);
    mapping[el.key] = ids;
    s.put('cause', { ...c, mapping });
    ctx.setFlash(`Mapped "${el.label}" to the fact of ${f.date} (${f.source}).`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/unlink`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const c = ctx.body.cause ? s.get('cause', ctx.body.cause) : null;
    if (!c) { ctx.setFlash('Cause not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    const mapping = { ...(c.mapping || {}) };
    const key = String(ctx.body.element || '');
    mapping[key] = (mapping[key] || []).filter((id) => id !== ctx.body.fact);
    s.put('cause', { ...c, mapping });
    ctx.setFlash('Fact unlinked from the element.');
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/draft`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/pleadings'); return; }
    const title = String(ctx.body.title || '').trim();
    const text = String(ctx.body.body || '').trim();
    if (!title || !text) { ctx.setFlash('A draft needs a title and a body.', 'err'); redirect(res, '/r/pleadings'); return; }
    const ptype = ctx.body.ptype === 'defence' ? 'defence' : 'claim';
    ctx.kernel.scope(ctx.matter.id).put('pleading', { title, ptype, body: text });
    ctx.setFlash(`Draft ${ptype} saved: ${title}.`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/deldraft`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const d = ctx.body.id ? s.get('pleading', ctx.body.id) : null;
    if (!d) { ctx.setFlash('Draft not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    s.del('pleading', d.id);
    ctx.setFlash('Draft dropped.');
    redirect(res, '/r/pleadings');
  });
}

// One cause of action: its element × support matrix plus the mapping form.
function causeSection(c, facts) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const elements = c.elements || [];
  const mapping = c.mapping || {};
  const supportFor = (el) => (mapping[el.key] || []).map((id) => byId.get(id)).filter(Boolean);
  const supported = elements.filter((el) => supportFor(el).length).length;
  const full = elements.length > 0 && supported === elements.length;

  const rows = elements.map((el) => {
    const sup = supportFor(el);
    return [
      esc(el.label),
      sup.length ? sup.map((f) => `
        ${date(f.date)} ${esc(String(f.text || '').slice(0, 90))}${String(f.text || '').length > 90 ? '…' : ''} <span class="num">${esc(f.source || '')}</span>
        <form method="POST" action="/r/pleadings/unlink" style="display:inline"><input type="hidden" name="cause" value="${esc(c.id)}"><input type="hidden" name="element" value="${esc(el.key)}"><input type="hidden" name="fact" value="${esc(f.id)}"><button class="quiet" style="padding:2px 8px;margin-top:0">unlink</button></form>
      `).join('<br>') : '—',
      sup.length ? tag(`supported — ${sup.length} fact${sup.length === 1 ? '' : 's'}`, 'ok') : tag('no factual support yet', 'gate'),
    ];
  });

  const factOpts = facts.map((f) => [f.id, `${f.date || '????-??-??'} — ${String(f.text || '').slice(0, 70)} (${f.source || 'no pin'})`]);

  return `<div class="card">
    <h2 class="sec" style="margin-top:0">${esc(c.label)} ${tag(c.jur || '')} ${full ? tag(`all ${elements.length} elements supported`, 'ok') : tag(`${supported}/${elements.length} elements supported`, supported ? 'navy' : 'gate')}</h2>
    ${kv([['Reference', `<span class="note">${esc(c.ref || '')}</span>`]])}
    ${table(['Element', 'Supported by (chronology facts)', 'Coverage'], rows) || empty('This cause has no elements recorded.')}
    ${facts.length ? `
    <form method="POST" action="/r/pleadings/link">
      <input type="hidden" name="cause" value="${esc(c.id)}">
      <div class="grid2">
        <span>${select('element', 'Element', elements.map((e) => [e.key, e.label]))}</span>
        <span>${select('fact', 'Chronology fact', factOpts)}</span>
      </div>
      <button class="quiet" style="margin-top:12px">Map fact to element</button>
    </form>` : '<p class="note">No facts in the chronology yet — enter sourced facts in room 06 before mapping elements.</p>'}
    <form method="POST" action="/r/pleadings/delcause"><input type="hidden" name="id" value="${esc(c.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">remove cause</button></form>
  </div>`;
}

module.exports = { ...ROOM, register };
