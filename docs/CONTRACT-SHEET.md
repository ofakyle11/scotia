# Chambers — CONTRACT SHEET

Authoritative cross-room reference for `/home/user/scotia/app`. Every claim below was
verified by reading the actual source (rooms/, kernel/, server.js) — not inferred from
names. **Read this before you touch any room.**

**Last verified against commit `aec1370` on 2026-08-26** — every claim below was re-read
against `app/rooms/*.js`, `app/kernel/*.js` and `app/server.js` as they stand at that commit
(`git status` clean for all three at the time of writing). Waves T1 and T2
changed real behaviour after this sheet was first written; §(b) `draft`, `pleading`,
`citation_instance`, `authority`, `deadline`, `closingChecklist`, §(c) `engagementSigned`,
§(d) the kernel facade and §(f) were re-derived from the current source at that commit. Line
numbers cited below are from that commit and drift — trust the function/route names.

---

## (a) How to use this sheet

You are one of ~100 agents editing this codebase in parallel. Your room is one file
(`rooms/NN-id.js`) and it talks to every other room *only* through record types in
encrypted storage. This sheet is the schema contract for those types. Before you write
a `put()`, find the type here and match the **exact field names and value domains** the
existing writers use — a reader in another room will index your record by those keys and
render blanks or crash if you invent a variant. Before you read a type, check its
**Written by** list: several types have two or three incompatible creation shapes and you
must handle all of them (or filter). Where this sheet says **GATE**, that behaviour is a
professional-responsibility control (conflicts clearance, citation verification, dual
diary, trust accounting, admission foundation) — you may *strengthen* it, never weaken,
bypass, or silently widen it. Where it says **CONFLICT**, two rooms already disagree;
do not "fix" it by changing one side unilaterally unless your task is exactly that, and
if you do, update every reader named here. Where it says **RESOLVED (was a CONFLICT)**, a
disagreement this sheet once recorded has been closed in code — the note stays only so the
next agent does not "re-fix" it or re-introduce the old shape; §(f) carries the same list.
`/home/user/scotia/app/CONTRACT.md` remains the module contract (export shape, allowed
requires, honesty rules); this sheet is the data contract that sits underneath it. The two
are currently in agreement — where they ever diverge, re-derive both from the source rather
than trusting either.

---

## (b) MATTER-SCOPE RECORDS

Storage: `ctx.kernel.scope(matterId).list|get|put|del(type, …)` — AES-256-GCM per-matter
log. Every record automatically carries, from `kernel/store.js` `Scope.put()`:

| field | set when |
|---|---|
| `id` | first put only (uuid) — unless the caller supplies one |
| `createdAt`, `createdBy` | first put only (`createdBy` = user id) |
| `updatedAt`, `updatedBy` | **every** put |

Never hand-set `id` except the three deliberate singletons: `gateStamp` (id = draftId),
`trialChecklist` (id `'checklist'`), `closingChecklist` (id `'closing'`).

### Build / narrative

#### `fact` — the chronology
**Fields** `date` (`YYYY-MM-DD`) · `actor` (default `'Unattributed'`) · `text` · `source`
(the pin) · `disputed` (bool) · `issues` (string[] from comma split)
**Written by** 06-chronology (`POST /add`, `/dispute` toggles `disputed`, `/del` removes)
**Read by** 06-chronology (list/get) · 10-pleadings (list for element mapping; `get` in
`POST /link`) · 14-depositions (list in `POST /pull` matching `f.actor` to witness name;
`get` in `POST /digest` for `contraFactId`) · 26-closing (EXPORT_TYPES)
**Invariants**
- **GATE — SOURCE-OR-DROP.** `06-chronology.js` `POST /add` (l.183) refuses with a flash when `source`
  is empty. No fact enters without a pin. Also refuses empty `text` and any `date` not
  matching `/^\d{4}-\d{2}-\d{2}$/` that also parses.
- Gap detection (>90 days between consecutive facts) is computed on the **full** timeline
  and suppressed while a filter is on — a filter must never invent a gap.
- 10-pleadings `POST /link` refuses to map a cause element to anything that is not an
  existing `fact` id in this matter.

#### `cause` — pleaded causes of action (10-pleadings)
**Fields** `setId` (reference cause id, `null` for custom) · `label` · `jur` · `ref` ·
`elements` (`[{key,label}]`) · `side` · `against` · `mapping` (`{elementKey: [factId,…]}`)
**Written by** 10-pleadings (add cause, `/addelement`, `/delelement`, `/link`, `/unlink`;
`/delcause` deletes) · **Read by** 10-pleadings only
**Invariants** duplicate reference cause refused per `(setId, side, against)`; element
label unique per cause (case-insensitive); deleting an element deletes its mapping entry;
a custom cause starts with **zero** elements and a ref that says counsel must supply the
authority. **GATE:** an element may only be linked to a real `fact` in this matter.

#### `affdefence` — affirmative defences (10-pleadings)
**Fields** `name` · `cite` · `basis` · `pleaded` (bool)
**Written by** 10-pleadings (`/defence`, `/defence-plead`; `/deldefence` deletes) ·
**Read by** 10-pleadings only. Duplicate names refused (case-insensitive).
`pleaded:false` is a waiver-risk state and is rendered as such.

#### `pleading` — pleading drafts (10-pleadings)
**Fields** `title` (required) · `ptype` (`'claim'|'defence'|'counterclaim'|'crossclaim'`,
whitelist-coerced to `'claim'`) · **`body`** (the text — *not* `text`, *not* `sections`)
**Written by** 10-pleadings `POST /draft` · **Read by** 10-pleadings only
**A pleading is still not a `draft` — but it can now be REGISTERED as one.**
`10-pleadings POST /tocite` (l.461) mints a companion `draft`
`{title, type: p.ptype || 'pleading', text: p.body, status:'draft', citeStatus:'unchecked',
pleadingId: p.id}` — the same shape 08-citations registers, so `draftText()` extracts it,
18-briefs can take it to `final` and 22-filing can then file it. The link is one-way: `pleadingId` lives on the
**draft**, never on the pleading, and 10-pleadings reads the gate back with
`s.list('draft', (d) => !!d.pleadingId)` keyed by `d.pleadingId` (l.151).
**Invariants**
- **RE-SEND RESETS THE GATE.** A second `/tocite` on the same pleading updates the existing
  companion draft (`text`, `title`) and forces `citeStatus:'unchecked'`, `scannedAt:null`,
  and `'final'→'draft'` — the same counter-current 18-briefs applies to a section edit.
  Never re-send without expecting the clearance to drop.
- 26-closing exports `draft` and `citation_instance`, **not** `pleading` — the pleading text
  reaches a transfer bundle only through its companion draft.
- **GOTCHA** — `POST /deldraft` deletes the `pleading` and leaves the companion `draft`
  standing (with a `pleadingId` pointing at nothing). It still sits on 08's gate board and in
  18-briefs. Delete it there if it is genuinely dead.

### The citation gate

#### `draft` — briefs and registered drafts. **THREE CREATION SHAPES, ONE COMPATIBLE CORE.**
| | 18-briefs `POST /new` | 08-citations `POST /draft` | 10-pleadings `POST /tocite` |
|---|---|---|---|
| `title` | yes | yes | the pleading's title |
| `type` | `'motion'\|'factum'\|'brief'\|'letter'` (unknown → `'brief'`) | — | `pleading.ptype` or `'pleading'` |
| `sections` | `{}` at creation; keys `conclusion, rule, explanation, application, counter, closing` | — | — |
| `text` | — | the pasted body | `pleading.body` |
| `status` | `'draft'` | **`'draft'`** | **`'draft'`** |
| `citeStatus` | `'none'` | `'unchecked'` | `'unchecked'` |
| `court`, `wordLimit` | `''` | — | — |
| `pleadingId` | — | — | the `pleading` id |

`status` values in use: `'draft' | 'cite-check' | 'final'` — set at creation by all three
writers and moved only by 18-briefs `POST /status` (and reset by 18-briefs `/save` and
10-pleadings `/tocite`).
Added later by 08-citations: `scannedAt` (date-only from `runScan`, or `null` when
10-pleadings re-sends), `citeStatus` overwritten to `'clear'|'blocked'` and
**`noCitationsFound` (bool)** stamped by `regate()`.
**Written by** 18-briefs (`/new`, `/save`, `/status`) · 08-citations (`/draft`, `runScan`,
`regate()`, `/add`) · 10-pleadings (`/tocite`) · 07-research (`/send`, **blocking direction
only** — see `citation_instance`)
**Read by** 18-briefs (list/get) · 08-citations (list/get; **auto-extracts on GET** for
any draft with `status==='cite-check' && !scannedAt`, and **re-gates defensively in the
blocking direction only** for any draft reading `'clear'` whose instances are not all
verified) · 19-moot (list/get; `POST /ai-oppose` reads `d.sections` only) · 22-filing (list
filtered `citeStatus==='clear' && status==='final'`; `get` in `POST /prepare`) ·
07-research (list — the draft selector on the send-to-gate form) · 10-pleadings (list
filtered `!!d.pleadingId`) · 26-closing (EXPORT_TYPES)
**Invariants**
- **THE GATE.** `08-citations.js` `regate()` (l.90) sets `citeStatus='clear'` iff **every**
  `citation_instance` with that `draftId` has `status==='verified'`, else `'blocked'`.
  Observed values across the codebase: `'none'`, `'unchecked'`, `'clear'`, `'blocked'`.
