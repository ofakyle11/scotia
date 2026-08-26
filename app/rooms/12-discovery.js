'use strict';
// Room 12 — Discovery Desk. Requests, responses, objections — specific and
// proportional, with deadlines computed from rules where a rule exists.
//
// Page order follows the day: the instrument board, the instrument you are
// working, then the control you reach for most (track a new instrument), then
// the standing records — plan, conferences, and the deficiency letters, the
// one artifact in this room that leaves the building and therefore prints.
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

// FRCP 33(a)(1): no more than 25 written interrogatories, including all
// discrete subparts, without leave or stipulation. Ontario's Rules of Civil
// Procedure have no written interrogatories (discovery is by examination for
// discovery, r.31), so the cap is inapplicable to ON-seated matters.
const ROG_CAP = 25;

const SUMMARY = 'cursor:pointer;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-soft)';
const PRE = 'white-space:pre-wrap;font-family:var(--f-mono);font-size:12px;color:var(--ink-soft);background:var(--ground);border:1px solid var(--rule);padding:12px 14px;margin:0';

// Ctrl-P (or the button) yields the selected deficiency letter alone: the
// board, the forms and the history are marked .no-print and the shared base in
// kernel/html.js drops them along with the chrome. Only the two things the base
// cannot know are stated here — the room heading has no place on correspondence,
// and a letter that goes out over a signature sets in a serif face on plain
// paper, not in the mono box it is read in on screen.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
.letter-sheet{border:0!important;padding:0!important;margin:0!important}
.letter-sheet pre{color:#111!important;border:0!important;padding:0!important;font-family:Georgia,"Times New Roman",serif!important;font-size:11.5pt!important;line-height:1.5!important}
}</style>`;

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
    const plan = s.list('discoveryPlan')[0] || {};
    const meets = s.list('meetConfer').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const rogs = instruments.filter((i) => i.type === 'rog');
    const openId = ctx.query.get('i');
    const openInst = openId ? instruments.find((x) => x.id === openId) : null;
    const autoRules = TYPES.map(([v, l]) => ({ l, rule: ruleFor(k, jur, v) })).filter((x) => x.rule);
    const overdue = instruments.filter((i) => effStatus(i, today) === 'overdue').length;
    // The letter on the sheet. A letter the user actually asked for (?l=, which
    // is where /letter redirects) leads the page — you asked to read it, you
    // should not have to scroll the whole desk to find it. With no ?l= the
    // newest letter is still on the sheet, but as the standing record at the
    // foot of the page, because the desk is what the day starts on.
    const picked = ctx.query.get('l') ? letters.find((l) => l.id === ctx.query.get('l')) : null;
    const letterSel = picked || letters[0] || null;
    const keepI = openId ? 'i=' + encodeURIComponent(openId) + '&' : '';

    const desk = `
    <h2 class="sec" style="margin-top:0">Instruments — ${esc(ctx.matter.title)} ${overdue ? tag(`${overdue} overdue`, 'gate') : ''}</h2>
    ${instruments.length ? table(['Type', 'Direction', 'Party', 'Served', 'Response due', 'Status', 'Objections', 'Items answered', ''],
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
          // Boilerplate draws sanctions, so it is flagged where the board is
          // scanned, not only inside the instrument.
          `<span class="num">${(i.objections || []).length}</span>`
            + ((i.objections || []).some((o) => o.boilerplate) ? ' ' + tag('boilerplate', 'gate') : ''),
          `<span class="num">${(i.items || []).length - unans}/${(i.items || []).length}</span>`,
          i.id === openId ? tag('open', 'navy') : `<a href="/r/discovery?i=${encodeURIComponent(i.id)}">open →</a>`,
        ];
      })) : empty('Nothing served either way yet — track the first request, interrogatory set or undertaking below; where a rule governs the response date it is computed and calendared for you.')}

    ${openInst ? instrumentDetail(openInst, today) : ''}

    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Track an instrument</h2>
        <form method="POST" action="/r/discovery/new">
          <div class="grid2">
            <span>${select('type', 'Type', TYPES)}</span>
            <span>${select('direction', 'Direction', DIRECTIONS)}</span>
            <span>${input('served', 'Served', { type: 'date', required: true })}</span>
            <span>${input('due', 'Response due', { type: 'date', placeholder: 'only if no rule matches' })}</span>
          </div>
          ${input('party', 'Responding / serving party', { placeholder: 'Opposing party or counsel' })}
          ${textarea('items', 'Items / requests (one per line)', { placeholder: 'All documents concerning the 2024 supply agreement\nIdentify each person with knowledge of...' })}
          <button>Track instrument</button>
        </form>
        <p class="note">${autoRules.length
          ? 'Computed for this jurisdiction: ' + autoRules.map((x) => `${esc(x.l)} → ${x.rule.days}d (${esc(x.rule.cite)})`).join('; ') + '. Every other type takes the date you type.'
          : 'No response-deadline rule on file for this jurisdiction — type the due date and it is calendared as a manual date.'}</p>
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

    ${rogs.length ? `<h2 class="sec">Interrogatory count — FRCP 33(a)(1) cap</h2>
    <div class="card">
      ${table(['Set', 'Party', `Count incl. discrete subparts / ${ROG_CAP}`, 'Direction'], rogs.map((i) => {
        const c = rogCount(i.items);
        const over = jur !== 'on' && c > ROG_CAP;
        const near = jur !== 'on' && !over && c >= ROG_CAP - 3;
        return [
          `<a href="/r/discovery?i=${encodeURIComponent(i.id)}">${esc(typeLabel(i.type))}</a>`,
          esc(i.party || '—'),
          `<span class="num">${c}</span> / ${ROG_CAP} ${over ? tag('over cap — leave/stipulation required', 'gate') : near ? tag('near cap', 'navy') : ''}`,
          i.direction === 'inbound' ? tag('inbound', 'navy') : tag('outbound'),
        ];
      }))}
      <p class="note">${jur === 'on'
        ? 'This matter is Ontario-seated: the Rules of Civil Procedure provide for examination for discovery (r.31), not written interrogatories, so the FRCP 33 cap does not apply and these counts are informational. '
        : 'FRCP 33(a)(1): no more than 25 written interrogatories, including all discrete subparts, without leave or a stipulation. '}Subparts are estimated from lettered/roman markers in each item — verify discrete-subpart counts by hand. Reference, not legal advice.</p>
    </div>` : ''}

    <h2 class="sec">Discovery plan &amp; proportionality ${plan.createdAt ? tag('on file', 'ok') : tag('not yet agreed', 'gate')}</h2>
    <div class="card">
      ${plan.createdAt ? `${planView(plan)}
      <form method="POST" action="/r/discovery/plan-export" style="display:inline"><button class="quiet" style="margin-top:12px">Download plan (.txt)</button></form>
      <details style="margin-top:12px"><summary style="${SUMMARY}">Revise the plan</summary>${planForm(plan)}</details>`
        : planForm(plan)}
      <p class="note">Ontario r.29.1.03 requires the parties to agree to a discovery plan; r.29.2 governs proportionality. The US-federal equivalent is the FRCP 26(f) conference and plan, with proportionality under FRCP 26(b)(1). Reference framework — not legal advice.</p>
    </div>

    <h2 class="sec">Meet-and-confer log</h2>
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Log a conference</h2>
        <form method="POST" action="/r/discovery/meet">
          <div class="grid2">
            <span>${input('date', 'Date', { type: 'date', required: true })}</span>
            <span>${input('attendees', 'Attendees', { placeholder: 'Counsel of record for both parties' })}</span>
          </div>
          ${textarea('issues', 'Issues raised', { placeholder: 'Scope of custodian list; date range; native-format spreadsheets.' })}
          ${textarea('resolutions', 'Resolutions / next steps', { placeholder: 'Agreed 5 custodians; opposing to confirm date range by 2026-09-05.' })}
          <button>Log conference</button>
        </form>
        <p class="note">FRCP 37(a)(1) requires a good-faith conferral certification before a motion to compel; Ontario r.29.1.03 requires the parties to agree a discovery plan. This log is the record that supports both.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">History</h2>
        ${meets.length ? meets.map((m) => `<div style="border:1px solid var(--rule);padding:10px 12px;margin-bottom:8px;background:var(--ground)">
            <b>${date(m.date)}</b> · ${esc(m.attendees || 'attendees not recorded')}
            ${m.issues ? `<div class="note"><b>Issues:</b> ${esc(m.issues)}</div>` : ''}
            ${m.resolutions ? `<div class="note"><b>Resolved:</b> ${esc(m.resolutions)}</div>` : ''}
          </div>`).join('') : empty('No conferences logged — log the first one here; a motion to compel needs this record behind it.')}
      </div>
    </div>`;

    // The deficiency letter is correspondence: listed compactly, read on a
    // sheet, printed or downloaded from there.
    const letterBlock = letterSel ? `
    <div class="no-print">
      <h2 class="sec"${picked ? ' style="margin-top:0"' : ''}>Deficiency letters ${letters.length > 1 ? tag(`${letters.length} on file`, 'navy') : ''}</h2>
      ${table(['Generated', 'Instrument', 'To', ''], letters.map((l) => [
        date(l.createdAt),
        esc(typeLabel(l.type)),
        esc(l.to || '—'),
        l.id === letterSel.id ? tag('on the sheet', 'navy') : `<a href="/r/discovery?${keepI}l=${encodeURIComponent(l.id)}">show →</a>`,
      ]))}
    </div>
    <div class="card letter-sheet">
      <div class="note no-print" style="margin:0 0 12px">
        <a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a>
        <form method="POST" action="/r/discovery/letter-export" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(letterSel.id)}"><button class="quiet">Download (.txt)</button></form>
        ${picked ? `<a href="/r/discovery${openId ? '?i=' + encodeURIComponent(openId) : ''}" style="margin-left:12px">← back to the desk</a>` : ''}
        <div style="margin-top:8px">Printing yields this letter alone — the board, the forms and the history drop out. Review and sign before it goes out; it forms part of the discovery record either way.</div>
      </div>
      <pre style="${PRE}">${esc(letterSel.text || '')}</pre>
    </div>` : '';

    const body = letterSel
      ? PRINT + (picked
        ? letterBlock + `<div class="no-print">${desk}</div>`
        : `<div class="no-print">${desk}</div>` + letterBlock)
      : desk;
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
    // `dueCite` is the rule's citation string; `ruleId` is the kernel/rules.js id
    // behind it. Both are set together or neither is: a row may never claim a rule
    // it did not compute from. If compute() throws we fall through to the typed
    // date and the row is manual.
    let due = null, dueCite = null, ruleId = null;
    if (rule) {
      try { due = k.rules.compute(rule, served); dueCite = rule.cite; ruleId = rule.id; }
      catch (e) { due = null; dueCite = null; ruleId = null; }
    }
    if (!due) { due = isoDate(ctx.body.due); dueCite = null; ruleId = null; } // manual fallback
    const items = String(ctx.body.items || '').split('\n').map((t) => t.trim()).filter(Boolean)
      .map((text, idx) => ({ n: idx + 1, text, answered: false }));
    const inst = k.scope(ctx.matter.id).put('instrument', {
      type, direction: ctx.body.direction === 'inbound' ? 'inbound' : 'outbound',
      party: ctx.body.party || '', served, due, dueCite, status: 'open', items, objections: [],
    });
    if (due) {
      k.scope(ctx.matter.id).put('deadline', {
        desc: `${typeLabel(type)} — responses due`, due, rule: dueCite || 'By agreement / manual',
        // The diary controls downstream (27-desk's limitation flag and dual-diary
        // tick, 09-jurisdiction's recompute list, the appeal watchdog) resolve the
        // deadline's source through `ruleId` — the rules.js id — not the citation
        // string. Carry it whenever a rule computed this date; write an explicit
        // null when counsel typed the date, so a reader can tell a deliberately
        // manual row from a legacy row that predates the field.
        ruleId, trigger: 'Served ' + served, status: 'open',
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
    const rec = s.put('deficiencyLetter', { instrumentId: inst.id, type: inst.type, to: inst.party || '', text });
    ctx.setFlash(`Deficiency letter generated from ${unanswered.length} unanswered item(s) — review before it goes out.`);
    redirect(res, '/r/discovery?i=' + encodeURIComponent(inst.id) + '&l=' + encodeURIComponent(rec && rec.id ? rec.id : ''));
  });

  // Download one deficiency letter as a plain-text file for the correspondence
  // file — the same record the sheet prints, byte for byte.
  app.route('POST', `/r/${ROOM.id}/letter-export`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const l = ctx.body.id ? s.get('deficiencyLetter', String(ctx.body.id)) : null;
    if (!l) { ctx.setFlash('Pick a deficiency letter to download.', 'err'); redirect(res, '/r/discovery'); return; }
    k.audit('deficiencyLetter.export', ctx.matter.id + ':' + l.id);
    const slug = String(ctx.matter.title || 'matter').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'matter';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="deficiency-letter-${slug}-${String(l.createdAt || '').slice(0, 10)}.txt"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(String(l.text || ''));
  });

  // Discovery plan + proportionality record — one per matter (Ont. r.29.1 / FRCP 26(f)).
  app.route('POST', `/r/${ROOM.id}/plan`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const b = ctx.body || {};
    const fields = {
      scope: String(b.scope || '').trim(),
      custodians: String(b.custodians || '').trim(),
      dateFrom: isoDate(b.dateFrom) || '',
      dateTo: isoDate(b.dateTo) || '',
      format: String(b.format || '').trim(),
      costNote: String(b.costNote || '').trim(),
      agreedDates: String(b.agreedDates || '').trim(),
    };
    if (!Object.values(fields).some((v) => v)) { ctx.setFlash('Enter at least one part of the discovery plan.', 'err'); redirect(res, '/r/discovery'); return; }
    if (fields.dateFrom && fields.dateTo && fields.dateTo < fields.dateFrom) { ctx.setFlash('Date range ends before it starts.', 'err'); redirect(res, '/r/discovery'); return; }
    const existing = s.list('discoveryPlan')[0] || {};
    s.put('discoveryPlan', { ...existing, ...fields });
    k.audit('discoveryPlan.saved', ctx.matter.id);
    ctx.setFlash('Discovery plan saved.');
    redirect(res, '/r/discovery');
  });

  // Download the plan as a plain-text record for the discovery file.
  app.route('POST', `/r/${ROOM.id}/plan-export`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const plan = s.list('discoveryPlan')[0];
    if (!plan) { ctx.setFlash('No discovery plan to export yet — save one first.', 'err'); redirect(res, '/r/discovery'); return; }
    const text = planText(ctx.matter, plan);
    k.audit('discoveryPlan.export', ctx.matter.id + ':' + plan.id);
    const slug = String(ctx.matter.title || 'matter').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'matter';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="discovery-plan-${slug}.txt"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(text);
  });

  // Meet-and-confer log — date, attendees, issues, resolutions.
  app.route('POST', `/r/${ROOM.id}/meet`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/discovery'); return; }
    const s = k.scope(ctx.matter.id);
    const d = isoDate(ctx.body.date);
    const attendees = String(ctx.body.attendees || '').trim();
    const issues = String(ctx.body.issues || '').trim();
    const resolutions = String(ctx.body.resolutions || '').trim();
    if (!d) { ctx.setFlash('Enter a valid conference date.', 'err'); redirect(res, '/r/discovery'); return; }
    if (!attendees && !issues && !resolutions) { ctx.setFlash('Record who attended or what was discussed.', 'err'); redirect(res, '/r/discovery'); return; }
    s.put('meetConfer', { date: d, attendees, issues, resolutions });
    k.audit('meetConfer.logged', ctx.matter.id + ':' + d);
    ctx.setFlash('Meet-and-confer conference logged.');
    redirect(res, '/r/discovery');
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
// Count interrogatories in a set including discrete subparts — one per item,
// plus lettered/roman markers detected within each item (estimate; FRCP 33(a)(1)).
function rogCount(items) {
  let total = 0;
  for (const it of items || []) {
    const subs = (String(it.text || '').match(/\((?:[a-z]|[ivxlcdm]+)\)/gi) || []).length;
    total += 1 + subs;
  }
  return total;
}

// The plan as a record you can read, rather than seven textareas you must
// re-read. The form itself folds away once there is something to show.
function planView(p) {
  const pre = (v) => `<span style="white-space:pre-wrap">${esc(v)}</span>`;
  const rows = [];
  if (p.scope) rows.push(['Scope', pre(p.scope)]);
  if (p.custodians) rows.push(['Custodians', pre(p.custodians)]);
  if (p.dateFrom || p.dateTo) rows.push(['Date range', `${p.dateFrom ? date(p.dateFrom) : '<span class="note">open</span>'} — ${p.dateTo ? date(p.dateTo) : '<span class="note">open</span>'}`]);
  if (p.format) rows.push(['Format', pre(p.format)]);
  if (p.costNote) rows.push(['Proportionality', pre(p.costNote)]);
  if (p.agreedDates) rows.push(['Agreed dates', pre(p.agreedDates)]);
  return rows.length ? kv(rows) : '<p class="note">Saved, but every field is empty.</p>';
}

function planForm(plan) {
  return `<form method="POST" action="/r/discovery/plan">
    ${textarea('scope', 'Scope of discovery', { value: plan.scope, placeholder: 'Documentary discovery limited to the 2022–24 supply relationship; no restoration of backup tapes absent good cause.' })}
    ${textarea('custodians', 'Custodians / sources (one per line)', { value: plan.custodians, placeholder: 'J. Okafor (VP Ops)\nProcurement shared drive\nO365 mailboxes for 3 custodians' })}
    <div class="grid2">
      <span>${input('dateFrom', 'Date range — from', { type: 'date', value: plan.dateFrom })}</span>
      <span>${input('dateTo', 'Date range — to', { type: 'date', value: plan.dateTo })}</span>
    </div>
    ${input('format', 'Production format', { value: plan.format, placeholder: 'TIFF + .dat/.opt load file; native for spreadsheets; de-dup by hash' })}
    ${textarea('costNote', 'Proportionality — cost and burden against the amount in issue', { value: plan.costNote, placeholder: 'Est. collection & review cost ~$18k against a $250k claim — proportionate; TAR proposed to contain review.' })}
    ${textarea('agreedDates', 'Agreed dates / milestones', { value: plan.agreedDates, placeholder: 'Affidavits of documents: 2026-10-01\nSubstantial completion of production: 2026-11-15\nExaminations: Jan 2027' })}
    <button>Save discovery plan</button>
  </form>`;
}

function planText(matter, p) {
  const line = (v) => (v ? String(v) : '(not recorded)');
  return `Discovery Plan — ${matter.title}
