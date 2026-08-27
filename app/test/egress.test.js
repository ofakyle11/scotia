'use strict';
// Matter content leaving the building, and what the record said about it.
//
// Rooms 29/30/31 each POST operator-supplied text to a third party. All three
// audited only the CONFIGURATION of their connector — who set the API key — and
// nothing at all about the requests. So a client's name could be sent to
// CourtListener or EDGAR with no entry anywhere that it ever happened, while the
// model gateway (the other egress in this product) audits every single call.
//
// The line deliberately does NOT carry the query text. The audit log is
// plaintext, survives crypto-shredding and rides in every backup — that is
// exactly why room 10 was changed to log a record id instead of a lawyer's own
// words, and copying search text into it would reintroduce the same defect
// through a different door. What the record needs is that a disclosure
// happened, to whom, on which matter, by whom, when.
//
// Also here: a CanLII 200 whose body parsed but carried no case was written into
// the firm-wide resolution cache, which has no invalidation. Every later lookup
// of that citation hit the poisoned entry and reported a resolution for a case
// nobody can name.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(os.tmpdir() + '/egress-');
process.env.PORT = String(29400 + Math.floor(Math.random() * 1000));

// Patched before server.js builds a kernel, so the facade's spread picks these
// up. Nothing here touches the network: the audit line must be written whether
// the far end answers or not.
const canlii = require('../kernel/canlii.js');
const uscourts = require('../kernel/uscourts.js');
const edgar = require('../kernel/edgar.js');
let caseReply = { ok: true, data: {} };
canlii.fetchCase = async () => caseReply;
uscourts.search = async () => ({ ok: false, status: 0, message: 'stubbed' });
edgar.search = async () => ({ ok: false, status: 0, message: 'stubbed' });

const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const u = store.firm.put('user', { email: 'u@f', name: 'U', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
const m = store.createMatter({ title: 'Egress v. Silence', client: 'C', jurisdiction: 'on', status: 'open' }, u.id);
store.firm.put('setting', { id: 'canlii', apiKey: 'test-key' }, u.id);
store.firm.put('setting', { id: 'edgar', contact: 'partners@firm.test' }, u.id);
const session = auth.createSession(u.id);
const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

// A string distinctive enough that finding it in the audit log means the query
// text was copied there, not that it collided with something else.
const SECRET_QUERY = 'Zephyrine Kastellanos adverse party';

const post = (p, form) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: `s=${session}; m=${m.id}`, 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams(form).toString(),
}).then(async (r) => { await r.text(); return r; });
const auditText = () => fs.readFileSync(path.join(process.env.CHAMBERS_DATA, 'audit.log'), 'utf8');

(async () => {
  const fails = [];

  await post('/r/uscourts/search', { q: SECRET_QUERY, type: 'o' });
  await post('/r/edgar/search', { q: SECRET_QUERY });
  await post('/r/canlii/resolve', { cite: '2011 ONCA 9999', databaseId: 'onca', caseId: '2011onca9999' });

  const log = auditText();
  for (const action of ['courtlistener.search', 'edgar.search', 'canlii.fetch']) {
    if (!log.includes(action)) fails.push(`an outbound request to ${action.split('.')[0]} left no audit entry at all`);
  }
  // The disclosure must be tied to the matter it was made on, or the record
  // cannot answer "what went out about this client".
  if (!log.includes(m.id)) fails.push('the egress audit entries do not name the matter they were made on');
  // ...and must not carry the words.
  if (log.includes(SECRET_QUERY)) fails.push('the QUERY TEXT was copied into the plaintext audit log, which survives crypto-shredding and rides in every backup');
  if (log.includes('Zephyrine')) fails.push('part of the query text reached the audit log');

  // A 200 carrying no case must not enter a cache that has no invalidation.
  if (store.firm.list('canliiCase').length) {
    fails.push('a CanLII 200 with no case in it was written to the firm-wide resolution cache — permanently, since nothing invalidates it');
  }

  // ...while a real answer still caches, or the guard has just broken the room.
  caseReply = { ok: true, data: { title: 'R. v. Realcase', citation: '2011 ONCA 1', url: 'https://example.test/1', decisionDate: '2011-01-01', docketNumber: 'C1' } };
  await post('/r/canlii/resolve', { cite: '2011 ONCA 1', databaseId: 'onca', caseId: '2011onca1' });
  const cached = store.firm.list('canliiCase');
  if (cached.length !== 1) fails.push(`a genuine CanLII resolution did not cache (${cached.length} entries) — the guard refuses everything`);
  else if (cached[0].meta.title !== 'R. v. Realcase') fails.push('the cached entry does not carry the case title');

  assert(auth.resolve(session), 'setup: the session died mid-test');
  server.close();
  if (fails.length) { console.log('EGRESS FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('EGRESS: ALL PASS (every outbound call audited to its matter, no query text in the log, a caseless 200 never reaches the cache)');
  process.exit(0);
})().catch((e) => { console.error('egress crash:', e); try { server.close(); } catch (_) {} process.exit(1); });
