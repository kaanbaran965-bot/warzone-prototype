import * as THREE from 'three';
import { mulberry32, Simplex } from './Noise.js';
import { PLAY_RADIUS } from './Terrain.js';

// A few weathered boulders and rock outcrops scattered in the field (instanced, 4 shapes).
export class Rocks {
  constructor(terrain, tex, fixed = []) {
    this.group = new THREE.Group(); this.colliders = [];
    const nz = new Simplex(9), rnd = mulberry32(31);
    const shapes = [];
    for (let s = 0; s < 4; s++) {
      const g = new THREE.IcosahedronGeometry(1, 4);
      const p = g.attributes.position, v = new THREE.Vector3();
      const sx = 1 + rnd() * 0.6, sy = 0.55 + rnd() * 0.3, sz = 0.8 + rnd() * 0.5;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = nz.fbm(v.x * 1.3 + s * 7, v.y * 1.3 + v.z * 1.1, 4) * 0.28 + nz.n(v.x * 4 + s, v.z * 4 - v.y) * 0.05;
        v.multiplyScalar(1 + n); v.x *= sx; v.y *= sy; v.z *= sz;
        // flatten the bottom and add a facet-like top cut
        if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.25;
        if (v.y > sy * 0.75) v.y = sy * 0.75 + (v.y - sy * 0.75) * 0.3;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      // planar-ish uv for the rock texture
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 0.5 + p.getZ(i) * 0.3; uv[i * 2 + 1] = p.getY(i) * 0.6 + p.getZ(i) * 0.2; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      shapes.push(g);
    }
    const mat = new THREE.MeshStandardMaterial({ map: tex.rockD, normalMap: tex.rockN, roughnessMap: tex.rockA, color: 0xb8b0a6, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.4, 1.4) });
    // moss/dust on top faces
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying float vUpN;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vUpN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;');
      sh.fragmentShader = 'varying float vUpN;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.34, 0.2), smoothstep(0.55, 0.95, vUpN) * 0.55);');
    };
    const counts = [0, 0, 0, 0], items = [[], [], [], []];
    // hand-placed cover boulders first (combat area)
    for (const f of fixed) { const k = f.k ?? Math.floor(rnd() * 4); items[k].push({ x: f.x, z: f.z, s: f.s, rot: f.rot ?? rnd() * 6.28 }); counts[k]++; }
    for (let tries = 0; tries < 3000 && items.flat().length < 70; tries++) {
      const r = 20 + Math.sqrt(rnd()) * 520, a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (terrain.pathDist(x, z) < 5) continue;
      if (fixed.length && Math.hypot(x - 8, z + 95) < 70) continue; // keep the combat area layout clean
      if (Math.hypot(x + 30, z + 15) < 45) continue; // and the range
      const cl = nz.n(x / 90, z / 90); if (cl < 0.15 && rnd() > 0.25) continue;
      const k = Math.floor(rnd() * 4), s = 0.5 + Math.pow(rnd(), 2.5) * 3.2;
      items[k].push({ x, z, s, rot: rnd() * 6.28 }); counts[k]++;
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let k = 0; k < 4; k++) {
      const im = new THREE.InstancedMesh(shapes[k], mat, items[k].length);
      items[k].forEach((it, i) => {
        e.set((rnd() - 0.5) * 0.25, it.rot, (rnd() - 0.5) * 0.25); q.setFromEuler(e);
        const y = terrain.height(it.x, it.z) - it.s * 0.12;
        m4.compose(new THREE.Vector3(it.x, y, it.z), q, new THREE.Vector3(it.s, it.s, it.s));
        im.setMatrixAt(i, m4);
        if (Math.hypot(it.x, it.z) < PLAY_RADIUS + 10) this.colliders.push([it.x, it.z, it.s * 1.05, y + it.s * 0.62, 'rock']);
      });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
      this.group.add(im);
    }
  }
}
