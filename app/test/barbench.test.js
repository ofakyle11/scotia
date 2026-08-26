'use strict';
// The competence bench grades the firm's configured model. A bench that grades
// wrong is worse than none, so this suite proves the GRADING, using stub
// OpenAI-compatible endpoints through the real kernel/ai.js transport (redirect
// refusal and all). Four stubs:
//   - a "perfect" model that looks the answer up in the bank -> must score 100%
//   - a model that always answers A -> must score exactly the bank's A-fraction
//     and FAIL the line (also proves the key is not letter-skewed)
//   - a model that waffles in prose with no parseable letter -> every answer
//     wrong, no crash
//   - no configured endpoint -> clean refusal
const http = require('http');
const assert = require('assert');
const { BANK, PASS_LINE, run, parseLetter } = require('../kernel/barbench.js');
const { chat } = require('../kernel/ai.js');

// --- bank integrity ---------------------------------------------------------
assert(BANK.length >= 40, 'bank too small to mean anything: ' + BANK.length);
assert.strictEqual(new Set(BANK.map((q) => q.id)).size, BANK.length, 'duplicate question ids');
for (const q of BANK) {
  assert(q.options.A && q.options.B && q.options.C && q.options.D, q.id + ': needs 4 options');
  assert('ABCD'.includes(q.answer), q.id + ': answer must be A-D');
  assert(q.why && q.cite && q.subject, q.id + ': needs why/cite/subject');
}
const aFraction = BANK.filter((q) => q.answer === 'A').length / BANK.length;
assert(aFraction < PASS_LINE, 'answer key is so A-heavy that always-A would pass the line');
console.log(`PASS bank: ${BANK.length} questions, ids unique, no letter passes by skew (A=${Math.round(aFraction * 100)}%)`);

// --- grading strictness -----------------------------------------------------
assert.strictEqual(parseLetter('B'), 'B');
assert.strictEqual(parseLetter(' (C) '), 'C');
assert.strictEqual(parseLetter('D.'), 'D');
assert.strictEqual(parseLetter('The answer is: A'), 'A');
assert.strictEqual(parseLetter('B. Two years from the day the claim was discovered'), 'B');
assert.strictEqual(parseLetter('I believe the second option is most defensible.'), null);
assert.strictEqual(parseLetter(''), null);
console.log('PASS parse: single letters and "answer is X" read; waffle is wrong, not guessed');

const answerFor = (body) => {
  const text = (((body.messages || [])[0] || {}).content) || '';
  const m = /\[([a-z]+-\d+)\]\s*$/.exec(text.trim());
  const q = m && BANK.find((x) => x.id === m[1]);
  return q ? q.answer : 'Z';
};
const stub = (reply) => new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch (_) { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: reply(body) } }] }));
    });
  });
  s.listen(0, '127.0.0.1', () => resolve({ server: s, cfg: { endpoint: 'http://127.0.0.1:' + s.address().port, model: 'stub' } }));
});

(async () => {
  // Perfect model -> 100%, passes.
  const perfect = await stub((body) => answerFor(body));
  const p = await run(perfect.cfg, chat);
  perfect.server.close();
  assert(p.ok && p.correct === BANK.length && p.passed, 'perfect model did not score 100%: ' + JSON.stringify({ correct: p.correct, passed: p.passed }));
  assert.strictEqual(p.pct, 100);
  console.log(`PASS grading: a model that knows the law scores ${p.correct}/${p.total} and passes the ${p.passLine}% line`);

  // Always-A -> exactly the A-fraction, fails.
  const lazy = await stub(() => 'A');
  const l = await run(lazy.cfg, chat);
  lazy.server.close();
  const expectA = BANK.filter((q) => q.answer === 'A').length;
  assert.strictEqual(l.correct, expectA, `always-A scored ${l.correct}, expected ${expectA}`);
  assert(!l.passed, 'always-A must fail the line');
  console.log(`PASS grading: always-A scores exactly ${l.correct}/${l.total} and FAILS`);

  // Waffle -> zero, no crash, per-subject totals intact.
  const waffle = await stub(() => 'On balance the better view is probably the second option, though it is arguable.');
  const w = await run(waffle.cfg, chat);
  waffle.server.close();
  assert(w.ok && w.correct === 0 && !w.passed, 'unparseable answers must all be wrong');
  assert.strictEqual(Object.values(w.bySubject).reduce((n, s) => n + s.total, 0), BANK.length);
  console.log('PASS grading: a model that cannot follow "answer A-D" scores 0, cleanly');

  // No endpoint -> refusal, not a crash.
  const none = await run(null, chat);
  assert(!none.ok && /configured/i.test(none.message), 'missing config must refuse cleanly');
  console.log('PASS config: no endpoint is a clean refusal');

  console.log('BARBENCH: ALL PASS (bank sound, grading strict, pass line unreachable by skew or waffle)');
  process.exit(0);
})().catch((e) => { console.error('BARBENCH FAIL:', e.message); process.exit(1); });
