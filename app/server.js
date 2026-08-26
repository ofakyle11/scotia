'use strict';
// Chambers — the 36-room firm, reference implementation (kernel/registry.js
// is the authority on the room list; this file mounts whatever it lists).
// Zero dependencies. `node server.js` and sign in. There is no public
// surface and no signup: accounts exist only by provisioning.
const path = require('path');
const fs = require('fs');
const { App, html, send, redirect, cookie, NONCE } = require('./kernel/http.js');
const { Keyring, token } = require('./kernel/crypto.js');
const { Store } = require('./kernel/store.js');
const { Audit } = require('./kernel/audit.js');
const { Auth } = require('./kernel/auth.js');
const { makeKernel } = require('./kernel/api.js');
const ui = require('./kernel/html.js');
const registry = require('./kernel/registry.js');

const DATA = process.env.CHAMBERS_DATA || path.join(__dirname, 'data');
const PORT = Number(process.env.PORT || 8028);

const keyring = new Keyring(DATA);
const store = new Store(DATA, keyring);
const audit = new Audit(DATA);
const auth = new Auth(store, audit);
const app = new App();

// First boot: mint one invite per locked seat. Each person supplies their
// own email, password, and 2FA — nothing is pre-shared.
if (store.firm.list('user').length === 0 && store.firm.list('invite', (i) => !i.used).length === 0) {
  const seats = auth.createSeatInvites();
  console.log('\n  FIRST BOOT — seat invites (single use each, 7 days):');
  for (const s2 of seats) console.log(`  ${s2.name} (${s2.role}):  http://localhost:${PORT}/invite/${s2.code}`);
  console.log('');
}

const flashes = new Map(); // one-shot flash messages keyed by session cookie
function setFlash(req, msg, kind) { const t = (req._cookies || {}).s; if (t) flashes.set(t, { msg, kind }); }
function takeFlash(req) { const t = (req._cookies || {}).s; const f = flashes.get(t); flashes.delete(t); return f; }

const PUBLIC = new Set(['GET /', 'POST /login', 'POST /login/totp', 'GET /healthz', 'GET /robots.txt']);

// The one route whose credential is not a session cookie. 21-calendar's ICS
// feed is authenticated by the unguessable `calfeed` id in the path, and a
// phone's calendar app subscribes with no cookie jar at all — so requiring a
// session made the feature unreachable by the only client it exists for.
// EXACTLY this shape is admitted: GET, one path segment after /feed/, nothing
// nested under it and no other method. Everything else still needs a session.
const FEED_ROUTE = /^\/r\/calendar\/feed\/[^/]+$/;
// Opaque-id shape only (store ids are crypto.randomUUID today). A token that is
// not even shaped like one never reaches a lookup.
const FEED_TOKEN = /^[A-Za-z0-9._~-]{16,128}$/;

// Build the session-less context for the ICS feed, or answer and return null.
// The token buys exactly one thing: a kernel built for the feed's OWNER, so
// every ethical wall, shred and matter filter that binds that user binds this
// request too — the feed can never show more than its owner could read signed
// in. Every rejection (wrong shape, unknown token, owner deleted or
// deactivated) answers with the SAME constant 404 that 21-calendar's own
// handler gives an unknown token, so the route distinguishes nothing and
// cannot be walked to enumerate live tokens or accounts. No flash is carried
// in or out (a stale cookie must not surface another session's banner here),
// and deliberately no audit line per fetch: a subscribed phone polls
// unattended, and an unauthenticated caller must never be able to grow the
// hash-chained audit log.
function feedCtx(req, res, base) {
  const notFound = () => { send(res, 404, 'Not found.'); return null; };
  const tok = base.params && base.params.token;
  if (!tok || !FEED_TOKEN.test(tok)) return notFound();
  const feed = store.firm.get('calfeed', tok);
  if (!feed) return notFound();
  const owner = store.firm.get('user', feed.userId);
  if (!owner || !owner.active) return notFound();
  const user = { id: owner.id, name: owner.name, email: owner.email, role: owner.role };
  const kernel = makeKernel({ store, audit, keyring }, user);
  return { ...base, user, kernel, matters: kernel.matters(), matter: null, registry, flash: null, setFlash: () => {} };
}

