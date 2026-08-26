---
name: shipping-to-production
description: How to land a change safely when git push deploys straight to production with no staging — the two-commit rollout, the preflight checklist, the cache delays, and the rollback that actually works. Use before pushing or merging anything in the Shotbreak or Anderson repos.
tags: [deploy, netlify, github-pages, safety]
icon: 🚀
---

# Shipping to production

There is no staging environment. `git push` publishes. Netlify rebuilds functions
in about a minute; GitHub Pages serves the new files almost immediately but its
CDN caches `data/*.json` for **up to 10 minutes**.

Assume every push is seen by a real user — Shotbreak has paying subscribers and
the Anderson dashboard is linked from live fundraising pages.

## The two-commit rollout

This is the house pattern, taken from `private/ops/DEPLOY-INSTRUCTIONS.md`. Use it
for anything that touches config, auth, or a file more than one page depends on.

**Commit 1 — additive, zero risk.** Add the new thing. Leave the old thing in
place. Nothing can break, because nothing was removed.

> *e.g. add `js/config.js` and a `<script src="js/config.js">` tag to the three
> pages, while the old inline Firebase config blocks stay exactly where they are.*

Push. Verify live. Ask someone else to click around.

**Commit 2 — cleanup, only after Commit 1 is confirmed live.** Now delete the
duplicated old thing, so the value lives in exactly one place.

Never collapse these into one commit to save time. The whole point is that
Commit 1 is trivially revertible and Commit 2 is only attempted from a known-good
live state.

## Preflight — run `/preflight`, or work this list by hand

- [ ] `node --check` every `.js` file you touched (functions and browser scripts).
- [ ] If you touched `data/*.json`: `node scripts/validate-data.mjs` passes.
- [ ] If you touched a function: it still handles `OPTIONS` and returns through
      `respond()` from `lib/http.js`.
- [ ] If the function can take longer than 10 seconds, it has a
      `[functions."name"] timeout` entry in `netlify.toml` — or it is split into
      a `-start` / `-status` pair (see `netlify-functions`).
- [ ] No secret in the diff. `git diff --cached | grep -Ei 'sk-|AIza|whsec_|api[_-]?key'`
      — and see the `secrets-and-config` skill for what is genuinely public.
- [ ] Anything new under `private/`, `docs/`, or an ops `.txt` has a matching
      `force = true` redirect in `netlify.toml`. A `_redirects` entry alone will
      **not** override static file serving.
- [ ] If you edited a shared header/footer, you made the identical edit in
      **every** `*.html` — they are duplicated on purpose.
- [ ] You know, in one sentence, how to undo this if it is wrong.

## Verify after the push

Do not mark the work done at "pushed". Check the live site:

1. Hard-refresh (Ctrl+F5) — this stack has no cache-busting hashes.
2. Open DevTools console. Zero errors. Specifically watch for
   `SHOTBREAK_CONFIG is not defined` or a failed Firebase init.
3. Exercise the actual path you changed: log in, load the dashboard, generate a
   clip, submit a pledge — whichever applies.
4. For a function: `curl` it directly and confirm the status code and CORS
   headers, not just that the page "looks fine".
5. For `data/*.json` on GitHub Pages: wait out the ~10 minute CDN cache before
   concluding the change did not work.

## Rollback

Ranked by speed, fastest first:

1. **Undo the one line.** If Commit 1 was additive, deleting the single
   `<script src="...">` line in the GitHub web editor restores the previous
   behaviour instantly, because the old code is still in the file.
2. **Revert the commit.** `git revert <sha> && git push`. One Netlify build.
3. **Netlify → Deploys → Publish deploy** on the last known-good build. Instant,
   and it does not touch git — but the next push re-deploys the bad code, so
   follow it with a real revert.

Say which of these applies *before* you push, not after something breaks.

## Things that have actually bitten this stack

- **Ops notes served publicly.** `DO_THIS_NOW.txt`, `OWNER_LOGIN.md`,
  `get-owner-token.ps1` were reachable over HTTP until `force = true` redirects
  were added. Anything you write for yourself is public by default on a static host.
- **esbuild inlining env vars.** `process.env.FOO` gets baked in at bundle time.
  `lib/env.js` uses bracket access to prevent it. Always go through `env()` /
  `firstEnv()`.
- **Demo-day pressure.** `DEPLOY_FOR_DEMO_THIS_MORNING.txt` exists for a reason.
  Deadline pressure is exactly when the two-commit rollout matters most, not
  when to skip it.
- **Duplicated config drifting.** The same Firebase block lived in `app.html`,
  `workflow/index.html`, and `editor/index.html`. Three copies means two of them
  are stale. Centralize additively.
