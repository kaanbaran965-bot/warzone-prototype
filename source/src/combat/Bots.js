import * as THREE from 'three';
import { mulberry32 } from '../world/Noise.js';
import { COMBAT_CENTER } from '../world/Cover.js';
import { losClear, rayCapsule, raySphere } from './Ballistics.js';
import { clamp, damp, lerp } from '../core/MathUtil.js';
import { flashTexture } from '../world/ProcTextures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// EASY opponents: slow reactions, poor accuracy, light damage, few at a time (made for movement practice).
export const BOT_CFG = {
  count: 3,
  health: 100,
  viewDist: 62, fov: 110 * Math.PI / 180, hearDist: 14,
  reaction: [1.5, 2.3],       // seconds of continuous sight before they react
  burst: [2, 4], burstRpm: 360, burstPause: [1.8, 3.0],
  damage: 6,
  hitChanceNear: 0.2, hitChanceFar: 0.05, // at 8 m / 55 m
  walkSpeed: 1.35, runSpeed: 3.3,
  respawn: 7,
};
const NAMES = ['Kessler', 'Brandt', 'Vogel', 'Hartmann', 'Krüger', 'Lang', 'Wolf', 'Novak', 'Seidel', 'Roth', 'Becker', 'Falk'];

// ---------- shared materials / geometry ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function camoTexture(seed, base, blobs) {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), rnd = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (const [col, n, size] of blobs) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const x = rnd() * S, y = rnd() * S, r = size * (0.5 + rnd());
      g.beginPath();
      for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7); }
      g.closePath(); g.fill();
      // wrap
      if (x < size * 2 || y < size * 2) { g.save(); g.translate(x < size * 2 ? S : 0, y < size * 2 ? S : 0); g.fill(); g.restore(); }
    }
  }
  // fabric weave
  g.globalAlpha = 0.06; for (let i = 0; i < S; i += 2) { g.fillStyle = i % 4 ? '#000' : '#fff'; g.fillRect(0, i, S, 1); g.fillRect(i, 0, 1, S); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const camo = camoTexture(3, '#6f6a4e', [['#4d5236', 26, 22], ['#8a7a58', 20, 16], ['#3a3426', 14, 12]]);
  camo.repeat.set(2, 2);
  const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  SHARED = {
    uniform: M({ map: camo, color: 0xb4ae9c }),
    vest: M({ color: 0x4f5038, roughness: 0.85 }),
    pouch: M({ color: 0x5c5a40, roughness: 0.85 }),
    skin: M({ color: 0xa0765a, roughness: 0.6 }),
    helmet: M({ color: 0x5d5a42, roughness: 0.75 }),
    dark: M({ color: 0x1d1e1f, roughness: 0.7 }),
    boot: M({ color: 0x3a2f24, roughness: 0.8 }),
    glove: M({ color: 0x2b2a26, roughness: 0.75 }),
    gun: M({ color: 0x1a1b1c, roughness: 0.45, metalness: 0.8 }),
    gunPoly: M({ color: 0x2a2a28, roughness: 0.8 }),
    eye: M({ color: 0x111111, roughness: 0.3 }),
    flash: new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(9, 6, 3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
  };
  return SHARED;
}
const capsule = (r, len, mat, segs = 10) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, segs), mat); m.castShadow = true; return m; };
const cyl = (r0, r1, h, mat, segs = 10) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, segs), mat); m.castShadow = true; return m; };

