import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { Terrain } from './Terrain.js';
import { Grass } from './Grass.js';
import { Trees } from './Trees.js';
import { Mountains } from './Mountains.js';
import { Rocks } from './Rocks.js';
import { installHeightFog } from './Atmosphere.js';
import { Cover, COVER_ROCKS } from './Cover.js';

// Open natural map: dry ochre grass fields, pine stands, boulders, dirt tracks, snowy range on the horizon.
export class World {
  constructor(renderer, scene, manager, quality) {
    this.renderer = renderer; this.scene = scene; this.manager = manager; this.q = quality;
    // Warm afternoon sun from the south-west, ~38 deg high (independent of the HDRI hot spot, which is
    // rotated to match it below).
    this.sunDir = new THREE.Vector3(-0.62, 0.58, 0.53).normalize();
    this.terrain = new Terrain(7);
  }

  async load(onStep = () => {}) {
    const q = this.q;
    const tl = new THREE.TextureLoader(this.manager);
    const T = (n, srgb = false) => tl.loadAsync('./assets/' + n).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(q.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
      if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
    });
    const [hdr, skyJpg, grassD, grassN, dirtD, dirtN, rockD, rockN, rockA, snowD, barkD, barkN, macro] = await Promise.all([
      new HDRLoader(this.manager).loadAsync('./assets/hdr/sky_1k.hdr'),
      T('hdr/sky_4k.jpg', true),
      T('tex2/grass_diff.jpg', true), T('tex2/grass_nor.jpg'), T('tex2/dirt_diff.jpg', true), T('tex2/dirt_nor.jpg'),
      T('tex2/rock_diff.jpg', true), T('tex2/rock_nor.jpg'), T('tex2/rock_arm.jpg'), T('tex2/snow_diff.jpg', true),
      T('tex2/bark_diff.jpg', true), T('tex2/bark_nor.jpg'), T('tex/ground_macro.jpg', true),
    ]);
    onStep('Himmel & Licht');
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    skyJpg.mapping = THREE.EquirectangularReflectionMapping; skyJpg.wrapS = THREE.RepeatWrapping;
    const hdrSun = this.findSun(hdr);
    // keep our azimuth, take the elevation of the HDRI's sun so the disc in the sky matches the light
    { const el = Math.min(Math.asin(hdrSun.y), 55 * Math.PI / 180), az = Math.atan2(this.sunDir.x, this.sunDir.z);
      this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); }
    // rotate sky + IBL so the HDRI's sun sits where our directional light is
    const yawSky = Math.atan2(this.sunDir.x, this.sunDir.z) - Math.atan2(hdrSun.x, hdrSun.z);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromEquirectangular(hdr).texture; pmrem.dispose();
    const s = this.scene;
    s.environment = this.envMap; s.environmentIntensity = 0.7; s.environmentRotation.set(0, yawSky, 0);
    s.background = skyJpg; s.backgroundIntensity = 1.6; s.backgroundRotation.set(0, yawSky, 0);
    this.skyYaw = yawSky;

    // horizon haze colour sampled from the sky, slightly warmed
    this.fogColor = this.horizon(hdr).lerp(new THREE.Color(0.62, 0.74, 0.92), 0.3);
    installHeightFog({ sunDir: this.sunDir, falloff: 0.0019, baseHeight: 0 });
    s.fog = new THREE.FogExp2(this.fogColor, 0.00056);

    // sun + shadows (shadow frustum follows the player, snapped to texels to avoid shimmering)
    const sun = new THREE.DirectionalLight(0xffdcae, 3.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    const d = q.shadowDist;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 420 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06; sun.shadow.radius = 2.5;
    s.add(sun, sun.target);
    this.sun = sun;
    const hemi = new THREE.HemisphereLight(0x9fb8d8, 0x5a4a30, 0.35); s.add(hemi);

    const tex = { grassD, grassN, dirtD, dirtN, rockD, rockN, rockA, snowD, barkD, barkN, macro };
    onStep('Gelände');
    this.terrain.bake();
    this.ground = this.terrain.buildMesh(tex, q); s.add(this.ground);
    await frame();
    onStep('Gras');
    this.grass = new Grass(this.terrain, q, this.renderer, this.sunDir); s.add(this.grass.mesh);
    await frame();
    onStep('Wald');
    this.trees = new Trees(this.terrain, q, this.renderer, tex, this.sunDir); s.add(this.trees.group);
    await frame();
    this.rocks = new Rocks(this.terrain, tex, COVER_ROCKS); s.add(this.rocks.group);
    this.cover = new Cover(this.terrain, tex); s.add(this.cover.group);
    onStep('Berge');
    this.mountains = new Mountains(tex, q); s.add(this.mountains.mesh);
    this.trees.updateLod(new THREE.Vector3(-30, 0, 20), true);
    this.colliders = [...this.trees.colliders, ...this.rocks.colliders, ...this.cover.colliders];
    this.dynamicColliders = [];
    // AI cover anchors: placed cover + any boulder / tree near the combat area
    this.coverPoints = [...this.cover.points];
    for (const c of this.trees.colliders) if (Math.hypot(c[0] - 8, c[1] + 95) < 60) this.coverPoints.push({ x: c[0], z: c[1], r: c[2] });
    this.ready = true;
  }

  findSun(tex) {
    const { data, width, height } = tex.image; const isHalf = data instanceof Uint16Array;
    const get = (i) => (isHalf ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
    const ch = data.length / (width * height);
    let best = -1, bx = 0, by = 0;
    for (let y = 0; y < height / 2; y += 2) for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * ch, l = get(i) + get(i + 1) + get(i + 2);
      if (l > best) { best = l; bx = x; by = y; }
    }
    const lon = (bx / width - 0.5) * Math.PI * 2, lat = (0.5 - by / height) * Math.PI;
    // three equirect lookup: u = atan(dir.z, dir.x) / 2pi + 0.5
    return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  }
  horizon(tex) {
    const { data, width, height } = tex.image; const isHalf = data instanceof Uint16Array;
    const get = (i) => (isHalf ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
    const ch = data.length / (width * height);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor(height * 0.46); y < Math.floor(height * 0.495); y++) for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * ch; r += get(i); g += get(i + 1); b += get(i + 2); n++;
    }
    return new THREE.Color().setRGB(r / n, g / n, b / n, THREE.LinearSRGBColorSpace);
  }

  update(t, playerPos) {
    // snap the shadow frustum centre to shadow texels
    const d = this.q.shadowDist, texel = (2 * d) / this.q.shadow;
    const c = playerPos;
    const sun = this.sun;
    const lightDir = this.sunDir;
    const fx = Math.round(c.x / texel) * texel, fz = Math.round(c.z / texel) * texel;
    sun.target.position.set(fx, c.y, fz);
    sun.position.set(fx, c.y, fz).addScaledVector(lightDir, 200);
    sun.target.updateMatrixWorld();
    this.grass.update(t, playerPos); this.trees.update(t);
    if (!this._lodT || t - this._lodT > 0.5) { this._lodT = t; this.trees.updateLod(playerPos); }
  }
}
const frame = () => new Promise((r) => setTimeout(r, 0));
