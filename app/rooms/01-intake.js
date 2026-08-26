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
        date(i.limitation), i.status === 'accepted' ? tag('accepted — matter opened', 'ok') : tag('declined — letter sent'),
      ])) || empty('No disposed inquiries yet — accept or decline a screening file above.')}
    `;
    html(res, layout({ ...ctx, room: ROOM.id }, { title: ROOM.title, sub: 'Inquiry in — matter file out', body }));
  });

  app.route('POST', `/r/${ROOM.id}/new`, (req, res, ctx) => {
    const k = ctx.kernel;
    const jur = ctx.body.jurisdiction || 'on';
    const limRule = k.rules.rulesFor(jur).find((r) => r.id.includes('limitation'));
    const limitation = limRule && ctx.body.discovered ? k.rules.compute(limRule, ctx.body.discovered) : null;
    k.firm.put('inquiry', {
      client: ctx.body.client, adverse: (ctx.body.adverse || '').split(',').map((s) => s.trim()).filter(Boolean),
      jurisdiction: jur, claimType: ctx.body.claimType, discovered: ctx.body.discovered,
      summary: ctx.body.summary, limitation, limCite: limRule ? limRule.cite : null, status: 'screening',
    });
    ctx.setFlash('Screening file opened' + (limitation ? ` — limitation runs ${limitation} (${limRule.cite}).` : '.'));
    redirect(res, '/r/intake');
  });

  app.route('POST', `/r/${ROOM.id}/decide`, (req, res, ctx) => {
    const k = ctx.kernel;
    const inq = k.firm.get('inquiry', ctx.body.id);
    if (!inq) { redirect(res, '/r/intake'); return; }
    if (ctx.body.decision === 'accept') {
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

function screeningCard(k, i) {
  const soon = i.limitation && (new Date(i.limitation) - Date.now()) < 90 * 24 * 3600 * 1000;
  return `<div style="border:1px solid var(--rule);padding:12px 14px;margin-bottom:10px;background:var(--ground)">
    <b>${esc(i.client)}</b> · ${esc(i.claimType)} · ${esc(i.jurisdiction)}
    ${kv([
      ['Adverse', esc((i.adverse || []).join(', ') || '—')],
      ['Discovered', date(i.discovered)],
      ['Limitation', i.limitation ? `${date(i.limitation)} ${soon ? tag('under 90 days', 'gate') : ''} <span class="note">${esc(i.limCite || '')}</span>` : '—'],
      ['Summary', esc(i.summary || '')],
    ])}
    <form method="POST" action="/r/intake/decide" style="display:inline"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="decision" value="accept"><button>Accept — open matter</button></form>
    <form method="POST" action="/r/intake/decide" style="display:inline;margin-left:8px"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="decision" value="decline"><button class="danger">Decline</button></form>
  </div>`;
}

module.exports = { ...ROOM, register };
