// node tools/dbg2.mjs out.png "<js>" [query] -- like dbg.mjs but logs timings, errors, and uses a longer screenshot timeout
import { chromium, devices } from 'playwright';
const [out, js = '0', query = 'q=medium'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ...devices['iPhone 14 Pro landscape'] })).newPage();
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('willReadFrequently')) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://127.0.0.1:4188/?manual&' + query);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__game.start());
let t = Date.now();
const r = await page.evaluate(js);
console.log('eval ms', Date.now() - t); if (r !== undefined) console.log(JSON.stringify(r));
t = Date.now(); await page.evaluate(() => window.__game.advance(2)); console.log('advance ms', Date.now() - t);
t = Date.now(); await page.screenshot({ path: out, timeout: 120000 }); console.log('shot ms', Date.now() - t);
console.log(logs.slice(0, 12).join('\n'));
await browser.close();
