// Smoke test in Playwright WebKit (Safari's engine) with iPhone emulation.
import { webkit, devices } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url);
const ok = await page.waitForFunction(() => window.__game?.ready, null, { timeout: 90000 }).then(() => true).catch(() => false);
const info = await page.evaluate(() => ({ ready: window.__game?.ready, loadText: document.getElementById('load-text').textContent,
  gl: (() => { const r = window.__game?.renderer; return r ? r.getContext().getParameter(r.getContext().VERSION) : null; })(),
  audio: window.__game ? 'ok' : null }));
if (ok) { await page.tap('#start'); await page.waitForTimeout(2500); }
await page.screenshot({ path: 'screenshots/webkit_iphone_idle.png' });
const st = await page.evaluate(() => ({ started: window.__game?.started, state: window.__game?.player.state, fps: document.getElementById('fps').textContent }));
console.log(JSON.stringify({ ok, info, st, errors }, null, 1));
await browser.close();
