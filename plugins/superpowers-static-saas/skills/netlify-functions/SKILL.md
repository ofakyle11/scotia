---
name: netlify-functions
description: House style for writing and changing Netlify Functions in this stack — the shared lib/ helpers, the CORS allowlist, the start/status split for slow providers, auth, and untrusted-prompt handling. Use whenever adding or editing anything under netlify/functions/.
tags: [netlify, serverless, backend, cors, security]
icon: ⚡
---

# Writing Netlify Functions here

CommonJS, one file per endpoint, `exports.handler`, `'use strict'` at the top.
Netlify bundles with esbuild. There is no TypeScript and no framework.

## Use the shared lib — do not re-implement it

`netlify/functions/lib/` already solves these. Reaching for a fresh
implementation is how the copies drift apart.

| Helper | Use it for |
|---|---|
| `lib/http.js` | `corsHeaders(event)`, `respond(event, code, body)`, `getAuthHeader(event)`, `isAllowedOrigin(origin)` |
| `lib/env.js` | `env(name)`, `hasEnv(name)`, `firstEnv([names])` — **always** read env through these |
| `lib/verify-token.js` | `verify(authHeader)`, `requireAuth(event)` — owner HMAC tokens and Firebase ID tokens |
| `lib/server-secrets.js` | Provider API keys, with env → Firebase fallback and an in-process cache |
| `lib/safe-url.js` | `isSafeUrl(url)`, `filterSafeUrls(urls)` — SSRF guard for any client-supplied URL |
| `lib/sanitize-prompt.js` | `sanitizeField()`, `wrapUserContent()`, `UNTRUSTED_RULE` — before user text reaches an LLM |
| `lib/firebase-db.js` | `fbGet`, `fbPatch` against the Realtime DB |
| `lib/http.js` + `lib/llm.js` | Model calls; `lib/llm.js` is the abstraction that hands every agent the strongest model |

## The skeleton

```js
'use strict';

const { respond, corsHeaders } = require('./lib/http');
const { requireAuth } = require('./lib/verify-token');
const { firstEnv } = require('./lib/env');

exports.handler = async (event) => {
  const headers = corsHeaders(event);

  // 1. Preflight, always first.
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  // 2. Method check.
  if (event.httpMethod !== 'POST') return respond(event, 405, { error: 'Method not allowed' });

  // 3. Auth, unless this endpoint is deliberately public.
  try {
    await requireAuth(event);
  } catch (e) {
    return respond(event, 401, { error: 'Unauthorized' });
  }

  // 4. Validate input before doing any work.
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(event, 400, { error: 'Invalid JSON' }); }

  // 5. Do the thing. Never let a provider error escape as a 200.
  try {
    // ...
    return respond(event, 200, { ok: true });
  } catch (e) {
    console.error('[my-function]', e);
    return respond(event, 500, { error: 'Internal error' });
  }
};
```

## CORS: allowlist, not `*`

`lib/http.js` holds the allowlist (`https://shotbreak.io`, `www`, and localhost
ports for `netlify dev`). `corsHeaders(event)` echoes the origin only if it is on
the list, and otherwise falls back to the production origin.

Two existing functions — `get-config.js` and `auth.js` — set
`Access-Control-Allow-Origin: '*'` inline. That is legacy. **Do not copy it into
anything new**, and never use `*` on an endpoint that reads an `Authorization`
header. New endpoints go through `corsHeaders` / `respond`.

## Slow providers: split into `-start` and `-status`

Netlify Functions time out at 10 seconds by default. Video and agent calls take
minutes. The established pattern is two endpoints plus client-side polling:

- `gen-clip.js` → kicks off the job, returns a provider request id immediately
- `gen-clip-status.js` → `?id=...`, polls the provider, maps provider states to
  a stable vocabulary (`completed` / `failed` / `processing`) via a `STATUS_MAP`

The same pair exists for `agent-invoke` and `gen-portrait`. Follow it.

Inside the status handler, always bound the upstream call with an
`AbortController` and a `setTimeout` (20s is the established value), and clear
the timer in a `finally`. Read `.text()` first and `JSON.parse` in a `try` —
providers return HTML error pages more often than you would like.

If a function genuinely needs longer than 10s in one shot, it must be declared:

```toml
[functions."my-function"]
  timeout = 60
```

60 seconds is the ceiling. If you need more, you need the start/status split.

## Handling untrusted input

**Any URL from the client** goes through `filterSafeUrls()` before you `fetch` it.
`lib/safe-url.js` blocks `localhost`, private IPv4 ranges, `169.254.169.254`
(cloud metadata), `.local` and `.internal`, and requires `https://`. Bypassing it
is an SSRF hole straight into Netlify's metadata service.

**Any user text that reaches an LLM** goes through `lib/sanitize-prompt.js`:
`sanitizeField()` for short fields, `wrapUserContent(label, text)` for
screenplay-sized blocks, and include `UNTRUSTED_RULE` in the system prompt. The
markers exist so the model can tell material from instructions — do not
concatenate raw user text into a prompt.

## Webhooks must verify signatures

`stripe-webhook.js` is the reference: reconstruct the HMAC over `${ts}.${payload}`
with `STRIPE_WEBHOOK_SECRET` and compare with `crypto.timingSafeEqual`. Never a
`===` on a signature, and never skip verification because "it's just a test".
A webhook that grants a subscription tier is a money endpoint.

## Checklist before you push a function

- [ ] `node --check netlify/functions/<file>.js`
- [ ] Handles `OPTIONS`
- [ ] Reads env through `env()` / `firstEnv()`, never bare `process.env.X` inline
- [ ] Auth checked, or the endpoint is deliberately and documentedly public
- [ ] Client URLs filtered through `filterSafeUrls`
- [ ] Errors log with a `[function-name]` prefix and return a generic message —
      never echo the provider's raw error to the browser, it leaks keys and URLs
- [ ] Timeout declared in `netlify.toml` if it can exceed 10s
- [ ] Exercised locally with `netlify dev` (`npm run dev:functions`), then `curl`ed
