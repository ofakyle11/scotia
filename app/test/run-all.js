'use strict';
// ============================================================================
// Chambers — THE GATE. One command runs everything.
//
//     cd app && node test/run-all.js
//
// Nobody (human or CI) should have to remember the list of suites. This file
// DISCOVERS them: every *.test.js in this directory, plus the room harness
// (test/harness.js, which is not named *.test.js). A new test file dropped in
// here is picked up automatically on the next run — no edit to this file, no
// edit to CI.
//
// Order is deliberate: fast unit-ish proofs first (they fail in milliseconds and
// tell you the kernel is broken before you wait on anything), then the room
// suites — harness.js (all 36 rooms, EMPTY state) then seeded.test.js (all 36
// rooms rendered WITH real records), then the real-browser test last because it
// launches Chromium and takes ~45s. Unknown/new suites run in the fast tier,
// alphabetically, so an unclassified test still runs.
//
// Each suite runs in its own child process (own port, own temp CHAMBERS_DATA,
// own crash blast radius) with a timeout, in its own process group so a hung
// suite's grandchildren — e.g. the `node server.js` the browser test spawns —
// die with it.
//
// A suite that exits 0 while announcing it skipped (the browser test with no
// Chromium present) is a PASS-with-skip, not a failure: CI without a browser
// still goes green, and the summary says plainly that it skipped.
//
// Exit code: 0 = every suite passed (or cleanly skipped); 1 = something failed
// or timed out; 2 = the runner itself could not run (bad filter, no suites).
//
// Usage:
//   node test/run-all.js                 run the whole gate
//   node test/run-all.js crypto gate     run only suites matching those words
//   node test/run-all.js --list          print the plan, run nothing
//   node test/run-all.js --verbose       stream each suite's output live
//   node test/run-all.js --bail          stop at the first failure
//   node test/run-all.js --timeout=90000 override every per-suite timeout (ms)
//   CHAMBERS_TEST_TIMEOUT_MS=90000       same, via env (for CI)
//
// Zero dependencies. Node 22, stdlib only.
// ============================================================================

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DIR = __dirname;
const APP_DIR = path.resolve(TEST_DIR, '..');
const SELF = path.basename(__filename);

// Tiers: lower runs first. 0 = fast unit-ish, 1 = the 36-room suites, 2 = browser.
const TIER_FAST = 0, TIER_ROOMS = 1, TIER_BROWSER = 2;

const MINUTE = 60000;

// Known suites: tier, intra-tier order, timeout, and the one-line reason this
// suite exists. Anything NOT listed here is still discovered and run (fast tier,
// alphabetical, default timeout) — the list is ordering/annotation, not a gate.
const KNOWN = {
  'canlii.test.js':    { tier: TIER_FAST, order: 10, timeout: MINUTE, why: 'citation parsing + CanLII id derivation (offline)' },
  'totp.test.js':      { tier: TIER_FAST, order: 20, timeout: MINUTE, why: 'RFC 6238 TOTP vectors' },
  'crypto.test.js':    { tier: TIER_FAST, order: 30, timeout: MINUTE, why: 'ciphertext at rest, walls deny pre-unwrap, shred is permanent' },
  'audit.test.js':     { tier: TIER_FAST, order: 40, timeout: MINUTE, why: 'hash-chained audit trail detects forgery' },
  'replay.test.js':    { tier: TIER_FAST, order: 50, timeout: MINUTE, why: 'a TOTP code cannot be replayed' },
  'gate.test.js':      { tier: TIER_FAST, order: 60, timeout: MINUTE, why: 'citation gate: extract -> block -> verify -> clear -> file' },
  'improve.test.js':   { tier: TIER_FAST, order: 70, timeout: MINUTE, why: 'phase-2 cross-room handshakes' },
  'pleadcite.test.js': { tier: TIER_FAST, order: 80, timeout: MINUTE, why: 'a pleading is citation-scannable end to end' },
  'seam.test.js':      { tier: TIER_FAST, order: 90, timeout: MINUTE, why: 'R-A / R-D cross-room seams hold' },
  'seats.test.js':     { tier: TIER_FAST, order: 100, timeout: MINUTE, why: 'two named seats, no third account, self-set credentials' },
  'staleverify.test.js': { tier: TIER_FAST, order: 110, timeout: MINUTE, why: 'a superseded or dark-day deadline is flagged on both diaries and refuses the dual-diary tick' },

  'harness.js':        { tier: TIER_ROOMS, order: 10, timeout: 3 * MINUTE, why: 'all 36 rooms render + no POST 500s (EMPTY state)' },
  'seeded.test.js':    { tier: TIER_ROOMS, order: 20, timeout: 3 * MINUTE, why: 'all 36 rooms render WITH real records of every type' },

  'browser.test.js':   { tier: TIER_BROWSER, order: 10, timeout: 6 * MINUTE, why: 'real Chromium through real enrollment (skips without a browser)' },
};

