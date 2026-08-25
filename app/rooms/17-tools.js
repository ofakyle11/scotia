'use strict';
// Room 17 — Tools ×20. The drawer of small things, each one real.
const { layout, esc, empty, tag, input, select } = require('../kernel/html.js');
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
      if (t === 'interest') {
        const p = num(b.principal), r = num(b.rate), d1 = day(b.from), d2 = day(b.to);
        if (p == null || r == null || !d1 || !d2 || d2 < d1) throw new Error('Need principal, rate %, and a valid date range.');
        const days = Math.round((d2 - d1) / 86400000);
        const interest = p * (r / 100) * (days / 365);
        out.interest = `${days} days · simple interest $${interest.toFixed(2)} · per diem $${(p * (r / 100) / 365).toFixed(2)} · total $${(p + interest).toFixed(2)}`;
      } else if (t === 'bizdays') {
        const d1 = day(b.from), d2 = day(b.to), jur = b.jur || 'on';
        if (!d1 || !d2 || d2 < d1) throw new Error('Need a valid date range.');
        let n = 0; const d = new Date(d1);
        while (d < d2) { d.setUTCDate(d.getUTCDate() + 1); if (k.rules.isBusinessDay(d, jur)) n++; }
        out.bizdays = `${n} business days (${jur}) between ${b.from} and ${b.to}`;
      } else if (t === 'limitation') {
        const rule = k.rules.rulesFor(b.jur || 'on').find((r2) => r2.id.includes('limitation'));
        if (!rule || !day(b.date)) throw new Error('Need a jurisdiction with a limitation rule and a date.');
        out.limitation = `${rule.desc}: ${k.rules.compute(rule, b.date)} (${rule.cite})`;
      } else if (t === 'bates') {
        const start = num(b.start), count = num(b.count); const prefix = String(b.prefix || 'DEF').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase() || 'DEF';
        if (start == null || count == null || count < 1 || count > 1000000) throw new Error('Need a start number and a count (max 1,000,000).');
        const w = Math.max(6, String(start + count - 1).length);
        out.bates = `${prefix}-${String(start).padStart(w, '0')} through ${prefix}-${String(start + count - 1).padStart(w, '0')} (${count} labels)`;
      } else if (t === 'net') {
        const g = num(b.gross), f = num(b.fee), c = num(b.costs) ?? 0, l = num(b.liens) ?? 0;
        if (g == null || f == null) throw new Error('Need gross and fee %.');
        const fee = g * (f / 100), net = g - fee - c - l;
        out.net = `Gross $${g.toFixed(2)} − fee $${fee.toFixed(2)} (${f}%) − costs $${c.toFixed(2)} − liens $${l.toFixed(2)} = net to client $${net.toFixed(2)}`;
      } else if (t === 'whatif') {
        const rule = k.rules.rule(String(b.rule || ''));
        if (!rule || !day(b.date)) throw new Error('Pick a rule and a trigger date.');
        out.whatif = `${rule.trigger} on ${b.date} → ${rule.desc}: ${k.rules.compute(rule, b.date)} (${rule.cite})`;
      } else throw new Error('Unknown tool.');
    } catch (e) { ctx.setFlash(e.message, 'err'); redirect(res, '/r/tools'); return; }
    render(res, ctx, out);
  });
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const day = (v) => { const d = new Date(String(v || '') + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? null : d; };

function render(res, ctx, out) {
  const k = ctx.kernel;
  const jsel = (name) => select(name, 'Jurisdiction', k.rules.JURISDICTIONS, 'on');
  const result = (key) => out[key] ? `<p class="flash" style="margin-top:12px">${esc(out[key])}</p>` : '';
  const card = (tool, title, note, fields, resKey) => `
    <div class="card"><h2 class="sec" style="margin-top:0">${esc(title)}</h2>
    <form method="POST" action="/r/tools/run"><input type="hidden" name="tool" value="${tool}">${fields}<button>Run</button></form>
    ${result(resKey)}<p class="note">${esc(note)}</p></div>`;
  const body = `
  <div class="grid2">
    ${card('interest', 'Prejudgment interest', 'Simple interest, 365-day year. Statutory rates are jurisdiction-set — enter the applicable rate.',
      input('principal', 'Principal', { type: 'number', required: true }) + input('rate', 'Annual rate %', { type: 'number', required: true }) + input('from', 'From', { type: 'date', required: true }) + input('to', 'To', { type: 'date', required: true }), 'interest')}
    ${card('bizdays', 'Business days between dates', 'Counts business days for the jurisdiction, holidays excluded (reference tables).',
      input('from', 'From', { type: 'date', required: true }) + input('to', 'To', { type: 'date', required: true }) + jsel('jur'), 'bizdays')}
    ${card('limitation', 'Limitation quick-check', 'Basic limitation from the rules engine — discoverability nuances are counsel’s call.',
      jsel('jur') + input('date', 'Date claim discovered', { type: 'date', required: true }), 'limitation')}
    ${card('bates', 'Bates label run', 'Plans a numbering run before stamping; width padded to the run size.',
      input('prefix', 'Prefix', { value: 'DEF' }) + input('start', 'Start number', { type: 'number', required: true }) + input('count', 'Count', { type: 'number', required: true }), 'bates')}
    ${card('net', 'Settlement net quick-calc', 'Rough net-to-client; the full waterfall lives in room 24.',
      input('gross', 'Gross', { type: 'number', required: true }) + input('fee', 'Fee %', { type: 'number', required: true }) + input('costs', 'Costs', { type: 'number' }) + input('liens', 'Liens', { type: 'number' }), 'net')}
    ${card('whatif', 'Deadline what-if', 'Any rule in the book against any trigger date — the rule is cited with the answer.',
      select('rule', 'Rule', k.rules.RULES.map((r) => [r.id, `${r.jur}: ${r.trigger} → ${r.desc}`])) + input('date', 'Trigger date', { type: 'date', required: true }), 'whatif')}
    <div class="card"><h2 class="sec" style="margin-top:0">In the full drawer</h2>
      <p class="note">Affidavit &amp; declaration mills, records-request generators with fee caps, medical chronology builder, transcript search, redaction QC, MHL-style offload hashing, cost &amp; tariff estimators, translation requests — twenty in all per the Build Sheet, each landing here as it ships. ${tag('reference build: 6 live', 'navy')}</p>
    </div>
  </div>`;
  html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'The drawer — small tools, opened fifteen times a day', body }));
}

module.exports = { ...ROOM, register };
