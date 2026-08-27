'use strict';
// Room 02 — Ethics & Conflicts. The party graph and the screen: every name
// checked against every matter, inquiry and party on file before anyone bills.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 2, id: 'conflicts', title: 'Ethics & Conflicts', phase: 'Intake' };

const ROLES = ['Client', 'Adverse party', 'Related entity', 'Corporate parent', 'Insurer', 'Witness', 'Lateral hire'];
const OUTCOMES = [['clear', 'clear'], ['waiver', 'waiver needed'], ['declined', 'declined']];

// Corporate noise words dropped before matching — "Smith Holdings LLC" should
// hit "Smith" but "Holdings" alone should not connect two strangers.
const STOP = new Set(['inc', 'llc', 'llp', 'ltd', 'lp', 'plc', 'corp', 'corporation', 'co', 'company',
  'holdings', 'group', 'the', 'and', 'of', 'les', 'inc', 'sa', 'gmbh', 'limited', 'partners', 'partnership']);

function tokens(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
}
function matchTokens(queryToks, name) {
  const nt = tokens(name);
  return queryToks.filter((t) => nt.includes(t));
}

// Every name the firm has ever touched, with where it came from — as visible
// to THIS caller. Matters enumerate wall-aware (k.matters(), never the raw
// firm list), and parties attached to a screened matter stay behind the
// screen: a conflict check must never read a walled matter's identity —
// title, client, adverse parties — back to the very user the wall screens
// off. Each hit carries the matter it came from (mid) so stored runs can be
// wall-filtered again when rendered to a later viewer.
function candidates(k) {
  const out = [];
  const visible = new Set();
  for (const m of k.matters()) {
    visible.add(m.id);
    const from = `matter — ${m.title || m.client || m.id}`;
    if (m.client) out.push({ name: m.client, via: 'client', from, mid: m.id });
    for (const a of m.adverse || []) if (a) out.push({ name: a, via: 'adverse party', from, mid: m.id });
  }
  for (const i of k.firm.list('inquiry')) {
    const from = `inquiry — ${i.client || i.id} (${i.status || 'screening'})`;
    if (i.client) out.push({ name: i.client, via: 'prospective client', from });
    for (const a of i.adverse || []) if (a) out.push({ name: a, via: 'adverse party', from });
  }
  for (const p of k.firm.list('party')) {
    if (p.matterId && !visible.has(p.matterId)) continue; // screened matter — its parties stay behind the wall
    const from = partyWhere(k, p);
    if (p.name) out.push({ name: p.name, via: `party — ${p.role || 'unspecified role'}`, from, mid: p.matterId || undefined });
    for (const a of p.aliases || []) if (a) out.push({ name: a, via: `alias of ${p.name}`, from, mid: p.matterId || undefined });
  }
  return out;
}

function partyWhere(k, p) {
  if (p.matterId) {
    const m = k.firm.get('matter', p.matterId);
    return `matter — ${m ? m.title : p.matterId}`;
  }
  if (p.inquiryId) {
    const i = k.firm.get('inquiry', p.inquiryId);
    return `inquiry — ${i ? i.client : p.inquiryId}`;
  }
  return 'firm directory (unattached)';
}

function runCheck(k, name) {
  const qt = tokens(name);
  const hits = [];
  for (const c of candidates(k)) {
    const shared = matchTokens(qt, c.name);
    if (shared.length) hits.push({ name: c.name, via: c.via, from: c.from, shared, mid: c.mid });
  }
  return { qt, hits };
}

function outcomeTag(o) {
  if (o === 'clear') return tag('clear', 'ok');
  if (o === 'waiver') return tag('waiver needed', 'gate');
  if (o === 'declined') return tag('declined', 'gate');
  return tag('unresolved', 'navy');
}

// One rendering of a hit list, used by the run log, the re-screen diff and the
// watchlist — three views of the same fact, so they must read the same.
function hitLines(hits) {
  return hits.length
    ? hits.map((h) => `<b>${esc(h.name)}</b> <span class="note" style="display:inline">${esc(h.via)} · ${esc(h.from)} · matched: ${esc((h.shared || []).join(', '))}</span>`).join('<br>')
    : '<span class="note">no hits</span>';
}

