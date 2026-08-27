'use strict';
// The model gateway is the ONLY door between Chambers and any language model,
// and what goes through it is privileged: draft text, client facts, counsel's
// theory. fetch() defaults to redirect:'follow', so a configured endpoint that
// answered 307/308 had the whole request — body and Authorization header —
// re-POSTed to whatever host the redirect named. Nothing in the app saw it: the
// call was audited as one call to the configured endpoint, so the egress was
// invisible in the record that exists precisely to show where content went.
const http = require('http');
const assert = require('assert');
const { chat } = require('../kernel/ai.js');

const PRIVILEGED = 'PRIVILEGED: the client admits the brakes were serviced late';

(async () => {
  // The host an attacker (or a typo, or a hijacked endpoint) redirects to.
  let exfiltrated = null;
  const sink = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      exfiltrated = { body: b, auth: req.headers.authorization || null };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  const sinkUrl = 'http://127.0.0.1:' + sink.address().port;

  // The configured endpoint, which redirects everything to the sink.
  const redirector = http.createServer((req, res) => {
    res.writeHead(307, { location: sinkUrl + req.url });
    res.end();
  });
  await new Promise((r) => redirector.listen(0, '127.0.0.1', r));
  const cfg = { endpoint: 'http://127.0.0.1:' + redirector.address().port, model: 'm', apiKey: 'sk-secret-key' };

  const out = await chat(cfg, [{ role: 'user', content: PRIVILEGED }]);

  assert.strictEqual(exfiltrated, null,
    'EGRESS: privileged content was re-POSTed to a host the redirect chose:\n  ' + JSON.stringify(exfiltrated));
  assert.strictEqual(out.ok, false, 'a redirecting endpoint must be reported as a failure, not silently followed');
  assert(/redirect/i.test(out.message || ''), 'the failure must name the redirect, got: ' + out.message);
  console.log('PASS gateway: a redirecting endpoint is refused, nothing is forwarded');

  // A normal endpoint must still work, so the guard is not over-broad.
  const good = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'a real answer' } }] }));
    });
  });
  await new Promise((r) => good.listen(0, '127.0.0.1', r));
  const ok = await chat({ endpoint: 'http://127.0.0.1:' + good.address().port, model: 'm' }, [{ role: 'user', content: 'hi' }]);
  assert.strictEqual(ok.ok, true, 'a normal endpoint must still work: ' + JSON.stringify(ok));
  assert.strictEqual(ok.text, 'a real answer');
  console.log('PASS gateway: an ordinary endpoint still works');

  sink.close(); redirector.close(); good.close();
  console.log('GATEWAY: ALL PASS');
  process.exit(0);
})().catch((e) => { console.error('GATEWAY FAIL:', e.message); process.exit(1); });
