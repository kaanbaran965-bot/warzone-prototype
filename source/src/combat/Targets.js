import * as THREE from 'three';
import { RANGE_ORIGIN } from '../world/Cover.js';
import { raySphere, rayCapsule } from './Ballistics.js';

// Practice range: steel silhouettes that fall on hit and pop back up, and swinging steel gongs further out.
// Built from capsules, spheres and cylinders only.
const SIL = [[-6, -12], [3, -20], [9, -32]];          // offsets from RANGE_ORIGIN (north = -z)
const GONGS = [[-3, -48, 0.32], [6, -66, 0.4]];

export class Targets {
  constructor(terrain) {
    this.group = new THREE.Group(); this.group.name = 'Range';
    this.items = [];
    const steel = new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.55, metalness: 0.35 });
    const steelHit = new THREE.MeshStandardMaterial({ color: 0xc8582c, roughness: 0.5, metalness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2b2c, roughness: 0.6, metalness: 0.7 });
    this.mats = { steel, steelHit };
    const flat = (m, sx, sy, sz) => { m.scale.set(sx, sy, sz); return m; };
    for (const [dx, dz] of SIL) {
      const x = RANGE_ORIGIN.x + dx, z = RANGE_ORIGIN.y + dz, gy = terrain.height(x, z);
      const root = new THREE.Group(); root.position.set(x, gy, z);
      root.rotation.y = Math.atan2(RANGE_ORIGIN.x - x, RANGE_ORIGIN.y + 6 - z); // face the shooting line
      // base: two splayed legs + cross bar
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.9, 8), wood);
        leg.position.set(s * 0.32, 0.12, 0); leg.rotation.z = s * 1.25; root.add(leg);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), dark); bar.rotation.z = Math.PI / 2; bar.position.y = 0.3; root.add(bar);
      const hinge = new THREE.Group(); hinge.position.y = 0.32; root.add(hinge);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), dark); post.position.y = 0.1; hinge.add(post);
      const torso = flat(new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 6, 18), steel), 1, 1, 0.12); torso.position.y = 0.5; hinge.add(torso);
      const head = flat(new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12), steel), 1, 1.1, 0.16); head.position.y = 0.98; hinge.add(head);
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(root);
      this.items.push({ type: 'sil', root, hinge, parts: [torso, head], fall: 0, down: 0, angle: 0, vel: 0 });
    }
    for (const [dx, dz, r] of GONGS) {
      const x = RANGE_ORIGIN.x + dx, z = RANGE_ORIGIN.y + dz, gy = terrain.height(x, z);
      const root = new THREE.Group(); root.position.set(x, gy, z);
      root.rotation.y = Math.atan2(RANGE_ORIGIN.x - x, RANGE_ORIGIN.y + 6 - z);
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.9, 10), wood); p.position.set(s * 0.6, 0.95, 0); root.add(p); }
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.35, 10), wood); beam.rotation.z = Math.PI / 2; beam.position.y = 1.85; root.add(beam);
      const pivot = new THREE.Group(); pivot.position.y = 1.8; root.add(pivot);
      for (const s of [-1, 1]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 5), dark); ch.position.set(s * r * 0.6, -0.21, 0); pivot.add(ch); }
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.025, 32), steel); plate.rotation.x = Math.PI / 2; plate.position.y = -0.42 - r; pivot.add(plate);
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(root);
      this.items.push({ type: 'gong', root, pivot, plate, r, angle: 0, vel: 0, flash: 0 });
    }
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
  }

  // returns nearest hit { t, item, part: 'head'|'body'|'plate' } or null
  raycast(o, d, maxT) {
    let best = null;
    for (const it of this.items) {
      if (it.type === 'sil') {
        if (it.down > 0) continue;
        const [torso, head] = it.parts;
        torso.updateWorldMatrix(true, false);
        const a = this._a.set(0, -0.21, 0).applyMatrix4(torso.matrixWorld), b = this._b.set(0, 0.21, 0).applyMatrix4(torso.matrixWorld);
        let t = rayCapsule(o, d, a, b, 0.24);
        if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, item: it, part: 'body' };
        head.getWorldPosition(this._c); t = raySphere(o, d, this._c, 0.14);
        if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, item: it, part: 'head' };
      } else {
        it.plate.getWorldPosition(this._c); const t = raySphere(o, d, this._c, it.r);
        // thin plate: accept only if the ray passes close to the plate plane centre
        if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, item: it, part: 'plate' };
      }
    }
    return best;
  }

  hit(h) {
    const it = h.item;
    if (it.type === 'sil') { it.down = 2.6; it.vel = -6; it.parts.forEach((m) => (m.material = this.mats.steelHit)); }
    else { it.vel += 2.4; it.flash = 0.25; it.plate.material = this.mats.steelHit; }
  }

  update(dt) {
    for (const it of this.items) {
      if (it.type === 'sil') {
        if (it.down > 0) {
          it.down -= dt;
          it.angle = Math.max(-1.45, it.angle + it.vel * dt); it.vel -= 14 * dt;
          if (it.angle <= -1.45) { it.vel = Math.abs(it.vel) * 0.25; if (it.vel < 0.4) it.vel = 0; }
          if (it.down <= 0) { it.parts.forEach((m) => (m.material = this.mats.steel)); }
        } else { it.angle += (0 - it.angle) * (1 - Math.exp(-dt * 7)); }
        it.hinge.rotation.x = it.angle;
      } else {
        it.vel += -it.angle * 18 * dt; it.vel *= Math.exp(-dt * 1.2); it.angle += it.vel * dt;
        it.pivot.rotation.x = it.angle;
        if (it.flash > 0) { it.flash -= dt; if (it.flash <= 0) it.plate.material = this.mats.steel; }
      }
    }
  }
}
