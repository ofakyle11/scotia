---
name: static-saas-stack
description: House rules for the static-first SaaS stack used across Shotbreak and the Angus Anderson Foundation site — vanilla JS at the root, Netlify Functions as the only backend, no build step, no framework, git push deploys to production. Read this before making any change in one of these repos.
tags: [architecture, conventions, netlify, vanilla-js]
icon: 🏗️
---

# The static-first SaaS stack

This is the shape every one of these projects takes. It is a deliberate choice,
not an accident — do not "modernize" it into a framework.

## Reference builds

| | `ofakyle11/shotb` (Shotbreak) | `ofakyle11/anderson` (Anderson Foundation) |
|---|---|---|
| What it is | AI media-production SaaS, paid accounts | Nonprofit site + live fundraising dashboard |
| Frontend | `app.html` (~500KB single file), `index.html`, `dashboard.html`, plus `timeline/`, `editor/`, `workflow/` | One HTML file per page, header/footer duplicated on purpose |
| Logic | `js/*.js`, plain scripts, no modules bundler | `js/*.js`, IIFE + `"use strict"` |
| Backend | `netlify/functions/*.js` (CommonJS, esbuild) | `netlify/functions/`, `@netlify/blobs` |
| Data | Firebase Realtime DB over REST | `data/tough-mudder.json` committed to git |
| Auth | Custom tokens in `sessions` (`netlify/functions/auth.js`) | None — public site + `admin.html` |
| Money | Stripe (`stripe-webhook.js`) | Zeffy embed / Netlify Forms pledges |
| Deploy | `git push` → Netlify | `git push` → GitHub Pages (Netlify for forms) |
| Tests | none (ad-hoc scripts in `scripts/`) | `scripts/validate-data.mjs` + GitHub Action |

## The non-negotiables

1. **No build step.** No webpack, Vite, Next, React, TypeScript compile. What is
   in the repo is what the browser gets. The only bundler in play is esbuild,
   and only Netlify runs it, only on `netlify/functions/`.
2. **No framework on the frontend.** Plain DOM APIs. `anderson/README.md` states
   the reason outright: *"A bad edit to the data file can never take the site
   down."* Fewer moving parts is the feature.
3. **Every page degrades gracefully.** If data is missing or malformed, render a
   friendly fallback — never a blank page, never a stack trace. See the
   `json-as-database` skill.
4. **The serverless function is the only backend.** There is no server to SSH
   into, no container, no cron. If something needs to run, it is a Netlify
   Function or it is a GitHub Action.
5. **`git push` is a production deploy.** There is no staging environment. Read
   the `shipping-to-production` skill before you push.

## Where things go

```
index.html, app.html, *.html   Pages. Self-contained; inline <style> is normal here.
css/site.css                   Anderson: the ENTIRE design system, tokens at the top.
js/                            Browser scripts. Load order matters — shared.js first.
js/config.js                   Shotbreak: single source of truth for PUBLIC config.
netlify/functions/             Serverless handlers, one file per endpoint.
netlify/functions/lib/         Shared helpers. Use them; do not re-implement them.
data/                          Anderson: JSON that volunteers edit by hand.
scripts/                       Validators and ad-hoc checks (Node .mjs or Python).
private/ops/, private/docs/    Internal runbooks. MUST be blocked in netlify.toml.
netlify.toml                   Build config, function timeouts, headers, redirects.
```

## Local development is Windows-first

The owner runs Windows. Give commands that actually work there:

- `py local-server.py`, not `python3`
- `START_LOCAL.bat`, `install-local-gpu.bat` for one-click startup
- `.ps1` scripts for anything touching Netlify env vars (`set-netlify-env.ps1`)
- `netlify dev` when functions need to be exercised (`npm run dev:functions`)

When you write a new helper script, ship the `.bat`/`.ps1` wrapper alongside it.
A bare `bash` one-liner is not a usable instruction in this environment.

## How this relates to the `superpowers` plugin

`superpowers` supplies the general methodology — brainstorming, writing plans,
systematic debugging, subagent-driven development, requesting code review. Keep
using it. This plugin narrows the parts of it that assume a stack this one does
not have:

| superpowers skill | What to do here instead |
|---|---|
| `test-driven-development` | There is no test runner. Use `verifying-without-a-test-runner`. |
| `verification-before-completion` | Still applies — but "verified" means the live-site checks in `shipping-to-production`, not a green suite. |
| `finishing-a-development-branch` | Merging to `main` **is** the deploy. Run `/preflight` first. |
| `using-git-worktrees` | Fine, and useful when editing the giant `app.html` — see `editing-giant-html`. |

Everything else in `superpowers` applies unchanged.
