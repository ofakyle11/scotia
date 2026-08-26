'use strict';
// Room 01 — Intake Desk. Inquiry in, matter file out.
// Reference implementation: this file is the pattern every room follows.
const { layout, esc, table, empty, tag, kv, input, textarea, select, date } = require('../kernel/html.js');
const { html, redirect } = require('../kernel/http.js');

const ROOM = { num: 1, id: 'intake', title: 'Intake Desk', phase: 'Intake' };

function register(app) {
  app.route('GET', `/r/${ROOM.id}`, (req, res, ctx) => {
    const k = ctx.kernel;
    const inquiries = k.firm.list('inquiry').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const open = inquiries.filter((i) => i.status === 'screening');
    const jurs = k.rules.JURISDICTIONS;
    const body = `
    <div class="grid2">
      <div class="card">
        <h2 class="sec" style="margin-top:0">New inquiry</h2>
        <form method="POST" action="/r/intake/new">
          ${input('client', 'Prospective client', { required: true })}
          ${input('adverse', 'Adverse parties (comma-separated)')}
          <div class="grid2">
            <span>${select('jurisdiction', 'Jurisdiction', jurs, 'on')}</span>
            <span>${select('claimType', 'Claim type', ['Commercial dispute', 'Personal injury', 'Employment', 'Estates', 'Real property', 'Other'])}</span>
          </div>
          ${input('discovered', 'Date claim discovered', { type: 'date', required: true })}
          ${textarea('summary', 'What happened', { placeholder: 'Facts as told. Dates matter.' })}
          <button>Open screening file</button>
        </form>
        <p class="note">Opening a screening file starts the limitation clock check immediately — duties to a prospective client attach at the first conversation.</p>
      </div>
      <div class="card">
        <h2 class="sec" style="margin-top:0">Screening</h2>
        ${open.length ? open.map((i) => screeningCard(k, i)).join('') : empty('Nothing in screening — take a new inquiry on the left.')}
      </div>
    </div>
    <h2 class="sec">Disposed inquiries</h2>
    ${table(['Client', 'Claim', 'Jurisdiction', 'Limitation', 'Outcome'],
      inquiries.filter((i) => i.status !== 'screening').map((i) => [
        esc(i.client), esc(i.claimType), esc(i.jurisdiction),
        i.limitation ? date(i.limitation) : (i.limNote ? `<span class="note">${esc(i.limNote)}</span>` : '—'),
        i.status === 'accepted' ? tag('accepted — matter opened', 'ok') : tag('declined — letter sent'),
      ])) || empty('No disposed inquiries yet — accept or decline a screening file above.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Inquiry in — matter file out', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    const k = ctx.kernel;
    const client = String(ctx.body.client || '').trim();
    if (!client) { ctx.setFlash('An inquiry needs a prospective client name.', 'err'); redirect(res, '/r/intake'); return; }
    const jur = ctx.body.jurisdiction || 'on';
    const claimType = ctx.body.claimType || 'Other';
    const discovered = String(ctx.body.discovered || '').trim();
    // Key the clock to the claim type the inquiry collected — not the first
    // rule whose id contains 'limitation'. Where the jurisdiction has no
    // limitation rule on file, the clock is recorded as unknown, not silently
    // null-but-screened, so counsel knows to diary it by hand.
    const limRule = limitationRuleFor(k, jur, claimType);
    let limitation = null, limNote = null;
    if (!limRule) {
      limNote = NO_RULE;
    } else if (discovered) {
      try { limitation = k.rules.compute(limRule, discovered); }
      catch (e) { limitation = null; } // garbage date — leave clock unset, no 500
    }
    k.firm.put('inquiry', {
      client, adverse: (ctx.body.adverse || '').split(',').map((s) => s.trim()).filter(Boolean),
      jurisdiction: jur, claimType, discovered,
      summary: ctx.body.summary, limitation, limRuleId: limRule ? limRule.id : null,
      limCite: limRule ? limRule.cite : null, limNote, status: 'screening',
    });
    ctx.setFlash('Screening file opened — ' + (limitation
      ? `limitation runs ${limitation} (${limRule.cite}).`
      : limRule
        ? `enter the discovery date to run the ${limRule.cite} clock.`
        : `${NO_RULE} (${jur} / ${claimType}).`));
    redirect(res, '/r/intake');
  });

  app.route('POST', `/r/${ROOM.id}/decide`, (req, res, ctx) => {
    const k = ctx.kernel;
    const inq = k.firm.get('inquiry', ctx.body.id);
    if (!inq) { redirect(res, '/r/intake'); return; }
    if (ctx.body.decision === 'accept') {
      // Conflicts gate: no matter opens for a prospective client the firm has
      // not cleared. A clear or waiver conflictRun for this inquiry is the key;
      // without it we refuse and stay on intake.
      if (!inquiryCleared(k, inq)) {
        k.audit('intake.accept.blocked', inq.id + ':no-conflict-clearance');
        ctx.setFlash(`Cannot open a matter for ${inq.client} — no cleared conflict check on file for this inquiry. Run a clear or waiver in Ethics & Conflicts (room 02) first.`, 'err');
        redirect(res, '/r/intake'); return;
      }
      const m = k.firm.put('matter', {
        title: `${inq.client} — ${inq.claimType}`, client: inq.client, adverse: inq.adverse,
        jurisdiction: inq.jurisdiction, status: 'open', theory: '', posture: 'pre-filing',
      });
      k.firm.put('inquiry', { ...inq, status: 'accepted', matterId: m.id });
      if (inq.limitation) {
        k.scope(m.id).put('deadline', {
          desc: 'Limitation period expires', due: inq.limitation, rule: inq.limCite || 'limitation',
          trigger: 'Claim discovered ' + inq.discovered, status: 'open',
        });
      }
      k.audit('intake.accept', inq.id + ' -> ' + m.id);
      ctx.setFlash(`Matter opened: ${m.title}. Its encryption key was minted on creation.`);
    } else {
      k.firm.put('inquiry', { ...inq, status: 'declined' });
      k.firm.put('letter', {
        kind: 'non-engagement', to: inq.client,
        text: `Dear ${inq.client}: Thank you for consulting us. We are unable to act for you in this matter. This letter is not legal advice; limitation periods may apply to your claim and you should consult other counsel promptly.`,
      });
      ctx.setFlash('Declined — non-engagement letter generated (the letter nobody remembers to send).');
    }
    redirect(res, '/r/intake');
  });
}

const NO_RULE = 'none — no rule on file, counsel to diary manually';

// A rule is a limitation/prescription rule when it says so (category, per the
// shared rules contract) or, for the reference tranche that pre-dates that
// field, by its id. Kept distinct from procedural deadlines.
function isLimitationRule(r) {
  return !!r && (r.category === 'limitation' || /limitation|prescription/.test(r.id));
}

// Choose the limitation rule for the claim type the inquiry collected. NY
// splits by claim type (PI 3yr CPLR 214(5); contract/residual 6yr CPLR 213);
// ON/BC/AB carry one basic limitation; QC one prescription. Returns null when
// the jurisdiction has no limitation rule on file (e.g. us-fed, ca-fed).
function limitationRuleFor(k, jur, claimType) {
  const rules = k.rules.rulesFor(jur).filter(isLimitationRule);
  if (!rules.length) return null;
  const byId = (id) => rules.find((r) => r.id === id);
  const ct = String(claimType || '').toLowerCase();
  if (jur === 'ny') {
    if (/injur|personal/.test(ct)) return byId('ny-limitation-pi') || rules[0];
    return byId('ny-limitation-contract') || rules[0];
  }
  return rules[0];
}

// Has a conflict check cleared THIS inquiry's prospective client? Per the
// shared conflictRun contract a run may carry inquiryId / parties; room 02's
// runs are keyed by the name checked. Any of those, outcome clear or waiver,
// on the client, opens the gate.
function inquiryCleared(k, inq) {
  if (!inq) return false;
  const client = String(inq.client || '').trim().toLowerCase();
  if (!client) return false;
  return k.firm.list('conflictRun').some((r) => {
    if (!r || (r.outcome !== 'clear' && r.outcome !== 'waiver')) return false;
    if (r.inquiryId && r.inquiryId === inq.id) return true;
    if (Array.isArray(r.parties) && r.parties.some((p) => String(p).trim().toLowerCase() === client)) return true;
    if (r.name && String(r.name).trim().toLowerCase() === client) return true;
    return false;
  });
}

function screeningCard(k, i) {
  const soon = i.limitation && (new Date(i.limitation) - Date.now()) < 90 * 24 * 3600 * 1000;
  return `<div style="border:1px solid var(--rule);padding:12px 14px;margin-bottom:10px;background:var(--ground)">
    <b>${esc(i.client)}</b> · ${esc(i.claimType)} · ${esc(i.jurisdiction)}
    ${kv([
      ['Adverse', esc((i.adverse || []).join(', ') || '—')],
      ['Discovered', date(i.discovered)],
      ['Limitation', i.limitation
        ? `${date(i.limitation)} ${soon ? tag('under 90 days', 'gate') : ''} <span class="note">${esc(i.limCite || '')}</span>`
        : (i.limNote ? `${tag('no rule', 'gate')} <span class="note">${esc(i.limNote)}</span>` : '—')],
      ['Summary', esc(i.summary || '')],
    ])}
    <form method="POST" action="/r/intake/decide" style="display:inline"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="decision" value="accept"><button>Accept — open matter</button></form>
    <form method="POST" action="/r/intake/decide" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="decision" value="decline"><button class="danger">Decline</button></form>
  </div>`;
}

module.exports = { ...ROOM, register };
