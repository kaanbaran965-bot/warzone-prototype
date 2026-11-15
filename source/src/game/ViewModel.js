import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ArmIK } from './ArmIK.js';
import { Spring, damp, clamp, DEG, easeInOut, lerp } from '../core/MathUtil.js';
import { State } from './PlayerController.js';

// Camera-space poses (metres / degrees) as offsets from the hip pose, about the bore point above the grip.
// pos: x right, y up, z back (negative = forward). rot: pitch (muzzle up +), yaw (muzzle left +), roll (top left +).
const POSES = {
  hip:    { pos: [0, 0, 0],             rot: [0, 0, 0] },
  crouch: { pos: [-0.006, -0.006, 0.004], rot: [0, 0.6, 3] },
  sprint: { pos: [-0.012, -0.022, 0.02], rot: [-9, 20, 27] },
  tac:    { pos: [0.022, 0.0, 0.035], rot: [27, -6, 36] },
  slide:  { pos: [-0.03, -0.028, 0.02], rot: [-4, 10, 26] },
};

// Inspect timeline: keys [time s, pos[3], rot[3]] (offsets from hip). Eased between keys.
const INSPECT = [
  [0.00, [0, 0, 0], [0, 0, 0]],
  [0.55, [-0.035, 0.045, 0.03], [14, -24, -55]],   // lift, roll the right side (ejection port) up toward the eye
  [1.55, [-0.038, 0.048, 0.028], [17, -29, -62]],
  [2.25, [-0.045, 0.03, 0.055], [7, 44, 10]],     // turn the muzzle left: left side / charging handle to the eye
  [3.15, [-0.048, 0.034, 0.055], [9, 49, 14]],
  [3.55, [-0.02, 0.01, 0.025], [3, 12, 4]],
  [4.05, [0, 0, 0], [0, 0, 0]],
];
const INSPECT_LEN = INSPECT[INSPECT.length - 1][0];
// sound cues during inspect (time, id)
const INSPECT_CUES = [[0.05, 'cloth'], [0.5, 'handle'], [1.85, 'cloth'], [2.2, 'handle2'], [3.5, 'cloth'], [3.9, 'settle']];

// Hip pose: starts from the rig's authored SMG framing (0.072 / -0.056 / -0.18 m, 5° cant), pushed out and
// lowered for phone aspect ratios so the fixed stock MP5 does not fill the right side of the screen.
// Weapon: M4A1 first-person rig (same rig contract as the MP5 it replaced: Gun_*, IK hand controllers,
// Magazine, ChargingHandle, MuzzleSocket, EjectionPort). sightH = sight line above the bore anchor, adsDist = eye relief.
export const GUN = {
  file: './assets/models/m4a1.glb', node: 'Gun_m4a1', name: 'M4A1',
  hip: { pos: [0.112, -0.112, -0.215], rot: [5, 6, 5] },
  sightH: 0.0694, adsDist: 0.15, adsPitch: 0.68, // pitch so the front post tip meets the rear aperture centre
};
const HIP_SMG = GUN.hip;
const SIGHT_H = GUN.sightH, ADS_DIST = GUN.adsDist;

// Reload choreography (seconds). Offsets in gun-pivot space (x right, y up, z back), degrees for rotation.
const RELOAD_LEN = 2.05, RELOAD_EMPTY_LEN = 2.75;
const RELOAD_CUES = [[0.05, 'cloth'], [0.42, 'magOut'], [1.38, 'magIn'], [1.7, 'cloth']];
const RELOAD_EMPTY_CUES = [[0.05, 'cloth'], [0.42, 'magOut'], [1.38, 'magIn'], [1.92, 'rack'], [2.4, 'cloth']];
const GUN_KEYS = [ // t, pos, rot
  [0.0, [0, 0, 0], [0, 0, 0]],
  [0.3, [-0.012, 0.012, 0.01], [9, 6, -22]],
  [1.25, [-0.016, 0.016, 0.012], [11, 8, -26]],
  [1.42, [-0.012, 0.02, 0.014], [14, 7, -20]],   // seat the mag: small bump
  [1.75, [-0.006, 0.006, 0.006], [4, 2, -8]],
  [2.05, [0, 0, 0], [0, 0, 0]],
];
const GUN_KEYS_EMPTY = [
  [0.0, [0, 0, 0], [0, 0, 0]],
  [0.3, [-0.012, 0.012, 0.01], [9, 6, -22]],
  [1.25, [-0.016, 0.016, 0.012], [11, 8, -26]],
  [1.42, [-0.012, 0.02, 0.014], [14, 7, -20]],
  [1.7, [-0.022, 0.022, 0.0], [6, -14, 18]],    // roll left: charging handle towards the support hand
  [1.92, [-0.026, 0.02, 0.012], [9, -16, 22]],   // HK slap
  [2.15, [-0.02, 0.016, 0.004], [5, -10, 14]],
  [2.75, [0, 0, 0], [0, 0, 0]],
];