function decideButtons(runId) {
  return OUTCOMES.map(([v, t]) => `<form method="POST" action="/r/conflicts/outcome" style="display:inline;margin-right:6px"><input type="hidden" name="id" value="${esc(runId)}"><input type="hidden" name="outcome" value="${esc(v)}"><button class="quiet" style="margin-top:6px">${esc(t)}</button></form>`).join('');
}

function waiverText({ client, other, desc, firmUser }) {
  return `Dear ${client}:

RE: Consent to act — ${desc}

We write before opening a file. Our conflicts check shows that our firm acts, or has acted, for ${other}, whose interests are or may become adverse to yours in the matter described above. The rules of professional conduct permit us to act for you in these circumstances only with your informed consent, and in some circumstances not at all.

If you consent, we will maintain an ethical screen so that no confidential information of one client is available to the lawyers acting for the other, and we will withdraw if the conflict becomes one that consent cannot cure. You are free to obtain independent legal advice before signing, and we encourage you to do so.

If these terms are acceptable, please sign and return a copy of this letter. This consent is limited to the circumstances described above; any new conflict will be raised with you before we continue to act.

Yours truly,
${firmUser}`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const runs = k.firm.list('conflictRun').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // What this viewer may see of the matter graph: parties attached to a
    // matter they are screened from never render, and stored hit rows whose
    // provenance is a screened matter are dropped before display.
    const visibleMatters = new Set((ctx.matters || []).map((m) => m.id));
    const viewHits = (hits) => (hits || []).filter((h) => !h.mid || visibleMatters.has(h.mid));
    const matterOf = (id) => (ctx.matters || []).find((x) => x.id === id) || null;
    const inquiryLabel = (id) => { const i = (k.firm.get('inquiry', id) || {}); return i.client || null; };
    // What a stored run is tied to, wall-aware: a run on a matter this viewer is
    // screened from shows no tie label rather than leaking the matter's title.
    const runTie = (r) => {
      if (r.matterId) { const m = matterOf(r.matterId); return m ? 'matter — ' + (m.title || r.matterId) : null; }
      if (r.inquiryId) return 'inquiry — ' + (inquiryLabel(r.inquiryId) || r.inquiryId);
      return null;
    };
    const parties = k.firm.list('party', (p) => !p.matterId || visibleMatters.has(p.matterId))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const inquiries = k.firm.list('inquiry');
    // k.matters() is the walled-aware accessor; k.firm.list('matter') is not.
    // A count is small, but it is still information about a matter a screened
    // lawyer must not know exists — and the wall is the product's core control.
    const mattersAll = k.matters();
    const letters = k.firm.list('letter', (l) => l.kind === 'conflict-waiver')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // Firm-level, never matter-scoped: conflicts data lives outside privilege scope.
    const rescans = k.firm.list('rescan').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const latestRescan = rescans[0] || null;
    const watches = k.firm.list('watchName').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Continuous re-check: anything that joined the graph after the last run.
    const lastRunAt = runs.length ? runs.map((r) => r.createdAt || '').sort().pop() : null;
    const unscreened = lastRunAt ? parties.filter((p) => (p.createdAt || '') > lastRunAt) : parties.slice();

    const targets = [['', 'Firm directory (unattached)']]
      .concat((ctx.matters || []).map((m) => ['m:' + m.id, 'Matter — ' + m.title]))
      .concat(inquiries.filter((i) => i.status === 'screening').map((i) => ['i:' + i.id, 'Inquiry — ' + i.client]));
    const defaultTarget = ctx.matter ? 'm:' + ctx.matter.id : '';

    // A run marked "waiver needed" hands its own particulars to the letter
    // below rather than making counsel retype them. Wall-aware: the client name
    // is carried over only from a matter this viewer can already see.
    const wRun = k.firm.get('conflictRun', String(ctx.query.get('waiver') || '')) || null;
    let wClient = '', wOther = '';
    if (wRun) {
      wOther = String(wRun.name || '');
      if (wRun.matterId) { const m = matterOf(wRun.matterId); wClient = m ? String(m.client || '') : ''; }
      else if (wRun.inquiryId) { const i = k.firm.get('inquiry', wRun.inquiryId); wClient = i ? String(i.client || '') : ''; }
    }

    // Unresolved runs first — an undecided hit is the outstanding work in this
    // room; everything else is a log.
    const pending = runs.filter((r) => r.outcome === 'pending');
    const runRows = pending.concat(runs.filter((r) => r.outcome !== 'pending'));

    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Run a conflict check</h2>
        <form method="POST" action="/r/conflicts/run">
          ${input('name', 'Name to clear', { required: true, placeholder: 'Person, company, insurer, witness…' })}
          ${select('target', 'Clearing for', targets, defaultTarget)}
          <button>Check against everything on file</button>
        </form>
        <p class="note">The file chosen above is what the intake and retainer gates read — a run tied to nothing clears nothing. Token match across ${mattersAll.length} matter(s), ${inquiries.length} inquiry(ies) and ${parties.length} recorded part${parties.length === 1 ? 'y' : 'ies'}: clients, adverse parties and aliases. Probabilistic record linkage (Splink) wires in here — Build Sheet L06; until it lands, matching is exact token overlap and nothing is fabricated.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Record a party</h2>
        <form method="POST" action="/r/conflicts/party">
          ${input('name', 'Name', { required: true })}
          ${input('aliases', 'Aliases / former names', { placeholder: 'Comma-separated — Bob Smith, R. Smith Holdings' })}
          <div class="grid2">
            <span>${select('role', 'Role', ROLES)}</span>
            <span>${select('target', 'Attached to', targets, defaultTarget)}</span>
          </div>
          <button>Add to the party graph</button>
        </form>
        <p class="note">A recorded party joins the graph every later check runs against. It is listed as unscreened below until a check is run.</p>
      </div>
    </div>

    <h2 class="sec">Conflict runs ${pending.length ? tag(pending.length + ' awaiting a decision', 'gate') : (runs.length ? tag('all resolved', 'ok') : '')}</h2>
    ${runs.length ? table(['Name checked', 'Ran', 'Hits — and the matter they came from', 'Outcome'], runRows.map((r) => [
      `<b>${esc(r.name)}</b>` + (runTie(r) ? `<br><span class="note">${esc(runTie(r))}</span>` : ''),
      date(r.createdAt),
      hitLines(viewHits(r.hits)),
      outcomeTag(r.outcome)
        + (r.outcome === 'pending' ? '<br>' + decideButtons(r.id) : '')
        + (r.outcome === 'waiver' ? `<br><a href="${esc('/r/conflicts?waiver=' + encodeURIComponent(r.id) + '#waiver')}">Draft the waiver letter</a>` : ''),
    ])) : empty('No conflict runs yet — check a name above; every engagement starts there.')}

    <h2 class="sec">Awaiting re-check ${unscreened.length ? tag(unscreened.length + ' unscreened', 'gate') : tag('graph screened', 'ok')}</h2>
    ${unscreened.length ? table(['Name', 'Role', 'Attached to', 'Added', ''], unscreened.map((p) => [
      esc(p.name), esc(p.role || ''), esc(partyWhere(k, p)), date(p.createdAt),
      `<form method="POST" action="/r/conflicts/run" style="display:inline"><input type="hidden" name="name" value="${esc(p.name)}"><input type="hidden" name="target" value="${esc(p.matterId ? 'm:' + p.matterId : p.inquiryId ? 'i:' + p.inquiryId : '')}"><button class="quiet">Run check</button></form>`,
    ])) : empty(lastRunAt ? `No parties added since the last conflict run (${String(lastRunAt).slice(0, 10)}).` : 'No parties on file yet — record one above.')}
    ${unscreened.length && lastRunAt ? `<p class="note">Added since the last conflict run on ${esc(String(lastRunAt).slice(0, 10))} — a name in the graph that no run has been put through is a name the firm has not screened.</p>` : ''}

    <h2 class="sec">Firm-wide re-screen ${latestRescan && (latestRescan.newHits || []).length ? tag((latestRescan.newHits || []).length + ' run(s) with new hits', 'gate') : (latestRescan ? tag('graph quiet', 'ok') : '')}</h2>
    <form method="POST" action="/r/conflicts/rescan" style="display:inline"><button style="margin-top:0">Re-screen every stored run</button></form>
    <p class="note">${latestRescan ? `Last re-screened ${Number(latestRescan.checkedRuns || 0)} run(s) on ${esc(String(latestRescan.createdAt || '').slice(0, 10))} by ${esc(latestRescan.byName || '')}. ` : ''}The conflicts duty outlives intake. No stored outcome changes by machine — runs with new hits are listed here for a human decision.</p>
    ${latestRescan
      ? ((latestRescan.newHits || []).length
        ? table(['Name checked', 'New hits — and the matter they came from', 'Re-resolve'], (latestRescan.newHits || []).map((e) => {
          const run = e.runId ? k.firm.get('conflictRun', e.runId) : null;
          return [
            `<b>${esc(e.name)}</b>`,
            hitLines(viewHits(e.hits)),
            (run ? outcomeTag(run.outcome) : '') + '<br>' + decideButtons(e.runId),
          ];
        }))
        : empty('Latest re-screen found nothing new — the graph is quiet.'))
      : empty('No firm-wide re-screen yet — run one above.')}

    <h2 class="sec">Watched names</h2>
    <form method="POST" action="/r/conflicts/watch" class="mselect">
      <input name="name" type="text" required placeholder="Name to watch — the adverse party you expect to meet again" aria-label="Name to watch" style="max-width:420px">
      <button style="margin-top:0">Watch</button>
    </form>
    <p class="note">A watched name runs through the conflict check on every page load, so a new party anywhere in the graph lights it up here without anyone re-running it.</p>
    ${watches.length ? table(['Name', 'Current hits', 'Added by', ''], watches.map((w) => {
      const hits = viewHits(runCheck(k, w.name).hits);
      return [
        `<b>${esc(w.name)}</b>`,
        hits.length
          ? hits.map((h) => `${tag(h.name, 'gate')} <span class="note" style="display:inline">${esc(h.via)} · ${esc(h.from)} · matched: ${esc((h.shared || []).join(', '))}</span>`).join('<br>')
          : '<span class="note">no hits</span>',
        esc(w.addedBy || ''),
        `<form method="POST" action="/r/conflicts/watch-del" style="display:inline"><input type="hidden" name="id" value="${esc(w.id)}"><button class="quiet">Remove</button></form>`,
      ];
    })) : empty('No watched names. Watch the adverse party you expect to meet again.')}

    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0" id="waiver">Waiver letter</h2>
        <form method="POST" action="/r/conflicts/waiver">
          ${input('client', 'Consenting client', { required: true, value: wClient })}
          ${input('other', 'Conflicting party / other client', { required: true, value: wOther })}
          ${textarea('desc', 'Matter description', { placeholder: 'Proposed engagement: …', required: true })}
          <button>Generate waiver letter</button>
        </form>
        <p class="note">Informed consent is the only thing that cures a consentable conflict — the letter records what the client was told, and it does not leave the building unsigned.</p>
        ${letters.length ? letters.slice(0, 3).map((l) => `<div style="border:1px solid var(--rule);padding:12px 14px;margin-top:12px;background:var(--ground)">
          ${kv([['To', esc(l.to)], ['Generated', date(l.createdAt)]])}
          <div class="note" style="white-space:pre-wrap">${esc(l.text)}</div>
        </div>`).join('') : ''}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Screens &amp; walls</h2>
        ${kv([
          ['Runs recorded', `<span class="num">${runs.length}</span>`],
          ['Awaiting a decision', `<span class="num">${pending.length}</span>`],
          ['Parties in graph', `<span class="num">${parties.length}</span>`],
        ])}
        <p class="note">Where a screen cures the conflict, the wall is raised in firm administration and enforced in the kernel before any key unwrap — a screened user cannot reach the matter&rsquo;s encryption key at all.</p>
        ${k.isAdmin() ? '<a class="btn" href="/admin">Raise an ethical wall</a>' : '<p class="note">Raising a wall requires an administrator — ask one to provision it at /admin.</p>'}
      </div>
    </div>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Every name against every matter — before anyone bills an hour', body }));
  });

  app.route('POST', `/r/${ROOM.id}/run`, (req, res, ctx) => {
    const k = ctx.kernel;
    const name = String(ctx.body.name || '').trim();
    if (!name || !tokens(name).length) {
      ctx.setFlash('Enter a name with at least one matchable token (3+ letters).', 'err');
      redirect(res, '/r/conflicts'); return;
    }
    // Tie the run to the file the other rooms gate on. The target list is built
    // from wall-aware ctx.matters + screening inquiries; k.matter re-checks the
    // wall so a garbage/walled matterId simply drops.
    const target = String(ctx.body.target || '');
    const matterId = target.startsWith('m:') ? target.slice(2) : null;
    const inquiryId = target.startsWith('i:') ? target.slice(2) : null;
    const tiedMatter = matterId ? k.matter(matterId) : null;
    const tiedInquiry = inquiryId ? k.firm.get('inquiry', inquiryId) : null;
    // Parties this run speaks for: the name checked, plus the client and adverse
    // parties of the matter/inquiry it clears — per the shared conflictRun shape.
    const parties = [name];
    if (tiedMatter) { if (tiedMatter.client) parties.push(tiedMatter.client); for (const a of tiedMatter.adverse || []) if (a) parties.push(a); }
    if (tiedInquiry) { if (tiedInquiry.client) parties.push(tiedInquiry.client); for (const a of tiedInquiry.adverse || []) if (a) parties.push(a); }
    const { hits } = runCheck(k, name);
    const run = k.firm.put('conflictRun', {
      name, hits, parties: [...new Set(parties.filter(Boolean))],
      matterId: tiedMatter ? matterId : null, inquiryId: tiedInquiry ? inquiryId : null,
      outcome: hits.length ? 'pending' : 'clear',
      runBy: ctx.user.name, ranBy: ctx.user.name, ranAt: new Date().toISOString(),
    });
    k.audit('conflicts.run', run.id + ':' + hits.length + ' hits' + (matterId ? ':m=' + matterId : inquiryId ? ':i=' + inquiryId : ''));
    const tiedTo = tiedInquiry ? ` — clearance recorded for inquiry ${tiedInquiry.client || inquiryId}` : tiedMatter ? ` — clearance recorded for matter ${tiedMatter.title || matterId}` : '';
    ctx.setFlash(hits.length
      ? `${hits.length} hit(s) for “${name}” — resolve the run: clear, waiver needed, or declined.`
      : `“${name}” is clear against every matter, inquiry and party on file${tiedTo}.`);
    redirect(res, '/r/conflicts');
  });

  app.route('POST', `/r/${ROOM.id}/party`, (req, res, ctx) => {
    const k = ctx.kernel;
    const name = String(ctx.body.name || '').trim();
    if (!name) { ctx.setFlash('A party needs a name.', 'err'); redirect(res, '/r/conflicts'); return; }
    const target = String(ctx.body.target || '');
    const rec = {
      name,
      aliases: String(ctx.body.aliases || '').split(',').map((s) => s.trim()).filter(Boolean),
      role: ROLES.includes(ctx.body.role) ? ctx.body.role : 'Client',
      matterId: target.startsWith('m:') ? target.slice(2) : null,
      inquiryId: target.startsWith('i:') ? target.slice(2) : null,
    };
    k.firm.put('party', rec);
    ctx.setFlash(`Party recorded: ${name}. It is listed for re-screening until the next conflict run.`);
    redirect(res, '/r/conflicts');
  });

  app.route('POST', `/r/${ROOM.id}/outcome`, (req, res, ctx) => {
    const k = ctx.kernel;
    const run = ctx.body.id ? k.firm.get('conflictRun', ctx.body.id) : null;
    if (!run) { ctx.setFlash('No such conflict run.', 'err'); redirect(res, '/r/conflicts'); return; }
    const outcome = ['clear', 'waiver', 'declined'].includes(ctx.body.outcome) ? ctx.body.outcome : null;
    if (!outcome) { ctx.setFlash('Pick an outcome: clear, waiver needed, or declined.', 'err'); redirect(res, '/r/conflicts'); return; }
    k.firm.put('conflictRun', { ...run, outcome, decidedBy: ctx.user.name, decidedAt: new Date().toISOString() });
    k.audit('conflicts.outcome', run.id + ':' + outcome);
    if (outcome === 'waiver') {
      // Straight to the letter, with the run's own particulars carried over.
      ctx.setFlash(`Run for “${run.name}” marked waiver needed — draft the consent letter.`);
      redirect(res, '/r/conflicts?waiver=' + encodeURIComponent(run.id) + '#waiver'); return;
    }
    ctx.setFlash(`Run for “${run.name}” marked ${outcome}.`);
    redirect(res, '/r/conflicts');
  });

  // Continuous re-screen: every stored run, re-run against today's graph.
  // The diff is machine work; the decision stays human — no outcome is touched here.
  app.route('POST', `/r/${ROOM.id}/rescan`, (req, res, ctx) => {
    const k = ctx.kernel;
    const runs = k.firm.list('conflictRun');
    if (!runs.length) {
      ctx.setFlash('No conflict runs on file to re-screen — check a name first.', 'err');
      redirect(res, '/r/conflicts'); return;
    }
    const newHits = [];
    let newHitCount = 0;
    for (const run of runs) {
      const fresh = runCheck(k, run.name).hits;
      const seen = new Set((run.hits || []).map((h) => `${h.name}|${h.via}|${h.from}`));
      const added = fresh.filter((h) => !seen.has(`${h.name}|${h.via}|${h.from}`));
      if (added.length) { newHits.push({ runId: run.id, name: run.name, hits: added }); newHitCount += added.length; }
    }
    const rescan = k.firm.put('rescan', { checkedRuns: runs.length, newHits, byName: ctx.user.name });
    k.audit('conflicts.rescan', rescan.id + ':' + newHitCount);
    ctx.setFlash(`Re-screened ${runs.length} runs — ${newHitCount} new hit(s).`);
    redirect(res, '/r/conflicts');
  });

  app.route('POST', `/r/${ROOM.id}/watch`, (req, res, ctx) => {
    const k = ctx.kernel;
    const name = String(ctx.body.name || '').trim();
    if (!name || !tokens(name).length) {
      ctx.setFlash('Enter a name with at least one matchable token (3+ letters).', 'err');
      redirect(res, '/r/conflicts'); return;
    }
    const w = k.firm.put('watchName', { name, addedBy: ctx.user.name });
    k.audit('conflicts.watch', w.id);
    ctx.setFlash(`Watching “${name}” — it runs through the conflict check on every page load.`);
    redirect(res, '/r/conflicts');
  });

  app.route('POST', `/r/${ROOM.id}/watch-del`, (req, res, ctx) => {
    const k = ctx.kernel;
    const w = ctx.body.id ? k.firm.get('watchName', ctx.body.id) : null;
    if (!w) { ctx.setFlash('No such watched name.', 'err'); redirect(res, '/r/conflicts'); return; }
    k.firm.del('watchName', w.id);
    ctx.setFlash(`Stopped watching “${w.name}”.`);
    redirect(res, '/r/conflicts');
  });

  app.route('POST', `/r/${ROOM.id}/waiver`, (req, res, ctx) => {
    const k = ctx.kernel;
    const client = String(ctx.body.client || '').trim();
    const other = String(ctx.body.other || '').trim();
    const desc = String(ctx.body.desc || '').trim();
    if (!client || !other || !desc) {
      ctx.setFlash('The waiver letter needs the consenting client, the conflicting party, and a matter description.', 'err');
      redirect(res, '/r/conflicts'); return;
    }
    k.firm.put('letter', {
      kind: 'conflict-waiver', to: client,
      text: waiverText({ client, other, desc, firmUser: ctx.user.name }),
    });
    ctx.setFlash(`Waiver letter generated for ${client} — it does not leave the building unsigned.`);
    redirect(res, '/r/conflicts');
  });
}

module.exports = { ...ROOM, register };
