// Quick screenshot tool: node tools/shot.mjs <url> <out.png> [jsBeforeShot] [waitMs]
import { chromium, devices } from 'playwright';
const [url = 'http://127.0.0.1:4173/', out = 'screenshots/test.png', js = '', wait = '1500'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro landscape'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { console.log('[console]', m.type(), m.text()); if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); logs.push('pageerror: ' + e.message); });
await page.goto(url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 40000 });
await page.evaluate(() => window.__game.start());
if (js) await page.evaluate(js);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(logs.join('\n') || 'no console errors');
await browser.close();
