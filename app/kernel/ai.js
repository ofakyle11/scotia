'use strict';
// The model gateway — the only door between Chambers and any language model.
// Off until an administrator configures an endpoint (any OpenAI-compatible
// API: a local Ollama/vLLM for on-premise, or a hosted model where the
// engagement permits). Every call is policy-checked per matter and audited.
// Client content NEVER trains anything; this gateway only ever infers.

async function chat(cfg, messages, { maxTokens = 1500, temperature = 0.4 } = {}) {
  if (!cfg || !cfg.endpoint || !cfg.model) return { ok: false, message: 'No model endpoint configured.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  try {
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
    // redirect:'error' is load-bearing, not defensive tidiness. fetch() defaults
    // to following redirects, so an endpoint answering 307/308 had this entire
    // request — privileged draft text in the body AND the Authorization header —
    // re-POSTed to whatever host the Location named. The call was audited as one
    // call to the CONFIGURED endpoint, so that egress was invisible in the very
    // record that exists to show where client content went. The only door to a
    // model must lead exactly where the administrator pointed it.
    const r = await fetch(String(cfg.endpoint).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal, headers, redirect: 'error',
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: maxTokens, temperature }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, message: `Model endpoint error ${r.status}${body && body.error ? ': ' + String(body.error.message || body.error).slice(0, 200) : ''}` };
    const text = body && body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : null;
    if (!text) return { ok: false, message: 'Model returned no content.' };
    return { ok: true, text, model: cfg.model };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, message: 'Model call timed out (90s).' };
    // Node reports a refused redirect as a TypeError with 'redirect' in the
    // cause; surface it plainly so an administrator fixes the endpoint rather
    // than wondering about the network.
    if (/redirect/i.test(String(e.message) + ' ' + String(e.cause && e.cause.message))) {
      return { ok: false, message: 'Model endpoint attempted a redirect. Refused: privileged content is only ever sent to the endpoint configured at /admin. Point the setting at the final URL.' };
    }
    return { ok: false, message: 'Network error reaching model endpoint: ' + e.message };
  } finally { clearTimeout(timer); }
}

module.exports = { chat };
