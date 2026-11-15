import * as THREE from 'three';
import { damp, clamp, DEG, Spring } from '../core/MathUtil.js';
import { State } from './PlayerController.js';

// Turns the player state into the world camera transform: eye height, head bob, roll, FOV kicks.
// [vertical m, lateral m, roll multiplier] per locomotion state
const BOB = {
  idle: [0.0, 0.0, 0], walk: [0.016, 0.009, 0.8], run: [0.022, 0.012, 1], sprint: [0.03, 0.017, 1.4],
  tacsprint: [0.04, 0.022, 2.0], crouch: [0.011, 0.007, 0.6], ads: [0.006, 0.004, 0.3], slide: [0, 0, 0], jump: [0, 0, 0],
};
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.baseHFov = 92; // horizontal FOV, like a mobile shooter's default
    this.hfov = this.baseHFov;
    this.roll = 0; this.bobAmp = 0;
    this.dip = new Spring(110, 13); this.pitchKick = new Spring(120, 12);
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.shakeP = new Spring(320, 16); this.shakeY = new Spring(300, 16);
    this.ads = 0;
  }
  shake(a) { this.shakeP.impulse(a * (0.6 + Math.random() * 0.4)); this.shakeY.impulse((Math.random() - 0.5) * a); }
  onPlayerEvent(e) {
    if (e.type === 'land') { const f = clamp(e.data / 7, 0.2, 1.6); this.dip.impulse(-0.55 * f); this.pitchKick.impulse(-0.06 * f); }
    if (e.type === 'jump') { this.pitchKick.impulse(0.025); }
    if (e.type === 'slideStart') { this.dip.impulse(-0.2); }
  }
  update(dt, p) {
    const hs = p.horizSpeed;
    const grounded = p.grounded && !p.sliding;
    this.bobAmp = damp(this.bobAmp, grounded ? clamp(hs / 4.6, 0, 1.8) : 0, 8, dt);
    const ph = p.stepPhase * Math.PI;
    // per-state head bob amplitude (vertical, lateral) -- damped so transitions are smooth
    const B = BOB[p.state] || BOB.walk;
    this.bobV = damp(this.bobV ?? 0.018, B[0], 6, dt); this.bobH = damp(this.bobH ?? 0.01, B[1], 6, dt);
    const by = (Math.abs(Math.sin(ph)) - 0.5) * this.bobV * this.bobAmp;
    const bx = Math.sin(ph) * this.bobH * this.bobAmp;
    this.dip.update(dt); this.pitchKick.update(dt); this.shakeP.update(dt); this.shakeY.update(dt);

    // strafe/slide roll
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const vR = p.vel.x * -fwd.z + p.vel.z * fwd.x;
    // turn roll: lean slightly into fast turns
    const yawRate = (p.yaw - (this.lastYaw ?? p.yaw)) / Math.max(dt, 1e-3); this.lastYaw = p.yaw;
    this.turnRoll = damp(this.turnRoll || 0, clamp(yawRate, -6, 6) * 0.006, 7, dt);
    const rollT = -vR * 0.0045 + (p.sliding ? 6.5 * DEG : 0) + Math.sin(ph) * 0.0035 * this.bobAmp * (B[2] || 1) + this.turnRoll;
    this.roll = damp(this.roll, rollT, 8, dt);

    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    // death camera: drop to the ground and roll over
    this.deadF = damp(this.deadF || 0, this.dead ? 1 : 0, this.dead ? 3.2 : 12, dt);
    const df = this.deadF;
    this.camera.position.set(p.pos.x, p.pos.y + (p.eyeHeight + by + this.dip.x * 0.12) * (1 - df) + 0.3 * df, p.pos.z).addScaledVector(right, bx);
    this.euler.set(p.pitch + this.pitchKick.x + this.shakeP.x * 0.01 + df * 0.25, p.yaw + this.shakeY.x * 0.006, this.roll + this.shakeY.x * 0.004 + df * 0.62);
    this.camera.quaternion.setFromEuler(this.euler);

    const fovT = (this.baseHFov + (p.state === State.TAC ? 10 : p.state === State.SPRINT ? 5 : p.state === State.SLIDE ? 8 : 0)) * (1 - this.ads * 0.2);
    this.hfov = damp(this.hfov, fovT, this.ads > 0.05 ? 12 : 5, dt);
    const vfov = 2 * Math.atan(Math.tan(this.hfov * DEG / 2) / this.camera.aspect) / DEG;
    if (Math.abs(this.camera.fov - vfov) > 0.01) { this.camera.fov = vfov; this.camera.updateProjectionMatrix(); }
  }
}