export class ViewModel {
  constructor(scene, manager, renderer) {
    this.scene = scene; this.manager = manager; this.renderer = renderer;
    this.root = new THREE.Group(); this.root.name = 'ViewModelRoot';
    scene.add(this.root);
    this.t = 0;
    this.poseW = { crouch: 0, sprint: 0, tac: 0, slide: 0 };
    this.bob = { amp: 0 };
    // springs (camera-space offsets)
    this.kickY = new Spring(140, 13); this.kickPitch = new Spring(120, 11); this.kickZ = new Spring(160, 16);
    this.landRoll = new Spring(130, 12);
    this.swayYaw = 0; this.swayPitch = 0; this.swayRoll = 0; this.moveX = 0; this.moveZ = 0;
    this.inspectT = -1; this.inspectBlend = 0; this.cueIdx = 0;
    this.onCue = null;
    this.fingers = null;
    // aim down sights / recoil / reload
    this.ads = 0; this.adsTarget = 0;
    this.rcZ = new Spring(260, 20); this.rcPitch = new Spring(210, 15); this.rcYaw = new Spring(180, 14); this.rcRoll = new Spring(150, 12); this.rcY = new Spring(240, 19);
    this.reloadT = -1; this.reloadEmpty = false; this.reloadCue = 0;
    this.sightH = SIGHT_H; this.adsDist = ADS_DIST;
    this.triggerPull = 0;
  }

