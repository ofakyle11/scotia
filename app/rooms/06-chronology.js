'use strict';
// Room 06 — Chronology. The sourced fact timeline: no source pin, no fact.
const { layout, esc, table, empty, tag, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 6, id: 'chronology', title: 'Chronology', phase: 'Build' };

const GAP_DAYS = 90;
const SUB = 'The sourced fact timeline — no pin, no fact';
const today = () => new Date().toISOString().slice(0, 10);

// Round-trip an ISO date so '2026-02-31' is refused rather than silently rolled
// forward to March 3 — a fact dated on a day nobody lived reorders the timeline
// and poisons the gap arithmetic downstream.
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z'), db = new Date(b + 'T00:00:00Z');
  if (isNaN(da) || isNaN(db)) return 0;
  return Math.round((db - da) / 86400000);
}

// One place builds every filtered link, so a click on an actor keeps the issue
// filter (and the other way round) instead of silently dropping it.
function filterHref(path, actor, issue) {
  const q = [];
  if (actor) q.push('actor=' + encodeURIComponent(actor));
  if (issue) q.push('issue=' + encodeURIComponent(issue));
  return path + (q.length ? '?' + q.join('&') : '');
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body: empty('Open a matter to build its chronology — take an inquiry through Intake (01) to open one.') }));
      return;
    }
    const facts = k.scope(ctx.matter.id).list('fact')
      .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const actorFilter = (ctx.query.get('actor') || '').trim();
    const issueFilter = (ctx.query.get('issue') || '').trim();
    const filtering = Boolean(actorFilter || issueFilter);
    const shown = facts.filter((f) =>
      (!actorFilter || f.actor === actorFilter) &&
      (!issueFilter || (f.issues || []).includes(issueFilter)));

    const disputed = facts.filter((f) => f.disputed).length;
    const undisputed = facts.length - disputed;
    const actors = [...new Set(facts.map((f) => f.actor).filter(Boolean))].sort();
    const issues = [...new Set(facts.flatMap((f) => f.issues || []))].sort();
    const span = facts.length ? `${String(facts[0].date || '').slice(0, 10)} → ${String(facts[facts.length - 1].date || '').slice(0, 10)}` : '';

    // Gaps are measured on the FULL timeline; a filtered view would invent gaps.
    let gapCount = 0;
    for (let i = 1; i < facts.length; i++) {
      if (daysBetween(facts[i - 1].date, facts[i].date) > GAP_DAYS) gapCount++;
    }

    const rows = [];
    for (let i = 0; i < shown.length; i++) {
      const f = shown[i];
      if (!filtering && i > 0) {
        const gap = daysBetween(shown[i - 1].date, f.date);
        if (gap > GAP_DAYS) {
          rows.push(['', tag(`gap — ${gap} days`, 'gate'),
            `<span class="note">No sourced fact for ${gap} days. What happened in between?</span>`, '', '', '', '']);
        }
      }
      rows.push([
        date(f.date),
        // Actor and issue cells are one-click filters — the common move on a long
        // chronology is "everything this witness did", not a trip to the select.
        f.actor
          ? `<a href="${esc(filterHref('/r/chronology', f.actor, issueFilter))}">${esc(f.actor)}</a>`
          : '—',
        esc(f.text),
        `<span class="num">${esc(f.source)}</span>`,
        (f.issues || []).map((t) => `<a href="${esc(filterHref('/r/chronology', actorFilter, t))}">${tag(t, 'navy')}</a>`).join(' ') || '—',
        f.disputed ? tag('disputed', 'gate') : tag('undisputed', 'ok'),
        `<form method="POST" action="/r/chronology/dispute" style="display:inline"><input type="hidden" name="id" value="${esc(f.id)}"><button class="quiet">${f.disputed ? 'mark undisputed' : 'mark disputed'}</button></form>
         <form method="POST" action="/r/chronology/del" style="display:inline;margin-left:6px"><input type="hidden" name="id" value="${esc(f.id)}"><button class="quiet danger" style="padding:4px 10px;margin-top:0">drop</button></form>`,
      ]);
    }

    const body = `
    <p class="note print-only">Chronology — ${esc(ctx.matter.title)} — as at ${esc(today())}${filtering ? ' — FILTERED EXTRACT, not the whole timeline' : ''}</p>
    <div class="grid2 no-print">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Add a fact</h2>
        <form method="POST" action="/r/chronology/add">
          <div class="grid2">
            <span>${input('date', 'Date of fact', { type: 'date', required: true })}</span>
            <span>${input('factActor', 'Actor (who did it)', { required: true, placeholder: 'e.g. Harness Holdings, J. Doe' })}</span>
          </div>
          ${textarea('text', 'The fact — one sentence, past tense', { required: true, placeholder: 'What happened, stated neutrally.' })}
          ${input('source', 'Source pin (required)', { required: true, placeholder: "Ex. 4 p.2 · Doe transcript 41:12 · document id" })}
          <div class="grid2">
            <span>${select('disputed', 'Disputed?', [['no', 'Undisputed'], ['yes', 'Disputed — the other side contests it']], 'no')}</span>
            <span>${input('issues', 'Issue tags (comma-separated)', { placeholder: 'breach, notice, damages' })}</span>
          </div>
          <button>Enter fact</button>
        </form>
        <p class="note"><b>Source-or-drop.</b> No pin, no fact — the room refuses it. Pins are free-text cites (exhibit, transcript, affidavit) or an Evidence Room document id.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">State of the record</h2>
        <p>
          ${tag(`${facts.length} facts`)} ${tag(`${undisputed} undisputed`, 'ok')} ${tag(`${disputed} disputed`, disputed ? 'gate' : '')}
          ${gapCount ? tag(`${gapCount} gap${gapCount === 1 ? '' : 's'} > ${GAP_DAYS} days`, 'gate') : tag('no gaps > 90 days', 'ok')}
          ${span ? tag(span, 'navy') : ''}
        </p>
        <form method="GET" action="/r/chronology">
          <div class="grid2">
            <span>${select('actor', 'Filter by actor', [['', 'All actors'], ...actors.map((a) => [a, a])], actorFilter)}</span>
            <span>${select('issue', 'Filter by issue', [['', 'All issues'], ...issues.map((t) => [t, t])], issueFilter)}</span>
          </div>
          <button class="quiet" style="margin-top:12px">Apply filter</button>
          ${filtering ? '<a href="/r/chronology" style="margin-left:10px;font-size:12px">clear</a>' : ''}
        </form>
        <p style="margin-top:14px"><a class="btn" href="${esc(filterHref('/r/chronology/narrative', actorFilter, issueFilter))}" style="margin-top:0">Statement of facts &rarr;</a></p>
        <p class="note">Numbered, sourced, chronological — carries whatever filter is set above. Gaps over ${GAP_DAYS} days are flagged on the full timeline: silence that long usually means missing discovery, not missing events.</p>
      </div>
    </div>
    <h2 class="sec">Timeline — ${esc(ctx.matter.title)}${filtering ? ` <span class="tag navy">filtered — ${shown.length} of ${facts.length}</span>` : ''}</h2>
    ${rows.length
      ? table(['Date', 'Actor', 'Fact', 'Source pin', 'Issues', 'Status', ''], rows)
      : empty(filtering ? 'No facts match this filter — clear it to see the full timeline.' : 'No facts yet — add the first one above. It needs a date, an actor and a source pin.')}
    ${filtering ? '<p class="note">Gap flags are hidden while a filter is on — gaps are only meaningful on the full timeline.</p>' : ''}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });


  // Downstream generator: the sourced timeline as a statement-of-facts
  // narrative (each fact carrying its source pin) plus a print-clean view.
  app.route('GET', `/r/${ROOM.id}/narrative`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { redirect(res, '/r/chronology'); return; }
    const s = k.scope(ctx.matter.id);
    const actor = String(ctx.query.get('actor') || '').trim();
    const issue = String(ctx.query.get('issue') || '').trim();
    const all = s.list('fact').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let facts = all;
    if (actor) facts = facts.filter((f) => (f.actor || '').toLowerCase().includes(actor.toLowerCase()));
    if (issue) facts = facts.filter((f) => (f.issues || []).some((i) => i.toLowerCase().includes(issue.toLowerCase())));
    // A filtered statement of facts must say so on paper, or a partial extract
    // reads as the whole record.
    const filterNote = [actor ? `actor “${actor}”` : '', issue ? `issue “${issue}”` : ''].filter(Boolean).join(' · ');
    const paras = facts.map((f, i) => `<p style="margin:0 0 10px;break-inside:avoid"><b class="num">${i + 1}.</b> On ${esc(f.date || '[date]')}, ${esc(f.actor || '[actor]')}: ${esc(f.text)}${f.disputed ? ' <em>[disputed]</em>' : ''} <span class="note">(${esc(f.source || 'no source')})</span></p>`).join('');
    const body = `
    <div class="no-print" style="margin-bottom:14px">
      <a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a>
      <a href="${esc(filterHref('/r/chronology', actor, issue))}" style="margin-left:12px">&larr; Back to Chronology</a>
      <form method="GET" action="/r/chronology/narrative">
        <div class="grid2">
          <span>${input('actor', 'Actor contains', { value: actor, placeholder: 'blank for every actor' })}</span>
          <span>${input('issue', 'Issue contains', { value: issue, placeholder: 'blank for every issue' })}</span>
        </div>
        <button class="quiet" style="margin-top:12px">Filter</button>
        ${filterNote ? `<a href="/r/chronology/narrative" style="margin-left:10px;font-size:12px">clear</a>` : ''}
      </form>
      <p class="note">Numbered, sourced, chronological — paste into a factum&rsquo;s fact section or print for the trial binder. Disputed facts are flagged; nothing here exists without a source pin.</p>
    </div>
    <div class="card"><h2 class="sec" style="margin-top:0">Statement of facts — ${esc(ctx.matter.title)}${filterNote ? ` ${tag('filtered', 'gate')}` : ''}</h2>
      <p class="note print-only">Prepared ${esc(today())} · ${facts.length} sourced fact${facts.length === 1 ? '' : 's'}${filterNote ? ` · FILTERED EXTRACT — ${esc(filterNote)} — not the whole chronology` : ''}</p>
      ${paras || (all.length
        ? `<p class="note">No fact matches ${esc(filterNote)} — clear the filter to see all ${all.length}.</p>`
        : '<p class="note">No facts on file yet — add the first one in Chronology. It needs a source pin.</p>')}
    </div>`;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: 'Statement of Facts', sub: `${facts.length} sourced facts · chronological${filterNote ? ' · filtered' : ''}`, body }));
  });

  app.route('POST', `/r/${ROOM.id}/add`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/chronology'); return; }
    const source = String(ctx.body.source || '').trim();
    const text = String(ctx.body.text || '').trim();
    const d = String(ctx.body.date || '').trim();
    if (!source) {
      ctx.setFlash('Refused — source-or-drop: a fact does not enter the chronology without a source pin. Cite the exhibit, transcript, or document id.', 'err');
      redirect(res, '/r/chronology'); return;
    }
    if (!text) { ctx.setFlash('State the fact — one sentence of what happened.', 'err'); redirect(res, '/r/chronology'); return; }
    if (!isRealDate(d)) {
      ctx.setFlash(`A fact needs a real calendar date (YYYY-MM-DD)${d ? ` — "${d}" is not one` : ''}.`, 'err');
      redirect(res, '/r/chronology'); return;
    }
    ctx.kernel.scope(ctx.matter.id).put('fact', {
      date: d,
      // The entry field is named factActor so its label cannot collide with the
      // filter select's `actor` id on the same page; `actor` is still accepted.
      actor: String(ctx.body.factActor || ctx.body.actor || '').trim() || 'Unattributed',
      text,
      source,
      disputed: ctx.body.disputed === 'yes',
      issues: String(ctx.body.issues || '').split(',').map((s) => s.trim()).filter(Boolean),
    });
    ctx.setFlash(`Fact entered, pinned to ${source}.`);
    redirect(res, '/r/chronology');
  });

  app.route('POST', `/r/${ROOM.id}/dispute`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/chronology'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const f = ctx.body.id ? s.get('fact', ctx.body.id) : null;
    if (!f) { ctx.setFlash('Fact not found.', 'err'); redirect(res, '/r/chronology'); return; }
    s.put('fact', { ...f, disputed: !f.disputed });
    ctx.setFlash(f.disputed ? 'Marked undisputed.' : 'Marked disputed — it now needs proof, not agreement.');
    redirect(res, '/r/chronology');
  });

  app.route('POST', `/r/${ROOM.id}/del`, (req, res, ctx) => {
    if (!ctx.matter) { redirect(res, '/r/chronology'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const f = ctx.body.id ? s.get('fact', ctx.body.id) : null;
    if (!f) { ctx.setFlash('Fact not found.', 'err'); redirect(res, '/r/chronology'); return; }
    s.del('fact', f.id);
    ctx.setFlash('Fact dropped from the chronology.');
    redirect(res, '/r/chronology');
  });
}

module.exports = { ...ROOM, register };
