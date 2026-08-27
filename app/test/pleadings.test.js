'use strict';
// ============================================================================
// PLEADINGS — the pleading itself, not the citation seam.
//
// test/pleadcite.test.js already proves a pleading can reach the citation gate.
// It proves nothing about the thing room 10 exists for: whether a cause of
// action actually carries its elements, whether each element is anchored to a
// real fact in THIS matter, and whether an affirmative defence's pleaded/not
// state is the one that reaches the register counsel signs off on.
//
// Those are the malpractice edges:
//   * an element with no fact behind it is what a motion to strike goes after;
//   * an element that LOOKS supported by a stale mapping is worse — counsel
//     relies on support that was never re-checked;
//   * an element anchored to a fact from ANOTHER matter is both a privilege
//     breach and a pleading with no admissible foundation;
//   * an affirmative defence not pleaded is WAIVED (r. 25.07(4)) — if the
//     register says PLEADED when the record says otherwise, the defence is
//     gone at trial and nobody found out until then.
//
// So this suite drives the real router as a browser does and asserts on what
// changed: the stored `cause`/`affdefence` records, the row-level pairing on
// the rendered page, and the exported pleadings register (the artifact that
// goes on the file). Every count asserted is a DERIVED value, so a room that
// silently rendered its empty state could not pass.
// ============================================================================
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.CHAMBERS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pleadings-'));
process.env.PORT = String(34000 + Math.floor(Math.random() * 151));

const { app, makeCtx, store, auth } = require('../server.js');
const { hashPassword } = require('../kernel/crypto.js');

const admin = store.firm.put('user', { email: 'plead@f', name: 'Plead', role: 'admin', active: true, pw: hashPassword('a-long-password-here') }, 't');
// The matter under test, and a SECOND matter whose facts must never be
// reachable from the first one's pleading.
const m = store.createMatter({ title: 'Beaumont v. Ridgeline', client: 'A. Beaumont', jurisdiction: 'on', status: 'open' }, admin.id);
const other = store.createMatter({ title: 'Unrelated File', client: 'Someone Else', jurisdiction: 'on', status: 'open' }, admin.id);
const session = auth.createSession(admin.id);

const server = app.listen(process.env.PORT, makeCtx, (e) => { throw e; });
const base = 'http://localhost:' + process.env.PORT;

const headers = (matterId) => ({ cookie: `s=${session}; m=${matterId}`, 'content-type': 'application/x-www-form-urlencoded', origin: base });
async function post(p, form, matterId = m.id) {
  const r = await fetch(base + p, { method: 'POST', redirect: 'manual', headers: headers(matterId), body: new URLSearchParams(form).toString() });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}
const page = async (matterId = m.id) => (await fetch(base + '/r/pleadings', { headers: { cookie: `s=${session}; m=${matterId}` } })).text();
const sc = (id = m.id) => store.matterScope(id);
const causes = () => sc().list('cause');
const claimCause = () => causes().find((c) => c.side === 'claim');
const defences = () => sc().list('affdefence');
const count = (hay, needle) => hay.split(needle).length - 1;

// The four facts that will carry the four elements of negligence, plus their pins.
const FACTS = [
  { date: '2024-01-05', factActor: 'Ridgeline Logistics Inc.', text: 'Ridgeline undertook to inspect the trailer coupling before each dispatch.', source: 'Ex. 1 p.3' },
  { date: '2024-02-11', factActor: 'Ridgeline Logistics Inc.', text: 'The coupling was dispatched with no pre-trip inspection recorded.', source: 'Ex. 4 p.12' },
  { date: '2024-02-11', factActor: 'Unattributed', text: 'The trailer separated on Highway 401 and struck the Beaumont vehicle.', source: 'Collision report 2024-0219' },
  { date: '2024-03-02', factActor: 'A. Beaumont', text: 'Beaumont sustained a fractured vertebra and lost fourteen months of work.', source: 'Osei medical report p.2' },
];
const EL_KEYS = ['duty', 'breach', 'causation', 'damage'];
const EL_LABELS = ['Duty of care', 'Breach of the standard of care', 'Causation — in fact and in law', 'Damage'];