async function makeCtx(req, res, base) {
  req._cookies = base.cookies;
  const routeKey = req.method + ' ' + base.pathname;
  if (PUBLIC.has(routeKey) || base.pathname.startsWith('/invite/')) {
    return { ...base, user: null, registry };
  }
  const user = auth.resolve(base.cookies.s);
  if (!user) {
    // Signed-in requests keep the ordinary path below, unchanged; only a
    // request with no usable session falls through to the feed's own credential.
    if (req.method === 'GET' && FEED_ROUTE.test(base.pathname)) return feedCtx(req, res, base);
    redirect(res, '/'); return null;
  }
  const kernel = makeKernel({ store, audit, keyring }, user);
  const matters = kernel.matters();
  let matter = null;
  const want = base.query.get('m') || base.cookies.m;
  if (want) matter = kernel.matter(want);
  if (!matter && matters.length) matter = matters[0];
  return { ...base, user, kernel, matters, matter, registry, flash: takeFlash(req), setFlash: (m, k) => setFlash(req, m, k) };
}

// ---------- the front door ----------
app.route('GET', '/healthz', (req, res) => send(res, 200, 'ok'));
app.route('GET', '/robots.txt', (req, res) => send(res, 200, 'User-agent: *\nDisallow: /\n'));
app.route('GET', '/', (req, res, ctx) => {
  const user = auth.resolve(ctx.cookies.s);
  if (user) { redirect(res, '/r/desk'); return; }
  html(res, ui.loginPage(ctx.query.get('d') === '1'));
});
app.route('POST', '/login', (req, res, ctx) => {
  const ip = req.socket.remoteAddress || '?';
  const out = auth.login(ctx.body.email || '', ctx.body.password || '', ip);
  if (!out) { redirect(res, '/?d=1'); return; }
  if (out.pending) { html(res, ui.totpPage(out.pending)); return; }
  redirect(res, '/r/desk', cookie('s', out.session, { maxAge: 8 * 3600 }));
});
app.route('POST', '/login/totp', (req, res, ctx) => {
  const ip = req.socket.remoteAddress || '?';
  const session = auth.verifyTotp(ctx.body.pending, ctx.body.code, ip);
  if (!session) { redirect(res, '/?d=1'); return; }
  redirect(res, '/r/desk', cookie('s', session, { maxAge: 8 * 3600 }));
});
app.route('GET', '/logout-form', (req, res) => {
  html(res, `<!doctype html><meta charset="utf-8"><body style="background:#0B0E14"><form method="POST" action="/logout" id="f"></form><script nonce="${NONCE}">document.getElementById('f').submit()</script>`);
});
app.route('POST', '/logout', (req, res, ctx) => {
  auth.logout(ctx.cookies.s);
  redirect(res, '/', cookie('s', '', { maxAge: 0 }));
});
app.route('GET', '/invite/:code', (req, res, ctx) => {
  const inv = store.firm.list('invite', (i) => i.code === ctx.params.code && !i.used)[0];
  if (!inv || Date.now() > inv.exp) { send(res, 404, 'Not found.'); return; }
  html(res, ui.enrollPage(inv));
});
app.route('POST', '/invite/:code', (req, res, ctx) => {
  const inv = store.firm.list('invite', (i) => i.code === ctx.params.code && !i.used)[0];
  if (!inv || Date.now() > inv.exp) { send(res, 404, 'Not found.'); return; }
  const out = auth.redeemInvite(ctx.params.code, ctx.body.password || '', ctx.body.email);
  if (!out) { send(res, 404, 'Not found.'); return; }
  if (out.error) { html(res, ui.enrollPage(inv, out.error)); return; }
  const t = auth.createSession(out.user.id);
  flashes.set(t, { msg: 'Enrolled. Next: enable two-factor authentication below — it takes thirty seconds.', kind: '' });
  redirect(res, '/account', cookie('s', t, { maxAge: 8 * 3600 }));
});
app.route('POST', '/matter/select', (req, res, ctx) => {
  redirect(res, req.headers.referer && new URL(req.headers.referer).pathname.startsWith('/r/') ? new URL(req.headers.referer).pathname : '/r/desk',
    cookie('m', ctx.body.matter || '', { maxAge: 30 * 24 * 3600 }));
});


