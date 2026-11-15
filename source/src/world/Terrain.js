import * as THREE from 'three';
import { Simplex, smooth } from './Noise.js';

// Rolling open field (play area ~ +-380 m) that climbs into forested hills towards the edge.
// Height is an analytic function (used by the player, bullets and placement) and is also baked into a
// half-float texture so the GPU grass can sit exactly on the ground.
export const PLAY_RADIUS = 360;
const BAKE_HALF = 420; // baked area: +-420 m
const BAKE_RES = 512;

// dirt track (Catmull-Rom through these points, metres)
const PATH_PTS = [[-520, 140], [-330, 95], [-190, 40], [-80, 22], [-12, 14], [60, -10], [140, -60], [210, -150], [300, -210], [420, -260], [560, -300]];
const PATH2_PTS = [[60, -10], [80, 60], [70, 150], [110, 240], [150, 330], [180, 460]];

function catmull(pts, steps = 24) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export class Terrain {
  constructor(seed = 7) {
    this.nz = new Simplex(seed); this.nz2 = new Simplex(seed * 13 + 5);
    this.paths = [catmull(PATH_PTS), catmull(PATH2_PTS)];
    // spatial hash of path segments for fast distance queries
    this.cell = 32; this.grid = new Map();
    for (const P of this.paths) for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1];
      const minx = Math.floor((Math.min(ax, bx) - 12) / this.cell), maxx = Math.floor((Math.max(ax, bx) + 12) / this.cell);
      const minz = Math.floor((Math.min(az, bz) - 12) / this.cell), maxz = Math.floor((Math.max(az, bz) + 12) / this.cell);
      for (let cx = minx; cx <= maxx; cx++) for (let cz = minz; cz <= maxz; cz++) {
        const k = cx + ',' + cz; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push([ax, az, bx, bz]);
      }
    }
  }

  pathDist(x, z) {
    const segs = this.grid.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell));
    if (!segs) return 99;
    let best = 99;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - x, ez = az + dz * t - z; const d = Math.sqrt(ex * ex + ez * ez);
      if (d < best) best = d;
    }
    return best;
  }
  // 0..1 dirt mask (wobbly edges, two wheel ruts)
  pathMask(x, z) {
    const d = this.pathDist(x, z);
    if (d > 6) return 0;
    const wob = this.nz2.n(x * 0.15, z * 0.15) * 0.8;
    return 1 - smooth(1.6 + wob, 3.4 + wob, d);
  }

  baseHeight(x, z) {
    const n = this.nz;
    const r = Math.hypot(x, z);
    let h = n.fbm(x / 260, z / 260, 4) * 9.0 + n.fbm(x / 70 + 3.1, z / 70 - 1.7, 3) * 1.4 + n.n(x / 18, z / 18) * 0.18;
    // calmer basin around the spawn, hills rise towards the edge of the play area and beyond
    h *= 0.55 + 0.45 * smooth(40, 220, r);
    const rim = smooth(300, 900, r);
    h += rim * rim * 80 * (0.7 + 0.6 * n.fbm(x / 400 + 7, z / 400, 3)) + rim * (n.fbm(x / 260 - 3, z / 260 + 9, 4) * 0.5 + 0.5) * 38;
    return h;
  }
  height(x, z) {
    let h = this.baseHeight(x, z);
    const d = this.pathDist(x, z);
    if (d < 8) {
      const m = 1 - smooth(1.2, 7.5, d);
      // slightly sunken track with two ruts
      const ruts = Math.exp(-Math.pow((d - 0.85) / 0.28, 2)) * 0.06;
      h -= m * 0.16 + ruts * m;
    }
    return h;
  }
  normal(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    const hx = this.height(x + e, z) - this.height(x - e, z), hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // Bake: R = height, G = dirt mask, B = grass density, A = slope
  bake() {
    const N = BAKE_RES, data = new Float32Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -BAKE_HALF + (i + 0.5) / N * BAKE_HALF * 2, z = -BAKE_HALF + (j + 0.5) / N * BAKE_HALF * 2;
      const h = this.height(x, z), pm = this.pathMask(x, z);
      const nx = this.height(x + 1, z) - this.height(x - 1, z), nz = this.height(x, z + 1) - this.height(x, z - 1);
      const slope = Math.hypot(nx, nz) * 0.5;
      // grass density: patchy, thinner on the dirt track and steep ground
      const patch = this.nz2.fbm(x / 22, z / 22, 3) * 0.5 + 0.5;
      let dens = smooth(0.18, 0.55, patch) * 0.75 + 0.25;
      dens *= 1 - smooth(0.25, 0.9, pm); dens *= 1 - smooth(0.55, 1.0, slope);
      // trampled, knee-high grass in the combat area and on the practice range so soldiers stay readable
      const cd = Math.hypot(x - 8, z + 95), rd = Math.hypot((x + 28) * 1.6, z + 18);
      const fight = 1 - smooth(45, 70, cd), range = 1 - smooth(22, 40, rd);
      dens *= 1 - Math.max(fight * 0.55, range * 0.6);
      const o = (j * N + i) * 4;
      data[o] = h; data[o + 1] = pm; data[o + 2] = dens; data[o + 3] = slope;
    }
    const half = new Uint16Array(data.length);
    for (let k = 0; k < data.length; k++) half[k] = THREE.DataUtils.toHalfFloat(data[k]);
    const tex = new THREE.DataTexture(half, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.bakeTex = tex; this.bakeData = data;
    this.bakeInfo = new THREE.Vector4(-BAKE_HALF, -BAKE_HALF, 1 / (BAKE_HALF * 2), N);
    return tex;
  }

  // Non-uniform grid: dense (~2.5 m) at the centre, coarse at the 1.8 km edge, one draw call.
  buildMesh(tex, quality) {
    const SEG = quality.name === 'low' ? 300 : 420;
    const A = 520, B = 1250; // x = A*u + B*u^3, u in [-1,1]
    const warp = (u) => A * u + B * u * u * u;
    const n1 = SEG + 1;
    const pos = new Float32Array(n1 * n1 * 3), nor = new Float32Array(n1 * n1 * 3);
    const v = new THREE.Vector3();
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
      const x = warp(i / SEG * 2 - 1), z = warp(j / SEG * 2 - 1);
      const k = (j * n1 + i) * 3;
      pos[k] = x; pos[k + 1] = this.height(x, z); pos[k + 2] = z;
      this.normal(x, z, v); nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
    }
    const idx = new Uint32Array(SEG * SEG * 6); let p = 0;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();

    const t = tex;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.55 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        tGrassD: { value: t.grassD }, tGrassN: { value: t.grassN }, tDirtD: { value: t.dirtD }, tDirtN: { value: t.dirtN },
        tRockD: { value: t.rockD }, tRockN: { value: t.rockN }, tMacro: { value: t.macro }, tBake: { value: this.bakeTex }, uBake: { value: this.bakeInfo },
      });
      sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = `varying vec3 vWPos; varying vec3 vWN;
        uniform sampler2D tGrassD, tGrassN, tDirtD, tDirtN, tRockD, tRockN, tMacro, tBake; uniform vec4 uBake;
        vec3 gNor; float gRough; float gSpec;
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        // two-scale sample with rotation to break tiling
        vec4 tri(sampler2D t, vec2 uv){ vec2 uv2 = mat2(0.8,-0.6,0.6,0.8) * uv * 0.43 + 0.17; return mix(texture2D(t, uv), texture2D(t, uv2), 0.38); }
      ` + sh.fragmentShader
        .replace('#include <map_fragment>', `
          vec2 wuv = vec2(vWPos.x, -vWPos.z);
          vec2 bUv = (vWPos.xz - uBake.xy) * uBake.z;
          vec4 bk = texture2D(tBake, clamp(bUv, 0.0, 1.0));
          float inBake = step(0.0, bUv.x) * step(bUv.x, 1.0) * step(0.0, bUv.y) * step(bUv.y, 1.0);
          float dirt = bk.g * inBake;
          float slope = 1.0 - clamp(vWN.y, 0.0, 1.0);
          float rock = smoothstep(0.16, 0.34, slope);
          vec3 macro = texture2D(tMacro, vWPos.xz / 180.0).rgb;
          vec3 macro2 = texture2D(tMacro, vWPos.xz / 47.0 + 0.3).rgb;
          float mv = dot(macro, vec3(0.333)) * 0.7 + dot(macro2, vec3(0.333)) * 0.6;
          // dry grass ground: texture tinted to warm ochre straw, patches of olive and pale straw
          vec3 gC = tri(tGrassD, wuv / 2.6).rgb;
          float gl = dot(gC, vec3(0.299,0.587,0.114));
          vec3 straw = vec3(0.6, 0.44, 0.19) * (0.55 + gl * 0.9);
          vec3 olive = vec3(0.42, 0.40, 0.20) * (0.55 + gl * 0.9);
          vec3 pale  = vec3(0.6, 0.5, 0.32) * (0.6 + gl * 0.7);
          float pOl = smoothstep(0.45, 0.75, macro2.g * 1.1 - macro.r * 0.3 + 0.15);
          float pPa = smoothstep(0.55, 0.85, mv);
          vec3 grassC = mix(mix(straw, olive, pOl * 0.55), pale, pPa * 0.45);
          // fine streaks visible at distance (looks like grass stalks beyond the 3D grass radius)
          float dist = length(vWPos - cameraPosition);
          float streak = hash12(floor(vWPos.xz * vec2(3.0, 1.2))) * 0.18 - 0.09;
          grassC *= 1.0 + streak * smoothstep(15.0, 60.0, dist);
          // underneath dense 3D grass: darker, shadowed soil
          float under = (1.0 - smoothstep(20.0, 45.0, dist)) * bk.b * inBake;
          grassC *= 1.0 - under * 0.35;
          vec3 dirtC = tri(tDirtD, wuv / 3.2).rgb * vec3(0.86, 0.78, 0.68);
          vec3 rockC = tri(tRockD, wuv / 7.0).rgb * vec3(0.9, 0.88, 0.85);
          // large-scale variation: darker olive/brown swathes, and dense conifer forest on the far hills
          float sw = smoothstep(0.35, 0.7, macro.g * 0.8 + macro2.r * 0.4);
          grassC = mix(grassC, grassC * vec3(0.78, 0.74, 0.62), sw * 0.6);
          float rr = length(vWPos.xz);
          float forest = smoothstep(280.0, 330.0, rr + (mv - 0.55) * 120.0) * (0.94 + 0.06 * smoothstep(0.3, 0.6, mv));
          vec3 forestC = vec3(0.011, 0.019, 0.013) * (0.5 + texture2D(tMacro, vWPos.xz / 9.0).g * 1.0);
          grassC = mix(grassC, forestC, forest);
          vec3 albedo = mix(grassC, dirtC, dirt);
          rock *= 1.0 - forest * 0.85;
          albedo = mix(albedo, rockC * vec3(0.8, 0.8, 0.82), rock);
          diffuseColor.rgb *= albedo;
          vec3 nG = tri(tGrassN, wuv / 2.6).xyz * 2.0 - 1.0;
          vec3 nD = tri(tDirtN, wuv / 3.2).xyz * 2.0 - 1.0;
          vec3 nR = tri(tRockN, wuv / 7.0).xyz * 2.0 - 1.0;
          vec3 nm = mix(mix(nG, nD, dirt), nR, rock);
          nm.xy *= 1.0 - smoothstep(60.0, 220.0, dist) * 0.7;
          vec3 Nw = normalize(vWN);
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
          vec3 Bt = normalize(cross(Nw, T));
          gNor = normalize(mat3(viewMatrix) * normalize(T * nm.x + Bt * nm.y + Nw * nm.z));
          gRough = mix(0.97, 0.9, dirt);
          gSpec = mix(0.35, 0.05, forest);
        `)
        .replace('#include <normal_fragment_maps>', 'normal = gNor;')
        // rough natural ground: suppress the grazing-angle sky reflection that washes distant terrain out
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectSpecular *= gSpec; reflectedLight.directSpecular *= gSpec;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;');
    };
    mat.customProgramCacheKey = () => 'terrain-v1';
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true; mesh.name = 'Terrain';
    return mesh;
  }
}
