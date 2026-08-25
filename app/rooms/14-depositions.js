'use strict';
// Room 14 — Depositions. Outlines out — digests back.
// Witnesses per matter; outlines pulled from the sourced chronology; transcript
// digests indexed; impeachment candidates paired with the fact they contradict;
// undertakings tracked to answer (Canadian practice runs on them).
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 14, id: 'depositions', title: 'Depositions', phase: 'Discover' };
const SUB = 'Outlines out — digests back';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PL = /^\d{1,5}:\d{1,4}$/;
const SIDES = [['theirs', 'Theirs — adverse'], ['ours', 'Ours'], ['third-party', 'Third party']];
const KINDS = [['admission', 'Admission'], ['denial', 'Denial'], ['impeachment-candidate', 'Impeachment candidate']];

const today = () => new Date().toISOString().slice(0, 10);

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

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body: empty('Open a matter to prepare its examinations.') }));
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

    const bench = table(['Witness', 'Side', 'Role', 'Examination', 'Outline', 'Digest', ''],
      witnesses.map((x) => [
        `<a href="/r/depositions?w=${encodeURIComponent(x.id)}"><b>${esc(x.name)}</b></a>`,
        sideTag(x.side),
        esc(x.role || '—'),
        x.examDate ? date(x.examDate) : '<span class="note">not scheduled</span>',
        `<span class="num">${allTopics.filter((t) => t.witnessId === x.id).length} topics</span>`,
        `<span class="num">${allDigests.filter((d) => d.witnessId === x.id).length} entries</span>`,
        w && w.id === x.id ? tag('open', 'navy') : `<a href="/r/depositions?w=${encodeURIComponent(x.id)}">open</a>`,
      ])) || empty('No witnesses yet. Add the people to be examined.');

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

      workspace = `
      <h2 class="sec">Examination workspace — ${esc(w.name)} ${sideTag(w.side)}</h2>
      ${kv([
        ['Role', esc(w.role || '—')],
        ['Examination', w.examDate ? date(w.examDate) : '<span class="note">not scheduled</span>'],
        ['Chronology hits', `<span class="num">${matching.length}</span> fact${matching.length === 1 ? '' : 's'} name this witness as actor`],
      ])}
      <div class="grid2" style="margin-top:14px">
        <div class="card">
          <h2 class="sec" style="margin-top:0">Outline — ${topics.length} numbered topic${topics.length === 1 ? '' : 's'}</h2>
          ${outlineRows.length ? table(['#', 'Topic', 'Source pin', 'Origin', ''], outlineRows) : empty('No topics yet. Pull from the chronology or add one by hand.')}
          <form method="POST" action="/r/depositions/pull" style="display:inline">
            <input type="hidden" name="witnessId" value="${esc(w.id)}">
            <button ${fresh ? '' : 'class="quiet"'}>Pull ${fresh} new fact${fresh === 1 ? '' : 's'} from chronology</button>
          </form>
          <p class="note">Pulling imports every chronology fact whose actor matches this witness — each lands as a numbered topic carrying the fact&rsquo;s source pin, so the document is in hand when the question is asked. Already-pulled facts are skipped.</p>
          <form method="POST" action="/r/depositions/topic">
            <input type="hidden" name="witnessId" value="${esc(w.id)}">
            ${input('topic', 'Manual topic', { required: true, placeholder: 'Walk through the March 4 board minutes' })}
            ${input('source', 'Source pin (optional)', { placeholder: 'Ex. 12 · doc id · prior affidavit para 8' })}
            <button>Add topic</button>
          </form>
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">Transcript digest</h2>
          ${digestRows.length ? table(['Page:line', 'Quote', 'Kind', ''], digests.map((d, i) => digestRows[i].concat(
            `<form method="POST" action="/r/depositions/digest-del" style="display:inline"><input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="witnessId" value="${esc(w.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form>`
          ))) : empty('No digest entries yet. When the transcript lands, index it here.')}
          <form method="POST" action="/r/depositions/digest">
            <input type="hidden" name="witnessId" value="${esc(w.id)}">
            ${input('pl', 'Page:line', { required: true, placeholder: '41:12' })}
            ${textarea('quote', 'Quote (verbatim from the transcript)', { required: true, placeholder: 'Q. ... A. ...' })}
            ${select('kind', 'Kind', KINDS)}
            ${select('contraFactId', 'Contradicting chronology fact (for impeachment candidates)', factOpts)}
            <button>Log entry</button>
          </form>
        </div>
      </div>
      <h2 class="sec">Impeachment table — ${esc(w.name)}</h2>
      ${impeachRows.length
        ? table(['Transcript at', 'What the witness said', 'Contradicting fact (chronology)', 'Fact source pin'], impeachRows)
        : empty('No impeachment candidates flagged for this witness yet.')}
      <p class="note">Every digest entry flagged as an impeachment candidate is set against the prior statement or sourced fact it contradicts — page:line on one side, the pin on the other, ready for the Trial Book.</p>
      `;
    } else if (witnesses.length) {
      workspace = `<p class="note">Select a witness from the bench above to build the outline, digest the transcript, and work the impeachment table.</p>`;
    }

    const wName = new Map(witnesses.map((x) => [x.id, x.name]));
    const openU = undertakings.filter((u) => u.status !== 'answered');
    const overdueN = openU.filter((u) => u.due && u.due < now).length;
    const uRows = undertakings.map((u) => {
      const overdue = u.status !== 'answered' && u.due && u.due < now;
      return [
        esc(wName.get(u.witnessId) || '—'),
        esc(u.text),
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
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a witness</h2>
        <form method="POST" action="/r/depositions/witness">
          ${input('name', 'Name', { required: true, placeholder: 'e.g. J. Doe' })}
          ${select('side', 'Side', SIDES)}
          ${input('role', 'Role', { placeholder: 'CFO · eyewitness · corporate representative' })}
          ${input('examDate', 'Examination date', { type: 'date' })}
          <button>Add to the bench</button>
        </form>
        <p class="note">Reference on scope: a US deposition is limited to one day of seven hours (FRCP 30(d)(1)); an Ontario examination for discovery runs to seven hours total per examining party (r. 31.05.1) and runs on undertakings (r. 31.07).</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">The bench — ${esc(ctx.matter.title)}</h2>
        ${bench}
      </div>
    </div>
    ${workspace}
    <h2 class="sec">Undertakings ${openU.length ? tag(`${openU.length} open`, overdueN ? '' : 'navy') : ''} ${overdueN ? tag(`${overdueN} overdue`, 'gate') : ''}</h2>
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Track an undertaking</h2>
        ${witnesses.length ? `
        <form method="POST" action="/r/depositions/undertaking">
          ${select('witnessId', 'Witness', witnesses.map((x) => [x.id, x.name]), w ? w.id : undefined)}
          ${textarea('text', 'Undertaking as given', { required: true, placeholder: 'To produce the 2024 maintenance invoices for the plant.' })}
          ${input('given', 'Given (examination date — blank = today)', { type: 'date' })}
          ${input('due', 'Due (blank = rule default)', { type: 'date' })}
          <button>Track it</button>
        </form>` : empty('Add a witness first — undertakings attach to an examination.')}
        <p class="note">A blank due date computes from the date given: ${uRule ? `${uRule.days} days per ${esc(uRule.cite)}, rolled forward off weekends and court holidays` : 'a 60-day house default (no undertakings rule on file for this jurisdiction — the practice is Canadian)'}.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">The register</h2>
        ${uRows.length ? table(['Witness', 'Undertaking', 'Given', 'Due', 'Status', ''], uRows) : empty('No undertakings tracked on this matter.')}
        <p class="note">Answers on Canadian examinations are promised on the record and forgotten off it — the register is what keeps the promise. Overdue means due date passed with no answer recorded.</p>
      </div>
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
    const given = String(ctx.body.given || '').trim() || today();
    if (!ISO.test(given)) { ctx.setFlash('Given date must be YYYY-MM-DD.', 'err'); back(res, w.id); return; }
    let due = String(ctx.body.due || '').trim();
    let basis = 'set by hand';
    if (due && !ISO.test(due)) { ctx.setFlash('Due date must be YYYY-MM-DD.', 'err'); back(res, w.id); return; }
    if (!due) {
      const d = defaultDue(ctx.kernel, ctx.matter.jurisdiction, given);
      due = d.due; basis = d.basis;
    }
    s.put('undertaking', { witnessId: w.id, text, given, due, basis, answered: null, status: 'open' });
    ctx.setFlash(`Undertaking tracked — due ${due} (${basis}).`);
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
}

module.exports = { ...ROOM, register };
