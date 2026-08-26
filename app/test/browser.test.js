'use strict';
// REAL-BROWSER regression test. Every fetch()-based test in this suite passes an
// explicit Origin header, so none of them can catch a defect that only appears
// under a real browser's headers. One did exist and made the whole app unusable:
// Referrer-Policy 'no-referrer' caused Chromium to send a literal `Origin: null`
// on same-origin form posts, and parsing that threw -> HTTP 500 on EVERY form
// submission (enrollment, login, saving anything). This test drives Chromium
// through real enrollment and asserts the app renders, so it cannot regress.
//
// Needs playwright + a Chromium build. Both are DISCOVERED, never hardcoded: this
// file previously defaulted to one build container's scratchpad and to
// chromium-1194, so on any other machine both paths were dead and the test exited
// 0 as "skipped" — a browser gate that silently stops guarding the moment it
// leaves the machine it was written on. Order: explicit env override, then normal
// module resolution, then the global npm root. Chromium comes from playwright
// itself (which honours PLAYWRIGHT_BROWSERS_PATH), so no build number is pinned
// here. Still skips cleanly (exit 0) when genuinely absent — test/run-all.js
// reports that as SKIP, not PASS, and CI hard-fails on it.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');

const APP = path.join(__dirname, '..');

function findPlaywright() {
  if (process.env.PW_PATH) return process.env.PW_PATH;
  try { return require.resolve('playwright'); } catch (_) {}
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 15000 }).trim();
    const p = path.join(root, 'playwright');
    if (fs.existsSync(p)) return p;
  } catch (_) {}
  return null;
}

const PW = findPlaywright();
let chromium;
if (!PW) { console.log('BROWSER TEST: skipped (playwright not installed — set PW_PATH to run it)'); process.exit(0); }
try { ({ chromium } = require(PW)); } catch (e) { console.log('BROWSER TEST: skipped (playwright at ' + PW + ' would not load: ' + String(e.message).split('\n')[0] + ')'); process.exit(0); }

// Ask playwright where its Chromium is rather than guessing a build number.
let CHROME = process.env.CHROME_PATH || '';
if (!CHROME) { try { CHROME = chromium.executablePath(); } catch (_) { CHROME = ''; } }
if (!CHROME || !fs.existsSync(CHROME)) { console.log('BROWSER TEST: skipped (no Chromium — run `npx playwright install chromium`, or set CHROME_PATH)'); process.exit(0); }

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chambers-browser-'));
const PORT = 27000 + Math.floor(Math.random() * 2000);
const srv = spawn('node', ['server.js'], { cwd: APP, env: { ...process.env, CHAMBERS_DATA: DATA, PORT: String(PORT) } });
let log = ''; srv.stdout.on('data', (d) => { log += d; });

(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  const m = log.match(/Dan G \(admin\):\s+(\S+)/);
  if (!m) throw new Error('no seat invite printed on first boot');
  const invite = m[1].replace(/http:\/\/localhost:\d+/, 'http://localhost:' + PORT);
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  // Real enrollment through a real browser form POST — the exact path that 500'd.
  await p.goto(invite); await p.waitForTimeout(400);
  await p.fill('#em', 'dan@example.test'); await p.fill('#p1', 'a-real-password-here'); await p.fill('#p2', 'a-real-password-here');
  await p.click('button'); await p.waitForTimeout(1200);
  if (!p.url().includes('/account')) throw new Error('enrollment failed: landed on ' + p.url() + ' — browser form POST is broken');

  // The app itself must render for a signed-in seat, not the login page.
  for (const route of ['/r/desk', '/r/intake', '/r/books', '/r/billing']) {
    const r = await p.goto('http://localhost:' + PORT + route); await p.waitForTimeout(250);
    if (r.status() !== 200) throw new Error(route + ' -> HTTP ' + r.status());
    const isApp = await p.evaluate(() => !!document.querySelector('.shell'));
    if (!isApp) throw new Error(route + ' rendered the login page, not the app — session lost');
  }
  if (errs.length) throw new Error('page errors: ' + errs.join('; '));
  await b.close(); srv.kill();
  console.log('BROWSER: ALL PASS (real enrollment via invite, app renders, no page errors)');
  process.exit(0);
})().catch((e) => { console.error('BROWSER FAIL:', e.message); try { srv.kill(); } catch (_) {} process.exit(1); });
