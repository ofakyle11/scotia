'use strict';
// Server-rendered UI. One deliberate dark theme — this is a private tool,
// not a website. Every room renders through layout(); helpers keep markup safe.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{
  --ground:#0B0E14;--surface:#131822;--surface-2:#1A2130;--ink:#E8EBF1;--ink-soft:#A7B0BE;
  --ink-faint:#6E7886;--rule:#273043;--rule-soft:#1E2635;--navy:#8FB3E6;--navy-deep:#2C4A7C;
  --oxide:#E08379;--oxide-wash:rgba(224,131,121,.12);--navy-wash:rgba(143,179,230,.10);--ok:#7FC8A9;
  --f-display:"Spectral",Georgia,serif;--f-body:"Public Sans","Helvetica Neue",Arial,sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--f-body);font-size:14.5px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--navy);text-decoration:none}a:hover{text-decoration:underline}
.shell{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
.side{border-right:1px solid var(--rule);background:var(--surface);padding:18px 0 30px;position:sticky;top:0;height:100vh;overflow-y:auto}
.wordmark{font-family:var(--f-display);font-style:italic;font-weight:700;font-size:19px;padding:2px 20px 14px;border-bottom:1px solid var(--rule-soft);letter-spacing:.2px}
.wordmark small{display:block;font-family:var(--f-mono);font-style:normal;font-weight:400;font-size:9px;letter-spacing:.22em;color:var(--ink-faint);text-transform:uppercase;margin-top:3px}
.nav-phase{font-family:var(--f-mono);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint);padding:16px 20px 5px}
.nav a{display:flex;gap:9px;align-items:baseline;padding:4.5px 20px;color:var(--ink-soft);font-size:13px}
.nav a:hover{background:var(--surface-2);text-decoration:none;color:var(--ink)}
.nav a.on{background:var(--navy-wash);color:var(--ink);border-right:2px solid var(--navy)}
.nav a .n{font-family:var(--f-mono);font-size:10px;color:var(--ink-faint);min-width:18px}
.main{padding:0 34px 60px;min-width:0}
.topbar{display:flex;align-items:center;gap:14px;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--rule);margin-bottom:26px}
.topbar .who{font-family:var(--f-mono);font-size:11px;color:var(--ink-faint)}
.topbar form{margin:0}
h1.room{font-family:var(--f-display);font-size:27px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em}
.roomsub{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 24px}
h2.sec{font-family:var(--f-display);font-size:18.5px;font-weight:600;margin:30px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
.card{background:var(--surface);border:1px solid var(--rule);padding:18px 20px;margin:0 0 16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
table.t{border-collapse:collapse;width:100%;font-size:13px;background:var(--surface);border:1px solid var(--rule)}
table.t th{font-family:var(--f-mono);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint);text-align:left;padding:9px 12px;background:var(--surface-2);border-bottom:1px solid var(--rule);font-weight:500}
table.t td{padding:9px 12px;border-bottom:1px solid var(--rule-soft);vertical-align:top}
table.t tr:last-child td{border-bottom:0}
.num{font-variant-numeric:tabular-nums;font-family:var(--f-mono);font-size:12px}
label{display:block;font-family:var(--f-mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint);margin:12px 0 5px}
input,select,textarea{width:100%;background:var(--ground);border:1px solid var(--rule);color:var(--ink);padding:8px 10px;font-family:var(--f-body);font-size:14px;border-radius:0}
textarea{min-height:90px;resize:vertical}
input:focus,select:focus,textarea:focus,button:focus{outline:2px solid var(--navy);outline-offset:1px}
button,.btn{display:inline-block;background:var(--navy-deep);border:1px solid var(--navy-deep);color:#fff;padding:8px 16px;font-family:var(--f-mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;margin-top:14px}
button:hover,.btn:hover{filter:brightness(1.15);text-decoration:none}
button.danger{background:transparent;border-color:var(--oxide);color:var(--oxide)}
button.quiet{background:transparent;border-color:var(--rule);color:var(--ink-soft);margin-top:0;padding:4px 10px}
.tag{font-family:var(--f-mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:2px 7px;border:1px solid var(--rule);color:var(--ink-faint);white-space:nowrap}
.tag.gate{color:var(--oxide);border-color:var(--oxide);background:var(--oxide-wash)}
.tag.ok{color:var(--ok);border-color:var(--ok)}
.tag.navy{color:var(--navy);border-color:var(--navy);background:var(--navy-wash)}
.kv{display:grid;grid-template-columns:150px 1fr;gap:4px 14px;font-size:13px}
.kv dt{font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);padding-top:2px}
.kv dd{margin:0;color:var(--ink-soft)}
.empty{border:1px dashed var(--rule);padding:26px;text-align:center;color:var(--ink-faint);font-size:13px;background:var(--surface)}
.note{font-size:12.5px;color:var(--ink-faint);line-height:1.55;margin-top:8px}
.flash{border:1px solid var(--navy);background:var(--navy-wash);padding:10px 14px;font-size:13px;margin-bottom:16px}
.flash.err{border-color:var(--oxide);background:var(--oxide-wash)}
.mselect{display:flex;gap:8px;align-items:center}
.mselect select{width:auto;max-width:340px}
.mselect button{margin-top:0;padding:8px 12px}
@media(max-width:900px){.shell{grid-template-columns:1fr}.side{position:static;height:auto}.grid2,.grid3{grid-template-columns:1fr}}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,600;0,700;1,400&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">`;

function layout(ctx, { title, body, sub }) {
  const { user, registry, matter, matters, room, flash } = ctx;
  const phases = [];
  for (const r of registry) {
    let g = phases.find((p) => p.name === r.phase);
    if (!g) { g = { name: r.phase, rooms: [] }; phases.push(g); }
    g.rooms.push(r);
  }
  const nav = phases.map((p) => `
    <div class="nav-phase">${esc(p.name)}</div>
    ${p.rooms.map((r) => `<a href="/r/${r.id}" class="${room === r.id ? 'on' : ''}"><span class="n">${String(r.num).padStart(2, '0')}</span>${esc(r.title)}</a>`).join('')}
  `).join('');
  const mopts = (matters || []).map((m) => `<option value="${m.id}" ${matter && matter.id === m.id ? 'selected' : ''}>${esc(m.title)}</option>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>${FONTS}<style>${CSS}</style></head><body>
<div class="shell">
  <aside class="side">
    <div class="wordmark">Chambers<small>Private &middot; Privileged</small></div>
    <nav class="nav">${nav}</nav>
  </aside>
  <div class="main">
    <div class="topbar">
      <form method="POST" action="/matter/select" class="mselect">
        <select name="matter" aria-label="Matter">${mopts || '<option value="">No matters yet</option>'}</select>
        <button class="quiet">Open</button>
      </form>
      <span class="who">${esc(user.name)} · ${esc(user.role)} · <a href="/account" style="color:inherit">account</a> · <a href="/logout-form" style="color:inherit">sign out</a></span>
    </div>
    ${flash ? `<div class="flash ${flash.kind === 'err' ? 'err' : ''}">${esc(flash.msg)}</div>` : ''}
    <h1 class="room">${esc(title)}</h1>
    ${sub ? `<p class="roomsub">${esc(sub)}</p>` : ''}
    ${body}
  </div>
</div></body></html>`;
}

// The front door: bare, unmarked, confirms nothing.
function loginPage(err) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in</title>${FONTS}<style>${CSS}
body{display:flex;align-items:center;justify-content:center;min-height:100vh}
.door{width:340px;border:1px solid var(--rule);background:var(--surface);padding:34px 32px 30px}
.door .rule{height:2px;background:var(--navy-deep);margin-bottom:26px}
</style></head><body>
<div class="door"><div class="rule"></div>
${err ? '<div class="flash err">Access denied.</div>' : ''}
<form method="POST" action="/login">
<label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username" required autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button style="width:100%">Sign in</button>
</form>
</div></body></html>`;
}

// Second factor challenge — same bare door, still confirms nothing.
function totpPage(pendingToken, err) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in</title>${FONTS}<style>${CSS}
body{display:flex;align-items:center;justify-content:center;min-height:100vh}
.door{width:340px;border:1px solid var(--rule);background:var(--surface);padding:34px 32px 30px}
.door .rule{height:2px;background:var(--navy-deep);margin-bottom:26px}
</style></head><body>
<div class="door"><div class="rule"></div>
${err ? '<div class="flash err">Access denied.</div>' : ''}
<form method="POST" action="/login/totp">
<input type="hidden" name="pending" value="${esc(pendingToken)}">
<label for="c">Authenticator code</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
<button style="width:100%">Continue</button>
</form>
</div></body></html>`;
}

function enrollPage(invite, err) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Enrollment</title>${FONTS}<style>${CSS}
body{display:flex;align-items:center;justify-content:center;min-height:100vh}
.door{width:380px;border:1px solid var(--rule);background:var(--surface);padding:34px 32px 30px}
.door .rule{height:2px;background:var(--navy-deep);margin-bottom:26px}
</style></head><body>
<div class="door"><div class="rule"></div>
${err ? `<div class="flash err">${esc(err)}</div>` : ''}
<p style="font-size:13px;color:var(--ink-soft);margin:0 0 6px">Provisioned access for <b>${esc(invite.email)}</b> (${esc(invite.role)}).</p>
<form method="POST" action="/invite/${esc(invite.code)}">
<label for="p1">Choose a password (12+ characters)</label><input id="p1" name="password" type="password" autocomplete="new-password" minlength="12" required autofocus>
<button style="width:100%">Enroll &amp; enter</button>
</form>
</div></body></html>`;
}

// ---- small components ----
const table = (cols, rows) => rows.length
  ? `<table class="t"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : '';
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
const tag = (txt, kind = '') => `<span class="tag ${kind}">${esc(txt)}</span>`;
const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const input = (name, labelTxt, opts = {}) => `<label for="${name}">${esc(labelTxt)}</label><input id="${name}" name="${name}" type="${opts.type || 'text'}" value="${esc(opts.value || '')}" ${opts.required ? 'required' : ''} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}>`;
const textarea = (name, labelTxt, opts = {}) => `<label for="${name}">${esc(labelTxt)}</label><textarea id="${name}" name="${name}" ${opts.required ? 'required' : ''} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}>${esc(opts.value || '')}</textarea>`;
const select = (name, labelTxt, options, selected) => `<label for="${name}">${esc(labelTxt)}</label><select id="${name}" name="${name}">${options.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
const date = (d) => d ? `<span class="num">${esc(String(d).slice(0, 10))}</span>` : '';
const money = (n) => `<span class="num">$${Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;

module.exports = { esc, layout, loginPage, totpPage, enrollPage, table, empty, tag, kv, input, textarea, select, date, money };
