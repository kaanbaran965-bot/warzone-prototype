// node tools/move-test.mjs -- numeric movement / state-machine checks + pose screenshots (headless Chromium)
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ...devices['iPhone 14 Pro landscape'] })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:4188/?manual&q=low');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
await page.evaluate(() => { const g = window.__game; g.start(); g.combat.bots.setEnabled(false); });
const run = (fn) => page.evaluate(fn);
const res = await run(() => {
  const g = window.__game, p = g.player, T = g.world.terrain, out = {};
  const reset = () => { g.setStick(0, 0); g.input.fireHeld = false; g.weapon.adsHeld = false; p.pos.set(-120, 0, 60); p.pos.y = T.height(-120, 60); p.vel.set(0, 0, 0); p.yaw = 1.2; p.crouched = false; p.sliding = false; p.stopSprint(); p.tacTime = 4; p.tacCooldown = 0; p.slideCooldown = 0; g.sim(10, 1 / 30); };
  const sample = (frames) => { const log = []; for (let i = 0; i < frames; i++) { g.sim(1, 1 / 30); log.push([p.state, +p.horizSpeed.toFixed(2)]); } return log; };
  reset(); g.setStick(0, 0.35); let l = sample(45); out.walk = l.at(-1);
  reset(); g.setStick(0, 0.8); l = sample(45); out.run = l.at(-1);
  reset(); g.setStick(0, 1.0); l = sample(60); out.autoSprint = l.at(-1);
  g.setStick(0, 1.0, true); l = sample(45); out.tacSprint = l.at(-1);
  // accel: frames to reach 90 % of run speed
  reset(); g.setStick(0, 0.8); l = sample(40); out.accelFramesTo90 = l.findIndex((s) => s[1] > 3.95 * 0.9);
  g.setStick(0, 0); l = sample(40); out.decelFramesTo10 = l.findIndex((s) => s[1] < 0.46);
  // slide from sprint
  reset(); g.setStick(0, 1.0); sample(40); g.input.press('crouchToggle'); l = sample(45);
  out.slide = { first: l[1], peak: Math.max(...l.filter((s) => s[0] === 'slide').map((s) => s[1])), dur: l.filter((s) => s[0] === 'slide').length / 30, after: l.at(-1) };
  g.setStick(0, 0); sample(5);
  // crouch walk
  reset(); g.input.press('crouchToggle'); g.advance(1, 1 / 30); g.setStick(0, 0.8); l = sample(45); out.crouch = l.at(-1);
  // ADS while moving
  reset(); g.input.press('adsToggle'); g.advance(1, 1 / 30); g.setStick(0, 0.8); l = sample(45); out.adsMove = l.at(-1);
  g.setStick(0, 1.0); l = sample(30); out.adsFullStick_noAutoSprint = l.at(-1);
  // explicit sprint (double tap stick) cancels ADS
  g.input.press('sprintTap'); l = sample(30); out.sprintCancelsAds = { state: l.at(-1), adsHeld: g.weapon.adsHeld, ads: +g.vm.ads.toFixed(2) };
  // jump while running
  reset(); g.setStick(0, 0.8); sample(30); const y0 = p.pos.y; g.input.press('jump'); let maxDy = 0, air = 0;
  for (let i = 0; i < 60; i++) { g.sim(1, 1 / 30); maxDy = Math.max(maxDy, p.pos.y - T.height(p.pos.x, p.pos.z)); if (!p.grounded) air++; }
  out.jump = { height: +maxDy.toFixed(2), airTime: +(air / 30).toFixed(2), speedKept: +p.horizSpeed.toFixed(2) };
  // eye heights
  reset(); out.eyeStand = +p.eyeHeight.toFixed(2); g.input.press('crouchToggle'); g.advance(30, 1 / 30); out.eyeCrouch = +p.eyeHeight.toFixed(2);
  reset();
  return out;
});
console.log(JSON.stringify(res, null, 1));
// pose screenshots
const shots = [
  ['tacsprint', () => { const g = window.__game, p = g.player, T = g.world.terrain; p.pos.set(-30, T.height(-30, 20), 20); p.yaw = 0.12; p.pitch = -0.05; g.setStick(0, 1, false); g.sim(40, 1 / 30); g.setStick(0, 1, true); g.sim(14, 1 / 30); return p.state; }],
  ['slide', () => { const g = window.__game, p = g.player; g.setStick(0, 1, false); p.tacTime = 4; p.slideCooldown = 0; g.sim(30, 1 / 30); g.input.press('crouchToggle'); g.sim(8, 1 / 30); return p.state; }],
  ['crouch', () => { const g = window.__game, p = g.player; g.setStick(0, 0); g.sim(40, 1 / 30); if (!p.crouched) g.input.press('crouchToggle'); g.sim(1, 1 / 30); g.setStick(0.0, 0.6); g.sim(25, 1 / 30); return p.state; }],
  ['sprint', () => { const g = window.__game, p = g.player; g.setStick(0, 0); g.input.press('crouchToggle'); g.sim(20, 1 / 30); g.setStick(0, 1); g.sim(40, 1 / 30); return p.state; }],
];
for (const [name, fn] of shots) {
  const st = await run(fn);
  await run(() => window.__game.advance(1, 1 / 60));
  await page.screenshot({ path: `devshots/pose_${name}.png`, timeout: 120000 });
  console.log('shot', name, st);
}
console.log('errors:', errs.length ? errs.slice(0, 10).join('\n') : 'none');
await browser.close();
