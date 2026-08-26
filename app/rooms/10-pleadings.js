'use strict';
// Room 10 — Pleadings. Element-to-fact coverage: a cause of action is only as
// good as the facts pleaded under each element. Unsupported elements get flagged
// before the other side's motion to strike does it for you.
//
// Two sides of the pleading:
//   Claim side  — causes of action (plaintiff), each element mapped to chronology
//                 facts. Element sets start from a labelled reference tranche but
//                 are editable/extendable per matter, and you may build a wholly
//                 custom cause with your own elements for a jurisdiction we don't
//                 pre-load.
//   Defence side — affirmative defences (the WAIVER TRAP: unpleaded defences are
//                 lost), counterclaims and crossclaims. Counterclaims/crossclaims
//                 are themselves causes of action, so they carry the same
//                 element-to-fact coverage as the claim.
//
// The page opens on the answer to the only question this room exists to ask:
// which elements still have no fact behind them, and which defences are still
// unpleaded — reported before you serve rather than after the motion to strike.
// Everything below that queue is the working surface it links into.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 10, id: 'pleadings', title: 'Pleadings', phase: 'Build' };

const SUB = 'Element-to-fact coverage — plead facts, not conclusions; plead defences or waive them';

// Printing yields the register: the gap queue, the coverage matrices and the
// defence register. The shared base in kernel/html.js drops the chrome and every
// form; only the two things it cannot know are stated here.
const PRINT = `<style>@media print{
.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

// Reference element sets — real, labeled reference data (see kernel/rules.js style).
// Citations are to the leading statements of each test; contract elements carry
// no single leading citation and are labeled as the standard formulation. These
// are a STARTING POINT: once on a matter, elements can be added or removed, and a
// wholly custom cause can be built for any jurisdiction.
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

// Affirmative-defence reference tranche — real, labeled. Ontario matters that
// must be specifically pleaded (or risk taking the opposite party by surprise)
// under the Rules of Civil Procedure; the US enumerated list under Fed. R. Civ.
// P. 8(c)(1). All citations real; the list is a checklist, not legal advice.
const AFF_DEFENCES = {
  ON: {
    ref: 'Rules of Civil Procedure, R.R.O. 1990, Reg. 194, r. 25.07(4) — a party must specifically plead any matter that, if not pleaded, might take the opposite party by surprise',
    items: [
      { name: 'Limitation period expired', cite: 'Limitations Act, 2002, S.O. 2002, c. 24, Sch. B, s. 4' },
      { name: 'Contributory negligence', cite: 'Negligence Act, R.S.O. 1990, c. N.1, s. 3' },
      { name: 'Release / accord and satisfaction', cite: 'Rules of Civil Procedure, r. 25.07(4)' },
      { name: 'Payment', cite: 'Rules of Civil Procedure, r. 25.07(4)' },
      { name: 'Set-off', cite: 'Courts of Justice Act, R.S.O. 1990, c. C.43, s. 111' },
      { name: 'Illegality', cite: 'Rules of Civil Procedure, r. 25.07(4)' },
      { name: 'Fraud / misrepresentation (full particulars required)', cite: 'Rules of Civil Procedure, r. 25.06(8)' },
    ],
  },
  US: {
    ref: 'Fed. R. Civ. P. 8(c)(1) — affirmative defences a party must affirmatively state in a responsive pleading',
    items: ['accord and satisfaction', 'arbitration and award', 'assumption of risk', 'contributory negligence', 'duress', 'estoppel', 'failure of consideration', 'fraud', 'illegality', 'injury by fellow servant', 'laches', 'license', 'payment', 'release', 'res judicata', 'statute of frauds', 'statute of limitations', 'waiver']
      .map((n) => ({ name: n, cite: 'Fed. R. Civ. P. 8(c)(1)' })),
  },
};

const SIDES = { claim: 'Cause of action (claim)', counterclaim: 'Counterclaim', crossclaim: 'Crossclaim' };
// Short forms for headings and buttons — SIDES[..].toLowerCase() reads as
// "remove cause of action (claim)", which is not how anyone speaks.
const SIDE_SHORT = { claim: 'cause', counterclaim: 'counterclaim', crossclaim: 'crossclaim' };
const sideOf = (c) => (SIDES[c.side] ? c.side : 'claim');

// Which affirmative-defence reference set fits the matter's jurisdiction. US
// federal / New York use the FRCP list; everything else falls to the Ontario
// common-law tranche. Labelled so the user knows which corpus they are reading.
function defenceSetFor(jur) {
  const j = String(jur || '').toLowerCase();
  return (j.startsWith('us') || j === 'ny') ? { key: 'US', ...AFF_DEFENCES.US } : { key: 'ON', ...AFF_DEFENCES.ON };
}

// slug -> element key, unique within a cause's existing keys.
function elementKey(label, existing) {
  let base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'element';
  let key = base, i = 2;
  const taken = new Set(existing || []);
  while (taken.has(key)) { key = base + '-' + i; i++; }
  return key;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body: empty('Open a matter to map its causes of action to the chronology and register its defences.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const facts = s.list('fact').slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const causes = s.list('cause').slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const defences = s.list('affdefence').slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const drafts = s.list('pleading').slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    const bySide = (side) => causes.filter((c) => sideOf(c) === side);
    const claims = bySide('claim');
    const counters = bySide('counterclaim');
    const crosses = bySide('crossclaim');
    const dset = defenceSetFor(ctx.matter.jurisdiction);
    const unpleaded = defences.filter((d) => !d.pleaded);
    // Registered drafts, by the pleading they came from — so a row can say
    // where it stands at the citation gate instead of offering a blind button.
    const gateBy = new Map(s.list('draft', (d) => !!d.pleadingId).map((d) => [d.pleadingId, d]));

    // Counterclaims and crossclaims only get a section once one exists: three
    // empty boxes on a fresh matter say nothing the Side selector does not.
    const coverageGroup = (heading, list) => (list.length
      ? `<h2 class="sec">${esc(heading)}</h2>${list.map((c) => causeSection(c, facts)).join('')}`
      : '');

    const posture = [
      ['Jurisdiction', esc(ctx.matter.jurisdiction || '—')],
      ['Claim causes', causes.length || defences.length
        ? `<span class="num">${claims.length}</span> pleaded · <span class="num">${claims.filter(fullyCovered).length}</span> fully supported`
        : '<span class="note">none yet</span>'],
    ];
    if (counters.length) posture.push(['Counterclaims', `<span class="num">${counters.length}</span> · <span class="num">${counters.filter(fullyCovered).length}</span> fully supported`]);
    if (crosses.length) posture.push(['Crossclaims', `<span class="num">${crosses.length}</span> · <span class="num">${crosses.filter(fullyCovered).length}</span> fully supported`]);
    posture.push(['Affirmative defences', defences.length
      ? `<span class="num">${defences.length}</span> registered · <span class="num">${defences.length - unpleaded.length}</span> pleaded · <span class="num">${unpleaded.length}</span> not`
      : '<span class="note">none registered</span>']);

    const gaps = gapList(causes, defences);

    const body = PRINT + `
    <h2 class="sec" style="margin-top:0">Before you serve — ${esc(ctx.matter.title)} ${gaps.length
      ? tag(`${gaps.length} gap${gaps.length === 1 ? '' : 's'}`, 'gate')
      : (causes.length || defences.length ? tag('nothing outstanding', 'ok') : '')}</h2>
    <div class="card">
      ${kv(posture)}
      ${gaps.length ? `<div style="margin-top:14px">${table(['Where', 'What is missing', 'Risk', ''], gapRows(gaps))}</div>`
        : `<p class="note" style="margin-top:14px">${causes.length || defences.length
          ? 'Every pleaded element has a sourced fact behind it and every registered defence is marked pleaded. Re-check after any amendment.'
          : 'Nothing pleaded yet. Add the first cause of action below, then map each of its elements to a sourced chronology fact.'}</p>`}
      <form method="POST" action="/r/pleadings/register-export" style="display:inline">
        <button class="quiet" style="margin-top:14px">Export pleadings register (.txt)</button>
      </form>
    </div>

    ${claims.length ? `<h2 class="sec">Causes of action — claim</h2>${claims.map((c) => causeSection(c, facts)).join('')}`
      : `<h2 class="sec">Causes of action — claim</h2>${empty('No causes of action yet — add one below, then map each element to a sourced chronology fact. An element with nothing behind it is what a motion to strike goes after.')}`}

    <h2 class="sec" id="defences">Affirmative defences ${unpleaded.length
      ? tag(`${unpleaded.length} unpleaded — waiver risk`, 'gate')
      : (defences.length ? tag('all pleaded', 'ok') : '')}</h2>
    ${defencesSection(defences, dset, unpleaded.length)}

    ${coverageGroup('Counterclaims', counters)}
    ${coverageGroup('Crossclaims', crosses)}

    <div class="no-print">
      <h2 class="sec">Build the pleading</h2>
      <div class="grid2">
        <div class="card">
          <h2 class="sec" style="margin-top:0">Add a cause, counterclaim or crossclaim</h2>
          <form method="POST" action="/r/pleadings/cause">
            <div class="grid2">
              <span>${select('side', 'Side', Object.entries(SIDES).map(([v, t]) => [v, t]))}</span>
              <span>${input('against', 'Asserted against', { placeholder: 'Counterclaim / crossclaim only' })}</span>
            </div>
            ${select('set', 'Reference element set', [['', '— custom cause (build your own elements) —']].concat(CAUSES.map((c) => [c.id, `${c.label} (${c.jur}) — ${c.elements.length} elements`])))}
            <div class="grid2">
              <span>${input('customLabel', 'Custom cause label', { placeholder: 'Custom cause only' })}</span>
              <span>${input('customRef', 'Custom cause authority', { placeholder: 'Leading citation for the test' })}</span>
            </div>
            <button>Add to matter</button>
          </form>
          <p class="note">Reference element sets are labeled reference data carrying the citation to the leading statement of each test — a starting point, not the last word. Once added, each coverage card takes elements in or out so the set fits your jurisdiction and theory. A custom cause starts empty; add its elements on its card.</p>
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">Register an affirmative defence</h2>
          <form method="POST" action="/r/pleadings/defence">
            ${select('ref', `Reference defence (${esc(dset.key)})`, [['', '— custom defence —']].concat(dset.items.map((d) => [d.name, `${d.name} — ${d.cite}`])))}
            ${input('custom', 'Or a custom defence name', { placeholder: 'Only if not in the reference list' })}
            ${textarea('basis', 'Factual basis / particulars', { placeholder: 'The material facts that make this defence out. Fraud and misrepresentation require full particulars.' })}
            <button>Register defence</button>
          </form>
          <p class="note">Reference defences are drawn from ${esc(dset.ref)}. A checklist to defeat the waiver trap, not legal advice — confirm the authority and the pleading rule for your facts.</p>
        </div>
      </div>

      <div class="card">
        <h2 class="sec" style="margin-top:0">Draft a pleading</h2>
        <form method="POST" action="/r/pleadings/draft">
          <div class="grid2">
            <span>${input('title', 'Title', { required: true, placeholder: 'Statement of Claim — draft 1' })}</span>
            <span>${select('ptype', 'Type', [['claim', 'Claim'], ['defence', 'Defence'], ['counterclaim', 'Counterclaim'], ['crossclaim', 'Crossclaim']])}</span>
          </div>
          ${textarea('body', 'Body', { required: true, placeholder: 'Material facts, pleaded plainly. Evidence stays out; conclusions of law stay out.' })}
          <button>Save draft</button>
        </form>
        <p class="note">Drafts stay in this matter's encrypted scope. Send one to Citation Check (08) and every authority in it must be verified before Filing (22) will take it.</p>
      </div>
    </div>

    <h2 class="sec">Pleading drafts</h2>
    ${drafts.length ? table(['Title', 'Type', 'Saved', 'Citation gate', 'Body', ''], drafts.map((d) => {
      const g = gateBy.get(d.id);
      return [
        esc(d.title),
        d.ptype === 'claim' ? tag('claim', 'navy') : tag(String(d.ptype || 'claim')),
        date(d.createdAt),
        gateCell(g),
        `<span class="note">${esc(String(d.body || '').slice(0, 140))}${String(d.body || '').length > 140 ? '…' : ''}</span>`,
        `<span class="no-print"><form method="POST" action="/r/pleadings/tocite" style="display:inline"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet" style="padding:4px 10px;margin-top:0">${g ? 're-send to 08' : 'to citation check'}</button></form>`
        + `<form method="POST" action="/r/pleadings/deldraft" style="display:inline;margin-left:6px"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form></span>`,
      ];
    })) : empty('No pleading drafts yet — save one from the form above, then send it to Citation Check before it goes anywhere near the Filing Room.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });

  app.route('POST', `/r/${ROOM.id}/cause`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/pleadings'); return; }
    const side = SIDES[ctx.body.side] ? ctx.body.side : 'claim';
    const against = String(ctx.body.against || '').trim();
    if (side !== 'claim' && !against) {
      ctx.setFlash(`A ${SIDES[side].toLowerCase()} must name the party it is asserted against.`, 'err');
      redirect(res, '/r/pleadings'); return;
    }
    const s = ctx.kernel.scope(ctx.matter.id);
    let rec;
    const setId = String(ctx.body.set || '').trim();
    if (setId) {
      const set = CAUSES.find((c) => c.id === setId);
      if (!set) { ctx.setFlash('Pick a cause of action from the reference list, or build a custom one.', 'err'); redirect(res, '/r/pleadings'); return; }
      if (s.list('cause').some((c) => sideOf(c) === side && c.setId === set.id && (c.against || '') === against)) {
        ctx.setFlash(`${set.label} is already recorded as a ${SIDE_SHORT[side]} here — map its elements on its card.`, 'err');
        redirect(res, '/r/pleadings'); return;
      }
      rec = { setId: set.id, label: set.label, jur: set.jur, ref: set.ref, elements: set.elements.map((e) => ({ ...e })) };
    } else {
      const label = String(ctx.body.customLabel || '').trim();
      if (!label) { ctx.setFlash('A custom cause needs a label (or pick a reference element set).', 'err'); redirect(res, '/r/pleadings'); return; }
      const jur = String(ctx.matter.jurisdiction || '').toUpperCase() || '—';
      rec = {
        setId: null, label, jur,
        ref: String(ctx.body.customRef || '').trim() || 'Custom cause — counsel to supply the leading authority for each element',
        elements: [],
      };
    }
    s.put('cause', { ...rec, side, against, mapping: {} });
    ctx.setFlash(`${rec.label} added as a ${SIDE_SHORT[side]}${against ? ' against ' + against : ''} — ${rec.elements.length} element${rec.elements.length === 1 ? '' : 's'}, none supported yet. Map each one to a sourced fact.`);
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

  // Extend a cause's element set — the reference tranche is a starting point.
  app.route('POST', `/r/${ROOM.id}/addelement`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const c = ctx.body.cause ? s.get('cause', ctx.body.cause) : null;
    if (!c) { ctx.setFlash('Cause not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    const label = String(ctx.body.label || '').trim();
    if (!label) { ctx.setFlash('Give the new element a label.', 'err'); redirect(res, '/r/pleadings'); return; }
    const elements = (c.elements || []).slice();
    if (elements.some((e) => e.label.toLowerCase() === label.toLowerCase())) {
      ctx.setFlash('That element is already on this cause.', 'err'); redirect(res, '/r/pleadings'); return;
    }
    const key = elementKey(label, elements.map((e) => e.key));
    elements.push({ key, label });
    s.put('cause', { ...c, elements });
    ctx.setFlash(`Element "${label}" added to ${c.label} — map a fact to it.`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/delelement`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const c = ctx.body.cause ? s.get('cause', ctx.body.cause) : null;
    if (!c) { ctx.setFlash('Cause not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    const key = String(ctx.body.element || '');
    if (!(c.elements || []).some((e) => e.key === key)) { ctx.setFlash('Element not found on this cause.', 'err'); redirect(res, '/r/pleadings'); return; }
    const elements = (c.elements || []).filter((e) => e.key !== key);
    const mapping = { ...(c.mapping || {}) };
    delete mapping[key];
    s.put('cause', { ...c, elements, mapping });
    ctx.setFlash('Element removed from the cause.');
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

  // ---- Affirmative defences ----
  app.route('POST', `/r/${ROOM.id}/defence`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/pleadings'); return; }
    const dset = defenceSetFor(ctx.matter.jurisdiction);
    const custom = String(ctx.body.custom || '').trim();
    let name, cite;
    if (custom) {
      name = custom;
      cite = 'Custom defence — counsel to supply the authority and confirm it must be pleaded';
    } else {
      const picked = dset.items.find((d) => d.name === ctx.body.ref);
      if (!picked) { ctx.setFlash('Pick a reference defence or type a custom name.', 'err'); redirect(res, '/r/pleadings'); return; }
      name = picked.name; cite = picked.cite;
    }
    const s = ctx.kernel.scope(ctx.matter.id);
    if (s.list('affdefence').some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      ctx.setFlash(`"${name}" is already on the defence register.`, 'err'); redirect(res, '/r/pleadings'); return;
    }
    s.put('affdefence', { name, cite, basis: String(ctx.body.basis || '').trim(), pleaded: false });
    ctx.kernel.audit('pleadings.defence.register', ctx.matter.id + ':' + name);
    ctx.setFlash(`Affirmative defence registered: ${name}. Mark it pleaded once it is in the served defence — until then it is at risk of waiver.`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/defence-plead`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const d = ctx.body.id ? s.get('affdefence', ctx.body.id) : null;
    if (!d) { ctx.setFlash('Defence not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    const pleaded = !d.pleaded;
    s.put('affdefence', { ...d, pleaded });
    ctx.kernel.audit('pleadings.defence.' + (pleaded ? 'pleaded' : 'unpleaded'), ctx.matter.id + ':' + d.name);
    ctx.setFlash(pleaded ? `"${d.name}" marked pleaded — waiver risk cleared.` : `"${d.name}" back to unpleaded — waived if omitted from the served defence.`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/deldefence`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/pleadings'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const d = ctx.body.id ? s.get('affdefence', ctx.body.id) : null;
    if (!d) { ctx.setFlash('Defence not found.', 'err'); redirect(res, '/r/pleadings'); return; }
    s.del('affdefence', d.id);
    ctx.setFlash(`"${d.name}" removed from the defence register.`);
    redirect(res, '/r/pleadings');
  });

  app.route('POST', `/r/${ROOM.id}/draft`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/pleadings'); return; }
    const title = String(ctx.body.title || '').trim();
    const text = String(ctx.body.body || '').trim();
    if (!title || !text) { ctx.setFlash('A draft needs a title and a body.', 'err'); redirect(res, '/r/pleadings'); return; }
    const ptype = ['claim', 'defence', 'counterclaim', 'crossclaim'].includes(ctx.body.ptype) ? ctx.body.ptype : 'claim';
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

  // Export the whole pleadings register as a plain-text record for the file.
  app.route('POST', `/r/${ROOM.id}/register-export`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/pleadings'); return; }
    const s = k.scope(ctx.matter.id);
    const facts = s.list('fact');
    const causes = s.list('cause').slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const defences = s.list('affdefence').slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const text = registerText(ctx.matter, causes, defences, facts);
    k.audit('pleadings.register.export', ctx.matter.id);
    const slug = String(ctx.matter.title || 'matter').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'matter';
    const today = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="pleadings-register-${slug}-${today}.txt"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(text);
  });
  // A pleading cites authority like any other filing, but 08-citations only
  // scans 'draft' records — so registering one mints a draft carrying the
  // pleading's text in the R-B shape (status:'draft'), linked back by pleadingId.
  app.route('POST', `/r/${ROOM.id}/tocite`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const p = ctx.body.id ? s.get('pleading', String(ctx.body.id)) : null;
    if (!p) { ctx.setFlash('Pick a pleading to send.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const already = s.list('draft', (d) => d.pleadingId === p.id)[0];
    if (already) {
      // Re-sending replaces the text the gate was cleared against, so the gate
      // resets with it — same counter-current 18-briefs applies when a section
      // is edited: citeStatus back to unchecked, the scan stamp dropped, and a
      // draft that had reached 'final' demoted so 22-filing cannot take it on a
      // clearance that no longer describes the text.
      s.put('draft', {
        ...already, text: p.body, title: p.title, citeStatus: 'unchecked', scannedAt: null,
        status: already.status === 'final' ? 'draft' : (already.status || 'draft'),
      });
      ctx.setFlash(`Re-sent "${p.title}" to Citation Check — the citation gate is reset; open room 08 to extract and verify.`);
    } else {
      s.put('draft', { title: p.title, type: p.ptype || 'pleading', text: p.body, status: 'draft', citeStatus: 'unchecked', pleadingId: p.id });
      ctx.setFlash(`"${p.title}" registered in Citation Check — open room 08 to extract and verify its authorities.`);
    }
    ctx.kernel.audit('pleading.tocite', ctx.matter.id + ':' + p.id);
    redirect(res, `/r/${ROOM.id}`);
  });
}

function fullyCovered(c) {
  const els = c.elements || [];
  const mapping = c.mapping || {};
  return els.length > 0 && els.every((el) => (mapping[el.key] || []).length > 0);
}

// The queue the room exists for: every element with no fact behind it and every
// registered defence still unpleaded. A cause with no elements at all is its own
// gap — there is nothing to test the claim against. One pure pass, shared by the
// on-screen table and the exported register so the two can never disagree.
function gapList(causes, defences) {
  const out = [];
  for (const c of causes) {
    const els = c.elements || [];
    if (!els.length) { out.push({ kind: 'noelements', cause: c, label: '' }); continue; }
    const mapping = c.mapping || {};
    for (const el of els) if (!(mapping[el.key] || []).length) out.push({ kind: 'element', cause: c, label: el.label });
  }
  for (const d of defences) if (!d.pleaded) out.push({ kind: 'defence', cause: null, label: d.name });
  return out;
}

// The same list as table rows, each linking straight to the card that fixes it.
function gapRows(gaps) {
  return gaps.map((g) => {
    if (g.kind === 'defence') {
      return ['<a href="#defences">Affirmative defence</a>', esc(g.label), tag('waived if omitted', 'gate'), '<a href="#defences">mark pleaded →</a>'];
    }
    const c = g.cause;
    const where = `<a href="#c-${esc(c.id)}">${esc(c.label)}</a><div class="note">${esc(SIDES[sideOf(c)])}${c.against ? ' · against ' + esc(c.against) : ''}</div>`;
    return g.kind === 'noelements'
      ? [where, '<span class="note">no elements on this cause</span>', tag('nothing to test the claim against', 'gate'), `<a href="#c-${esc(c.id)}">add elements →</a>`]
      : [where, esc(g.label), tag('no fact behind it', 'gate'), `<a href="#c-${esc(c.id)}">map a fact →</a>`];
  });
}

// Where a pleading stands at the citation gate, read off the companion draft
// 08-citations actually scans. 'unchecked' means registered but not yet
// extracted; 'blocked' means an authority in it failed or is unverified.
function gateCell(g) {
  if (!g) return '<span class="note">not sent</span>';
  const st = String(g.citeStatus || 'unchecked');
  if (st === 'clear') return tag('cleared', 'ok') + (g.status === 'final' ? ' ' + tag('final', 'ok') : '');
  if (st === 'blocked') return tag('blocked — unverified cites', 'gate');
  return tag(st === 'none' ? 'gate reset by edit' : 'awaiting extraction', 'navy');
}

// One cause of action: its element × support matrix, element editing, and the
// mapping form. Used for claims, counterclaims and crossclaims alike.
function causeSection(c, facts) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const elements = c.elements || [];
  const mapping = c.mapping || {};
  const side = sideOf(c);
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
      `<span class="no-print"><form method="POST" action="/r/pleadings/delelement" style="display:inline"><input type="hidden" name="cause" value="${esc(c.id)}"><input type="hidden" name="element" value="${esc(el.key)}"><button class="quiet danger" style="padding:2px 8px;margin-top:0">drop</button></form></span>`,
    ];
  });

  const factOpts = facts.map((f) => [f.id, `${f.date || '????-??-??'} — ${String(f.text || '').slice(0, 70)} (${f.source || 'no pin'})`]);
  const sideTag = side === 'claim' ? tag('claim', 'navy') : tag(SIDES[side]);

  return `<div class="card" id="c-${esc(c.id)}">
    <h2 class="sec" style="margin-top:0">${esc(c.label)} ${tag(c.jur || '')} ${sideTag} ${!elements.length ? tag('no elements yet', 'gate')
      : full ? tag(`all ${elements.length} elements supported`, 'ok')
        : tag(`${supported}/${elements.length} elements supported`, supported ? 'navy' : 'gate')}</h2>
    ${kv([['Reference', `<span class="note">${esc(c.ref || '')}</span>`]].concat(c.against ? [['Asserted against', esc(c.against)]] : []))}
    ${table(['Element', 'Supported by (chronology facts)', 'Coverage', ''], rows)
      || empty('No elements on this cause yet — add the first one below. Until then there is nothing to test the claim against.')}
    <div class="no-print">
      <form method="POST" action="/r/pleadings/addelement" style="margin-top:10px">
        <input type="hidden" name="cause" value="${esc(c.id)}">
        ${input('label', 'Add an element', { placeholder: 'e.g. Reasonable reliance' })}
        <button class="quiet" style="margin-top:10px">Add element</button>
      </form>
      ${!elements.length ? ''
        : facts.length ? `
      <form method="POST" action="/r/pleadings/link" style="margin-top:12px">
        <input type="hidden" name="cause" value="${esc(c.id)}">
        <div class="grid2">
          <span>${select('element', 'Element', elements.map((e) => [e.key, e.label]))}</span>
          <span>${select('fact', 'Chronology fact', factOpts)}</span>
        </div>
        <button class="quiet" style="margin-top:12px">Map fact to element</button>
      </form>`
          : '<p class="note">No facts in the chronology yet — enter sourced facts in Chronology (06) before mapping elements. Source-or-drop applies there, so anything you map here already carries its pin.</p>'}
      <form method="POST" action="/r/pleadings/delcause"><input type="hidden" name="id" value="${esc(c.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:12px">remove this ${esc(SIDE_SHORT[side])}</button></form>
    </div>
  </div>`;
}

// The affirmative-defence register — the waiver-trap checklist. The waiver rule
// is the reason this register exists, so its citation stays on the page; the
// alarm colour is spent only when something is actually unpleaded.
function defencesSection(defences, dset, unpleaded) {
  const waiverCite = dset.key === 'US' ? 'Fed. R. Civ. P. 8(c)(1)' : 'Rules of Civil Procedure, r. 25.07(4)';
  const waiver = `An affirmative defence not raised in the statement of defence is waived — it cannot be run at trial (${esc(waiverCite)}).`;
  if (!defences.length) {
    return `<div class="card">${empty('No affirmative defences registered — register every one you may rely on, then mark each pleaded once it is in the served defence.')}
      <p class="note">${waiver} Reference set: ${esc(dset.ref)}.</p></div>`;
  }
  const rows = defences.map((d) => [
    esc(d.name),
    `<span class="note">${esc(d.cite || '')}</span>`,
    d.basis ? `<span class="note">${esc(String(d.basis).slice(0, 140))}${String(d.basis).length > 140 ? '…' : ''}</span>` : tag('no basis recorded', 'gate'),
    d.pleaded ? tag('pleaded', 'ok') : tag('not pleaded — waived if omitted', 'gate'),
    `<span class="no-print"><form method="POST" action="/r/pleadings/defence-plead" style="display:inline"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet" style="padding:2px 8px;margin-top:0">${d.pleaded ? 'unmark' : 'mark pleaded'}</button></form>
     <form method="POST" action="/r/pleadings/deldefence" style="display:inline;margin-left:6px"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet danger" style="padding:2px 8px;margin-top:0">drop</button></form></span>`,
  ]);
  return `${unpleaded ? `<div class="flash err" style="margin-bottom:16px"><b>Waiver trap.</b> ${waiver} ${unpleaded} registered defence${unpleaded === 1 ? ' is' : 's are'} not yet marked pleaded.</div>` : ''}
  <div class="card">
    ${table(['Defence', 'Authority', 'Basis', 'Status', ''], rows)}
    <p class="note">${unpleaded ? '' : `Every registered defence is marked pleaded. ${waiver} `}Reference set: ${esc(dset.ref)}. A checklist, not legal advice.</p>
  </div>`;
}

function registerText(matter, causes, defences, facts) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const lines = [];
  lines.push('PLEADINGS REGISTER');
  lines.push('Matter: ' + (matter.title || '') + '   Jurisdiction: ' + (matter.jurisdiction || '—'));
  lines.push('Generated: ' + new Date().toISOString());
  lines.push('This is a work-product register, not a pleading and not legal advice.');
  const gaps = gapList(causes, defences);
  const unpleaded = gaps.filter((g) => g.kind === 'defence').length;
  lines.push(gaps.length
    ? 'OUTSTANDING: ' + gaps.length + ' gap(s) — ' + (gaps.length - unpleaded) + ' element(s) with no factual support, '
      + unpleaded + ' defence(s) not pleaded.'
    : 'OUTSTANDING: none — every pleaded element carries a sourced fact and every registered defence is pleaded.');
  lines.push('');
  for (const side of ['claim', 'counterclaim', 'crossclaim']) {
    const list = causes.filter((c) => sideOf(c) === side);
    if (!list.length) continue;
    lines.push('== ' + SIDES[side].toUpperCase() + ' ==');
    for (const c of list) {
      lines.push('- ' + c.label + ' [' + (c.jur || '-') + ']' + (c.against ? ' against ' + c.against : ''));
      lines.push('  Reference: ' + (c.ref || ''));
      const mapping = c.mapping || {};
      const els = c.elements || [];
      if (!els.length) lines.push('    * NO ELEMENTS RECORDED — nothing to test the claim against');
      for (const el of els) {
        const sup = (mapping[el.key] || []).map((id) => byId.get(id)).filter(Boolean);
        lines.push('    * ' + el.label + ' — ' + (sup.length
          ? sup.map((f) => (f.date || '????-??-??') + ' (' + (f.source || 'no pin') + ')').join('; ')
          : 'NO FACTUAL SUPPORT'));
      }
      lines.push('');
    }
  }
  lines.push('== AFFIRMATIVE DEFENCES (waiver trap: unpleaded = waived) ==');
  if (!defences.length) lines.push('  (none registered)');
  for (const d of defences) {
    lines.push('- [' + (d.pleaded ? 'PLEADED' : 'NOT PLEADED') + '] ' + d.name + ' — ' + (d.cite || ''));
    if (d.basis) lines.push('    basis: ' + d.basis);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { ...ROOM, register };
