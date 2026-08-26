'use strict';
// The kernel facade rooms build on. Wall checks happen here, before any
// key unwrap — a screened user cannot reach a matter's DEK at all.
const rules = require('./rules.js');
const canlii = require('./canlii.js');
const uscourts = require('./uscourts.js');
const edgar = require('./edgar.js');
const ai = require('./ai.js');
// Rooms may require only ../kernel/html.js and ../kernel/http.js, so these two
// kernel modules can reach a room ONLY through this facade (see CONTRACT-SHEET
// §g.1). Both take the kernel as their first argument; both are bound to the
// live facade at the bottom of makeKernel().
const citeResolve = require('./cite-resolve.js');
const trustControls = require('./trust.js');

function makeKernel({ store, audit, keyring }, user) {
  function walledFrom(matterId) {
    const walls = store.firm.list('wall', (w) => w.matterId === matterId);
    return walls.some((w) => (w.screened || []).includes(user.id));
  }
  function matters() {
    return store.firm.list('matter', (m) => !walledFrom(m.id))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  function matter(id) {
    if (!id) return null;
    if (walledFrom(id)) { audit.log(user.id, 'wall.denied', id); return null; }
    return store.firm.get('matter', id) || null;
  }
  function requireMatter(id) {
    const m = matter(id);
    if (!m) { const e = new Error('matter unavailable'); e.code = 'NOMATTER'; throw e; }
    return m;
  }
  function scope(matterId) {
    requireMatter(matterId);
    const s = store.matterScope(matterId); // throws SHREDDED if destroyed
    return {
      list: (type, f) => s.list(type, f),
      get: (type, id) => s.get(type, id),
      put: (type, obj) => { const r = s.put(type, obj, user.id); audit.log(user.id, `${type}.put`, matterId + ':' + r.id); return r; },
      del: (type, id) => { s.del(type, id, user.id); audit.log(user.id, `${type}.del`, matterId + ':' + id); },
    };
  }
  const firm = {
    list: (type, f) => store.firm.list(type, f),
    get: (type, id) => store.firm.get(type, id),
    put: (type, obj) => {
      // Creating a matter mints its DEK — however a room chooses to create it.
      if (type === 'matter' && !obj.id) { const r = store.createMatter(obj, user.id); audit.log(user.id, 'matter.created+key', r.id); return r; }
      const r = store.firm.put(type, obj, user.id); audit.log(user.id, `firm.${type}.put`, r.id); return r;
    },
    del: (type, id) => { store.firm.del(type, id, user.id); audit.log(user.id, `firm.${type}.del`, id); },
  };
  const TRUST = /^trust/, OPERATING_INCOME = /^operating:income/;
  const ledger = {
    // Double entry, enforced. A transaction touching trust may only move
    // value between trust and the client trust liability — fees never come
    // out of trust except by an explicit, flagged trust-transfer.
    post(matterId, { date, memo, kind, lines }) {
      requireMatter(matterId);
      if (!Array.isArray(lines) || lines.length < 2) throw new Error('ledger: need 2+ lines');
      let dr = 0, cr = 0, touchesTrust = false, touchesIncome = false;
      for (const l of lines) {
        if (!l.account) throw new Error('ledger: account required');
        dr += Math.round((l.dr || 0) * 100); cr += Math.round((l.cr || 0) * 100);
        if (TRUST.test(l.account)) touchesTrust = true;
        if (OPERATING_INCOME.test(l.account)) touchesIncome = true;
      }
      if (dr !== cr) throw new Error('ledger: unbalanced (dr ' + dr + ' != cr ' + cr + ')');
      if (dr === 0) throw new Error('ledger: zero-value transaction');
      if (touchesTrust && touchesIncome && kind !== 'trust-transfer') {
        throw new Error('ledger: fees cannot be taken from trust except by an explicit trust-transfer');
      }
      const txn = firm.put('ledgerTxn', { matterId, date: date || new Date().toISOString().slice(0, 10), memo, kind: kind || 'general', lines });
      audit.log(user.id, 'ledger.post', matterId + ':' + txn.id + ':' + kind);
      return txn;
    },
    // The ethical wall applies to ledger reads exactly as it does to posts:
    // a named matter must be visible to this user (requireMatter throws
    // NOMATTER, audited, for a walled one), and firm-wide aggregation
    // silently excludes walled matters' transactions — otherwise a screened
    // user could read a hidden matter's trust balances and memos via
    // Trust & Books or its CSV exports.
    list(matterId) {
      if (matterId) {
        requireMatter(matterId);
        return store.firm.list('ledgerTxn', (t) => t.matterId === matterId);
      }
      return store.firm.list('ledgerTxn', (t) => !walledFrom(t.matterId));
    },
    balances(matterId) {
      const bal = {};
      for (const t of ledger.list(matterId)) for (const l of t.lines) {
        bal[l.account] = (bal[l.account] || 0) + (l.dr || 0) - (l.cr || 0);
      }
      return bal;
    },
  };
  const k = {
    user,
    matters, matter, requireMatter, scope, firm, ledger,
    createMatter: (meta) => firm.put('matter', meta),
    canlii: {
      ...canlii,
      apiKey: () => { const s = store.firm.get('setting', 'canlii'); return s && s.apiKey ? s.apiKey : null; },
    },
    uscourts: {
      ...uscourts,
      token: () => { const s = store.firm.get('setting', 'courtlistener'); return s && s.token ? s.token : null; },
    },
    edgar: {
      ...edgar,
      contact: () => { const s = store.firm.get('setting', 'edgar'); return s && s.contact ? s.contact : null; },
    },
    ai: {
      config: () => store.firm.get('setting', 'ai') || null,
      enabled() { const c = this.config(); return !!(c && c.endpoint && c.model); },
      policy: (matterId) => { const m = store.firm.get('matter', matterId); return (m && m.aiPolicy) || 'allowed'; },
      // The one path to a model. Policy-checked, audited, never training.
      async chat(matterId, messages, opts) {
        const cfg = store.firm.get('setting', 'ai');
        if (!cfg || !cfg.endpoint || !cfg.model) return { ok: false, message: 'No model endpoint configured (admin sets it at /admin).' };
        if (matterId) {
          const m = store.firm.get('matter', matterId);
          if (!m) return { ok: false, message: 'Matter unavailable.' };
          if ((m.aiPolicy || 'allowed') === 'forbidden') {
            audit.log(user.id, 'ai.denied.policy', matterId);
            return { ok: false, message: 'Model use is forbidden on this matter by its data-handling policy.' };
          }
        }
        audit.log(user.id, 'ai.call', (matterId || 'firm') + ':' + cfg.model);
        return ai.chat(cfg, messages, opts);
      },
    },
    rules,
    audit: (action, object) => audit.log(user.id, action, object),
    auditTrail: () => ({ verify: () => auditVerify(), tail: (n) => auditTail(n) }),
    blob: {
      put: (matterId, buf) => { requireMatter(matterId); const id = store.putBlob(matterId, buf); audit.log(user.id, 'blob.put', matterId + ':' + id); return id; },
      get: (matterId, id) => { requireMatter(matterId); return store.getBlob(matterId, id); },
    },
    shred(matterId) {
      if (user.role !== 'admin') throw new Error('admin only');
      requireMatter(matterId);
      store.shredMatter(matterId);
      const m = store.firm.get('matter', matterId);
      if (m) firm.put('matter', { ...m, status: 'destroyed' });
      audit.log(user.id, 'matter.shredded', matterId);
    },
    isShredded: (matterId) => keyring.isShredded(matterId),
    isAdmin: () => user.role === 'admin',
  };

  // ---- kernel/trust.js — LSO By-Law 9 s.7 / s.18 controls -------------------
  // Pure, read-only helpers whose only input is kernel.ledger.balances(). Bound
  // to this facade, so a caller gets the wall-filtered ledger for free.
  // A caller may still hand in its OWN kernel-like object as the first argument
  // when it needs the standard arithmetic over a NARROWER ledger view than the
  // facade's (28-books does exactly that, restricting the legs to matters that
  // caller may see). Anything exposing .ledger.balances() is honoured as the
  // kernel; anything else is the helper's first real argument and this facade
  // is used. That can only ever narrow visibility — the facade's own ledger is
  // already the widest view this user is entitled to.
  const kernelLike = (v) => !!(v && typeof v === 'object' && v.ledger && typeof v.ledger.balances === 'function');
  const overLedger = (fn) => (...args) => (kernelLike(args[0]) ? fn(...args) : fn(k, ...args));
  k.trust = {
    perMatterTrustBalance: overLedger(trustControls.perMatterTrustBalance),
    wouldNotOverdraw: overLedger(trustControls.wouldNotOverdraw),
    wouldNoverdraw: overLedger(trustControls.wouldNoverdraw), // documented alias
    replenishmentNeeded: overLedger(trustControls.replenishmentNeeded),
    threeWayCheck: overLedger(trustControls.threeWayCheck),
  };

  // ---- kernel/cite-resolve.js — citation resolution over the connectors -----
  // `detect` is a pure offline classifier and is exposed as-is. `resolve` is
  // exposed in its ONE-ARGUMENT, kernel-already-bound form.
  //
  // OUTBOUND ACCOUNTABILITY: cite-resolve reaches the network through exactly
  // two calls — canlii.fetchCase and uscourts.search. Both are wrapped here so
  // an audit line is written at the moment a request actually leaves, and never
  // for the offline branches (unrecognized cite, no API key, link-out only),
  // which would otherwise record egress that never happened. The audit fires
  // BEFORE the request, so a failure to record fails closed — no unlogged call
  // to a third party. The citation string itself is deliberately NOT logged:
  // the audit chain is plaintext metadata and a cite read off a client's draft
  // is not metadata (rooms/08-citations.js logs its lookups the same way).
  k.citeResolve = {
    detect: citeResolve.detect,
    US_CITE_RX: citeResolve.US_CITE_RX,
    resolve: (cite) => {
      let jur = 'unrecognized';
      try { jur = (citeResolve.detect(cite) || {}).jurisdiction || 'unrecognized'; } catch (_) { /* classifier is best-effort */ }
      const egress = (who) => audit.log(user.id, 'cite.resolve.egress', who + ':' + jur);
      const view = {
        ...k,
        // Delegate through the facade's own connectors, not the raw modules, so
        // anything the facade layers onto them travels with this path too.
        canlii: { ...k.canlii, fetchCase: (ids, key) => { egress('canlii'); return k.canlii.fetchCase(ids, key); } },
        uscourts: { ...k.uscourts, search: (q, type, token) => { egress('courtlistener'); return k.uscourts.search(q, type, token); } },
      };
      return citeResolve.resolve(view, cite);
    },
  };

  return k;
  function auditVerify() { return audit.verify(); }
  function auditTail(n) { return audit.tail(n); }
}

module.exports = { makeKernel };
