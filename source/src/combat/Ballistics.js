import * as THREE from 'three';

// Shared ray queries for bullets and line-of-sight.
// Collider format: [x, z, radius, topY?, kind?]. topY undefined = tall (tree trunk).

const _n = new THREE.Vector3();

// ray vs vertical cylinders (trees, rocks, logs as circle chains, crates)
export function rayColliders(o, d, maxT, list, T, best = null) {
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return best;
  for (const c of list) {
    const ox = o.x - c[0], oz = o.z - c[1];
    const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - c[2] * c[2];
    const disc = b * b - 4 * a * cc; if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0.15 || t > maxT || (best && t > best.t)) continue;
    const y = o.y + d.y * t;
    const gy = T.height(o.x + d.x * t, o.z + d.z * t);
    const top = c[3] !== undefined ? c[3] : gy + 30;
    if (y < gy - 0.2 || y > top) continue;
    const nx = (ox + d.x * t) / c[2], nz = (oz + d.z * t) / c[2];
    best = { t, n: new THREE.Vector3(nx, 0.2, nz).normalize(), kind: c[4] || (c[2] < 0.8 ? 'wood' : 'rock') };
  }
  return best;
}

// ray vs heightfield: march + bisection
export function rayTerrain(o, d, maxT, T) {
  let prevT = 0, t = 0.4, step = 0.4;
  while (t < maxT) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y < T.height(x, z)) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (o.y + d.y * m < T.height(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
      return { t: hi, n: T.normal(o.x + d.x * hi, o.z + d.z * hi), kind: 'dirt' };
    }
    prevT = t; step = Math.min(4, step * 1.08); t += step;
  }
  return null;
}

export function rayWorld(world, o, d, maxT) {
  const T = world.terrain;
  let best = rayColliders(o, d, maxT, world.colliders, T, null);
  if (world.dynamicColliders) best = rayColliders(o, d, maxT, world.dynamicColliders, T, best);
  const tr = rayTerrain(o, d, best ? best.t : maxT, T);
  return tr || best;
}

// line of sight between two points (coarse terrain test + colliders)
const _d = new THREE.Vector3();
export function losClear(world, a, b) {
  _d.subVectors(b, a); const L = _d.length(); if (L < 0.5) return true; _d.divideScalar(L);
  const T = world.terrain;
  const steps = Math.ceil(L / 2.5);
  for (let i = 1; i < steps; i++) {
    const t = (i / steps) * L;
    if (a.y + _d.y * t < T.height(a.x + _d.x * t, a.z + _d.z * t) + 0.05) return false;
  }
  if (rayColliders(a, _d, L - 0.4, world.colliders, T, null)) return false;
  if (world.dynamicColliders && rayColliders(a, _d, L - 0.4, world.dynamicColliders, T, null)) return false;
  return true;
}

// ray vs capsule (segment pa-pb, radius r); returns t or -1  (after Inigo Quilez)
export function rayCapsule(ro, rd, pa, pb, r) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0) return t;
    const ocx = y <= 0 ? oax : ro.x - pb.x, ocy = y <= 0 ? oay : ro.y - pb.y, ocz = y <= 0 ? oaz : ro.z - pb.z;
    b = rd.x * ocx + rd.y * ocy + rd.z * ocz; c = ocx * ocx + ocy * ocy + ocz * ocz - r * r; h = b * b - c;
    if (h > 0) { const t2 = -b - Math.sqrt(h); if (t2 > 0) return t2; }
  }
  return -1;
}
export function raySphere(ro, rd, cen, r) {
  const ox = ro.x - cen.x, oy = ro.y - cen.y, oz = ro.z - cen.z;
  const b = ox * rd.x + oy * rd.y + oz * rd.z, c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c; if (h < 0) return -1;
  const t = -b - Math.sqrt(h); return t > 0 ? t : -1;
}
