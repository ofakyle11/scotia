'use strict';
// PORTAL — room 36 (Client Portal) + the room 05 update it carries.
//
// This is the only surface in Chambers whose output is meant to LEAVE the firm.
// Three things have to hold or it is a confidentiality (LSO r. 3.3-1) failure,
// not a cosmetic one:
//
//   1. RECORD. An update sent to the client, and the pack that carries it, are
//      recorded with WHO sent/prepared it and WHEN — in the stored record and in
//      the hash-chained audit log. "We told them in August" has to be provable.
//   2. ONE MATTER ONLY. A pack assembled for matter A must never carry matter
//      B's update, B's open decision, B's deadlines or B's trust balance, and a
//      pack id from B must not render while A is the open matter.
//   3. WALLED / DESTROYED. A matter the viewer is screened off, and a matter
//      crypto-shredded under its retention schedule, are not reachable through
//      the portal at all — not the preview, not a recorded pack, not a download.
//
// Every check drives the real router over HTTP the way a browser does (session
// cookie, matter cookie, Origin on POSTs) and then asserts on what actually
// changed — the stored record, the audit entry, the bytes of the rendered page.
// Deliberately, the suite also asserts the POSITIVE case on every leak check
// (matter A's own content IS in A's pack; the unscreened lawyer CAN read the
// walled matter's pack) so a globally broken room cannot pass by rendering
// nothing at all.
const fs = require('fs'), os = require('os'), path = require('path');

process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'));
process.env.PORT = String(34600 + Math.floor(Math.random() * 150));

