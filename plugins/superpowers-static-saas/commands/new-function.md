---
name: new-function
description: Scaffold a new Netlify Function in this repo's house style — shared lib helpers, CORS allowlist, auth, input validation, and the netlify.toml entry.
tags: [netlify, serverless, scaffold]
---

# New Netlify Function

Create a new handler under `netlify/functions/`. Follow the `netlify-functions`
skill — read it first if it is not loaded.

## Ask first, if not already stated

1. Endpoint name (kebab-case; the filename becomes the URL).
2. Method(s), and whether it requires auth or is deliberately public.
3. Does it call a slow upstream provider (video, LLM, image)? If it could exceed
   10 seconds, build it as a `-start` / `-status` pair instead of one handler.
4. Which env vars it needs, and whether any already exist under another name.

## Then write it

Use the skeleton in the `netlify-functions` skill:

- `'use strict'` at the top, CommonJS, `exports.handler = async (event) => {}`
- `const headers = corsHeaders(event)` from `./lib/http`
- `OPTIONS` → `204` first, before anything else
- method check → `405`
- `requireAuth(event)` from `./lib/verify-token` unless public → `401` on throw
- `JSON.parse(event.body || '{}')` inside a `try` → `400` on failure
- validate every input field before doing any work
- any client-supplied URL through `filterSafeUrls()` from `./lib/safe-url`
- any user text bound for an LLM through `sanitizeField()` / `wrapUserContent()`
  from `./lib/sanitize-prompt`, with `UNTRUSTED_RULE` in the system prompt
- env through `env()` / `firstEnv([...])` from `./lib/env` — never inline
  `process.env.X`, esbuild inlines it at bundle time
- provider keys through `./lib/server-secrets` where one already exists
- bound every upstream `fetch` with an `AbortController` + 20s timeout, cleared
  in a `finally`
- `catch` → `console.error('[endpoint-name]', e)` and a **generic** message to
  the client; never echo the provider's raw error body

## Register it

If it can run longer than 10 seconds, add to `netlify.toml`:

```toml
[functions."endpoint-name"]
  timeout = 60
```

## Verify before reporting done

```bash
node --check netlify/functions/endpoint-name.js
netlify dev
curl -i -X OPTIONS http://localhost:8888/.netlify/functions/endpoint-name
curl -i -X POST http://localhost:8888/.netlify/functions/endpoint-name \
  -H 'Content-Type: application/json' -d '{}'
```

Confirm: `204` on OPTIONS, `401` without a token if it is authed, `400` on bad
input, and the right `Access-Control-Allow-Origin` on each.

Tell the user which env vars they need to add in Netlify and that a **redeploy
is required** before new env vars take effect.
