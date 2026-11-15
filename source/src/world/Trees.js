import * as THREE from 'three';
import { mulberry32, smooth } from './Noise.js';
import { pineBranchTexture } from './ProcTextures.js';
import { PLAY_RADIUS } from './Terrain.js';

// Procedural pines: tapered bark trunk + whorls of drooping, crossed needle-branch cards with
// spherical normals (soft, volumetric shading) and per-tree tint. Trees are merged per 160 m cell so
// frustum culling (also for the shadow camera) works with few draw calls.
const CELL = 160;

function buildPine(rnd, H, lite = false) {
  const trunk = { pos: [], nor: [], uv: [], idx: [] };
  const crown = { pos: [], nor: [], uv: [], sway: [], idx: [] };
  const rB = H * (0.017 + rnd() * 0.006), rT = rB * 0.12;
  const SIDES = lite ? 5 : 7, RINGS = lite ? 3 : 6;
  const lean = new THREE.Vector2((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.04);
  const axis = (y) => [lean.x * y, lean.y * y];
  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS, y = t * H * 0.97 - 0.3, r = THREE.MathUtils.lerp(rB, rT, Math.pow(t, 0.8)) * (j === 0 ? 1.35 : 1);
    const [ax, az] = axis(y);
    for (let i = 0; i <= SIDES; i++) {
      const a = i / SIDES * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const rr = r * (1 + (rnd() - 0.5) * 0.12 * (i < SIDES ? 1 : 0));
      trunk.pos.push(ax + c * rr, y, az + s * rr); trunk.nor.push(c, 0.15, s); trunk.uv.push(i / SIDES * 2, y / 1.6);
    }
  }
  for (let j = 0; j < RINGS; j++) for (let i = 0; i < SIDES; i++) {
    const a = j * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1;
    trunk.idx.push(a, c, b, b, c, d);
  }
  // crown
  const crownStart = H * (0.22 + rnd() * 0.12);
  const crownR = H * (0.17 + rnd() * 0.05);
  let y = crownStart;
  const spacing = (0.42 + rnd() * 0.12) * (lite ? 2.3 : 1);
  const center = new THREE.Vector3(0, crownStart + (H - crownStart) * 0.38, 0);
  const tmp = new THREE.Vector3();
  const addCard = (o, dir, L, Wd, rollA, hf) => {
    // card spans from o along dir (length L), width Wd across a vector rotated around dir by rollA
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const vup = new THREE.Vector3().crossVectors(side, dir).normalize();
    const across = side.clone().multiplyScalar(Math.cos(rollA)).addScaledVector(vup, Math.sin(rollA));
    const base = crown.pos.length / 3;
    const pts = [
      o.clone().addScaledVector(across, -Wd * 0.5), o.clone().addScaledVector(across, Wd * 0.5),
      o.clone().addScaledVector(dir, L).addScaledVector(across, -Wd * 0.5), o.clone().addScaledVector(dir, L).addScaledVector(across, Wd * 0.5),
    ];
    // tips droop
    pts[2].y -= L * 0.18; pts[3].y -= L * 0.18;
    const uvs = [[0, 0], [0, 1], [1, 0], [1, 1]];
    for (let k = 0; k < 4; k++) {
      const p = pts[k];
      crown.pos.push(p.x, p.y, p.z);
      tmp.copy(p).sub(center); tmp.y *= 0.6; tmp.normalize(); tmp.y += 0.35; tmp.normalize();
      crown.nor.push(tmp.x, tmp.y, tmp.z);
      crown.uv.push(uvs[k][0], 1 - uvs[k][1]);
      crown.sway.push(hf * (k >= 2 ? 1 : 0.4));
    }
    crown.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  while (y < H) {
    const t = (y - crownStart) / (H - crownStart);
    const r = crownR * Math.pow(1 - t, 0.95) * (0.85 + rnd() * 0.3) + 0.35;
    const n = lite ? Math.max(3, Math.round(4 + rnd() * 2 - t * 2)) : Math.max(3, Math.round(5 + rnd() * 3 - t * 2));
    const a0 = rnd() * Math.PI * 2;
    const [ax, az] = axis(y);
    for (let k = 0; k < n; k++) {
      const a = a0 + k / n * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const droop = -0.22 - rnd() * 0.25 + t * 0.35;
      const dir = new THREE.Vector3(Math.cos(a), droop, Math.sin(a)).normalize();
      const o = new THREE.Vector3(ax, y, az);
      const L = r * (0.95 + rnd() * 0.25), Wd = L * 0.62;
      if (lite) { addCard(o, dir, L * 1.05, Wd * 1.5, 0.3 + rnd() * 0.3, t); continue; }
      addCard(o, dir, L, Wd, 0.25 + rnd() * 0.3, t);
      addCard(o, dir, L * 0.9, Wd * 0.85, 1.35 + rnd() * 0.3, t);
    }
    y += spacing * (0.8 + rnd() * 0.4) * (1 - t * 0.35);
  }
  // leader at the top: two vertical crossed cards
  const top = new THREE.Vector3(...axis(H - 1.4), H - 1.6);
  [top.x, top.y, top.z] = [axis(H)[0], H - 1.7, axis(H)[1]];
  addCard(top, new THREE.Vector3(0, 1, 0), 2.0, 1.1, 0, 1); addCard(top, new THREE.Vector3(0, 1, 0), 2.0, 1.1, Math.PI / 2, 1);
  return { trunk, crown };
}

export class Trees {
  constructor(terrain, quality, renderer, tex, sunDir) {
    this.group = new THREE.Group(); this.group.name = 'Trees';
    this.colliders = []; // [x, z, r]
    const rnd = mulberry32(2024);
    const n = terrain.nz2;
    const target = Math.round(2600 * quality.trees);
    const cells = new Map();
    let placed = 0, tries = 0;
    const MAXR = 760;
    while (placed < target && tries < target * 40) {
      tries++;
      const x = (rnd() * 2 - 1) * MAXR, z = (rnd() * 2 - 1) * MAXR;
      const r = Math.hypot(x, z);
      if (r > MAXR || r < 28) continue;
      // forest mask: clusters / tree lines in the field, dense forest on the rim hills
      const f = n.fbm(x / 140 + 11, z / 140 - 4, 3) * 0.5 + 0.5;
      // groves (dense) + rare lone trees + continuous forest on the rim hills
      // a few groves in the open basin, a dense tree line where the forest begins (~280 m), thinner beyond
      const edge = 285 + n.n(x / 120, z / 120) * 40;
      let dens = smooth(0.6, 0.68, f) * 0.9 * (1 - smooth(edge - 60, edge, r)) + 0.003;
      dens += smooth(edge - 10, edge + 15, r) * (1 - smooth(edge + 60, edge + 200, r) * 0.75);
      dens *= 1 - smooth(600, 900, r) * 0.6;
      if (rnd() > dens) continue;
      if (terrain.pathDist(x, z) < 6) continue;
      if (Math.hypot(x + 28, z + 15) < 34) continue;                 // keep the practice range open
      if (Math.hypot(x - 8, z + 95) < 48 && rnd() > 0.3) continue;   // combat area: only a few trees
      const nrm = terrain.normal(x, z); if (nrm.y < 0.8) continue;
      // spacing
      const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
      if (!cells.has(key)) cells.set(key, []);
      const list = cells.get(key);
      let ok = true; for (const t of list) if ((t.x - x) ** 2 + (t.z - z) ** 2 < 4.6 * 4.6) { ok = false; break; }
      if (!ok) continue;
      const H = 11 + rnd() * 12 + smooth(0.6, 0.9, f) * 5;
      list.push({ x, z, y: terrain.height(x, z), H, rot: rnd() * Math.PI * 2, tint: rnd(), v: Math.floor(rnd() * 6) });
      if (r < PLAY_RADIUS + 20) this.colliders.push([x, z, H * 0.022 + 0.15]);
      placed++;
    }
    this.count = placed;
    // variants
    const vr = mulberry32(77);
    const variants = [], litev = [];
    for (let i = 0; i < 6; i++) variants.push(buildPine(vr, 18));
    for (let i = 0; i < 6; i++) litev.push(buildPine(mulberry32(500 + i), 18, true));
    this.cells = [];

    const branchTex = pineBranchTexture(renderer);
    this.uniforms = { uTime: { value: 0 }, uSunDir: { value: sunDir.clone() } };
    const crownMat = new THREE.MeshStandardMaterial({ map: branchTex, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.88, metalness: 0, envMapIntensity: 0.6 });
    crownMat.alphaToCoverage = quality.msaa > 0;
    crownMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = 'attribute float aSway; uniform float uTime; varying vec3 vTW;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = aSway * aSway;
        vec2 ip = instanceMatrix[3].xz;
        transformed.x += sin(uTime * 1.1 + ip.x * 0.05 + ip.y * 0.03) * 0.09 * sw;
        transformed.z += sin(uTime * 0.9 + ip.y * 0.05) * 0.07 * sw;
      `).replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vTW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform vec3 uSunDir; varying vec3 vTW;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `
        float back = pow(max(dot(normalize(vTW - cameraPosition), uSunDir), 0.0), 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.9, 1.0, 0.55) * back * 0.55;
      `);
    };
    crownMat.customProgramCacheKey = () => 'pine-crown-v1';
    const crownDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: branchTex, alphaTest: 0.38 });
    const trunkMat = new THREE.MeshStandardMaterial({ map: tex.barkD, normalMap: tex.barkN, roughness: 0.95, metalness: 0, color: 0xc8b8a8 });

    // flat list of trees; geometry per variant/LOD rendered as InstancedMesh (24 draw calls in total)
    this.all = [];
    for (const list of cells.values()) for (const t of list) this.all.push(t);
    const mkGeo = (D, crown) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(D.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(D.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(D.uv, 2));
      if (crown) g.setAttribute('aSway', new THREE.Float32BufferAttribute(D.sway, 1));
      g.setIndex(D.idx); g.computeBoundingSphere();
      return g;
    };
    const perVar = [0, 0, 0, 0, 0, 0];
    for (const t of this.all) perVar[t.v]++;
    this.lods = [];
    for (const [V, isFull] of [[variants, true], [litev, false]]) {
      const set = [];
      for (let i = 0; i < 6; i++) {
        const cap = Math.max(1, perVar[i]);
        const tm = new THREE.InstancedMesh(mkGeo(V[i].trunk, false), trunkMat, cap);
        const cm = new THREE.InstancedMesh(mkGeo(V[i].crown, true), crownMat, cap);
        for (const m of [tm, cm]) { m.count = 0; m.castShadow = isFull; m.receiveShadow = true; m.frustumCulled = true; this.group.add(m); }
        cm.customDepthMaterial = crownDepth;
        tm.name = (isFull ? 'PineTrunkFull' : 'PineTrunkLite') + i; cm.name = (isFull ? 'PineCrownFull' : 'PineCrownLite') + i;
        set.push({ tm, cm });
      }
      this.lods.push(set);
    }
    this.lastLod = new THREE.Vector3(1e9, 0, 0);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }
  // distance LOD: refill instance buffers when the player has moved > 12 m
  updateLod(p, force = false) {
    if (!force && this.lastLod.distanceToSquared(p) < 144) return;
    this.lastLod.copy(p);
    const NEAR2 = 210 * 210;
    for (const set of this.lods) for (const v of set) { v.tm.count = 0; v.cm.count = 0; }
    for (const t of this.all) {
      const near = (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < NEAR2;
      const v = this.lods[near ? 0 : 1][t.v];
      const s = t.H / 18;
      this._q.setFromAxisAngle(this._up, -t.rot); this._s.set(s, s, s); this._p.set(t.x, t.y, t.z);
      this._m.compose(this._p, this._q, this._s);
      this._c.setHSL(0.22 + t.tint * 0.07, 0.22 + t.tint * 0.2, 0.5 + t.tint * 0.2);
      const i = v.cm.count++; v.tm.count++;
      v.cm.setMatrixAt(i, this._m); v.tm.setMatrixAt(i, this._m); v.cm.setColorAt(i, this._c);
    }
    for (const set of this.lods) for (const v of set) {
      for (const m of [v.tm, v.cm]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
    }
  }
  update(t) { this.uniforms.uTime.value = t; }
}