  async load() {
    const loader = new GLTFLoader(this.manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(GUN.file);
    const model = gltf.scene;
    const fp = JSON.parse(model.getObjectByName('FP_' + GUN.node.slice(4))?.userData?.fp || model.userData?.fp || '{}');
    const K = fp.K || 2;
    const boreRef = fp.hip?.boreRef || [0, -0.055, 0.0494];
    // boreRef is in Blender axes (x right, y forward(-), z up), real metres -> three (x, z, -y)
    const anchor = new THREE.Vector3(boreRef[0], boreRef[2], -boreRef[1]);

    model.scale.setScalar(1 / K);
    const aniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material;
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = aniso;
        m.envMapIntensity = m.name === 'arms' ? 1.0 : 1.5;
        // the scan reads as pure black metal; treat it as parkerised / painted steel so edges and parts read
        if (m.name !== 'arms') { m.envMapIntensity = 2.2; m.color.setScalar(2.4); }
        if (m.name === 'arms') { m.roughness = 1.0; }
        m.side = THREE.FrontSide; // the meshes are closed; front side halves shadow/fill cost
        m.shadowSide = THREE.FrontSide;
      }
    });

    // hip frame: camera-space hip pose; model offset so the bore anchor sits at the frame origin
    this.hip = new THREE.Object3D();
    this.hip.position.fromArray(HIP_SMG.pos);
    this.hip.rotation.set(HIP_SMG.rot[0] * DEG, HIP_SMG.rot[1] * DEG, HIP_SMG.rot[2] * DEG, 'YXZ');
    this.root.add(this.hip);
    this.hip.add(model);
    model.position.copy(anchor).multiplyScalar(-1);
    this.root.updateMatrixWorld(true);

    // Separate the moving parts: the gun and both hand controllers ride the "gun pivot";
    // the shoulders ride a "body pivot" that follows only part of the motion; the forearms are solved by IK.
    this.gunPivot = new THREE.Object3D(); this.gunPivot.name = 'GunPivot';
    this.bodyPivot = new THREE.Object3D(); this.bodyPivot.name = 'BodyPivot';
    this.hip.add(this.gunPivot, this.bodyPivot);
    this.root.updateMatrixWorld(true);
    const get = (n) => {
      const o = this.hip.getObjectByName(n) || this.hip.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
      if (!o) throw new Error('missing node ' + n); return o;
    };
    this.gun = get(GUN.node);
    for (const n of [GUN.node, 'IK_Hand_Cntrl_L', 'IK_Hand_Cntrl_R']) this.gunPivot.attach(get(n));
    for (const n of ['Arm_L', 'Arm_R']) this.bodyPivot.attach(get(n));
    this.root.updateMatrixWorld(true);

    this.ikL = new ArmIK(get('UpArm_L'), get('Forearm_L'), get('BoneTwist_01.L_end'), get('Hand_L'));
    this.ikR = new ArmIK(get('UpArm_R'), get('Forearm_R'), get('BoneTwist_01.R_end'), get('Hand_R'));
    this.ikL.captureRest(); this.ikR.captureRest();

    this.magazine = get('Magazine'); this.magRest = this.magazine.position.clone();
    this.chHandle = get('ChargingHandle'); this.chRest = this.chHandle.position.clone();

    // finger chains (bone.004-.007 etc., thumb .020-.022) for small procedural grip adjustments
    this.fingers = {};
    for (const side of ['L', 'R']) {
      const chains = [[4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], [16, 17, 18, 19], [20, 21, 22]];
      this.fingers[side] = chains.map((c) => c.map((i) => {
        const b = get(`Bone_${side}.${String(i).padStart(3, '0')}`);
        return { b, rest: b.quaternion.clone() };
      }));
    }
    // reload rig: magazine rides the gun pivot so it can leave with the support hand
    this.gunPivot.attach(this.magazine); this.magRest = this.magazine.position.clone(); this.magRestQ = this.magazine.quaternion.clone();
    this.handL = get('IK_Hand_Cntrl_L'); this.handLRest = this.handL.position.clone(); this.handLRestQ = this.handL.quaternion.clone();
    this.handR = get('IK_Hand_Cntrl_R');
    this.muzzle = get('MuzzleSocket'); this.ejectPort = get('EjectionPort');
    this.gunPivot.attach(this.chHandle); this.chRest = this.chHandle.position.clone();
    this.root.updateMatrixWorld(true);
    const toPivot = (o) => this.gunPivot.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    this.magPivot = toPivot(this.magazine); this.chPivot = toPivot(this.chHandle);
    this.computeAds();
    this.model = model;
    return this;
  }

  // ADS target for the gun pivot: gun level with the view axis and the sight line on the screen centre.
  computeAds() {
    const hq = this.hip.quaternion.clone(), hqi = hq.clone().invert();
    const E = new THREE.Vector3(0, 0, -this.adsDist).sub(this.hip.position).applyQuaternion(hqi);
    const sp = new THREE.Vector3(0, this.sightH, 0).applyQuaternion(hqi);
    this.adsPos = E.sub(sp).toArray();
    const e = new THREE.Euler().setFromQuaternion(hqi, 'YXZ');
    this.adsRot = [e.x / DEG + (GUN.adsPitch || 0), e.y / DEG, e.z / DEG];
  }
  setAds(on) { this.adsTarget = on ? 1 : 0; }
  // one shot of recoil: back + muzzle climb with random yaw, quick settle
  kick(adsF = 0) {
    const m = 1 - adsF * 0.55;
    this.rcZ.impulse(0.9 * m); this.rcPitch.impulse((55 + Math.random() * 25) * m);
    this.rcYaw.impulse((Math.random() - 0.5) * 40 * m); this.rcRoll.impulse((Math.random() - 0.5) * 70 * m);
    this.rcY.impulse(0.12 * m);
    this.triggerPull = 1;
  }
  startReload(empty) { this.reloadT = 0; this.reloadEmpty = empty; this.reloadCue = 0; this.cancelInspect(); }
  get reloading() { return this.reloadT >= 0; }
  get reloadLen() { return this.reloadEmpty ? RELOAD_EMPTY_LEN : RELOAD_LEN; }

  startInspect() {
    if (this.inspectT >= 0) return false;
    this.inspectT = 0; this.cueIdx = 0; return true;
  }
  cancelInspect() { if (this.inspectT >= 0) this.inspectT = -1; }
  get inspecting() { return this.inspectT >= 0; }

  onPlayerEvent(e, player) {
    if (e.type === 'jump') { this.kickY.impulse(0.42); this.kickPitch.impulse(48); this.kickZ.impulse(0.1); }
    if (e.type === 'land') {
      const f = clamp(e.data / 7, 0.25, 1.6);
      this.kickY.impulse(-0.5 * f); this.kickPitch.impulse(-42 * f); this.landRoll.impulse(26 * f * (Math.random() < 0.5 ? -1 : 1));
    }
    if (e.type === 'slideStart') { this.kickY.impulse(-0.3); this.kickPitch.impulse(-20); }
    if (e.type === 'tacStart') { this.kickY.impulse(0.2); this.kickPitch.impulse(20); }
    if (e.type === 'crouch' || e.type === 'stand') { this.kickY.impulse(e.type === 'crouch' ? -0.16 : 0.12); }
  }

  // look = {x,y} radians this frame (for sway), player = PlayerController
  update(dt, player, look) {
    if (!this.model) return;
    this.t += dt;
    const st = player.state;
    // inspect is interrupted by sprinting, sliding or jumping (fades out via blend)
    if (this.inspectT >= 0 && (player.sprinting || player.sliding || !player.grounded)) this.inspectT = -1;

    // --- pose weights ---
    const k = 7.5;
    this.poseW.sprint = damp(this.poseW.sprint, st === State.SPRINT ? 1 : 0, k, dt);
    this.poseW.tac = damp(this.poseW.tac, st === State.TAC ? 1 : 0, 6.5, dt);
    this.poseW.slide = damp(this.poseW.slide, st === State.SLIDE ? 1 : 0, 9, dt);
    this.poseW.crouch = damp(this.poseW.crouch, st === State.CROUCH ? 1 : 0, 8, dt);
    // in the air keep the previous ground pose but fade the sprint carry slightly
    const pos = [0, 0, 0], rot = [0, 0, 0];
    for (const name of ['crouch', 'sprint', 'tac', 'slide']) {
      const w = this.poseW[name], p = POSES[name];
      for (let i = 0; i < 3; i++) { pos[i] += p.pos[i] * w; rot[i] += p.rot[i] * w; }
    }

    // --- idle breathing (always on, reduced while moving) ---
    const speed = player.horizSpeed;
    const moveF = clamp(speed / 4.6, 0, 1.8);
    const breathe = 1 - clamp(moveF, 0, 1) * 0.6;
    const bt = this.t * 1.55;
    pos[1] += Math.sin(bt) * 0.0017 * breathe;
    pos[0] += Math.sin(bt * 0.5 + 1.3) * 0.0008 * breathe;
    rot[0] += Math.sin(bt + 0.6) * 0.28 * breathe;
    rot[2] += Math.sin(bt * 0.5) * 0.35 * breathe;

    // --- walk / sprint bob tied to the footstep phase (figure-8) ---
    const grounded = player.grounded && !player.sliding;
    const ampT = grounded ? clamp(speed / 4.6, 0, 1.9) : 0;
    this.bob.amp = damp(this.bob.amp, ampT, 8, dt);
    const ph = player.stepPhase * Math.PI; // one full side-to-side cycle every two steps
    const a = this.bob.amp;
    const sprintish = Math.max(this.poseW.sprint, this.poseW.tac);
    const ax = lerp(0.0065, 0.016, sprintish), ay = lerp(0.0042, 0.011, sprintish);
    pos[0] += Math.sin(ph) * ax * a;
    pos[1] += -Math.abs(Math.sin(ph)) * ay * a + ay * a * 0.5;
    rot[2] += Math.sin(ph) * lerp(1.1, 4.5, sprintish) * a;
    rot[1] += Math.sin(ph) * lerp(0.6, 3.5, sprintish) * a;
    rot[0] += (Math.abs(Math.cos(ph)) - 0.5) * lerp(0.6, 3.0, sprintish) * a;

    // --- look sway: weapon lags behind camera rotation ---
    const lx = clamp(look.x / Math.max(dt, 1e-3), -12, 12), ly = clamp(look.y / Math.max(dt, 1e-3), -12, 12);
    this.swayYaw = damp(this.swayYaw, lx * 1.3, 10, dt);
    this.swayPitch = damp(this.swayPitch, ly * 1.1, 10, dt);
    rot[1] += this.swayYaw; rot[0] += this.swayPitch; rot[2] += this.swayYaw * 0.6;
    pos[0] += -this.swayYaw * 0.0009;
    // --- movement sway: strafe tilts, forward pushes in ---
    const yawF = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const vR = player.vel.x * -yawF.z + player.vel.z * yawF.x;
    const vF = player.vel.x * yawF.x + player.vel.z * yawF.z;
    this.moveX = damp(this.moveX, vR, 6, dt); this.moveZ = damp(this.moveZ, vF, 6, dt);
    rot[2] += -this.moveX * 0.55; pos[0] += -this.moveX * 0.0012;
    pos[2] += clamp(this.moveZ, -6, 9) * 0.0011 * (1 - sprintish);
    // --- airborne: gun floats with vertical velocity ---
    if (!player.grounded) { pos[1] += clamp(-player.vel.y * 0.0022, -0.012, 0.012); rot[0] += clamp(player.vel.y * 0.35, -2.5, 2.5); }

    // --- springs (jump kick / landing dip) ---
    this.kickY.update(dt); this.kickPitch.update(dt); this.kickZ.update(dt); this.landRoll.update(dt);
    pos[1] += this.kickY.x; rot[0] += this.kickPitch.x; pos[2] += this.kickZ.x; rot[2] += this.landRoll.x;

    // --- inspect ---
    let ip = null, ir = null;
    if (this.inspectT >= 0) {
      this.inspectT += dt;
      while (this.cueIdx < INSPECT_CUES.length && this.inspectT >= INSPECT_CUES[this.cueIdx][0]) { this.onCue?.(INSPECT_CUES[this.cueIdx][1]); this.cueIdx++; }
      if (this.inspectT >= INSPECT_LEN) this.inspectT = -1;
      else { [ip, ir] = sampleKeys(INSPECT, this.inspectT); }
    }
    this.inspectBlend = damp(this.inspectBlend, ip ? 1 : 0, ip ? 30 : 9, dt);
    if (ip) { this.lastIp = ip; this.lastIr = ir; }
    if (this.lastIp && this.inspectBlend > 1e-3) {
      const w = this.inspectBlend;
      for (let i = 0; i < 3; i++) { pos[i] += this.lastIp[i] * w; rot[i] += this.lastIr[i] * w; }
      // damp the bob while inspecting
    }

    // --- aim down sights: motion is calmed, pose blends to the sight-aligned target ---
    const blocked = this.reloadT >= 0 || player.sprinting || player.sliding;
    this.ads = damp(this.ads, blocked ? 0 : this.adsTarget, this.adsTarget ? 13 : 11, dt);
    const A = easeInOut(clamp(this.ads, 0, 1));
    const calm = 1 - A * 0.9;
    for (let i = 0; i < 3; i++) { pos[i] = pos[i] * calm + this.adsPos[i] * A; rot[i] = rot[i] * calm + this.adsRot[i] * A; }

    // --- recoil springs ---
    this.rcZ.update(dt); this.rcPitch.update(dt); this.rcYaw.update(dt); this.rcRoll.update(dt); this.rcY.update(dt);
    pos[2] += this.rcZ.x * 0.03; pos[1] += this.rcY.x * 0.03; rot[0] += this.rcPitch.x * 0.05; rot[1] += this.rcYaw.x * 0.05; rot[2] += this.rcRoll.x * 0.05;
    this.triggerPull = damp(this.triggerPull, 0, 18, dt);

    // --- reload choreography ---
    let handOff = null, magOff = null, chOff = 0, hideMag = false;
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const cues = this.reloadEmpty ? RELOAD_EMPTY_CUES : RELOAD_CUES;
      while (this.reloadCue < cues.length && this.reloadT >= cues[this.reloadCue][0]) { this.onCue?.(cues[this.reloadCue][1]); this.reloadCue++; }
      const len = this.reloadLen;
      if (this.reloadT >= len) this.reloadT = -1;
      else {
        const r = sampleReload(this.reloadT, this.reloadEmpty, this);
        for (let i = 0; i < 3; i++) { pos[i] += r.gp[i]; rot[i] += r.gr[i]; }
        handOff = r.hand; magOff = r.mag; chOff = r.ch; hideMag = r.hide;
      }
    }
    this.handL.position.copy(this.handLRest); this.handL.quaternion.copy(this.handLRestQ);
    if (handOff) { this.handL.position.add(handOff.p); this.handL.quaternion.multiply(handOff.q); }
    this.magazine.position.copy(this.magRest); this.magazine.visible = !hideMag;
    if (magOff) this.magazine.position.add(magOff);
    this.chHandle.position.copy(this.chRest); this.chHandle.position.z += chOff;

    // --- apply to gun pivot; shoulders follow part of the translation (all of it when aiming) ---
    this.gunPivot.position.set(pos[0], pos[1], pos[2]);
    this.gunPivot.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'YXZ');
    const bf = lerp(0.45, 0.92, A);
    this.bodyPivot.position.set(pos[0] * bf, pos[1] * lerp(0.55, 0.92, A), pos[2] * lerp(0.6, 0.95, A));
    this.bodyPivot.rotation.set(rot[0] * DEG * lerp(0.15, 0.7, A), rot[1] * DEG * lerp(0.4, 0.8, A), rot[2] * DEG * lerp(0.12, 0.6, A), 'YXZ');

    // --- fingers: light grip tension changes (not a full finger animation) ---
    this.applyFingers(Math.sin(bt * 0.9) * 0.5 + 0.5);

    this.root.updateMatrixWorld(true);
    this.ikL.solve(); this.ikR.solve();
  }

  applyFingers(breath) {
    // Chain 0 = index finger (checked in close-up renders). The authored grip already keeps the index finger
    // straight along the frame (trigger discipline) -- correct while there is no shooting yet. Curling = -Z.
    const R = this.fingers.R, L = this.fingers.L;
    const q = new THREE.Quaternion();
    const curl = (chain, amt, axis) => {
      for (let i = 1; i < chain.length; i++) {
        const { b, rest } = chain[i];
        q.setFromAxisAngle(axis, amt * (i === 1 ? 0.6 : 1));
        b.quaternion.copy(rest).multiply(q);
      }
    };
    const X = FINGER_AXIS;
    curl(R[TRIGGER_CHAIN], -0.03 * breath - this.inspectBlend * 0.06 - this.triggerPull * 0.0, X); // small index finger movement
    for (let c = 0; c < 4; c++) if (c !== TRIGGER_CHAIN) curl(R[c], (breath - 0.5) * 0.03, X);
    for (let c = 0; c < 4; c++) curl(L[c], (breath - 0.5) * 0.04 + this.inspectBlend * 0.05, X);
  }
}