// a rifle made of cylinders (forward = +Z)
function buildRifle(S) {
  const g = new THREE.Group();
  const along = (m) => { m.rotation.x = Math.PI / 2; return m; };
  const recv = along(cyl(0.032, 0.032, 0.34, S.gun, 8)); recv.scale.set(0.75, 1, 1.25); recv.position.set(0, 0, 0.02); g.add(recv);
  const hg = along(cyl(0.03, 0.03, 0.26, S.gunPoly, 10)); hg.position.set(0, -0.004, 0.3); g.add(hg);
  const barrel = along(cyl(0.009, 0.009, 0.24, S.gun, 8)); barrel.position.set(0, 0, 0.53); g.add(barrel);
  const brake = along(cyl(0.014, 0.014, 0.05, S.gun, 8)); brake.position.set(0, 0, 0.66); g.add(brake);
  const stock = along(cyl(0.022, 0.03, 0.26, S.gunPoly, 8)); stock.position.set(0, -0.02, -0.27); stock.scale.set(0.8, 1, 1.5); g.add(stock);
  const grip = cyl(0.016, 0.018, 0.1, S.gunPoly, 8); grip.position.set(0, -0.07, -0.08); grip.rotation.x = -0.35; g.add(grip);
  const mag = cyl(0.016, 0.018, 0.16, S.gun, 8); mag.scale.set(0.7, 1, 1.6); mag.position.set(0, -0.1, 0.07); mag.rotation.x = 0.35; g.add(mag);
  const optic = along(cyl(0.017, 0.017, 0.1, S.gun, 12)); optic.position.set(0, 0.055, 0.0); g.add(optic);
  g.userData.muzzle = new THREE.Vector3(0, 0, 0.7);
  return g;
}

// merge the rigid child meshes of a group by material (fewer draw calls per soldier)
function mergeByMaterial(group) {
  const byMat = new Map();
  for (const c of [...group.children]) {
    if (!c.isMesh) continue;
    c.updateMatrix();
    const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(c.matrix);
    if (!byMat.has(c.material)) byMat.set(c.material, { geos: [], shadow: false });
    const e = byMat.get(c.material); e.geos.push(g); e.shadow ||= c.castShadow;
    group.remove(c);
  }
  for (const [mat, e] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(e.geos, false), mat); m.castShadow = e.shadow; group.add(m);
  }
}
// place a capsule/cylinder mesh (built along local Y, centred) between points a and b
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
function seg(mesh, a, b) {
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  _dir.subVectors(b, a).normalize();
  mesh.quaternion.setFromUnitVectors(_up, _dir);
}
// analytic two-bone IK: returns the joint (knee/elbow) position for root a, target t, lengths l1/l2, pole dir
const _ab = new THREE.Vector3(), _px = new THREE.Vector3();
function ik2(a, t, l1, l2, pole, out) {
  _ab.subVectors(t, a); let d = _ab.length();
  d = clamp(d, 0.01, l1 + l2 - 1e-4);
  _ab.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _px.copy(pole).addScaledVector(_ab, -pole.dot(_ab)).normalize();
  return out.copy(a).addScaledVector(_ab, x).addScaledVector(_px, h);
}