- **Empty-set caveat, now STAMPED.** `inst.every(...)` on zero instances is `true`, so a
  scanned draft with no detected citations regates to `'clear'`. That is still allowed (a
  citation-free document exists) but it is no longer silent: `regate()` writes
  `noCitationsFound: inst.length === 0` onto the draft, and every surface that shows the gate
  carries the warning — 08's board/queue/certificate (`noCitesFound(d, inst) = d.noCitationsFound
  === true || (!!d.scannedAt && inst.length === 0)`, robust to rows predating the flag),
  18-briefs' `clear — none found` tag, and 22-filing's `[no citations detected]` draft label.
  **A new reader of a `'clear'` draft must check `noCitationsFound` before treating the
  clearance as meaningful.**
- **A registered draft has no `sections`.** 19-moot `POST /ai-oppose` reads `d.sections` only
  and refuses an 08- or 10-registered draft with "no content to attack yet". 18-briefs and
  08-citations both fall back to `text`/`body`; 19-moot does not.
- 22-filing `POST /prepare` refuses unless `citeStatus==='clear'` **AND** `status==='final'`.
- 18-briefs `POST /status status=final` refuses unless `citeStatus==='clear'`.
- **EDIT RESETS THE GATE.** 18-briefs `POST /save` diffs the six section strings; if any
  changed it sets `citeStatus='none'` and demotes `'final'→'draft'`. Metadata-only edits
  (court, wordLimit) leave a cleared final draft alone.
- **STALENESS.** `isStale(d, at) = !!d.scannedAt && !!at && String(d.updatedAt) > String(at)`
  where `at` comes from the companion `gateStamp`. The certificate test is
  `isClear(d, inst, stale) = !!d.scannedAt && !stale && inst.every(verified)` — a stale
  draft is refused a certificate even when every instance reads verified.
- `draftText(d) = d.text || d.body || Object.values(d.sections).filter(Boolean).join('\n\n')`.
  It **must** read all three or a Brief-Writer sections-draft extracts as empty and sails
  through the gate. 18-briefs mirrors it with `wordsOf(d) = words(sectionText(d) ||
  d.text || d.body)` so a registered draft prints and counts its real body.
- **RESOLVED (was a CONFLICT): every writer now sets `status`.** 08-citations `/draft` and
  10-pleadings `/tocite` both stamp `status:'draft'`, so a registered draft can reach
  `'final'` through 18-briefs and be filed. **A new writer of `draft` must set `status` and
  `citeStatus`** — a draft with neither is invisible to 22-filing and renders `no status` in
  18-briefs.

#### `gateStamp` — the anti-loophole stamp
**Fields** `id` (**set explicitly to the draftId**) · `at` (draft's `updatedAt` at the
moment `regate()` ran)
**Written by / Read by** 08-citations only (`regate()` / `stampAt()`).
One stamp per draft; `put` overwrites in place. Its whole purpose is closing the
verify → edit → certify loophole.

#### `citation_instance` — **TWO WRITERS, ONE GATE-COMPATIBLE SHAPE.**
| | 08-citations (draft-gate) | 07-research `POST /send` |
|---|---|---|
| `cite` | yes | yes |
| `draftId` | yes | **yes — REQUIRED, the route refuses without it** |
| `status` | `'unverified'\|'verified'\|'failed'` | `'unverified'` |
| `source` | — | `'research'` |
| `pinpoint`,`quoteOk`,`treatmentCurrent`,`resolved` | `''`/`null` at mint | same, `''`/`null` at mint |
| on verify | `+resolvedUrl, failReason:null, checkedBy, checkedAt` | (verified in 08 like any other) |
| on fail | `+failReason, checkedBy, checkedAt` | (failed in 08 like any other) |
| `court`,`year`,`memoId`,`authorityId` | — | yes |
| `lookup` | `{resolved, source, title, url, note, at, by}` from `POST /resolve` | — |

**Written by** 08-citations (`runScan`, `/add`, `/verify`, `/fail`, `/reopen`, `/resolve`) ·
07-research (`POST /send`)
**Read by** 08-citations · 18-briefs (filtered `c.draftId === d.id` → table of
authorities) · 07-research (filtered `c.source==='research' && c.status==='unverified'`
→ the "awaiting citation check" count; and filtered by `(draftId, cite)` in `POST /send` to
honour 08's duplicate guard from the other side) · 26-closing (EXPORT_TYPES)
**Invariants**
- **GATE — ALL FOUR OR NOTHING.** `POST /verify` refuses unless a non-empty `pinpoint`
  is supplied **and** `resolves==='1'` **and** `quoteOk==='1'` **and** `treatment==='1'`.
  No partial verification; the alternative is `POST /fail`.
- Nothing machine-verifies. Every transition to `'verified'` records
  `checkedBy = ctx.user.name`.
- Duplicate guard: `runScan` and `/add` skip a cite already on that `draftId`
  (case-insensitive on `cite`).
- `POST /reopen` resets a failed instance to a clean `'unverified'` (nulls pinpoint,
  quoteOk, treatmentCurrent, resolved, resolvedUrl, failReason).
- **Every write path must call `regate(s, draftId)` immediately afterwards.** The one
  deliberate exception is `POST /resolve`, which writes only the advisory `lookup` field:
  calling `regate()` there would re-stamp `gateStamp` and wash out a staleness flag nobody
  re-verified.
- **`lookup` IS NOT A VERIFICATION.** `POST /resolve` runs the cite through
  `k.citeResolve.resolve` (see §d) and records what came back beside the row. It never
  touches `status`, `resolved`, `quoteOk` or `treatmentCurrent`, and it refuses an
  already-`'verified'` instance. Only an `/^https?:\/\//i` URL is stored (the value is
  re-rendered as a link and `esc()` does not neutralise `javascript:`). The route is absent —
  degrading to the manual flow — when the facade does not expose `citeResolve`.
- **RESOLVED (was the sharpest CONFLICT in matter scope): 07-research now always supplies
  `draftId`.** `POST /send` carries a draft selector with no default and **refuses** a blank
  one, so no instance can be minted that `regate()` cannot count and no one can verify. It
  also honours 08's per-`(draftId, cite)` case-insensitive duplicate guard by linking the
  authority to the existing instance instead of minting a second row, and — because a room
  may not require another room's `regate()` — moves the draft in the **blocking direction
  only** (`citeStatus:'blocked'`, `noCitationsFound:false`, audited `research.gate.blocked`).
  It never opens a gate. 08-citations' GET re-gates defensively in the same one direction.

### Research

#### `authority` — **THREE SHAPES, EACH STAMPED AND EACH READ BACK ONLY BY ITS OWN ROOM.**
| | 07-research | 29-canlii | 30-uscourts |
|---|---|---|---|
| `cite` | yes | yes | `citation \|\| caseName` |
| `memoId` | yes | — | — |
| `proposition` | yes (required) | — | — |
| `weight` | `'binding'\|'persuasive'` | — | — |
| `adverse` | bool | — | — |
| `court` | yes | `= databaseId` | yes |
| `year` | 4-digit string or `''` | — | — |
| `checkId` | citation_instance id once sent, else `null` | — | — |
| `draftId` | the draft it was sent against, else `null` | — | — |
| `title`,`url`,`decisionDate` | — | yes (+`docket`) | yes |
| `source` | **`'research'`** | `'canlii-api'` | `'courtlistener'` |
| `resolved` | — | `true` | `true` |

**Written by** 07-research (`/authority`, `/send` sets `checkId` + `draftId`, `/drop`
deletes) · 29-canlii (`POST /resolve`, only when a matter is open) · 30-uscourts
(`POST /save` when `kind !== 'r'`)
**Read by** 07-research (filtered `isOurs = (a) => !a.source || a.source === 'research'`) ·
29-canlii (filtered `source==='canlii-api'`) · 30-uscourts (filtered
`source==='courtlistener'`)
**Invariants**
- **EVERY WRITER STAMPS `source`, AND EVERY READER FILTERS ON IT.** A new writer that omits
  `source` is silently adopted by 07-research's `isOurs` (the deliberate fallback for rows
  written before the stamp existed) and will render there with a blank proposition. Stamp it.
- 07-research refuses an authority without both `cite` and `proposition`, and rejects a
  `year` that is not exactly four digits.
- **CANDOUR:** adverse authorities render **first** on the Research Desk (`byAdverseFirst`).
- `POST /send` refuses if `a.checkId` is already set (no double-send), **and refuses a
  connector row outright** (`!isOurs(a)`) — a CanLII/CourtListener authority must be re-entered
  under a memo with the proposition it stands for before it can reach the gate. That is what
  stops an instance being minted with `memoId: undefined`.
- `/drop` deletes the authority and **deliberately leaves its `citation_instance` standing** —
  dropping a row here must never be a way to make a blocked draft clear itself.
- **RESOLVED (was a CONFLICT):** 07's list is no longer unfiltered. Connector rows are counted
  on the desk-state card and pointed at their own rooms, never rendered as weighed research.

#### `memo` (07-research)
**Fields** `issue` (required) · `conclusion` (may be `''`). Written/read by 07-research only.
`POST /conclude` refuses an empty conclusion rather than blanking an existing one.
Every `authority` points at a memo via `memoId`; `/authority` refuses an unresolvable memoId.

### Calendar / deadlines

#### `deadline` — **the most widely shared type in the app.**
**Core shape (all writers)** `desc` · `due` (ISO) · `rule` (**citation STRING**, e.g.
`rule.cite`, `'expert report'`, `'ADR schedule'`, `'By agreement / manual'`,
`'Trial date (anchor)'`) · `trigger` (human string) · `status` (`'open'|'done'`)
**`ruleId` — now written by EVERY writer.** It is a `kernel/rules.js` rule id, or an explicit
`null` meaning "counsel typed this date, no rule computed it". **Never a placeholder** — an
id that resolves to no rule on file reads as a rule that is not there. Readers must handle
all three states: an id, an explicit `null`, and **absent** on rows written before the field
was universal.
**Other extra fields, by writer**
- `source:'trial-cascade'`, `anchor:'trial'`, `milestone`, `trialDate` — only 21-calendar's cascade
- `stale`, `staleReason`, `staleFrom`, `staleTo`, `staleAt`, `staleLimitation`,
  `staleClearedAt` — only 09-jurisdiction
- `verifiedBy`, `verifiedById`, `verifiedAt` — only 27-desk

