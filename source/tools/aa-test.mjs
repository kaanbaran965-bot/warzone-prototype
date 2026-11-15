// node tools/aa-test.mjs -- aim assist checks (slowdown, pull, ADS snap) + reload screenshots
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ...devices['iPhone 14 Pro landscape'] })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:4188/?manual&q=low');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
const res = await page.evaluate(() => {
  const g = window.__game; g.start();
  const p = g.player, T = g.world.terrain, b = g.combat.bots.bots, out = { aimEnabled: g.aim.enabled, strength: g.aim.strength };
  b[1].spawnAt(80, -170, 0); b[2].spawnAt(-60, -170, 0);
  const setup = (offDeg) => {
    p.pos.set(6, T.height(6, -100), -100); p.vel.set(0, 0, 0); g.weapon.adsHeld = false; g.vm.ads = 0; g.vm.adsTarget = 0; g.sim(2);
    b[0].spawnAt(6, -120, Math.PI); b[0].ready = 99; g.combat.graceT = 99; b[0].percT = 0; g.sim(3);
    const c = b[0].chestWorld(new p.pos.constructor()), e = g.camera.position.clone(), v = c.sub(e).normalize();
    p.yaw = Math.atan2(-v.x, -v.z) + offDeg * Math.PI / 180; p.pitch = Math.asin(v.y); g.sim(1);
    return Math.atan2(-v.x, -v.z);
  };
  const err = (target) => +((p.yaw - target) * 180 / Math.PI).toFixed(2);
  // 1) no input: no pull
  let tgt = setup(3); g.sim(30); out.noInput = { start: 3, after1s: err(tgt) };
  // 2) moving sideways slowly (input present) -> pull towards target
  tgt = setup(3); g.setStick(0.3, 0); g.sim(15); g.setStick(0, 0); out.withInput = { start: 3, after05s: err(tgt) };
  // 3) slowdown factor near target
  tgt = setup(1); g.input.lookDelta.x = 0.001; g.sim(1); out.slowdownAt1deg = +g.aim.slow.toFixed(2);
  tgt = setup(10); g.input.lookDelta.x = 0.001; g.sim(1); out.slowdownAt10deg = +g.aim.slow.toFixed(2);
  // 4) ADS snap
  tgt = setup(6); g.input.press('adsToggle'); g.sim(9); out.adsSnap = { start: 6, after03s: err(tgt) };
  // 5) strength 0 => nothing
  g.aim.strength = 0; tgt = setup(6); g.input.press('adsToggle'); g.sim(9); out.adsSnapOff = { start: 6, after03s: err(tgt) };
  g.aim.strength = 0.3; g.weapon.adsHeld = false; g.setStick(0, 0);
  return out;
});
console.log(JSON.stringify(res, null, 1));
// reload screenshots (M4: mag out / mag in / charging handle on empty reload)
await page.evaluate(() => { const g = window.__game, p = g.player, T = g.world.terrain; g.combat.bots.setEnabled(false); p.pos.set(-30, T.height(-30, 20), 20); p.yaw = 0.12; p.pitch = -0.04; g.weapon.adsHeld = false; g.sim(20); g.weapon.mag = 0; g.weapon.onAmmo(); g.input.press('reload'); g.sim(1); });
for (const [n, t] of [['reload_magout', 0.85], ['reload_magin', 1.35], ['reload_handle', 1.9]]) {
  await page.evaluate((t) => { const g = window.__game; while (g.vm.reloadT >= 0 && g.vm.reloadT < t) g.sim(1, 1 / 60); g.advance(1, 1 / 120); }, t);
  await page.screenshot({ path: `devshots/${n}.png`, timeout: 120000 }); console.log('shot', n);
}
console.log('errors:', errs.length ? errs.slice(0, 10).join('\n') : 'none');
await browser.close();
