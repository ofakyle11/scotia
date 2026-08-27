// CITE-RESOLVE SEAM — kernel/cite-resolve.js wired into room 08 (Citation Check).
//
// What this suite proves, end to end over the real router (no absolute paths,
// no shortcuts): a citation the connector resolves can be verified and opens
// the gate; a citation the connector does NOT resolve is never marked verified,
// keeps the draft blocked and cannot be certified; and a connector reply that
// carries NO CASE DATA is not a match.
//
// The CanLII HTTP call is the ONE thing stubbed: kernel/canlii.js `fetchCase`
// is replaced in-process with a controllable test double so the connector reply
// is deterministic and nothing leaves the machine. Everything else — routing,
// origin check, session, encrypted store, the room's own logic, cite-resolve
// itself and the kernel facade that binds it — is the real code under test.
const fs = require('fs'), os = require('os'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/cite-');
process.env.PORT = String(34400 + Math.floor(Math.random() * 151));

const canlii = require('../kernel/canlii.js');            // patched below (test double)
const { app, makeCtx, store, audit, auth, keyring } = require('../server.js');
const { makeKernel } = require('../kernel/api.js');
const { hashPassword } = require('../kernel/crypto.js');

// --- the one test double: what CanLII's API "replies" -----------------------
let REPLY = { ok: false, message: 'stub not armed' };
canlii.fetchCase = async () => REPLY;
const REAL_CASE = { ok: true, data: { title: 'Dunsmuir v. New Brunswick', citation: '2008 SCC 9', url: 'https://www.canlii.org/en/ca/scc/doc/2008/2008scc9/2008scc9.html' } };
const EMPTY_200 = { ok: true, data: {} };                  // 200 with no case data
const EMPTY_BODY = { ok: true, data: null };               // 200, body did not parse
const MISS = { ok: false, status: 404, message: 'Not found on CanLII (id derivation may not match this cite).' };

const admin = store.firm.put('user', { email: 'v@f', name: 'V. Verifier', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const m = store.createMatter({ title: 'Cite v. Resolve', client: 'C', jurisdiction: 'on', status: 'open' }, admin.id);
store.firm.put('setting', { id: 'canlii', apiKey: 'test-key-not-a-real-key' }, admin.id);
const session = auth.createSession(admin.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;
const H = { cookie: `s=${session}; m=${m.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base };

const post = async (p, f) => { const r = await fetch(base + p, { method: 'POST', redirect: 'manual', headers: H, body: new URLSearchParams(f).toString() }); await r.text(); return r; };
const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual', headers: { cookie: H.cookie } }); return { status: r.status, loc: r.headers.get('location'), html: await r.text() }; };
const sc = () => store.matterScope(m.id);
const draftOf = (id) => sc().get('draft', id);
const instOf = (id) => sc().get('citation_instance', id);
const one = (draftId) => sc().list('citation_instance', (i) => i.draftId === draftId);

const results = [];
const check = (name, fn) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); } };

(async () => {
  // ===== PART 1 — a citation the connector CANNOT resolve ====================
  // Draft A cites a case that does not exist. CanLII answers 200 with an empty
  // body — the exact shape the audit flagged.
  await post('/r/citations/draft', { title: 'Factum A (phantom cite)', text: 'The moving party relies on 2011 ONCA 9999 at para 12.' });
  const dA = sc().list('draft', (d) => d.title === 'Factum A (phantom cite)')[0];
  assert(dA, 'setup: draft A not registered');
  await post('/r/citations/scan', { draftId: dA.id });
  const iA = one(dA.id)[0];

  check('A1 scan mints an UNVERIFIED instance and BLOCKS the draft', () => {
    assert(iA, 'extractor found no citation in draft A');
    assert.strictEqual(iA.cite, '2011 ONCA 9999', 'wrong cite extracted: ' + iA.cite);
    assert.strictEqual(iA.status, 'unverified', 'new instance status: ' + iA.status);
    assert.strictEqual(draftOf(dA.id).citeStatus, 'blocked', 'gate after scan: ' + draftOf(dA.id).citeStatus);
  });

  // Control: a connector that plainly says "no" must be recorded as no match.
  // This is the same code path as the defect check below and it works — which
  // is what isolates the defect to the EMPTY-PAYLOAD case specifically.
  REPLY = MISS;
  await post('/r/citations/resolve', { id: iA.id });
  const missPage = await get('/r/citations?draft=' + encodeURIComponent(dA.id));
  check('A2a control — an explicit connector miss is recorded as NO match', () => {
    const l = instOf(iA.id).lookup;
    assert(l, 'no lookup recorded on an explicit miss');
    assert.strictEqual(l.resolved, false, 'an explicit CanLII miss was recorded as resolved');
    assert(missPage.html.includes('connector found no match'), 'the queue does not show the miss to the verifier');
  });

  // *** THE DEFECT UNDER TEST ***
  REPLY = EMPTY_200;
  await post('/r/citations/resolve', { id: iA.id });
  check('A2 [DEFECT] a CanLII 200 carrying NO CASE DATA is NOT a match', () => {
    const l = instOf(iA.id).lookup;
    assert(l && typeof l === 'object', 'no lookup recorded on the instance');
    assert.strictEqual(l.resolved, false,
      'an empty CanLII response was recorded as a MATCH (lookup.resolved=' + l.resolved + ', title=' + JSON.stringify(l.title) + ') — a citation with no case behind it must never read as resolved');
    assert.notStrictEqual(String(l.title || ''), '2011 ONCA 9999',
      'the citation string was echoed back as the case TITLE — a phantom case name on the verifier’s screen');
  });
  const pageA = await get('/r/citations?draft=' + encodeURIComponent(dA.id));
  check('A3 [DEFECT] the queue page must not tell the verifier a match was found', () => {
    assert.strictEqual(pageA.status, 200, 'room page status ' + pageA.status);
    assert(pageA.html.includes('2011 ONCA 9999'), 'the queue did not render the citation at all');
    assert(!pageA.html.includes('connector found a match'),
      'the queue shows "connector found a match" for a citation the connector returned no case data for');
  });

  // The lookup must not have touched the gate or the status, whatever it said.
  check('A4 a lookup NEVER verifies and NEVER opens the gate', () => {
    assert.strictEqual(instOf(iA.id).status, 'unverified', 'status moved on a lookup: ' + instOf(iA.id).status);
    assert.strictEqual(instOf(iA.id).resolved, null, 'the four-point `resolved` flag was set by a machine');
    assert.strictEqual(draftOf(dA.id).citeStatus, 'blocked', 'gate moved on a lookup: ' + draftOf(dA.id).citeStatus);
  });

  // A cite that does not resolve gets failed — and the draft stays shut.
  await post('/r/citations/fail', { id: iA.id, reason: 'does not resolve — no case behind the cite' });
  const certA = await get('/r/citations/certificate?draft=' + encodeURIComponent(dA.id));
  check('A5 a failed cite is NOT verified, blocks the draft and cannot be certified', () => {
    assert.strictEqual(instOf(iA.id).status, 'failed', 'status: ' + instOf(iA.id).status);
    assert.notStrictEqual(instOf(iA.id).status, 'verified', 'a cite that does not resolve was marked verified');
    assert.strictEqual(draftOf(dA.id).citeStatus, 'blocked', 'gate: ' + draftOf(dA.id).citeStatus);
    assert.strictEqual(certA.status, 303, 'certificate was NOT refused for a blocked draft (status ' + certA.status + ')');
    assert(String(certA.loc || '').startsWith('/r/citations?draft='), 'refused certificate did not bounce back to the gate: ' + certA.loc);
  });

  // ===== PART 2 — a citation the connector DOES resolve =====================
  await post('/r/citations/draft', { title: 'Factum B (real cite)', text: 'The court applied 2008 SCC 9 at para 27.' });
  const dB = sc().list('draft', (d) => d.title === 'Factum B (real cite)')[0];
  assert(dB, 'setup: draft B not registered');
  await post('/r/citations/scan', { draftId: dB.id });
  const iB = one(dB.id)[0];
  assert(iB && iB.cite === '2008 SCC 9', 'setup: draft B cite not extracted');

  REPLY = REAL_CASE;
  await post('/r/citations/resolve', { id: iB.id });
  const pageB = await get('/r/citations?draft=' + encodeURIComponent(dB.id));
  check('B1 a real connector match is recorded as a FINDING and pre-fills the source URL', () => {
    const l = instOf(iB.id).lookup;
    assert(l, 'no lookup recorded');
    assert.strictEqual(l.resolved, true, 'a real CanLII case was not recorded as resolved');
    assert.strictEqual(l.title, 'Dunsmuir v. New Brunswick', 'title: ' + l.title);
    assert.strictEqual(l.url, REAL_CASE.data.url, 'url: ' + l.url);
    assert(pageB.html.includes('connector found a match'), 'the match is not shown on the queue');
    assert(pageB.html.includes('value="' + REAL_CASE.data.url + '"'), 'the source URL was not pre-filled into the verify form');
  });
  check('B2 even a real match leaves the citation unverified and the gate shut', () => {
    assert.strictEqual(instOf(iB.id).status, 'unverified', 'status: ' + instOf(iB.id).status);
    assert.strictEqual(draftOf(dB.id).citeStatus, 'blocked', 'gate: ' + draftOf(dB.id).citeStatus);
  });

  // Human verification is all four or nothing — "resolves" withheld.
  await post('/r/citations/verify', { id: iB.id, pinpoint: 'para 27', quoteOk: '1', treatment: '1' });
  check('B3 verification WITHOUT "resolves to a real case" is REFUSED', () => {
    const i = instOf(iB.id);
    assert.strictEqual(i.status, 'unverified', 'a citation was verified without the resolves confirmation (status ' + i.status + ')');
    assert.strictEqual(i.pinpoint, '', 'the refused attempt still wrote to the record');
    assert(!i.checkedBy, 'a refused verification recorded a verifier: ' + i.checkedBy);
    assert.strictEqual(draftOf(dB.id).citeStatus, 'blocked', 'gate: ' + draftOf(dB.id).citeStatus);
  });

  // All four confirmed by the human — the gate opens and certifies.
  await post('/r/citations/verify', { id: iB.id, pinpoint: 'para 27', resolves: '1', quoteOk: '1', treatment: '1', resolvedUrl: REAL_CASE.data.url });
  const certB = await get('/r/citations/certificate?draft=' + encodeURIComponent(dB.id));
  check('B4 all four confirmed -> verified by a NAMED human, gate clear, certificate issues', () => {
    const i = instOf(iB.id);
    assert.strictEqual(i.status, 'verified', 'status: ' + i.status);
    assert.strictEqual(i.resolved, true, 'resolved flag: ' + i.resolved);
    assert.strictEqual(i.checkedBy, 'V. Verifier', 'checkedBy: ' + i.checkedBy);
    assert.strictEqual(draftOf(dB.id).citeStatus, 'clear', 'gate did not open: ' + draftOf(dB.id).citeStatus);
    assert.strictEqual(certB.status, 200, 'certificate refused for a clear draft (status ' + certB.status + ')');
    assert(certB.html.includes('V. Verifier'), 'certificate does not name the human verifier');
    assert(certB.html.includes('2008 SCC 9'), 'certificate does not list the authority');
  });

  // ===== PART 3 — the same defect at the kernel seam ========================
  // Same assertion one layer down, so the report points at the exact module.
  const k = makeKernel({ store, audit, keyring }, { ...admin, id: admin.id });
  REPLY = EMPTY_200;
  const rEmptyObj = await k.citeResolve.resolve('2011 ONCA 9999');
  REPLY = EMPTY_BODY;
  const rEmptyBody = await k.citeResolve.resolve('2011 ONCA 9999');
  REPLY = REAL_CASE;
  const rReal = await k.citeResolve.resolve('2008 SCC 9');
  check('K1 [DEFECT] kernel/cite-resolve.js: an empty CanLII payload is not a resolution', () => {
    assert.strictEqual(rEmptyObj.resolved, false, 'resolve() returned resolved:true for {ok:true,data:{}} (title=' + JSON.stringify(rEmptyObj.title) + ')');
    assert.strictEqual(rEmptyBody.resolved, false, 'resolve() returned resolved:true for {ok:true,data:null} (title=' + JSON.stringify(rEmptyBody.title) + ')');
  });
  check('K2 kernel/cite-resolve.js: a real CanLII payload IS a resolution', () => {
    assert.strictEqual(rReal.resolved, true, 'a real case did not resolve');
    assert.strictEqual(rReal.title, 'Dunsmuir v. New Brunswick', 'title: ' + rReal.title);
    assert.strictEqual(rReal.source, 'canlii-api', 'source: ' + rReal.source);
  });

  // ===== report =============================================================
  const failed = results.filter((r) => !r.ok);
  for (const r of results) if (!r.ok) console.error('FAIL  ' + r.name + '\n      ' + r.msg);
  server.close();
  if (failed.length) {
    console.error('\nCITE-RESOLVE SEAM: ' + failed.length + ' of ' + results.length + ' checks FAILED.');
    console.error('The checks above assert CORRECT behaviour and are deliberately NOT weakened.');
    process.exit(1);
  }
  console.log('CITE-RESOLVE SEAM: ALL PASS (' + results.length + ' checks — empty connector reply is no match; lookup never verifies; verify refused without all four; four-point human verification opens the gate and certifies)');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e && e.stack || e); try { server.close(); } catch (_) {} process.exit(1); });
