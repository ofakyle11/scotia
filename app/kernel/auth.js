'use strict';
// Provisioned access only. There is no signup path in this codebase.
// Uniform-time login, in-memory sessions, per-IP rate limiting, single-use invites.
const { hashPassword, verifyPassword, token, sha256 } = require('./crypto.js');
const totp = require('./totp.js');

const SESSION_TTL = 8 * 60 * 60 * 1000; // 8h
const RATE = { windowMs: 15 * 60 * 1000, max: 20 };

// Seat lock: enrollment is limited to exactly these named seats. Override
// with CHAMBERS_SEATS="Name:role,Name:role" before first boot.
const SEATS = (process.env.CHAMBERS_SEATS || 'Dan G:admin,Matt D:admin')
  .split(',').map((s) => { const i = s.lastIndexOf(':'); return { name: (i > 0 ? s.slice(0, i) : s).trim(), role: (i > 0 ? s.slice(i + 1) : 'lawyer').trim() }; })
  .filter((s) => s.name);

class Auth {
  constructor(store, audit) {
    this.store = store;
    this.audit = audit;
    this.sessions = new Map(); // sha256(token) -> {uid, exp}
    this.pending = new Map(); // sha256(token) -> {uid, exp} awaiting TOTP
    this.hits = new Map(); // ip -> {n, resetAt}
  }
  rateLimited(ip) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || now > h.resetAt) { this.hits.set(ip, { n: 1, resetAt: now + RATE.windowMs }); return false; }
    h.n++;
    return h.n > RATE.max;
  }
  activeCount() { return this.store.firm.list('user', (u) => u.active).length; }
  seatCap() { return SEATS.length; }
  seats() { return SEATS; }
  userByEmail(email) {
    return this.store.firm.list('user', (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.active)[0];
  }
  // True the FIRST time a bucket trips inside its window. The chain must record
  // that throttling happened, but /login is public and unauthenticated, so an
  // entry per attempt let anyone append to the tamper-evident log at will.
  firstTrip(ip) {
    const h = this.hits.get(ip);
    if (!h || h.tripLogged) return false;
    h.tripLogged = true;
    return true;
  }
  login(email, password, ip) {
    // The actor is attacker-supplied and bounded only by MAX_BODY (25 MB), so it
    // is truncated before it can reach the hash chain: the audit log is the one
    // artifact that must stay small, readable and append-only forever.
    const who = String(email == null ? '' : email).slice(0, 254);
    if (this.rateLimited(ip)) {
      if (this.firstTrip(ip)) this.audit.log(who, 'login.ratelimited', ip);
      return null;
    }
    const user = this.userByEmail(email);
    // verifyPassword runs the full scrypt either way: unknown account and
    // wrong password are indistinguishable in response and in time.
    const ok = verifyPassword(password, user ? user.pw : undefined);
    if (!user || !ok) { this.audit.log(who, 'login.denied', ip); return null; }
    if (user.totp) {
      const t = token(24);
      this.pending.set(sha256(t), { uid: user.id, exp: Date.now() + 5 * 60 * 1000 });
      this.audit.log(user.id, 'login.await2fa', ip);
      return { pending: t };
    }
    this.audit.log(user.id, 'login.ok', ip);
    return { session: this.createSession(user.id) };
  }
  // Verify AND burn a TOTP code for an enrolled user: a code that has granted
  // access once can never grant it again, even inside the +/-1-step window.
  consumeTotp(userId, code2) {
    const user = this.store.firm.get('user', userId);
    if (!user || !user.active || !user.totp) return false;
    const step = totp.matchStep(user.totp, code2);
    if (step === null) return false;
    if (user.totpLastStep && step <= user.totpLastStep) {
      this.audit.log(userId, 'totp.replay.denied', String(step));
      return false;
    }
    this.store.firm.put('user', { ...user, totpLastStep: step }, userId);
    return true;
  }
  verifyTotp(pendingToken, code2, ip) {
    if (this.rateLimited(ip)) return null;
    const key = sha256(String(pendingToken || ''));
    const p = this.pending.get(key);
    if (!p || Date.now() > p.exp) { this.pending.delete(key); return null; }
    if (!this.consumeTotp(p.uid, code2)) {
      this.audit.log(p.uid, 'login.2fa.denied', ip);
      return null;
    }
    this.pending.delete(key);
    this.audit.log(p.uid, 'login.ok+2fa', ip);
    return this.createSession(p.uid);
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
    if (this.activeCount() >= this.seatCap()) { this.audit.log(by, 'invite.refused.seatlock', String(this.seatCap())); return null; }
    const code = token(24);
    this.store.firm.put('invite', { code, email, role, name, exp: Date.now() + 24 * 60 * 60 * 1000, used: false }, by);
    this.audit.log(by, 'invite.created', email + ':' + role);
    return code;
  }
  // Seat invites: bound to a NAME; the person supplies their own email and
  // password at enrollment. Minted only at first boot, one per seat.
  createSeatInvites() {
    const out = [];
    for (const seat of SEATS) {
      const code = token(24);
      this.store.firm.put('invite', { code, seat: true, name: seat.name, role: seat.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000, used: false }, 'system');
      this.audit.log('system', 'invite.seat.created', seat.name + ':' + seat.role);
      out.push({ ...seat, code });
    }
    return out;
  }
  redeemInvite(code, password, email) {
    const inv = this.store.firm.list('invite', (i) => i.code === code && !i.used)[0];
    if (!inv || Date.now() > inv.exp) return null;
    if (this.activeCount() >= this.seatCap()) return { error: 'Seat lock: every seat in this build is already enrolled.' };
    if (String(password).length < 12) return { error: 'Password must be at least 12 characters.' };
    let userEmail = inv.email;
    if (inv.seat) {
      userEmail = String(email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userEmail)) return { error: 'Enter a valid email — it becomes your sign-in.' };
      if (this.userByEmail(userEmail)) return { error: 'That email is already enrolled.' };
    }
    const user = this.store.firm.put('user', {
      email: userEmail, name: inv.name || userEmail, role: inv.role, active: true, pw: hashPassword(password),
    }, 'invite');
    this.store.firm.put('invite', { ...inv, used: true }, user.id);
    this.audit.log(user.id, 'user.enrolled', inv.role + (inv.seat ? ':seat' : ''));
    return { user };
  }
}

module.exports = { Auth, SESSION_TTL };
