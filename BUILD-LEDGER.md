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

---

## Completions

| Wave | What | Evidence | Commit |
|---|---|---|---|
| P1 | A–Z analysis, improve+missing slates | `BUILD-ANALYSIS.json` | `10216d9` |
| P2 | 10 improved files, malpractice seams | suite green + `improve.test.js` handshakes | `e4d81d2` |
| P3 | 4 new rooms + 2 kernel engines, 36 rooms | 36-room harness + 9 test files green | `fc55abf` |
| Plan | 10-agent Fable-5 panel → approved blueprint | `PLAN-PANEL.json`, plan approved | — |
| T0 | Contract sheet (4 Opus-5 agents) | *in flight* | — |
