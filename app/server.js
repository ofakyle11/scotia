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
const barbench = require('./kernel/barbench.js');
const { chat: aiChat } = require('./kernel/ai.js');
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
//
// The invite test must count only LIVE invites (unused AND unexpired). Counting
// merely-unused ones meant that if both seven-day seat links lapsed before
// anyone enrolled, the expired records blocked this mint forever while the door
// refused them as expired — a deployment nobody could ever enter, with no way
// back except deleting the data directory. Re-minting is safe precisely because
// this branch only runs when the firm has no users at all.
if (store.firm.list('user').length === 0
    && store.firm.list('invite', (i) => !i.used && Date.now() < i.exp).length === 0) {
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
  // Naming a matter you cannot open must NEVER silently give you a different
  // one. This used to fall through to matters[0] whenever kernel.matter()
  // returned null — walled, shredded, or simply unknown — so a POST carrying
  // `m=<walled id>` executed against another client's file: a bill run was
  // proven to generate a numbered draft invoice on the wrong matter, with a
  // success flash naming neither. The convenience default is only for a request
  // that named no matter at all.
  const want = base.query.get('m') || base.cookies.m;
  if (want) matter = kernel.matter(want);          // null when unavailable — and it stays null
  else if (matters.length) matter = matters[0];
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
// The client address used for rate limiting AND for audit attribution.
//
// The shipped deployment terminates TLS in Caddy and proxies to loopback, so
// req.socket.remoteAddress is 127.0.0.1 for EVERY real user. Keying the limiter
// on it gave the whole firm one shared 20-attempt bucket: 21 anonymous posts to
// the public /login locked out both seats for 15 minutes, from anywhere on the
// internet, repeatable. It also made every audit entry read 127.0.0.1.
//
// X-Forwarded-For is honoured ONLY when the immediate peer is a trusted proxy,
// and only its RIGHT-MOST entry — that is the hop our own proxy appended, so
// anything a client prepends to forge a different bucket is ignored. With no
// trusted proxy in front, this is exactly the old behaviour.
const TRUSTED_PROXIES = new Set(
  (process.env.CHAMBERS_TRUSTED_PROXY || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',').map((s) => s.trim()).filter(Boolean));
function clientIp(req) {
  const peer = req.socket.remoteAddress || '?';
  if (!TRUSTED_PROXIES.has(peer)) return peer;
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return peer;
  const hops = String(xff).split(',').map((s) => s.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1].slice(0, 64) : peer;
}

app.route('POST', '/login', (req, res, ctx) => {
  const ip = clientIp(req);
  const out = auth.login(ctx.body.email || '', ctx.body.password || '', ip);
  if (!out) { redirect(res, '/?d=1'); return; }
  if (out.pending) { html(res, ui.totpPage(out.pending)); return; }
  redirect(res, '/r/desk', cookie('s', out.session, { maxAge: 8 * 3600 }));
});
app.route('POST', '/login/totp', (req, res, ctx) => {
  const ip = clientIp(req);
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
  // Confirm the two entries match BEFORE the password is hashed and stored.
  // This form used to have one password box, and a password is written exactly
  // once in this product's life — so a typo here was a permanent lockout with no
  // reset path and no way for the other seat to help.
  if ((ctx.body.password || '') !== (ctx.body.password2 || '')) {
    html(res, ui.enrollPage(inv, 'The two passwords do not match.')); return;
  }
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
      <h2 class="sec" style="margin-top:0">Password</h2>
      <form method="POST" action="/account/password">
        ${ui.input('current', 'Current password', { type: 'password', required: true })}
        ${ui.input('password', 'New password (12+ characters)', { type: 'password', required: true })}
        ${ui.input('password2', 'New password again', { type: 'password', required: true })}
        <button>Change password</button>
      </form>
      <p class="note">Nobody else can change or reset this for you — not the other seat, not an administrator. Type it into a password manager before you change it.</p>
    </div>
    <div class="card">
      <h2 class="sec" style="margin-top:0">Session</h2>
      ${ui.kv([['Signed in as', ui.esc(u.name)], ['Email', ui.esc(u.email)], ['Role', ui.esc(u.role)], ['Session policy', '8h sliding · HttpOnly · SameSite=Strict']])}
      <p class="note">Sessions live in server memory only — a restart signs everyone out, deliberately.</p>
    </div>
  </div>`;
  html(res, ui.layout({ ...ctx, room: null }, { title: 'Account security', sub: 'Your credentials, your second factor', body }));
});
app.route('POST', '/account/password', (req, res, ctx) => {
  // The recovery path that did not exist: a password was written exactly once,
  // at enrolment, by a form with no confirmation field. A typo there locked a
  // lawyer out of the practice permanently, and the other admin could not help.
  const out = auth.changePassword(ctx.user.id, ctx.body.current || '', ctx.body.password || '', ctx.body.password2 || '');
  if (out.error) { ctx.setFlash(out.error, 'err'); redirect(res, '/account'); return; }
  ctx.setFlash('Password changed.');
  redirect(res, '/account');
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
  // ctx.kernel.walls() omits any wall screening the viewer — see kernel/api.js.
  // Using firm.list('wall') here reached around the wall and rendered the
  // screened matter's title and the conflict basis to the very user it screens.
  const walls = ctx.kernel.walls();
  const chain = ctx.kernel.auditTrail().verify();
  const body = `
  <div class="grid2">
    <div class="card"><h2 class="sec" style="margin-top:0">People</h2>
      ${ui.table(['Name', 'Email', 'Role', 'Status', ''], users.map((u) => [ui.esc(u.name), ui.esc(u.email), ui.esc(u.role), u.active ? ui.tag('active', 'ok') : ui.tag('released'),
        u.active && u.id !== ctx.user.id
          ? `<form method="POST" action="/admin/deactivate" class="no-print"><input type="hidden" name="userId" value="${ui.esc(u.id)}"><button class="danger">Release seat</button></form>`
          : (u.id === ctx.user.id ? '<span class="note">you</span>' : '')]))}
      <p class="note">Releasing a seat frees it so a replacement can be invited — the seat lock counts active people. Do it when a device is lost or a partner leaves. You cannot release your own seat.</p>
      <form method="POST" action="/admin/invite">
        ${ui.input('email', 'Email', { type: 'email', required: true })}
        ${ui.input('name', 'Name')}
        ${ui.select('role', 'Role', [['lawyer', 'Lawyer'], ['clerk', 'Law clerk'], ['admin', 'Administrator']], 'lawyer')}
        <button>Create invite</button>
      </form>
      ${invites.length ? '<h2 class="sec">Open invites</h2>' + ui.table(['Email', 'Role', 'Link (single use)'], invites.map((i) => [ui.esc(i.email), ui.esc(i.role), `<span class="num">/invite/${ui.esc(i.code)}</span>`])) : ''}
    </div>
    <div class="card"><h2 class="sec" style="margin-top:0">Ethical walls</h2>
      ${walls.length ? ui.table(['Matter', 'Screened', 'Basis', ''], walls.map((w) => { const m = ctx.kernel.matter(w.matterId); return [ui.esc(m ? m.title : w.matterId), ui.esc((w.screened || []).map((id) => { const u = ctx.kernel.firm.get('user', id); return u ? u.name : id; }).join(', ')), ui.esc(w.basis || ''), `<form method="POST" action="/admin/wall/remove" class="no-print"><input type="hidden" name="wallId" value="${ui.esc(w.id)}"><button class="danger">Lift</button></form>`]; })) : ui.empty('No walls configured.')}
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
      ${(() => {
        // The competence bench — Chambers' own bar. The gateway accepts any
        // model, including a small local one; this measures whether THAT model
        // can answer bar-style black-letter law before the firm leans on it.
        const c = ctx.kernel.ai.config();
        if (!c || !c.endpoint || !c.model) return '';
        const b = ctx.kernel.firm.get('setting', 'bench');
        const stale = b && (b.model !== c.model || b.endpoint !== c.endpoint);
        const running = b && b.status === 'running' && (Date.now() - (b.startedAt || 0)) < 30 * 60 * 1000;
        let status;
        if (running) status = `<p>${ui.tag('bench running', '')} started ${ui.esc(new Date(b.startedAt).toISOString().slice(11, 16))} UTC — refresh in a few minutes.</p>`;
        else if (b && b.status === 'done' && !stale) {
          const rows = Object.entries(b.bySubject || {}).map(([k, v]) => [ui.esc(k), `<span class="num">${v.correct}/${v.total}</span>`]);
          status = `<p>${b.passed ? ui.tag(`passed — ${b.pct}% (line ${b.passLine}%)`, 'ok') : ui.tag(`FAILED — ${b.pct}% (line ${b.passLine}%)`, 'gate')} <span class="num">${ui.esc(b.model)}</span>, benched ${ui.esc(String(b.finishedAt || '').slice(0, 10))}</p>
          ${ui.table(['Subject', 'Score'], rows)}
          ${b.passed ? '' : `<p class="note">This model failed Chambers' own bar. Do not rely on it for drafting or research suggestions — every gate still applies, but a failing model wastes the verifier's time with confident wrong answers.</p>`}`;
        }
        else if (b && b.status === 'failed' && !stale) status = `<p>${ui.tag('bench errored', 'gate')} ${ui.esc(b.message || '')}</p>`;
        else status = `<p>${ui.tag('never benched', 'gate')} This exact model has not been measured. Run the bench before relying on drafting or research assistance.</p>`;
        return `<h2 class="sec">Competence bench</h2>${status}
        ${running ? '' : `<form method="POST" action="/admin/bench"><button>Bench this model — 48 bar-style questions</button></form>`}
        <p class="note">Original Ontario/Canadian black-letter questions, independently reviewed, sent through the same gateway the rooms use and graded strictly (an unparseable answer is wrong). Passing means the model clears Chambers' ${''}own line — it does not make the model a lawyer, and no score moves responsibility off the licensee: the citation gate and human verification apply to every output regardless.</p>`;
      })()}
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
app.route('POST', '/admin/bench', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  const cfg = ctx.kernel.ai.config();
  if (!cfg || !cfg.endpoint || !cfg.model) { ctx.setFlash('Configure the model gateway first.', 'err'); redirect(res, '/admin'); return; }
  const existing = ctx.kernel.firm.get('setting', 'bench');
  if (existing && existing.status === 'running' && (Date.now() - (existing.startedAt || 0)) < 30 * 60 * 1000) {
    ctx.setFlash('A bench is already running — refresh in a few minutes.', 'err'); redirect(res, '/admin'); return;
  }
  // The run is fire-and-forget in-process: 48 sequential model calls against a
  // local model can take minutes, and an admin POST must not hang for that.
  // The result lands in the 'bench' setting; /admin shows it on refresh. The
  // questions are fixed public doctrine — never client content — so the run is
  // audited as ONE action rather than 48 lines of chain noise.
  const by = ctx.user.id;
  store.firm.put('setting', { id: 'bench', status: 'running', startedAt: Date.now(), model: cfg.model, endpoint: cfg.endpoint }, by);
  audit.log(by, 'ai.bench.started', cfg.model);
  barbench.run(cfg, aiChat).then((r) => {
    if (!r.ok) { store.firm.put('setting', { id: 'bench', status: 'failed', startedAt: Date.now(), finishedAt: new Date().toISOString(), model: cfg.model, endpoint: cfg.endpoint, message: r.message }, by); return; }
    store.firm.put('setting', { id: 'bench', status: 'done', finishedAt: new Date().toISOString(), model: cfg.model, endpoint: cfg.endpoint, total: r.total, correct: r.correct, pct: r.pct, passLine: r.passLine, passed: r.passed, bySubject: r.bySubject, wrong: r.wrong }, by);
    audit.log(by, 'ai.bench.finished', `${cfg.model}:${r.correct}/${r.total}:${r.passed ? 'passed' : 'failed'}`);
  }).catch((e) => {
    store.firm.put('setting', { id: 'bench', status: 'failed', finishedAt: new Date().toISOString(), model: cfg.model, endpoint: cfg.endpoint, message: String(e.message || e) }, by);
  });
  ctx.setFlash('Bench started — 48 questions through the gateway. Refresh /admin in a few minutes for the score.');
  redirect(res, '/admin');
});
app.route('POST', '/admin/wall/remove', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  // Only a wall you are NOT screened by can be lifted — ctx.kernel.walls()
  // already omits the one screening you, so a screened lawyer cannot quietly
  // lift their own wall. With two seats the other administrator does it.
  const wall = ctx.kernel.walls().find((w) => w.id === ctx.body.wallId);
  if (!wall) { ctx.setFlash('That wall is not yours to lift.', 'err'); redirect(res, '/admin'); return; }
  ctx.kernel.firm.del('wall', wall.id);
  ctx.setFlash('Wall lifted.');
  redirect(res, '/admin');
});
app.route('POST', '/admin/deactivate', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  // Releasing a seat is what makes a lost authenticator or a departing partner
  // survivable: the seat lock counts ACTIVE users, so without this the cap is
  // reached once and never falls again.
  const out = auth.deactivate(ctx.body.userId, ctx.user.id);
  if (out.error) { ctx.setFlash(out.error, 'err'); redirect(res, '/admin'); return; }
  ctx.setFlash('Seat released. You can now invite a replacement.');
  redirect(res, '/admin');
});
app.route('POST', '/admin/wall', (req, res, ctx) => {
  if (!ctx.kernel.isAdmin()) { send(res, 404, 'Not found.'); return; }
  // Walling YOURSELF is unrecoverable through the UI: the wall would then be
  // hidden from you (that is the point of a wall), so you could not lift it, and
  // a matter walled against both seats is unreachable forever. Refuse it.
  if (ctx.body.userId === ctx.user.id) {
    ctx.setFlash('You cannot screen yourself — you would not be able to see the wall to lift it. Ask the other administrator.', 'err');
    redirect(res, '/admin'); return;
  }
  // The form is a pair of selects, but a POST is a POST: check both ids are real
  // before writing a record that silently screens nobody off nothing.
  const target = ctx.kernel.firm.get('user', ctx.body.userId);
  const onMatter = ctx.kernel.matter(ctx.body.matterId);
  if (!target || !onMatter) {
    ctx.setFlash('Pick an existing matter and an existing person.', 'err');
    redirect(res, '/admin'); return;
  }
  ctx.kernel.firm.put('wall', { matterId: onMatter.id, screened: [target.id], basis: String(ctx.body.basis || '').slice(0, 500) });
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
