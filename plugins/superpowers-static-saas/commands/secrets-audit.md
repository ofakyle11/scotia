---
name: secrets-audit
description: Audit the working tree for committed credentials and for internal files that are publicly reachable on a static host.
tags: [security, secrets]
---

# Secrets audit

Two separate risks on this stack: a credential in the repo, and an internal file
that is a public URL because static hosting serves everything. Check both.
Read the `secrets-and-config` skill first if it is not loaded.

## 1. Credentials in tracked files

```bash
git grep -nEI 'sk-[a-zA-Z0-9]{16,}|whsec_[a-zA-Z0-9]|ghp_[a-zA-Z0-9]{20,}|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- . ':!*.zip'
git grep -nEI '(api[_-]?key|apikey|secret|password|passwd|token)\s*[:=]\s*["'"'"'][^"'"'"']{12,}' -- '*.js' '*.mjs' '*.json' '*.html' '*.ps1' '*.bat' '*.py' ':!package-lock.json'
```

**Triage every hit — do not report raw grep output.**

- Firebase **web** config (`apiKey: "AIza..."`, `authDomain`, `projectId`,
  `appId`) is public by design. Not a finding. Protection comes from Firebase
  security rules plus an API-key domain restriction in Google Cloud Console —
  worth confirming those are in place, but the value being in the repo is fine.
- `FIREBASE_DB_SECRET`, `OPENAI_API_KEY`, `SORA_API_KEY`, `AIVIDEOAPI_API_KEY`,
  `WAVESPEED_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `OWNER_TOKEN_SECRET`,
  `OWNER_PW_*`, any PAT — **hard stop**. These belong only in Netlify env vars.
- A literal password in a `.ps1`, `.bat`, or `.txt` — hard stop.

## 2. Env vars read in a way esbuild will inline

```bash
git grep -n 'process\.env\.' -- 'netlify/functions/*.js' | grep -v 'lib/env.js'
```

Direct `process.env.FOO` in a bundled function gets baked in at build time.
Flag each one and recommend `env()` / `firstEnv()` from `lib/env.js`.

## 3. Internal files reachable over the web

```bash
git ls-files | grep -E '^(private/|docs/)|\.(ps1|bat)$|^[A-Z_]+\.(txt|md)$'
grep -n 'force = true' -B4 netlify.toml
```

Every file in the first list needs a `netlify.toml` redirect with
`force = true`. A `_redirects` entry does **not** override static file serving.
Report anything in the first list that is not covered by the second.

## 4. Repository settings to confirm

These cannot be checked from the working tree — ask the user to confirm:

- GitHub → Settings → Security: **Secret scanning** and **Push protection** on
- Google Cloud Console: Firebase web API key restricted to the site's domains
- Netlify: env vars set, and no secret duplicated into `netlify.toml`

## 5. Report

Group as **Hard stops**, **Should fix**, and **Confirmed fine (and why)**. For
each hard stop give the remediation order from `secrets-and-config`: revoke at
the source first, then reissue into Netlify env vars, then redeploy. Rotating
without revoking is not a fix, and scrubbing git history does not un-publish a
key that was pushed to a public repo.
