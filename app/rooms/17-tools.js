'use strict';
// Room 17 — Tools ×20. The drawer of small things, each one real.
// Stores nothing: every card computes from ctx.body and renders the answer back.
const { layout, esc, tag, input, select } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 17, id: 'tools', title: 'Tools ×20', phase: 'Discover' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => render(res, ctx, {}));

  app.route('POST', `/r/${ROOM.id}/run`, (req, res, ctx) => {
    const k = ctx.kernel;
    const t = String(ctx.body.tool || '');
    const b = ctx.body;
    const out = {};
    try {
      if (t === 'whatif') {
        const rule = k.rules.rule(String(b.rule || ''));
        if (!rule || !day(b.date)) throw new Error('Pick a rule and a valid trigger date.');
        const c = k.rules.computeLimitation(rule, b.date);
        out.whatif = [`${rule.trigger} on ${b.date} → ${rule.desc}: ${c.date} (${rule.cite})`];
        if (c.limitation) {
          out.whatif.push('Limitation period — returned at its true statutory expiry, never rolled forward.'
            + (c.weekendOrHoliday ? ' It lands on a weekend or holiday: do not assume the next business day without a statutory extension.' : ''));
        }
      } else if (t === 'limitation') {
        const jur = jurOf(k, b.jur);
        const rules = k.rules.rulesFor(jur).filter((r2) => k.rules.isLimitation(r2));
        if (!rules.length) throw new Error(`No limitation or prescription rule on file for ${jur} — check the governing statute, or use Deadline what-if for a procedural rule.`);
        if (!day(b.date)) throw new Error('Need the date the claim was discovered.');
        out.limitation = rules.map((r2) => {
          const c = k.rules.computeLimitation(r2, b.date);
          return `${r2.desc}: ${c.date} (${r2.cite})`
            + (c.weekendOrHoliday ? ' — lands on a weekend or holiday, and is NOT rolled forward.' : '');
        });
        if (rules.length > 1) out.limitation.push(`${rules.length} limitation periods run in ${jur} — which one applies turns on the cause of action.`);
      } else if (t === 'bizdays') {
        const d1 = day(b.from), d2 = day(b.to), jur = jurOf(k, b.jur);
        if (!d1 || !d2 || d2 < d1) throw new Error('Need a valid date range (to on or after from).');
        let n = 0; const d = new Date(d1);
        while (d < d2) { d.setUTCDate(d.getUTCDate() + 1); if (k.rules.isBusinessDay(d, jur)) n++; }
        out.bizdays = `${n} business days (${jur}) — first day excluded, last day included — between ${b.from} and ${b.to}`;
      } else if (t === 'interest') {
        const p = num(b.principal), r = num(b.rate), d1 = day(b.from), d2 = day(b.to);
        if (p == null || r == null || !d1 || !d2 || d2 < d1) throw new Error('Need principal, rate %, and a valid date range.');
        const days = Math.round((d2 - d1) / 86400000);
        const interest = p * (r / 100) * (days / 365);
        out.interest = `${days} days · simple interest $${interest.toFixed(2)} · per diem $${(p * (r / 100) / 365).toFixed(2)} · total $${(p + interest).toFixed(2)}`;
      } else if (t === 'net') {
        const g = num(b.gross), f = num(b.fee), c = num(b.costs) ?? 0, l = num(b.liens) ?? 0;
        if (g == null || f == null) throw new Error('Need gross and fee %.');
        const fee = g * (f / 100), net = g - fee - c - l;
        out.net = `Gross $${g.toFixed(2)} − fee $${fee.toFixed(2)} (${f}%) − costs $${c.toFixed(2)} − liens $${l.toFixed(2)} = net to client $${net.toFixed(2)}`;
      } else if (t === 'bates') {
        const start = num(b.start), count = num(b.count); const prefix = String(b.prefix || 'DEF').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase() || 'DEF';
        if (start == null || count == null || count < 1 || count > 1000000) throw new Error('Need a start number and a count (max 1,000,000).');
        const w = Math.max(6, String(start + count - 1).length);
        out.bates = `${prefix}-${String(start).padStart(w, '0')} through ${prefix}-${String(start + count - 1).padStart(w, '0')} (${count} labels)`;
      } else throw new Error('Pick a tool and press Run.');
    } catch (e) { ctx.setFlash(e.message, 'err'); redirect(res, '/r/tools'); return; }
    render(res, ctx, out, b);
  });
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const day = (v) => { const d = new Date(String(v || '') + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? null : d; };
// A jurisdiction code is only ever one of the rules engine's own — anything else
// (empty, stale, hand-edited) falls back to Ontario rather than silently
// computing against no holiday table at all.
const jurOf = (k, v) => (k.rules.JURISDICTIONS.some(([code]) => code === String(v || '')) ? String(v) : 'on');

function render(res, ctx, out, vals = {}) {
  const k = ctx.kernel;
  // The open matter's jurisdiction is the one counsel means nine times in ten —
  // it seeds every jurisdiction picker and floats its rules to the top of the
  // what-if list. Nothing is stored; the pickers stay free.
  const homeJur = jurOf(k, ctx.matter && ctx.matter.jurisdiction);
  // Re-run friendliness: the tool just run keeps its inputs, so a tweak is a
  // one-field edit, not a retype. Other cards stay blank.
  const V = (tool, name, dflt = '') => (String(vals.tool || '') === tool ? String(vals[name] ?? '') : dflt);
  const jsel = (tool) => select('jur', 'Jurisdiction', k.rules.JURISDICTIONS, jurOf(k, V(tool, 'jur', homeJur)));
  // A tool may answer in several lines (a jurisdiction with two limitation
  // periods answers in three); they belong in one box, not three.
  const result = (key) => {
    const v = out[key];
    if (!v) return '';
    return `<p class="flash" style="margin:12px 0 0">${(Array.isArray(v) ? v : [v]).map(esc).join('<br>')}</p>`;
  };
  // `note` is room-authored HTML (citations in italic, links to the room that
  // owns the real thing) — never a user string, so it is not passed through esc.
  const card = (tool, title, note, fields, resKey) => `
    <div class="card"><h2 class="sec" style="margin-top:0">${esc(title)}</h2>
    <form method="POST" action="/r/tools/run"><input type="hidden" name="tool" value="${tool}">${fields}<button>Run</button></form>
    ${result(resKey)}<p class="note">${note}</p></div>`;
  // Every rule in the book, this matter's jurisdiction first (sort is stable, so
  // the book's own order survives inside each group), limitation rules marked so
  // nobody reads an unrolled statutory expiry as a rolled procedural one.
  const ruleOpts = k.rules.RULES.slice()
    .sort((a, b) => (a.jur === homeJur ? 0 : 1) - (b.jur === homeJur ? 0 : 1))
    .map((r) => [r.id, `${r.jur} · ${r.trigger} → ${r.desc}${k.rules.isLimitation(r) ? '  [limitation]' : ''}`]);

  const body = `
  <h2 class="sec" style="margin-top:0">Dates &amp; deadlines</h2>
  <div class="grid2">
    ${card('whatif', 'Deadline what-if', 'Any rule in the book against any trigger date — the rule is cited with the answer. Procedural deadlines roll forward off weekends and holidays; a limitation date never does.',
    select('rule', 'Rule', ruleOpts, V('whatif', 'rule')) + input('date', 'Trigger date', { type: 'date', required: true, value: V('whatif', 'date') }), 'whatif')}
    ${card('limitation', 'Limitation quick-check', 'Every limitation or prescription period the engine holds for the jurisdiction, run against one discovery date. Discoverability, tolling and ultimate limitations are counsel&rsquo;s call — this is arithmetic, not advice.',
    jsel('limitation') + input('date', 'Date claim discovered', { type: 'date', required: true, value: V('limitation', 'date') }), 'limitation')}
    ${card('bizdays', 'Business days between dates', 'Weekends and the jurisdiction&rsquo;s holiday table excluded (a labelled 2026 reference tranche). Counted the usual way: the first day is excluded and the last day included.',
    input('from', 'From', { type: 'date', required: true, value: V('bizdays', 'from') }) + input('to', 'To', { type: 'date', required: true, value: V('bizdays', 'to') }) + jsel('bizdays'), 'bizdays')}
  </div>

  <h2 class="sec">Money</h2>
  <div class="grid2">
    ${card('interest', 'Prejudgment interest', 'Simple interest, 365-day year. The rate is jurisdiction-set and is not looked up here — in Ontario it comes from the quarterly table published under the <i>Courts of Justice Act</i>, ss. 128&ndash;130.',
    input('principal', 'Principal', { type: 'number', required: true, value: V('interest', 'principal') }) + input('rate', 'Annual rate %', { type: 'number', required: true, value: V('interest', 'rate') })
      + `<div class="grid2"><span>${input('from', 'From', { type: 'date', required: true, value: V('interest', 'from') })}</span><span>${input('to', 'To', { type: 'date', required: true, value: V('interest', 'to') })}</span></div>`, 'interest')}
    ${card('net', 'Settlement net quick-calc', 'Rough net-to-client on one fee convention. The full waterfall — both fee conventions, staged trust receipt, lien schedule — lives in <a href="/r/waterfall">room 24</a>.',
    `<div class="grid2"><span>${input('gross', 'Gross', { type: 'number', required: true, value: V('net', 'gross') })}</span><span>${input('fee', 'Fee %', { type: 'number', required: true, value: V('net', 'fee') })}</span></div>`
      + `<div class="grid2"><span>${input('costs', 'Costs', { type: 'number', value: V('net', 'costs') })}</span><span>${input('liens', 'Liens', { type: 'number', value: V('net', 'liens') })}</span></div>`, 'net')}
  </div>

  <h2 class="sec">Documents</h2>
  <div class="grid2">
    ${card('bates', 'Bates label run', 'Plans a numbering run before stamping; width is padded to the run size. The stamping of record happens in <a href="/r/review">Document Review</a>, which owns the matter&rsquo;s real DEF- sequence — this only sizes the run.',
    input('prefix', 'Prefix', { value: V('bates', 'prefix', 'DEF') })
      + `<div class="grid2"><span>${input('start', 'Start number', { type: 'number', required: true, value: V('bates', 'start') })}</span><span>${input('count', 'Count', { type: 'number', required: true, value: V('bates', 'count') })}</span></div>`, 'bates')}
    <div class="card no-print"><h2 class="sec" style="margin-top:0">In the full drawer</h2>
      <p class="note">Affidavit &amp; declaration mills, records-request generators with fee caps, medical chronology builder, transcript search, redaction QC, MHL-style offload hashing, cost &amp; tariff estimators, translation requests — twenty in all per the Build Sheet, each landing here as it ships. ${tag('reference build: 6 live', 'navy')}</p>
    </div>
  </div>`;
  html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The drawer — small tools, opened fifteen times a day. Nothing here is stored.', body }));
}

module.exports = { ...ROOM, register };
