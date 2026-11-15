// End-to-end test in an emulated iPhone 14 Pro (landscape, touch) using real multi-touch events via CDP.
// Usage: node tools/test-touch.mjs [url]   -> writes screenshots/ and prints a JSON report.
import { chromium, devices } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS || 'screenshots';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const cdp = await ctx.newCDPSession(page);
const active = new Map();
const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...active.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 })) });
const down = async (id, x, y) => { active.set(id, { x, y }); await send('touchStart'); };
const move = async (id, x, y, steps = 6) => {
  const p = active.get(id); const x0 = p.x, y0 = p.y;
  for (let i = 1; i <= steps; i++) { p.x = x0 + (x - x0) * i / steps; p.y = y0 + (y - y0) * i / steps; await send('touchMove'); await page.waitForTimeout(16); }
};
// note: for CDP touchEnd the listed points are the ones being released
const up = async (id) => { const p = active.get(id); active.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x: p.x, y: p.y }] }); };
const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const tapBtn = async (sel, id = 9) => { const [x, y] = await center(sel); await down(id, x, y); await page.waitForTimeout(60); await up(id); };
const st = () => page.evaluate(() => { const p = window.__game.player; return { state: p.state, speed: +p.horizSpeed.toFixed(2), x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), eye: +p.eyeHeight.toFixed(2), inspecting: window.__game.vm.inspecting }; });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const report = {};

await page.goto(url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const [sx, sy] = await center('#start');
await page.touchscreen.tap(sx, sy);
await page.waitForTimeout(800);
report.started = await page.evaluate(() => window.__game.started);
report.touchUiVisible = await page.locator('#touch').isVisible();
report.idle = await st(); await shot('01_idle');

// walk forward with the left stick
const vp = page.viewportSize();
const SX = 150, SY = vp.height - 120;
await down(1, SX, SY); await move(1, SX, SY - 45);
await page.waitForTimeout(1500);
report.walk = await st(); await shot('02_walk');
// push past the ring -> auto sprint
await move(1, SX, SY - 95);
await page.waitForTimeout(1200);
report.sprint = await st(); await shot('03_sprint');
// tap sprint again -> tactical sprint
await tapBtn('#btn-sprint');
await page.waitForTimeout(900);
report.tactical = await st(); await shot('04_tactical_sprint');
// crouch while sprinting -> slide
await tapBtn('#btn-crouch');
await page.waitForTimeout(280);
report.slide = await st(); await shot('05_slide');
await page.waitForTimeout(1200);
report.afterSlide = await st();
await up(1);
await page.waitForTimeout(600);
report.stoppedCrouched = await st();
// stand up if the slide left us crouched (slide -> sprint resumes automatically while the stick is pushed)
if ((await st()).state === 'crouch') { await tapBtn('#btn-crouch'); await page.waitForTimeout(600); }
report.stood = await st();

// jump (standing): capture rise and landing
await tapBtn('#btn-jump');
await page.waitForTimeout(120);
report.jumpRise = await st(); await shot('06_jump_rise');
await page.waitForTimeout(560);
report.jumpLand = await st(); await shot('07_landing');

// look: drag on the right half
const before = await st();
await down(2, vp.width * 0.62, vp.height * 0.35); await move(2, vp.width * 0.52, vp.height * 0.42, 10); await up(2);
await page.waitForTimeout(200);
const after = await st();
report.look = { dYaw: +(after.yaw - before.yaw).toFixed(3), dPitch: +(after.pitch - before.pitch).toFixed(3) };

// crouch toggle
await tapBtn('#btn-crouch'); await page.waitForTimeout(700);
report.crouch = await st(); await shot('08_crouch');
await tapBtn('#btn-crouch'); await page.waitForTimeout(700);

// slide button from walking
await down(1, SX, SY); await move(1, SX, SY - 45); await page.waitForTimeout(1200);
await tapBtn('#btn-slide'); await page.waitForTimeout(200);
report.slideButton = await st();
await up(1); await page.waitForTimeout(1500);
await tapBtn('#btn-crouch'); await page.waitForTimeout(500);

// inspect
await tapBtn('#btn-inspect');
await page.waitForTimeout(900);
report.inspect1 = await st(); await shot('09_inspect_a');
await page.waitForTimeout(1500);
await shot('10_inspect_b');
await page.waitForTimeout(2000);
report.inspectDone = await st();
report.inspectT = await page.evaluate(() => window.__game.vm.inspectT);
// page scroll / zoom check
report.scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY, vv: window.visualViewport?.scale }));
report.fps = await page.locator('#fps').textContent();
report.errors = errors;
console.log(JSON.stringify(report, null, 1));
await browser.close();
