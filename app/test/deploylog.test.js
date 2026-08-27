'use strict';
// An enrolment link creates a FULL ADMIN SEAT and stays live for up to seven
// days. Caddy's access log records the request URI, so /invite/<token> sat in
// /var/log/caddy/chambers-access.log — plaintext, root-readable, and collected
// by any log shipper — for the whole window the token was usable. The journal
// half of this was fixed earlier (first boot writes the links to a 0600 file
// instead of stdout); the reverse proxy half was not.
//
// The Caddyfile now carries a `log_skip` block for /invite/*. That directive
// needs Caddy >= 2.5, so install.sh strips the block and warns rather than
// dying on an older Caddy — a hardening line must not block a deploy.
//
// This suite guards the seam between two files that have no compiler between
// them: if someone edits the Caddyfile's markers, install.sh's sed silently
// stops matching and the fallback becomes a no-op that still reports success.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { execFileSync } = require('child_process');

const DEPLOY = path.join(__dirname, '..', 'deploy');
const caddyfile = fs.readFileSync(path.join(DEPLOY, 'Caddyfile'), 'utf8');
const installsh = fs.readFileSync(path.join(DEPLOY, 'install.sh'), 'utf8');
const fails = [];

// 1. The directive is actually there, and scoped to the invite path only.
if (!/^\s*log_skip @invite\s*$/m.test(caddyfile)) fails.push('Caddyfile no longer skips access-logging for the invite path');
if (!/^\s*@invite path \/invite\/\*\s*$/m.test(caddyfile)) fails.push('the @invite matcher is missing or no longer matches /invite/*');
// It must NOT disable logging generally — an access log is worth having.
if (!/output file \/var\/log\/caddy\/chambers-access\.log/.test(caddyfile)) fails.push('the access log itself was removed; only the invite path should be skipped');

// 2. install.sh's sed range must match the markers the Caddyfile actually uses.
const m = installsh.match(/sed -i '\/([^/]+)\/,\/([^/]+)\/d' \/etc\/caddy\/Caddyfile/);
assert(m, 'install.sh no longer strips the log_skip block with a marker-range sed');
for (const marker of [m[1], m[2]]) {
  if (!caddyfile.includes(marker)) fails.push(`install.sh strips on marker "${marker}", which does not appear in the Caddyfile — the fallback is a silent no-op`);
}

// 3. Run that exact sed and prove it removes the block and nothing else.
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caddyf-')), 'Caddyfile');
fs.writeFileSync(tmp, caddyfile);
execFileSync('sed', ['-i', `/${m[1]}/,/${m[2]}/d`, tmp]);
const stripped = fs.readFileSync(tmp, 'utf8');
if (/log_skip/.test(stripped)) fails.push('the fallback sed left log_skip behind — an old Caddy would still reject the file');
for (const keep of ['reverse_proxy 127.0.0.1:8028', 'chambers-access.log', 'Strict-Transport-Security']) {
  if (!stripped.includes(keep)) fails.push(`the fallback sed removed more than the block: "${keep}" is gone`);
}
// Braces must still balance, or Caddy rejects the file for a different reason.
const open = (stripped.match(/{/g) || []).length, close = (stripped.match(/}/g) || []).length;
if (open !== close) fails.push(`the fallback sed unbalanced the braces (${open} open, ${close} close)`);

// 4. The claim the comment makes — "nothing evidential is lost" — must be true:
//    the app's own audit chain has to record invite creation and redemption, or
//    skipping the access log really would erase the only record.
const auth = fs.readFileSync(path.join(__dirname, '..', 'kernel', 'auth.js'), 'utf8');
for (const ev of ['invite.created', 'invite.seat.created']) {
  if (!auth.includes(ev)) fails.push(`kernel/auth.js no longer audits ${ev} — skipping the access log would leave no record of enrolment at all`);
}

if (fails.length) { console.log('DEPLOY LOG FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('DEPLOY LOG: ALL PASS (invite path excluded from the access log, access log kept, installer fallback strips cleanly and stays in sync with the markers)');