const DEFAULT_TIMEOUT = 2 * MINUTE;
const MAX_CAPTURE = 512 * 1024;   // per suite; enough for any real failure dump
const KILL_GRACE_MS = 5000;       // SIGTERM -> SIGKILL

// ---------------------------------------------------------------- args -----
const argv = process.argv.slice(2);
const flags = { list: false, verbose: false, bail: false, timeout: null };
const filters = [];
for (const a of argv) {
  if (a === '--list' || a === '-l') flags.list = true;
  else if (a === '--verbose' || a === '-v') flags.verbose = true;
  else if (a === '--bail' || a === '-b') flags.bail = true;
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  else if (a.startsWith('--timeout=')) flags.timeout = Number(a.slice(10));
  else if (a.startsWith('-')) { console.error('run-all: unknown option ' + a + ' (try --help)'); process.exit(2); }
  else filters.push(a.toLowerCase());
}
if (flags.timeout !== null && !(flags.timeout > 0)) { console.error('run-all: --timeout needs a positive number of milliseconds'); process.exit(2); }
const envTimeout = Number(process.env.CHAMBERS_TEST_TIMEOUT_MS);
const timeoutOverride = flags.timeout || (envTimeout > 0 ? envTimeout : null);

function printHelp() {
  console.log([
    'Chambers gate runner — runs every suite in app/test and reports one verdict.',
    '',
    '  node test/run-all.js                 run the whole gate',
    '  node test/run-all.js crypto gate     run only suites matching those words',
    '  node test/run-all.js --list          print the plan, run nothing',
    '  node test/run-all.js --verbose       stream each suite\'s output live',
    '  node test/run-all.js --bail          stop at the first failure',
    '  node test/run-all.js --timeout=90000 override every per-suite timeout (ms)',
    '',
    'Exit 0 = all green (a cleanly skipped suite counts as green), 1 = a suite',
    'failed or timed out, 2 = the runner could not run.',
  ].join('\n'));
}

// ----------------------------------------------------------- discovery -----
function discover() {
  let entries;
  try { entries = fs.readdirSync(TEST_DIR); }
  catch (e) { console.error('run-all: cannot read ' + TEST_DIR + ': ' + e.message); process.exit(2); }

  const names = entries.filter((f) => f !== SELF && f.endsWith('.test.js'));
  if (entries.includes('harness.js')) names.push('harness.js'); // the room harness is not *.test.js

  const suites = names.map((name) => {
    const k = KNOWN[name] || null;
    return {
      name,
      file: path.join(TEST_DIR, name),
      tier: k ? k.tier : TIER_FAST,
      order: k ? k.order : 500,
      timeout: timeoutOverride || (k ? k.timeout : DEFAULT_TIMEOUT),
      why: k ? k.why : '(new suite — not yet annotated in run-all.js)',
      known: !!k,
    };
  });

  suites.sort((a, b) => (a.tier - b.tier) || (a.order - b.order) || a.name.localeCompare(b.name));
  return suites;
}

const TIER_LABEL = { [TIER_FAST]: 'unit', [TIER_ROOMS]: 'rooms', [TIER_BROWSER]: 'browser' };

// -------------------------------------------------------------- runner -----
let activeChild = null;
let interrupted = false;

function runSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.relative(APP_DIR, suite.file)], {
      cwd: APP_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group: killing it kills any server it spawned
    });
    activeChild = child;

    let out = '';   // stdout+stderr interleaved, for the failure dump
    let err = '';   // stderr only, so a crash's real message beats Node's epilogue
    let truncated = false;
    const capture = (buf) => {
      if (flags.verbose) process.stdout.write(buf);
      if (out.length >= MAX_CAPTURE) { truncated = true; return; }
      out += buf.toString();
      if (out.length > MAX_CAPTURE) { out = out.slice(0, MAX_CAPTURE); truncated = true; }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', (buf) => { capture(buf); if (err.length < MAX_CAPTURE) err += buf.toString(); });

    let timedOut = false;
    let hardKill = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      hardKill = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS);
      if (hardKill.unref) hardKill.unref();
    }, suite.timeout);

    const finish = (code, signal, spawnError) => {
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      activeChild = null;
      const ms = Date.now() - started;
      let status;
      if (spawnError) status = 'ERROR';
      else if (timedOut) status = 'TIMEOUT';
      else if (code === 0) status = looksSkipped(out) ? 'SKIP' : 'PASS';
      else status = 'FAIL';
      resolve({
        suite, status, ms, code, signal, truncated,
        output: spawnError ? String(spawnError.stack || spawnError.message) : out,
        lastLine: spawnError ? 'spawn failed: ' + spawnError.message : summaryLine(status, out, err),
      });
    };

    child.on('error', (e) => finish(null, null, e));
    child.on('close', (code, signal) => finish(code, signal, null));
  });
}

