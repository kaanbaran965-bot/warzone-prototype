import * as THREE from 'three';
import { clamp, DEG } from '../core/MathUtil.js';

// Touch aim assist (Warzone-style, deliberately gentle). strength 0..1 (default 0.3):
//  - slowdown: look sensitivity drops while the crosshair is over / near an enemy
//  - rotational pull + tracking: while the player is giving input (moving, looking or firing), the view is
//    nudged towards the nearest visible enemy inside a small cone and follows its movement
//  - ADS snap: entering ADS with an enemy near the crosshair pulls part of the way onto it
export class AimAssist {
  constructor() {
    this.strength = 0.3; this.enabled = true;
    this.slow = 1; this.target = null; this.snapLeft = 0; this.snapYaw = 0; this.snapPitch = 0;
    this.lastAds = 0;
    this._f = new THREE.Vector3(); this._t = new THREE.Vector3(); this._e = new THREE.Vector3();
  }

  // returns the look-sensitivity multiplier for this frame
  update(dt, { player, camera, bots, adsTarget, ads, hasInput }) {
    this.slow = 1; this.target = null;
    const s = this.enabled ? clamp(this.strength, 0, 1) : 0;
    const adsStart = adsTarget > 0 && this.lastAds === 0; this.lastAds = adsTarget;
    if (s <= 0 || !bots.length) return 1;
    const eye = this._e.copy(camera.position);
    const yaw = player.yaw, pitch = player.pitch;
    const fwd = this._f.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    let best = null;
    for (const b of bots) {
      if (!b.visibleToPlayer) continue;
      // aim point: chest, a bit higher when aiming (between chest and head)
      const tp = b.chestWorld(this._t.clone());
      if (ads > 0.5) tp.lerp(b.headWorld(new THREE.Vector3()), 0.25);
      const v = tp.clone().sub(eye); const dist = v.length(); if (dist > 90 || dist < 1) continue;
      v.divideScalar(dist);
      const ang = Math.acos(clamp(v.dot(fwd), -1, 1));
      // cone grows at close range (covers about a body width) and when aiming
      const cone = Math.max((ads > 0.5 ? 5 : 7) * DEG, Math.atan(0.9 / dist));
      if (ang < cone * 1.8 && (!best || ang / cone < best.score)) best = { b, v, dist, ang, cone, score: ang / cone };
    }
    if (best && adsStart && best.ang < Math.max(12 * DEG, best.cone * 2)) {
      // snap: a share of the angular error applied over ~0.15 s (60 % at the default 30 % strength)
      const k = clamp(s * 2.0, 0, 1);
      this.snapYaw = angDiff(Math.atan2(-best.v.x, -best.v.z), yaw) * k;
      this.snapPitch = (Math.asin(clamp(best.v.y, -1, 1)) - pitch) * k;
      this.snapLeft = 0.15;
    }
    if (this.snapLeft > 0) {
      const f = Math.min(1, dt / this.snapLeft); this.snapLeft -= dt;
      player.yaw += this.snapYaw * f; player.pitch += this.snapPitch * f;
      this.snapYaw *= 1 - f; this.snapPitch *= 1 - f;
    }
    if (!best || best.ang > best.cone) return 1;
    this.target = best.b;
    const f = 1 - best.ang / best.cone;          // 0 at the cone edge, 1 on target
    this.slow = clamp(1 - s * 1.3 * f, 0.45, 1);  // up to ~39 % slower at 30 %
    if (hasInput) {
      // rotational pull towards the target (also follows its lateral motion = tracking)
      const rate = s * 6.0 * (0.35 + 0.65 * f) * (ads > 0.5 ? 1.25 : 1);
      const a = 1 - Math.exp(-rate * dt);
      const dy = angDiff(Math.atan2(-best.v.x, -best.v.z), yaw);
      const dp = Math.asin(clamp(best.v.y, -1, 1)) - pitch;
      const maxStep = s * 2.2 * dt; // rad/frame cap keeps it subtle
      player.yaw += clamp(dy * a, -maxStep, maxStep);
      player.pitch += clamp(dp * a * 0.6, -maxStep, maxStep);
    }
    return this.slow;
  }
}
function angDiff(a, b) { let d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); }
