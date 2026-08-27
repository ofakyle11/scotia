'use strict';
// Room 03 — Retainer. Engagement records per matter: scope in, scope out,
// fee model, draft->sent->signed with dates. Scope change = new version;
// the prior version is marked superseded, never edited in place.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date, money } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 3, id: 'retainer', title: 'Retainer', phase: 'Intake' };

const FEE_MODELS = [
  ['hourly', 'Hourly rate'],
  ['flat', 'Flat fee'],
  ['contingency', 'Contingency %'],
];

const CONTINGENCY_NOTE = 'Reference — contingency retainers: caps and written-agreement rules vary by '
  + 'jurisdiction. In Ontario, s. 28.1 of the Solicitors Act, R.S.O. 1990, c. S.15 requires a contingency '
  + 'fee agreement to be in writing, and O. Reg. 563/20 prescribes a mandatory standard form and client '
  + 'disclosure (in force July 1, 2021). Verify the current rules of the governing jurisdiction before sending.';

// Ctrl-P (or the button) yields the engagement letter alone: the chrome, the
// editors, the version history and the gate notices all drop out, and the
// letter itself sets in a serif face at a size that survives a client's desk.
const PRINT = `<style>@media print{
.side,.topbar,.flash,.no-print,form,button{display:none!important}
.shell{display:block;min-height:0}.main{padding:0}
.grid2,.grid3{display:block}
h1.room,.roomsub,h2.sec{display:none!important}
body{background:#fff;color:#111}
.letter-sheet{border:0!important;background:#fff!important;padding:0!important}
.letter-sheet pre{color:#111!important;font-family:Georgia,"Times New Roman",serif!important;font-size:11.5pt!important;line-height:1.5!important}
}</style>`;

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function feeSentence(e) {
  if (e.feeModel === 'hourly') {
    return `Our fee is $${fmt(e.rate)} per hour, plus disbursements and applicable taxes, billed monthly.`;
  }
  if (e.feeModel === 'flat') {
    return `Our fee is a flat fee of $${fmt(e.flatAmount)} for the work described in section 1, plus disbursements and applicable taxes.`;
  }
  return `Our fee is ${e.contingencyPct}% of any amount recovered by settlement, judgment, or award, plus `
    + `disbursements and applicable taxes, payable only in the event of recovery. This is a contingency fee `
    + `agreement and must satisfy the written-agreement and disclosure rules of the governing jurisdiction.`;
}

function feeSummary(e) {
  if (e.feeModel === 'hourly') return `${money(e.rate)} <span class="note" style="display:inline">/ hour</span>`;
  if (e.feeModel === 'flat') return `${money(e.flatAmount)} <span class="note" style="display:inline">flat</span>`;
  return `<span class="num">${esc(String(e.contingencyPct))}%</span> <span class="note" style="display:inline">of recovery</span>`;
}

// The engagement letter is generated from the record's fields at creation
// and stored with the version, so what was sent is what stays on file.
function letterText(matter, user, e) {
  const scopeOut = String(e.scopeOut || '').trim();
  return [
    `ENGAGEMENT LETTER — ${matter.title} — version ${e.version}`,
    '',
    e.drafted,
    '',
    matter.client,
    `Re: ${matter.title}`,
    '',
    `Dear ${matter.client}:`,
    '',
    'Thank you for retaining this firm. This letter records the terms of our engagement and, once signed, governs the retainer.',
    '',
    `1. Scope of the engagement. We will act for you in the following: ${e.scopeIn}`,
    '',
    `2. Outside the scope. Our engagement does not include: ${scopeOut || 'no exclusions recorded — work not described in section 1 requires a further engagement in writing'}.`,
    '',
    `3. Fees. ${feeSentence(e)}`,
    '',
    '4. Changes to scope or fees. Any change takes effect only as a new version of this letter signed by you; prior versions are superseded, not amended.',
    '',
    'If these terms are acceptable, please sign and date below and return a copy. This engagement takes effect on the date of your signature.',
    '',
    'Yours truly,',
    '',
    user.name,
    '',
    'Acknowledged and agreed:',
    '',
    '_________________________          Date: ____________',
  ].join('\n');
}

