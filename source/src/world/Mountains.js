import * as THREE from 'three';
import { Simplex, smooth } from './Noise.js';

// Distant snow-capped range (1.6 - 6 km) as one polar mesh: forested foothills, rock faces and snow on
// the ridges and flatter upper slopes. Aerial perspective comes from the height fog.
export class Mountains {
  constructor(tex, quality) {
    const nz = new Simplex(31), nz2 = new Simplex(77);
    const A = quality.name === 'low' ? 320 : 720, Rn = quality.name === 'low' ? 44 : 72;
    const R0 = 1700, R1 = 7000;
    const pos = [], nor = [];
    const H = (x, z) => {
      const r = Math.hypot(x, z), ang = Math.atan2(z, x);
      // the range is highest roughly north/north-east (behind the spawn view) and lower elsewhere
      const dirBoost = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(ang + 1.9)) + 0.25 * nz2.n(ang * 1.3, 2.0);
      const prof = smooth(R0, R0 + 1300, r) * (1 - smooth(4800, R1, r) * 0.4);
      const ridge = nz.ridged(x / 2900, z / 2900, 6);
      const big = nz.fbm(x / 3800 + 5, z / 3800, 3) * 0.5 + 0.5;
      return prof * (ridge * 640 * dirBoost * (0.5 + big * 0.7) + nz2.fbm(x / 500, z / 500, 4) * 60 + 60) - 20;
    };
    for (let j = 0; j <= Rn; j++) {
      const t = j / Rn, r = R0 + (R1 - R0) * Math.pow(t, 1.35);
      for (let i = 0; i <= A; i++) {
        const a = i / A * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, H(x, z), z);
      }
    }
    const idx = [];
    for (let j = 0; j < Rn; j++) for (let i = 0; i < A; i++) {
      const a = j * (A + 1) + i, b = a + 1, c = a + A + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 0.8 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tRock: { value: tex.rockD }, tRockN: { value: tex.rockN }, tSnow: { value: tex.snowD }, tMacro: { value: tex.macro } });
      sh.vertexShader = 'varying vec3 vMW; varying vec3 vMN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vMW = (modelMatrix * vec4(transformed, 1.0)).xyz; vMN = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = 'varying vec3 vMW; varying vec3 vMN; uniform sampler2D tRock, tRockN, tSnow, tMacro; vec3 mNor;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 Nw0 = normalize(vMN);
        // erosion detail: rock normal map at two large scales bends the coarse mesh normal
        vec3 d1 = texture2D(tRockN, vMW.xz / 420.0).xyz * 2.0 - 1.0;
        vec3 d2 = texture2D(tRockN, vec2(vMW.x * 0.7 + vMW.z * 0.7, vMW.y * 1.6) / 160.0).xyz * 2.0 - 1.0;
        vec3 Nw = normalize(Nw0 + vec3(d1.x, 0.0, d1.y) * 0.75 + vec3(d2.x, 0.0, d2.y) * 0.45);
        mNor = normalize(mat3(viewMatrix) * Nw);
        vec3 mac = texture2D(tMacro, vMW.xz / 900.0).rgb; float mv = dot(mac, vec3(0.333));
        vec3 rk = texture2D(tRock, vMW.xz / 160.0).rgb * 0.6 + texture2D(tRock, vec2(vMW.x + vMW.z, vMW.y) / 90.0).rgb * 0.6;
        vec3 rock = mix(vec3(dot(rk, vec3(0.3, 0.59, 0.11))), rk, 0.35) * vec3(0.4, 0.41, 0.45);
        vec3 forest = vec3(0.012, 0.02, 0.014) * (0.6 + mv * 0.7);
        float snowLine = 400.0 + (mv - 0.5) * 200.0;
        float flat_ = smoothstep(0.45, 0.8, Nw.y);
        float snow = smoothstep(snowLine - 60.0, snowLine + 80.0, vMW.y + flat_ * 120.0) * smoothstep(0.5, 0.72, Nw.y + (vMW.y - snowLine) * 0.0006);
        float trees = (1.0 - smoothstep(260.0, 400.0, vMW.y + (mv - 0.5) * 160.0)) * smoothstep(0.42, 0.62, Nw.y);
        vec3 c = mix(rock, forest, trees);
        c = mix(c, vec3(0.8, 0.83, 0.88) * (0.86 + texture2D(tSnow, vMW.xz / 60.0).r * 0.16), snow);
        diffuseColor.rgb *= c;
      `).replace('#include <normal_fragment_maps>', 'normal = mNor;')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectSpecular *= 0.25;');
    };
    mat.customProgramCacheKey = () => 'mountains-v1';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'Mountains';
    this.mesh.frustumCulled = false;
  }
}
