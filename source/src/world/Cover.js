import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from './Noise.js';

// Combat-area layout: cover boulders (rendered by Rocks), fallen logs, ammo crates, and a practice range.
export const COMBAT_CENTER = new THREE.Vector2(8, -95);
export const RANGE_ORIGIN = new THREE.Vector2(-30, 14);

// boulders used as cover (relative to the combat centre), passed to Rocks
export const COVER_ROCKS = [
  [-22, 18, 1.25], [-6, 4, 1.5], [14, 16, 1.1], [26, -6, 1.6], [-18, -20, 1.35], [4, -26, 1.2], [30, -30, 1.4], [-34, -2, 1.0],
  [10, 34, 1.15], [-28, 34, 1.3],
].map(([x, z, s], i) => ({ x: COMBAT_CENTER.x + x, z: COMBAT_CENTER.y + z, s: s * 1.45, k: i % 4 }));

// fallen logs: [dx, dz, yaw, length, radius]
const LOGS = [[-10, 22, 0.4, 6.5, 0.38], [18, 2, -1.1, 7.2, 0.42], [-26, -10, 1.3, 5.8, 0.36], [12, -16, 0.15, 6.0, 0.4], [-4, -38, -0.6, 7.0, 0.44], [36, 14, 1.9, 5.5, 0.35]];
// ammo crate stacks: [x, z, yaw, count] in world space
const CRATES = [[-21.5, 17.2, 0.3, 2], [COMBAT_CENTER.x - 2, COMBAT_CENTER.y + 12, -0.4, 2], [COMBAT_CENTER.x + 22, COMBAT_CENTER.y - 18, 1.0, 1]];

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function crateTexture() {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry32(5);
  g.fillStyle = '#4a5233'; g.fillRect(0, 0, W, H);
  // planks with grain
  for (let i = 0; i < 5; i++) {
    const y = i * H / 5;
    g.fillStyle = `rgba(${40 + rnd() * 20},${46 + rnd() * 20},${26 + rnd() * 14},0.5)`; g.fillRect(0, y, W, H / 5);
    for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(20,24,12,${0.08 + rnd() * 0.1})`; g.lineWidth = 1; g.beginPath(); const yy = y + rnd() * H / 5; g.moveTo(0, yy); g.bezierCurveTo(W * 0.3, yy + rnd() * 6 - 3, W * 0.6, yy + rnd() * 6 - 3, W, yy + rnd() * 4 - 2); g.stroke(); }
    g.fillStyle = 'rgba(10,12,6,0.55)'; g.fillRect(0, y, W, 2);
  }
  // worn paint edges
  for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(150,130,90,${rnd() * 0.25})`; const x = rnd() * W, y = rnd() * H; g.fillRect(x, y, 1 + rnd() * 5, 1 + rnd() * 2); }
  // stencil
  g.fillStyle = 'rgba(226,214,160,0.85)'; g.font = '600 46px "Barlow Condensed", Arial Narrow, sans-serif'; g.textAlign = 'center';
  g.fillText('MUNITION', W / 2, H * 0.47);
  g.font = '500 28px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('5,56 MM  ·  840 SCHUSS', W / 2, H * 0.68);
  g.fillStyle = 'rgba(214,170,60,0.9)'; g.fillRect(W * 0.08, H * 0.82, W * 0.84, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function endGrainTexture() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), rnd = mulberry32(8);
  g.fillStyle = '#8a6a44'; g.fillRect(0, 0, S, S);
  for (let r = 4; r < S / 2; r += 3 + rnd() * 4) { g.strokeStyle = `rgba(70,46,24,${0.25 + rnd() * 0.35})`; g.lineWidth = 1 + rnd() * 1.5; g.beginPath(); g.ellipse(S / 2 + rnd() * 3, S / 2 + rnd() * 3, r, r * (0.95 + rnd() * 0.1), 0, 0, Math.PI * 2); g.stroke(); }
  for (let k = 0; k < 7; k++) { const a = rnd() * 6.28; g.strokeStyle = 'rgba(40,26,12,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * S * 0.4 * rnd(), S / 2 + Math.sin(a) * S * 0.4 * rnd()); g.stroke(); }
  g.strokeStyle = '#3d2c1c'; g.lineWidth = 14; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 7, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Cover {
  constructor(terrain, tex) {
    this.group = new THREE.Group(); this.group.name = 'Cover';
    this.colliders = [];   // [x, z, r, topY, kind]
    this.points = [];      // cover anchors for the AI: { x, z, r }
    this.crates = [];      // { pos: Vector3, cool }
    const T = terrain, rnd = mulberry32(17);

    for (const r of COVER_ROCKS) this.points.push({ x: r.x, z: r.z, r: r.s * 1.05 });

    // ---- fallen logs: bark cylinder + end grain caps + broken branch stubs ----
    const bark = tex.barkD.clone(); bark.repeat.set(3, 1); bark.needsUpdate = true;
    const barkN = tex.barkN.clone(); barkN.repeat.set(3, 1); barkN.needsUpdate = true;
    const logMat = new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, color: 0x9a8f80, roughness: 0.95 });
    const capMat = new THREE.MeshStandardMaterial({ map: endGrainTexture(), roughness: 0.9 });
    const stubMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 });
    for (const [dx, dz, yaw, len, rad] of LOGS) {
      const cx = COMBAT_CENTER.x + dx, cz = COMBAT_CENTER.y + dz;
      const ax = Math.sin(yaw), az = Math.cos(yaw);
      const x0 = cx - ax * len / 2, z0 = cz - az * len / 2, x1 = cx + ax * len / 2, z1 = cz + az * len / 2;
      const y0 = T.height(x0, z0) + rad * 0.82, y1 = T.height(x1, z1) + rad * 0.82;
      const g = new THREE.Group();
      const geo = new THREE.CylinderGeometry(rad * 0.92, rad, len, 20, 6, true);
      // slight irregularity
      const p = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.z, v.x); const k = 1 + Math.sin(a * 3 + v.y) * 0.03 + Math.sin(a * 7 - v.y * 2) * 0.02; p.setXYZ(i, v.x * k, v.y, v.z * k); }
      geo.computeVertexNormals();
      const body = new THREE.Mesh(geo, logMat); body.castShadow = body.receiveShadow = true;
      const capG = new THREE.CircleGeometry(rad * 0.96, 20);
      const capA = new THREE.Mesh(capG, capMat); capA.position.y = len / 2; capA.rotation.x = -Math.PI / 2; capA.scale.setScalar(0.92);
      const capB = new THREE.Mesh(capG, capMat); capB.position.y = -len / 2; capB.rotation.x = Math.PI / 2;
      g.add(body, capA, capB);
      for (let s = 0; s < 3; s++) {
        const stub = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.22, rad * 1.4, 8), stubMat);
        const a = rnd() * 6.28, yy = (rnd() - 0.5) * len * 0.8;
        stub.position.set(Math.cos(a) * rad * 0.95, yy, Math.sin(a) * rad * 0.95);
        stub.lookAt(new THREE.Vector3(Math.cos(a) * 3, yy + 0.8, Math.sin(a) * 3)); stub.rotateX(Math.PI / 2);
        stub.castShadow = true; g.add(stub);
      }
      // orient: cylinder axis (Y) -> log direction
      const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.position.set(cx, (y0 + y1) / 2, cz);
      g.rotateY(rnd() * 6.28);
      this.group.add(g);
      // colliders: chain of circles along the log; low enough to be jumped over
      const n = Math.ceil(len / (rad * 1.6));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
        this.colliders.push([x, z, rad, y + rad, 'wood']);
      }
      this.points.push({ x: cx, z: cz, r: rad + 0.2, log: true, ax, az, len });
    }

    // ---- ammo crates (the only box shapes in the game) ----
    const crateMap = crateTexture();
    const crateMat = new THREE.MeshStandardMaterial({ map: crateMap, roughness: 0.82, metalness: 0.0 });
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x434a2e, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.45, metalness: 0.9 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 1 });
    const boxG = new RoundedBoxGeometry(1.0, 0.5, 0.56, 3, 0.035);
    const lidG = new RoundedBoxGeometry(1.03, 0.07, 0.59, 2, 0.025);
    const latchG = new THREE.CylinderGeometry(0.018, 0.018, 0.09, 10);
    const handleG = new THREE.TorusGeometry(0.06, 0.012, 8, 16, Math.PI);
    for (const [x, z, yaw, count] of CRATES) {
      const gy = T.height(x, z);
      const stack = new THREE.Group(); stack.position.set(x, gy - 0.02, z); stack.rotation.y = yaw;
      for (let i = 0; i < count; i++) {
        const c = new THREE.Group();
        const box = new THREE.Mesh(boxG, crateMat); box.position.y = 0.25;
        const lid = new THREE.Mesh(lidG, lidMat); lid.position.y = 0.5;
        c.add(box, lid);
        for (const sx of [-0.3, 0.3]) { const l = new THREE.Mesh(latchG, metal); l.position.set(sx, 0.45, 0.29); c.add(l); }
        for (const sx of [-1, 1]) { const h = new THREE.Mesh(handleG, rope); h.position.set(sx * 0.505, 0.3, 0); h.rotation.set(0, Math.PI / 2, 0); c.add(h); }
        c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        c.position.set(i === 0 ? 0 : (rnd() - 0.5) * 0.12, i * 0.56, i === 0 ? 0 : (rnd() - 0.5) * 0.08);
        c.rotation.y = i === 0 ? 0 : (rnd() - 0.5) * 0.3;
        stack.add(c);
      }
      this.group.add(stack);
      const top = gy + count * 0.56;
      const ux = Math.cos(yaw) * 0.25, uz = -Math.sin(yaw) * 0.25; // local x axis (crate length)
      this.colliders.push([x + ux, z + uz, 0.4, top, 'crate'], [x - ux, z - uz, 0.4, top, 'crate']);
      this.points.push({ x, z, r: 0.7 });
      this.crates.push({ pos: new THREE.Vector3(x, gy + 0.6, z), cool: 0 });
    }
  }
}
