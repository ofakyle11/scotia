'use strict';
// Room 05 — Client Desk. Updates that land: plain-language status updates,
// decision memos for the calls that are the client's to make, and
// budget-vs-actual before the invoice arrives.
const { layout, esc, table, empty, tag, kv, input, textarea, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 5, id: 'client', title: 'Client Desk', phase: 'Intake' };

// Approximate reading grade (Gunning-fog style, computed inline — no corpus):
// 0.4 × (avg words per sentence + 100 × long-word ratio). Long word = 7+ letters.
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

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    let body;
    if (!ctx.matter) {
      body = empty('Open a matter to keep its client communication record.');
    } else {
      const m = ctx.matter;
      const scope = k.scope(m.id);
      const updates = scope.list('clientUpdate').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      const memos = scope.list('decisionMemo').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

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
      <div class="grid2">
        <div class="card">
          <h2 class="sec" style="margin-top:0">Send a status update</h2>
          <form method="POST" action="/r/client/update">
            ${textarea('text', 'Update — plain language', { required: true, placeholder: 'What happened, what it means, what happens next. Short sentences land.' })}
            <div class="grid2">
              <span>${input('sentOn', 'Date sent', { type: 'date', value: new Date().toISOString().slice(0, 10) })}</span>
              <span>${input('sentBy', 'Sent by', { value: ctx.user.name })}</span>
            </div>
            <button>Record update</button>
          </form>
          <p class="note">Updates are scored for reading level — keep them under grade ~9. Cadence reminders and the EN/FR pipeline (Chatwoot &middot; IMAP ingest) wire in here — Build Sheet 05.</p>
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">Budget vs actual — ${esc(m.title)}</h2>
          ${kv([
            ['Budget / retainer', budget > 0 ? money(budget) : '<span class="note">not set</span>'],
            ['Fees taken to income', money(feesEarned)],
            ['Disbursements', money(disbursements)],
            ['Unbilled time (WIP)', money(unbilled)],
            ['Actual to date', `${money(actual)} ${over ? tag('OVER BUDGET', 'gate') : nearing ? tag('over 80% used', 'gate') : budget > 0 ? tag('within budget', 'ok') : ''}`],
            ['Remaining', budget > 0 ? money(remaining) : '—'],
            ['Held in trust', money(trustHeld)],
          ])}
          <form method="POST" action="/r/client/budget">
            ${input('budget', 'Set budget / retainer figure', { type: 'number', required: true, placeholder: '15000.00', value: budget > 0 ? String(budget) : '' })}
            <button class="quiet" style="margin-top:10px">Save figure on matter</button>
          </form>
        </div>
      </div>

      <h2 class="sec">Status updates</h2>
      ${updates.length ? table(['Date', 'Update', 'Reading level', 'Sent by'], updates.map((u) => [
        date(u.sentOn || u.createdAt),
        esc(u.text),
        gradeTag(readingGrade(u.text)),
        esc(u.sentBy || ''),
      ])) : empty('No updates yet — record the first one above.')}

      <h2 class="sec">Decision memos — the calls that are the client's to make</h2>
      <div class="card">
        <form method="POST" action="/r/client/memo">
          ${input('question', 'Decision put to the client', { required: true, placeholder: 'Accept the settlement offer of $80,000?' })}
          ${textarea('options', 'Options explained (one per line)', { placeholder: 'Accept — funds in ~30 days, matter closes\nCounter at $95,000 — adds 2-3 months\nRefuse and proceed to trial' })}
          ${input('decision', 'Client’s decision', { required: true, placeholder: 'Counter at $95,000' })}
          <div class="grid2">
            <span>${input('decidedOn', 'Date decided', { type: 'date', value: new Date().toISOString().slice(0, 10) })}</span>
            <span>${input('recordedBy', 'Authority recorded by', { value: ctx.user.name })}</span>
          </div>
          <button>Record decision</button>
        </form>
      </div>
      ${memos.length ? table(['Date', 'Question', 'Options', 'Client decision', 'Recorded by'], memos.map((d) => [
        date(d.decidedOn || d.createdAt),
        esc(d.question),
        esc(d.options || '').replace(/\n/g, '<br>'),
        `<b>${esc(d.decision)}</b>`,
        esc(d.recordedBy || ''),
      ])) : empty('No client decisions yet — put the call to the client and record it above.')}
      `;
    }
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Updates that land — plain language, budget honesty, authority on record', body }));
  });

  app.route('POST', `/r/${ROOM.id}/update`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/client'); return; }
    const text = String(ctx.body.text || '').trim();
    if (!text) { ctx.setFlash('Write the update before recording it.', 'err'); redirect(res, '/r/client'); return; }
    const grade = readingGrade(text);
    ctx.kernel.scope(ctx.matter.id).put('clientUpdate', {
      text,
      sentOn: ctx.body.sentOn || new Date().toISOString().slice(0, 10),
      sentBy: String(ctx.body.sentBy || ctx.user.name).trim() || ctx.user.name,
      grade,
    });
    ctx.setFlash(grade > 9
      ? `Update recorded — reading level ~grade ${grade}. Consider shorter sentences and plainer words (aim under 9).`
      : `Update recorded — reading level ~grade ${grade}.`);
    redirect(res, '/r/client');
  });

  app.route('POST', `/r/${ROOM.id}/memo`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/client'); return; }
    const question = String(ctx.body.question || '').trim();
    const decision = String(ctx.body.decision || '').trim();
    if (!question || !decision) { ctx.setFlash('A decision memo needs both the question and the client’s decision.', 'err'); redirect(res, '/r/client'); return; }
    ctx.kernel.scope(ctx.matter.id).put('decisionMemo', {
      question,
      options: String(ctx.body.options || '').trim(),
      decision,
      decidedOn: ctx.body.decidedOn || new Date().toISOString().slice(0, 10),
      recordedBy: String(ctx.body.recordedBy || ctx.user.name).trim() || ctx.user.name,
    });
    ctx.setFlash('Client decision recorded — the authority is on file.');
    redirect(res, '/r/client');
  });

  app.route('POST', `/r/${ROOM.id}/budget`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/client'); return; }
    const amt = Number(ctx.body.budget);
    if (!(amt > 0)) { ctx.setFlash('Enter a positive budget figure.', 'err'); redirect(res, '/r/client'); return; }
    const k = ctx.kernel;
    const m = k.firm.get('matter', ctx.matter.id);
    if (!m) { ctx.setFlash('Matter unavailable.', 'err'); redirect(res, '/r/client'); return; }
    k.firm.put('matter', { ...m, budget: amt });
    ctx.setFlash(`Budget figure set at ${amt.toFixed(2)} — actuals now report against it.`);
    redirect(res, '/r/client');
  });
}

module.exports = { ...ROOM, register };
