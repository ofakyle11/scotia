'use strict';
// Room 05 — Client Desk. Updates that land: plain-language status updates,
// decision memos for the calls that are the client's to make, and
// budget-vs-actual before the invoice arrives.
const { layout, esc, table, empty, tag, kv, input, textarea, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 5, id: 'client', title: 'Client Desk', phase: 'Intake' };
const SUB = 'Updates that land — plain language, budget honesty, authority on record';

// House cadence, not a rule: the firm's own standard for how long a client may
// go without hearing from us. Flagged here, never sent from here.
const CADENCE_DAYS = 30;

const today = () => new Date().toISOString().slice(0, 10);

// Round-trip an ISO date so '2026-02-31' is refused rather than silently rolled
// forward to a day the client never gave us.
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Whole days from an ISO date to today; null when there is no usable date, so a
// garbage stored value reads as "no clock", never as "sent today".
function daysSince(iso) {
  const t = Date.parse(String(iso || '').slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  return Math.round((Date.parse(today() + 'T00:00:00Z') - t) / 86400000);
}

// Approximate reading grade (Gunning-fog style, computed inline — no corpus):
// 0.4 × (avg words per sentence + 100 × long-word ratio). Long word = 7+ letters.
// 36-portal recomputes this at pack time with a byte-identical function — the
// desk and the pack must never report different grades. Keep the two in step.
function readingGrade(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const sentences = String(text).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length || 1;
  const longWords = words.filter((w) => w.replace(/[^A-Za-zÀ-ſ'-]/g, '').length >= 7).length;
  return Math.round(0.4 * (words.length / sentences + 100 * (longWords / words.length)) * 10) / 10;
}

const gradeTag = (g) => g > 9
  ? tag(`grade ~${g} — aim under 9`, 'gate')
  : tag(`grade ~${g}`, 'ok');

// Silence is the complaint clients actually make. One chip, on the record it
// describes, so it prints with the file.
function cadenceTag(latest) {
  if (!latest) return tag('no update sent yet', 'gate');
  const d = daysSince(latest.sentOn || latest.createdAt);
  if (d == null) return '';
  if (d > CADENCE_DAYS) return tag(`${d} days since the last update`, 'gate');
  if (d <= 0) return tag('last update today', 'ok');
  return tag(`last update ${d} day${d === 1 ? '' : 's'} ago`, 'ok');
}

const lines = (s) => esc(s).replace(/\n/g, '<br>');

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    let body;
    if (!ctx.matter) {
      body = empty('Open a matter to keep its client communication record — take an inquiry through Intake (01) to open one.');
    } else {
      const m = ctx.matter;
      const scope = k.scope(m.id);
      // Newest-first by the date the update went out — the same ordering
      // 36-portal uses to pick the update that rides in the client pack.
      const updates = scope.list('clientUpdate')
        .sort((a, b) => (b.sentOn || b.createdAt || '').localeCompare(a.sentOn || a.createdAt || ''));
      const memos = scope.list('decisionMemo')
        .sort((a, b) => (b.decidedOn || b.createdAt || '').localeCompare(a.decidedOn || a.createdAt || ''));

      // Budget vs actual: figure on the matter vs the ledger plus unbilled time.
      const bal = k.ledger.balances(m.id);
      const feesEarned = -(bal['operating:income:fees'] || 0);
      const disbursements = bal['operating:expense:disbursements'] || 0;
      const trustHeld = bal['trust:bank'] || 0;
      const time = scope.list('timeEntry');
      const unbilled = time.filter((t) => t.state !== 'billed')
        .reduce((s, t) => s + (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
      const budget = Number(m.budget) || 0;
      const actual = feesEarned + disbursements + unbilled;
      const remaining = budget - actual;
      const over = budget > 0 && remaining < -0.005;
      const nearing = budget > 0 && !over && actual > budget * 0.8;

      body = `
      <p class="note print-only">Client communication record — ${esc(m.title)} — as at ${esc(today())}</p>
      <div class="grid2">
        <div class="card no-print">
          <h2 class="sec" style="margin-top:0">Send a status update</h2>
          <form method="POST" action="/r/client/update">
            ${textarea('text', 'Update — plain language', { required: true, placeholder: 'What happened, what it means, what happens next. Short sentences land.' })}
            <div class="grid2">
              <span>${input('sentOn', 'Date sent', { type: 'date', value: today() })}</span>
              <span>${input('sentBy', 'Sent by', { value: ctx.user.name })}</span>
            </div>
            <button>Record update</button>
          </form>
          <p class="note">Reading level is scored on save — aim under grade 9. The newest update, the budget figures below and any open decision requests are what the client pack (36) carries. House cadence is an update at least every ${CADENCE_DAYS} days; automated reminders and the EN/FR pipeline (Chatwoot &middot; IMAP ingest) wire in here — Build Sheet 05.</p>
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">Budget vs actual — ${esc(m.title)}</h2>
          ${kv([
            ['Budget / retainer', budget > 0 ? money(budget) : '<span class="note">not set — enter it below</span>'],
            ['Fees taken to income', money(feesEarned)],
            ['Disbursements', money(disbursements)],
            ['Unbilled time (WIP)', money(unbilled)],
            ['Actual to date', `${money(actual)} ${over ? tag('OVER BUDGET', 'gate') : nearing ? tag('over 80% used', 'navy') : budget > 0 ? tag('within budget', 'ok') : ''}`],
            ['Remaining', budget > 0 ? money(remaining) : '<span class="note">no figure set</span>'],
            ['Held in trust', money(trustHeld)],
          ])}
          <form method="POST" action="/r/client/budget" class="no-print">
            ${input('budget', 'Budget / retainer figure', { type: 'number', required: true, placeholder: '15000.00', value: budget > 0 ? String(budget) : '' })}
            <button class="quiet" style="margin-top:10px">${budget > 0 ? 'Update figure' : 'Save figure on matter'}</button>
          </form>
          <p class="note no-print">Actual = fees taken to income + disbursements + unbilled WIP. Tell the client before the figure moves, not after.</p>
        </div>
      </div>

      <h2 class="sec">Status updates ${cadenceTag(updates[0] || null)}</h2>
      ${updates.length ? table(['Date', 'Update', 'Reading level', 'Sent by'], updates.map((u) => [
        date(u.sentOn || u.createdAt),
        lines(u.text),
        gradeTag(readingGrade(u.text)),
        esc(u.sentBy || ''),
      ])) : empty('No updates yet — write the first one above: what happened, what it means, what happens next.')}

      <h2 class="sec">Decision memos — the calls that are the client's to make</h2>
      <div class="card no-print">
        <form method="POST" action="/r/client/memo">
          ${input('question', 'Decision put to the client', { required: true, placeholder: 'Accept the settlement offer of $80,000?' })}
          ${textarea('options', 'Options explained (one per line)', { placeholder: 'Accept — funds in ~30 days, matter closes\nCounter at $95,000 — adds 2-3 months\nRefuse and proceed to trial' })}
          ${input('decision', 'Client’s decision', { required: true, placeholder: 'Counter at $95,000' })}
          <div class="grid2">
            <span>${input('decidedOn', 'Date decided', { type: 'date', value: today() })}</span>
            <span>${input('recordedBy', 'Authority recorded by', { value: ctx.user.name })}</span>
          </div>
          <button>Record decision</button>
        </form>
        <p class="note">A memo is the client&rsquo;s answer on the record — the decision is required, because an unrecorded instruction is the one that gets disputed. A question still waiting on the client is a decision request in Client Portal (36).</p>
      </div>
      ${memos.length ? table(['Date', 'Question', 'Options', 'Client decision', 'Recorded by'], memos.map((d) => [
        date(d.decidedOn || d.createdAt),
        esc(d.question),
        lines(d.options || ''),
        `<b>${esc(d.decision)}</b>`,
        esc(d.recordedBy || ''),
      ])) : empty('No client decisions yet — put the call to the client, then record their answer above.')}
      `;
    }
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: SUB, body }));
  });

  app.route('POST', `/r/${ROOM.id}/update`, (req, res, ctx) => {
    const bad = (msg) => { ctx.setFlash(msg, 'err'); redirect(res, '/r/client'); };
    if (!ctx.matter) { bad('Open a matter first — updates live in the matter file.'); return; }
    const text = String(ctx.body.text || '').trim();
    if (!text) { bad('Write the update before recording it.'); return; }
    const sentOn = String(ctx.body.sentOn || '').trim() || today();
    if (!isRealDate(sentOn)) { bad(`"${sentOn}" is not a real calendar date — the client record is dated by the day it went out.`); return; }
    const grade = readingGrade(text);
    ctx.kernel.scope(ctx.matter.id).put('clientUpdate', {
      text,
      sentOn,
      sentBy: String(ctx.body.sentBy || ctx.user.name).trim() || ctx.user.name,
      grade,
    });
    ctx.setFlash(grade > 9
      ? `Update recorded — reading level ~grade ${grade}. Consider shorter sentences and plainer words (aim under 9).`
      : `Update recorded — reading level ~grade ${grade}.`);
    redirect(res, '/r/client');
  });

  app.route('POST', `/r/${ROOM.id}/memo`, (req, res, ctx) => {
    const bad = (msg) => { ctx.setFlash(msg, 'err'); redirect(res, '/r/client'); };
    if (!ctx.matter) { bad('Open a matter first — decision memos live in the matter file.'); return; }
    const question = String(ctx.body.question || '').trim();
    const decision = String(ctx.body.decision || '').trim();
    if (!question || !decision) { bad('A decision memo needs both the question and the client’s decision.'); return; }
    const decidedOn = String(ctx.body.decidedOn || '').trim() || today();
    if (!isRealDate(decidedOn)) { bad(`"${decidedOn}" is not a real calendar date — an instruction is dated by the day it was given.`); return; }
    ctx.kernel.scope(ctx.matter.id).put('decisionMemo', {
      question,
      options: String(ctx.body.options || '').trim(),
      decision,
      decidedOn,
      recordedBy: String(ctx.body.recordedBy || ctx.user.name).trim() || ctx.user.name,
    });
    ctx.setFlash('Client decision recorded — the authority is on file.');
    redirect(res, '/r/client');
  });

  app.route('POST', `/r/${ROOM.id}/budget`, (req, res, ctx) => {
    const bad = (msg) => { ctx.setFlash(msg, 'err'); redirect(res, '/r/client'); };
    if (!ctx.matter) { bad('Open a matter first — the budget figure lives on the matter.'); return; }
    const raw = Number(ctx.body.budget);
    if (!Number.isFinite(raw) || !(raw > 0)) { bad('Enter a positive budget figure.'); return; }
    const amt = Math.round(raw * 100) / 100;
    const k = ctx.kernel;
    const m = k.firm.get('matter', ctx.matter.id);
    if (!m) { bad('Matter unavailable.'); return; }
    k.firm.put('matter', { ...m, budget: amt });
    ctx.setFlash(`Budget figure set at ${amt.toFixed(2)} — actuals now report against it.`);
    redirect(res, '/r/client');
  });
}

module.exports = { ...ROOM, register };
