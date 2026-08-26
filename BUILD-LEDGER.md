# Chambers build ledger

Running record of the 100-Opus-agent build. Rulings, completions, and evidence.
Protocol upgraded mid-build by applying the `superpowers` skills (fetched from the
public `obra/superpowers` repo — the plugin is enabled on the account but does not
sync into cloud session containers).

## Applied skill protocol (supersedes the plan's SOP where it differs)

**From `subagent-driven-development`:**
- **Per-task review.** Every implementer agent is followed by a *reviewer* agent
  checking spec compliance + code quality against the task's own spec. Implementer
  and reviewer are separate agents with isolated context.
- **Fix rounds with escalation.** Round ≤3: resume/re-dispatch the implementer.
  Round ≥4: fresh implementer. Breaker at round 5 → adjudicate each open finding,
  rule, and continue.
- **Continuous execution.** Do not pause between waves to ask permission. Only four
  things stop the build: an irreversible/destructive operation, a security-sensitive
  action, a side effect outside the working branch that norms say to ask about
  (a merge to main, a publish), or a plan so broken every path forward is a guess.
  Pushing to `claude/attorney-platform-modules-9u1e5r` is pre-authorized by the user.
- **Rulings, not stalls.** Conflicts and ambiguities get decided and logged here as
  `Ruling: <decision> — <why> — <cost if wrong>`.

**From `verification-before-completion` (the Iron Law):**
- No completion claim without fresh verification evidence in the same message.
- **Never trust an agent's success report** — verify from the VCS diff / filesystem.
- Regression tests must be red-green verified, not merely observed passing once.

**From `dispatching-parallel-agents`:** one agent per independent domain, isolated
context, never inheriting session history; disjoint file ownership per wave.

**From `test-driven-development`:** T5's e2e tests are written to fail first against
the current behavior, then pass — no test is accepted that has never been red.

**From `systematic-debugging`:** any red test or security finding is root-caused
before a fix is written; no speculative patching.

---

## Rulings

**R1 — Model pinning is verified at the wire, not assumed.**
Why: workflow subagents inherit the session's *base* model, not the `/model`
selection; three earlier waves silently ran on `claude-opus-4-8` while labelled
otherwise. Cost if wrong: none — the check is cheap and caught a real fallback
during planning. Enforcement: every `agent()` call carries `model: 'opus'`, and a
persistent monitor greps every agent transcript for any model id other than
`claude-opus-5`, flagging agents to redo.

**R2 — Rebuild over verify for the Fable-era files.**
User decision. The rebuild is made productive rather than redundant by folding in
the planning panel's audit findings (wire the orphaned kernel modules, correct doc
drift). Cost if wrong: ~10 agents spent re-deriving working code.

**R3 — No landing page, no self-learning engine.**
User dropped both. Cost if wrong: none; they can be added later.

**R4 — Superpowers skills fetched from source rather than skipped.**
The plugin is account-enabled but absent from this container. Rather than
paraphrase, the real skill text was downloaded and is applied verbatim to the wave
protocol. Cost if wrong: none.

**R5 — T1 is redirected from "rebuild the files" to "fix the defects the contract
sheet proved."**
Why: T0's adversarial assembler verified 17 real cross-room defects in the current
code, several malpractice-grade: (a) `27-desk` detects limitation deadlines via
`ruleId`, which only `21-calendar` writes — so the limitation bar created at intake
**never shows the LIMITATION flag or the dual-diary tick** in the firm-wide diary;
(b) drafts registered in `08-citations` carry no `status`, so they can **never** be
filed by `22-filing`; (c) `regate()` returns `clear` for a draft with zero detected
citations, so an unscannable draft passes the citation gate; (d) `21-calendar`
deletes every `anchor:'trial'` deadline on recompute, destroying other rooms' rows;
(e) citation_instances minted by `07-research` carry no `draftId` and are
permanently unverifiable; (f) three incompatible `authority` shapes render blank
rows with invented weights; (g) `engagementSigned` and `closingChecklist` are
write-only/dead-read; (h) `cite-resolve.js` and `trust.js` remain orphaned while
rooms 08 and 28 re-implement their logic by hand.
Rebuilding these files in isolation would neither find nor fix cross-room defects —
each file passes its own harness today. Fixing proven defects serves the user's
stated intent (Opus quality over the Fable work) far better than re-typing code.
Cost if wrong: the files keep their current structure rather than being re-derived;
every proven defect is still eliminated and every seam verified.

