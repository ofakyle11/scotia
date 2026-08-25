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
    const r = await fetch(String(cfg.endpoint).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal, headers,
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: maxTokens, temperature }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, message: `Model endpoint error ${r.status}${body && body.error ? ': ' + String(body.error.message || body.error).slice(0, 200) : ''}` };
    const text = body && body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : null;
    if (!text) return { ok: false, message: 'Model returned no content.' };
    return { ok: true, text, model: cfg.model };
  } catch (e) {
    return { ok: false, message: e.name === 'AbortError' ? 'Model call timed out (90s).' : 'Network error reaching model endpoint: ' + e.message };
  } finally { clearTimeout(timer); }
}

module.exports = { chat };
