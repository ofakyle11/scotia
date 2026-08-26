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

**R9 — The room harness only ever proved EMPTY states; added a seeded harness.**
`test/harness.js` creates one matter and two users and no room records, so
`ALL PASS (36 rooms)` meant only that every room renders with nothing in it. A UI
agent found `15-experts` hard-broken — it called three helper functions that were
never written, so the room returned HTTP 500 for any matter with an expert — while
the suite reported green. `test/seeded.test.js` now populates every major record
type from the contract sheet (facts, deadlines, drafts, citations, documents,
exhibits, time, experts, witnesses, undertakings, offers, waterfalls, judgments,
causes, defences, pleadings, instruments, productions, invoices, client updates,
decision memos, scenarios and more) and renders all 36 rooms plus /admin and
/account, failing on any non-200, error page, or missing shell. Cost if wrong:
none — it is additive and caught nothing outstanding on first run, meaning the
T2b repairs hold.

**R10 — Agent count is a cost, not a virtue, on a 4-CPU box.**
The workflow concurrency cap is `min(16, cpus-2)` = **2** here, so the plan's
~100 agents would have run 2-wide for many hours. T3 ran 12 deep auditors instead
of 40 shallow ones. Evidence it was the right trade: 59 findings, 42 CONFIRMED,
and the auditors themselves refuted and discarded 150 candidates before
reporting. Cost if wrong: fewer eyes on the XSS/injection sweeps, which is why
those domains still got dedicated auditors rather than being folded into others.

**R11 — A container restart is a normal event; workflows must be resumable.**
A restart killed the first T3 wave 9 minutes in. Four auditors had already
persisted results to the workflow journal, so the wave was resumed from cache
(`resumeFromRunId`) rather than re-run, and findings are now extracted to
`docs/SECURITY-FINDINGS.{md,json}` and committed as they land. Cost if wrong:
none — resume is strictly cheaper than re-running.

**R12 — Fix the lie, or fix the code, but do not ship the mismatch.**
The destruction certificate told clients their records were unrecoverable "in
the live store, every replica, and every backup" while `backup.sh` kept 14
nightly copies of the wrapped DEK and the ciphertext. Both halves were addressed:
`shredMatter` now removes the ciphertext (a real strengthening) and the
certificate states plainly that pre-destruction archives still hold the records
until they age out. Where a promise and the code disagree, the *promise* is the
defect — a client relies on it.

**R13 — Two HIGH findings are deliberately NOT fixed, and named rather than
quietly dropped.**
(a) `api.js:41` — state is committed before its audit entry, so an audit-write
failure leaves a persisted but unlogged mutation. Every plausible fix is a
trade (log-before-mutate over-logs actions that then fail; write-ahead needs an
id that does not exist yet) and it touches the write path of all 36 rooms. That
is a design decision with real downside either way, and rushing it at this stage
risks more than it fixes.
(b) The matter's title and client survive destruction in the firm scope. The
certificate must name the matter to be worth producing to a client, so this is a
genuine trade-off. The narrative fields that are *not* needed for that (theory,
ledger memos) carry By-Law 9 retention implications — that is the lawyers' call.

**R14 — The manual pass is an engineering activity, not a formality. It found what
40 auditor-hours did not.**
The 12-agent security audit asked "can an adversary get in?" and answered it well:
59 findings, 42 confirmed, 10 HIGH. It never asked "what does a lawyer do when this
goes wrong on an ordinary day" — and the answer was *nothing*. Writing the owner's
manual honestly forced that question, because a documenter cannot write the
"What it does NOT do" callout without confronting the recovery path. Three lockouts
surfaced, none of which any auditor reported:
(a) a password is written at exactly ONE line in the codebase, from a form with a
single box and no confirmation — a typo at enrolment locked a lawyer out of the
practice permanently, with no reset, no admin override, and no help from the other
seat;
(b) walls could be raised but never lowered, and the screen list included yourself,
so an admin could wall themselves off a matter and then could not see the wall to
lift it;
(c) nothing ever set a user inactive while the seat lock counted active users, so
once both seats enrolled every future invite was refused for the life of the
deployment — a lost authenticator ended it.
Fixed in `79e29e4`, pinned by `test/recovery.test.js` (five paths, each red first).
Lesson worth keeping: a security audit models an attacker; a manual models a user
having a bad day. They find different bugs, and for a two-person firm the second
class is the one that actually ends the deployment. Cost if wrong: none — the fixes
are additive and every recovery path is guarded (no self-release, no lifting the wall
that screens you, current password required).

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
| T2 | 22 Opus-5 agents streamlined the shell + all 36 rooms (2 waves) | 36-room + seeded + browser suites green | `59764fd` |
| T1 | 13 Opus-5 agents fixed the proven defects + director closed 3 residual seams | 36-room harness + 8 suites green; new `seam.test.js` and `pleadcite.test.js` prove R-A/R-D and the pleading→gate path | this commit |
| T3 audit | 12 Opus-5 auditors, 647 turns, all wire-verified `claude-opus-5` | 59 findings / 42 CONFIRMED / 150 refuted, in `docs/SECURITY-FINDINGS.md` | `51c8d68` |
| T3 fix | 8 of 10 HIGH findings fixed, each red-green verified | gate 13 -> 18 suites, all green | `200ac6b`..`8dc1bb1` |
| T5 e2e | 9 Opus agents, one owned suite each, TDD-enforced | gate 18 -> 27 suites; 3 defects found + fixed | `9f7a71d` |
| T4 manual | 9 Opus documenters, 43 surfaces, 104pp PDF | `docs/manual/` + 3 lockouts found and fixed | `79e29e4` |
| Bench | Competence bench: 48-question bar-style bank, key verified 48/48 by 2 independent Opus reviewers (0 flagged, statutes quoted) | `test/barbench.test.js` + live /admin run 44/48 vs Torts-blind stub | `2425e54` |
| R37 | Counsel Panel: doctrine brief across the syllabus + 3 advisers (strategy/risk/duty), policy-checked, audited, unverified-by-default | `test/counsel.test.js` proves order, brief handoff, forbidden-matter no-leak | this commit |
