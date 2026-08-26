---
name: preflight
description: Run the pre-deploy checklist for this stack before pushing — syntax checks, secret scan, data validation, netlify.toml coverage, and a stated rollback plan.
tags: [deploy, safety]
---

# Preflight

The user is about to push, and on this stack a push is a production deploy with
no staging. Work through this and report a clear GO or NO-GO.

Read the `shipping-to-production` skill first if it is not already loaded.

## 1. Establish what is changing

```bash
git status --short
git diff --stat HEAD
git diff --name-only HEAD
```

If the diff shows a file with roughly equal huge insertions and deletions, a
large file was rewritten wholesale rather than edited — stop and investigate
(see `editing-giant-html`).

## 2. Syntax-check every changed script

```bash
for f in $(git diff --name-only HEAD -- '*.js' '*.mjs'); do
  [ -f "$f" ] && { node --check "$f" >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"; }
done
```

For HTML files with inline JS, at minimum confirm the byte size moved by roughly
the amount you expect: `git diff --stat`.

## 3. Validate data files

```bash
[ -f scripts/validate-data.mjs ] && node scripts/validate-data.mjs
```

## 4. Scan the diff for secrets

```bash
git diff HEAD | grep -nEi 'sk-[a-zA-Z0-9]|whsec_|xox[baprs]-|ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|(api[_-]?key|secret|password|token)\s*[:=]\s*["'"'"'][^"'"'"']{12,}'
```

Judge each hit rather than reporting it blindly. The Firebase **web** config
(`apiKey: "AIza..."`, `authDomain`, `appId`) is public by design in this stack —
see `secrets-and-config`. A `FIREBASE_DB_SECRET`, provider key, `OWNER_PW_*`, or
PAT is a hard stop.

## 5. Confirm new internal files are blocked from the web

For anything added under `private/`, `docs/`, or any root `.txt` / `.ps1` /
`.md` runbook, check `netlify.toml` has a matching redirect with `force = true`.
A `_redirects` entry alone does not override static file serving.

```bash
git diff --name-only HEAD | grep -E '^(private/|docs/)|\.(txt|ps1)$'
grep -n 'force = true' netlify.toml
```

## 6. Function-specific checks

If `netlify/functions/` changed, verify each touched handler:

- handles `OPTIONS`
- returns through `respond()` / `corsHeaders()` rather than a hand-rolled `*` CORS header
- reads env via `env()` / `firstEnv()`, not inline `process.env.X`
- has a `[functions."name"] timeout` in `netlify.toml` if it can exceed 10s,
  or is split into a `-start` / `-status` pair

## 7. Shared markup consistency

If a header, footer, nav link, or meta tag changed, confirm the same edit landed
in every page:

```bash
grep -c 'THE_CHANGED_STRING' *.html
```

## 8. Report

Give a short verdict:

- **GO** — list what you checked and what you could not check locally.
- **NO-GO** — the specific blocker and the fix.

Either way, end with the rollback plan in one sentence: which of "delete the one
added line", "git revert `<sha>`", or "republish the previous Netlify deploy"
applies here.
