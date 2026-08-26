'use strict';
// Room 12 — Discovery Desk. Requests, responses, objections — specific and
// proportional, with deadlines computed from rules where a rule exists.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 12, id: 'discovery', title: 'Discovery Desk', phase: 'Discover' };

const TYPES = [
  ['rfp', 'Requests for production'],
  ['rog', 'Interrogatories'],
  ['rfa', 'Requests for admission'],
  ['undertaking', 'Undertaking'],
  ['ntp', 'Notice to produce'],
];
const DIRECTIONS = [['outbound', 'Outbound — served by us'], ['inbound', 'Inbound — served on us']];

// Which deadline rule computes the response date, per jurisdiction and
// instrument type. Anything not mapped takes a manual due date.
const RULE_MAP = {
  'us-fed': { rog: 'usfed-rog-resp', rfp: 'usfed-rfp-resp' },
  'on': { undertaking: 'on-undertakings' },
};

// Classic boilerplate phrasing — flagged, since specificity is now mandatory.
const BOILER = /(overly broad|unduly burdensome|vague and ambiguous|not reasonably calculated|general objection|to the extent)/i;

const ESI_ITEMS = [
  ['custodians', 'Custodians listed'],
  ['daterange', 'Date range set'],
  ['formats', 'Formats agreed (production spec)'],
  ['clawback', 'Clawback / non-waiver order entered'],
];

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Requests, responses, objections', body: empty('Open a matter to track its discovery instruments.') }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const jur = ctx.matter.jurisdiction || 'on';
    const today = new Date().toISOString().slice(0, 10);
    const instruments = s.list('instrument').sort((a, b) => (b.served || '').localeCompare(a.served || ''));
    const esi = s.list('esiProtocol')[0] || {};
    const esiDone = ESI_ITEMS.filter(([key]) => esi[key]).length;
    const letters = s.list('deficiencyLetter').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const openId = ctx.query.get('i');
    const openInst = openId ? instruments.find((x) => x.id === openId) : null;
    const autoRules = TYPES.map(([v, l]) => ({ l, rule: ruleFor(k, jur, v) })).filter((x) => x.rule);

    const body = `
    <h2 class="sec" style="margin-top:0">Instruments — ${esc(ctx.matter.title)}</h2>
    ${instruments.length ? table(['Type', 'Direction', 'Party', 'Served', 'Response due', 'Status', 'Objections', 'Items', ''],
      instruments.map((i) => {
        const st = effStatus(i, today);
        const unans = (i.items || []).filter((it) => !it.answered).length;
        return [
          esc(typeLabel(i.type)),
          i.direction === 'inbound' ? tag('inbound', 'navy') : tag('outbound'),
          esc(i.party || '—'),
          date(i.served),
          i.due ? date(i.due) + (i.dueCite ? ` <span class="note">${esc(i.dueCite)}</span>` : ' <span class="note">manual</span>') : '—',
          st === 'responded' ? tag('responded', 'ok') : st === 'overdue' ? tag('overdue', 'gate') : tag('open'),
          `<span class="num">${(i.objections || []).length}</span>`,
          `<span class="num">${(i.items || []).length - unans}/${(i.items || []).length}</span> answered`,
          `<a href="/r/discovery?i=${esc(i.id)}">open →</a>`,
        ];
      })) : empty('No discovery instruments tracked on this matter yet — track the first below.')}

    ${openInst ? instrumentDetail(openInst, today) : ''}

    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">New instrument</h2>
        <form method="POST" action="/r/discovery/new">
          <div class="grid2">
            <span>${select('type', 'Type', TYPES)}</span>
            <span>${select('direction', 'Direction', DIRECTIONS)}</span>
            <span>${input('served', 'Served date', { type: 'date', required: true })}</span>
            <span>${input('due', 'Response due (if no rule matches)', { type: 'date' })}</span>
          </div>
          ${input('party', 'Responding / serving party', { placeholder: 'Opposing party or counsel' })}
          ${textarea('items', 'Items / requests (one per line)', { placeholder: 'All documents concerning the 2024 supply agreement\nIdentify each person with knowledge of...' })}
          <button>Track instrument</button>
        </form>
        <p class="note">${autoRules.length
          ? 'Response dates auto-computed for this jurisdiction: ' + autoRules.map((x) => `${esc(x.l)} → ${x.rule.days}d (${esc(x.rule.cite)})`).join('; ') + '. Other types take the manual date.'
          : 'No response-deadline rule on file for this jurisdiction — enter the due date manually.'}</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">ESI protocol ${esiDone === ESI_ITEMS.length ? tag('negotiated — collect', 'ok') : tag(esiDone + '/' + ESI_ITEMS.length + ' — before collection', 'gate')}</h2>
        <form method="POST" action="/r/discovery/esi">
          ${ESI_ITEMS.map(([key, label]) => check(key, label, !!esi[key])).join('')}
          <button>Save checklist</button>
        </form>
        <p class="note">The protocol is negotiated in writing before collection starts, not after. For US federal matters the clawback order is entered under FRE 502(d); elsewhere, by agreement or court order.</p>
      </div>
    </div>

    ${letters.length ? `<h2 class="sec">Deficiency letters</h2>${letters.map((l) => `
      <div class="card">
        <b>${esc(typeLabel(l.type))}</b> · to ${esc(l.to || 'responding party')} · ${date(l.createdAt)}
        <pre style="white-space:pre-wrap;font-family:var(--f-mono);font-size:12px;color:var(--ink-soft);background:var(--ground);border:1px solid var(--rule);padding:12px 14px;margin-top:10px">${esc(l.text)}</pre>
      </div>`).join('')}` : ''}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Requests, responses, objections — specific and proportional', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/discovery'); return; }
    const type = TYPES.some(([v]) => v === ctx.body.type) ? ctx.body.type : null;
    const served = isoDate(ctx.body.served);
    if (!type || !served) { ctx.setFlash('Pick a type and a valid served date.', 'err'); redirect(res, '/r/discovery'); return; }
    const jur = ctx.matter.jurisdiction || 'on';
    const rule = ruleFor(k, jur, type);
    let due = null, dueCite = null;
    if (rule) {
      try { due = k.rules.compute(rule, served); dueCite = rule.cite; } catch (e) { due = null; }
    }
    if (!due) due = isoDate(ctx.body.due); // manual fallback
    const items = String(ctx.body.items || '').split('\n').map((t) => t.trim()).filter(Boolean)
      .map((text, idx) => ({ n: idx + 1, text, answered: false }));
    const inst = k.scope(ctx.matter.id).put('instrument', {
      type, direction: ctx.body.direction === 'inbound' ? 'inbound' : 'outbound',
      party: ctx.body.party || '', served, due, dueCite, status: 'open', items, objections: [],
    });
    if (due) {
      k.scope(ctx.matter.id).put('deadline', {
        desc: `${typeLabel(type)} — responses due`, due, rule: dueCite || 'By agreement / manual',
        trigger: 'Served ' + served, status: 'open',
      });
    }
    ctx.setFlash(`Tracked ${typeLabel(type)}${due ? ` — responses due ${due}${dueCite ? ` (${dueCite})` : ''}, calendared.` : ' — no due date set.'}`);
    redirect(res, '/r/discovery?i=' + encodeURIComponent(inst.id));
  });

  app.route('POST', `/r/${ROOM.id}/respond`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('instrument', ctx.body.id) : null;
    if (!inst) { ctx.setFlash('Instrument not found.', 'err'); redirect(res, '/r/discovery'); return; }
    s.put('instrument', { ...inst, status: 'responded', respondedAt: new Date().toISOString().slice(0, 10) });
    ctx.setFlash('Marked responded.');
    redirect(res, '/r/discovery?i=' + encodeURIComponent(inst.id));
  });

  app.route('POST', `/r/${ROOM.id}/item`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('instrument', ctx.body.id) : null;
    const n = parseInt(ctx.body.n, 10);
    if (!inst || !Number.isInteger(n)) { redirect(res, '/r/discovery'); return; }
    const items = (inst.items || []).map((it) => it.n === n ? { ...it, answered: !it.answered } : it);
    s.put('instrument', { ...inst, items });
    redirect(res, '/r/discovery?i=' + encodeURIComponent(inst.id));
  });

  app.route('POST', `/r/${ROOM.id}/objection`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('instrument', ctx.body.id) : null;
    const basis = String(ctx.body.basis || '').trim();
    if (!inst || !basis) { ctx.setFlash('Pick an instrument and state the basis for the objection.', 'err'); redirect(res, '/r/discovery'); return; }
    const boilerplate = BOILER.test(basis) && basis.length < 90;
    s.put('instrument', { ...inst, objections: [...(inst.objections || []), { basis, boilerplate, at: new Date().toISOString().slice(0, 10) }] });
    ctx.setFlash(boilerplate ? 'Objection recorded — flagged as boilerplate. State the grounds with specificity.' : 'Objection recorded.');
    redirect(res, '/r/discovery?i=' + encodeURIComponent(inst.id));
  });

  app.route('POST', `/r/${ROOM.id}/esi`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const existing = s.list('esiProtocol')[0] || {};
    const next = { ...existing };
    for (const [key] of ESI_ITEMS) next[key] = !!ctx.body[key];
    s.put('esiProtocol', next);
    const done = ESI_ITEMS.filter(([key]) => next[key]).length;
    ctx.setFlash(done === ESI_ITEMS.length ? 'ESI protocol complete — collection can start.' : `ESI checklist saved — ${done}/${ESI_ITEMS.length} agreed.`);
    redirect(res, '/r/discovery');
  });

  app.route('POST', `/r/${ROOM.id}/letter`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const inst = ctx.body.id ? s.get('instrument', ctx.body.id) : null;
    if (!inst) { ctx.setFlash('Pick an instrument to generate a deficiency letter from.', 'err'); redirect(res, '/r/discovery'); return; }
    const unanswered = (inst.items || []).filter((it) => !it.answered);
    if (!unanswered.length) { ctx.setFlash('Every item on that instrument is answered — nothing to chase.'); redirect(res, '/r/discovery?i=' + encodeURIComponent(inst.id)); return; }
    const text = deficiencyText(ctx.matter, inst, unanswered);
    s.put('deficiencyLetter', { instrumentId: inst.id, type: inst.type, to: inst.party || '', text });
    ctx.setFlash(`Deficiency letter generated from ${unanswered.length} unanswered item(s) — review before it goes out.`);
    redirect(res, '/r/discovery?i=' + encodeURIComponent(inst.id));
  });
}

// ---- helpers ----
function typeLabel(t) { const f = TYPES.find(([v]) => v === t); return f ? f[1] : (t || 'Instrument'); }
function ruleFor(k, jur, type) { const id = (RULE_MAP[jur] || {})[type]; return id ? k.rules.rule(id) : null; }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null; }
function effStatus(inst, today) {
  if (inst.status === 'responded') return 'responded';
  if (inst.due && inst.due < today) return 'overdue';
  return 'open';
}
const check = (name, label, on) => `<label style="display:flex;gap:9px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft);margin:8px 0"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} style="width:auto">${esc(label)}</label>`;

function instrumentDetail(i, today) {
  const st = effStatus(i, today);
  const unanswered = (i.items || []).filter((it) => !it.answered).length;
  return `
  <h2 class="sec">${esc(typeLabel(i.type))} — detail</h2>
  <div class="grid2">
    <div class="card">
      ${kv([
        ['Direction', i.direction === 'inbound' ? tag('inbound — served on us', 'navy') : tag('outbound — served by us')],
        ['Party', esc(i.party || '—')],
        ['Served', date(i.served) || '—'],
        ['Response due', i.due ? `${date(i.due)} <span class="note">${esc(i.dueCite || 'manual date')}</span>` : '—'],
        ['Status', st === 'responded' ? tag('responded', 'ok') : st === 'overdue' ? tag('overdue', 'gate') : tag('open')],
      ])}
      ${st !== 'responded' ? `<form method="POST" action="/r/discovery/respond" style="display:inline"><input type="hidden" name="id" value="${esc(i.id)}"><button>Mark responded</button></form>` : ''}
      <form method="POST" action="/r/discovery/letter" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(i.id)}"><button class="quiet" style="margin-top:14px">Generate deficiency letter (${unanswered} unanswered)</button></form>
      <h2 class="sec">Items ${tag(`${(i.items || []).length - unanswered}/${(i.items || []).length} answered`, unanswered ? '' : 'ok')}</h2>
      ${(i.items || []).length ? (i.items || []).map((it) => `
        <form method="POST" action="/r/discovery/item" style="margin:0 0 6px;display:flex;gap:10px;align-items:baseline">
          <input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="n" value="${it.n}">
          <button class="quiet" style="min-width:34px">${it.answered ? '✓' : '·'}</button>
          <span class="num">${it.n}.</span>
          <span style="${it.answered ? 'color:var(--ink-faint)' : ''}">${esc(it.text)}</span>
        </form>`).join('') : empty('No items recorded on this instrument.')}
    </div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Objections</h2>
      ${(i.objections || []).length ? (i.objections || []).map((o) => `
        <div style="border:1px solid var(--rule);padding:10px 12px;margin-bottom:8px;background:var(--ground)">
          ${esc(o.basis)} ${o.boilerplate ? tag('boilerplate — sanctions risk', 'gate') : ''}
          <div class="note">${date(o.at)}</div>
        </div>`).join('') : empty('No objections recorded.')}
      <form method="POST" action="/r/discovery/objection">
        <input type="hidden" name="id" value="${esc(i.id)}">
        ${textarea('basis', 'Objection basis (state with specificity)', { placeholder: 'Request 4 seeks documents outside the relevant period (2019–21); production limited to 2022–24 per the discovery plan.' })}
        <button>Record objection</button>
      </form>
      <p class="note">Boilerplate objections draw sanctions, not shrugs — grounds must be stated with specificity, and an objection must say whether anything is being withheld under it (FRCP 33(b)(4), 34(b)(2)(B)–(C); Fischer v. Forrest, S.D.N.Y. 2017).</p>
    </div>
  </div>`;
}

function deficiencyText(matter, inst, unanswered) {
  const label = typeLabel(inst.type);
  const lines = unanswered.map((it) => `  ${it.n}. ${it.text}`).join('\n');
  return `Re: ${matter.title} — deficiencies in responses to ${label.toLowerCase()} served ${inst.served || '(date not recorded)'}

Dear counsel${inst.party ? ' for ' + inst.party : ''}:

We have reviewed the responses to the ${label.toLowerCase()} served ${inst.served || '(date not recorded)'}. The following items remain unanswered or materially deficient:

${lines}

Responses were due ${inst.due ? inst.due + (inst.dueCite ? ' under ' + inst.dueCite : '') : 'on the date agreed between counsel'}. Please provide complete, specific responses within 14 days of this letter. We remain available to meet and confer on scope; absent complete responses we will move to compel and seek costs.

This letter forms part of the discovery record in this matter.`;
}

module.exports = { ...ROOM, register };
