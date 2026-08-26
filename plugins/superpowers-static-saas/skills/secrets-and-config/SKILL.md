---
name: secrets-and-config
description: What is genuinely public versus secret in this stack, where each belongs, and the rotation and lockdown checklist. Use before adding any key, touching js/config.js or netlify.toml, or when a credential may have been committed.
tags: [security, secrets, netlify, firebase, config]
icon: 🔐
---

# Secrets and configuration

This stack ships its frontend as plain files. Anything in an HTML or `js/` file
is readable by anyone. The whole discipline is knowing which side of that line a
value belongs on.

## Public — fine to commit

- The **Firebase web config** (`apiKey`, `authDomain`, `projectId`,
  `storageBucket`, `messagingSenderId`, `appId`). This is designed to be public;
  it identifies the project, it does not authorize anything. Firebase security
  rules and API-key domain restrictions are what protect the data.
- Owner *email addresses* used for UI branching.
- Anything served by `get-config.js`.

**One home:** `js/config.js` in Shotbreak. Not inline in `app.html`, not again in
`workflow/index.html`, not a third time in `editor/index.html`. Three copies
means two are stale — that is exactly what the config-centralization pass fixed.

## Secret — Netlify environment variables only, never in git

`FIREBASE_DB_SECRET`, `OPENAI_API_KEY` / `SORA_API_KEY`, `AIVIDEOAPI_API_KEY`,
`WAVESPEED_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `OWNER_TOKEN_SECRET`, `OWNER_PW_*`,
any GitHub PAT.

Set them with `set-netlify-env.ps1` or the Netlify UI, then redeploy — env var
changes do not take effect until the next build.

## Read env through `lib/env.js`, always

```js
const { env, firstEnv } = require('./lib/env');
const key = firstEnv(['OPENAI_API_KEY', 'SORA_API_KEY', 'OPENAI_KEY']);
```

Two reasons, both load-bearing:

1. **esbuild inlines `process.env.FOO` at bundle time.** `lib/env.js` uses
   bracket access (`process.env[name]`) specifically to defeat that, so the value
   is read at runtime from the live Netlify environment.
2. **Keys arrive under several names.** `firstEnv` takes the list and returns the
   first non-empty one, so a rename in the Netlify UI does not take the site down.

For provider keys, prefer `lib/server-secrets.js` — it does env-first, then falls
back to the `server_secrets` node in Firebase, and caches in-process.
`providerKeyDiagnostics()` reports *whether* each key resolved and its length,
never the value. Copy that habit: diagnostics may say `true` and `40`, never the key.

## Static hosts serve everything you commit

`private/`, `docs/`, and stray `*.txt` runbooks are **public URLs** unless you
block them. A `_redirects` entry is not enough — static file serving wins. It
takes a `netlify.toml` redirect with `force = true`:

```toml
[[redirects]]
  from = "/private/*"
  to = "/404.html"
  status = 404
  force = true
```

That comment in `netlify.toml` — *"force=true overrides static file serving
(_redirects alone cannot)"* — was written after these files were live. When you
add a new internal doc or `.ps1` helper, add its redirect in the same commit.

Better still: keep operational notes out of the deployed repo entirely.

## If a secret may have been committed

Do all of these, in order — rotating without revoking is not a fix.

1. **Revoke the credential at the source** (Stripe, OpenAI, GitHub PAT, Firebase
   DB secret). Assume it is compromised the moment it hits a public repo;
   scrubbing git history does not un-publish it.
2. Issue a new value and set it in Netlify env vars. Redeploy.
3. Turn on **Secret scanning + Push protection** in GitHub repo settings → Security.
4. In Google Cloud Console for the Firebase project, **restrict the web API key**
   to your domains only.
5. Check that no archived copy is still in use — old `SHOTBREAK-vXX-*` folders
   carry the old duplicated config and must never be a base for new work. Start
   from a clean checkout.

## Never do these

- Log a key, or any slice of one, even at debug level.
- Return a provider's raw error body to the browser — they frequently echo the
  request including the `Authorization` header.
- Add a "just for now" fallback that accepts any token as owner.
  `lib/verify-token.js` says it outright: *no demo allows, no permissive "any
  token is owner", no client bypass tokens.* That comment is a rule, not history.
- Put a real password in a `.ps1`, `.bat`, or `.txt` in the repo.
