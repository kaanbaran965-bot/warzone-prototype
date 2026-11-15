import { chromium, devices } from 'playwright';
const js = process.argv[2] || '0';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro landscape'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(process.argv[3] || 'http://127.0.0.1:4173/');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 40000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(500);
console.log(JSON.stringify(await page.evaluate(js), null, 1));
if (process.argv[4]) { await page.waitForTimeout(800); await page.screenshot({ path: process.argv[4] }); }
await browser.close();