const fails = [];
const check = (name, fn) => { try { fn(); } catch (e) { fails.push(name + ': ' + e.message); } };

(async () => {
  // ---- Sourced facts, entered through the chronology's own source-or-drop gate.
  for (const f of FACTS) await post('/r/chronology/add', f);
  const factIds = sc().list('fact')
    .slice().sort((a, b) => FACTS.findIndex((x) => x.source === a.source) - FACTS.findIndex((x) => x.source === b.source))
    .map((f) => f.id);
  assert.strictEqual(factIds.length, 4, 'setup: the four chronology facts did not enter');

  // A fact in the OTHER matter — the one an element must never be able to reach.
  await post('/r/chronology/add', { date: '2024-05-05', factActor: 'X', text: 'A fact belonging to a different client entirely.', source: 'Sealed exhibit B-1' }, other.id);
  const foreignFactId = sc(other.id).list('fact')[0].id;
  assert(foreignFactId, 'setup: foreign matter fact did not enter');

  // ======================================================================
  // 1. A CAUSE OF ACTION CARRIES ITS ELEMENTS.
  // ======================================================================
  await post('/r/pleadings/cause', { side: 'claim', set: 'on-negligence' });
  check('cause: reference set stored', () => {
    const c = claimCause();
    assert(c, 'no cause of action was stored');
    assert.strictEqual(c.setId, 'on-negligence');
    assert.strictEqual(c.label, 'Negligence (Ontario)');
    assert.strictEqual(c.jur, 'ON');
    assert.match(c.ref, /Mustapha v\. Culligan/, 'the cause lost the authority for its test');
    assert.deepStrictEqual(c.elements.map((e) => e.key), EL_KEYS, 'the four elements of negligence did not come with the cause');
    assert.deepStrictEqual(c.elements.map((e) => e.label), EL_LABELS);
    assert.deepStrictEqual(c.mapping, {}, 'a freshly added cause must start with nothing supported');
  });

  const p1 = await page();
  check('cause: unsupported elements are reported as gaps', () => {
    assert(p1.includes('Negligence (Ontario)'), 'the cause does not render');
    assert(p1.includes('<span class="tag gate">4 gaps</span>'), 'four unsupported elements did not raise four gaps');
    assert(p1.includes('<span class="tag gate">0/4 elements supported</span>'), 'coverage tag does not read 0/4');
    assert.strictEqual(count(p1, '<span class="tag gate">no factual support yet</span>'), 4, 'every element should read "no factual support yet"');
    for (const l of EL_LABELS) assert(p1.includes(l), 'element missing from the coverage matrix: ' + l);
  });

  // Duplicate reference cause on the same (side, against) is refused.
  await post('/r/pleadings/cause', { side: 'claim', set: 'on-negligence' });
  check('cause: duplicate refused', () => assert.strictEqual(causes().length, 1, 'the same cause of action was pleaded twice'));

  // ======================================================================
  // 2. GATE — an element may rest only on a real fact IN THIS MATTER.
  // ======================================================================
  await post('/r/pleadings/link', { cause: claimCause().id, element: 'duty', fact: 'no-such-fact-id' });
  check('gate: invented fact id refused', () => assert.deepStrictEqual(claimCause().mapping, {}, 'an element was anchored to a fact that does not exist'));

  await post('/r/pleadings/link', { cause: claimCause().id, element: 'duty', fact: foreignFactId });
  check('gate: cross-matter fact refused', () => assert.deepStrictEqual(claimCause().mapping, {},
    'an element was anchored to a fact belonging to ANOTHER MATTER — privilege breach and an unfounded pleading'));

  await post('/r/pleadings/link', { cause: claimCause().id, element: 'not-an-element', fact: factIds[0] });
  check('gate: unknown element refused', () => assert.deepStrictEqual(claimCause().mapping, {}, 'a fact was mapped to an element the cause does not have'));

  // ======================================================================
  // 3. THE MAPPING: allegations to the elements (and so the causes) they support.
  // ======================================================================
  for (let i = 0; i < 4; i++) await post('/r/pleadings/link', { cause: claimCause().id, element: EL_KEYS[i], fact: factIds[i] });
  check('mapping: every element carries exactly its own fact', () => {
    const mp = claimCause().mapping;
    assert.deepStrictEqual(Object.keys(mp).sort(), EL_KEYS.slice().sort(), 'mapping keys are not the element keys');
    for (let i = 0; i < 4; i++) assert.deepStrictEqual(mp[EL_KEYS[i]], [factIds[i]], `element ${EL_KEYS[i]} is not mapped to its own fact`);
  });

  const p2 = await page();
  check('mapping: page pairs each element with ITS fact, row by row', () => {
    assert(p2.includes('<span class="tag ok">all 4 elements supported</span>'), 'the cause does not read fully supported');
    assert(p2.includes('<span class="tag ok">nothing outstanding</span>'), 'the gap queue did not clear');
    assert.strictEqual(count(p2, '<span class="tag ok">supported — 1 fact</span>'), 4, 'four elements should each read supported by one fact');
    // Row-level pairing: each element's pin must fall inside that element's own
    // table row, not merely somewhere on the page.
    const bounds = EL_LABELS.map((l) => `<td>${l}</td>`).concat(['</tbody>']);
    for (let i = 0; i < 4; i++) {
      const start = p2.indexOf(bounds[i]);
      const end = p2.indexOf(bounds[i + 1], start);
      assert(start >= 0 && end > start, 'could not locate the coverage row for ' + EL_LABELS[i]);
      const row = p2.slice(start, end);
      assert(row.includes(FACTS[i].source), `${EL_LABELS[i]} does not show its own pin (${FACTS[i].source})`);
      for (let j = 0; j < 4; j++) {
        if (j !== i) assert(!row.includes(FACTS[j].source), `${EL_LABELS[i]} shows a pin belonging to another element (${FACTS[j].source})`);
      }
    }
  });

  // ======================================================================
  // 4. Dropping an element must drop its support with it — a mapping that
  //    outlives its element resurrects "support" nobody re-checked.
  // ======================================================================
  await post('/r/pleadings/addelement', { cause: claimCause().id, label: 'Reasonable reliance' });
  check('element: added with a derived key and no support', () => {
    const c = claimCause();
    assert.strictEqual(c.elements.length, 5, 'the added element is not on the cause');
    assert.strictEqual(c.elements[4].key, 'reasonable-reliance');
    assert.strictEqual(c.elements[4].label, 'Reasonable reliance');
    assert.strictEqual(c.mapping['reasonable-reliance'], undefined, 'a new element must start unsupported');
  });
  await post('/r/pleadings/addelement', { cause: claimCause().id, label: 'reasonable RELIANCE' });
  check('element: duplicate label refused case-insensitively', () => assert.strictEqual(claimCause().elements.length, 5, 'the same element was added twice'));

  await post('/r/pleadings/link', { cause: claimCause().id, element: 'reasonable-reliance', fact: factIds[0] });
  check('element: new element takes a fact', () => assert.deepStrictEqual(claimCause().mapping['reasonable-reliance'], [factIds[0]]));

  await post('/r/pleadings/delelement', { cause: claimCause().id, element: 'reasonable-reliance' });
  check('element: dropping it drops its mapping', () => {
    const c = claimCause();
    assert.strictEqual(c.elements.length, 4, 'the element was not removed');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(c.mapping, 'reasonable-reliance'), false,
      'the dropped element left its mapping behind — re-adding it would show support counsel never re-checked');
  });
  // Prove it behaviourally: re-add the same element and it must be bare again.
  await post('/r/pleadings/addelement', { cause: claimCause().id, label: 'Reasonable reliance' });
  check('element: re-added element is unsupported again', () => {
    const c = claimCause();
    assert.strictEqual(c.elements[4].key, 'reasonable-reliance');
    assert.strictEqual((c.mapping['reasonable-reliance'] || []).length, 0, 'a re-added element came back already "supported"');
  });
  const p3 = await page();
  check('element: the re-added element reopens the gap', () => {
    assert(p3.includes('<span class="tag navy">4/5 elements supported</span>'), 'coverage did not fall to 4/5');
    assert(p3.includes('<span class="tag gate">1 gap</span>'), 'the unsupported element did not reopen a gap');
  });
  await post('/r/pleadings/delelement', { cause: claimCause().id, element: 'reasonable-reliance' });

  // ======================================================================
  // 5. AFFIRMATIVE DEFENCE — the waiver trap.
  // ======================================================================
  await post('/r/pleadings/defence', { ref: 'Limitation period expired', basis: 'Claim discovered 2018-04-02; issued 2024-06-01.' });
  check('defence: registered unpleaded, with its real authority', () => {
    const ds = defences();
    assert.strictEqual(ds.length, 1, 'the affirmative defence was not registered');
    assert.strictEqual(ds[0].name, 'Limitation period expired');
    assert.strictEqual(ds[0].cite, 'Limitations Act, 2002, S.O. 2002, c. 24, Sch. B, s. 4', 'the defence lost its authority');
    assert.strictEqual(ds[0].pleaded, false, 'a newly registered defence must NOT start out pleaded');
  });
  await post('/r/pleadings/defence', { custom: 'limitation PERIOD expired' });
  check('defence: duplicate name refused case-insensitively', () => assert.strictEqual(defences().length, 1, 'the same defence was registered twice'));

  const p4 = await page();
  check('defence: unpleaded is shown as a waiver risk', () => {
    assert(p4.includes('<b>Waiver trap.</b>'), 'an unpleaded defence did not raise the waiver alarm');
    assert(p4.includes('<span class="tag gate">not pleaded — waived if omitted</span>'), 'the defence row does not read unpleaded');
    assert(p4.includes('<span class="tag gate">1 unpleaded — waiver risk</span>'), 'the defences heading does not count the unpleaded one');
  });

  await post('/r/pleadings/defence-plead', { id: defences()[0].id });
  check('defence: marking pleaded flips the record', () => assert.strictEqual(defences()[0].pleaded, true, 'the defence was not marked pleaded'));
  const p5 = await page();
  check('defence: pleaded clears the waiver alarm', () => {
    assert(p5.includes('<span class="tag ok">pleaded</span>'), 'the defence row does not read pleaded');
    assert(p5.includes('<span class="tag ok">all pleaded</span>'), 'the heading did not clear');
    assert(!p5.includes('<b>Waiver trap.</b>'), 'the waiver alarm still fires with nothing unpleaded');
    assert(!p5.includes('<span class="tag gate">not pleaded — waived if omitted</span>'), 'the row still reads unpleaded');
  });

  // ======================================================================
  // 6. THE REGISTER — the artifact that leaves the room. It must state the
  //    same coverage the screen does, element by element.
  // ======================================================================
  const r1 = await post('/r/pleadings/register-export', {});
  check('register: clean file states no outstanding gaps', () => {
    assert.strictEqual(r1.status, 200, 'the register did not export');
    assert.match(r1.headers.get('content-type') || '', /text\/plain/, 'the register is not plain text');
    assert.match(r1.headers.get('content-disposition') || '', /attachment; filename="pleadings-register-/, 'the register is not served as a download');
    assert(r1.text.includes('OUTSTANDING: none'), 'a fully covered, fully pleaded matter is not reported clean:\n' + r1.text.split('\n')[4]);
    assert(r1.text.includes('- Negligence (Ontario) [ON]'), 'the cause is missing from the register');
    for (let i = 0; i < 4; i++) {
      assert(r1.text.includes(`    * ${EL_LABELS[i]} — ${FACTS[i].date} (${FACTS[i].source})`),
        `the register does not show ${EL_LABELS[i]} carried by its own fact`);
    }
    assert(!r1.text.includes('NO FACTUAL SUPPORT'), 'the register reports a gap that no longer exists');
    assert(r1.text.includes('[PLEADED] Limitation period expired — Limitations Act, 2002'), 'the register does not record the defence as pleaded');
  });

  // ======================================================================
  // 7. A counterclaim is a cause of action too — same element discipline,
  //    and it must name the party it is asserted against.
  // ======================================================================
  await post('/r/pleadings/cause', { side: 'counterclaim', set: 'on-contract' });
  check('counterclaim: refused without a party', () => assert.strictEqual(causes().length, 1, 'a counterclaim was recorded against nobody'));
  await post('/r/pleadings/cause', { side: 'counterclaim', set: 'on-contract', against: 'Ridgeline Logistics Inc.' });
  const counter = () => causes().find((c) => c.side === 'counterclaim');
  check('counterclaim: recorded with its own elements', () => {
    const c = counter();
    assert(c, 'the counterclaim was not recorded');
    assert.strictEqual(c.against, 'Ridgeline Logistics Inc.');
    assert.deepStrictEqual(c.elements.map((e) => e.key), ['contract', 'performance', 'breach', 'damages']);
    assert.deepStrictEqual(c.mapping, {}, 'the counterclaim did not start unsupported');
  });

  const r2 = await post('/r/pleadings/register-export', {});
  check('register: the counterclaim reopens four gaps', () => {
    assert(r2.text.includes('OUTSTANDING: 4 gap(s) — 4 element(s) with no factual support, 0 defence(s) not pleaded.'),
      'the register mis-states the outstanding work:\n' + (r2.text.split('\n').find((l) => l.startsWith('OUTSTANDING')) || '(no OUTSTANDING line)'));
    assert(r2.text.includes('== COUNTERCLAIM =='), 'the counterclaim has no section in the register');
    assert(r2.text.includes('- Breach of contract [ON] against Ridgeline Logistics Inc.'), 'the counterclaim does not name the party');
    assert.strictEqual(count(r2.text, 'NO FACTUAL SUPPORT'), 4, 'the four unsupported counterclaim elements are not each flagged');
    // and the claim side is untouched by any of it
    assert(r2.text.includes(`    * Duty of care — ${FACTS[0].date} (${FACTS[0].source})`), 'the claim side lost its support when the counterclaim was added');
  });

  // ======================================================================
  // 8. A second defence left unpleaded must reappear in the queue and the file.
  // ======================================================================
  await post('/r/pleadings/defence', { ref: 'Contributory negligence' });
  const r3 = await post('/r/pleadings/register-export', {});
  check('register: an unpleaded defence is counted and named', () => {
    assert.strictEqual(defences().length, 2, 'the second defence was not registered');
    assert(r3.text.includes('OUTSTANDING: 5 gap(s) — 4 element(s) with no factual support, 1 defence(s) not pleaded.'),
      'the register does not count the unpleaded defence:\n' + (r3.text.split('\n').find((l) => l.startsWith('OUTSTANDING')) || '(no OUTSTANDING line)'));
    assert(r3.text.includes('[NOT PLEADED] Contributory negligence — Negligence Act, R.S.O. 1990, c. N.1, s. 3'),
      'a defence at risk of waiver is not marked NOT PLEADED in the file');
    assert(r3.text.includes('[PLEADED] Limitation period expired'), 'the pleaded defence changed state when another was registered');
  });
  const p6 = await page();
  check('page: the unpleaded defence is back in the gap queue', () => {
    assert(p6.includes('<b>Waiver trap.</b>'), 'the waiver alarm did not return');
    assert(p6.includes('<span class="tag gate">5 gaps</span>'), 'the gap count does not include the unpleaded defence');
  });

  server.close();
  if (fails.length) { console.error('PLEADINGS FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PLEADINGS: ALL PASS (cause elements + in-matter fact gate + element/fact pairing + defence waiver state + exported register)');
  process.exit(0);
})().catch((e) => { console.error('PLEADINGS ERROR:', e && e.stack ? e.stack : e); try { server.close(); } catch (_) {} process.exit(1); });
