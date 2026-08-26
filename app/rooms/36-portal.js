'use strict';
// Room 36 — Client Portal. NOT a second login: there is no client account and
// no second auth surface. Instead the lawyer assembles, from what the firm
// already computes, a plain-language client status pack — latest status update
// (room 05), the next few key dates (the diary rooms 27 reads), budget vs
// actual with unbilled WIP (rooms 05/28), and any decision awaiting the client
// — then generates a printable, shareable, read-only pack and records that it
// was shared. The lawyer delivers it; nobody signs in.
const { layout, esc, table, empty, tag, kv, input, textarea, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 36, id: 'portal', title: 'Client Portal', phase: 'Always on' };

// Approximate reading grade (Gunning-fog style, computed inline — no corpus),
// identical to Client Desk so the score the pack reports matches room 05.
function readingGrade(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const sentences = String(text).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length || 1;
  const longWords = words.filter((w) => w.replace(/[^A-Za-zÀ-ſ'-]/g, '').length >= 7).length;
  return Math.round(0.4 * (words.length / sentences + 100 * (longWords / words.length)) * 10) / 10;
}

const usd = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const slug = (s) => String(s || 'matter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'matter';

// Assemble the pack from what other rooms already compute. Reads only; every
// figure is derived, none invented. Returns a self-contained snapshot so a
// recorded pack renders exactly as it was on the day it was shared.
function assemblePack(k, m, user) {
  const s = k.scope(m.id);
  const updates = s.list('clientUpdate').sort((a, b) => (b.sentOn || b.createdAt || '').localeCompare(a.sentOn || a.createdAt || ''));
  const latest = updates[0] || null;
  // Next 3 key dates: the soonest open deadlines with a real due date — the
  // same open-deadline set the Workflow diary (room 27) reads.
  const dates = s.list('deadline', (d) => d.status === 'open')
    .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(String(d.due || '')))
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .slice(0, 3)
    .map((d) => ({ due: String(d.due).slice(0, 10), desc: d.desc || '', rule: d.rule || '' }));
  // Budget vs actual with unbilled WIP — the Client Desk / Trust & Books figure.
  const bal = k.ledger.balances(m.id);
  const feesEarned = -(bal['operating:income:fees'] || 0);
  const disbursements = bal['operating:expense:disbursements'] || 0;
  const trustHeld = bal['trust:bank'] || 0;
  const time = s.list('timeEntry');
  const unbilled = time.filter((t) => t.state !== 'billed').reduce((x, t) => x + (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
  const figure = Number(m.budget) || 0;
  const actual = feesEarned + disbursements + unbilled;
  const remaining = figure - actual;
  const hasBudget = figure > 0;
  const over = hasBudget && remaining < -0.005;
  const nearing = hasBudget && !over && actual > figure * 0.8;
  // Decisions awaiting the client: portal-posed requests still open, plus any
  // Client Desk decision memo recorded without an answer.
  const reqs = s.list('decisionRequest', (d) => d.status === 'open')
    .map((d) => ({ question: d.question, options: d.options || '' }));
  const openMemos = s.list('decisionMemo').filter((d) => !String(d.decision || '').trim())
    .map((d) => ({ question: d.question, options: d.options || '' }));
  const decisions = reqs.concat(openMemos);
  return {
    matterTitle: m.title, client: m.client || '', jurisdiction: m.jurisdiction || '',
    preparedBy: user.name,
    status: latest ? { text: latest.text, sentOn: latest.sentOn || String(latest.createdAt || '').slice(0, 10) } : null,
    grade: latest ? readingGrade(latest.text) : 0,
    dates,
    budget: { figure, feesEarned, disbursements, unbilled, trustHeld, actual, remaining, hasBudget, over, nearing },
    decisions,
  };
}

// Standalone, client-facing, read-only document. Its own light styling and
// inline print CSS — no Chambers chrome, no internal navigation, no scripts,
// no forms. Plain sentences; internal rule citations shown as a muted, labelled
// reference (real deadline authority, never invented).
function renderPackHtml(snap, preparedOn) {
  const b = snap.budget || {};
  const prepared = String(preparedOn || '').slice(0, 10);
  const statusBlock = snap.status
    ? `<p class="lead">${esc(snap.status.text)}</p><p class="stamp">Last update ${esc(snap.status.sentOn || prepared)}</p>`
    : `<p class="none">No status update has been recorded yet.</p>`;
  const datesRows = (snap.dates && snap.dates.length)
    ? snap.dates.map((d) => `<tr><td class="d">${esc(d.due)}</td><td>${esc(d.desc)}${d.rule ? `<div class="ref">Reference: ${esc(d.rule)}</div>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="2" class="none">No key dates are scheduled right now.</td></tr>`;
  const decisionsBlock = (snap.decisions && snap.decisions.length)
    ? snap.decisions.map((d) => `<div class="decision"><p class="q">${esc(d.question)}</p>${d.options
      ? `<ul>${String(d.options).split('\n').map((o) => o.trim()).filter(Boolean).map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</div>`).join('')
    : `<p class="none">Nothing needs your decision right now.</p>`;
  const budgetRows = [
    b.hasBudget ? ['Your budget', usd(b.figure)] : null,
    ['Fees and costs charged so far', usd(b.feesEarned + b.disbursements)],
    ['Work done, not yet billed', usd(b.unbilled)],
    ['Total so far', usd(b.actual)],
    b.hasBudget ? ['Remaining in your budget', usd(b.remaining) + (b.over ? ' — over budget' : b.nearing ? ' — over 80% used' : '')] : null,
    ['Held in trust for you', usd(b.trustHeld)],
  ].filter(Boolean);
  const title = `Matter update — ${snap.client || snap.matterTitle}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#f4f5f7;color:#1c2330;font-family:Georgia,"Times New Roman",serif;line-height:1.55;font-size:16px}
.wrap{max-width:720px;margin:0 auto;padding:36px 28px 60px}
.sheet{background:#fff;border:1px solid #d6dae2;padding:34px 40px 40px}
.mast{border-bottom:2px solid #2c4a7c;padding-bottom:14px;margin-bottom:24px}
.mast h1{font-size:23px;margin:0 0 4px;color:#1c2330}
.mast .meta{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5b6472;letter-spacing:.02em}
h2{font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2c4a7c;margin:30px 0 10px;border-bottom:1px solid #e2e5ea;padding-bottom:6px}
.lead{font-size:17px;margin:0 0 6px}
.stamp{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5b6472;margin:0}
.none{color:#5b6472;font-style:italic}
table{border-collapse:collapse;width:100%;font-size:15px}
td{padding:8px 10px;border-bottom:1px solid #e6e8ec;vertical-align:top}
td.d{font-family:Arial,Helvetica,sans-serif;white-space:nowrap;color:#2c4a7c;font-weight:bold;width:120px}
.ref{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#7a828f;margin-top:3px}
.money td:last-child{text-align:right;font-family:Arial,Helvetica,sans-serif}
.decision{border-left:3px solid #2c4a7c;padding:2px 0 2px 14px;margin:0 0 14px}
.decision .q{font-weight:bold;margin:0 0 6px}
.decision ul{margin:0;padding-left:20px}
.decision li{margin:3px 0}
.foot{margin-top:34px;border-top:1px solid #e2e5ea;padding-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5b6472}
.readonly{display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7a828f;border:1px solid #cfd4dc;padding:2px 8px;margin-bottom:18px}
@media print{
  body{background:#fff}
  .wrap{max-width:none;padding:0}
  .sheet{border:0;padding:0}
  .readonly{display:none}
}
</style></head><body>
<div class="wrap"><div class="sheet">
<span class="readonly">Read-only summary</span>
<div class="mast">
  <h1>${esc(snap.matterTitle)}</h1>
  <div class="meta">Prepared for ${esc(snap.client || 'the client')} &middot; ${esc(prepared)} &middot; by ${esc(snap.preparedBy || '')}</div>
</div>
<h2>Where things stand</h2>
${statusBlock}
<h2>What is coming up</h2>
<table><tbody>${datesRows}</tbody></table>
<h2>Your budget</h2>
<table class="money"><tbody>${budgetRows.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
<h2>A decision we need from you</h2>
${decisionsBlock}
<div class="foot">
  <p>This is a plain-language summary prepared for your information. It is not legal advice and it is not a bill. Figures are current as of the date shown and may change. If anything here is unclear, please contact your legal team.</p>
</div>
</div></div>
</body></html>`;
}

// Internal (dark-theme) preview of the same snapshot, so the lawyer sees
// exactly what the client will receive before generating or delivering it.
function previewBlock(snap) {
  const dateRows = snap.dates.length
    ? table(['Date', 'What it is', 'Reference'], snap.dates.map((d) => [date(d.due), esc(d.desc), `<span class="note">${esc(d.rule || '')}</span>`]))
    : empty('No open key dates on this matter.');
  const b = snap.budget;
  const decisions = snap.decisions.length
    ? snap.decisions.map((d) => `<div style="border-left:3px solid var(--navy);padding-left:12px;margin:0 0 10px"><b>${esc(d.question)}</b>${d.options ? `<div class="note">${esc(d.options).replace(/\n/g, '<br>')}</div>` : ''}</div>`).join('')
    : empty('Nothing awaiting the client. Pose a decision on the right when one is theirs to make.');
  return `
  <h2 class="sec" style="margin-top:0">Where things stand</h2>
  ${snap.status
    ? `<div class="card"><p style="margin:0 0 6px">${esc(snap.status.text)}</p><span class="note">Last update ${esc(snap.status.sentOn)} · reading level ~grade ${snap.grade} ${snap.grade > 9 ? tag('aim under 9', 'gate') : tag('plain', 'ok')}</span></div>`
    : empty('No status update recorded yet — write one in Client Desk (room 05).')}
  <h2 class="sec">Next 3 key dates</h2>
  ${dateRows}
  <h2 class="sec">Budget vs actual</h2>
  <div class="card">${kv([
    ['Budget', b.hasBudget ? money(b.figure) : '<span class="note">not set (Client Desk)</span>'],
    ['Fees & costs charged', money(b.feesEarned + b.disbursements)],
    ['Unbilled work (WIP)', money(b.unbilled)],
    ['Total so far', `${money(b.actual)} ${b.over ? tag('OVER BUDGET', 'gate') : b.nearing ? tag('over 80% used', 'gate') : b.hasBudget ? tag('within budget', 'ok') : ''}`],
    ['Remaining', b.hasBudget ? money(b.remaining) : '—'],
    ['Held in trust for client', money(b.trustHeld)],
  ])}</div>
  <h2 class="sec">Decision awaiting the client</h2>
  ${decisions}`;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    let body;
    if (!ctx.matter) {
      body = empty('Open a matter to prepare and share a client status pack.');
    } else {
      const m = ctx.matter;
      const snap = assemblePack(k, m, ctx.user);
      const openReqs = k.scope(m.id).list('decisionRequest', (d) => d.status === 'open')
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      const packs = k.scope(m.id).list('clientPack').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      body = `
      <div class="grid2">
        <div>
          ${previewBlock(snap)}
          <form method="POST" action="/r/portal/generate" style="margin-top:8px">
            <button>Generate &amp; record client pack</button>
          </form>
          <p class="note">Generating records what was shared and when. There is no client login — you deliver the printable pack yourself.</p>
        </div>
        <div>
          <div class="card">
            <h2 class="sec" style="margin-top:0">Pose a decision to the client</h2>
            <form method="POST" action="/r/portal/decision">
              ${input('question', 'Decision that is the client’s to make', { required: true, placeholder: 'Accept the settlement offer of $80,000?' })}
              ${textarea('options', 'Options explained (one per line)', { placeholder: 'Accept — funds in ~30 days, matter closes\nCounter at $95,000 — adds 2-3 months\nRefuse and proceed to trial' })}
              <button>Add to pack</button>
            </form>
            <p class="note">These appear under “A decision we need from you.” Record the client’s answer in Client Desk (room 05) when it comes back.</p>
          </div>
          ${openReqs.length ? `<div class="card"><h2 class="sec" style="margin-top:0">Open decision requests</h2>${openReqs.map((d) => `
            <div style="border-bottom:1px solid var(--rule-soft);padding:8px 0">
              <b>${esc(d.question)}</b>
              <form method="POST" action="/r/portal/resolve" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet">Mark answered</button></form>
            </div>`).join('')}</div>` : ''}
        </div>
      </div>

      <h2 class="sec">Packs generated — what was shared, and when</h2>
      ${packs.length ? table(['Generated', 'Update', 'Key dates', 'Decisions', 'By', ''], packs.map((p) => [
        date(p.createdAt),
        p.status ? `<span class="note">grade ~${p.grade}</span>` : '<span class="note">none</span>',
        `<span class="num">${(p.dates || []).length}</span>`,
        `<span class="num">${(p.decisions || []).length}</span>`,
        esc(p.preparedBy || ''),
        `<a class="btn quiet" href="/r/portal/pack/${esc(p.id)}" target="_blank" style="margin-right:6px">View / print</a>
         <form method="POST" action="/r/portal/download" style="display:inline"><input type="hidden" name="id" value="${esc(p.id)}"><button class="quiet">Download</button></form>`,
      ])) : empty('No packs generated yet — generate one above to start the shared-with-client record.')}
      <p class="note">Each recorded pack is a frozen snapshot: “View / print” opens the read-only client-facing page (print it from the browser); “Download” hands you the same page as a file to deliver.</p>
      `;
    }
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'A plain-language status pack the lawyer generates and delivers — no client login', body }));
  });

  app.route('POST', `/r/${ROOM.id}/generate`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/portal'); return; }
    const k = ctx.kernel;
    const snap = assemblePack(k, ctx.matter, ctx.user);
    const rec = k.scope(ctx.matter.id).put('clientPack', snap);
    k.audit('portal.pack.generated', ctx.matter.id + ':' + rec.id);
    ctx.setFlash('Client pack generated and recorded — open “View / print” to deliver it.');
    redirect(res, '/r/portal');
  });

  app.route('POST', `/r/${ROOM.id}/decision`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/portal'); return; }
    const question = String(ctx.body.question || '').trim();
    if (!question) { ctx.setFlash('Write the decision the client needs to make.', 'err'); redirect(res, '/r/portal'); return; }
    ctx.kernel.scope(ctx.matter.id).put('decisionRequest', {
      question, options: String(ctx.body.options || '').trim(), status: 'open',
    });
    ctx.setFlash('Decision added — it will appear in the next pack you generate.');
    redirect(res, '/r/portal');
  });

  app.route('POST', `/r/${ROOM.id}/resolve`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/portal'); return; }
    const id = String(ctx.body.id || '').trim();
    if (!id) { ctx.setFlash('Nothing to close — the request arrived without its id.', 'err'); redirect(res, '/r/portal'); return; }
    const s = ctx.kernel.scope(ctx.matter.id);
    const d = s.get('decisionRequest', id);
    if (!d) { ctx.setFlash('That decision request is no longer available.', 'err'); redirect(res, '/r/portal'); return; }
    s.put('decisionRequest', { ...d, status: 'closed' });
    ctx.setFlash('Marked answered — it drops off the client pack.');
    redirect(res, '/r/portal');
  });

  // Read-only client-facing view of a recorded pack. Standalone document,
  // printable from the browser. Rendered from the stored snapshot so it shows
  // what was shared on the day it was generated.
  app.route('GET', `/r/${ROOM.id}/pack/:id`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter to view its client packs.', 'err'); redirect(res, '/r/portal'); return; }
    let pack = null;
    try { pack = ctx.kernel.scope(ctx.matter.id).get('clientPack', ctx.params.id); } catch (e) { pack = null; }
    if (!pack) { ctx.setFlash('That client pack is not available.', 'err'); redirect(res, '/r/portal'); return; }
    html(res, renderPackHtml(pack, pack.createdAt));
  });

  // Deliver a recorded pack as a file. Same document, sent as a download so the
  // lawyer can attach it to an email or save it for the client.
  app.route('POST', `/r/${ROOM.id}/download`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/portal'); return; }
    const id = String(ctx.body.id || '').trim();
    if (!id) { ctx.setFlash('Choose a recorded pack to download.', 'err'); redirect(res, '/r/portal'); return; }
    let pack = null;
    try { pack = ctx.kernel.scope(ctx.matter.id).get('clientPack', id); } catch (e) { pack = null; }
    if (!pack) { ctx.setFlash('That client pack is not available.', 'err'); redirect(res, '/r/portal'); return; }
    ctx.kernel.audit('portal.pack.delivered', ctx.matter.id + ':' + id);
    const filename = `client-pack-${slug(pack.matterTitle)}-${String(pack.createdAt || '').slice(0, 10)}.html`;
    html(res, renderPackHtml(pack, pack.createdAt), 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
  });
}

module.exports = { ...ROOM, register };
