import * as THREE from 'three';
import { clamp } from '../core/MathUtil.js';
import { MOVE } from './PlayerController.js';
import { rayWorld } from '../combat/Ballistics.js';
const MOVE_ADS_MUL = MOVE.adsMul;

// MP5 gameplay: 800 rpm automatic, 30 + 1 rounds, tactical vs empty reload, recoil that moves the aim
// (pull down to control), small hip spread, hits on terrain / trees / rocks with dust impacts.
export class Weapon {
  constructor({ vm, player, rig, fx, audio, world, camera }) {
    Object.assign(this, { vm, player, rig, fx, audio, world, camera });
    this.name = 'M4A1';
    this.magSize = 30; this.mag = 30; this.reserve = 150; this.maxReserve = 210;
    this.combat = null; this.enabled = true;
    this.rpm = 760; this.cool = 0; this.sprintDelay = 0;
    this.shotsInString = 0; this.adsHeld = false;
    this.reloadTimer = -1;
    this.onAmmo = null;
    this._o = new THREE.Vector3(); this._d = new THREE.Vector3(); this._p = new THREE.Vector3(); this._n = new THREE.Vector3();
  }
  get ads() { return this.vm.ads; }

  update(dt, input) {
    const p = this.player;
    if (input.consume('reload') && this.enabled) this.tryReload();
    if (input.consume('adsToggle')) { this.adsHeld = !this.adsHeld; if (this.adsHeld && (p.sprinting)) p.stopSprint(); }
    // an explicit sprint / tactical sprint cancels ADS
    if (p.cancelAds) { this.adsHeld = false; p.cancelAds = false; }
    const wantAds = (this.adsHeld || input.adsHeld) && !p.sliding && this.enabled !== false;
    const firing = input.fireHeld && this.enabled !== false;
    // firing cancels sprint; there is a short sprint-out delay before the first shot
    p.blockSprint = firing;
    p.adsWanted = wantAds;
    if (p.sprinting || p.sliding) this.sprintDelay = p.tactical ? 0.22 : 0.14;
    else this.sprintDelay = Math.max(0, this.sprintDelay - dt);
    p.speedMul = 1 - this.vm.ads * (1 - MOVE_ADS_MUL);
    p.adsActive = this.vm.ads > 0.5;
    this.vm.setAds(wantAds && this.reloadTimer < 0);

    this.cool -= dt;
    if (firing && this.reloadTimer < 0 && this.sprintDelay <= 0) {
      if (this.mag <= 0) {
        if (this.cool <= 0) { this.audio?.onWeaponCue('dry'); this.cool = 0.3; if (this.reserve > 0) this.tryReload(); }
      } else {
        while (this.cool <= 0 && this.mag > 0) { this.fire(); this.cool += 60 / this.rpm; }
      }
    } else {
      if (this.cool < 0) this.cool = 0;
      if (!firing) this.shotsInString = 0;
    }
    if (this.reloadTimer >= 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer < 0) {
        const need = this.magSize + (this.mag > 0 ? 1 : 0) - this.mag;
        const take = Math.min(need, this.reserve); this.mag += take; this.reserve -= take;
        this.onAmmo?.();
      }
    }
  }

  tryReload() {
    if (this.reloadTimer >= 0 || this.reserve <= 0 || this.mag >= this.magSize + 1) return;
    if (this.vm.inspecting) this.vm.cancelInspect();
    const empty = this.mag === 0;
    this.vm.startReload(empty);
    this.reloadTimer = this.vm.reloadLen - 0.55;
    this.player.blockSprint = false;
  }

  fire() {
    this.mag--; this.shotsInString++;
    const adsF = this.vm.ads;
    this.vm.kick(adsF);
    this.fx.muzzle(this.vm, this.camera);
    this.audio?.shot();
    // recoil: vertical climb + horizontal drift that moves the real aim
    const n = this.shotsInString;
    const climb = (n < 4 ? 0.0085 : 0.0062) * (1 - adsF * 0.35) * (this.player.crouched ? 0.8 : 1);
    this.player.pitch += climb;
    this.player.yaw += (Math.random() - 0.45) * 0.0042 * (1 - adsF * 0.3);
    this.rig.shake(0.35 + (1 - adsF) * 0.25);
    // hitscan with spread
    const spread = (adsF > 0.6 ? 0.0012 : 0.012 + clamp(this.player.horizSpeed / 6, 0, 1) * 0.014) * (1 + Math.min(n, 10) * 0.04);
    const cam = this.camera;
    cam.updateMatrixWorld();
    const o = this._o.setFromMatrixPosition(cam.matrixWorld);
    const d = this._d.set((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, -1).normalize().transformDirection(cam.matrixWorld);
    let hit = rayWorld(this.world, o, d, 400);
    const ch = this.combat?.resolveShot(o, d, hit, 400);
    if (ch) hit = { t: ch.t, consumed: true };
    // tracer every 3rd round, from the muzzle direction
    if (n % 3 === 1) {
      const from = this._p.set(0.12, -0.12, -0.6).applyMatrix4(cam.matrixWorld);
      const end = o.clone().addScaledVector(d, hit ? hit.t : 400);
      const dir = end.clone().sub(from); const L = dir.length(); dir.divideScalar(L);
      this.fx.tracer(from, dir, L);
    }
    if (hit && !hit.consumed) this.fx.impact(o.clone().addScaledVector(d, hit.t), hit.n, hit.kind);
    this.onShot?.(n);
    this.onAmmo?.();
  }
}