**R6 — Director closes cross-file residuals agents cannot own.**
T1a agents correctly refused to edit files they did not own and reported the gaps
instead (the right behaviour). Three seams therefore had no owner: the zero-citation
warning was invisible in `18-briefs`/`22-filing`; pleadings were never citation-
scannable because `10-pleadings` writes `pleading`, not `draft`; and the billing
agent died mid-response. I closed the first two directly and verified the third's
work survived (161 insertions, syntax valid, harness green). Cost if wrong: small,
localised UI/route changes, all covered by new tests.

**R7 — Behavioural tests, not just harness passes, gate this build.**
Evidence: my own `tocite` route passed `node --check` AND `node test/harness.js
pleadings` while silently returning 404, because it had been inserted into a helper
function instead of `register()`. Only an end-to-end HTTP test caught it. Both new
proofs are promoted into `app/test/` so they run in every future gate.

**R8 — CRITICAL: the app was unusable in a real browser; found only by driving one.**
`Referrer-Policy: no-referrer` (our own security header) causes Chromium to send a
literal `Origin: null` on same-origin form posts. `new URL('null')` throws, so the
router's CSRF origin check crashed and returned **HTTP 500 on every form POST** —
enrollment, sign-in, and every save in all 36 rooms. Nobody could have used the
product. Every fetch()-based test passed because they all set an explicit Origin
header; only a real browser exposes this. Root-cause fix: `Referrer-Policy` is now
`same-origin` (browser sends a real Origin for our own forms, referrer still hidden
cross-origin) and the parse is wrapped so an opaque/unparseable origin is *refused*
(403) rather than crashing (500) — strictly stronger than before, not weaker.
Proven: `test/browser.test.js` drives Chromium through real enrollment and asserts
the app renders; it is now a permanent gate. Cost if wrong: none — the previous
behaviour was a hard crash.

---

## Pending final step (user instruction, 2026-08-26)

**Link `ofakyle11/MattDanLaw` to the Netlify site `chambers-demo-tour` and push.**
To be done AFTER T5 completes. Implementation: commit a `netlify.toml` plus a
repo-resident tour generator so Netlify's *build step* boots Chambers, crawls all
36 rooms, and publishes the static tour — every push then refreshes the demo site
automatically (it currently serves a frozen 25 Aug snapshot). Netlify hosts the
DEMO only; the live application still requires a Node host (Toronto droplet), since
Netlify cannot run a stateful encrypted server.
Two notes for the user at that point: (a) linking a repo to a Netlify site is most
reliably done from the Netlify UI ("Link repository" — it handles the GitHub
install/deploy-key handshake); (b) the API token pasted in chat should be rotated
before or after use, as it has been in plaintext in a transcript.

---

## Completions

| Wave | What | Evidence | Commit |
|---|---|---|---|
| P1 | A–Z analysis, improve+missing slates | `BUILD-ANALYSIS.json` | `10216d9` |
| P2 | 10 improved files, malpractice seams | suite green + `improve.test.js` handshakes | `e4d81d2` |
| P3 | 4 new rooms + 2 kernel engines, 36 rooms | 36-room harness + 9 test files green | `fc55abf` |
| Plan | 10-agent Fable-5 panel → approved blueprint | `PLAN-PANEL.json`, plan approved | — |
| T0 | Contract sheet — 954 lines, 17 cross-room defects proved | `docs/CONTRACT-SHEET.md` on disk, 64KB | `a4553b8`… |
| T1 | 13 Opus-5 agents fixed the proven defects + director closed 3 residual seams | 36-room harness + 8 suites green; new `seam.test.js` and `pleadcite.test.js` prove R-A/R-D and the pleading→gate path | this commit |
