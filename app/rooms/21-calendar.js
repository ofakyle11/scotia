'use strict';
// Room 21 — Trial Calendar. Deadlines computed from rules, never typed.
// Plus bring-forwards (ticklers, kept visually apart from court dates), a
// token-authenticated ICS phone feed, and an appeal-clock watchdog so a
// recorded judgment never sits with its appeal period uncalendared.
const { layout, esc, table, empty, tag, input, select, date } = require('../kernel/html.js');
const { html, redirect, send } = require('../kernel/http.js');

const ROOM = { num: 21, id: 'calendar', title: 'Trial Calendar', phase: 'Argue' };

// ---- Reference data: firm backward-planning template (NOT statutory) ----
// Offsets are calendar days BEFORE the trial date. This is the firm's standard
// pretrial cascade used to seed the working plan; a court's scheduling order
// controls the real dates and counsel confirms each against it. Where a
// milestone is fixed by a real rule (US FRCP expert/pretrial disclosures) the
// rule is cited; the rest are marked firm-default. Each milestone is computed
// with the procedural roll in kernel/rules.js (weekend/holiday → next business
// day) via a synthetic negative-offset rule — rules.js is not modified.
const PRETRIAL_TEMPLATE = {
  'us-fed': [
    { key: 'expert-disclosure', label: 'Expert disclosures served', before: 90, cite: 'FRCP 26(a)(2)(D)(i)', firm: false },
    { key: 'discovery-close', label: 'Fact discovery closes', before: 60, cite: 'Firm default — scheduling-order controlled', firm: true },
    { key: 'dispositive-motion', label: 'Dispositive motions filed', before: 45, cite: 'Firm default — scheduling-order controlled', firm: true },
    { key: 'pretrial-conference', label: 'Final pretrial conference', before: 30, cite: 'FRCP 16(e) / pretrial disclosures FRCP 26(a)(3)(B)', firm: false },
  ],
  _default: [
    { key: 'expert-disclosure', label: 'Expert reports exchanged', before: 90, cite: 'Firm default — case-management order controlled', firm: true },
    { key: 'discovery-close', label: 'Discovery closes', before: 60, cite: 'Firm default — case-management order controlled', firm: true },
    { key: 'dispositive-motion', label: 'Dispositive/summary-judgment motions filed', before: 45, cite: 'Firm default — case-management order controlled', firm: true },
    { key: 'pretrial-conference', label: 'Pretrial (trial management) conference', before: 30, cite: 'Firm default — case-management order controlled', firm: true },
  ],
};
function pretrialTemplate(jur) { return PRETRIAL_TEMPLATE[jur] || PRETRIAL_TEMPLATE._default; }

// Marker stamped on every deadline the trial cascade creates. Recompute clears
// the old chain STRICTLY by this marker and never by the anchor: a deadline
// another room hangs off the trial date (an expert report date, say) carries
// anchor:'trial' too, and sweeping by anchor destroyed it silently.
const CASCADE_SOURCE = 'trial-cascade';

// The diary is paper as often as it is screen: counsel carries it to a
// scheduling appointment and to the weekly file review. The shared base in
// kernel/html.js drops the chrome, every form and the palette; stated here is
// only what it cannot know — the room heading has no place on a diary handed
// across a table, and the two-up cards read as one column on paper.
const PRINT = `<style>@media print{
h1.room,.roomsub{display:none}
.grid2,.grid3{display:block}
}</style>`;

// Every deadline this room writes carries BOTH `rule` (the citation string all
// rooms write) and `ruleId` (the kernel/rules.js id, or the cascade's own id).
// 27-desk's LIMITATION flag, its dual-diary tick and the appeal-clock watchdog
// key off `ruleId`; a row written without one is invisible to those controls.
// ruleId is a positional argument here so no future write path can forget it.
function putDeadline(s, ruleId, fields) {
  return s.put('deadline', { ...fields, ruleId });
}

