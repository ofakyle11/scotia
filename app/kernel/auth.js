'use strict';
// Provisioned access only. There is no signup path in this codebase.
// Uniform-time login, in-memory sessions, per-IP rate limiting, single-use invites.
const { hashPassword, verifyPassword, token, sha256 } = require('./crypto.js');

const SESSION_TTL = 8 * 60 * 60 * 1000; // 8h
const RATE = { windowMs: 15 * 60 * 1000, max: 20 };

class Auth {
  constructor(store, audit) {
    this.store = store;
    this.audit = audit;
    this.sessions = new Map(); // sha256(token) -> {uid, exp}
    this.hits = new Map(); // ip -> {n, resetAt}
  }
  rateLimited(ip) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || now > h.resetAt) { this.hits.set(ip, { n: 1, resetAt: now + RATE.windowMs }); return false; }
    h.n++;
    return h.n > RATE.max;
  }
  userByEmail(email) {
    return this.store.firm.list('user', (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.active)[0];
  }
  login(email, password, ip) {
    if (this.rateLimited(ip)) { this.audit.log(String(email), 'login.ratelimited', ip); return null; }
    const user = this.userByEmail(email);
    // verifyPassword runs the full scrypt either way: unknown account and
    // wrong password are indistinguishable in response and in time.
    const ok = verifyPassword(password, user ? user.pw : undefined);
    if (!user || !ok) { this.audit.log(String(email), 'login.denied', ip); return null; }
    this.audit.log(user.id, 'login.ok', ip);
    return this.createSession(user.id);
  }
  createSession(uid) {
    const t = token(32);
    this.sessions.set(sha256(t), { uid, exp: Date.now() + SESSION_TTL });
    return t;
  }
  resolve(t) {
    if (!t) return null;
    const s = this.sessions.get(sha256(t));
    if (!s) return null;
    if (Date.now() > s.exp) { this.sessions.delete(sha256(t)); return null; }
    s.exp = Date.now() + SESSION_TTL; // sliding
    const user = this.store.firm.get('user', s.uid);
    return user && user.active ? user : null;
  }
  logout(t) { if (t) this.sessions.delete(sha256(t)); }
  createInvite(email, role, name, by) {
    const code = token(24);
    this.store.firm.put('invite', { code, email, role, name, exp: Date.now() + 24 * 60 * 60 * 1000, used: false }, by);
    this.audit.log(by, 'invite.created', email + ':' + role);
    return code;
  }
  redeemInvite(code, password) {
    const inv = this.store.firm.list('invite', (i) => i.code === code && !i.used)[0];
    if (!inv || Date.now() > inv.exp) return null;
    if (String(password).length < 12) return { error: 'Password must be at least 12 characters.' };
    const user = this.store.firm.put('user', {
      email: inv.email, name: inv.name || inv.email, role: inv.role, active: true, pw: hashPassword(password),
    }, 'invite');
    this.store.firm.put('invite', { ...inv, used: true }, user.id);
    this.audit.log(user.id, 'user.enrolled', inv.role);
    return { user };
  }
}

module.exports = { Auth, SESSION_TTL };