function versionForm(action, cur) {
  const c = cur || {};
  return `<form method="POST" action="${action}">
    ${textarea('scopeIn', 'Scope in — what we will do', { required: true, value: c.scopeIn || '', placeholder: 'e.g. Defend the claim in ONSC file CV-26-00-000; advise on settlement.' })}
    ${textarea('scopeOut', 'Scope out — expressly excluded', { value: c.scopeOut || '', placeholder: 'e.g. Appeals; enforcement; tax advice; regulatory proceedings.' })}
    ${select('feeModel', 'Fee model', FEE_MODELS, c.feeModel || 'hourly')}
    <div class="grid3">
      <span>${input('rate', 'Hourly rate $', { type: 'number', value: c.rate || '', placeholder: '450' })}</span>
      <span>${input('flatAmount', 'Flat fee $', { type: 'number', value: c.flatAmount || '', placeholder: '7500' })}</span>
      <span>${input('contingencyPct', 'Contingency %', { type: 'number', value: c.contingencyPct || '', placeholder: '30' })}</span>
    </div>
    <p class="note">Fill only the field matching the model chosen above; the other two are ignored.</p>
    <button>${cur ? 'Issue new version — supersede current' : 'Draft engagement v1'}</button>
  </form>
  <p class="note">${esc(CONTINGENCY_NOTE)}</p>`;
}

function statusTag(s) {
  if (s === 'signed') return tag('signed', 'ok');
  if (s === 'sent') return tag('sent', 'navy');
  if (s === 'superseded') return tag('superseded');
  return tag('draft');
}

// Which conflict run clears THIS matter, if any? Per the shared conflictRun
// contract a run may carry matterId / inquiryId / parties; room 02's runs are
// keyed by the name checked. Any of those — outcome clear or waiver, on this
// matter or its client — satisfies the gate. Mirrors intake's clearanceFor.
// The gate below asks only whether one exists; the card shows counsel WHICH
// one, so a refused signature is never a surprise.
function clearanceFor(k, matter) {
  if (!matter) return null;
  const client = String(matter.client || '').trim().toLowerCase();
  // The inquiry this matter was opened from, if any — its runs count too.
  const inq = k.firm.list('inquiry', (i) => i.matterId === matter.id)[0] || null;
  return k.firm.list('conflictRun').find((r) => {
    if (!r || (r.outcome !== 'clear' && r.outcome !== 'waiver')) return false;
    if (r.matterId && r.matterId === matter.id) return true;
    if (inq && r.inquiryId && r.inquiryId === inq.id) return true;
    if (client && Array.isArray(r.parties) && r.parties.some((p) => String(p).trim().toLowerCase() === client)) return true;
    if (client && r.name && String(r.name).trim().toLowerCase() === client) return true;
    return false;
  }) || null;
}

function matterCleared(k, matter) {
  return !!clearanceFor(k, matter);
}

function clearanceCell(run) {
  if (!run) return `${tag('not cleared', 'gate')} <a href="/r/conflicts">run the check in room 02</a>`;
  return `${tag(run.outcome === 'waiver' ? 'waiver on file' : 'cleared', run.outcome === 'waiver' ? 'navy' : 'ok')} <span class="note" style="display:inline">run ${esc(String(run.createdAt || '').slice(0, 10))}${run.ranBy ? ' · ' + esc(run.ranBy) : ''}</span>`;
}

