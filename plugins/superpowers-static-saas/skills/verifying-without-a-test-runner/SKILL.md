---
name: verifying-without-a-test-runner
description: What verification means in repos with no jest, vitest, or CI test suite — syntax checks, validator scripts, netlify dev, curl, and live-page checks. Replaces the assumptions of the superpowers test-driven-development skill in this stack.
tags: [testing, verification, quality]
icon: ✅
---

# Verifying when there is no test runner

Neither Shotbreak nor the Anderson site has jest, vitest, mocha, or a `test`
script. `package.json` in Shotbreak has empty `dependencies` and
`devDependencies`. What exists is a validator script, a GitHub Action, and some
ad-hoc parser checks (`scripts/run_parser_test.py`, `scripts/test_parser_chars.mjs`).

This does **not** mean "skip verification". It means verification looks different,
and you have to say which of these you actually ran.

## Do not fake TDD

The `superpowers` `test-driven-development` skill assumes a runner you can watch
go red then green. Here there is nothing to run. Do not scaffold jest into a repo
whose defining property is having no build step and no dependencies just to
satisfy a workflow — that is a much larger change than the one you were asked for,
and it is not yours to make. Propose it separately if you think it is warranted.

## The ladder — climb as far as the change warrants

**1. Syntax check. Always. Every changed JS file, no exceptions.**

```bash
node --check netlify/functions/gen-clip.js
node --check js/dashboard.js
for f in $(git diff --name-only --cached -- '*.js' '*.mjs'); do node --check "$f" || echo "FAIL $f"; done
```

This is one second and catches the most common way this stack breaks in
production: a syntax error in a file nobody executed locally.

**2. Run the validator, if the change touches data.**

```bash
node scripts/validate-data.mjs
```

**3. Extract and exercise pure logic.** Functions like `parseAmount`,
`runnerColor`, `amountToTier`, `isSafeUrl`, `sanitizeField` are pure and trivially
callable:

```bash
node -e '
  const { isSafeUrl } = require("./netlify/functions/lib/safe-url");
  const cases = [
    ["https://example.com/a.mp4", true],
    ["http://example.com/a.mp4", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["https://10.0.0.5/x", false],
  ];
  let bad = 0;
  for (const [url, want] of cases) {
    const got = isSafeUrl(url);
    if (got !== want) { console.log("FAIL", url, "want", want, "got", got); bad++; }
  }
  console.log(bad ? bad + " FAILED" : "all passed");
'
```

If you write one of these and it is worth keeping, save it in `scripts/` next to
the existing ones and mention it in the commit. That is how this repo grows a
test suite — one real check at a time, in the style already there.

**4. Run the function locally.**

```bash
netlify dev          # or: npm run dev:functions
curl -i -X POST http://localhost:8888/.netlify/functions/my-function \
  -H 'Content-Type: application/json' -d '{}'
curl -i -X OPTIONS http://localhost:8888/.netlify/functions/my-function
```

Check the status code **and** the CORS headers, not just that a response came back.

**5. Load the page.** `py local-server.py`, or `python3 -m http.server 8000` for
the Anderson site — the dashboard `fetch`es its JSON, which browsers block on
`file://`, so opening the HTML directly will always look broken for the wrong reason.

Then: hard-refresh, open the console, confirm zero errors, and click the path you
changed.

**6. Verify on the live site after deploying.** See `shipping-to-production`.
On this stack that step is not optional — it is the only environment that runs
the real functions with the real env vars.

## Add a check to CI when you add a contract

The Anderson pattern is the one to copy: a plain Node script plus a GitHub Action
scoped to the paths that matter.

```yaml
on:
  push:
    paths:
      - "data/**"
```

Keep it non-blocking where a human needs to be able to fix things fast, and write
its failure messages for whoever will read them — for `data/`, that is a
volunteer, not you.

## Report honestly

When you say a change is verified, say what you actually did:

> Verified: `node --check` on both changed files, `validate-data.mjs` passes,
> exercised `gen-clip-status` via `netlify dev` (200 with correct CORS, 401
> without a token). Not verified: the live Wavespeed round-trip — that needs the
> production key.

Never write "tested" when you mean "read it over". The `superpowers`
`verification-before-completion` skill still governs; this skill only defines
what counts as evidence here.