// A date typed into a form: real, and the day that was actually typed. V8 rolls
// '2026-02-31' forward into March and k.rules.compute() throws outright on an
// unparseable string, so a format test alone either calendars a day nobody
// chose or 500s the page.
function realDate(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

// Back-calculate each milestone from the trial date: a synthetic negative-offset
// rule fed to k.rules.compute() subtracts the offset, then rolls a
// weekend/holiday landing BACKWARD — away from trial — so a milestone that must
// be served at least N days before trial keeps at least N days of lead. (Rolling
// these forward, as this cascade used to, quietly shortened that lead time.)
// Nothing is typed by hand.
function computeCascade(k, jur, trialDate) {
  return pretrialTemplate(jur).map((m) => {
    const synth = { id: 'trial-back-' + m.key, jur, category: 'procedural', method: 'calendar', days: -m.before };
    return { ...m, due: k.rules.compute(synth, trialDate) };
  });
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) {
      html(res, layout({ ...ctx, room: ROOM.id }, {
        title: ROOM.title, sub: 'Every date computed from its rule',
        body: empty('Open a matter above to compute its deadlines from the rulebook. The phone feed below is yours, not the matter’s — mint it once and it carries every matter you can see.')
          + `<div style="margin-top:16px">${feedCard(k, ctx.user)}</div>`,
      }));
      return;
    }
    const s = k.scope(ctx.matter.id);
    const deadlines = s.list('deadline').sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const bfs = s.list('bf').sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const judgments = s.list('judgment');
    const jur = ctx.matter.jurisdiction || 'on';
    const jrules = k.rules.rulesFor(jur);
    const today = new Date().toISOString().slice(0, 10);

    // Appeal-clock watchdog: a judgment on the record with no open appeal
    // deadline on the calendar is a claim waiting to happen.
    let appealCard = '';
    // Match how 27-desk and 25-judgment already do it: an appeal clock counts as
    // calendared however it was written — by this room with a ruleId, or by hand
    // with only 'Notice of appeal due' typed in. Keying on ruleId alone left a
    // hand-diarised appeal permanently showing 'no open appeal deadline', and a
    // standing false alarm on a malpractice-grade control teaches counsel to
    // ignore the control.
    const openAppeal = deadlines.some((d) => d.status === 'open'
      && /appeal/i.test(`${d.ruleId || ''} ${d.rule || ''} ${d.desc || ''}`));
    if (judgments.length && !openAppeal) {
      const appealRules = jrules.filter((r) => r.id.includes('appeal'));
      appealCard = `<div class="card" style="border-color:var(--oxide)">
        <h2 class="sec" style="margin-top:0">Appeal clock ${tag('UNCALENDARED', 'gate')}</h2>
        ${appealRules.length ? `
        <p class="note">Judgment${judgments.length > 1 ? 's' : ''} recorded in the Judgment room, but no open appeal deadline sits on this calendar. One click computes it from the rule — nothing typed.</p>
        ${judgments.map((j) => `
        <form method="POST" action="/r/calendar/compute" style="margin:0 0 12px">
          <p style="margin:10px 0 0;font-size:13px">Judgment entered ${date(j.dateEntered)}${j.court ? ' — ' + esc(j.court) : ''}${j.debtor ? ' · ' + esc(j.debtor) : ''}</p>
          ${appealRules.length > 1
            ? select('rule', 'Appeal rule', appealRules.map((r) => [r.id, r.desc + ' — ' + r.cite]), appealRules[0].id)
            : `<input type="hidden" name="rule" value="${esc(appealRules[0].id)}"><p class="note">${esc(appealRules[0].desc)} — ${esc(appealRules[0].cite)} (${appealRules[0].days} days from ${esc(appealRules[0].trigger.toLowerCase())}).</p>`}
          <input type="hidden" name="trigger" value="${esc(j.dateEntered || '')}">
          <button>Calendar the appeal clock</button>
        </form>`).join('')}` : `
        <p class="note">Judgment recorded, but the ${esc(jur)} reference tranche carries no appeal rule yet, so the appeal period cannot be computed here until the rulebook grows. Nothing is fabricated in its place.</p>`}
      </div>`;
    }

    // The diary at a glance — the one line counsel reads first.
    const openD = deadlines.filter((d) => d.status === 'open');
    const overdue = openD.filter((d) => d.due && d.due < today).length;
    const soon = openD.filter((d) => d.due && d.due >= today && daysOut(d.due) <= 14).length;
    const openBF = bfs.filter((b) => b.status === 'open');
    const chips = `${overdue ? tag(overdue + ' overdue', 'gate') + ' ' : ''}${soon ? tag(soon + ' within 14 days', 'navy') + ' ' : ''}${tag(openD.length + ' open')}`;

    // Trial-anchored cascade: the working pretrial plan, back-calculated from
    // the trial date. Its deadlines carry anchor:'trial' so moving the trial
    // date recomputes the whole chain in one place. It is setup, done once a
    // matter and again when the trial moves, so it sits below the diary.
    const anchor = s.list('trialAnchor')[0] || null;
    const trialDeadlines = deadlines.filter((d) => d.anchor === 'trial');
    // Only the stamped rows are the cascade's to manage; anything else anchored
    // to the trial belongs to another writer (or predates the stamp) and is
    // shown, never touched.
    const cascadeRows = trialDeadlines.filter((d) => d.source === CASCADE_SOURCE);
    const unmanaged = trialDeadlines.filter((d) => d.source !== CASCADE_SOURCE);
    const preview = anchor && anchor.trialDate ? computeCascade(k, jur, anchor.trialDate) : [];
    const cascadeCard = `<div class="card no-print">
      <h2 class="sec" style="margin-top:0">Trial-anchored cascade ${tag('BACK-COMPUTED', 'navy')}${anchor && anchor.trialDate ? ' ' + tag('trial ' + String(anchor.trialDate).slice(0, 10), 'navy') : ''}</h2>
      <form method="POST" action="/r/calendar/trial">
        ${input('trialDate', 'Trial date', { type: 'date', required: true, value: anchor ? String(anchor.trialDate || '').slice(0, 10) : '' })}
        <button>${anchor ? 'Recompute the cascade' : 'Compute & calendar the cascade'}</button>
      </form>
      <p class="note">Set the trial date and the standard pretrial chain — expert disclosure, discovery close, dispositive-motion deadline, pretrial conference — is back-calculated as offsets before trial and calendared. Move the trial date and the whole chain recomputes; the milestones carry a <b>trial</b> anchor so they never collide with forward-computed deadlines.</p>
      ${anchor && anchor.trialDate ? `
      <p class="note" style="margin-top:14px">Cascade for ${esc(jur)} — ${cascadeRows.length} milestone${cascadeRows.length === 1 ? '' : 's'} on the calendar:</p>
      ${table(['Before', 'Milestone', 'Computed date', 'Basis'], pretrialTemplate(jur).map((m, i) => [
        `<span class="num">${m.before}d</span>`, esc(m.label), date(preview[i] && preview[i].due),
        `<span class="note">${esc(m.cite)}${m.firm ? ' ' : ''}</span>${m.firm ? tag('firm default', '') : tag('rule', 'ok')}`,
      ]))}
      <p class="note">Offsets roll off weekends/holidays to the next business day via the same procedural rule engine as forward deadlines. Firm-default milestones are the firm's backward-planning template, not statutory — confirm each against the court's scheduling/case-management order. FRCP-fixed milestones cite the rule. Build Sheet: per-court scheduling templates wire in here.</p>`
      : `<p class="note" style="margin-top:14px">No trial date set — the cascade is empty until you anchor it.</p>`}
      ${unmanaged.length ? `<p class="note"><b>${unmanaged.length} trial-anchored deadline${unmanaged.length === 1 ? '' : 's'} on this calendar ${unmanaged.length === 1 ? 'was' : 'were'} not created by this cascade</b> — no <span class="num">trial-cascade</span> stamp, so ${unmanaged.length === 1 ? 'it is' : 'they are'} another writer's row${unmanaged.length === 1 ? '' : 's'} (an expert or discovery date hung off the trial, or a row predating the stamp). Recompute leaves ${unmanaged.length === 1 ? 'it' : 'them'} alone by design: this room deletes only what it stamped. ${unmanaged.length === 1 ? 'It is' : 'They are'} tagged <i>not cascade-managed</i> in the diary above — close or supersede ${unmanaged.length === 1 ? 'it' : 'them'} in the room that owns ${unmanaged.length === 1 ? 'it' : 'them'} if ${unmanaged.length === 1 ? 'it duplicates' : 'they duplicate'} a milestone.</p>` : ''}
    </div>`;

    const body = `${PRINT}
    <div class="print-only" style="margin-bottom:14px"><h2 class="sec" style="margin-top:0">Deadline diary — ${esc(ctx.matter.title)} — as at ${esc(today)}</h2></div>
    <p class="note no-print" style="margin:0 0 18px"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the diary and the bring-forwards alone — every date beside the rule it came from.</p>
    ${appealCard}
    <div class="grid2 no-print">
      <div class="card">
        <h2 class="sec" style="margin-top:0">Compute a deadline</h2>
        <form method="POST" action="/r/calendar/compute">
          ${select('rule', 'Rule (' + esc(jur) + ')', jrules.map((r) => [r.id, r.trigger + ' → ' + r.desc]))}
          ${input('trigger', 'Trigger date', { type: 'date', required: true })}
          <button>Compute &amp; calendar</button>
        </form>
        <p class="note">Dates are computed from the rule — counting method, weekend and holiday rolls — and every entry shows the rule it came from. Nothing on this calendar was typed by hand.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Bring-forward ${tag('BF', 'navy')}</h2>
        <form method="POST" action="/r/calendar/bf">
          ${input('note', 'What to chase', { required: true, placeholder: 'e.g. chase the transcript ordered today' })}
          ${input('due', 'BF date', { type: 'date', required: true })}
          <button>Set BF</button>
        </form>
        <p class="note">BFs are reminders you set by hand. They live in their own list, carry their own BF tag on the phone feed, and never mix with rule-computed deadlines — a tickler must not masquerade as a court date.</p>
      </div>
    </div>
    <h2 class="sec">Diary — ${esc(ctx.matter.title)} ${chips}</h2>
    ${deadlines.length ? table(['Due', 'Deadline', 'Trigger', 'Authority', 'Status', ''], deadlines.map((d) => [
      date(d.due) + (d.due < today && d.status === 'open' ? ' ' + tag('OVERDUE', 'gate') : (daysOut(d.due) <= 14 && d.status === 'open' ? ' ' + tag(daysOut(d.due) + 'd', 'navy') : ''))
        + (d.nonBusinessDay ? '<br>' + tag('weekend/holiday — not rolled forward', 'gate') : ''),
      esc(d.desc) + (d.anchor === 'trial' ? ' ' + tag('trial', 'navy') + (d.source === CASCADE_SOURCE ? '' : ' ' + tag('not cascade-managed', '')) : ''), esc(d.trigger || ''), `<span class="note">${esc(d.rule || '')}</span>`
        + (d.stale ? '<br>' + tag('STALE — ' + (d.staleReason || 'governing law changed'), 'gate') : ''),
      d.status === 'done' ? tag('done', 'ok') : tag('open'),
      d.status === 'open' ? `<span class="no-print"><form method="POST" action="/r/calendar/done" style="margin:0"><input type="hidden" name="id" value="${esc(d.id)}"><button class="quiet">Done</button></form></span>` : '',
    ])) : empty('No deadlines calendared for this matter yet — pick a rule and a trigger date above; one click computes and calendars it.')}
    <h2 class="sec">Bring-forwards ${tag('BF', 'navy')} — ticklers, never court dates${openBF.length ? ' ' + tag(openBF.length + ' open', 'navy') : ''}</h2>
    ${bfs.length ? table(['Due', 'Note', 'Status', ''], bfs.map((b) => [
      date(b.due) + (b.due < today && b.status === 'open' ? ' ' + tag('OVERDUE', 'gate') : ''),
      esc(b.note),
      b.status === 'done' ? tag('done', 'ok') : tag('open'),
      b.status === 'open' ? `<span class="no-print"><form method="POST" action="/r/calendar/bf-done" style="margin:0"><input type="hidden" name="id" value="${esc(b.id)}"><button class="quiet">Done</button></form></span>` : '',
    ])) : empty('No bring-forwards on this matter — BF the transcript chase the day you order it.')}
    ${cascadeCard}
    <div class="grid2 no-print">
      <div class="card">
        <h2 class="sec" style="margin-top:0">The rulebook — ${esc(jur)}</h2>
        ${table(['Trigger', 'Days', 'Deadline', 'Type', 'Authority'], jrules.map((r) => [
          esc(r.trigger), `<span class="num">${r.days}</span>`, esc(r.desc),
          k.rules.isLimitation(r) ? tag('limitation', 'gate') : tag('procedural'),
          `<span class="note">${esc(r.cite)}</span>`,
        ]))}
        <p class="note">A procedural deadline landing on a weekend or holiday rolls forward to the next business day. A <b>limitation or prescription date does not</b> — a statutory expiry must never be pushed to a later, false-safe day, so it is calendared exactly as it falls and flagged for counsel instead. Reference tranche: 2026 holiday tables, real citations, scoped to the jurisdictions listed.</p>
      </div>
      ${feedCard(k, ctx.user)}
    </div>
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Every date computed from its rule — deadlines, bring-forwards, phone feed', body }));
  });

  app.route('POST', `/r/${ROOM.id}/compute`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/calendar'); return; }
    const rule = k.rules.rule(ctx.body.rule);
    const trigger = realDate(ctx.body.trigger);
    if (!rule || !trigger) { ctx.setFlash('Pick a rule and a real trigger date (YYYY-MM-DD).', 'err'); redirect(res, '/r/calendar'); return; }
    const due = k.rules.compute(rule, trigger);
    // rule.cite is the citation string every room writes; rule.id is what
    // 27-desk's limitation flag and the appeal watchdog read. Both, always.
    // Whether a LIMITATION date lands on a non-business day is a property of
    // the date, not of the moment it was calendared. It used to be announced in
    // a flash and then lost — so the one date most worth flagging every time
    // anyone looks at it was flagged exactly once, to whoever happened to be at
    // the keyboard. Persist it on the record.
    const nonBusinessDay = k.rules.isLimitation(rule) && k.rules.landsOnNonBusinessDay(rule, due);
    putDeadline(k.scope(ctx.matter.id), rule.id, {
      desc: rule.desc, due, rule: rule.cite, trigger: rule.trigger + ' ' + trigger, status: 'open',
      nonBusinessDay,
    });
    // A limitation date comes back exactly as it falls — kernel/rules.js
    // deliberately does not roll one off a weekend or holiday, because a
    // statutory expiry must never be pushed to a later, false-safe day. Say so
    // where it lands on one; never move it.
    const warn = nonBusinessDay;
    ctx.setFlash(`Calendared: ${rule.desc} — ${due} (${rule.cite}).`
      + (warn ? ' LIMITATION date falling on a weekend or holiday — it is not rolled forward. Confirm any statutory extension and work to the business day before.' : ''), warn ? 'err' : undefined);
    redirect(res, '/r/calendar');
  });

  // Trial-anchored cascade: set/move the trial date, then back-calculate the
  // standard pretrial chain and (re)calendar it. Recompute is idempotent — the
  // prior trial-anchored deadlines are cleared and rebuilt from the new date.
  app.route('POST', `/r/${ROOM.id}/trial`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/calendar'); return; }
    const trialDate = realDate(ctx.body.trialDate);
    if (!trialDate) { ctx.setFlash('The cascade needs a real trial date (YYYY-MM-DD).', 'err'); redirect(res, '/r/calendar'); return; }
    const s = k.scope(ctx.matter.id);
    const jur = ctx.matter.jurisdiction || 'on';
    // Clear ONLY the rows this cascade created — they carry the trial-cascade
    // stamp. Deleting by anchor:'trial' instead swept away any other room's
    // trial-anchored deadline (15-experts' report date, 12-discovery's cutoff)
    // on every recompute; a room may destroy its own records and no others.
    const stale = s.list('deadline', (x) => x.source === CASCADE_SOURCE);
    for (const d of stale) s.del('deadline', d.id);
    const existing = s.list('trialAnchor')[0];
    s.put('trialAnchor', { ...(existing || {}), trialDate, jurisdiction: jur, setBy: ctx.user.id });
    // The trial date itself sits on the calendar (no roll — it is the anchor).
    putDeadline(s, 'trial-date', {
      desc: 'Trial commences', due: trialDate, rule: 'Trial date (anchor)', trigger: 'Set trial date ' + trialDate,
      status: 'open', anchor: 'trial', milestone: 'trial', trialDate, source: CASCADE_SOURCE,
    });
    const cascade = computeCascade(k, jur, trialDate);
    for (const m of cascade) {
      putDeadline(s, 'trial-back-' + m.key, {
        desc: m.label, due: m.due, rule: m.cite, trigger: 'Trial ' + trialDate + ' minus ' + m.before + 'd',
        status: 'open', anchor: 'trial', milestone: m.key, trialDate, source: CASCADE_SOURCE,
      });
    }
    k.audit('calendar.trial.cascade', ctx.matter.id + ':' + trialDate + ':' + cascade.length + ':replaced=' + stale.length);
    const orphans = s.list('deadline', (x) => x.anchor === 'trial' && x.source !== CASCADE_SOURCE).length;
    ctx.setFlash(`Trial-anchored cascade ${existing ? 'recomputed' : 'calendared'} from ${trialDate} — ${cascade.length} pretrial milestones back-calculated${stale.length ? `, ${stale.length} superseded cascade date${stale.length === 1 ? '' : 's'} cleared` : ''}. Confirm firm-default dates against the scheduling order.${orphans ? ` ${orphans} trial-anchored deadline${orphans === 1 ? '' : 's'} not created by this cascade ${orphans === 1 ? 'was' : 'were'} left untouched — review ${orphans === 1 ? 'it' : 'them'} in the diary.` : ''}`);
    redirect(res, '/r/calendar');
  });

  app.route('POST', `/r/${ROOM.id}/done`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (ctx.matter) {
      const s = k.scope(ctx.matter.id);
      const d = s.get('deadline', String(ctx.body.id || ''));
      if (d) { s.put('deadline', { ...d, status: 'done' }); ctx.setFlash(`Closed: ${d.desc} (${d.due || 'no date'}).`); }
    }
    redirect(res, '/r/calendar');
  });

  // ---- bring-forwards ----
  app.route('POST', `/r/${ROOM.id}/bf`, (req, res, ctx) => {
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, '/r/calendar'); return; }
    const note = String(ctx.body.note || '').trim();
    const due = realDate(ctx.body.due);
    if (!note || !due) {
      ctx.setFlash('A BF needs a note and a real date (YYYY-MM-DD).', 'err'); redirect(res, '/r/calendar'); return;
    }
    ctx.kernel.scope(ctx.matter.id).put('bf', { note, due, owner: ctx.user.id, status: 'open' });
    ctx.setFlash(`BF set for ${due} — it stays a tickler, never a court date.`);
    redirect(res, '/r/calendar');
  });

  app.route('POST', `/r/${ROOM.id}/bf-done`, (req, res, ctx) => {
    if (ctx.matter) {
      const s = ctx.kernel.scope(ctx.matter.id);
      const b = s.get('bf', String(ctx.body.id || ''));
      if (b) { s.put('bf', { ...b, status: 'done' }); ctx.setFlash(`BF cleared: ${b.note}.`); }
    }
    redirect(res, '/r/calendar');
  });

  // ---- phone feed ----
  app.route('POST', `/r/${ROOM.id}/feed-new`, (req, res, ctx) => {
    const k = ctx.kernel;
    for (const f of k.firm.list('calfeed', (f2) => f2.userId === ctx.user.id)) k.firm.del('calfeed', f.id);
    // The store assigns the id via the kernel's crypto.randomUUID — an
    // unguessable, regenerable token, minted without this room touching crypto.
    k.firm.put('calfeed', { userId: ctx.user.id });
    k.audit('calendar.feed.regenerate', ctx.user.id);
    ctx.setFlash('Phone feed link minted — any previous link is dead. Subscribe your calendar app to the new address.');
    redirect(res, '/r/calendar');
  });

  // RFC 5545 feed. Purely token-authenticated: the unguessable calfeed id is
  // the whole credential, and this handler deliberately never reads ctx.user
  // or ctx.matter — see the integration note in the Phone feed card for what
  // server.js must change before a cookie-less phone can actually reach it.
  app.route('GET', `/r/${ROOM.id}/feed/:token`, (req, res, ctx) => {
    const k = ctx.kernel;
    // Verified against server.js: makeCtx's PUBLIC set is
    // {GET /, POST /login, POST /login/totp, GET /healthz, GET /robots.txt}
    // plus the /invite/ prefix, and its public branch returns a ctx with NO
    // kernel. So a cookie-less phone is 303'd to sign-in before this runs, and
    // the day server.js admits this prefix it must also build the kernel for
    // the calfeed's userId. Answer plainly rather than throwing in between.
    if (!k) { send(res, 503, 'Calendar feed not enabled: this token-authenticated route needs server.js to build a kernel for the feed owner. See the Phone feed note in the Trial Calendar.'); return; }
    const feed = k.firm.get('calfeed', ctx.params.token);
    if (!feed) { send(res, 404, 'Not found.'); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chambers//Trial Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Chambers deadlines & BFs'];
    for (const m of k.matters()) {
      if (k.isShredded(m.id)) continue;
      let ds = [], bs = [];
      try {
        const s = k.scope(m.id);
        ds = s.list('deadline', (d) => d.status === 'open');
        bs = s.list('bf', (b) => b.status === 'open');
      } catch { continue; }
      for (const d of ds) {
        vevent(lines, stamp, d.id, d.due, `[${m.title}] ${d.desc}`,
          [d.rule, d.trigger].filter(Boolean).join(' — '), 'DEADLINE');
      }
      for (const b of bs) {
        vevent(lines, stamp, b.id, b.due, `BF: [${m.title}] ${b.note}`,
          'Bring-forward (tickler — not a computed court deadline)', 'BRING-FORWARD');
      }
    }
    lines.push('END:VCALENDAR');
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="chambers.ics"',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(lines.map(fold).join('\r\n') + '\r\n');
  });
}

