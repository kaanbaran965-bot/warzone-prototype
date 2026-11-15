import * as THREE from 'three';
import { clamp, damp, lerp, DEG } from '../core/MathUtil.js';

// Movement tuning (metres, seconds). Values approximate a Warzone-style feel and were tuned by eye.
export const MOVE = {
  walkSpeed: 2.6,        // light stick deflection
  runSpeed: 4.6,         // medium/strong deflection, or W on the keyboard
  sprintSpeed: 6.4,      // stick pushed fully forward (auto sprint), Shift, or sprint button
  tacSprintSpeed: 8.0,   // tactical sprint: push past the stick ring / double-tap while sprinting
  crouchSpeed: 2.2,
  adsMul: 0.55,          // speed multiplier while aiming down sights
  backwardMul: 0.78,
  strafeMul: 0.9,
  walkZone: 0.55,        // stick deflection below this walks, above runs
  sprintZone: 0.92,      // full deflection (forward) => auto sprint
  groundAccel: 9.0,      // 1/s response when speeding up (inertia)
  groundDecel: 10.5,     // ... when slowing down / stopping
  airAccel: 1.6,
  gravity: 19.0,
  jumpVelocity: 5.6,     // ~0.82 m jump height
  tacSprintDuration: 4.0,
  tacSprintCooldown: 3.0,
  slideMinSpeed: 5.2,    // only from a sprint
  slideBoost: 1.6,       // m/s added on slide start
  slideMaxSpeed: 9.8,
  slideFriction: 5.4,    // m/s^2 deceleration while sliding (speed decays)
  slideMinTime: 0.4,
  slideMaxTime: 1.1,
  slideCooldown: 0.8,
  eyeStand: 1.66,
  eyeCrouch: 1.08,
  eyeSlide: 0.82,
  pitchLimit: 88 * DEG,
};

export const State = {
  IDLE: 'idle', WALK: 'walk', RUN: 'run', SPRINT: 'sprint', TAC: 'tacsprint',
  JUMP: 'jump', CROUCH: 'crouch', SLIDE: 'slide', ADS: 'ads',
};
State.AIR = State.JUMP; // legacy alias

// Player locomotion state machine. Inputs are flags/intents; state is derived once per frame with explicit
// transition rules, and every transition is emitted as an event so camera, weapon and audio can react.
export class PlayerController {
  constructor(camera, world = null) {
    this.camera = camera;
    this.world = world; // { height(x,z), colliders: [[x,z,r]], radius }
    this.pos = new THREE.Vector3(0, 0, 0); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.grounded = true;
    this.crouched = false;
    this.sprinting = false;
    this.tactical = false;
    this.tacTime = MOVE.tacSprintDuration; this.tacCooldown = 0;
    this.sliding = false; this.slideTime = 0; this.slideCooldown = 0;
    this.slideDir = new THREE.Vector3();
    this.eyeHeight = MOVE.eyeStand;
    this.stepPhase = 0; this.lastStepIndex = 0;
    this.airTime = 0;
    this.events = [];
    this.state = State.IDLE; this.prevState = State.IDLE; this.stateTime = 0;
    this.blockSprint = false;   // firing
    this.adsActive = false;     // set by the weapon (ADS > 50 %)
    this.adsWanted = false;     // ADS requested (blocks auto sprint)
    this.speedMul = 1;
    this.autoSprint = true;
    this.cancelAds = false;     // set when an explicit sprint starts; the weapon drops ADS
    this.moveMag = 0; this.sprintQueue = 0;
    this.enabled = true;
    this._fwd = new THREE.Vector3(); this._right = new THREE.Vector3(); this._dir = new THREE.Vector3();
  }