// ---------- account security (any signed-in user) ----------
const totpKit = require('./kernel/totp.js');
app.route('GET', '/account', (req, res, ctx) => {
  const u = ctx.kernel.firm.get('user', ctx.user.id);
  const enrolled = !!u.totp;
  const pending = u.pendingTotp;
  const body = `
  <div class="grid2">
    <div class="card">
      <h2 class="sec" style="margin-top:0">Two-factor authentication</h2>
      <p>${enrolled ? ui.tag('enabled — required at every sign-in', 'ok') : ui.tag('not enabled', 'gate')}</p>
      ${!enrolled && !pending ? `<form method="POST" action="/account/totp-start"><button>Begin enrollment</button></form>
        <p class="note">Generates a secret for any authenticator app (Google Authenticator, 1Password, Aegis). Enrollment completes only after you prove a working code.</p>` : ''}
      ${pending ? `
        <p class="note">Add this secret to your authenticator (manual entry), then confirm with a current code:</p>
        <p class="num" style="font-size:15px;word-break:break-all">${ui.esc(pending)}</p>
        <p class="note" style="word-break:break-all">${ui.esc(totpKit.otpauthUri(u.email, pending))}</p>
        <form method="POST" action="/account/totp-confirm">${ui.input('code', 'Current 6-digit code', { required: true })}<button>Confirm &amp; enable</button></form>` : ''}
      ${enrolled ? `<form method="POST" action="/account/totp-disable">${ui.input('code', 'Current code to disable', { required: true })}<button class="danger">Disable 2FA</button></form>` : ''}
    </div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Session</h2>
      ${ui.kv([['Signed in as', ui.esc(u.name)], ['Email', ui.esc(u.email)], ['Role', ui.esc(u.role)], ['Session policy', '8h sliding · HttpOnly · SameSite=Strict']])}
      <p class="note">Sessions live in server memory only — a restart signs everyone out, deliberately.</p>
    </div>
  </div>`;
  html(res, ui.layout({ ...ctx, room: null }, { title: 'Account security', sub: 'Your credentials, your second factor', body }));
});
app.route('POST', '/account/totp-start', (req, res, ctx) => {
  const u = ctx.kernel.firm.get('user', ctx.user.id);
  if (u.totp) { ctx.setFlash('2FA is already enabled.', 'err'); redirect(res, '/account'); return; }
  ctx.kernel.firm.put('user', { ...u, pendingTotp: totpKit.genSecret() });
  redirect(res, '/account');
});
app.route('POST', '/account/totp-confirm', (req, res, ctx) => {
  const u = ctx.kernel.firm.get('user', ctx.user.id);
  if (!u.pendingTotp) { ctx.setFlash('Start enrollment first.', 'err'); redirect(res, '/account'); return; }
  const enrollStep = totpKit.matchStep(u.pendingTotp, ctx.body.code);
  if (enrollStep === null) { ctx.setFlash('That code did not verify — try again with a fresh one.', 'err'); redirect(res, '/account'); return; }
  ctx.kernel.firm.put('user', { ...u, totp: u.pendingTotp, pendingTotp: null, totpLastStep: enrollStep });
  ctx.kernel.audit('user.2fa.enabled', ctx.user.id);
  ctx.setFlash('Two-factor authentication enabled. It is now required at every sign-in.');
  redirect(res, '/account');
});
app.route('POST', '/account/totp-disable', (req, res, ctx) => {
  const u = ctx.kernel.firm.get('user', ctx.user.id);
  if (!u.totp) { ctx.setFlash('2FA is not enabled.', 'err'); redirect(res, '/account'); return; }
  if (!auth.consumeTotp(u.id, ctx.body.code)) { ctx.setFlash('That code did not verify.', 'err'); redirect(res, '/account'); return; }
  const u2 = ctx.kernel.firm.get('user', u.id);
  ctx.kernel.firm.put('user', { ...u2, totp: null, pendingTotp: null, totpLastStep: null });
  ctx.kernel.audit('user.2fa.disabled', ctx.user.id);
  ctx.setFlash('Two-factor authentication disabled.');
  redirect(res, '/account');
});