function feedCard(k, user) {
  const feed = k.firm.list('calfeed', (f) => f.userId === user.id)[0];
  return `<div class="card no-print">
    <h2 class="sec" style="margin-top:0">Phone feed ${tag('ICS', 'navy')}</h2>
    ${feed ? `
    <p style="font-size:13px;color:var(--ink-soft);margin:0 0 4px">Subscribe your phone's calendar app to:</p>
    <p class="num" style="word-break:break-all;margin:0"><a href="/r/calendar/feed/${esc(feed.id)}">/r/calendar/feed/${esc(feed.id)}</a></p>
    <p class="note">Every open deadline (rule citation included) and every BF across your visible matters lands on the phone — nothing re-typed, so nothing mistyped. The link is the credential: anyone holding it can read your feed, and regenerating kills the old link instantly.</p>`
      : `<p class="note">Mint a private, unguessable link your phone's calendar app can subscribe to — every open deadline (rule citation included) and every BF across your visible matters, with no re-typing.</p>`}
    <form method="POST" action="/r/calendar/feed-new"><button${feed ? ' class="danger"' : ''}>${feed ? 'Regenerate link (kills the old one)' : 'Create feed link'}</button></form>
    <p class="note">Integration note — makeCtx in server.js admits only its fixed PUBLIC paths without a session cookie, so a phone's cookie-less fetch is 303'd to sign-in before this handler runs. Exposing the feed publicly requires makeCtx to admit the /r/calendar/feed/ prefix and build the kernel for the calfeed's userId — a server.js change outside this room's file. The handler here is already written purely token-authenticated against that day.</p>
  </div>`;
}

// One all-day VEVENT. Skips a record whose due date cannot make a valid
// DTSTART — a broken line must not poison the whole subscription.
function vevent(lines, stamp, id, due, summary, description, category) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(due || ''))) return;
  lines.push(
    'BEGIN:VEVENT',
    `UID:${escICS(id)}@chambers`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${String(due).slice(0, 10).replace(/-/g, '')}`,
    `SUMMARY:${escICS(summary)}`,
    `DESCRIPTION:${escICS(description)}`,
    `CATEGORIES:${category}`,
    'END:VEVENT'
  );
}

// RFC 5545 §3.3.11 text escaping: backslash first, then ; , and newlines.
const escICS = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r\n|\r|\n/g, '\\n');

// RFC 5545 §3.1 line folding: continuation lines begin with a space.
function fold(line) {
  let s = line;
  const out = [];
  while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
  out.push(s);
  return out.join('\r\n');
}

function daysOut(iso) { return Math.ceil((new Date(iso) - Date.now()) / 86400000); }

module.exports = { ...ROOM, register };