let botSeq = 0;
export class Bot {
  constructor(manager, idx) {
    this.mgr = manager; this.idx = idx;
    const S = shared();
    this.name = NAMES[(idx + botSeq++) % NAMES.length];
    this.root = new THREE.Group(); this.root.name = 'Bot_' + this.name;
    this.body = new THREE.Group(); this.root.add(this.body); // fall pivot at the feet
    const B = this.body;
    // limbs (positioned every frame)
    this.m = {
      thighL: capsule(0.078, 0.3, S.uniform), thighR: capsule(0.078, 0.3, S.uniform),
      shinL: capsule(0.062, 0.32, S.uniform), shinR: capsule(0.062, 0.32, S.uniform),
      bootL: capsule(0.058, 0.12, S.boot), bootR: capsule(0.058, 0.12, S.boot),
      upL: capsule(0.056, 0.2, S.uniform), upR: capsule(0.056, 0.2, S.uniform),
      foreL: capsule(0.048, 0.2, S.uniform), foreR: capsule(0.048, 0.2, S.uniform),
      handL: new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), S.glove), handR: new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), S.glove),
      pelvis: capsule(0.13, 0.12, S.uniform, 12), torso: capsule(0.155, 0.24, S.uniform, 14),
    };
    this.m.pelvis.rotation.z = Math.PI / 2;
    for (const k in this.m) B.add(this.m[k]);
    // chest group: vest, pouches, backpack, neck, head, helmet (oriented with the upper body)
    this.chest = new THREE.Group(); B.add(this.chest);
    const vest = cyl(0.19, 0.175, 0.34, S.vest, 14); vest.scale.set(1.08, 1, 0.78); vest.position.set(0, 0.04, 0.0); this.chest.add(vest);
    for (let i = -1; i <= 1; i++) { const p = capsule(0.035, 0.07, S.pouch, 8); p.position.set(i * 0.075, -0.05, 0.15); this.chest.add(p); }
    const pack = capsule(0.11, 0.16, S.pouch, 10); pack.position.set(0, 0.05, -0.17); pack.scale.set(1.3, 1, 0.7); this.chest.add(pack);
    const neck = cyl(0.05, 0.055, 0.1, S.skin, 10); neck.position.set(0, 0.25, 0.01); this.chest.add(neck);
    this.head = new THREE.Group(); this.head.position.set(0, 0.36, 0.015); this.chest.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), S.skin); skull.scale.set(0.92, 1.12, 1.0); skull.castShadow = true; this.head.add(skull);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), S.helmet); helmet.position.y = 0.025; helmet.scale.set(1, 0.95, 1.08); helmet.castShadow = true; this.head.add(helmet);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.01, 6, 24), S.helmet); rim.rotation.x = Math.PI / 2; rim.position.y = 0.0; rim.scale.set(1, 1.08, 1); this.head.add(rim);
    const nvg = cyl(0.016, 0.016, 0.05, S.dark, 8); nvg.position.set(0, 0.07, 0.12); nvg.rotation.x = 1.2; this.head.add(nvg);
    const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.014, 6, 20, Math.PI * 0.8), S.dark); goggles.position.set(0, 0.02, 0.0); goggles.rotation.set(0, Math.PI * 1.1, 0); this.head.add(goggles);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), S.eye); e.position.set(s * 0.035, -0.005, 0.088); this.head.add(e); }
    // rifle
    this.rifle = buildRifle(S); B.add(this.rifle);
    this.flash = new THREE.Sprite(S.flash); this.flash.visible = false; this.flash.scale.setScalar(0.5); this.rifle.add(this.flash); this.flash.position.copy(this.rifle.userData.muzzle);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    // small details do not need to cast shadows (saves shadow draw calls on phones)
    for (const o of [nvg, goggles, rim, ...this.head.children.filter((c) => c.geometry?.type === 'SphereGeometry' && c !== skull && c !== helmet)]) o.castShadow = false;
    this.chest.children.forEach((c) => { if (c.geometry?.parameters?.radius < 0.05) c.castShadow = false; });
    this.rifle.children.forEach((c, i) => { if (i > 2) c.castShadow = false; });
    this.m.handL.castShadow = this.m.handR.castShadow = this.m.bootL.castShadow = this.m.bootR.castShadow = false;
    mergeByMaterial(this.chest); mergeByMaterial(this.head); mergeByMaterial(this.rifle);

    // skeleton points (bot local space, +Z forward)
    this.P = {}; for (const k of ['pelvis', 'chest', 'neck', 'head', 'shL', 'shR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR', 'elL', 'elR', 'hL', 'hR', 'toeL', 'toeR']) this.P[k] = new THREE.Vector3();
    this.W = { head: new THREE.Vector3(), neck: new THREE.Vector3(), pelvis: new THREE.Vector3(), kneeL: new THREE.Vector3(), kneeR: new THREE.Vector3(), footL: new THREE.Vector3(), footR: new THREE.Vector3(), chest: new THREE.Vector3() };
    this.rnd = mulberry32(100 + idx * 13);
    this.reset();
  }

  reset() {
    this.health = BOT_CFG.health; this.dead = false; this.deadT = 0; this.fall = 0; this.fallDir = 1;
    this.state = 'patrol'; this.stateT = 0;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.aimPitch = 0; this.aimYaw = 0;
    this.crouch = 0; this.crouchT = 0; this.phase = 0; this.speed = 0;
    this.spot = 0; this.reactT = lerp(BOT_CFG.reaction[0], BOT_CFG.reaction[1], this.rnd());
    this.sees = false; this.visibleToPlayer = false; this.lastSeen = new THREE.Vector3(); this.lostT = 0;
    this.burstLeft = 0; this.shotCool = 0; this.pauseT = 1.5; this.peek = false; this.peekT = 0;
    this.goal = null; this.cover = null; this.waitT = 0;
    this.flinch = 0; this.flinchV = 0; this.flashT = 0; this.percT = this.rnd() * 0.2; this.ready = 0;
    this.root.visible = true; this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0);
    this.rifle.visible = true;
  }

  spawnAt(x, z, yaw) {
    this.reset();
    this.pos.set(x, this.mgr.world.terrain.height(x, z), z); this.yaw = yaw;
    this.home = new THREE.Vector3(x, 0, z);
    this.pickPatrol();
  }

  pickPatrol() {
    const a = this.rnd() * Math.PI * 2, r = 6 + this.rnd() * 18;
    this.goal = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
  }

  // ---------------- AI ----------------
  update(dt, ctx) {
    if (this.dead) { this.updateDead(dt); this.pose(dt); return; }
    const { player, playerEye } = ctx;
    this.stateT += dt;
    this.flinchV += (-this.flinch * 160 - this.flinchV * 14) * dt; this.flinch += this.flinchV * dt;
    const toP = new THREE.Vector3().subVectors(player.pos, this.pos); toP.y = 0;
    const dist = toP.length();

    // perception, a few times per second
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = 0.2;
      const eye = this.eyePos(new THREE.Vector3());
      let canSee = false;
      if (ctx.playerAlive && dist < BOT_CFG.viewDist) {
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const ang = Math.acos(clamp(fwd.dot(toP.clone().normalize()), -1, 1));
        // crouched / sliding players in the grass are harder to notice
        const stealth = player.crouched ? 0.75 : 1;
        if ((ang < BOT_CFG.fov / 2 && dist < BOT_CFG.viewDist * stealth) || dist < BOT_CFG.hearDist || this.state !== 'patrol') {
          canSee = losClear(this.mgr.world, eye, playerEye);
        }
      }
      this.sees = canSee;
      // symmetric visibility for aim assist
      this.visibleToPlayer = ctx.playerAlive && dist < 120 && losClear(this.mgr.world, playerEye, this.chestWorld(new THREE.Vector3()));
    }
    if (this.sees) { this.lastSeen.copy(player.pos); this.lostT = 0; } else this.lostT += dt;

    // state machine
    switch (this.state) {
      case 'patrol': {
        if (this.sees) { this.spot += dt; if (this.spot > this.reactT) this.alert(player); }
        else this.spot = Math.max(0, this.spot - dt * 0.5);
        if (this.waitT > 0) { this.waitT -= dt; this.moveTo(null, 0, dt); }
        else if (this.moveTo(this.goal, BOT_CFG.walkSpeed, dt) < 1.2) { this.pickPatrol(); this.waitT = 1 + this.rnd() * 3; }
        this.crouchT = 0;
        break;
      }
      case 'move': {
        const d = this.moveTo(this.goal, BOT_CFG.runSpeed, dt);
        this.crouchT = 0;
        if (d < 0.7 || this.stateT > 9) { this.setState('cover'); this.peek = false; this.peekT = 1.2 + this.rnd(); }
        break;
      }
      case 'cover': {
        this.moveTo(null, 0, dt);
        this.faceTo(this.lastSeen, dt, 4);
        this.peekT -= dt;
        if (!this.peek && this.peekT <= 0) { this.peek = true; this.peekT = 2.2 + this.rnd() * 1.6; this.ready = 0.7; this.burstLeft = 0; this.pauseT = 0.3; }
        else if (this.peek && this.peekT <= 0) { this.peek = false; this.peekT = 1.8 + this.rnd() * 2; }
        this.crouchT = this.peek ? 0 : 1;
        if (this.peek) this.combat(dt, ctx, dist);
        if (this.lostT > 9) this.setState('search');
        // player flanked the cover => relocate
        if (this.cover && this.stateT > 3) {
          const cx = this.cover.x - player.pos.x, cz = this.cover.z - player.pos.z;
          const bx = this.pos.x - player.pos.x, bz = this.pos.z - player.pos.z;
          if (cx * cx + cz * cz > bx * bx + bz * bz + 0.5 && this.rnd() < dt * 0.6) this.alert(player);
        }
        break;
      }
      case 'fight': { // no cover nearby: stand and shoot, strafe a little
        this.crouchT = 0;
        const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(Math.sin(this.stateT * 0.9) * 2);
        this.moveTo(this.pos.clone().add(side), 1.0, dt, true);
        this.faceTo(this.lastSeen, dt, 4);
        this.combat(dt, ctx, dist);
        if (this.lostT > 7) this.setState('search');
        break;
      }
      case 'search': {
        this.crouchT = 0;
        if (this.sees) { this.alert(player); break; }
        const d = this.moveTo(this.lastSeen, BOT_CFG.walkSpeed * 1.4, dt);
        if (d < 2 || this.stateT > 12) { this.home.set(this.pos.x, 0, this.pos.z); this.setState('patrol'); this.spot = 0; this.pickPatrol(); }
        break;
      }
    }
    this.crouch = damp(this.crouch, this.crouchT, 7, dt);
    // keep feet on the ground and out of obstacles
    this.collide();
    this.pos.y = this.mgr.world.terrain.height(this.pos.x, this.pos.z);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    this.pose(dt);
  }

  setState(s) { this.state = s; this.stateT = 0; }

  alert(player) {
    this.lastSeen.copy(player.pos);
    const c = this.mgr.findCover(this.pos, player.pos, this);
    if (c) { this.cover = c.point; this.goal = c.spot; this.setState('move'); }
    else { this.cover = null; this.setState('fight'); this.ready = 0.8; }
  }

  onDamaged(player) {
    this.flinchV += 3.5;
    if (this.state === 'patrol' || this.state === 'search') { this.spot = this.reactT; this.alert(player); }
    else if (this.state === 'cover' && this.peek && this.rnd() < 0.5) { this.peek = false; this.peekT = 1.2 + this.rnd(); }
  }

  combat(dt, ctx, dist) {
    if (!this.sees || !ctx.playerAlive) return;
    this.faceTo(ctx.player.pos, dt, 5);
    const pl = ctx.player;
    this.aimPitch = Math.atan2(pl.pos.y + pl.eyeHeight - 0.35 - (this.pos.y + 1.4 - this.crouch * 0.4), Math.max(1, dist));
    if (this.ready > 0) { this.ready -= dt; return; }
    if (ctx.graceT > 0) return;
    this.shotCool -= dt;
    if (this.burstLeft <= 0) {
      this.pauseT -= dt;
      if (this.pauseT <= 0) { this.burstLeft = BOT_CFG.burst[0] + Math.floor(this.rnd() * (BOT_CFG.burst[1] - BOT_CFG.burst[0] + 1)); this.pauseT = lerp(BOT_CFG.burstPause[0], BOT_CFG.burstPause[1], this.rnd()); }
      return;
    }
    if (this.shotCool <= 0) { this.shotCool = 60 / BOT_CFG.burstRpm; this.burstLeft--; this.shoot(ctx, dist); }
  }

  shoot(ctx, dist) {
    const p = ctx.player;
    const muzzle = this.rifle.localToWorld(this.rifle.userData.muzzle.clone());
    this.flash.visible = true; this.flashT = 0.05; this.flash.material.rotation = this.rnd() * 6;
    // hit chance: low, worse at range and against fast / crouched targets
    let chance = lerp(BOT_CFG.hitChanceNear, BOT_CFG.hitChanceFar, clamp((dist - 8) / 47, 0, 1));
    const hs = p.horizSpeed;
    if (p.sliding || p.tactical) chance *= 0.4; else if (p.sprinting) chance *= 0.55; else if (hs > 3) chance *= 0.75;
    if (p.crouched && !p.sliding) chance *= 0.8;
    if (!p.grounded) chance *= 0.6;
    const hit = this.rnd() < chance;
    const aim = new THREE.Vector3(p.pos.x, p.pos.y + p.eyeHeight - 0.35, p.pos.z);
    if (!hit) {
      // miss: offset around the player (some pass close enough to crack overhead)
      const off = new THREE.Vector3(this.rnd() - 0.5, this.rnd() * 0.9 - 0.3, this.rnd() - 0.5).normalize().multiplyScalar(0.7 + this.rnd() * 1.6);
      aim.add(off);
    }
    const dir = aim.clone().sub(muzzle); const L = dir.length(); dir.divideScalar(L);
    this.mgr.onBotShot(this, muzzle, dir, hit ? L : L + 60, hit, aim);
  }

  faceTo(target, dt, k) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-k * dt));
  }

  // walk/run towards goal; returns remaining distance
  moveTo(goal, speed, dt, strafe = false) {
    let d = 0;
    const want = new THREE.Vector3();
    if (goal) {
      want.set(goal.x - this.pos.x, 0, goal.z - this.pos.z); d = want.length();
      if (d > 0.3) { want.divideScalar(d).multiplyScalar(speed * Math.min(1, d / 0.8)); if (!strafe) this.faceTo(goal, dt, 5); }
      else want.set(0, 0, 0);
    }
    if (this.flinch > 0.05) want.multiplyScalar(0.4);
    this.vel.x = damp(this.vel.x, want.x, 6, dt); this.vel.z = damp(this.vel.z, want.z, 6, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    return d;
  }

  collide() {
    const w = this.mgr.world, R = 0.35, p = this.pos;
    for (const list of [w.colliders, w.dynamicColliders || []]) for (const c of list) {
      const dx = p.x - c[0], dz = p.z - c[1], rr = c[2] + R;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); p.x += dx / d * (rr - d); p.z += dz / d * (rr - d); }
    }
  }

  // ---------------- damage / death ----------------
  damage(amount, part, player) {
    if (this.dead) return false;
    this.health -= amount;
    if (this.health <= 0) { this.die(part, player); return true; }
    this.onDamaged(player);
    return false;
  }
  die(part, player) {
    this.dead = true; this.deadT = 0; this.health = 0; this.flash.visible = false;
    const toP = new THREE.Vector3().subVectors(player.pos, this.pos);
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.fallDir = toP.dot(fwd) > 0 ? -1 : 1; // fall away from the shooter
    this.fallSide = (this.rnd() - 0.5) * 0.6;
    this.fallV = part === 'head' ? 1.6 : 0.6;
  }
  updateDead(dt) {
    this.deadT += dt;
    // fall: knees buckle first, then the body topples (accelerating), small bounce
    this.fallV += 7.5 * dt; this.fall = Math.min(1, this.fall + this.fallV * dt);
    if (this.fall >= 1 && this.fallV > 0) { this.fallV = -this.fallV * 0.18; if (Math.abs(this.fallV) < 0.3) this.fallV = 0; }
    if (this.deadT > 5) this.body.position.y = -(this.deadT - 5) * 0.5; // sink away
    if (this.deadT > 6.2) this.root.visible = false;
  }

  // ---------------- procedural pose ----------------
  pose(dt) {
    const P = this.P, c = this.crouch;
    const sp = this.speed;
    const running = sp > 2.2;
    const stride = lerp(0.18, running ? 0.42 : 0.3, clamp(sp / 3, 0, 1));
    this.phase += dt * (sp > 0.1 ? (running ? 9.5 : 6.4) * clamp(sp / (running ? 3.3 : 1.4), 0.6, 1.3) : 0);
    const moveAmt = clamp(sp / 0.6, 0, 1);
    const ph = this.phase;
    const dying = this.dead ? Math.min(1, this.fall * 1.6) : 0;
    const hipH = lerp(0.93, 0.58, c) - Math.abs(Math.cos(ph)) * 0.03 * moveAmt - dying * 0.35;
    P.pelvis.set(0, hipH, 0);
    const lean = (running ? 0.22 : 0.06) * moveAmt + c * 0.25 + this.flinch * 0.6;
    P.chest.set(0, hipH + 0.36 * Math.cos(lean), 0.36 * Math.sin(lean));
    P.neck.set(0, P.chest.y + 0.2, P.chest.z + 0.02);
    // legs
    for (const s of [-1, 1]) {
      const L = s < 0 ? 'L' : 'R';
      const p2 = ph + (s < 0 ? 0 : Math.PI);
      const hip = P['hip' + L].set(s * 0.1, hipH - 0.04, 0);
      const swing = Math.sin(p2) * stride * moveAmt;
      const lift = Math.max(0, Math.cos(p2)) * (running ? 0.16 : 0.09) * moveAmt;
      const foot = P['foot' + L].set(s * (0.12 + c * 0.06), 0.07 + lift, swing + c * (s < 0 ? 0.18 : -0.12));
      if (c > 0.5 && s > 0) foot.y += 0; // right knee down in crouch
      ik2(hip, foot, 0.44, 0.44, new THREE.Vector3(0, 0, 1), P['knee' + L]);
      P['toe' + L].copy(foot).add(new THREE.Vector3(0, -0.02, 0.12));
    }
    // aim: rifle in front of the chest; low-ready while patrolling
    const aiming = this.state === 'cover' ? (this.peek ? 1 : 0.3) : this.state === 'fight' ? 1 : this.state === 'move' ? 0.2 : 0;
    this.aimW = damp(this.aimW ?? 0, aiming, 6, dt);
    const pitch = lerp(-0.6, this.aimPitch, this.aimW);
    const rifle = this.rifle;
    const shR = P.shR.set(-0.19, P.chest.y + 0.13, P.chest.z), shL = P.shL.set(0.19, P.chest.y + 0.13, P.chest.z);
    rifle.position.set(-0.11, P.chest.y + 0.08 + this.flinch * 0.1, P.chest.z + 0.16 + (1 - this.aimW) * 0.04);
    rifle.rotation.set(-pitch + (1 - this.aimW) * 0.1, (1 - this.aimW) * 0.5, 0, 'YXZ');
    rifle.visible = !this.dead || this.fall < 0.85;
    rifle.updateMatrix();
    const gripR = new THREE.Vector3(0, -0.06, -0.06).applyMatrix4(rifle.matrix), gripL = new THREE.Vector3(0, -0.03, 0.3).applyMatrix4(rifle.matrix);
    P.hR.copy(gripR); P.hL.copy(gripL);
    if (this.dead) { P.hR.lerp(new THREE.Vector3(-0.3, hipH - 0.1, 0.1), dying); P.hL.lerp(new THREE.Vector3(0.3, hipH - 0.1, 0.1), dying); }
    ik2(shR, P.hR, 0.3, 0.29, new THREE.Vector3(-0.8, -1, -0.2), P.elR);
    ik2(shL, P.hL, 0.3, 0.29, new THREE.Vector3(0.6, -1, -0.1), P.elL);
    P.head.set(0, P.neck.y + 0.1, P.neck.z + 0.02);
    // place meshes
    const m = this.m;
    seg(m.thighL, P.hipL, P.kneeL); seg(m.thighR, P.hipR, P.kneeR);
    seg(m.shinL, P.kneeL, P.footL); seg(m.shinR, P.kneeR, P.footR);
    seg(m.bootL, P.footL, P.toeL); seg(m.bootR, P.footR, P.toeR);
    seg(m.upL, P.shL, P.elL); seg(m.upR, P.shR, P.elR);
    seg(m.foreL, P.elL, P.hL); seg(m.foreR, P.elR, P.hR);
    m.handL.position.copy(P.hL); m.handR.position.copy(P.hR);
    m.pelvis.position.copy(P.pelvis);
    seg(m.torso, P.pelvis, P.neck);
    this.chest.position.copy(P.chest); this.chest.rotation.set(lean, 0, 0);
    this.head.rotation.set(-lean * 0.6 - pitch * 0.5, 0, 0);
    // root transform + death topple about the feet
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    if (this.dead) {
      const f = this.fall * this.fall;
      this.body.rotation.set(this.fallDir * f * 1.45, 0, this.fallSide * f);
    }
    this.root.updateMatrixWorld(true);
    // world-space hit shapes
    const W = this.W, mw = this.body.matrixWorld;
    this.head.getWorldPosition(W.head);
    W.neck.copy(P.neck).applyMatrix4(mw); W.pelvis.copy(P.pelvis).applyMatrix4(mw); W.chest.copy(P.chest).applyMatrix4(mw);
    W.kneeL.copy(P.kneeL).applyMatrix4(mw); W.kneeR.copy(P.kneeR).applyMatrix4(mw);
    W.footL.copy(P.footL).applyMatrix4(mw); W.footR.copy(P.footR).applyMatrix4(mw);
  }

  eyePos(out) { return out.set(this.pos.x, this.pos.y + lerp(1.62, 1.12, this.crouch), this.pos.z); }
  chestWorld(out) { return out.copy(this.W.chest.lengthSq() ? this.W.chest : this.pos); }
  headWorld(out) { return out.copy(this.W.head); }

  raycast(o, d, maxT) {
    if (this.dead) return null;
    const W = this.W; let best = null;
    const test = (t, part) => { if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, bot: this, part }; };
    test(raySphere(o, d, W.head, 0.135), 'head');
    test(rayCapsule(o, d, W.pelvis, W.neck, 0.21), 'body');
    test(rayCapsule(o, d, W.pelvis, W.kneeL, 0.09), 'limb'); test(rayCapsule(o, d, W.kneeL, W.footL, 0.08), 'limb');
    test(rayCapsule(o, d, W.pelvis, W.kneeR, 0.09), 'limb'); test(rayCapsule(o, d, W.kneeR, W.footR, 0.08), 'limb');
    // head shots take priority when both overlap within a few cm
    return best;
  }
}

