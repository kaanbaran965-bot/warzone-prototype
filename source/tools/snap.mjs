// node tools/snap.mjs <prefix> [query] -- renders a set of scenario screenshots with iPhone 14 Pro landscape emulation
import { chromium, devices } from 'playwright';
import fs from 'fs';
const [prefix = 'shot', query = '', only = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro landscape'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto('http://127.0.0.1:4188/?manual' + (query ? '&' + query : ''));
await page.waitForFunction(() => window.__game?.ready || document.getElementById('load-text')?.textContent.startsWith('Fehler'), null, { timeout: 180000 });
console.log('ready in', Date.now() - t0, 'ms', await page.evaluate(() => document.getElementById('load-text').textContent));
if (process.env.TITLE) await page.evaluate(() => window.__game.advance(2)), await page.screenshot({ path: `screenshots/${prefix}_title.png` });
await page.evaluate(() => window.__game.start());
const scen = JSON.parse(fs.readFileSync(process.env.SCEN || 'tools/scenarios.json', 'utf8'));
for (const s of scen) {
  if (only && !s.name.includes(only)) continue;
  await page.evaluate(s.js || '0');
  const ts = Date.now();
  await page.evaluate((n) => window.__game.advance(n, 1 / 30), Math.max(1, Math.round((s.wait ?? 1500) / 33)));
  if (s.js2) { await page.evaluate(s.js2); await page.evaluate((n) => window.__game.advance(n, 1 / 30), Math.max(1, Math.round((s.wait2 ?? 300) / 33))); }
  console.log('  sim+render', Date.now() - ts, 'ms');
  await page.screenshot({ path: `screenshots/${prefix}_${s.name}.png` });
  console.log('shot', s.name);
}
console.log(logs.slice(0, 20).join('\n') || 'no console errors');
await browser.close();