const { app, makeCtx, store, audit, keyring, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');
const { makeKernel } = require('../kernel/api.js');

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const eq = (got, want, msg) => check(got === want, `${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ---------------------------------------------------------------- fixtures --
const pw = hashPassword('a-long-password-here');
const dan = store.firm.put('user', { email: 'dan@f', name: 'Dan G', role: 'admin', active: true, pw }, 't');
const matt = store.firm.put('user', { email: 'matt@f', name: 'Matt D', role: 'admin', active: true, pw }, 't');

// Four matters. Created in this order, so the newest non-walled matter (DELTA)
// is what makeCtx falls back to when a requested matter is refused.
const ALPHA = store.createMatter({ title: 'Alpha v. Northbridge Freight', client: 'A. Alpha', jurisdiction: 'on', status: 'open' }, dan.id);
const BETA = store.createMatter({ title: 'Beta v. Southgate Mills', client: 'B. Beta', jurisdiction: 'on', status: 'open' }, dan.id);
const WALLED = store.createMatter({ title: 'Corbin v. Halton Steel', client: 'K. Corbin', jurisdiction: 'on', status: 'open' }, matt.id);
const DELTA = store.createMatter({ title: 'Delta v. Eastway Haulage', client: 'D. Delta', jurisdiction: 'on', status: 'open' }, dan.id);

// Dan is screened off the Corbin file — he acted for Halton Steel at his old firm.
store.firm.put('wall', { matterId: WALLED.id, screened: [dan.id], basis: 'prior retainer for Halton Steel' }, matt.id);

// Distinctive, ASCII-only strings so a leak is unambiguous in the page bytes.
const A_UPDATE = 'ALPHA-TEXT: Northbridge served its statement of defence on 12 August and we have 20 days to reply.';
const B_UPDATE = 'BETA-SECRET: Southgate has offered 240000 to settle before discovery.';
const B_QUESTION = 'BETA-SECRET: do we accept the Southgate offer of 240000?';
const B_DEADLINE = 'BETA-SECRET affidavit of documents due';
const W_UPDATE = 'WALL-SECRET: Corbin instructs us to sue Halton Steel for the crane failure.';
const D_UPDATE = 'DELTA-SECRET: Eastway agreed to pay 91000 on consent.';

// Deadlines are diarised by other rooms; seeded straight into the matter log the
// way test/seam.test.js does, since the portal only READS them.
store.matterScope(ALPHA.id).put('deadline', { desc: 'ALPHA-TEXT reply to defence', due: '2026-09-10', rule: 'r. 25.04(1)', status: 'open' }, dan.id);
store.matterScope(BETA.id).put('deadline', { desc: B_DEADLINE, due: '2026-09-02', rule: 'r. 30.03', status: 'open' }, dan.id);

// Real money on two files, so a cross-matter figure would be visible as one.
const kDan = makeKernel({ store, audit, keyring }, dan);
kDan.ledger.post(ALPHA.id, { memo: 'Retainer', kind: 'trust-receipt', lines: [{ account: 'trust:bank', dr: 5000 }, { account: 'trust:client', cr: 5000 }] });
kDan.ledger.post(BETA.id, { memo: 'Retainer', kind: 'trust-receipt', lines: [{ account: 'trust:bank', dr: 77777 }, { account: 'trust:client', cr: 77777 }] });

const danS = auth.createSession(dan.id);
const mattS = auth.createSession(matt.id);

// Handler errors are collected, never rethrown: a rethrow inside the router's
// catch block would stop it answering 410 for a destroyed matter, which is one
// of the behaviours under test.
const serverErrors = [];
const server = app.listen(process.env.PORT, makeCtx, (e) => serverErrors.push(e));
const base = 'http://localhost:' + process.env.PORT;

const headers = (sess, mid) => ({ cookie: `s=${sess}` + (mid ? `; m=${mid}` : '') });
async function GET(p, sess, mid) {
  const r = await fetch(base + p, { headers: headers(sess, mid), redirect: 'manual' });
  return { status: r.status, body: await r.text(), headers: r.headers };
}
async function POST(p, sess, mid, fields) {
  const r = await fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: { ...headers(sess, mid), 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: r.status, body: await r.text(), headers: r.headers };
}
const auditHas = (action, actor, object) => audit.tail(2000).some((e) => e.action === action && e.actor === actor && e.object === object);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

(async () => {
  // ======================================================================
  // 1. THE UPDATE IS RECORDED WITH WHO SENT IT AND WHEN
  // ======================================================================
  const sent = await POST('/r/client/update', danS, ALPHA.id, { text: A_UPDATE, sentOn: '2026-08-20', sentBy: 'Dan G' });
  eq(sent.status, 303, 'recording a client update should redirect (303) back to the Client Desk');

  const aUpdates = store.matterScope(ALPHA.id).list('clientUpdate');
  eq(aUpdates.length, 1, 'exactly one clientUpdate should be stored on the Alpha matter');
  const u = aUpdates[0] || {};
  eq(u.text, A_UPDATE, 'the stored update text must be what was sent to the client');
  eq(u.sentOn, '2026-08-20', 'WHEN: the stored update must carry the date it went out');
  eq(u.sentBy, 'Dan G', 'WHO: the stored update must carry who sent it');
  eq(u.createdBy, dan.id, 'WHO: the store must attribute the update to the signed-in user id');
  check(ISO.test(String(u.createdAt || '')), `WHEN: the update must carry an ISO createdAt stamp (got ${JSON.stringify(u.createdAt)})`);

  const desk = await GET('/r/client', danS, ALPHA.id);
  eq(desk.status, 200, 'the Client Desk should render for the open matter');
  check(desk.body.includes(A_UPDATE), 'the Client Desk must render the update it recorded');
  check(desk.body.includes('2026-08-20'), 'the Client Desk must show the date the update went out');
  check(desk.body.includes('Dan G'), 'the Client Desk must show who sent the update');

  // ======================================================================
  // 2. THE PACK RECORDS WHO PREPARED IT AND WHEN, AND CARRIES THAT UPDATE
  // ======================================================================
  await POST('/r/client/budget', danS, ALPHA.id, { budget: '20000' });
  const gen = await POST('/r/portal/generate', danS, ALPHA.id, {});
  eq(gen.status, 303, 'generating a client pack should redirect (303) back to the portal');

  const aPacks = store.matterScope(ALPHA.id).list('clientPack');
  eq(aPacks.length, 1, 'generating should record exactly one clientPack on the Alpha matter');
  const packA = aPacks[0] || {};
  eq(packA.preparedBy, 'Dan G', 'WHO: the recorded pack must name the lawyer who prepared it');
  eq(packA.createdBy, dan.id, 'WHO: the recorded pack must be attributed to the signed-in user id');
  check(ISO.test(String(packA.createdAt || '')), `WHEN: the recorded pack must carry an ISO createdAt stamp (got ${JSON.stringify(packA.createdAt)})`);
  eq((packA.status || {}).text, A_UPDATE, 'the pack must freeze the update that was sent to the client');
  eq((packA.status || {}).sentOn, '2026-08-20', 'the pack must freeze the date that update went out');
  eq((packA.budget || {}).trustHeld, 5000, "the pack must report THIS matter's trust balance");
  eq((packA.budget || {}).figure, 20000, 'the pack must report the budget figure set on this matter');

  check(auditHas('portal.pack.generated', dan.id, ALPHA.id + ':' + packA.id),
    'the audit chain must record WHO generated the pack, for WHICH matter — no portal.pack.generated entry found for Dan on Alpha');

  const viewA = await GET('/r/portal/pack/' + packA.id, danS, ALPHA.id);
  eq(viewA.status, 200, 'a recorded pack must render for the matter it belongs to');
  check(viewA.body.includes(A_UPDATE), 'the client-facing pack must carry the update text');
  check(viewA.body.includes('by Dan G'), 'the client-facing pack must name who prepared it');
  check(viewA.body.includes(String(packA.createdAt).slice(0, 10)), 'the client-facing pack must be dated with the day it was prepared');
  check(viewA.body.includes('$5,000.00'), "the client-facing pack must show this matter's trust balance");

  const dl = await POST('/r/portal/download', danS, ALPHA.id, { id: packA.id });
  eq(dl.status, 200, 'downloading a recorded pack should return the document');
  check(/attachment; *filename=/.test(String(dl.headers.get('content-disposition') || '')),
    'the download must be delivered as a file attachment');
  check(dl.body.includes(A_UPDATE), 'the downloaded pack must carry the update text');
  check(auditHas('portal.pack.delivered', dan.id, ALPHA.id + ':' + packA.id),
    'the audit chain must record WHO delivered the pack and for which matter');

  // ======================================================================
  // 3. THE PORTAL NEVER EXPOSES ANOTHER MATTER'S CONTENT
  // ======================================================================
  await POST('/r/client/update', danS, BETA.id, { text: B_UPDATE, sentOn: '2026-08-18', sentBy: 'Dan G' });
  await POST('/r/portal/decision', danS, BETA.id, { question: B_QUESTION, options: 'Accept\nRefuse' });
  await POST('/r/portal/generate', danS, BETA.id, {});
  const packB = store.matterScope(BETA.id).list('clientPack')[0] || {};
  check(!!packB.id, 'setup: a pack should have been recorded on the Beta matter');

  // The Alpha portal page renders real Alpha data (so this is not an empty
  // state passing by default) and no Beta content whatsoever. Matter TITLES are
  // legitimately in the shell's matter picker for a lawyer who acts on both, so
  // the leak checks are on content, not on the title.
  const portalA = await GET('/r/portal', danS, ALPHA.id);
  eq(portalA.status, 200, 'the portal should render for the open matter');
  check(portalA.body.includes(A_UPDATE), 'the portal preview must render the open matter’s own update');
  check(portalA.body.includes('$5,000.00'), 'the portal preview must render the open matter’s own trust balance');
  check(portalA.body.includes('ALPHA-TEXT reply to defence'), 'the portal preview must render the open matter’s own key dates');
  for (const [needle, what] of [[B_UPDATE, 'update'], [B_QUESTION, 'open decision request'], [B_DEADLINE, 'key date'], ['77,777', 'trust balance']]) {
    check(!portalA.body.includes(needle), `CONFIDENTIALITY: the Alpha portal page leaked the Beta matter’s ${what}`);
  }
  for (const [needle, what] of [[B_UPDATE, 'update'], [B_QUESTION, 'open decision'], [B_DEADLINE, 'key date'], ['77,777', 'trust balance']]) {
    check(!viewA.body.includes(needle), `CONFIDENTIALITY: the client-facing Alpha pack carried the Beta matter’s ${what}`);
  }

  // A pack id from another matter must not render while Alpha is open.
  const crossView = await GET('/r/portal/pack/' + packB.id, danS, ALPHA.id);
  check(!crossView.body.includes(B_UPDATE),
    `CONFIDENTIALITY: /r/portal/pack/<beta id> rendered the Beta matter’s update while Alpha was the open matter (status ${crossView.status})`);
  check(crossView.status !== 200, `CONFIDENTIALITY: a pack from another matter answered 200 instead of being refused (status ${crossView.status})`);
  const crossDl = await POST('/r/portal/download', danS, ALPHA.id, { id: packB.id });
  check(!crossDl.body.includes(B_UPDATE),
    `CONFIDENTIALITY: /r/portal/download delivered the Beta matter’s pack while Alpha was the open matter (status ${crossDl.status})`);

  // ======================================================================
  // 4. A WALLED MATTER IS NOT REACHABLE THROUGH THE PORTAL
  // ======================================================================
  await POST('/r/client/update', mattS, WALLED.id, { text: W_UPDATE, sentOn: '2026-08-15', sentBy: 'Matt D' });
  await POST('/r/portal/generate', mattS, WALLED.id, {});
  const packW = store.matterScope(WALLED.id).list('clientPack')[0] || {};
  check(!!packW.id, 'setup: a pack should have been recorded on the walled matter');

  // Matt is NOT screened: the room must work fully for him. This is the control
  // that stops section 4 passing merely because the portal is broken for everyone.
  const mattView = await GET('/r/portal/pack/' + packW.id, mattS, WALLED.id);
  eq(mattView.status, 200, 'the unscreened lawyer must still be able to open the walled matter’s pack');
  check(mattView.body.includes(W_UPDATE), 'the unscreened lawyer must still see the walled matter’s pack content');

  // Dan is screened: nothing about that matter may reach him here — not the
  // content, and not even the title (a wall means he must not learn the firm acts).
  const danWalledPortal = await GET('/r/portal', danS, WALLED.id);
  check(!danWalledPortal.body.includes(W_UPDATE), 'ETHICAL WALL: the portal leaked the walled matter’s update to the screened lawyer');
  check(!danWalledPortal.body.includes('Corbin v. Halton Steel'), 'ETHICAL WALL: the portal leaked the walled matter’s title to the screened lawyer');
  check(!danWalledPortal.body.includes('K. Corbin'), 'ETHICAL WALL: the portal leaked the walled matter’s client to the screened lawyer');

  for (const mid of [WALLED.id, ALPHA.id]) {
    const r = await GET('/r/portal/pack/' + packW.id, danS, mid);
    check(!r.body.includes(W_UPDATE), `ETHICAL WALL: /r/portal/pack/<walled id> rendered the walled pack to the screened lawyer (m=${mid === ALPHA.id ? 'alpha' : 'walled'}, status ${r.status})`);
    check(r.status !== 200, `ETHICAL WALL: the walled matter’s pack answered 200 to the screened lawyer (m=${mid === ALPHA.id ? 'alpha' : 'walled'})`);
    const d = await POST('/r/portal/download', danS, mid, { id: packW.id });
    check(!d.body.includes(W_UPDATE), `ETHICAL WALL: /r/portal/download delivered the walled pack to the screened lawyer (m=${mid === ALPHA.id ? 'alpha' : 'walled'}, status ${d.status})`);
  }

  // ======================================================================
  // 5. A DESTROYED MATTER IS NOT REACHABLE THROUGH THE PORTAL
  // ======================================================================
  await POST('/r/client/update', danS, DELTA.id, { text: D_UPDATE, sentOn: '2026-08-19', sentBy: 'Dan G' });
  await POST('/r/portal/generate', danS, DELTA.id, {});
  const packD = store.matterScope(DELTA.id).list('clientPack')[0] || {};
  check(!!packD.id, 'setup: a pack should have been recorded on the Delta matter');
  const beforeShred = await GET('/r/portal/pack/' + packD.id, danS, DELTA.id);
  eq(beforeShred.status, 200, 'baseline: the Delta pack must be readable BEFORE destruction');
  check(beforeShred.body.includes(D_UPDATE), 'baseline: the Delta pack must carry its update before destruction');

  // Destroy it the way rooms/26-closing.js does — k.shred() on an admin kernel.
  kDan.shred(DELTA.id);
  eq(keyring.isShredded(DELTA.id), true, 'setup: the Delta matter key should be destroyed');

  const afterPortal = await GET('/r/portal', danS, DELTA.id);
  check(!afterPortal.body.includes(D_UPDATE), `DESTROYED: the portal still rendered a destroyed matter’s update (status ${afterPortal.status})`);
  eq(afterPortal.status, 410, 'a destroyed matter should answer 410 Gone at the portal, not render');

  const afterView = await GET('/r/portal/pack/' + packD.id, danS, DELTA.id);
  check(!afterView.body.includes(D_UPDATE), `DESTROYED: a recorded pack still rendered a destroyed matter’s update (status ${afterView.status})`);
  check(afterView.status !== 200, `DESTROYED: a destroyed matter’s pack answered 200 (status ${afterView.status})`);

  const afterDl = await POST('/r/portal/download', danS, DELTA.id, { id: packD.id });
  check(!afterDl.body.includes(D_UPDATE), `DESTROYED: /r/portal/download delivered a destroyed matter’s pack (status ${afterDl.status})`);
  check(!auditHas('portal.pack.delivered', dan.id, DELTA.id + ':' + packD.id),
    'DESTROYED: a delivery of the destroyed matter’s pack was recorded as having happened');

  const afterGen = await POST('/r/portal/generate', danS, DELTA.id, {});
  check(afterGen.status !== 303, `DESTROYED: generating a new pack on a destroyed matter was accepted (status ${afterGen.status})`);
  let deltaStillReadable = true;
  try { store.matterScope(DELTA.id); } catch (e) { deltaStillReadable = e.code !== 'SHREDDED'; }
  check(!deltaStillReadable, 'DESTROYED: the destroyed matter’s log is still decryptable');

  // The chain that carries all of the above attribution must itself be intact.
  const chain = audit.verify();
  check(chain.ok === true, `the audit chain carrying all of this attribution must verify (${chain.reason || 'no reason given'})`);
  check(chain.entries > 0, 'the audit chain must actually contain entries');

  // Nothing should have blown up except the deliberate shredded-matter reads.
  const unexpected = serverErrors.filter((e) => e && e.code !== 'SHREDDED');
  check(unexpected.length === 0, 'the router raised unexpected errors: ' + unexpected.map((e) => e.message).join('; '));

  server.close();
  if (fails.length) {
    console.error('PORTAL FAIL:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('PORTAL: ALL PASS (update recorded with sender+date, pack attributes who/when in store and audit chain, no cross-matter content, walled and destroyed matters unreachable)');
  process.exit(0);
})().catch((e) => {
  console.error('PORTAL ERROR:', e && e.stack ? e.stack : e);
  try { server.close(); } catch (_) { /* already closed */ }
  process.exit(1);
});
