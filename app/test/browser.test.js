'use strict';
// REAL-BROWSER regression test. Every fetch()-based test in this suite passes an
// explicit Origin header, so none of them can catch a defect that only appears
// under a real browser's headers. One did exist and made the whole app unusable:
// Referrer-Policy 'no-referrer' caused Chromium to send a literal `Origin: null`
// on same-origin form posts, and parsing that threw -> HTTP 500 on EVERY form
// submission (enrollment, login, saving anything). This test drives Chromium
// through real enrollment and asserts the app renders, so it cannot regress.
//
// Requires Chromium (preinstalled at /opt/pw-browsers) and playwright available.
// Skips cleanly (exit 0) when they are absent so CI without a browser still passes.
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');

const APP = path.join(__dirname, '..');
const PW = process.env.PW_PATH || '/tmp/claude-0/-home-user-scotia/67dc42f1-6bf8-5a36-81d8-31738d31aef7/scratchpad/node_modules/playwright';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let chromium;
try { ({ chromium } = require(PW)); } catch (_) { console.log('BROWSER TEST: skipped (playwright unavailable)'); process.exit(0); }
if (!fs.existsSync(CHROME)) { console.log('BROWSER TEST: skipped (chromium unavailable)'); process.exit(0); }

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
  await p.fill('#em', 'dan@example.test'); await p.fill('#p1', 'a-real-password-here');
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