function killGroup(child, sig) {
  try { process.kill(-child.pid, sig); }       // whole group (detached spawn)
  catch (_) { try { child.kill(sig); } catch (__) {} }
}

// A suite that exits 0 and says it skipped (no Chromium, no optional tooling) is
// green-with-a-note, never a failure. Exit code still has to be 0 to get here.
function looksSkipped(out) {
  return /\bskipp(?:ed|ing)\b/i.test(out);
}

function lastMeaningfulLine(out) {
  const lines = String(out).split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim().length);
  return lines.length ? lines[lines.length - 1].trim() : '(no output)';
}

// The last line of a crashed Node process is "Node.js v22.x" — useless in a
// summary table. For a failing suite, surface the first line that actually
// names the failure (assertion message, thrown Error, a harness FAIL line);
// fall back to the genuine last line of output.
const ERROR_LINE = /(?:^|\s)(?:[A-Za-z_$][\w$]*Error\b|FAILURES?\b|FAIL\b|not ok\b)/;
function pickErrorLine(text) {
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^Node\.js v/.test(t) || /^at /.test(t) || /^throw\b/.test(t) || /^\^+$/.test(t) || /^node:/.test(t)) continue;
    if (ERROR_LINE.test(t)) return t;
  }
  return null;
}
function summaryLine(status, out, err) {
  if (status !== 'PASS' && status !== 'SKIP') {
    const hit = pickErrorLine(err) || pickErrorLine(out);
    if (hit) return hit;
  }
  return lastMeaningfulLine(out);
}

// -------------------------------------------------------------- output -----
function secs(ms) { return (ms / 1000).toFixed(2) + 's'; }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function clip(s, n) { s = String(s).replace(/\s+/g, ' '); return s.length <= n ? s : s.slice(0, Math.max(1, n - 3)) + '...'; }
function rule(n) { return '-'.repeat(n); }

function termWidth() {
  const w = process.stdout.columns;
  return Number.isInteger(w) && w >= 60 ? Math.min(w, 200) : 110;
}