  emit(type, data = 0) { this.events.push({ type, data }); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  get horizSpeed() { return Math.hypot(this.vel.x, this.vel.z); }
  get airborne() { return !this.grounded; }

  startSprint(explicit) {
    if (this.sprinting) return;
    this.sprinting = true; this.emit('sprintStart');
    if (explicit) this.cancelAds = true;
    if (this.crouched && !this.sliding) this.tryStand();
  }
  stopSprint() { if (this.sprinting) { this.sprinting = false; this.tactical = false; this.emit('sprintEnd'); } }
  startTac() {
    if (this.tactical || this.tacTime < 0.3 || this.tacCooldown > 0) return;
    this.tactical = true; this.cancelAds = true; this.emit('tacStart');
  }

  update(dt, input, move) {
    // ----- look -----
    const look = input.takeLook();
    this.yaw -= look.x;
    this.pitch = clamp(this.pitch - look.y, -MOVE.pitchLimit, MOVE.pitchLimit);
    if (!this.enabled) { move = { x: 0, y: 0 }; input.pressed.clear(); }

    // ----- intents -----
    const mx = move.x || 0, my = move.y || 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    this.moveMag = mag;
    const forwardish = my > 0.45 && Math.abs(mx) < my * 1.2 + 0.2;
    const analog = !!move.analog;

    // sprint entry: explicit (Shift / tap) or auto sprint at full forward stick deflection
    if (input.consume('sprintTap')) {
      if (this.sprinting) this.startTac();
      else this.sprintQueue = 0.45; // starts as soon as the stick points forward
    }
    if (this.sprintQueue > 0) {
      this.sprintQueue -= dt;
      if (forwardish && !this.sliding) { this.startSprint(true); this.sprintQueue = 0; }
    }
    if (move.sprintHeld && forwardish && !this.blockSprint && !this.sliding) this.startSprint(true);
    if (analog && this.autoSprint && mag >= MOVE.sprintZone && forwardish && !this.adsWanted && !this.blockSprint && !this.sliding && this.grounded) this.startSprint(false);
    // push past the stick ring while sprinting => tactical sprint
    if (move.pastRing && this.sprinting) this.startTac();

    const jump = input.consume('jump');
    const crouchToggle = input.consume('crouchToggle');
    const crouchPress = input.consume('crouchPress');
    const slideReq = input.consume('slide');

    const speed = this.horizSpeed;
    // crouch while sprinting => slide; otherwise toggles crouch
    if ((crouchToggle || crouchPress || slideReq) && this.grounded && !this.sliding) {
      if ((this.sprinting || slideReq) && speed >= MOVE.slideMinSpeed && this.slideCooldown <= 0) this.startSlide();
      else if (!slideReq) {
        if (this.crouched) this.tryStand(); else { this.crouched = true; this.stopSprint(); this.emit('crouch'); }
      }
    } else if ((crouchToggle || crouchPress) && this.sliding) {
      this.endSlide(true);
    }

    // ----- sprint upkeep (hysteresis so a wobbling thumb does not drop it) -----
    const keepZone = analog ? 0.6 : 0.3;
    if (this.sprinting && (!forwardish || mag < keepZone || this.crouched || this.blockSprint || (this.adsWanted && !move.sprintHeld && !this.tactical && analog))) this.stopSprint();
    if (this.tactical) {
      this.tacTime -= dt;
      if (this.tacTime <= 0) { this.tactical = false; this.tacCooldown = MOVE.tacSprintCooldown; this.emit('tacEnd'); }
    } else if (this.tacCooldown > 0) this.tacCooldown -= dt;
    else this.tacTime = Math.min(MOVE.tacSprintDuration, this.tacTime + dt * 1.5);
    if (this.slideCooldown > 0) this.slideCooldown -= dt;

    // ----- jump -----
    if (jump && this.grounded) {
      if (this.sliding) this.endSlide(false); // slide cancel by jumping
      if (this.crouched) this.tryStand();
      else { this.vel.y = MOVE.jumpVelocity; this.grounded = false; this.airTime = 0; this.emit('jump', speed); }
    }

    // ----- horizontal movement -----
    const fwd = this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = this._right.set(-fwd.z, 0, fwd.x);

    if (this.sliding) {
      this.slideTime += dt;
      let s = Math.max(0, Math.hypot(this.vel.x, this.vel.z) - MOVE.slideFriction * dt * (0.6 + this.slideTime));
      this.slideDir.addScaledVector(right, mx * 1.1 * dt).normalize(); // slight steering
      this.vel.x = this.slideDir.x * s; this.vel.z = this.slideDir.z * s;
      if ((this.slideTime > MOVE.slideMinTime && s < MOVE.crouchSpeed + 0.6) || this.slideTime > MOVE.slideMaxTime) {
        // keep pushing the stick fully forward => pop up and keep running; otherwise end in a crouch
        const standUp = forwardish && mag > 0.85;
        this.endSlide(!standUp);
      }
    } else {
      // target speed: crouch / tactical / sprint, else by stick deflection (walk -> run)
      let target;
      if (this.crouched) target = MOVE.crouchSpeed;
      else if (this.tactical) target = MOVE.tacSprintSpeed;
      else if (this.sprinting) target = MOVE.sprintSpeed;
      else if (analog) target = mag < MOVE.walkZone ? lerp(0.9, MOVE.walkSpeed, clamp(mag / MOVE.walkZone, 0, 1))
        : lerp(MOVE.walkSpeed, MOVE.runSpeed, clamp((mag - MOVE.walkZone) / (MOVE.sprintZone - MOVE.walkZone), 0, 1));
      else target = move.walkHeld ? MOVE.walkSpeed : MOVE.runSpeed;
      const dir = this._dir.set(0, 0, 0)
        .addScaledVector(fwd, my * (my < 0 ? MOVE.backwardMul : 1))
        .addScaledVector(right, mx * MOVE.strafeMul);
      const dl = dir.length();
      if (dl > 1e-3) dir.divideScalar(dl);
      const amt = mag > 1e-3 ? 1 : 0;
      const wish = dir.multiplyScalar(target * amt * (this.speedMul ?? 1));
      const k = this.grounded
        ? (wish.lengthSq() > this.vel.x * this.vel.x + this.vel.z * this.vel.z ? MOVE.groundAccel : MOVE.groundDecel)
        : MOVE.airAccel; // limited air control keeps momentum
      this.vel.x = damp(this.vel.x, wish.x, k, dt);
      this.vel.z = damp(this.vel.z, wish.z, k, dt);
    }

    // ----- vertical -----
    if (!this.grounded) { this.vel.y -= MOVE.gravity * dt; this.airTime += dt; }
    this.pos.addScaledVector(this.vel, dt);
    this.collide();
    const gy = this.world ? this.world.height(this.pos.x, this.pos.z) : 0;
    if (this.grounded && this.vel.y <= 0) {
      if (this.pos.y - gy < 0.45) { this.pos.y = gy; this.vel.y = 0; } // stick to slopes
      else { this.grounded = false; this.airTime = 0; }
    }
    if (this.pos.y <= gy) {
      if (!this.grounded) { const impact = -this.vel.y; this.grounded = true; this.emit('land', impact); }
      this.pos.y = gy; this.vel.y = 0;
    }

    // ----- footsteps (distance based, stride by state) -----
    const hs = this.horizSpeed;
    if (this.grounded && !this.sliding && hs > 0.6) {
      const strideLen = this.crouched ? 0.72 : this.tactical ? 1.5 : this.sprinting ? 1.32 : hs > 3.4 ? 1.08 : 0.85;
      this.stepPhase += (hs * dt) / strideLen;
      const idx = Math.floor(this.stepPhase);
      if (idx !== this.lastStepIndex) { this.lastStepIndex = idx; this.emit('step', hs); }
    } else if (hs < 0.3) {
      this.stepPhase = damp(this.stepPhase, Math.round(this.stepPhase), 6, dt);
      this.lastStepIndex = Math.floor(this.stepPhase);
    }

    // ----- eye height -----
    const eyeT = this.sliding ? MOVE.eyeSlide : this.crouched ? MOVE.eyeCrouch : MOVE.eyeStand;
    this.eyeHeight = damp(this.eyeHeight, eyeT, this.sliding ? 13 : 9, dt);

    // ----- state machine (priority order) -----
    const next = !this.grounded ? State.JUMP
      : this.sliding ? State.SLIDE
      : this.tactical ? State.TAC
      : this.sprinting && hs > 1 ? State.SPRINT
      : this.adsActive ? State.ADS
      : this.crouched ? State.CROUCH
      : hs > 3.4 ? State.RUN
      : hs > 0.4 ? State.WALK : State.IDLE;
    this.stateTime += dt;
    if (next !== this.state) { this.prevState = this.state; this.state = next; this.stateTime = 0; this.emit('state', next); }
  }

  // circle colliders (tree trunks, boulders, logs as chains of circles) + play-area boundary
  collide() {
    const w = this.world; if (!w) return;
    const R = 0.35, p = this.pos;
    const lists = w.dynamicColliders ? [w.colliders, w.dynamicColliders] : [w.colliders];
    for (const list of lists) for (const c of list) {
      if (c[3] !== undefined && p.y > c[3]) continue; // low cover: can be jumped over
      const dx = p.x - c[0], dz = p.z - c[1], rr = c[2] + R;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = rr - d;
        p.x += nx * push; p.z += nz * push;
        const vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
      }
    }
    const r = Math.hypot(p.x, p.z);
    if (r > w.radius) { p.x *= w.radius / r; p.z *= w.radius / r; }
  }

  startSlide() {
    const s = Math.min(MOVE.slideMaxSpeed, this.horizSpeed + MOVE.slideBoost);
    this.slideDir.set(this.vel.x, 0, this.vel.z).normalize();
    this.vel.x = this.slideDir.x * s; this.vel.z = this.slideDir.z * s;
    this.sliding = true; this.slideTime = 0; this.crouched = true;
    this.sprinting = false; this.tactical = false;
    this.emit('slideStart', s);
  }
  endSlide(stayCrouched) {
    this.sliding = false; this.slideCooldown = MOVE.slideCooldown;
    this.crouched = stayCrouched;
    this.emit('slideEnd', stayCrouched ? 1 : 0);
  }
  tryStand() { this.crouched = false; this.emit('stand'); }
}
