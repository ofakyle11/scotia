'use strict';
// Room 14 — Depositions. Outlines out — digests back.
// Witnesses per matter; outlines pulled from the sourced chronology; transcript
// digests indexed; impeachment candidates paired with the fact they contradict;
// undertakings tracked to answer (Canadian practice runs on them), refusals and
// under-advisements on the same register with a motion-ready printable chart,
// and a cross-matter board of every open promise across the firm.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 14, id: 'depositions', title: 'Depositions', phase: 'Discover' };
const SUB = 'Outlines out — digests back';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PL = /^\d{1,5}:\d{1,4}$/;
const SIDES = [['theirs', 'Theirs — adverse'], ['ours', 'Ours'], ['third-party', 'Third party']];
const KINDS = [['admission', 'Admission'], ['denial', 'Denial'], ['impeachment-candidate', 'Impeachment candidate']];
// The three lists an Ontario examination produces (r. 31.07 runs on all of them).
const UKINDS = [['undertaking', 'Undertaking'], ['refusal', 'Refusal'], ['under-advisement', 'Under advisement']];
const uKind = (u) => u.kind || 'undertaking'; // records predating kinds read as undertakings

const today = () => new Date().toISOString().slice(0, 10);

// Printing this page yields the refusals chart alone — the tabular chart the
// Toronto Region consolidated practice direction expects on a refusals motion.
// Everything else is marked .no-print and the shared print base in
// kernel/html.js drops the chrome and re-points the palette, so the chart
// paginates properly instead of being clipped to one absolutely-placed page.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

function actorMatch(actor, name) {
  const a = String(actor || '').trim().toLowerCase();
  const n = String(name || '').trim().toLowerCase();
  if (!a || !n) return false;
  return a === n || a.includes(n) || n.includes(a);
}

function sideTag(side) {
  if (side === 'ours') return tag('ours', 'ok');
  if (side === 'theirs') return tag('theirs', 'navy');
  return tag('third party');
}

function kindTag(kind) {
  if (kind === 'admission') return tag('admission', 'ok');
  if (kind === 'impeachment-candidate') return tag('impeachment candidate', 'gate');
  return tag('denial');
}

function uKindTag(kind) {
  if (kind === 'refusal') return tag('refusal', 'gate');
  if (kind === 'under-advisement') return tag('under advisement', 'navy');
  return tag('undertaking');
}

function undertakingRule(k, jur) {
  return (k.rules.rulesFor(jur) || []).find((r) => r.id.includes('undertaking')) || null;
}

// Due default: the jurisdiction's undertakings rule where one is on file
// (Ontario: 60 days, r. 31.07 practice, rolled to a business day); otherwise
// a plain +60 calendar-day house default.
function defaultDue(k, jur, given) {
  const r = undertakingRule(k, jur);
  if (r) return { due: k.rules.compute(r, given), basis: r.cite };
  const d = new Date(given + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 60);
  return { due: d.toISOString().slice(0, 10), basis: '+60 days (house default)' };
}

const back = (res, wid) => redirect(res, '/r/depositions' + (wid ? '?w=' + encodeURIComponent(wid) : ''));

