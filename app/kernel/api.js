'use strict';
// The kernel facade rooms build on. Wall checks happen here, before any
// key unwrap — a screened user cannot reach a matter's DEK at all.
const rules = require('./rules.js');
const canlii = require('./canlii.js');
const uscourts = require('./uscourts.js');
const edgar = require('./edgar.js');

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
    list: (matterId) => store.firm.list('ledgerTxn', matterId ? (t) => t.matterId === matterId : undefined),
    balances(matterId) {
      const bal = {};
      for (const t of ledger.list(matterId)) for (const l of t.lines) {
        bal[l.account] = (bal[l.account] || 0) + (l.dr || 0) - (l.cr || 0);
      }
      return bal;
    },
  };
  return {
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
  function auditVerify() { return audit.verify(); }
  function auditTail(n) { return audit.tail(n); }
}

module.exports = { makeKernel };