**Written by**
| room | route | notes |
|---|---|---|
| 01-intake | `POST /decide` accept | limitation deadline from `inq.limitation`; `rule: inq.limCite \|\| limRule.cite \|\| 'limitation'`; **`ruleId` set from `inq.limRuleId` (or the claim-type lookup that produced it) when it resolves to a real rule — otherwise the field is omitted, never faked** |
| 12-discovery | `POST /new` | only when a due date exists; `rule: dueCite \|\| 'By agreement / manual'`; **`ruleId` = the computing rule's id, explicit `null` on the typed fallback**; the new deadline's id is stored back on the instrument as `deadlineId` |
| 15-experts | `/new`, `/due`, `/disclosure` | `rule:'expert report'` (**`ruleId: null` by design** — no rules.js rule computes a report date) or the disclosure rule cite with `ruleId` = that rule's id **only if `k.rules.rule(id)` resolves**; ids stored on the expert |
| 21-calendar | `/compute`, `/trial`, `/done` | `putDeadline(s, ruleId, fields)` takes `ruleId` **positionally** so no path can forget it: `/compute` → `rule.id`; `/trial` → `'trial-date'` and `'trial-back-<key>'`. Sole writer of `anchor` and `source:'trial-cascade'` |
| 23-adr | `POST /session` | brief-due; `rule:'ADR schedule'`; **`ruleId: null` by design** (a provider's schedule, not a rule); not linked back to the session |
| 09-jurisdiction | `/govern`, `/recompute-clear` | **updates existing records only** |
| 27-desk | `POST /verify` | **updates existing records only** |

**Read by** 21-calendar (list/get) · 27-desk (cross-matter diary, `status==='open'`) ·
09-jurisdiction (list `status!=='done'`; get for recompute-clear) · 36-portal (list
`status==='open'` → next 3 key dates in the client pack) · 15-experts (get by
`expert.deadlineId` / `expert.disclosureDeadlineId`) · 12-discovery (get by
`instrument.deadlineId`; `POST /respond` closes it `status:'done'`) · 21-calendar ICS feed
`/r/calendar/feed/:token` (list `status==='open'` across all visible matters) · 26-closing
(EXPORT_TYPES)
**Invariants**
- **21-calendar `POST /trial` is destructive-idempotent, and sweeps STRICTLY by `source`.**
  It `del`s every deadline with `source === 'trial-cascade'` — the marker it stamps on its
  own rows — and **never** by `anchor`, because another room's deadline hung off the trial
  date carries `anchor:'trial'` too and was being destroyed silently on every recompute. A
  trial-anchored row without the cascade stamp is left alone and rendered
  `not cascade-managed` in the diary. **If you write a trial-anchored deadline, set
  `anchor:'trial'` and do NOT set `source:'trial-cascade'`** — that stamp means "21-calendar
  owns this row and will delete it".
- **GATE — DUAL DIARY.** 27-desk `POST /verify` refuses when `ctx.user.id === d.createdBy`
  and refuses a second verification once `d.verifiedBy` is set.
- 09-jurisdiction `POST /govern` flags **every** deadline with `status!=='done'` stale when
  the matter's jurisdiction changes.
- 21-calendar `/trial` and `/bf` round-trip the date through `Date` so `'2026-02-31'` is
  rejected rather than rolled forward.
- **RESOLVED (was the most consequential CONFLICT in the app): the LIMITATION flag no longer
  keys off `ruleId` alone.** 27-desk `classify(k, d, rx, category)` (`27-desk.js:26`) matches
  on **any** of (a) the `ruleId` string, (b) `rule + desc` — the citation string and
  description every writer sets — or (c) the rules.js record standing behind the id (its
  `category`, else its own `desc + cite`). `LIMITATION_RX` and `APPEAL_RX` are
  case-**insensitive** by necessity: 01-intake stores `desc:'Limitation period expires'` and
  cites such as `'Limitations Act, 2002, s. 4'`, which a case-sensitive `/limitation/` misses
  entirely. (The appeal watchdogs differ room by room — see `judgment` below.)
- 09-jurisdiction keeps its own three-way fallback (`staleLimitation` → `k.rules.rule(ruleId)`
  category → regex over `rule + desc`) — near-identical, but its regex is still
  case-**sensitive**, so a hand-written row with no resolvable `ruleId` and only
  `'Limitation period expires'` on it classifies in 27-desk and not in 09. Harmless today
  (01-intake now carries a real `ruleId`); do not widen the gap.
- **`rule` is a citation STRING, `ruleId` is a rules.js id — they are not interchangeable.**
  Both are now written by every writer, but `ruleId` may legitimately be `null` or absent.
  **Never assume `ruleId` resolves**; go through `k.rules.rule(id)` and handle `undefined`.

#### `bf` — bring-forward tickler (21-calendar)
**Fields** `note` (required) · `due` (round-tripped ISO) · `owner` (`ctx.user.id`) ·
`status` (`'open'|'done'`)
**Written by** 21-calendar (`/bf`, `/bf-done`) · **Read by** 21-calendar · 27-desk
(cross-matter BF list) · the ICS feed (`CATEGORIES:BRING-FORWARD`, summary prefixed `BF:`)
· 26-closing
**Invariant** a BF is a tickler, never a court date. Separate type, separate list, tagged
BF on the phone feed, deliberately excluded from the limitation diary. **Do not merge it
into `deadline`.**

#### `trialAnchor` (21-calendar)
**Fields** `trialDate` · `jurisdiction` (matter's jur at compute time) · `setBy` (user id)
**Singleton by `list('trialAnchor')[0]`** then spread-and-re-put. Setting it drives the
whole cascade; back-calculated milestones use `k.rules.compute` with a **synthetic
negative-offset rule** so they get the same weekend/holiday roll as forward ones.
Firm-default milestones are labelled "firm default"; FRCP-fixed ones cite the rule.
Never present a firm default as statutory.

#### `judgment` (25-judgment)
**Fields** `amount` (>0) · `rate` (post-judgment interest %, ≥0) · `dateEntered` (ISO,
required) · `court` · `debtor` (required) · `recovered` (starts 0) · `satisfied` (bool)
**Written by** 25-judgment (`/new`, `/payment`) · **Read by** 25-judgment · 21-calendar
(appeal-clock watchdog card) · 27-desk (cross-matter appeal alarms) · 26-closing
**Invariants** interest is computed never stored:
`accrued(j) = amount * rate/100 * days_since_entered/365` (simple). `satisfied` derived
per payment: `owing = amount + accrued − recovered; satisfied = owing <= 0.005`. A recovery
posts a balanced ledger entry **before** the judgment is updated.
**APPEAL-CLOCK WATCHDOG — THREE ROOMS, THREE TESTS, ONE MEANING.** A matter with ≥1 judgment
and no open appeal deadline raises an UNCALENDARED alarm in 21-calendar (its own matter),
25-judgment (its own matter) and 27-desk (cross-matter). What counts as "an appeal deadline"
differs and the difference matters:
- **27-desk** — `classify(k, d, /appeal/i, null)`: `ruleId` **or** `rule + desc` **or** the
  rules.js record behind the id. The broadest, and the one to copy.
- **25-judgment** — `/appeal/i` over `ruleId + rule + desc` (`25-judgment.js:58`), so a
  hand-written `'Notice of appeal due'` counts.
- **21-calendar** — still `String(d.ruleId || '').includes('appeal')` alone
  (`21-calendar.js:104`), and case-sensitively. A hand-written appeal date with no `ruleId`
  silences 25 and 27 but **not** 21, which keeps offering to compute one. Not a defect (it
  errs toward calendaring), but know why the three cards disagree.
Rule ids that satisfy all three: `on-appeal`, `usfed-appeal`, `usfed-appeal-usparty`,
`ny-appeal`, `cafed-appeal` — written only by 21-calendar `/compute`.

#### `enfStep` (25-judgment)
**Fields** `judgmentId` · `step` (whitelist: demand letter · garnishment · writ of seizure /
judgment lien · examination in aid of execution · domestication (other jurisdiction)) ·
`started` (today) · `status:'active'`
No code path ever moves `status` off `'active'` — there is no completion transition yet.

### Documents / evidence / production

#### `document` — **TWO SHAPES.** Body text lives in `k.blob` under `blobId`.
| | 13-review `POST /add` (paste) | 13-review `POST /eml` |
|---|---|---|
| `title`,`custodian`,`date`,`blobId`,`bates` | yes | yes (`custodian` = From) |
| `privilege` | `'none'\|'solicitor-client'\|'litigation'` | `'none'` |
| `responsive` | `'yes'\|'no'` | `'no'` |
| `issues` | string[] | `[]` |
| `author`,`recipients`,`privDesc` | yes | **absent** |
| `source` | — | `'eml'` |
| `from`,`to`,`sentAt` | — | yes (`sentAt` full ISO or null) |

`dateCreated` is consulted by `createdOf()` in 13/33/35 but is **never written** by any room.
**Written by** 13-review only (`/add`, `/code`, `/eml` — one record per message plus one
per attachment)
**Read by** 13-review (list/get; `/doc/:id` decrypts the blob) · 16-evidence (an exhibit may
link a document by id) · 33-production (producible / withheld sets, `get` for the load file)
· 35-affidavit (Schedule A/B partition) · 26-closing (**metadata only**: id, title, bates,
custodian, date, privilege, issues, createdAt — blob text never enters the transfer bundle)
**Invariants**
- Bates are monotonic per matter: `nextBates()` scans existing docs for `/^DEF-(\d{6})$/`
  and takes max+1, zero-padded to 6. Attachments each get their own bates, recomputed after
  each put.
- Document plaintext **never** rides in the record — only `blobId`. 13-review decrypts at
  request time and `esc()`s before display.
- 33-production and 35-affidavit encode the **same** partition and it must stay identical:
  `isWithheld = privilege !== 'none'` wins over responsive; `isProducible = responsive==='yes'
  && privilege==='none'`. A doc is either produced or on the privilege log, never both;
  not-responsive + not-privileged appears in neither.
- EML hard caps refuse **before any write**: `EML_MAX_PARTS=1000`,
  `EML_MAX_ATTACHMENTS=100`, `EML_MAX_ATTACH_BYTES=25MB` — an over-limit message persists
  zero blobs and zero records.
- **CONFLICT** — the two shapes disagree on author/recipients/date. 13-review, 33-production
  and 35-affidavit each define, identically and locally:
  ```js
  const privOf = (d) => d.privilege || 'none';
  const respOf = (d) => (d.responsive === 'yes' ? 'yes' : 'no');
  const authorOf = (d) => d.author || d.custodian || '';
  const recipientsOf = (d) => d.recipients || d.to || '';
  const createdOf = (d) => d.dateCreated || d.date || '';
  ```
  **Any new reader must copy this chain verbatim** or it shows blanks for `.eml` documents.

#### `exhibit` (16-evidence)
**Fields** `side` (`'P'|'D'`) · `number` (`'P-1'`, assigned per side) · `description` ·
`witness` · `foundation` · `hearsay` · `documentId` (a `document` id in this matter, or `''`)
· `status` (`'listed'|'offered'|'admitted'|'refused'`)
**Written by** 16-evidence (`/add`, `/status`) · **Read by** 16-evidence · 20-trialbook
(count only, readiness card). Not in EXPORT_TYPES.
**Invariants** numbering `n = count(side) + 1`; never reused within a side, no gap-proofing
if one is ever deleted. **GATE:** `POST /status` refuses `'admitted'` unless **both**
`foundation` and `witness` are non-empty. `documentId` is validated on write (unresolvable
→ stored as `''`); a later-removed document renders a "doc removed" tag.

#### `inLimine` (16-evidence)
`target` (required) · `ground` (required) · `status` whitelist
`['draft','filed','granted','denied']`, anything else silently ignored.

#### `production` (33-production)
**Fields** `volume` (`'PROD001'`, `max(/^PROD(\d{3,})$/)+1`) · `batesStart` · `batesEnd` ·
`recipient` (required) · `servedDate` (default today) · `documentIds` (bates-sorted
producible set) · `withheldIds` (privilege-log set) · `status:'served'`
**Invariants** refuses without a recipient and when nothing is coded responsive +
not-privileged. **A volume is a FROZEN snapshot of ids at assembly time** — later re-coding
in 13 does not change what was produced. Every assembly writes an immutable `k.audit` line
(volume, recipient, date, doc count, bates range, withheld count). Load files (Concordance
`.dat` with ASCII 254 qualifier / ASCII 20 delimiter, plus an Opticon `.opt` stub) are
generated on demand from stored ids — never stored.

#### `affidavitMeta` (35-affidavit)
`deponentName` (required) · `capacity` · `swornPlace` · `swornDate` (sliced to 10).
Read via `loadMeta()` — newest by `createdAt` wins; existing record is spread-and-merged so
partial updates preserve earlier fields. **Blank particulars stay blank** — rendered as
blanks to fill in on the sworn copy, never invented.

#### `scheduleC` (35-affidavit)
`description` (required) · `docDate` · `lostWhenHow` · `presentLocation`.
Schedule C is the only hand-entered schedule — A and B are derived live from room 13 coding
and are **not** stored.

### Discovery / depositions / experts

#### `instrument` (12-discovery)
**Fields** `type` (`'rfp'|'rog'|'rfa'|'undertaking'|'ntp'`) · `direction`
(`'outbound'|'inbound'`) · `party` · `served` (ISO, required) · `due` (rule-computed, else
the typed fallback, else null) · `dueCite` (rule citation or null) · `status`
(`'open'|'responded'`), `respondedAt` · `items` (`[{n, text, answered:boolean}]`) ·
`objections` (`[{basis, boilerplate:boolean, at}]`) · `deadlineId` (id of the companion
`deadline`, or explicit `null` when no due date was set; **absent** on rows written before the
field existed)
**Invariants** `due` is computed from the jurisdiction's rule via `k.rules.compute` where one
matches; only if no rule matches is the typed `due` used. A non-null `due` also mints a
companion `deadline`, **whose id is stored back on the instrument as `deadlineId`** — the
deadline is minted first at `POST /new` so the id exists before the instrument is written
(same discipline as `expert.deadlineId`). `POST /respond` closes **that** deadline
(`status:'done'`) as it marks the instrument responded, so an answered instrument never leaves
its response date standing open in 21-calendar, 27-desk and the 36-portal client pack. A
legacy instrument with no `deadlineId` has one **adopted** only where the match is unambiguous
in both directions — exactly one still-open, unclaimed deadline carrying this room's exact
`desc`/`trigger`/`due` signature, and no other unlinked instrument sharing that signature;
adoption heals the row by storing the id. Otherwise nothing is guessed: the instrument is
still marked responded and the room says the diary entry must be closed by hand.
**BOILERPLATE FLAG:** an objection matching the BOILER regex and under
90 chars is stored `boilerplate:true` and flashed back — recorded, not blocked. Interrogatory
counts checked against the FRCP 33(a)(1) cap of 25 incl. discrete subparts, explicitly marked
informational on Ontario-seated matters.

#### `esiProtocol` / `discoveryPlan` / `meetConfer` / `deficiencyLetter` (12-discovery)
- `esiProtocol`: `custodians`, `daterange`, `formats`, `clawback` (all booleans, all written
  every save). **Singleton by `list()[0]`-and-respread**, not by id — a second record is
  silently ignored.
- `discoveryPlan`: `scope`, `custodians`, `dateFrom`, `dateTo`, `format`, `costNote`,
  `agreedDates`. Same `list()[0]` singleton. Refused when every field is empty or
  `dateTo < dateFrom`. `POST /plan-export` renders it as `.txt`.
- `meetConfer`: `date` (required ISO) · `attendees` · `issues` · `resolutions`; refused when
  all three text fields are empty.
- `deficiencyLetter`: `instrumentId` · `type` · `to` · `text`. Generated **only** from items
  where `answered === false`; if everything is answered the room flashes "nothing to chase"
  and writes nothing.

#### `witness` (14-depositions)
`name` (required) · `side` (`'theirs'|'ours'|'third-party'`) · `role` · `examDate` (ISO|null).
Read by 14 (the cross-matter board splits ours-to-answer vs theirs-to-chase on
`witness.side`) and 26-closing. **Distinct from 20-trialbook's `trialWitness`; nothing links
the two.**

#### `undertaking` (14-depositions)
**Fields** `witnessId` · `kind` (`'undertaking'|'refusal'|'under-advisement'`) · `qnum` ·
`pl` (`'NN:NN'`) · `ground` / `sought` (only when `kind !== 'undertaking'`, forced `null`
otherwise) · `text` (required) · `given` (ISO, default today) · `due` · `basis`
(`'set by hand'` | the rule cite | `'+60 days (house default)'`) · `answered` (ISO|null) ·
`status` (`'open'|'answered'`)
**Invariants** refuses without a resolvable `witnessId` and non-empty `text`; `pl`
(`/^\d{1,5}:\d{1,4}$/`) and dates are format-validated (bad input flashes, never 500s).
**A blank due date is COMPUTED, never left empty** — the jurisdiction's undertakings rule via
`k.rules.compute`, else a +60 calendar-day house default; the choice is recorded in `basis`.
Records predating `kind` read as `'undertaking'` via `uKind(u)` — keep that fallback.
`POST /answer-x` is matter-qualified (takes `matterId` from the form, ignores `ctx.matter`)
and wraps `k.scope` in try/catch so a walled/shredded matter flashes rather than throwing.

#### `depoTopic` / `digest` (14-depositions)
- `depoTopic`: `witnessId` · `order` (max existing +1) · `topic` · `source` (the fact's pin,
  a typed pin, or null) · `factId`. `POST /pull` is **idempotent per fact** (skips already-
  pulled `factId`); actor matching is fuzzy both ways (equality or substring containment,
  case-insensitive) between `fact.actor` and `witness.name`. A pulled topic carries the fact's
  pin forward — the outline inherits source-or-drop.
- `digest`: `witnessId` · `pl` (required, validated) · `quote` (verbatim, required) · `kind`
  (`'admission'|'denial'|'impeachment-candidate'`) · `contraFactId` (stored only when the id
  resolves to a real fact in this matter). Refused without a valid page:line and a quote.

#### `expert` (15-experts)
**Fields** `name` (required) · `discipline` · `side` (`'ours'|'theirs'`) · `rateType`
(`'hourly'|'daily'`) · `rate` (>0 or null) · `reportDue` · `deadlineId` · `scope` · `status`
(`'identified'|'retained'|'report served'|'challenged'|'qualified'|'excluded'`) · `checklist`
(object keyed by CHECKLIST ids: `fre_facts, fre_principles, fre_application, mohan_relevance,
mohan_necessity, mohan_noexcl, mohan_qualified, wb_duty`, …) · `challenge`
(`{by:'ours'|'theirs', ground, outcome}` or null) · `form53` (`{party, signedDate,
acknowledged:true, independence, recordedAt}`) · `report26` (object keyed by REPORT26 ids:
`r_opinions, r_facts, r_exhibits, r_quals, r_cases, r_comp`) · `disclosureDeadlineId` ·
`disclosureRule` (`on_5303_1|on_5303_2|frcp_26d_i|frcp_26d_ii`)
Written/read by 15-experts only.
**Invariants** pipeline enforced by `ADVANCE = {identified:'retained', retained:'report
served'}` — `POST /status` refuses any non-adjacent transition. `/challenge` refuses once
status is `'qualified'` or `'excluded'`. `/outcome` refuses unless status is `'challenged'`
and the outcome is `'qualified'` or `'excluded'`. Form 53 refuses unless the acknowledgment
box is ticked and a party is named.
**DEADLINE COUPLING:** `reportDue` and the disclosure date each own a `deadline` by id.
Re-setting a date **updates the existing deadline in place** — preserve that or the calendar
fills with stale duplicates. `checklist` and `report26` are **replaced wholesale** on save
(unticked boxes vanish); safe to extend the constants, unsafe to rename an id.

### Argument / trial

#### `critique` / `benchQ` / `oppositionDraft` (19-moot)
- `critique`: `draftId` (required) · `target` (section key) · `attack` (required) ·
  `severity` (`'fatal'|'serious'|'minor'`, whitelist-coerced to `'serious'`) · `response` ·
  `status` (`'open'|'resolved'`). **UNRESOLVED FATAL is advisory only** — surfaced as
  "unresolved fatal attacks stand. Do not file past them" but **not enforced**: 22-filing
  never reads `critique`.
- `benchQ`: `draftId` · `question` (both required) · `answer` · `drilled` (bool).
- `oppositionDraft`: `draftId` · `text` · `model` (the model id from `k.ai.chat`).
  Only written after a successful `k.ai.chat`, which refuses when the matter's `aiPolicy`
  is `'forbidden'` (firm-scope `matter.aiPolicy`, toggled from this room) or no endpoint is
  configured; every call is audited. Refused when the draft's sections are empty. Draft text
  is truncated to 24000 chars before being sent. **Always stored with its `model` and must
  stay visually tagged wherever rendered** — a model-written passage is never the record.

#### `trialWitness` / `juryInstruction` / `verdictQ` / `trialChecklist` (20-trialbook)
- `trialWitness`: `name` (required) · `minsDirect` · `minsCross` (Numbers, 0 default) ·
  `order` (= `list.length + 1`). No reorder or delete route, so `order` would collide if one
  were added. **Separate from 14-depositions' `witness`; nothing joins them.**
- `juryInstruction`: `topic` (required) · `source` (raw passthrough from `ctx.body`, may be
  `undefined`).
- `verdictQ`: `question` (required). No ordering field — display order is raw list order.
- `trialChecklist`: **`id` set explicitly to `'checklist'`** (singleton) · `done`
  (**number[] of ARRAY INDICES** into the room's 7-item CHECKLIST constant). Reordering or
  inserting into CHECKLIST silently reinterprets every saved checklist — **append only**.
  On read, an index that is not an integer inside the current range is ignored rather than
  counted, so a stale record can never report the book more ready than it is. Note this is
  the **opposite** convention to 26-closing's `closingChecklist`, which stores keys.

#### `filing` (22-filing)
**Fields** `draftId` · `draftTitle` (denormalised) · `court` · `style` · `fileNo` · `served`
· `serviceMethod` · `status` (`'awaiting-signature'|'signed'|'filed'`) · `signedBy`,
`signedAt` (full ISO) · `confirmedAt` (date), `registryRef`. Written/read by 22-filing only.
**GATES**
- **PREPARE:** refuses unless the chosen draft has `citeStatus==='clear'` **and**
  `status==='final'`; also requires `style` + `served` and every PREFLIGHT checkbox
  (`redacted`, `tabs`, `limits`).
- **SIGN:** only role `'lawyer'` or `'admin'`; the typed signature must equal
  `ctx.user.name` **exactly**; the confirm box must be ticked; only an
  `'awaiting-signature'` filing can be signed.
- **CONFIRM:** only a `'signed'` filing; `confirmedAt` required.
The room **records only — it never transmits**. Every transition also writes an explicit
`k.audit` event.

### Resolve / money

#### `adrSession` / `offer` / `r49scenario` (23-adr)
- `adrSession`: `process` (`'mediation'|'arbitration'|'judicial dispute resolution'`) ·
  `provider` (required) · `date` (required) · `briefDue` (ISO|`''`) · `outcome` (added by
  `/outcome`). **SIDE EFFECT:** a non-empty `briefDue` also writes a `deadline`
  (`desc: '<process> brief due (<provider>)'`, `rule:'ADR schedule'`,
  `trigger:'Session <date>'`, `status:'open'`) with **no `ruleId`** and no back-link by id.
- `offer`: `direction` (coerced — anything not `'made'` becomes `'received'`) · `amount`
  (>0) · `date` (required ISO) · `expiry` (ISO|`''`) · `terms`. r.49 leverage chips are
  computed from `expiry` vs today; the record stores no derived status.
- `r49scenario`: `offerId` · `offeror` (`'plaintiff'|'defendant'`) · `judgment` (>0) ·
  `hearingDate` (ISO|null) · `qualifies` (bool) · `flags` (string[]) · `outcome` (prose).
  **Qualification is COMPUTED:** expiry before trial opens → disqualifying flag; served <7
  days before the hearing → disqualifying flag; `qualifies === (flags.length === 0)`.
  No dollar costs figures — deliberately, because none exist on file.

#### `waterfall` (24-waterfall)
`gross` (>0) · `feePct` (0–100) · `costs` · `liens` (`[{name, amount}]` parsed from
`'name:amount, …'`) · `staged` (bool).
**BOTH fee conventions are always shown** (fee on gross and fee on net-of-liens) because the
retainer governs which applies — the record stores neither as "the" answer.
**GATE — STAGE ONCE:** `POST /stage` refuses when `staged` is already true; it posts a
balanced trust receipt (`dr trust:bank` / `cr trust:client`, `kind:'trust-receipt'`) then sets
`staged:true`. Fees may only leave trust later via an explicit `kind:'trust-transfer'`
(enforced in `kernel/api.js`).

#### `timeEntry`
**Fields** `hours` (Number) · `rate` (Number) · `utbms` (e.g. `'L110 Fact investigation'`) ·
`narrative` · `state` (`'draft'` at creation, `'billed'` once invoiced) · `lint`
(reason string | null) · `invoiceId`, `invoiceNumber` (added by 34-billing on issue)
**Written by** 28-books `POST /books/time` (**the only creator**) · 34-billing `POST /issue`
(sets `state:'billed'`, `invoiceId`, `invoiceNumber`)
**Read by** 28-books (WIP table) · 34-billing (unbilled = `state !== 'billed'`; get by id on
issue) · 05-client (budget vs actual) · 36-portal (same figure for the client pack) ·
28-books CSV export (`POST /books/export report='time'`, walks every visible matter) · 26-closing
**Invariants**
- **BILLED-ONCE.** Every reader defines unbilled as `state !== 'billed'`. Discarding a draft
  invoice (`POST /discard`) deliberately leaves time unbilled.
- **PRE-BILL LINT — ONE RULE, WRITTEN TWICE, KEPT IDENTICAL.** 28-books (`28-books.js:50`)
  and 34-billing (`34-billing.js:35`) hold **byte-identical** `VAGUE` regexes and
  `narrativeLint()` bodies: empty → `'empty narrative'`, `<12` chars → `'narrative too thin'`,
  or the VAGUE regex (`work on file`, `attend(ed) to (the) file`, `attention to (the) file`,
  `misc(ellaneous)`, `various`, `general`, `admin(istration)`, `as discussed`, `review file`,
  `review of file`, `per instructions`) → `'narrative too vague'`. **If you touch one, touch
  both.** 34-billing's is the GATE — it refuses to issue an invoice while any line fails;
  28-books' stamps the advisory `lint` field at creation and flashes the reason, so an entry
  can no longer pass at entry and block at billing.
- **NUMERIC COERCION IS UNIVERSAL.** 28-books `POST /books/time` now refuses `hours <= 0` and
  `rate <= 0` outright, and every reader — 28-books' own WIP sum and CSV, 34-billing,
  05-client, 36-portal — puts both factors through `Number(v) || 0` before multiplying, so a
  legacy `NaN` reads as zero instead of poisoning a total or printing "NaN" on an invoice.
  **New readers use the `||0` form**; a stored `NaN` from before the validation still exists.
- 34-billing's gathering half of BILLED-ONCE is stricter than the shared definition:
  `isUnbilled = (r) => r.state !== 'billed' && !r.invoiceId` — nothing sets `invoiceId` before
  issue, so an entry claimed by an issued invoice can never be swept into a second bill even
  if its `state` somehow reads `'draft'`.

#### `disbursement` (34-billing)
`desc` (required) · `amount` (2dp, >0) · `incurred` (ISO, default today) · `state`
(`'unbilled'|'billed'`) · `invoiceId`, `invoiceNumber` on issue.
Creation also posts a balanced ledger entry: `dr operating:expense:disbursements` /
`cr operating:bank`, `kind:'disbursement'`. Marked billed on issue so it cannot land on a
second invoice.

#### `invoice` (34-billing, read by 34 only)
**Fields** `number` (firm-wide `'YYYY-NNN'` from firm `invoiceSeq`) · `matterId` · `feeModel`
(`'hourly'|'flat'|'contingency'`), `flatAmount`, `contingencyPct` (from `feeModelFor()`) ·
`lineItems[] {timeEntryId, narrative, hours, rate, utbms, amount, writeDown}` ·
`disbLines[] {disbId, desc, amount}` · `fees`, `disbursements`, `writeDowns`, `total`
(recomputed, 2dp) · `status` (`'draft'|'sent'|'paid'`) · `issuedDate`, `paidDate`
**Invariants**
- **ONE OPEN DRAFT:** `POST /draft` refuses when any invoice on the matter is `'draft'`.
- Only a draft may be written down, discarded or issued; only a `'sent'` invoice may be
  marked paid. A write-down is clamped `0 <= wd <= line.amount`.
- Fee model: flat → `max(0, flatAmount − writeDowns)`; contingency → **0** (fees come from
  the room 24 recovery, never billed hourly); hourly → `max(0, gross − writeDowns)`.
- Issue refuses when `total <= 0` and when any narrative fails `narrativeLint`.
- `feeModelFor(k, matterId)`: newest **signed** engagement by `version` wins, else newest of
  any status, else `{feeModel:'hourly', flatAmount:0, contingencyPct:0, source:'default (no
  engagement on file)'}`. Note it does **not** carry `rate` — hourly invoices take rate from
  each `timeEntry`.
- Invoice numbers come from firm scope (`invoiceSeq` id `'counter'`) and are never reused —
  deliberately number-only so nothing leaks across an ethical wall.

#### `engagement` (03-retainer)
**Fields** `version` (max existing +1) · `scopeIn` (required), `scopeOut` · `feeModel` ·
`rate` (hourly only, else null) · `flatAmount` (flat only) · `contingencyPct` (contingency
only) · `status` (`'draft'|'sent'|'signed'|'superseded'`) · `drafted`, `sentAt`, `signedAt`,
`supersededAt`, `supersededBy` (version number) · `letter` (generated full text)
**Read by** 03-retainer · **34-billing `feeModelFor()`** — this drives every invoice's fee model.
**Invariants** per-model validation at creation (hourly `rate>0`; flat `flatAmount>0`;
contingency `0 < pct <= 100`). **VERSIONED, NEVER EDITED** — a new version marks every prior
non-superseded version `'superseded'`. Transitions are strictly draft → sent → signed.
**GATE — CONFLICTS:** signing is refused unless a cleared `conflictRun` exists for the matter,
audited as `engagement.sign.blocked`. Signing also writes the firm-scope `engagementSigned`
marker (see §c).

### Client-facing

#### `clientUpdate` (05-client)
`text` (required) · `sentOn` (default today) · `sentBy` (default `ctx.user.name`) · `grade`
(Gunning-fog-style reading grade). Read by 05-client and 36-portal (`assemblePack` takes the
newest by `sentOn || createdAt`).
**Invariant** `grade` is computed at write time by 05-client **and recomputed at pack time by
36-portal with a byte-identical `readingGrade()`** — the two implementations must stay in
sync or the desk and the pack report different grades. `grade > 9` is flagged "aim under 9"
in both rooms.

#### `decisionMemo` (05-client)
`question` (required) · `options` · `decision` (**required at creation**) · `decidedOn` ·
`recordedBy`.
**Invariant** a `decisionMemo` records a decision that **came back** — 05-client refuses to
create one without a decision. 36-portal no longer treats an empty-`decision` memo as an
outstanding question (that branch could never match and has been removed); it reads
`answeredMemos(s) = list('decisionMemo').filter(d => String(d.decision||'').trim())` and
sources the pack's outstanding questions from `decisionRequest` alone. **A future writer that
wants to pose an open question must write a `decisionRequest`, not a blank-decision memo.**

#### `decisionRequest` / `clientPack` (36-portal)
- `decisionRequest`: `question` (required) · `options` · `status` (`'open'|'closed'`). Only
  open requests enter a pack; closing one drops it from future packs but not from packs
  already generated.
- `clientPack`: `matterTitle`, `client`, `jurisdiction`, `preparedBy`, `status`
  (`{text, sentOn}`|null), `grade`, `dates` (`[{due, desc, rule}]`, the 3 soonest open
  deadlines with a real ISO due), `budget` (`{figure, feesEarned, disbursements, unbilled,
  trustHeld, actual, remaining, hasBudget, over, nearing}`), `decisions` (`[{question,
  options}]` = **open `decisionRequest`s only**, minus any already answered by a later
  `decisionMemo` with a normalised-equal question — `normQ` lower-cases, collapses whitespace
  and strips trailing punctuation, and the memo must post-date the request, so a question
  re-posed after an earlier answer is asked again rather than silently dropped).
  **A pack is a FROZEN, SELF-CONTAINED snapshot:** `/pack/:id` renders from the stored record
  only. Every figure derives from other rooms (ledger balances, deadlines, timeEntry WIP,
  `matter.budget`) — nothing invented. **There is no client login and no second auth surface;
  the lawyer delivers the pack. Do not add an unauthenticated read route for it.**

#### `scenario` (04-value)
`name` (default `'Unnamed scenario'`) · `dLow`, `dLikely`, `dHigh` · `liability` (0–100) ·
`costsToDate`, `budget` (≥0) · `contingency` (0–100|null) · `offer` (≥0|null).
**BANDED, NEVER A POINT ESTIMATE** — enforced by requiring `dLow <= dLikely <= dHigh`, all ≥0.
All derived figures (expected recovery, net if tried) are computed at render, never stored.

#### `lookup` (32-sources)
`source` (the firm-scope source name) · `query` (required) · `result` (required).
**Both** are required — this is a diligence record, not a search box.

#### `secFiling` (31-edgar) / `docketRef` (30-uscourts)
- `secFiling`: `company`, `form`, `date`, `description`, `url`, `adsh`, `source:'edgar'`.
  Refused unless `company` and `url` present.
- `docketRef`: `caseName`, `court`, `dateFiled`, `docketNumber`, `url`, `source:'recap'`.
  Written when `POST /save` has `kind === 'r'`; the other branch of the same handler writes
  an `authority` instead.
- **SCHEME ALLOWLIST (both):** `url` must match `/^https?:\/\//i` — the stored value is
  re-rendered as a clickable link and `esc()` cannot neutralise a `javascript:` URI.

#### `closingChecklist` (26-closing) — **a real record, and a real GATE**
**Fields** `id` (**set explicitly to `'closing'`** — fixed-id singleton, mirroring
20-trialbook's `trialChecklist`) · `done` (**string[] of CHECK KEYS**, not indices —
currently `account`, `originals`, `letter`) · `by` (`ctx.user.name`) · `at` (full ISO)
**Written by** 26-closing `POST /check` (replaces `done` wholesale with what was submitted)
and `POST /close` (**merges** anything ticked on the close form into the recorded set and
persists it before testing the gate, so no tick is lost on a refusal)
**Read by** 26-closing only — `doneSet(rec)` on the room GET, and again in `POST /close`.
**Invariants**
- **GATE — CLOSE ON A RECORDED CHECKLIST.** `POST /close` refuses while any CHECK step is
  unrecorded ("N of 3 closing steps are not recorded"), then refuses again if
  `balances['trust:bank'] > 0.005`. It reads the **stored** record, not the submission.
- Once `matter.status === 'closed'` the checklist is the closing record and `POST /check`
  refuses to edit it; the room renders the recorded ticks (which print) instead of the form.
- `done` holds **keys, not indices** — the opposite of `trialChecklist`. CHECK may therefore
  be reordered freely; **renaming a key silently retires that step's tick** and reopens the
  gate for every matter that had it. `orderedDone()` re-sorts to CHECK order on write and
  `doneSet()` ignores anything not in CHECK on read.

#### Rooms that store nothing
**17-tools** touches no kernel storage at all — no `scope`, no `firm`, no ledger. It is
twenty pure calculators rendering from `ctx.query`/`ctx.body`. Do not assume it persists.

---

## (c) FIRM-SCOPE RECORDS

Storage: `ctx.kernel.firm.list|get|put|del(type, …)` — sealed with the tenant KEK.
**Never put privileged content here.** All firm puts are audited as `firm.<type>.put`
(except `matter` creation, audited `matter.created+key`).

| type | fields | written by | read by |
|---|---|---|---|
| `matter` | `title, client, adverse[], jurisdiction, status ('open'\|'closed'\|'destroyed'), theory, posture, budget?, aiPolicy?, closedAt?` (full ISO, set with `status:'closed'`) | 01-intake `/decide` (creation, mints the DEK), 05-client (`budget`), 09-jurisdiction (`jurisdiction`), 19-moot (`aiPolicy`), 26-closing (`status` + `closedAt`), kernel `shred()` | everywhere via `ctx.matter` / `ctx.matters`; `k.matter(id)`; 02, 05, 19, 26, 28 read it directly. 26-closing derives the destroy-eligible date from `closedAt` |
| `inquiry` | `client, adverse[], jurisdiction, claimType, discovered, summary, limitation, limRuleId, limCite, limNote, status ('screening'\|'accepted'\|'declined'), matterId` | 01-intake (`/new`, `/decide`) | 01-intake, 02-conflicts, 03-retainer (`matterCleared` back-link), 27-desk (`status==='screening'` count) |
| `conflictRun` | `name, hits[], parties[] (deduped: name + client + adverse of the tied matter/inquiry), matterId\|null, inquiryId\|null, outcome ('pending'\|'clear'\|'waiver'\|'declined'), runBy, ranBy, ranAt, decidedBy, decidedAt` | 02-conflicts (`/run` creates with `outcome: hits.length ? 'pending' : 'clear'`; `/outcome` decides) | **01-intake `inquiryCleared()`**, **03-retainer `matterCleared()`**, 02-conflicts |
| `party` | `name, aliases[], role (ROLES, default 'Client'), matterId\|null, inquiryId\|null` | 02-conflicts `/party` | 02-conflicts (the name graph `runCheck` walks) |
| `rescan` | `checkedRuns, newHits[{runId,name,hits[]}], byName` | 02-conflicts `/rescan` | 02-conflicts |
| `watchName` | `name, addedBy` | 02-conflicts (`/watch`, del) | 02-conflicts |
| `letter` | `kind ('non-engagement'\|'conflict-waiver'), to, text` | 01-intake `/decide` decline, 02-conflicts waiver | 02-conflicts (filtered `kind==='conflict-waiver'`) |
| `engagementSigned` | `matterId, engagementId, version, feeModel, rate (hourly only, else null), flatAmount (flat only), contingencyPct (contingency only), expectedRetainer (the flat figure, else null), signedAt (date only), signedBy` — built by `signedMarker()` entirely from the stored `engagement`, so it is self-sufficient | 03-retainer: `POST /status` on signature, **plus `backfillMarkers()` on room GET**, which mirrors a marker for any already-`'signed'` version that has none (it never performs a signature, so the conflicts gate is untouched); audited `engagement.marker.backfill` | **28-books** `signedEngagement()` — the Fee-commitment card. **Newest `version` wins**, ties broken on `signedAt \|\| createdAt`, same discipline as 34-billing's `feeModelFor()`. It reads the marker only; it never reopens the matter scope |
| `courtEntry` | `court, jurisdiction, level, portal, feeNote, limitNote, formatNote, standingNote, verifiedOn, reference` | 11-courtbook (seed + `/save` + `/verify`; `reference` is cleared on any hand edit) | 11-courtbook, 22-filing (court picker) |
| `setting` | id-keyed singletons: `'canlii' {apiKey}`, `'courtlistener' {token}`, `'edgar' {contact}`, `'ai' {endpoint, model, apiKey}`, `'courtbook-seed' {done}` | 29, 30, 31, 11, `server.js POST /admin/ai` | `kernel/api.js` (`k.canlii.apiKey()`, `k.uscourts.token()`, `k.edgar.contact()`, `k.ai.config()`), 11-courtbook |
| `calfeed` | `userId` (the record's own `id` **is** the feed token) | 21-calendar (`/feed-new` deletes the user's old ones then puts) | 21-calendar (`GET /r/calendar/feed/:token`, `feedCard`) |
| `ledgerTxn` | `matterId, date, memo, kind, lines[{account, dr?, cr?}]` | **only `k.ledger.post()`** | `k.ledger.list/balances`; 28-books, 05-client, 36-portal, 26-closing, 27-desk |
| `reconciliation` | `statementDate, statementBalance, ledger, liabilities, ok, byName` | 28-books `/reconcile` | 28-books (last 6) |
| `canliiCase` | `id ('<databaseId>/<caseId>')`, `databaseId, caseId, meta, fetched` | 29-canlii (cache on resolve) | 29-canlii |
| `source` | `name, url (http(s) enforced), category, access, notes, seeded?` | 32-sources (SEED on first load, `/add`) | 32-sources |
| `invoiceSeq` | `id:'counter', n` | 34-billing `nextNumber()` | 34-billing |
| `user` | `id, name, email, role ('admin'\|'lawyer'\|'clerk'), active, totp, pendingTotp, totpLastStep, …` | `kernel/auth.js`, `server.js /account/*`, `/admin/*` | auth, server, 23-adr (`sc.createdBy` → user name) |
| `invite` | `code, email, name, role, exp, used` | `kernel/auth.js` | server.js `/invite/:code`, `/admin` |
| `wall` | `matterId, screened[userId], basis` | `server.js POST /admin/wall` (admin only) | **`kernel/api.js walledFrom()`** — the ethical wall, checked before any key unwrap |

---

## (d) KERNEL API REFERENCE

`ctx.kernel` is built by `makeKernel({store, audit, keyring}, user)` in `kernel/api.js`.

```
k.user                                 -> {id, name, email, role}
k.matters()                            -> matter[]  (wall-filtered, newest createdAt first)
k.matter(id)                           -> matter|null (null + audit 'wall.denied' if walled)
k.requireMatter(id)                    -> matter   (throws Error{code:'NOMATTER'})
k.createMatter(meta)                   -> matter   (= firm.put('matter', meta); mints the DEK)

k.scope(matterId)                      -> { list(type, filter?), get(type, id),
                                            put(type, obj), del(type, id) }
   // requireMatter() first (wall), then store.matterScope() (throws if shredded).
   // put/del audit '<type>.put' / '<type>.del' with object '<matterId>:<recordId>'.

k.firm.list(type, filter?) / .get(type, id) / .put(type, obj) / .del(type, id)
   // firm.put('matter', obj) with no obj.id routes to store.createMatter (mints the key).

k.ledger.post(matterId, {date?, memo, kind, lines:[{account, dr?, cr?}]}) -> ledgerTxn
k.ledger.list(matterId?)               -> ledgerTxn[]   (walled matters excluded firm-wide)
k.ledger.balances(matterId?)           -> {account: sum(dr) - sum(cr)}

k.rules = require('kernel/rules.js') — actual exports:
   RULES, JURISDICTIONS, HOLIDAYS,
   compute(rule, isoDate) -> isoDate,
   rulesFor(jur) -> rule[], rule(id) -> rule|undefined,
   isBusinessDay(Date, jur) -> bool,
   isLimitation(rule) -> bool,
   landsOnNonBusinessDay(rule, isoDate) -> bool,
   computeLimitation(rule, isoDate) -> {date, weekendOrHoliday, limitation}

k.blob.put(matterId, buf) -> blobId     k.blob.get(matterId, blobId) -> Buffer
k.audit(action, object)                 // extra events; routine puts are auto-audited
k.auditTrail()                          -> {verify() -> {ok, entries}, tail(n)}
k.isAdmin() -> bool                     k.isShredded(matterId) -> bool
k.shred(matterId)                       // admin only; destroys the DEK, sets status 'destroyed'

k.canlii  = {...canlii,  apiKey()}      k.uscourts = {...uscourts, token()}
k.edgar   = {...edgar,   contact()}
k.ai = { config(), enabled(), policy(matterId),
         async chat(matterId, messages, opts) -> {ok, text, model} | {ok:false, message} }

// kernel/cite-resolve.js, surfaced through the facade (a room may never require it).
k.citeResolve = {
  detect(cite)     -> {jurisdiction:'CA'|'US'|null, raw, ca:[]}   // pure, offline, no I/O
  US_CITE_RX                                                       // no /g flag; .test() is stateless
  async resolve(cite) -> {resolved:bool, source:string|null, title, url, note}
}
   // ONE-ARGUMENT, kernel-already-bound form (the underlying module takes (kernel, cite)).
   // NEVER THROWS: unrecognised cite, missing API key, unconfigured connector and no-match
   // all return resolved:false with a real link-out `url` where one exists.
   // Each call that actually reaches CanLII/CourtListener is audited 'cite.resolve.egress'
   // BEFORE the request leaves (fails closed); the cite STRING is never logged.

// kernel/trust.js, surfaced the same way. Pure, read-only, over k.ledger.balances.
k.trust = {
  perMatterTrustBalance(matterId)        -> number   (0 for a falsy matterId)
  wouldNotOverdraw(matterId, amount)     -> bool     (false for <=0 / garbage)
  wouldNoverdraw(...)                    -> alias of the above (documented spelling)
  replenishmentNeeded(matterId, floor)   -> bool     (false when floor <=0 / garbage)
  threeWayCheck(statementBalance)        -> {ledger, liabilities, statement, ok}
}
   // Each is bound to this facade, so the ledger is already wall-filtered. You MAY pass your
   // own kernel-like {ledger:{balances()}} as an extra FIRST argument to compute the same
   // arithmetic over a NARROWER view (28-books does this to restrict the legs to matters the
   // caller may see); anything without .ledger.balances is treated as the first real
   // argument. That can only narrow visibility, never widen it.
```

**`kernel/rules.js` data model.** A rule is
`{id, jur, category:'limitation'|'procedural', trigger, days, method:'calendar'|'business',
desc, cite}`. `compute()` branches on `isLimitation(rule)`: **procedural** deadlines roll
forward off weekends/holidays; **limitation/prescription** dates are returned with **no roll**
(their true statutory expiry must never be silently pushed to a later, false-safe date) —
pair with `landsOnNonBusinessDay()` to warn counsel instead. Jurisdictions: `on, bc, ab, qc,
ca-fed, us-fed, ny`. Holiday tables are a labelled 2026 reference tranche.

**`ctx`** (built in `server.js makeCtx`): `user`, `matter`, `matters`, `body`, `query`
(URLSearchParams), `params`, `cookies`, `flash`, `setFlash(msg, kind?)`, `kernel`, `registry`.
**`ctx.matter` defaults to `matters[0]`** when no `?m=` / `m` cookie selects one — so it is
`null` only when the user has zero visible matters. Still handle null: every room must.

**Room-visible HTML/HTTP helpers** (the only allowed requires):
`require('../kernel/html.js')` → `esc, layout, table, empty, tag, kv, input, textarea,
select, date, money` (also exports `loginPage, totpPage, enrollPage` — server-only).
`require('../kernel/http.js')` → `html, redirect, send` (also `App, cookie, NONCE`).
`table(cols, rows)`, `tag(txt, kind)` (`'ok'|'gate'|'navy'|''`), `kv([[k, vHtml]])` — note
`kv` values are **raw HTML**, so `esc()` them yourself; `tag`, `empty`, `input`, `textarea`,
`select` escape internally.

---

## (e) CROSS-ROOM HANDSHAKES — the seams that must not break

**1. Conflicts gate → intake → retainer.**
`02-conflicts POST /run` writes a `conflictRun` carrying `parties[]` (the checked name plus
the tied matter's/inquiry's client and adverse parties) and `matterId`/`inquiryId`.
`outcome` starts `'pending'` when there are hits, `'clear'` when there are none; `/outcome`
sets `'clear'|'waiver'|'declined'`.
- `01-intake inquiryCleared(k, inq)` opens the accept gate on any run with
  `outcome ∈ {clear, waiver}` matched by `r.inquiryId === inq.id` **or** `r.parties` contains
  the client (case-insensitive) **or** `r.name === client`. Refusal is audited
  `intake.accept.blocked`.
- `03-retainer matterCleared(k, matter)` mirrors it for matters, adding
  `r.matterId === matter.id` and the inquiry back-link (`inquiry.matterId === matter.id`).
  Refusal is audited `engagement.sign.blocked`.
**If you write a new `conflictRun`, populate `parties[]`, `matterId`/`inquiryId` and
`outcome` or both gates will silently stay shut.** If you add a new gate, copy one of these
two helpers rather than inventing a third matching rule.

**2. Citation gate chain: 18 / 08 / 10 / 07 → 08 → 22.**
**Three entry points, one gate.** A draft reaches 08-citations from
`18-briefs /new` (`citeStatus:'none'`, `status:'draft'`, sections authored, then `/status
cite-check`), from `08-citations /draft` (pasted `text`, `status:'draft'`,
`citeStatus:'unchecked'`), or from `10-pleadings /tocite` (`text` = the pleading's `body`,
`status:'draft'`, `citeStatus:'unchecked'`, `pleadingId`). All three carry `status`, so all
three can end up filed.
Then: **08-citations auto-extracts on GET** (`status==='cite-check' && !scannedAt`) →
`runScan` mints `citation_instance{draftId, status:'unverified'}` per detected cite →
optionally `POST /resolve` records an advisory `lookup` (a machine finding, never a check) →
human `POST /verify` with pinpoint + all three boxes → `regate()` writes
`draft.citeStatus='clear'` (+ `noCitationsFound`) and stamps `gateStamp{id:draftId,
at:draft.updatedAt}` → `18-briefs /status final` (allowed only when `citeStatus==='clear'`)
→ `22-filing /prepare` (requires `citeStatus==='clear' && status==='final'` + preflight) →
`/sign` (exact-name, lawyer/admin) → `/confirm`.
`07-research /send` injects into the same chain: it **requires** a draft, mints the instance
against it, and can only ever push the draft toward `'blocked'`.
Counter-currents keep it honest: **editing a section resets `citeStatus` to `'none'` and
demotes `final`→`draft`**; **re-sending a pleading** resets `citeStatus:'unchecked'`,
`scannedAt:null` and demotes `final`→`draft`; **`gateStamp` staleness** blocks the
certificate when `draft.updatedAt > stamp.at`; and **08's GET re-gates defensively in the
blocking direction only**, so an instance minted elsewhere against an already-clear draft
cannot be filed around. Any new write to a `draft` or a `citation_instance` must be followed
by `regate(s, draftId)` — and a room that cannot reach `regate()` must move the gate in the
blocking direction itself, never the reverse.

**3. Deadline pipeline.**
Producers: 01 (limitation), 12 (discovery responses), 15 (expert report + disclosure), 21
(`/compute`, trial cascade), 23 (ADR brief). Consumers: 21 (matter view), 27 (cross-matter
diary + dual diary + appeal alarms), 36 (client pack), 09 (staleness), the ICS feed, 26.
`k.rules.compute(rule, triggerISO)` is the only sanctioned date arithmetic; rooms store the
resulting ISO string, the rule's **cite** in `rule`, and the rule's **id** in `ruleId` — an
explicit `null` where counsel typed the date and no rule computed it. **Set `ruleId` whenever
a rule produced the date**: 27-desk and 25-judgment now also match on `rule + desc` and on the
rules.js record behind the id, so a missing `ruleId` is survivable rather than fatal, but it
is the only signal that is unambiguous. **Never write a placeholder id that resolves to no
rule.** If you add a trial-anchored deadline set `anchor:'trial'` and **not**
`source:'trial-cascade'` — `21-calendar /trial` deletes every record carrying that stamp and
nothing else.

**4. Ledger / trust rules (`kernel/api.js` `ledger.post`).**
Hard-enforced: ≥2 lines, every line needs an `account`, `dr` total must equal `cr` total in
integer cents, and a zero-value transaction throws. **If a transaction touches any
`/^trust/` account and any `/^operating:income/` account, `kind` must be `'trust-transfer'`
or it throws** — fees cannot be taken from trust any other way.
Account names and `kind` values in use:
| flow | room | kind | lines |
|---|---|---|---|
| retainer into trust | 28 `/retainer` | `trust-receipt` | dr `trust:bank` / cr `trust:client` |
| settlement into trust | 24 `/stage` | `trust-receipt` | dr `trust:bank` / cr `trust:client` |
| earned fees out of trust | 28 `/transfer` | **`trust-transfer`** | dr `trust:client`, cr `trust:bank`, dr `operating:bank`, cr `operating:income:fees` |
| disbursement paid | 34 `/disb` | `disbursement` | dr `operating:expense:disbursements` / cr `operating:bank` |
| invoice issued | 34 `/issue` | `invoice` | dr `ar:client`; cr `operating:income:fees` (fees>0); cr `operating:expense:disbursements` (disb>0) |
| invoice paid | 34 `/status paid` | `payment` | dr `operating:bank` / cr `ar:client` |
| enforcement recovery | 25 `/payment` | `recovery` | dr `operating:bank` / cr `ar:client` |
28-books `/transfer` additionally refuses when the amount exceeds this matter's
`balances['trust:bank']` (+ half a cent) — no client's money funds another's.
Sign conventions: `trust:bank` debit-normal (holdings = `balances['trust:bank']`);
`trust:client` credit-normal (liability = `−balances['trust:client']`).
Three-way reconciliation (28 `/reconcile`) compares statement / ledger / liabilities within
0.005 and stores a firm `reconciliation` record either way.

**5. Bates & document linkage.**
13-review is the **only** writer of `document`. `nextBates()` = `max(/^DEF-(\d{6})$/) + 1`,
6-digit zero-padded, recomputed after each put (so an `.eml` with attachments consumes a
contiguous run). Downstream: 16-evidence links an exhibit by `documentId` (validated on
write, `''` when unresolvable); 33-production freezes `documentIds`/`withheldIds` and the
bates range into a `production` volume; 35-affidavit derives Schedules A and B live from the
same coding. **The partition rule (`privilege !== 'none'` wins over `responsive`) is written
out three times and must stay identical.** Blob text never leaves the vault: 26-closing's
transfer bundle exports document **metadata only**.

**6. Cross-matter walkers.**
`k.scope()` throws `NOMATTER` for a walled matter (audited `wall.denied`) and throws for a
shredded one. Every cross-matter walker in the codebase wraps `k.scope` in try/catch **per
matter** and `continue`s: 27-desk, 14-depositions' undertakings board (`/answer-x` too),
21-calendar's ICS feed, 28-books' CSV export, 26-closing, 34-billing `feeModelFor`.
**Any new cross-matter reader MUST follow that pattern or one walled matter 500s the page.**
Several also guard with `if (k.isShredded(m.id)) continue;` first.

---

## (f) CONFLICTS & GOTCHAS

This section is the one place in the sheet that must never accumulate. A conflict listed here
is a live defect a reader can walk into today; a conflict that has been fixed is deleted, not
softened, so the list stays worth reading. **What follows is what still stands as at the
verification commit above.**

**Shape conflicts that STILL STAND:**
1. `document` — paste shape vs `.eml` shape (author / recipients / date). 13-review,
   33-production and 35-affidavit each define `privOf / respOf / authorOf / recipientsOf /
   createdOf` **identically and locally** (three copies), and 33/35 each define
   `isProducible / isWithheld` again. **Copy the chain verbatim** or `.eml` documents render
   blank; change one copy and the produced set and the privilege log drift apart.
   `dateCreated` is read by all three `createdOf`s and **written by nobody**.

**Rule conflicts that STILL STAND:**
2. Limitation classification is written **twice, and not identically**. 27-desk's `classify()`
   is case-**insensitive** and consults the rules.js record behind `ruleId`;
   09-jurisdiction's `isLimitationDeadline()` checks `staleLimitation` first, then the same
   rules.js record, then a case-**sensitive** `/limitation|prescription/` over `rule + desc`.
   A hand-written row with no resolvable `ruleId` and only `'Limitation period expires'` on it
   is a limitation bar in 27 and not in 09. Do not widen the gap; prefer 27's form.

**CLOSED since this sheet was first written — do not re-report these:**
- `draft` had no `status` from 08-citations, so a registered draft could never be filed —
  **closed**: 08 and 10 both stamp `status:'draft'` (see §b `draft`).
- `citation_instance` from 07-research carried no `draftId` and was permanently unverifiable
  — **closed**: `POST /send` refuses without a draft (see §b `citation_instance`).
- `authority` rendered connector rows as weighed research with an invented `'persuasive'`
  weight — **closed**: every writer stamps `source`, every reader filters, and `/send`
  refuses a connector row (see §b `authority`).
- `deadline` — 27-desk's LIMITATION flag and dual-diary tick keyed off `ruleId`, which only
  21-calendar wrote, so 01-intake's limitation bar was invisible to the control built to
  catch it — **closed** from both ends: every writer stamps `ruleId`, and 27-desk/25-judgment
  classify on `ruleId` **or** `rule + desc` **or** the rules.js record (see §b `deadline`).
- 21-calendar's trial recompute deleted every `anchor:'trial'` deadline, destroying other
  rooms' rows — **closed**: it sweeps strictly by `source === 'trial-cascade'`.
- Pre-bill lint diverged between 28-books and 34-billing, and 28-books stored unvalidated
  `NaN` hours — **closed**: identical `VAGUE`/`narrativeLint` in both, and `hours`/`rate` are
  validated at entry and `||0`-coerced at every reader (see §b `timeEntry`).
- `closingChecklist` was a dead read and `engagementSigned` was write-only — **closed**: both
  are now written and read, and `closingChecklist` gates `POST /close`.
- CONTRACT.md drift (`k.rules` under-documented, "the 28 rooms") — **closed**: `app/CONTRACT.md`
  now states 36 rooms, the full `kernel/rules.js` export list, and `k.citeResolve` / `k.trust`.

**Look-alike types that are deliberately NOT the same — do not unify:**
`witness` (14) vs `trialWitness` (20) · `deadline` (rule-computed) vs `bf` (hand-set tickler) ·
`draft` (18/08/10) vs `pleading` (10) — these two are now **linked** (a pleading registers a
companion draft carrying `pleadingId`) but are still separate records with separate lifecycles:
the pleading is the drafting surface, the draft is the gated artifact. Do not merge them.

**Singleton conventions differ by room** — three patterns coexist:
fixed id (`gateStamp` = draftId, `trialChecklist` = `'checklist'`, `closingChecklist` =
`'closing'`, firm `invoiceSeq` = `'counter'`, firm `setting` = named ids);
`list()[0]`-and-respread (`esiProtocol`, `discoveryPlan`, `trialAnchor`);
newest-wins (`affidavitMeta` by `createdAt`, `clientUpdate` by `sentOn`, engagement by
`version`). Match the room you are in; do not convert one to another.

**Dead / write-only / unreachable code (do not assume these work):**
- `enfStep.status` never leaves `'active'` — there is still no completion transition. The
  only guard is a duplicate check on `(judgmentId, step, status:'active')`.
- `document.dateCreated` is read by `createdOf()` in 13 / 33 / 35 and **written by nobody**.
- 07-research's "awaiting citation check" count is `citation_instance` filtered
  `source==='research' && status==='unverified'`. Those instances now carry a `draftId` and
  are verifiable in 08 — the count is a real queue, not the orphan list it once was.
- **No longer dead** (do not re-report): `closingChecklist` is written and gates `/close`;
  `engagementSigned` is read by 28-books; 36-portal's open-`decisionMemo` branch has been
  removed rather than left unreachable.

**THE TWO KERNEL MODULES ARE NOW WIRED — through the facade, never by `require`.**
`kernel/api.js` binds both at the bottom of `makeKernel()` and exposes them as `k.citeResolve`
and `k.trust` (signatures in §d). A room still may not require either file (§g.1); the facade
is the only door, and a room must **check for presence and degrade** rather than assume it:
- **`kernel/cite-resolve.js`** → `k.citeResolve`. Consumed by **08-citations** `POST /resolve`,
  which discovers it defensively (`citeResolver(k)` accepts `k.citeResolve` or `k.cite`, an
  object with `.resolve` or a bare function, and uses arity to tell the bound one-arg form from
  the raw `(kernel, cite)` one). When absent the room offers no resolve button and the manual
  flow is unchanged. What it returns is stored as the advisory `citation_instance.lookup` — a
  **finding, never a check**. Self-test: `node kernel/cite-resolve.js`.
- **`kernel/trust.js`** → `k.trust`. Consumed by **28-books**, which calls it through the same
  presence-checked indirection (`fn(trustFacade(k), 'threeWayCheck')` etc.) and **falls back to
  its own inline arithmetic** when the facade does not expose it — so both implementations are
  still in the tree and must stay in agreement. 28-books deliberately hands in its **own**
  narrowed `{ledger:{balances}}` view (`trustView`), because the facade may standardise the
  arithmetic but not the visibility rule. Self-test: `node kernel/trust.js`.
- The ICS feed `GET /r/calendar/feed/:token` **is now reachable without a session cookie.**
  `server.js` admits exactly `GET /r/calendar/feed/<one segment>` (`FEED_ROUTE`) with an
  opaque-shaped token (`FEED_TOKEN`) and builds a kernel **for the feed's owner**, so every
  wall, shred and matter filter binding that user binds the request. Every rejection — bad
  shape, unknown token, deleted or deactivated owner — answers the **same constant 404**, so
  the route cannot be walked to enumerate tokens or accounts; no flash is carried, and no
  audit line is written per fetch (an unauthenticated caller must not be able to grow the
  hash-chained log). **DOC DRIFT:** 21-calendar's own "Integration note" card still says the
  feed is unreachable without a cookie. The room text is stale; server.js is the truth.

---

## (g) RULES FOR AGENTS EDITING CODE

1. **Allowed requires — nothing else.** A room may require exactly:
   ```js
   const { layout, esc, table, empty, tag, kv, input, textarea, select, date, money } = require('../kernel/html.js');
   const { html, redirect, send } = require('../kernel/http.js');
   ```
   No `fs`, `net`, `http`, `crypto`, `child_process`, no npm, no `fetch`, no other kernel
   module — **including `cite-resolve.js` and `trust.js`**, which are reachable only as
   `ctx.kernel.citeResolve` / `ctx.kernel.trust` (§d). Check for their presence and degrade
   gracefully when absent, the way 08-citations and 28-books do. All state and all outbound
   work goes through `ctx.kernel`. Verified: no room in the tree requires anything else.
2. **`esc()` every user string, every time.** `tag/empty/input/textarea/select` escape
   internally; `table` and `kv` take **raw HTML cells**, so escape before you hand them over.
   Never interpolate a stored value into an `href`/`src` without the `/^https?:\/\//i`
   allowlist — `esc()` does not neutralise a `javascript:` URI (see 30/31/32).
3. **POST = validate → act → `ctx.setFlash(...)` → `redirect(res, '/r/<id>')`.** Never leave
   a POST without responding. Empty or garbage form input must flash an error, never 500 —
   round-trip dates through `Date` (`new Date(d+'T00:00:00Z')` and compare the ISO slice back)
   so `'2026-02-31'` is rejected rather than rolled forward. Use `'err'` as the second flash
   argument for refusals.
4. **Handle `ctx.matter === null`.** Render `empty('Open a matter to …')` — never crash, never
   assume `ctx.matter.id`. Handlers that act cross-matter must take the matterId from the form
   and wrap `k.scope(...)` in try/catch (see 14-depositions `/answer-x`, 27-desk `/verify`).
5. **Never weaken a gate.** Source-or-drop (06); conflicts clearance before accept/sign
   (01/03); all-four citation verification and clear+final before filing (08/18/22); exact-name
   lawyer signature (22); dual diary by a different user (27); foundation + witness before
   admission (16); one open draft invoice, billed-once, lint-before-issue (34); stage-once and
   trust-transfer-only fee withdrawal (24/28/kernel); banded valuations (04); closing only on
   a recorded checklist and a zeroed trust balance, admin-only shred and export with exact
   title confirmation (26). You may add checks; you may not remove,
   short-circuit, or route around one — and do not add a new writer that produces records the
   existing gate cannot see (that is how the `ruleId` and `draftId` conflicts above happened).
6. **Match the existing record shape or extend it additively.** Reuse the shared types
   (`deadline`, `document`, `timeEntry`, `draft`, `fact`) rather than minting a parallel one;
   when you add a field, give every existing reader a defined fallback. Never hand-set `id`
   outside the three documented singletons. Never write privileged content to `k.firm`.
7. **Model output is always tagged.** Anything from `k.ai.chat` is stored with its `model` and
   rendered with a model-generated tag; `k.ai.chat` already refuses when `matter.aiPolicy ===
   'forbidden'` and audits every call. Do not cache, re-render, or copy model text into a
   record that reads as the lawyer's own.
8. **Honesty rules still bind** (CONTRACT.md §Honesty): no fabricated legal data presented as
   authoritative; reference tranches must be labelled as such and every citation-like string
   must be real; where an external corpus/API is needed, implement the workflow and render a
   clearly-marked integration note instead of faking output. A firm default must never be
   presented as statutory (see the trial cascade).
9. **Definition of done:** `node test/harness.js <id>` prints ALL PASS **and**
   `node test/seeded.test.js` renders all 36 rooms against real records of every major type
   above. The harness alone only ever proves the EMPTY state — a room can be hard-broken for
   any matter that actually holds data and still report green. The page must render with
   working forms, and the empty state must be handled.