export class BotManager {
  constructor(world, scene, hooks) {
    this.world = world; this.scene = scene; this.hooks = hooks;
    this.bots = []; this.enabled = true;
    for (let i = 0; i < BOT_CFG.count; i++) { const b = new Bot(this, i); scene.add(b.root); this.bots.push(b); }
    this.spawnPts = [];
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; this.spawnPts.push([COMBAT_CENTER.x + Math.cos(a) * (22 + (i % 3) * 9), COMBAT_CENTER.y + Math.sin(a) * (22 + (i % 3) * 9) - 8]); }
    this.claimed = new Map();
    this._v = new THREE.Vector3();
  }
  initialSpawn(playerPos) { this.bots.forEach((b, i) => this.respawn(b, playerPos, i)); }
  respawn(b, playerPos, i = -1) {
    // farthest-from-player spawn points, a bit random
    const pts = this.spawnPts.map((p) => ({ p, d: Math.hypot(p[0] - playerPos.x, p[1] - playerPos.z) })).filter((x) => x.d > 40).sort((a, b) => b.d - a.d);
    const pick = pts.length ? pts[Math.floor(b.rnd() * Math.min(5, pts.length))].p : this.spawnPts[(i + 3) % this.spawnPts.length];
    const x = pick[0] + (b.rnd() - 0.5) * 6, z = pick[1] + (b.rnd() - 0.5) * 6;
    b.name = NAMES[Math.floor(b.rnd() * NAMES.length)];
    b.spawnAt(x, z, Math.atan2(playerPos.x - x, playerPos.z - z) + (b.rnd() - 0.5) * 2.0);
    b.root.visible = this.enabled;
  }
  // cover spot: behind a cover object relative to the player, not too far, not taken
  findCover(from, playerPos, bot) {
    let best = null, bestScore = Infinity;
    for (const pt of this.world.coverPoints) {
      const d = Math.hypot(pt.x - from.x, pt.z - from.z);
      if (d > 30) continue;
      const taken = [...this.claimed.entries()].some(([b, p]) => b !== bot && p === pt);
      if (taken) continue;
      const ax = pt.x - playerPos.x, az = pt.z - playerPos.z, al = Math.hypot(ax, az) || 1;
      if (al < 8) continue;
      const spot = new THREE.Vector3(pt.x + ax / al * (pt.r + 0.55), 0, pt.z + az / al * (pt.r + 0.55));
      const score = d + Math.abs(al - 28) * 0.3;
      if (score < bestScore) { bestScore = score; best = { point: pt, spot }; }
    }
    if (best) this.claimed.set(bot, best.point);
    return best;
  }
  setEnabled(on) { this.enabled = on; for (const b of this.bots) b.root.visible = on && !(b.dead && b.deadT > 6.2); }
  update(dt, ctx) {
    if (!this.enabled) return;
    for (const b of this.bots) {
      b.update(dt, ctx);
      if (b.dead && b.deadT > BOT_CFG.respawn) { this.claimed.delete(b); this.respawn(b, ctx.player.pos); }
    }
  }
  onBotShot(bot, from, dir, len, hit, aim) { this.hooks.onBotShot?.(bot, from, dir, len, hit, aim); }
  raycast(o, d, maxT) {
    if (!this.enabled) return null;
    let best = null;
    for (const b of this.bots) { const h = b.raycast(o, d, best ? best.t : maxT); if (h && (!best || h.t < best.t)) best = h; }
    return best;
  }
  alive() { return this.enabled ? this.bots.filter((b) => !b.dead) : []; }
}