// Dates are round-tripped through Date so an impossible calendar day such as
// '2026-02-31' is REFUSED rather than silently rolled forward to March 3.
// A fee agreement must never carry an execution date that does not exist —
// and the marker below hands that date straight to Trust & Books.
function isoDay(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

// Marker numerics are compared and formatted by the reader, so coerce here:
// a legacy or hand-edited record can never hand it a string or a NaN. null
// means "not applicable to this fee model" — the reader renders that as
// "no rate recorded"; a 0 would read as a recorded zero.
const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// What the executed fee agreement commits the client to, where a single figure
// is knowable — the flat fee. Hourly/contingency have no fixed sum yet, so the
// marker records the model without inventing a number.
function expectedRetainerOf(e) {
  if (e.feeModel !== 'flat') return null;
  const n = num(e.flatAmount);
  return n != null && n > 0 ? n : null;
}

// ---- the firm-scope marker Trust & Books reads ----
// Shape is fixed by CONTRACT-SHEET §(c) `engagementSigned`: matterId,
// engagementId, version, feeModel, rate, flatAmount, contingencyPct,
// expectedRetainer, signedAt, signedBy. Built entirely from the engagement
// record that was stored, so the marker is self-sufficient — 28-books never
// has to reopen the matter to know the governing terms.
function signedMarker(matterId, e) {
  return {
    matterId,
    engagementId: e.id || null,
    version: num(e.version),
    feeModel: e.feeModel || null,
    rate: e.feeModel === 'hourly' ? num(e.rate) : null,
    flatAmount: e.feeModel === 'flat' ? num(e.flatAmount) : null,
    contingencyPct: e.feeModel === 'contingency' ? num(e.contingencyPct) : null,
    expectedRetainer: expectedRetainerOf(e),
    signedAt: isoDay(e.signedAt),
    signedBy: e.signedBy ? String(e.signedBy) : null,
  };
}

const markedVersions = (k, matterId) => new Set(
  k.firm.list('engagementSigned', (r) => r && r.matterId === matterId).map((r) => String(num(r.version))));

// Every path by which an engagement reaches 'signed' must leave the marker.
// The live transition posts it; this backs it in for versions signed before
// the marker existed, or whose firm write failed — those otherwise read
// "signed and in force" here and "no signed engagement on file" in room 28.
// It MIRRORS an existing signature and never performs one, so the conflicts
// gate is untouched: only /status can move an engagement to 'signed'.
function backfillMarkers(k, matterId, engagements) {
  const signed = engagements.filter((e) => e && e.status === 'signed');
  if (!signed.length) return 0;
  let n = 0;
  try {
    const have = markedVersions(k, matterId);
    for (const e of signed) {
      const key = String(num(e.version));
      if (have.has(key)) continue;
      k.firm.put('engagementSigned', signedMarker(matterId, e));
      k.audit('engagement.marker.backfill', matterId + ':v' + e.version);
      have.add(key);
      n++;
    }
  } catch (_) { /* the page must still render; the next open retries */ }
  return n;
}

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    let body;
    if (!ctx.matter) {
      body = empty('Open a matter to record its engagement terms — pick one from the matter list above, or accept an inquiry in Intake (room 01).');
    } else {
      const all = k.scope(ctx.matter.id).list('engagement').sort((a, b) => (b.version || 0) - (a.version || 0));
      // Repair any signed version that is missing its Trust & Books marker.
      backfillMarkers(k, ctx.matter.id, all);
      const cur = all.find((e) => e.status !== 'superseded') || null;
      const next = cur && cur.status === 'draft' ? ['sent', 'Record sent'] : cur && cur.status === 'sent' ? ['signed', 'Record signed'] : null;
      const clearance = clearanceFor(k, ctx.matter);
      const signBlocked = next && next[0] === 'signed' && !clearance;
      body = `
      ${PRINT}
      <div class="grid2 no-print">
        <div class="card">
          <h2 class="sec" style="margin-top:0">Current engagement — ${esc(ctx.matter.title)}</h2>
          ${cur ? `
          ${kv([
            ['Version', `<span class="num">v${esc(String(cur.version))}</span> ${statusTag(cur.status)}`],
            ['Conflicts', clearanceCell(clearance)],
            ['Fee', feeSummary(cur)],
            ['Scope in', esc(cur.scopeIn)],
            ['Scope out', esc(cur.scopeOut || '') || '—'],
            ['Drafted', date(cur.drafted)],
            ['Sent', cur.sentAt ? date(cur.sentAt) : '—'],
            ['Signed', cur.signedAt ? `${date(cur.signedAt)}${cur.signedBy ? ` <span class="note" style="display:inline">recorded by ${esc(cur.signedBy)}</span>` : ''}` : '—'],
          ])}
          ${next ? `${signBlocked ? `<p class="note">${tag('conflicts gate', 'gate')} Signing is refused until a clear or waiver for this matter is on file. Run it in Ethics &amp; Conflicts (room 02) — a fee agreement cannot execute for a client the firm has not screened.</p>` : ''}
          <form method="POST" action="/r/${ROOM.id}/status">
            <input type="hidden" name="id" value="${esc(cur.id)}"><input type="hidden" name="to" value="${next[0]}">
            ${input('on', `Date ${next[0]}`, { type: 'date', value: today() })}
            <button${signBlocked ? ' class="danger"' : ''}>${next[1]}</button>
          </form>` : '<p class="note">Signed and in force — this is the version room 34 bills against. A scope change issues a new version alongside.</p>'}
          ` : empty('No engagement on file — draft version 1 alongside. Nothing bills until it is signed.')}
        </div>
        <div class="card">
          <h2 class="sec" style="margin-top:0">${cur ? 'Scope change — new version' : 'Draft the engagement'}</h2>
          ${versionForm(`/r/${ROOM.id}/new`, cur)}
        </div>
      </div>
      ${cur ? `
      <h2 class="sec">Engagement letter — v${esc(String(cur.version))} ${tag('generated from the record')}</h2>
      <p class="note no-print"><a class="btn" href="#" onclick="window.print();return false" style="margin-top:0">Print / save as PDF</a> &nbsp; Printing yields the letter alone — the chrome and the version history drop out.</p>
      <div class="card letter-sheet"><pre style="white-space:pre-wrap;font-family:var(--f-mono);font-size:12px;line-height:1.7;margin:0">${esc(cur.letter || '')}</pre></div>
      ` : ''}
      <div class="no-print">
      <h2 class="sec">Versions</h2>
      ${table(['Version', 'Status', 'Fee', 'Drafted', 'Sent', 'Signed', 'Superseded', 'Scope in'],
        all.map((e) => [
          `<span class="num">v${esc(String(e.version))}</span>`, statusTag(e.status), feeSummary(e),
          date(e.drafted), e.sentAt ? date(e.sentAt) : '—', e.signedAt ? date(e.signedAt) : '—',
          e.supersededAt ? `${date(e.supersededAt)} <span class="note" style="display:inline">by v${esc(String(e.supersededBy))}</span>` : '—',
          esc(e.scopeIn),
        ])) || empty('No versions yet — draft v1 above. Every later change lands here as its own version; nothing is edited in place.')}
      </div>
      `;
    }
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Scope in, scope out, fee terms — versioned, never edited', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const scopeIn = String(ctx.body.scopeIn || '').trim();
    const feeModel = FEE_MODELS.some(([v]) => v === ctx.body.feeModel) ? ctx.body.feeModel : null;
    if (!scopeIn || !feeModel) { ctx.setFlash('Scope in and a fee model are required.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const rate = Number(ctx.body.rate), flatAmount = Number(ctx.body.flatAmount), pct = Number(ctx.body.contingencyPct);
    if (feeModel === 'hourly' && !(Number.isFinite(rate) && rate > 0)) { ctx.setFlash('Hourly model needs a positive hourly rate.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    if (feeModel === 'flat' && !(Number.isFinite(flatAmount) && flatAmount > 0)) { ctx.setFlash('Flat model needs a positive flat fee.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    if (feeModel === 'contingency' && !(Number.isFinite(pct) && pct > 0 && pct <= 100)) { ctx.setFlash('Contingency model needs a percentage between 0 and 100.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const sc = k.scope(ctx.matter.id);
    const all = sc.list('engagement');
    const version = all.reduce((m, e) => Math.max(m, e.version || 0), 0) + 1;
    const e = {
      version, scopeIn, scopeOut: String(ctx.body.scopeOut || '').trim(), feeModel,
      rate: feeModel === 'hourly' ? rate : null,
      flatAmount: feeModel === 'flat' ? flatAmount : null,
      contingencyPct: feeModel === 'contingency' ? pct : null,
      status: 'draft', drafted: today(), sentAt: null, signedAt: null, signedBy: null,
      supersededAt: null, supersededBy: null,
    };
    e.letter = letterText(ctx.matter, ctx.user, e);
    sc.put('engagement', e);
    // Prior versions: content untouched, only marked superseded.
    for (const prior of all.filter((p) => p.status !== 'superseded')) {
      sc.put('engagement', { ...prior, status: 'superseded', supersededAt: today(), supersededBy: version });
    }
    k.audit('engagement.version', ctx.matter.id + ':v' + version);
    ctx.setFlash(`Engagement v${version} drafted${all.length ? ' — prior version marked superseded' : ''}. Letter generated from the record.`);
    redirect(res, `/r/${ROOM.id}`);
  });

  app.route('POST', `/r/${ROOM.id}/status`, (req, res, ctx) => {
    const k = ctx.kernel;
    if (!ctx.matter) { ctx.setFlash('Open a matter first.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    const sc = k.scope(ctx.matter.id);
    const e = ctx.body.id ? sc.get('engagement', ctx.body.id) : null;
    if (!e) { ctx.setFlash('No such engagement version.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    // A cleared date field means "not typed" and dates to today; anything typed
    // must be a real calendar day. Refuse rather than roll forward or invent.
    const onRaw = String(ctx.body.on || '').trim();
    const on = onRaw ? isoDay(onRaw) : today();
    if (!on) { ctx.setFlash('That is not a real calendar date — enter the date the engagement was actually sent or signed.', 'err'); redirect(res, `/r/${ROOM.id}`); return; }
    if (ctx.body.to === 'sent' && e.status === 'draft') {
      sc.put('engagement', { ...e, status: 'sent', sentAt: on });
      ctx.setFlash(`Engagement v${e.version} recorded as sent ${on}.`);
    } else if (ctx.body.to === 'signed' && e.status === 'sent') {
      // Conflicts gate: a fee agreement cannot execute for a matter the firm
      // has not cleared. Refuse and stay put — no signing, no marker.
      if (!matterCleared(k, ctx.matter)) {
        k.audit('engagement.sign.blocked', ctx.matter.id + ':v' + e.version + ':no-conflict-clearance');
        ctx.setFlash('Cannot sign — no cleared conflict check on file for this matter. Run a clear or waiver in Ethics & Conflicts (room 02) first.', 'err');
        redirect(res, `/r/${ROOM.id}`); return;
      }
      // The signer is recorded on the engagement itself, not only on the
      // marker, so the marker stays derivable from the record it describes.
      const signed = { ...e, status: 'signed', signedAt: on, signedBy: ctx.user.name };
      sc.put('engagement', signed);
      // Wire into the money side: post a firm-scope marker Trust & Books can
      // see, so an executed fee agreement is not invisible to the ledger. No
      // funds have moved — this records the commitment/expectation, not a txn.
      const expected = expectedRetainerOf(signed);
      let marked = true;
      try {
        if (!markedVersions(k, ctx.matter.id).has(String(num(signed.version)))) {
          k.firm.put('engagementSigned', signedMarker(ctx.matter.id, signed));
        }
      } catch (_) { marked = false; } // signature stands; the GET backfill repairs the marker
      k.audit('engagement.signed', ctx.matter.id + ':v' + e.version + (expected != null ? ':expected ' + fmt(expected) : ':' + e.feeModel));
      ctx.setFlash(`Engagement v${e.version} recorded as signed ${on} — retainer in force. ${marked ? 'Fee commitment posted to Trust & Books.' : 'Fee commitment not yet posted to Trust & Books — reopen this room to retry.'}`);
    } else {
      ctx.setFlash('Invalid status transition — engagements move draft to sent to signed.', 'err');
    }
    redirect(res, `/r/${ROOM.id}`);
  });
}

module.exports = { ...ROOM, register };