// ---------- firm administration (kernel-level, not one of the rooms) ----------
app.route('GET', '/admin', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  const users = ctx.kernel.firm.list('user');
  const invites = ctx.kernel.firm.list('invite', (i) => !i.used && Date.now() < i.exp);
  const walls = ctx.kernel.firm.list('wall');
  const chain = ctx.kernel.auditTrail().verify();
  const body = `
  <div class="grid2">
    <div class="card"><h2 class="sec" style="margin-top:0">People</h2>
      ${ui.table(['Name', 'Email', 'Role', 'Status'], users.map((u) => [ui.esc(u.name), ui.esc(u.email), ui.esc(u.role), u.active ? ui.tag('active', 'ok') : ui.tag('disabled')]))}
      <form method="POST" action="/admin/invite">
        ${ui.input('email', 'Email', { type: 'email', required: true })}
        ${ui.input('name', 'Name')}
        ${ui.select('role', 'Role', [['lawyer', 'Lawyer'], ['clerk', 'Law clerk'], ['admin', 'Administrator']], 'lawyer')}
        <button>Create invite</button>
      </form>
      ${invites.length ? '<h2 class="sec">Open invites</h2>' + ui.table(['Email', 'Role', 'Link (single use)'], invites.map((i) => [ui.esc(i.email), ui.esc(i.role), `<span class="num">/invite/${ui.esc(i.code)}</span>`])) : ''}
    </div>
    <div class="card"><h2 class="sec" style="margin-top:0">Ethical walls</h2>
      ${walls.length ? ui.table(['Matter', 'Screened', 'Basis'], walls.map((w) => { const m = ctx.kernel.firm.get('matter', w.matterId); return [ui.esc(m ? m.title : w.matterId), ui.esc((w.screened || []).map((id) => { const u = ctx.kernel.firm.get('user', id); return u ? u.name : id; }).join(', ')), ui.esc(w.basis || '')]; })) : ui.empty('No walls configured.')}
      <form method="POST" action="/admin/wall">
        ${ui.select('matterId', 'Matter', ctx.matters.map((m) => [m.id, m.title]), ctx.matter && ctx.matter.id)}
        ${ui.select('userId', 'Screen (deny all access)', ctx.kernel.firm.list('user').map((u) => [u.id, u.name + ' — ' + u.email]))}
        ${ui.input('basis', 'Basis', { placeholder: 'e.g. prior retainer at former firm' })}
        <button>Raise wall</button>
      </form>
      <h2 class="sec">Model gateway</h2>
      ${(() => { const c = ctx.kernel.ai.config(); return c && c.endpoint ? `<p>${ui.tag('configured', 'ok')} <span class="num">${ui.esc(c.model)}</span> at <span class="num">${ui.esc(c.endpoint)}</span></p>` : `<p>${ui.tag('off — no endpoint', 'gate')}</p>`; })()}
      <form method="POST" action="/admin/ai">
        ${ui.input('endpoint', 'OpenAI-compatible endpoint (blank to disable)', { placeholder: 'http://localhost:11434/v1  (local Ollama)' })}
        ${ui.input('model', 'Model name', { placeholder: 'e.g. qwen2.5:14b' })}
        ${ui.input('apiKey', 'API key (only if the endpoint needs one)')}
        <button>Save gateway</button>
      </form>
      <p class="note">The gateway is the only door to any model. Local endpoint = nothing leaves the building. Every call is audited; matters can forbid model use entirely (set in the Moot Room). Client content never trains anything.</p>
      <h2 class="sec">Audit chain</h2>
      <p>${chain.ok ? ui.tag('intact', 'ok') : ui.tag('BROKEN', 'gate')} <span class="num">${chain.entries}</span> entries, hash-chained.</p>
      <p class="note">Every login, read denial, key event and ledger post lands here. Content never does.</p>
    </div>
  </div>`;
  html(res, ui.layout({ ...ctx, room: null }, { title: 'Firm administration', sub: 'Provisioning · walls · audit', body }));
});
app.route('POST', '/admin/invite', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  const code = auth.createInvite(ctx.body.email, ['lawyer', 'clerk', 'admin'].includes(ctx.body.role) ? ctx.body.role : 'lawyer', ctx.body.name, ctx.user.id);
  if (!code) { ctx.setFlash(`Seat lock: this build is limited to ${auth.seatCap()} enrolled accounts.`, 'err'); redirect(res, '/admin'); return; }
  ctx.setFlash('Invite created — share the single-use link from the open invites list.');
  redirect(res, '/admin');
});
app.route('POST', '/admin/ai', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  const endpoint = String(ctx.body.endpoint || '').trim();
  if (endpoint && !/^https?:\/\//.test(endpoint)) { ctx.setFlash('Endpoint must be a full http(s) URL.', 'err'); redirect(res, '/admin'); return; }
  ctx.kernel.firm.put('setting', { id: 'ai', endpoint: endpoint || null, model: String(ctx.body.model || '').trim() || null, apiKey: String(ctx.body.apiKey || '').trim() || null });
  ctx.kernel.audit('ai.gateway.' + (endpoint ? 'configured' : 'disabled'), endpoint || 'off');
  ctx.setFlash(endpoint ? 'Model gateway configured (settings encrypted at rest).' : 'Model gateway disabled.');
  redirect(res, '/admin');
});
app.route('POST', '/admin/wall', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  ctx.kernel.firm.put('wall', { matterId: ctx.body.matterId, screened: [ctx.body.userId], basis: ctx.body.basis });
  ctx.setFlash('Wall raised. The screened user can no longer see or decrypt this matter.');
  redirect(res, '/admin');
});

