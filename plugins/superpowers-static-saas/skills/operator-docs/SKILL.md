---
name: operator-docs
description: How to write documentation for the non-technical people who actually run these sites — volunteers and business owners working in the GitHub web UI with no terminal. Use when writing or updating any README, UPDATING, PUBLISHING or ops runbook.
tags: [documentation, writing]
icon: 📘
---

# Writing for the operator, not the developer

Most documentation in these repos is not for an engineer. `UPDATING.md` is for a
foundation volunteer adding a donation. `PUBLISHING.md` is for whoever puts the
site live. The ops runbooks are for the owner at 7am before a demo.

Write for the person who will actually do the task.

## Rules

**Every step must be doable in a browser.** No clone, no terminal, no npm. The
real instruction is *"Open the repository on GitHub, click into `data` →
`tough-mudder.json`, click the pencil icon."* If a task genuinely requires a
CLI, say so up front and give the exact Windows command (`py`, `.bat`, `.ps1` —
see `static-saas-stack`).

**Lead with reassurance about failure.** *"If you break something anyway — don't
panic. The live site never goes blank; worst case it shows 'tracker being
updated' until the fix."* Someone editing a live fundraising page is nervous.
Tell them the blast radius before you tell them the steps.

**State the rules that actually get broken, and why.** The three golden rules in
`UPDATING.md` exist because those three things are what break the file:
keep the double quotes; commas go *between* entries, never after the last one;
don't paste from Word — it turns `"` into `"` and breaks the file.

Name the cause, not just the rule. "Don't paste from Word" without "because it
replaces straight quotes" gets ignored.

**Show the exact line to copy.** Do not describe the JSON shape abstractly:

```json
{ "donor": "Jane D.", "amount": 50, "message": "Go get 'em!", "date": "2026-07-12" },
```

Then say which parts are optional and which are not, in a sentence each.

**Set the time expectation.** *"Wait up to 10 minutes — the website's cache takes
a few minutes to refresh."* Without this, a volunteer concludes it is broken and
edits again.

**Always include a "Fixing a mistake" section.** How to see what they changed,
how to revert it from the GitHub UI, and who to ask.

**Flag anything that needs a human decision, in the document itself.** The
Anderson README does this well — a "Content that needs foundation review"
section that marks drafted copy as *pending board review* and calls out the
unverified contact email with a ⚠. Never let a placeholder quietly look final,
especially one that tells donors where to send money.

## Structure that works here

1. One-line statement of who the doc is for and how long the task takes.
2. Any blocking setup that is not done yet, in a callout at the very top.
   (*"⚠ Pledges only work once the Netlify form email notification is enabled."*)
3. The common task, numbered, with a screenshot-level description of each click.
4. The less common tasks.
5. Fixing a mistake.
6. What is not set up yet / what changes when it is.

## Runbooks are still operator docs

`private/ops/` notes are written for the owner under pressure. Keep them:

- **Sequenced and numbered**, with the safe step first — the two-commit rollout
  in `DEPLOY-INSTRUCTIONS.md` is the model.
- **Explicit about verification.** "Hard-refresh the three pages and verify login,
  owner accounts, basic flows" beats "make sure it works".
- **Ending in a rollback section.** The fastest rollback, stated concretely.

Two hard requirements for anything in `private/`:

1. Add a `force = true` redirect in `netlify.toml` in the **same commit** — see
   `secrets-and-config`. Otherwise the runbook is a public URL.
2. No real passwords or tokens in the text. Reference the env var name and the
   helper script; never the value.

## Tone

Plain, warm, concrete. Bold the thing they must not skip. Say "you" — these are
instructions to a person, not a specification.
