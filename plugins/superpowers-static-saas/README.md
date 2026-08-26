# Superpowers: Static SaaS

A companion to the [`superpowers`](https://github.com/obra/superpowers) plugin,
retuned for the way these projects are actually built.

`superpowers` gives Claude a general software-development methodology —
brainstorming, writing plans, systematic debugging, subagent-driven development,
requesting code review. All of that still applies. But a few of its skills assume
a stack with a test runner, a build step, and a staging environment. This stack
has none of those, on purpose. This plugin fills that gap and adds the
conventions that only exist in these repos.

## Where it came from

Everything here is derived from two real build-outs:

- **[`ofakyle11/shotb`](https://github.com/ofakyle11/shotb)** — Shotbreak, an AI
  media-production SaaS. ~500KB single-file `app.html`, 20+ Netlify Functions,
  Firebase Realtime DB, Stripe subscriptions, multi-provider video generation
  with start/status polling, an 82-agent registry.
- **[`ofakyle11/anderson`](https://github.com/ofakyle11/anderson)** — the Angus
  Anderson Foundation site. Zero-dependency static site, a live fundraising
  dashboard rendered from a JSON file that volunteers edit in the GitHub web UI,
  Zeffy/Netlify Forms giving, a validator script wired to a GitHub Action.

The skills cite those repos by file and function, so the guidance is checkable
rather than generic.

## Install

```
/plugin marketplace add ofakyle11/scotia
/plugin install superpowers-static-saas@ofakyle-plugins
```

Keep `superpowers` installed alongside it — this plugin narrows it, it does not
replace it.

## What's in it

### Skills

| Skill | Covers |
|---|---|
| `static-saas-stack` | The house architecture, where files live, the non-negotiables, Windows-first local dev, and which `superpowers` skills to substitute |
| `shipping-to-production` | The two-commit rollout, the preflight list, cache delays, and the three rollbacks ranked by speed |
| `netlify-functions` | The `lib/` helpers, CORS allowlist, the `-start`/`-status` split for slow providers, SSRF and prompt-injection guards, webhook signature checks |
| `secrets-and-config` | What is genuinely public vs. secret, why env reads go through `lib/env.js`, blocking internal files with `force = true`, and the revoke-first rotation order |
| `editing-giant-html` | Editing a 500KB file without destroying it; deliberately duplicated headers/footers |
| `json-as-database` | The graceful-degradation data contract, `textContent` over `innerHTML`, the validator as the test suite |
| `operator-docs` | Writing for volunteers and owners working in a browser, not developers |
| `verifying-without-a-test-runner` | What counts as evidence when there is no suite: `node --check`, validators, `netlify dev`, curl, live checks |

### Commands

- **`/preflight`** — the pre-push checklist: syntax, secrets, data validation,
  `netlify.toml` coverage, shared-markup consistency, and a stated rollback plan.
  Ends in GO / NO-GO.
- **`/new-function`** — scaffolds a Netlify Function in house style and tells you
  which env vars to set (and that env changes need a redeploy).
- **`/secrets-audit`** — scans for committed credentials and for internal files
  that are publicly reachable, triaged rather than dumped.

### Agent

- **`deploy-risk-reviewer`** — reviews a diff for this stack's ten real failure
  modes, ordered by blast radius, ending in a push / don't-push verdict.

### Hook

- **`secret-guard`** (`PreToolUse` on `Write`/`Edit`) — pauses for confirmation
  before a high-confidence credential is written to a file. It deliberately does
  **not** flag the Firebase web config, which is public by design here; a guard
  that cries wolf gets clicked through. It fails open on any error.

## What this plugin changes about `superpowers`

| `superpowers` skill | Here |
|---|---|
| `test-driven-development` | No test runner exists. Use `verifying-without-a-test-runner`. Do not scaffold jest into a zero-dependency repo to satisfy a workflow. |
| `verification-before-completion` | Still governs. `verifying-without-a-test-runner` defines what counts as evidence. |
| `finishing-a-development-branch` | Merging to `main` **is** the deploy. Run `/preflight` first. |
| `using-git-worktrees` | Unchanged, and especially useful when editing `app.html`. |

Everything else in `superpowers` applies as written.

## License

MIT