Client: ${matter.client || '(n/a)'} · Jurisdiction: ${matter.jurisdiction || 'on'}
Prepared: ${new Date().toISOString().slice(0, 10)}

1. Scope of discovery:
${line(p.scope)}

2. Custodians / sources:
${line(p.custodians)}

3. Date range: ${p.dateFrom || '(open)'} to ${p.dateTo || '(open)'}

4. Production format:
${line(p.format)}

5. Proportionality (Ont. r.29.2 / FRCP 26(b)(1)):
${line(p.costNote)}

6. Agreed dates / milestones:
${line(p.agreedDates)}

Framework: Ontario Rule 29.1 (discovery plan) and r.29.2 (proportionality); FRCP 26(f) discovery plan and 26(b)(1) proportionality. This record forms part of the discovery record in this matter.`;
}

const check = (name, label, on) => `<label style="display:flex;gap:9px;align-items:center;text-transform:none;letter-spacing:0;font-family:var(--f-body);font-size:13.5px;color:var(--ink-soft);margin:8px 0"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} style="width:auto">${esc(label)}</label>`;

function instrumentDetail(i, today) {
  const st = effStatus(i, today);
  const items = i.items || [];
  const unanswered = items.filter((it) => !it.answered).length;
  return `
  <h2 class="sec">${esc(typeLabel(i.type))}${i.party ? ' — ' + esc(i.party) : ''} <a href="/r/discovery" class="note" style="font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase">close</a></h2>
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
      ${unanswered ? `<form method="POST" action="/r/discovery/letter" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(i.id)}"><button class="quiet" style="margin-top:14px">Deficiency letter — chase ${unanswered}</button></form>` : ''}
      <h2 class="sec">Items ${items.length ? tag(`${items.length - unanswered}/${items.length} answered`, unanswered ? '' : 'ok') : ''}</h2>
      ${items.length ? items.map((it) => `
        <form method="POST" action="/r/discovery/item" style="margin:0 0 6px;display:flex;gap:10px;align-items:baseline">
          <input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="n" value="${it.n}">
          <button class="quiet" style="min-width:34px" aria-label="${it.answered ? 'Mark unanswered' : 'Mark answered'}">${it.answered ? '✓' : '·'}</button>
          <span class="num">${it.n}.</span>
          <span style="${it.answered ? 'color:var(--ink-faint)' : ''}">${esc(it.text)}</span>
        </form>`).join('') : empty('No items were pasted in when this instrument was tracked — chase it by hand or re-track it with the items listed.')}
    </div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Objections</h2>
      ${(i.objections || []).length ? (i.objections || []).map((o) => `
        <div style="border:1px solid var(--rule);padding:10px 12px;margin-bottom:8px;background:var(--ground)">
          ${esc(o.basis)} ${o.boilerplate ? tag('boilerplate — sanctions risk', 'gate') : ''}
          <div class="note">${date(o.at)}</div>
        </div>`).join('') : empty('No objections on this instrument.')}
      <form method="POST" action="/r/discovery/objection">
        <input type="hidden" name="id" value="${esc(i.id)}">
        ${textarea('basis', 'Objection basis — state it with specificity', { placeholder: 'Request 4 seeks documents outside the relevant period (2019–21); production limited to 2022–24 per the discovery plan.' })}
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
