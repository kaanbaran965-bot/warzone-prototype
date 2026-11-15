// node tools/dbg.mjs out.png "<js run before render>" [query]
import { chromium, devices } from 'playwright';
const [out, js = '0', query = 'q=low'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ...devices['iPhone 14 Pro landscape'] })).newPage();
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); }); page.on('pageerror', (e) => logs.push(e.message));
await page.goto('http://127.0.0.1:4188/?manual&' + query);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__game.start());
const r = await page.evaluate(js);
if (r !== undefined) console.log(JSON.stringify(r));
await page.evaluate(() => window.__game.advance(20));
await page.screenshot({ path: out });
console.log(logs.slice(0, 8).join('\n'));
await browser.close();