// ---------- the rooms (36 in kernel/registry.js) ----------
for (const meta of registry) {
  const file = path.join(__dirname, 'rooms', `${String(meta.num).padStart(2, '0')}-${meta.id}.js`);
  let mod = null;
  if (fs.existsSync(file)) {
    try { mod = require(file); } catch (err) { console.error(`room ${meta.id} failed to load:`, err.message); }
  }
  if (mod && typeof mod.register === 'function') {
    try { mod.register(app, ui); continue; } catch (err) { console.error(`room ${meta.id} failed to register:`, err.message); }
  }
  app.route('GET', `/r/${meta.id}`, (req, res, ctx) => {
    html(res, ui.layout({ ...ctx, room: meta.id }, {
      title: meta.title, sub: `Room ${String(meta.num).padStart(2, '0')} · ${meta.phase}`,
      body: ui.empty('This room is being fitted out.'),
    }));
  });
}

if (require.main === module) {
  // Bind loopback only by default: TLS termination (Caddy) proxies to us on
  // the same host, so :8028 should never be reachable from the network even
  // when no firewall rule applies. Set CHAMBERS_HOST=0.0.0.0 to expose it.
  const HOST = process.env.CHAMBERS_HOST || '127.0.0.1';
  app.listen(PORT, makeCtx, (err) => console.error('error:', err.message), HOST);
  console.log(`Chambers listening on http://localhost:${PORT} (bound to ${HOST}, data: ${DATA})`);
}

module.exports = { app, makeCtx, store, audit, auth, keyring, PORT };
