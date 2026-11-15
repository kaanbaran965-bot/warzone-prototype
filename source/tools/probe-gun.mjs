import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ...devices['iPhone 14 Pro landscape'] })).newPage();
await page.goto('http://127.0.0.1:4188/?manual&q=low');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game, vm = g.vm, THREE = null;
  const piv = vm.gunPivot; piv.updateMatrixWorld(true);
  const inv = piv.matrixWorld.clone().invert();
  const out = {}; const slices = {};
  const v = new (vm.hip.position.constructor)();
  const names = [];
  vm.gun.traverse((o) => {
    if (!o.isMesh) return; names.push(o.name);
    const p = o.geometry.attributes.position; o.updateMatrixWorld(true);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      if (Math.abs(v.x) > 0.004) continue;
      const k = Math.round(v.z * 100); // 1 cm slices
      if (!(k in slices) || v.y > slices[k]) slices[k] = +v.y.toFixed(4);
    }
  });
  const box = new (vm.hip.position.constructor)();
  return { names, slices, hip: vm.hip.position.toArray(), muzzle: piv.worldToLocal(vm.muzzle.getWorldPosition(box.clone())).toArray(), adsPos: vm.adsPos, adsRot: vm.adsRot };
});
console.log(JSON.stringify(r));
await browser.close();