// ---------------------------------------------------------------- main -----
(async () => {
  const all = discover();
  if (!all.length) { console.error('run-all: no suites found in ' + TEST_DIR); process.exit(2); }

  const suites = filters.length
    ? all.filter((s) => filters.some((f) => s.name.toLowerCase().includes(f)))
    : all;
  if (!suites.length) {
    console.error('run-all: no suite matches ' + JSON.stringify(filters) + '. Available:');
    for (const s of all) console.error('  ' + s.name);
    process.exit(2);
  }

  const nameW = Math.max(12, ...suites.map((s) => s.name.length));

  if (flags.list) {
    console.log('Chambers gate — plan (' + suites.length + ' suite' + (suites.length === 1 ? '' : 's') + ', run in this order)\n');
    console.log('  ' + pad('#', 3) + ' ' + pad('SUITE', nameW) + '  ' + pad('TIER', 8) + ' ' + padL('TIMEOUT', 8) + '  WHY IT EXISTS');
    console.log('  ' + rule(3) + ' ' + rule(nameW) + '  ' + rule(8) + ' ' + rule(8) + '  ' + rule(46));
    suites.forEach((s, i) => {
      console.log('  ' + pad(i + 1, 3) + ' ' + pad(s.name, nameW) + '  ' + pad(TIER_LABEL[s.tier], 8) + ' ' + padL(Math.round(s.timeout / 1000) + 's', 8) + '  ' + s.why);
    });
    process.exit(0);
  }

  const banner = 'CHAMBERS GATE';
  console.log('\n' + banner);
  console.log(rule(banner.length));
  console.log(suites.length + ' suite' + (suites.length === 1 ? '' : 's') + ' · node ' + process.version + ' · ' + APP_DIR + ' · ' + new Date().toISOString());
  if (filters.length) console.log('filtered by: ' + filters.join(', ') + ' (of ' + all.length + ' discovered)');
  const unannotated = suites.filter((s) => !s.known).map((s) => s.name);
  if (unannotated.length) console.log('auto-discovered (new, running in the fast tier): ' + unannotated.join(', '));
  console.log('');

  const results = [];
  const t0 = Date.now();
  let bailed = 0;

  for (let i = 0; i < suites.length; i++) {
    const s = suites[i];
    const label = '  ' + padL(i + 1, 2) + '/' + suites.length + '  ' + pad(s.name, nameW) + '  ';
    // On a terminal, show "running..." and overwrite it with the verdict. In a
    // pipe or CI log there is no cursor to rewind, so print one line per suite.
    const live = process.stdout.isTTY && !flags.verbose;
    if (flags.verbose) console.log(label.trimEnd() + '  running...');
    else if (live) process.stdout.write(label + 'running...');
    const r = await runSuite(s);
    results.push(r);
    if (flags.verbose) console.log(label.trimEnd() + '  -> ' + r.status + ' in ' + secs(r.ms));
    else process.stdout.write((live ? '\r' : '') + label + pad(r.status, 8) + padL(secs(r.ms), 9) + '\n');

    if (interrupted) { bailed = suites.length - results.length; break; }
    if (flags.bail && (r.status === 'FAIL' || r.status === 'TIMEOUT' || r.status === 'ERROR')) {
      bailed = suites.length - results.length;
      break;
    }
  }

  const totalMs = Date.now() - t0;
  const bad = results.filter((r) => r.status !== 'PASS' && r.status !== 'SKIP');

  // ---- failure detail first, so the summary table stays the last thing read.
  if (bad.length) {
    console.log('\n' + rule(termWidth()));
    console.log('FAILURE DETAIL');
    console.log(rule(termWidth()));
    for (const r of bad) {
      console.log('\n### ' + r.suite.name + ' — ' + r.status +
        (r.status === 'TIMEOUT' ? ' after ' + secs(r.suite.timeout) : '') +
        (r.code !== null && r.code !== undefined ? ' (exit ' + r.code + ')' : '') +
        (r.signal ? ' (signal ' + r.signal + ')' : ''));
      console.log('    command: node ' + path.relative(APP_DIR, r.suite.file) + '   (cwd ' + APP_DIR + ')');
      const body = (r.output || '').replace(/\s+$/, '');
      console.log(body ? body.split(/\r?\n/).map((l) => '    | ' + l).join('\n') : '    | (no output)');
      if (r.truncated) console.log('    | ... output truncated at ' + MAX_CAPTURE + ' bytes');
    }
  }

  // ---- summary table
  const width = termWidth();
  const fixed = 2 + 3 + 1 + nameW + 2 + 8 + 1 + 9 + 2;
  const lastW = Math.max(24, width - fixed);
  console.log('\n' + rule(width));
  console.log('SUMMARY');
  console.log(rule(width));
  console.log('  ' + pad('#', 3) + ' ' + pad('SUITE', nameW) + '  ' + pad('RESULT', 8) + ' ' + padL('TIME', 9) + '  ' + 'LAST LINE');
  console.log('  ' + rule(3) + ' ' + rule(nameW) + '  ' + rule(8) + ' ' + rule(9) + '  ' + rule(lastW));
  results.forEach((r, i) => {
    console.log('  ' + pad(i + 1, 3) + ' ' + pad(r.suite.name, nameW) + '  ' + pad(r.status, 8) + ' ' + padL(secs(r.ms), 9) + '  ' + clip(r.lastLine, lastW));
  });
  if (bailed) console.log('  ' + pad('', 3) + ' ' + pad('(' + bailed + ' not run)', nameW) + '  ' + pad(interrupted ? 'INTERRUPT' : 'BAILED', 8));
  console.log(rule(width));

  const passed = results.filter((r) => r.status === 'PASS').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const counts = [
    passed + ' passed',
    skipped ? skipped + ' skipped' : null,
    bad.length + ' failed',
    bailed ? bailed + ' not run' : null,
  ].filter(Boolean).join(', ');
  console.log(results.length + ' suite' + (results.length === 1 ? '' : 's') + ' run: ' + counts + '  in ' + secs(totalMs));
  for (const r of results.filter((x) => x.status === 'SKIP')) console.log('  skipped: ' + r.suite.name + ' — ' + clip(r.lastLine, width - 20));

  const ok = bad.length === 0 && !bailed && !interrupted;
  if (!ok) {
    if (bad.length) console.log('FAILING SUITES: ' + bad.map((r) => r.suite.name + ' (' + r.status.toLowerCase() + (r.status === 'FAIL' ? ' exit ' + r.code : '') + ')').join(', '));
    console.log('\nGATE: FAIL');
    process.exit(1);
  }
  console.log('\nGATE: PASS');
  process.exit(0);
})().catch((e) => {
  console.error('\nrun-all crashed: ' + (e && e.stack ? e.stack : e));
  console.error('\nGATE: FAIL');
  process.exit(1);
});

// Ctrl-C / CI cancellation: take the running suite (and its process group) down
// with us, then report a FAIL rather than leaving orphans behind.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interrupted) process.exit(130);  // second Ctrl-C: hard out
    interrupted = true;
    process.stdout.write('\n\nInterrupted (' + sig + ') — stopping the running suite...\n');
    if (activeChild) killGroup(activeChild, 'SIGTERM');
    // Backstop: if the suite refuses to die, do not hang the terminal.
    setTimeout(() => { console.log('\nGATE: FAIL (interrupted)'); process.exit(130); }, 8000);
  });
}