// Cross-matter board: every unanswered undertaking / refusal / under-advisement
// across the firm, split ours-to-answer vs theirs-to-chase by the witness side
// on file. Walls respected (scope() throws for walled matters), shredded
// matters skipped — the same try/catch-per-scope pattern as the desk (room 27).
function crossBoard(k, matters, now) {
  const rows = [], per = [];
  for (const m of matters || []) {
    if (k.isShredded(m.id)) continue;
    let us = [], ws = [];
    try { const sc = k.scope(m.id); us = sc.list('undertaking'); ws = sc.list('witness'); } catch { continue; }
    if (us.length) per.push({ m, given: us.length, answered: us.filter((u) => u.status === 'answered').length });
    const wmap = new Map(ws.map((x) => [x.id, x]));
    for (const u of us) if (u.status !== 'answered') rows.push({ m, u, w: wmap.get(u.witnessId) || null });
  }
  const overdue = (r) => !!(r.u.due && r.u.due < now);
  const bySort = (a, b) => ((overdue(a) ? 0 : 1) - (overdue(b) ? 0 : 1)) || String(a.u.due || '').localeCompare(String(b.u.due || ''));
  const row = (r) => [
    esc(r.m.title),
    esc(r.w ? r.w.name : '—'),
    uKindTag(uKind(r.u)),
    esc(r.u.text),
    date(r.u.due),
    overdue(r) ? tag('OVERDUE', 'gate') : tag('open'),
    `<form method="POST" action="/r/depositions/answer-x" style="display:inline"><input type="hidden" name="matterId" value="${esc(r.m.id)}"><input type="hidden" name="id" value="${esc(r.u.id)}"><button class="quiet" style="margin-top:0">answered</button></form>`,
  ];
  const ours = rows.filter((r) => r.w && r.w.side === 'ours').sort(bySort);
  const theirs = rows.filter((r) => !(r.w && r.w.side === 'ours')).sort(bySort);
  const overdueN = rows.filter(overdue).length;
  const COLS = ['Matter', 'Witness', 'Kind', 'Text', 'Due', 'Status', ''];
  const counts = per.length ? table(['Matter', 'Given', 'Answered', 'Open'], per.map((p) => [
    esc(p.m.title),
    `<span class="num">${p.given}</span>`,
    `<span class="num">${p.answered}</span>`,
    p.given - p.answered ? tag(`${p.given - p.answered} open`) : tag('all answered', 'ok'),
  ])) : '';
  const boardBody = rows.length ? `
    <div class="card"><h2 class="sec" style="margin-top:0">Ours to answer — ${ours.length}</h2>
      ${ours.length ? table(COLS, ours.map(row)) : empty('Nothing we owe — no open undertakings from our own witnesses.')}
      <p class="note">Promises our witnesses made on the record. Left unanswered inside the 60-day window (r. 31.07) they invite a motion to compel — and costs.</p>
    </div>
    <div class="card"><h2 class="sec" style="margin-top:0">Theirs to chase — ${theirs.length}</h2>
      ${theirs.length ? table(COLS, theirs.map(row)) : empty('Nothing to chase — the other side has answered everything.')}
      <p class="note">Owed to us by adverse and third-party witnesses. Chase before the discovery cutoff; refusals go to the motion chart in the witness workspace.</p>
    </div>`
    : empty('Nothing outstanding across the firm — every promise on the record is answered.');
  return `
    <h2 class="sec">Cross-matter undertakings board ${rows.length ? tag(`${rows.length} outstanding`, 'navy') : ''} ${overdueN ? tag(`${overdueN} overdue`, 'gate') : ''}</h2>
    ${boardBody}
    ${counts ? `<div class="card"><h2 class="sec" style="margin-top:0">Given / answered by matter</h2>${counts}</div>` : ''}`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body: empty('Open a matter to prepare its examinations.') + crossBoard(k, ctx.matters, today()) }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const witnesses = s.list('witness').slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const facts = s.list('fact').slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const allTopics = s.list('depoTopic');
    const allDigests = s.list('digest');
    const undertakings = s.list('undertaking').slice().sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const wid = (ctx.query.get('w') || '').trim();
    const w = witnesses.find((x) => x.id === wid) || null;
    const uRule = undertakingRule(k, ctx.matter.jurisdiction);
    const now = today();

    const bench = table(['Witness', 'Side', 'Role', 'Examination', 'Topics', 'Digest', ''],
      witnesses.map((x) => [
        `<a href="/r/depositions?w=${encodeURIComponent(x.id)}"><b>${esc(x.name)}</b></a>`,
        sideTag(x.side),
        esc(x.role || '—'),
        x.examDate ? date(x.examDate) : '<span class="note">not scheduled</span>',
        `<span class="num">${allTopics.filter((t) => t.witnessId === x.id).length}</span>`,
        `<span class="num">${allDigests.filter((d) => d.witnessId === x.id).length}</span>`,
        w && w.id === x.id ? tag('open', 'navy') : `<a href="/r/depositions?w=${encodeURIComponent(x.id)}">open</a>`,
      ])) || empty('No witnesses yet — add the first person to be examined.');

    let workspace = '';
    if (w) {
      const topics = allTopics.filter((t) => t.witnessId === w.id).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      const digests = allDigests.filter((d) => d.witnessId === w.id).slice().sort((a, b) => String(a.pl).localeCompare(String(b.pl), undefined, { numeric: true }));
      const matching = facts.filter((f) => actorMatch(f.actor, w.name));
      const pulled = new Set(topics.map((t) => t.factId).filter(Boolean));
      const fresh = matching.filter((f) => !pulled.has(f.id)).length;
      const factOpts = [['', '— none paired —'], ...facts.map((f) => [f.id, `${f.date || '?'} — ${String(f.text || '').slice(0, 70)}`])];
      const impeach = digests.filter((d) => d.kind === 'impeachment-candidate');

      const outlineRows = topics.map((t, i) => [
        `<span class="num">${i + 1}</span>`,
        esc(t.topic),
        t.source ? `<span class="num">${esc(t.source)}</span>` : '—',
        t.factId ? tag('from chronology', 'navy') : tag('manual'),
        `<form method="POST" action="/r/depositions/topic-del" style="display:inline"><input type="hidden" name="id" value="${esc(t.id)}"><input type="hidden" name="witnessId" value="${esc(w.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form>`,
      ]);

      const digestRows = digests.map((d) => [
        `<span class="num">${esc(d.pl)}</span>`,
        `<span style="font-style:italic">&ldquo;${esc(d.quote)}&rdquo;</span>`,
        kindTag(d.kind),
      ]);

      const impeachRows = impeach.map((d) => {
        const f = d.contraFactId ? facts.find((x) => x.id === d.contraFactId) : null;
        return [
          `<span class="num">${esc(d.pl)}</span>`,
          `<span style="font-style:italic">&ldquo;${esc(d.quote)}&rdquo;</span>`,
          f ? `${esc(f.text)} <span class="note">(${esc(f.date || '?')})</span>` : tag('no fact paired', 'gate'),
          f ? `<span class="num">${esc(f.source || '')}</span>` : '<span class="note">pair one when logging the entry</span>',
        ];
      });

      // The motion chart: this witness's refusals and under-advisements, in
      // question order — built from what was captured at digest time.
      const refusals = undertakings
        .filter((u) => u.witnessId === w.id && uKind(u) !== 'undertaking')
        .slice().sort((a, b) => ((parseInt(a.qnum, 10) || 0) - (parseInt(b.qnum, 10) || 0))
          || String(a.pl || '').localeCompare(String(b.pl || ''), undefined, { numeric: true }));
      const chartRows = refusals.map((u) => {
        const od = u.status !== 'answered' && u.due && u.due < now;
        return [
          u.qnum ? `<span class="num">${esc(u.qnum)}</span>` : '—',
          u.pl ? `<span class="num">${esc(u.pl)}</span>` : '—',
          esc(u.text),
          esc(u.ground || '—'),
          esc(u.sought || '—'),
          u.status === 'answered'
            ? `Answered ${esc(String(u.answered || '').slice(0, 10))}`
            : od ? 'OUTSTANDING — overdue'
              : uKind(u) === 'under-advisement' ? 'Under advisement' : 'Refused',
        ];
      });

      workspace = `
      <div class="no-print">
      <h2 class="sec">Examination workspace — ${esc(w.name)} ${sideTag(w.side)}</h2>
      ${kv([
        ['Role', esc(w.role || '—')],
        ['Examination', w.examDate ? date(w.examDate) : '<span class="note">not scheduled</span>'],
        ['Chronology hits', `<span class="num">${matching.length}</span> fact${matching.length === 1 ? '' : 's'} name this witness as actor`],
      ])}
      <div class="grid2" style="margin-top:14px">
        <div class="card">
          <h2 class="sec" style="margin-top:0">Outline — ${topics.length} numbered topic${topics.length === 1 ? '' : 's'}</h2>
          ${outlineRows.length ? table(['#', 'Topic', 'Source pin', 'Origin', ''], outlineRows)
            : empty(facts.length ? 'No topics yet — pull the chronology facts this witness figures in, or add one by hand.' : 'No topics yet — add one by hand, or build the timeline first in Chronology.')}
          ${fresh ? `<form method="POST" action="/r/depositions/pull" style="display:inline">
            <input type="hidden" name="witnessId" value="${esc(w.id)}">
            <button>Pull ${fresh} new fact${fresh === 1 ? '' : 's'} from chronology</button>
          </form>
          <p class="note">Each pulled fact lands as a numbered topic carrying the fact&rsquo;s source pin — the document is in hand when the question is asked. Already-pulled facts are skipped.</p>`
            : `<p class="note" style="margin-top:14px">${matching.length
              ? 'Every chronology fact naming this witness is already in the outline.'
              : `No chronology fact names ${esc(w.name)} as actor — build the timeline in <a href="/r/chronology">Chronology</a> and pulled topics arrive with their source pins.`}</p>`}
          <form method="POST" action="/r/depositions/topic">
            <input type="hidden" name="witnessId" value="${esc(w.id)}">
            ${input('topic', 'Manual topic', { required: true, placeholder: 'Walk through the March 4 board minutes' })}
            ${input('source', 'Source pin', { placeholder: 'Ex. 12 · doc id · prior affidavit para 8' })}
            <button>Add topic</button>
          </form>
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">Transcript digest — ${digests.length} entr${digests.length === 1 ? 'y' : 'ies'}</h2>
          ${digestRows.length ? table(['Page:line', 'Quote', 'Kind', ''], digests.map((d, i) => digestRows[i].concat(
            `<form method="POST" action="/r/depositions/digest-del" style="display:inline"><input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="witnessId" value="${esc(w.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form>`
          ))) : empty('No digest entries yet — when the transcript lands, index it page:line by page:line.')}
          <form method="POST" action="/r/depositions/digest">
            <input type="hidden" name="witnessId" value="${esc(w.id)}">
            <div class="grid2">
              <span>${input('pl', 'Page:line', { required: true, placeholder: '41:12' })}</span>
              <span>${select('kind', 'Kind', KINDS)}</span>
            </div>
            ${textarea('quote', 'Quote — verbatim', { required: true, placeholder: 'Q. ... A. ...' })}
            ${select('contraFactId', 'Contradicting fact — impeachment candidates', factOpts)}
            <button>Log entry</button>
          </form>
          ${facts.length ? '' : '<p class="note">No chronology facts on this matter yet, so there is nothing to pair an impeachment candidate against.</p>'}
        </div>
      </div>
      <h2 class="sec">Impeachment table — ${esc(w.name)}</h2>
      ${impeachRows.length
        ? table(['Transcript at', 'What the witness said', 'Contradicting fact (chronology)', 'Fact source pin'], impeachRows)
        : empty('Nothing flagged yet — log a digest entry as an impeachment candidate and pair it with the fact it contradicts.')}
      <p class="note">Page:line on one side, the sourced fact on the other — the pairing is what makes the confrontation usable in the Trial Book.</p>
      </div>
      <div id="refusals-chart">
        <div class="print-only" style="margin-bottom:12px">
          <b>${esc(ctx.matter.title)}</b><br>
          Refusals and under-advisements — ${esc(w.name)}${w.examDate ? `, examined ${esc(w.examDate)}` : ''}<br>
          <span class="num">${esc(now)}</span>
        </div>
        <h2 class="sec no-print">Refusals chart — motion-ready ${chartRows.length ? tag(`${chartRows.length} on the chart`, 'navy') : ''}</h2>
        ${chartRows.length
          ? table(['Q#', 'Page:line', 'Question as put', 'Ground of refusal', 'Answer sought', 'Status'], chartRows)
          : empty('Nothing refused or taken under advisement by this witness — the chart builds itself from the register below.')}
      </div>
      <p class="note no-print">Print the page and the chart is what comes out, in the tabular form the Toronto Region consolidated practice direction expects — no rebuilding it in Word. Move on refusals before the discovery cutoff: r. 31.07 bars leading the withheld information at trial without leave.</p>
      `;
    } else if (witnesses.length) {
      workspace = `<p class="note no-print">Open a witness on the bench above to build the outline, digest the transcript, and work the impeachment table.</p>`;
    }

    const wName = new Map(witnesses.map((x) => [x.id, x.name]));
    const openU = undertakings.filter((u) => u.status !== 'answered');
    const overdueN = openU.filter((u) => u.due && u.due < now).length;
    const uRows = undertakings.map((u) => {
      const overdue = u.status !== 'answered' && u.due && u.due < now;
      return [
        esc(wName.get(u.witnessId) || '—'),
        uKindTag(uKind(u)),
        u.qnum ? `<span class="num">${esc(u.qnum)}</span>` : '—',
        u.pl ? `<span class="num">${esc(u.pl)}</span>` : '—',
        `${esc(u.text)}${u.ground ? ` <span class="note">ground: ${esc(u.ground)}</span>` : ''}`,
        date(u.given),
        `${date(u.due)}${u.basis ? ` <span class="note">${esc(u.basis)}</span>` : ''}`,
        u.status === 'answered'
          ? `${tag('answered', 'ok')} ${date(u.answered)}`
          : overdue ? tag('OVERDUE', 'gate') : tag('open'),
        u.status === 'answered' ? '' :
          `<form method="POST" action="/r/depositions/answer" style="display:inline"><input type="hidden" name="id" value="${esc(u.id)}"><button class="quiet" style="margin-top:0">answered today</button></form>`,
      ];
    });

    const body = `
    ${PRINT}
    <div class="grid2 no-print">
      <div class="card">
        <h2 class="sec" style="margin-top:0">The bench — ${esc(ctx.matter.title)}</h2>
        ${bench}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a witness</h2>
        <form method="POST" action="/r/depositions/witness">
          ${input('name', 'Name', { required: true, placeholder: 'e.g. J. Doe' })}
          <div class="grid2">
            <span>${select('side', 'Side', SIDES)}</span>
            <span>${input('examDate', 'Examination date', { type: 'date' })}</span>
          </div>
          ${input('role', 'Role', { placeholder: 'CFO · eyewitness · corporate representative' })}
          <button>Add to the bench</button>
        </form>
        <p class="note">Scope on the record: a US deposition is limited to one day of seven hours (FRCP 30(d)(1)); an Ontario examination for discovery runs to seven hours per examining party (r. 31.05.1) and runs on undertakings (r. 31.07).</p>
      </div>
    </div>
    ${workspace}
    <div class="no-print">
    <h2 class="sec">Undertakings, refusals &amp; under-advisements ${openU.length ? tag(`${openU.length} open`, overdueN ? '' : 'navy') : ''} ${overdueN ? tag(`${overdueN} overdue`, 'gate') : ''}</h2>
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">The register</h2>
        ${uRows.length ? table(['Witness', 'Kind', 'Q#', 'Page:line', 'Text', 'Given', 'Due', 'Status', ''], uRows)
          : empty('Nothing tracked on this matter — record the first promise made on the record.')}
        <p class="note">Answers on a Canadian examination are promised on the record and forgotten off it; the register is what keeps the promise. Overdue means the due date passed with no answer recorded. Refusals ride the same register so nothing is moved on late.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Track one</h2>
        ${witnesses.length ? `
        <form method="POST" action="/r/depositions/undertaking">
          <div class="grid2">
            <span>${select('witnessId', 'Witness', witnesses.map((x) => [x.id, x.name]), w ? w.id : undefined)}</span>
            <span>${select('kind', 'Kind', UKINDS)}</span>
          </div>
          ${textarea('text', 'As given — the undertaking, or the question refused', { required: true, placeholder: 'To produce the 2024 maintenance invoices for the plant.' })}
          <div class="grid2">
            <span>${input('qnum', 'Question no.', { placeholder: '417' })}</span>
            <span>${input('pl', 'Page:line', { placeholder: '41:12' })}</span>
            <span>${input('ground', 'Ground — refusals only', { placeholder: 'relevance · privilege · proportionality' })}</span>
            <span>${input('sought', 'Answer sought — refusals only', { placeholder: 'Production of the 2019 audit file.' })}</span>
            <span>${input('given', 'Given', { type: 'date' })}</span>
            <span>${input('due', 'Due', { type: 'date' })}</span>
          </div>
          <button>Track it</button>
        </form>
        <p class="note">Blank given reads as today. A blank due date computes from the date given: ${uRule ? `${uRule.days} days per ${esc(uRule.cite)}, rolled forward off weekends and court holidays` : 'a 60-day house default — no undertakings rule is on file for this jurisdiction, and the practice is Canadian'}. Whichever applies is recorded on the row.</p>`
          : empty('Add a witness first — an undertaking attaches to the examination it was given in.')}
      </div>
    </div>
    ${crossBoard(k, ctx.matters, now)}
    </div>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });

  app.route('POST', `/r/${ROOM.id}/witness`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); back(res); return; }
    const name = String(ctx.body.name || '').trim();
    if (!name) { ctx.setFlash('A witness needs a name.', 'err'); back(res); return; }
    const examDate = String(ctx.body.examDate || '').trim();
    if (examDate && !ISO.test(examDate)) { ctx.setFlash('Examination date must be YYYY-MM-DD.', 'err'); back(res); return; }
    const side = SIDES.some(([v]) => v === ctx.body.side) ? ctx.body.side : 'theirs';
    const rec = ctx.kernel.scope(ctx.matter.id).put('witness', {
      name, side, role: String(ctx.body.role || '').trim(), examDate: examDate || null,
    });
    ctx.setFlash(`${name} added to the bench.`);
    back(res, rec.id);
  });

  app.route('POST', `/r/${ROOM.id}/pull`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); back(res); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const w = ctx.body.witnessId ? s.get('witness', ctx.body.witnessId) : null;
    if (!w) { ctx.setFlash('Witness not found.', 'err'); back(res); return; }
    const topics = s.list('depoTopic', (t) => t.witnessId === w.id);
    const pulled = new Set(topics.map((t) => t.factId).filter(Boolean));
    let order = topics.reduce((m, t) => Math.max(m, t.order || 0), 0);
    const fresh = s.list('fact', (f) => actorMatch(f.actor, w.name) && !pulled.has(f.id))
      .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    for (const f of fresh) {
      s.put('depoTopic', { witnessId: w.id, order: ++order, topic: f.text, source: f.source, factId: f.id });
    }
    ctx.setFlash(fresh.length
      ? `Pulled ${fresh.length} chronology fact${fresh.length === 1 ? '' : 's'} into the outline, source pins attached.`
      : `No new chronology facts name ${w.name} as actor — nothing to pull.`);
    back(res, w.id);
  });

  app.route('POST', `/r/${ROOM.id}/topic`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); back(res); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const w = ctx.body.witnessId ? s.get('witness', ctx.body.witnessId) : null;
    if (!w) { ctx.setFlash('Witness not found.', 'err'); back(res); return; }
    const topic = String(ctx.body.topic || '').trim();
    if (!topic) { ctx.setFlash('State the topic.', 'err'); back(res, w.id); return; }
    const order = s.list('depoTopic', (t) => t.witnessId === w.id).reduce((m, t) => Math.max(m, t.order || 0), 0) + 1;
    s.put('depoTopic', { witnessId: w.id, order, topic, source: String(ctx.body.source || '').trim() || null });
    ctx.setFlash('Topic added to the outline.');
    back(res, w.id);
  });

  app.route('POST', `/r/${ROOM.id}/topic-del`, (req, res, ctx) => {
    if (!ctx.matter) { back(res); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const t = ctx.body.id ? s.get('depoTopic', ctx.body.id) : null;
    if (!t) { ctx.setFlash('Topic not found.', 'err'); back(res, ctx.body.witnessId); return; }
    s.del('depoTopic', t.id);
    ctx.setFlash('Topic dropped from the outline.');
    back(res, t.witnessId);
  });

  app.route('POST', `/r/${ROOM.id}/digest`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); back(res); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const w = ctx.body.witnessId ? s.get('witness', ctx.body.witnessId) : null;
    if (!w) { ctx.setFlash('Witness not found.', 'err'); back(res); return; }
    const pl = String(ctx.body.pl || '').trim();
    if (!PL.test(pl)) { ctx.setFlash('Cite the transcript as page:line, e.g. 41:12.', 'err'); back(res, w.id); return; }
    const quote = String(ctx.body.quote || '').trim();
    if (!quote) { ctx.setFlash('A digest entry needs the verbatim quote.', 'err'); back(res, w.id); return; }
    const kind = KINDS.some(([v]) => v === ctx.body.kind) ? ctx.body.kind : 'admission';
    const contra = ctx.body.contraFactId ? s.get('fact', ctx.body.contraFactId) : null;
    s.put('digest', { witnessId: w.id, pl, quote, kind, contraFactId: contra ? contra.id : null });
    ctx.setFlash(kind === 'impeachment-candidate'
      ? (contra ? `Impeachment candidate logged at ${pl}, paired with the contradicting fact.` : `Impeachment candidate logged at ${pl} — no contradicting fact paired yet.`)
      : `Digest entry logged at ${pl}.`);
    back(res, w.id);
  });

  app.route('POST', `/r/${ROOM.id}/digest-del`, (req, res, ctx) => {
    if (!ctx.matter) { back(res); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const d = ctx.body.id ? s.get('digest', ctx.body.id) : null;
    if (!d) { ctx.setFlash('Digest entry not found.', 'err'); back(res, ctx.body.witnessId); return; }
    s.del('digest', d.id);
    ctx.setFlash('Digest entry dropped.');
    back(res, d.witnessId);
  });

  app.route('POST', `/r/${ROOM.id}/undertaking`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); back(res); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const w = ctx.body.witnessId ? s.get('witness', ctx.body.witnessId) : null;
    if (!w) { ctx.setFlash('Pick the witness who gave the undertaking.', 'err'); back(res); return; }
    const text = String(ctx.body.text || '').trim();
    if (!text) { ctx.setFlash('Record the undertaking as given.', 'err'); back(res, w.id); return; }
    const kind = UKINDS.some(([v]) => v === ctx.body.kind) ? ctx.body.kind : 'undertaking';
    const qnum = String(ctx.body.qnum || '').trim() || null;
    const pl = String(ctx.body.pl || '').trim();
    if (pl && !PL.test(pl)) { ctx.setFlash('Page:line must read like 41:12.', 'err'); back(res, w.id); return; }
    const ground = kind !== 'undertaking' ? String(ctx.body.ground || '').trim() || null : null;
    const sought = kind !== 'undertaking' ? String(ctx.body.sought || '').trim() || null : null;
    const given = String(ctx.body.given || '').trim() || today();
    if (!ISO.test(given)) { ctx.setFlash('Given date must be YYYY-MM-DD.', 'err'); back(res, w.id); return; }
    let due = String(ctx.body.due || '').trim();
    let basis = 'set by hand';
    if (due && !ISO.test(due)) { ctx.setFlash('Due date must be YYYY-MM-DD.', 'err'); back(res, w.id); return; }
    if (!due) {
      const d = defaultDue(ctx.kernel, ctx.matter.jurisdiction, given);
      due = d.due; basis = d.basis;
    }
    s.put('undertaking', { witnessId: w.id, kind, qnum, pl: pl || null, ground, sought, text, given, due, basis, answered: null, status: 'open' });
    const label = kind === 'refusal' ? 'Refusal' : kind === 'under-advisement' ? 'Under-advisement' : 'Undertaking';
    ctx.setFlash(`${label} tracked — due ${due} (${basis}).`);
    back(res, w.id);
  });

  app.route('POST', `/r/${ROOM.id}/answer`, (req, res, ctx) => {
    if (!ctx.matter) { back(res); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const u = ctx.body.id ? s.get('undertaking', ctx.body.id) : null;
    if (!u) { ctx.setFlash('Undertaking not found.', 'err'); back(res); return; }
    s.put('undertaking', { ...u, answered: today(), status: 'answered' });
    ctx.setFlash('Undertaking marked answered.');
    back(res, u.witnessId);
  });

  // Matter-qualified mark-answered for the cross-matter board: the row names
  // its own matter, so ctx.matter (whatever is open, or nothing) is not used.
  // Walls and shredding are enforced by k.scope, which throws — caught here.
  app.route('POST', `/r/${ROOM.id}/answer-x`, (req, res, ctx) => {
    const k = ctx.kernel;
    const matterId = String(ctx.body.matterId || '').trim();
    const id = String(ctx.body.id || '').trim();
    if (!matterId || !id) { ctx.setFlash('The board answer needs both the matter and the undertaking.', 'err'); back(res); return; }
    let s;
    try { s = k.scope(matterId); } catch { ctx.setFlash('Matter unavailable.', 'err'); back(res); return; }
    const u = s.get('undertaking', id);
    if (!u) { ctx.setFlash('Undertaking not found on that matter.', 'err'); back(res); return; }
    s.put('undertaking', { ...u, answered: today(), status: 'answered' });
    k.audit('undertaking.answered', matterId + ':' + id);
    ctx.setFlash('Undertaking marked answered.');
    back(res);
  });
}

module.exports = { ...ROOM, register };
