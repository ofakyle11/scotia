---
name: json-as-database
description: The data contract for JSON files edited by hand by non-technical people and rendered live — every field optional, never a blank page, textContent only, validator plus GitHub Action. Use when changing data/*.json, its shape, or any code that renders it.
tags: [data, resilience, xss, validation]
icon: 🗃️
---

# JSON as the database

`anderson/data/tough-mudder.json` is the live fundraising database. It is edited
by **volunteers, in the GitHub web editor, with no review**. It is rendered
straight onto a public page linked from fundraising material.

That combination sets the whole contract: *a bad edit must never take the site down.*

## Every field is optional. Never render a blank page.

`js/dashboard.js` treats absolutely everything as missing-able, with a defined
fallback for each case:

| Situation | Behaviour |
|---|---|
| Missing or broken `photo` | Generated initials avatar |
| Missing `goal` | Progress bar hidden, everything else renders |
| Missing runner `donateUrl` | Falls back to `event.donateUrl`, then `give.html` |
| Missing `zeffyEmbedUrl` | Pledge form instead of the embed — not a broken iframe |
| Donor empty or `"anonymous"` | Rendered as **Anonymous** |
| `"hideAmount": true` | Counted in totals, displayed as ♥ |
| Amount `"$1,250.00"` | Parsed — `$`, commas and spaces stripped |
| Trailing comma / curly quotes | Auto-repaired, with a `console.warn` |
| File unreadable entirely | Friendly "tracker being updated" panel + a working donate button |

When you add a field, add its fallback in the same change. When you add a
renderer, ask "what does this do if the value is absent, empty, `null`, a string
where a number was expected, or a number where a string was expected?" — and
answer all five.

Auto-repair, never silently: fix the input, then `console.warn` so the problem is
still discoverable.

## `textContent`, never `innerHTML`

Donor names and messages are typed by strangers and pasted by volunteers. They
are inserted with `textContent` so markup cannot be injected. There is no
sanitizer library in this stack and there is not going to be one — the rule is
the defence.

If you need markup around user data, build the elements and set `.textContent` on
the leaf. Never template-string user data into HTML.

## The validator is this project's test suite

`scripts/validate-data.mjs` catches the mistakes volunteers actually make, and
reports them **with line numbers, in plain language**:

- curly quotes from pasting out of Word — the single most common break
- a trailing comma before `]` or `}`
- invalid JSON, with the position mapped back to a line number

`.github/workflows/validate-data.yml` runs it on every push touching `data/**`.

Two design decisions worth preserving:

- **It never blocks the deploy.** GitHub Pages publishes regardless; the Action
  emails the committer. A volunteer must never be locked out of fixing a typo by
  a red check.
- **Error messages address a non-developer.** *"Line 43: extra comma before a
  closing bracket — remove the comma after the last entry in the list."* Not
  `Unexpected token }`. When you add a check, write the message the same way.

Extend the validator whenever you add a required-ish field or a new common
failure mode. That is what "adding a test" means in this repo.

## Keep the file editable by humans

- Leave the `_readme` key at the top pointing at `UPDATING.md`. It is the first
  thing a volunteer sees.
- Keep the `"updated"` date field and remind people to bump it.
- Newest entries go at the **top** of a list — that is what `UPDATING.md` teaches
  and what the copy-the-line-above workflow depends on.
- Plain numbers for amounts (`50`, not `"$50"`), even though the parser tolerates
  both.
- Do not reorder or restructure the file for tidiness. Volunteers navigate it by
  Ctrl+F and muscle memory.

## Forward compatibility with automation

The shape was chosen so a future webhook → Cloudflare Worker → GitHub commit
pipeline writes *the same format volunteers write by hand*. Any schema change has
to stay hand-editable. If a change would only be reasonable for a machine to
produce, it is the wrong change.

## Caching

GitHub Pages' CDN caches the JSON for about **10 minutes**. A change that "did
not work" usually did work. Say so when reporting: wait it out and hard-refresh
before debugging.