export let FINGER_AXIS = new THREE.Vector3(0, 0, 1);
export let TRIGGER_CHAIN = 0;
export function setFingerDebug(axis, chain) { FINGER_AXIS = axis; TRIGGER_CHAIN = chain; }

function sampleKeys(keys, t) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, p0, r0] = keys[i], [t1, p1, r1] = keys[i + 1];
  const u = easeInOut(clamp((t - t0) / (t1 - t0), 0, 1));
  return [p0.map((v, j) => lerp(v, p1[j], u)), r0.map((v, j) => lerp(v, r1[j], u))];
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler();
function keyLerp(keys, t) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, p0, r0] = keys[i], [t1, p1, r1] = keys[i + 1];
  const u = easeInOut(clamp((t - t0) / (t1 - t0), 0, 1));
  return [p0.map((v, j) => lerp(v, p1[j], u)), r0.map((v, j) => lerp(v, r1[j], u))];
}
// Support hand path: grip -> magazine -> down out of view (new mag) -> up into the well -> (charging handle) -> grip.
function sampleReload(t, empty, vm) {
  const [gp, gr] = keyLerp(empty ? GUN_KEYS_EMPTY : GUN_KEYS, t);
  const grip = vm.handLRest, mag = vm.magPivot, ch = vm.chPivot;
  const toMag = new THREE.Vector3().subVectors(mag, grip).add(new THREE.Vector3(-0.004, -0.018, 0.004));
  const down = new THREE.Vector3(-0.03, -0.17, 0.03);
  const H = [ // t, hand offset from grip, hand roll (deg), mag offset (pivot), mag hidden
    [0.0, [0, 0, 0], 0, [0, 0, 0], 0],
    [0.32, toMag.toArray(), -25, [0, 0, 0], 0],
    [0.45, toMag.clone().add(new THREE.Vector3(0, -0.02, 0.002)).toArray(), -28, [0, -0.02, 0.002], 0],
    [0.78, toMag.clone().add(down).toArray(), -35, down.clone().add(new THREE.Vector3(0, -0.02, 0)).toArray(), 0],
    [0.95, toMag.clone().add(down).add(new THREE.Vector3(0, -0.06, 0)).toArray(), -35, down.clone().add(new THREE.Vector3(0, -0.08, 0)).toArray(), 1],
    [1.05, toMag.clone().add(down).add(new THREE.Vector3(0, -0.06, 0)).toArray(), -35, down.clone().add(new THREE.Vector3(0, -0.08, 0)).toArray(), 0],
    [1.28, toMag.clone().add(new THREE.Vector3(0, -0.045, 0.004)).toArray(), -28, [0, -0.045, 0.004], 0],
    [1.4, toMag.toArray(), -25, [0, 0, 0], 0],
  ];
  if (empty) {
    const toCh = new THREE.Vector3().subVectors(ch, grip).add(new THREE.Vector3(-0.012, 0.004, 0.0));
    H.push([1.62, toCh.clone().add(new THREE.Vector3(-0.01, 0.0, -0.02)).toArray(), 20, [0, 0, 0], 0]);
    H.push([1.84, toCh.toArray(), 25, [0, 0, 0], 0]);
    H.push([1.95, toCh.clone().add(new THREE.Vector3(0, -0.004, 0.012)).toArray(), 25, [0, 0, 0], 0]);
    H.push([2.25, [0, -0.004, 0.0], 5, [0, 0, 0], 0]);
    H.push([2.6, [0, 0, 0], 0, [0, 0, 0], 0]);
  } else {
    H.push([1.8, [0, -0.004, 0], 4, [0, 0, 0], 0]);
    H.push([2.05, [0, 0, 0], 0, [0, 0, 0], 0]);
  }
  let i = 0; while (i < H.length - 2 && t > H[i + 1][0]) i++;
  const a = H[i], b = H[i + 1];
  const u = easeInOut(clamp((t - a[0]) / (b[0] - a[0]), 0, 1));
  const p = new THREE.Vector3().fromArray(a[1]).lerp(new THREE.Vector3().fromArray(b[1]), u);
  const roll = lerp(a[2], b[2], u);
  const m = new THREE.Vector3().fromArray(a[3]).lerp(new THREE.Vector3().fromArray(b[3]), u);
  // the charging handle is pulled back during the slap window
  let chOff = 0;
  if (empty && t > 1.84 && t < 2.0) chOff = Math.sin((t - 1.84) / 0.16 * Math.PI) * 0.02;
  const hide = t > 0.88 && t < 1.0 ? true : false;
  _e.set(0, 0, roll * DEG); _q.setFromEuler(_e);
  return { gp, gr, hand: { p, q: _q.clone() }, mag: m, ch: chOff, hide };
}
