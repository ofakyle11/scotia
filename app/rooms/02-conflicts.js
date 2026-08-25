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

// Every name the firm has ever touched, with where it came from.
function candidates(k) {
  const out = [];
  for (const m of k.firm.list('matter')) {
    const from = `matter — ${m.title || m.client || m.id}`;
    if (m.client) out.push({ name: m.client, via: 'client', from });
    for (const a of m.adverse || []) if (a) out.push({ name: a, via: 'adverse party', from });
  }
  for (const i of k.firm.list('inquiry')) {
    const from = `inquiry — ${i.client || i.id} (${i.status || 'screening'})`;
    if (i.client) out.push({ name: i.client, via: 'prospective client', from });
    for (const a of i.adverse || []) if (a) out.push({ name: a, via: 'adverse party', from });
  }
  for (const p of k.firm.list('party')) {
    const from = partyWhere(k, p);
    if (p.name) out.push({ name: p.name, via: `party — ${p.role || 'unspecified role'}`, from });
    for (const a of p.aliases || []) if (a) out.push({ name: a, via: `alias of ${p.name}`, from });
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
    if (shared.length) hits.push({ name: c.name, via: c.via, from: c.from, shared });
  }
  return { qt, hits };
}

function outcomeTag(o) {
  if (o === 'clear') return tag('clear', 'ok');
  if (o === 'waiver') return tag('waiver needed', 'gate');
  if (o === 'declined') return tag('declined', 'gate');
  return tag('unresolved', 'navy');
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
    const parties = k.firm.list('party').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const inquiries = k.firm.list('inquiry');
    const mattersAll = k.firm.list('matter');
    const letters = k.firm.list('letter', (l) => l.kind === 'conflict-waiver')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Continuous re-check: anything that joined the graph after the last run.
    const lastRunAt = runs.length ? runs.map((r) => r.createdAt || '').sort().pop() : null;
    const unscreened = lastRunAt ? parties.filter((p) => (p.createdAt || '') > lastRunAt) : parties.slice();

    const targets = [['', 'Firm directory (unattached)']]
      .concat((ctx.matters || []).map((m) => ['m:' + m.id, 'Matter — ' + m.title]))
      .concat(inquiries.filter((i) => i.status === 'screening').map((i) => ['i:' + i.id, 'Inquiry — ' + i.client]));
    const defaultTarget = ctx.matter ? 'm:' + ctx.matter.id : '';

    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Run a conflict check</h2>
        <form method="POST" action="/r/conflicts/run">
          ${input('name', 'Name to clear', { required: true, placeholder: 'Person, company, insurer, witness…' })}
          <button>Check against everything on file</button>
        </form>
        <p class="note">Normalized token match against ${mattersAll.length} matter(s), ${inquiries.length} inquiry(ies) and ${parties.length} recorded part${parties.length === 1 ? 'y' : 'ies'} — clients, adverse parties, parties and their aliases. Probabilistic record linkage (Splink — resolving &ldquo;Robert Smith&rdquo;, &ldquo;Bob Smith&rdquo; and &ldquo;R. Smith Holdings LLC&rdquo; into one entity) wires in here — Build Sheet L06. Until it does, matching is exact token overlap: conservative, and no fabricated resolutions.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Record a party</h2>
        <form method="POST" action="/r/conflicts/party">
          ${input('name', 'Name', { required: true })}
          ${input('aliases', 'Aliases / former names (comma-separated)', { placeholder: 'Bob Smith, R. Smith Holdings' })}
          ${select('role', 'Role', ROLES)}
          ${select('target', 'Attached to', targets, defaultTarget)}
          <button>Add to the party graph</button>
        </form>
        <p class="note">Every party added after the last run is listed below for re-screening — the check keeps running after engagement.</p>
      </div>
    </div>

    <h2 class="sec">Awaiting re-check ${unscreened.length ? tag(String(unscreened.length) + ' unscreened', 'gate') : tag('graph screened', 'ok')}</h2>
    ${unscreened.length ? table(['Added', 'Name', 'Role', 'Attached to', ''], unscreened.map((p) => [
      date(p.createdAt), esc(p.name), esc(p.role || ''), esc(partyWhere(k, p)),
      `<form method="POST" action="/r/conflicts/run" style="display:inline"><input type="hidden" name="name" value="${esc(p.name)}"><button class="quiet">Run check</button></form>`,
    ])) : empty(lastRunAt ? 'No parties added since the last conflict run.' : 'No parties on file yet.')}
    ${lastRunAt ? `<p class="note">Last conflict run: ${esc(String(lastRunAt).slice(0, 10))}.</p>` : ''}

    <h2 class="sec">Conflict runs</h2>
    ${runs.length ? table(['Date', 'Name checked', 'Hits — and the matter they came from', 'Outcome'], runs.map((r) => [
      date(r.createdAt),
      esc(r.name),
      (r.hits && r.hits.length)
        ? r.hits.map((h) => `<b>${esc(h.name)}</b> <span class="note">${esc(h.via)} · ${esc(h.from)} · matched: ${esc((h.shared || []).join(', '))}</span>`).join('<br>')
        : '<span class="note">no hits</span>',
      outcomeTag(r.outcome) + (r.outcome === 'pending'
        ? '<br>' + OUTCOMES.map(([v, t]) => `<form method="POST" action="/r/conflicts/outcome" style="display:inline;margin-right:6px"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="outcome" value="${esc(v)}"><button class="quiet" style="margin-top:6px">${esc(t)}</button></form>`).join('')
        : ''),
    ])) : empty('No conflict runs yet. Every engagement starts here.')}

    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Waiver letter</h2>
        <form method="POST" action="/r/conflicts/waiver">
          ${input('client', 'Addressed to (the client consenting)', { required: true })}
          ${input('other', 'The conflicting party / other client', { required: true })}
          ${textarea('desc', 'Matter description', { placeholder: 'Proposed engagement: …', required: true })}
          <button>Generate waiver letter</button>
        </form>
        ${letters.length ? letters.slice(0, 3).map((l) => `<div style="border:1px solid var(--rule);padding:12px 14px;margin-top:12px;background:var(--ground)">
          ${kv([['To', esc(l.to)], ['Generated', date(l.createdAt)]])}
          <div class="note" style="white-space:pre-wrap">${esc(l.text)}</div>
        </div>`).join('') : ''}
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Screens &amp; walls</h2>
        <p class="note">Where a screen cures the conflict — a lateral hire, a walled-off team — the wall is raised in firm administration. Walls are enforced in the kernel before any key unwrap: a screened user cannot reach the matter&rsquo;s encryption key at all, so the screen is cryptographic, not cosmetic.</p>
        ${k.isAdmin() ? '<a class="btn" href="/admin">Raise an ethical wall — /admin</a>' : '<p class="note">Raising a wall requires an administrator — ask one to provision it at /admin.</p>'}
        ${kv([
          ['Matters on file', `<span class="num">${mattersAll.length}</span>`],
          ['Parties in graph', `<span class="num">${parties.length}</span>`],
          ['Runs recorded', `<span class="num">${runs.length}</span>`],
          ['Unresolved runs', `<span class="num">${runs.filter((r) => r.outcome === 'pending').length}</span>`],
        ])}
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
    const { hits } = runCheck(k, name);
    const run = k.firm.put('conflictRun', {
      name, hits, outcome: hits.length ? 'pending' : 'clear', runBy: ctx.user.name,
    });
    k.audit('conflicts.run', run.id + ':' + hits.length + ' hits');
    ctx.setFlash(hits.length
      ? `${hits.length} hit(s) for “${name}” — resolve the run: clear, waiver needed, or declined.`
      : `“${name}” is clear against every matter, inquiry and party on file.`);
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
    ctx.setFlash(outcome === 'waiver'
      ? `Run for “${run.name}” marked waiver needed — generate the waiver letter below.`
      : `Run for “${run.name}” marked ${outcome}.`);
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
