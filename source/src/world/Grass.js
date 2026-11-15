import * as THREE from 'three';
import { mulberry32 } from './Noise.js';
import { grassCardTexture } from './ProcTextures.js';

// GPU grass: N alpha-tested cards scattered in a square tile that wraps around the camera every frame
// (no CPU work per frame). Each card samples the baked terrain (height, density, dirt mask) in the vertex
// shader, bends in the wind, fades in size at the edge of the radius and gets sun back-light translucency.
export class Grass {
  constructor(terrain, quality, renderer, sunDir) {
    const R = quality.grassRadius, S = R * 2 + 4, N = quality.grass;
    const rows = 4;
    const base = new THREE.PlaneGeometry(1, 1, 1, rows - 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv; geo.attributes.normal = base.attributes.normal;
    const off = new Float32Array(N * 4), rnd = new Float32Array(N * 2);
    const r = mulberry32(42);
    for (let i = 0; i < N; i++) {
      off[i * 4] = r() * S; off[i * 4 + 1] = r() * S; off[i * 4 + 2] = r() * Math.PI * 2; off[i * 4 + 3] = 0.3 + Math.pow(r(), 1.5) * 0.75;
      rnd[i * 2] = r(); rnd[i * 2 + 1] = r();
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 2));
    geo.instanceCount = N;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const tex = grassCardTexture(renderer, 0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.65 });
    mat.alphaToCoverage = quality.msaa > 0;
    this.uniforms = {
      uTime: { value: 0 }, uTile: { value: S }, uRadius: { value: R }, tBake: { value: terrain.bakeTex }, uBake: { value: terrain.bakeInfo },
      uSunDir: { value: sunDir.clone() }, uWind: { value: new THREE.Vector2(0.86, 0.5) }, uPlayer: { value: new THREE.Vector3() },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = `
        attribute vec4 aOff; attribute vec2 aRnd;
        uniform float uTime, uTile, uRadius; uniform sampler2D tBake; uniform vec4 uBake; uniform vec2 uWind; uniform vec3 uPlayer;
        varying float vT; varying vec2 vRnd; varying vec3 vGW; varying float vFade;
      ` + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `
          vec2 cpos = cameraPosition.xz;
          vec2 p = aOff.xy; p += uTile * floor((cpos - p) / uTile + 0.5);
          vec2 bUv = (p - uBake.xy) * uBake.z;
          vec4 bk = textureLod(tBake, bUv, 0.0);
          float d = length(p - cpos);
          float fade = 1.0 - smoothstep(uRadius * 0.45, uRadius, d);
          float keep = step(aRnd.y, bk.b) * step(0.0, bUv.x) * step(bUv.x, 1.0) * step(0.0, bUv.y) * step(bUv.y, 1.0);
          float hs = aOff.w * (0.5 + 0.85 * bk.b * bk.b) * keep * mix(0.25, 1.0, fade);
          float t = position.y;
          float ca = cos(aOff.z), sa = sin(aOff.z);
          vec3 side = vec3(ca, 0.0, sa);
          vec3 objectNormal = normalize(vec3(-sa, 0.0, ca) * 0.35 + vec3(0.0, 1.0, 0.0));
          vT = t; vRnd = aRnd; vFade = fade;
        `)
        .replace('#include <begin_vertex>', `
          float w = 0.72 * (0.7 + aRnd.x * 0.6) * keep;
          vec3 transformed = side * position.x * w + vec3(0.0, t * hs, 0.0);
          // wind: large rolling gusts + small flutter, stronger towards the tip
          float ph = dot(p, uWind) * 0.11 - uTime * 1.6;
          float gust = sin(ph) * 0.5 + 0.5; gust = gust * gust;
          float flutter = sin(uTime * 4.7 + aRnd.x * 37.0 + p.x * 0.7) * 0.06;
          float bend = (gust * 0.32 + 0.06 + flutter) * t * t * hs;
          transformed.xz += uWind * bend;
          // static per-card lean so the field is not a uniform wall
          float la = aRnd.x * 6.2832; transformed.xz += vec2(cos(la), sin(la)) * t * t * hs * 0.32 * aRnd.y;
          transformed.y -= bend * bend * 0.35;
          // push grass away from the player's legs
          vec2 away = p - uPlayer.xz; float ad = length(away);
          transformed.xz += (ad > 0.01 ? away / ad : vec2(0.0)) * (1.0 - smoothstep(0.2, 1.1, ad)) * 0.45 * t * t;
          transformed += vec3(p.x, bk.r - 0.04, p.y);
          vGW = transformed;
        `);
      sh.fragmentShader = `
        varying float vT; varying vec2 vRnd; varying vec3 vGW; varying float vFade; uniform vec3 uSunDir;
      ` + sh.fragmentShader
        .replace('#include <alphatest_fragment>', `
          // keep thin stalks from vanishing in the mip chain
          float lod = log2(max(length(dFdx(vMapUv * 512.0)), length(dFdy(vMapUv * 512.0))) + 1e-3);
          diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.32;
          #include <alphatest_fragment>
        `)
        .replace('#include <color_fragment>', `
          // per-card hue variation: straw, ochre, a few olive cards; ambient occlusion towards the root
          float gl0 = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(vec3(gl0), diffuseColor.rgb, 0.85);
          vec3 tint = mix(vec3(1.0, 0.86, 0.62), vec3(1.08, 0.97, 0.8), vRnd.x);
          tint = mix(tint, vec3(0.72, 0.74, 0.52), step(0.82, vRnd.y) * 0.8);
          diffuseColor.rgb *= tint * mix(0.5, 1.08, smoothstep(0.0, 0.5, vT));
        `)
        .replace('#include <emissivemap_fragment>', `
          vec3 vdir = normalize(vGW - cameraPosition);
          float back = pow(max(dot(vdir, uSunDir), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.5) * back * vT * 0.9;
        `);
    };
    mat.customProgramCacheKey = () => 'grass-v1';
    // shadow casting from the cards (cheap depth only), so the field self-shadows in clumps
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = `attribute vec4 aOff; attribute vec2 aRnd; uniform float uTime, uTile, uRadius; uniform sampler2D tBake; uniform vec4 uBake; uniform vec2 uWind; uniform vec3 uPlayer;\n` +
        sh.vertexShader.replace('#include <begin_vertex>', mat.__beginVertex = `
          vec2 cpos = uPlayer.xz;
          vec2 p = aOff.xy; p += uTile * floor((cpos - p) / uTile + 0.5);
          vec2 bUv = (p - uBake.xy) * uBake.z; vec4 bk = textureLod(tBake, bUv, 0.0);
          float d = length(p - cpos);
          float fade = 1.0 - smoothstep(uRadius * 0.35, uRadius * 0.6, d);
          float keep = step(aRnd.y, bk.b) * fade;
          float hs = aOff.w * (0.75 + 0.5 * bk.b) * keep; float t = position.y;
          float ca = cos(aOff.z), sa = sin(aOff.z);
          vec3 transformed = vec3(ca, 0.0, sa) * position.x * 0.95 * keep + vec3(0.0, t * hs, 0.0);
          float ph = dot(p, uWind) * 0.11 - uTime * 1.6; float gust = sin(ph) * 0.5 + 0.5;
          transformed.xz += uWind * (gust * gust * 0.32 + 0.06) * t * t * hs;
          transformed += vec3(p.x, bk.r - 0.04, p.y);
        `);
    };
    depth.customProgramCacheKey = () => 'grass-depth-v1';

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.castShadow = quality.name !== 'low';
    this.mesh.customDepthMaterial = depth;
    this.mesh.name = 'Grass';
    this.mesh.renderOrder = 1;
  }
  update(t, playerPos) { this.uniforms.uTime.value = t; this.uniforms.uPlayer.value.copy(playerPos); }
}
