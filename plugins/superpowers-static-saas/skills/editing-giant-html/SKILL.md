---
name: editing-giant-html
description: How to safely change the huge single-file HTML pages in this stack (app.html is ~500KB) and the deliberately duplicated headers and footers across pages. Use before editing any .html file over ~50KB or any markup that appears on more than one page.
tags: [html, refactoring, safety]
icon: 📄
---

# Editing the giant HTML files

`shotb/app.html` is about **500 KB in one file**. `dashboard.html` is 57 KB,
`index.html` 42 KB. These are the deploy artifact — the "golden" files. They
carry markup, inline CSS, and inline JS together.

They are too big to hold in context at once, and rewriting one is how a whole
application disappears in a single commit.

## Rules

**1. Never regenerate the file.** Never read it in full and write it back out.
Never "clean it up while you're in there". Every edit is a targeted string
replacement against text you have just read and confirmed is unique.

**2. Locate before you edit.** Find the anchor first, then edit around it:

```bash
grep -n "functionName" app.html | head
sed -n '12400,12460p' app.html
```

Read the surrounding 40–60 lines. Confirm your anchor string appears exactly
once (`grep -c`). If it appears more than once, widen it until it does not.

**3. Check the size delta afterwards.** This is the cheapest possible check that
you did not truncate the file:

```bash
wc -c app.html    # before and after — the delta should match your edit
node --check <(sed -n '/<script>/,/<\/script>/p' app.html)   # if you touched inline JS
```

A file that shrank by 300 KB when you added a function is a catastrophe caught
in one second. `git diff --stat` should show a handful of changed lines, never
"1 file changed, 9000 insertions, 9000 deletions" — that means the whole file was
rewritten, usually with line endings mangled.

**4. Commit the giant file alone.** One commit, one file, one purpose. It makes
the revert trivial and keeps the diff reviewable.

**5. Consider a worktree for anything exploratory.** `superpowers`'
`using-git-worktrees` skill applies well here: experiment in a worktree so the
known-good `app.html` on your main checkout is never in a half-edited state.

## Duplicated markup is intentional

The Anderson site duplicates its header and footer into every page, marked:

```html
<!-- SHARED HEADER -->
```

This is a deliberate trade — no build step means no template includes. So:

- Editing a nav link means editing it in **every** `*.html`. Enumerate them
  first (`ls *.html`), change all, then verify: `grep -c "new-link" *.html`
  should return the same count for every page.
- Same for `<meta>` tags, canonical URLs, and OG tags during a domain cutover.
- Do not "fix" this by introducing a templating step. The no-build-step rule wins.

## Centralizing duplicated blocks

When the same config or script block appears in several pages, use the
two-commit rollout from `shipping-to-production`:

1. Add the shared file (`js/config.js`) and reference it from each page, leaving
   the old inline blocks in place. Deploy. Verify. This cannot break anything.
2. Only then delete the inline copies, one commit later.

Never remove the old block in the same commit that adds the new one.

## Inline `<style>` in single-purpose documents is fine

`scotia/pricing-sheet.html` is a print-ready one-pager: `@page { size: 8.5in 11in }`,
`print-color-adjust: exact`, everything inline. For a self-contained document meant
to become a PDF, that is correct — do not extract it to a stylesheet. The
"one CSS file" rule (`anderson/css/site.css`) applies to multi-page *sites*.
