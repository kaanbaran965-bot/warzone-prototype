import * as THREE from 'three';
import '@fontsource/barlow/300.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-condensed/300.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/500.css';
import './style.css';
import { createRenderer, qualityPreset, isTouch, isIOS, isNative } from './core/Renderer.js';
import { PostFX } from './post/PostFX.js';
import { World } from './world/World.js';
import { PLAY_RADIUS } from './world/Terrain.js';
import { PlayerController, MOVE } from './game/PlayerController.js';
import { CameraRig } from './game/CameraRig.js';
import { ViewModel } from './game/ViewModel.js';
import { Weapon } from './game/Weapon.js';
import { Effects } from './game/Effects.js';
import { InputState } from './input/InputState.js';
import { KeyboardMouse } from './input/KeyboardMouse.js';
import { TouchControls } from './input/TouchControls.js';
import { AudioManager } from './audio/AudioManager.js';
import { HUD } from './ui/HUD.js';
import { Settings } from './ui/Settings.js';
import { DEG } from './core/MathUtil.js';
import { Combat, PLAYER } from './combat/Combat.js';
import { AimAssist } from './combat/AimAssist.js';

// native haptics (Capacitor iOS build only; no-op on the web)
let haptic = () => {};
if (isNative) import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => {
  haptic = (s = 'Light') => Haptics.impact({ style: ImpactStyle[s] }).catch(() => {});
}).catch(() => {});

const $ = (id) => document.getElementById(id);
const settings = new Settings();
const canvas = $('game');
const quality = qualityPreset(settings.v.quality);
const renderer = createRenderer(canvas, quality);
const post = new PostFX(renderer, quality);

// ---- world ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.06, 9000);
scene.add(camera);

// ---- viewmodel: own scene + camera (separate FOV, never clips into the world), lit like the world ----
const VM_FOV = 58;
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(VM_FOV, innerWidth / innerHeight, 0.01, 10);
const vmSun = new THREE.DirectionalLight(0xffe2b8, 3.4);
vmSun.castShadow = true;
vmSun.shadow.mapSize.set(quality.vmShadow, quality.vmShadow);
Object.assign(vmSun.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 0.05, far: 4 });
vmSun.shadow.bias = -0.0004; vmSun.shadow.normalBias = 0.004; vmSun.shadow.radius = 3;
vmScene.add(vmSun, vmSun.target);
vmSun.target.position.set(0.05, -0.08, -0.25);
const vmHemi = new THREE.HemisphereLight(0xa8c0e0, 0x6a5434, 0.45); vmScene.add(vmHemi);
// soft key/fill fixed in camera space so the weapon always reads, even when backlit
const vmFill = new THREE.DirectionalLight(0xdfe8ff, 0.75); vmFill.position.set(-0.6, 0.8, 0.5); vmScene.add(vmFill);

const input = new InputState();
const kbm = new KeyboardMouse(input, canvas);
const touch = new TouchControls(input, $('touch'));
const world = new World(renderer, scene, new THREE.LoadingManager(), quality);
const player = new PlayerController(camera, { height: (x, z) => world.terrain.height(x, z), colliders: [], radius: PLAY_RADIUS });
const rig = new CameraRig(camera);
const hud = new HUD();
let audio = null;
try { audio = new AudioManager(); } catch (e) { console.warn('No WebAudio', e); }

const manager = new THREE.LoadingManager();
const vm = new ViewModel(vmScene, manager, renderer);
const fx = new Effects(scene, vmScene);
let weapon = null, combat = null;
const aim = new AimAssist();
const SPAWN = { x: -30, z: 20, yaw: 0.12 };

// spawn: on the track, looking north-east across the field towards the forest and the range
player.pos.set(-30, 0, 20); player.yaw = 0.12; player.pitch = -0.03;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vmCamera.aspect = w / h; vmCamera.fov = VM_FOV; vmCamera.updateProjectionMatrix();
  const portrait = isTouch && h > w;
  $('rotate').classList.toggle('hidden', !portrait || !started);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));

settings.onChange((v) => {
  kbm.mul = v.sens; touch.mul = v.sens; touch.adsHold = v.adsHold;
  rig.baseHFov = v.fov; hud.setDebug(v.debug); hud.setCompass(v.compass);
  aim.strength = v.aimAssist; aim.enabled = isTouch; player.autoSprint = v.autoSprint;
  combat?.bots.setEnabled(v.bots);
});
settings.bindUI({ currentQuality: quality.name, onOpen: () => { paused = true; input.fireHeld = false; document.exitPointerLock?.(); }, onClose: () => { paused = false; if (!isTouch && started) canvas.requestPointerLock?.(); } });

let started = false, paused = false;
async function boot() {
  $(isTouch ? 'hint-desk' : 'hint-touch').classList.add('hidden');
  resize();
  const setText = (t) => { $('load-text').textContent = t; };
  let steps = 0; const bump = (t) => { steps++; setText(t); $('bar-fill').style.width = Math.min(95, steps * 14) + '%'; };
  try {
    bump('Lade Assets');
    await Promise.all([world.load(bump), vm.load(), audio?.load()]);
  } catch (e) {
    console.error(e); setText('Fehler beim Laden: ' + e.message); return;
  }
  player.world.colliders = world.colliders;
  player.pos.y = world.terrain.height(player.pos.x, player.pos.z);
  vmScene.environment = world.envMap; vmScene.environmentIntensity = scene.environmentIntensity;
  vm.onCue = (id) => (audio?.onWeaponCue(id), audio?.onInspectCue(id));
  weapon = new Weapon({ vm, player, rig, fx, audio, world, camera });
  weapon.onAmmo = () => hud.ammo(weapon); hud.ammo(weapon);
  weapon.onShot = (n) => { if (n % 2 === 1) haptic('Light'); };
  hud.initCombat();
  combat = new Combat({ world, scene, player, audio, fx, ui: hud, rig });
  weapon.combat = combat;
  combat.bots.setEnabled(settings.v.bots);
  combat.onDeath = onDeath; combat.onRespawn = onRespawn;
  hud.vitals(1, PLAYER.plates, 1, 99);
  setText('Shader kompilieren');
  await new Promise((r) => setTimeout(r, 0));
  renderer.compile(scene, camera); renderer.compile(vmScene, vmCamera);
  setText('Bereit'); $('bar-fill').style.width = '100%';
  const btn = $('start'); btn.disabled = false;
  btn.addEventListener('click', start, { once: true });
  window.__game.ready = true;
}

function start() {
  started = true;
  audio?.unlock();
  $('loader').classList.add('hidden');
  $('hud').classList.remove('hidden'); $('btn-menu').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  if (!isTouch) canvas.requestPointerLock?.();
  if (!isIOS && !isNative) document.documentElement.requestFullscreen?.().catch(() => {});
  screen.orientation?.lock?.('landscape').catch(() => {});
  resize();
}

const timer = new THREE.Timer();
const camQInv = new THREE.Quaternion(), sunCam = new THREE.Vector3(), eul = new THREE.Euler(), sunNdc = new THREE.Vector3();
let simT = 0;
const MANUAL = /[?&]manual/.test(location.search);
function frame(ts) {
  if (MANUAL) return;
  timer.update(ts);
  const raw = timer.getDelta();
  const dt = Math.min(raw, 1 / 20);
  tick(dt);
  if (started && !paused) adapt(raw);
  requestAnimationFrame(frame);
}
// dynamic resolution: keep ~60 fps by trading render scale (never above the preset's cap)
let adaptAcc = 0, adaptN = 0, adaptCool = 3;
function adapt(raw) {
  adaptAcc += raw; adaptN++; adaptCool -= raw;
  if (adaptAcc < 1.5) return;
  const avg = adaptAcc / adaptN; adaptAcc = 0; adaptN = 0;
  if (adaptCool > 0) return;
  const pr = renderer.getPixelRatio(), cap = quality.pixelRatio;
  let next = pr;
  if (avg > 1 / 46 && pr > 0.85) next = Math.max(0.85, pr - 0.15);
  else if (avg < 1 / 58 && pr < cap) next = Math.min(cap, pr + 0.1);
  if (next !== pr) { renderer.setPixelRatio(next); resize(); adaptCool = 3; }
}
// test hook: advance the simulation deterministically, render only the last frame
function advance(n = 1, dt = 1 / 30) {
  for (let i = 0; i < n; i++) tick(dt, i === n - 1);
  return renderer.info.render.calls;
}
// test hook: simulate without rendering (swiftshader frames are slow)
function sim(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) tick(dt, false); }
function tick(dt, draw = true) {
  simT += dt;
  if (world.ready && vm.model) {
    if (started && !paused) step(dt); else if (!started) idle(dt);
    if (draw) render();
    if (weapon) { hud.update(dt, player, vm, weapon, renderer); hud.updateCombat(dt); }
  }
}

// ---- death / respawn ----
let respawnTimer = 0;
function onDeath(by) {
  player.enabled = false; weapon.enabled = false; input.fireHeld = false; weapon.adsHeld = false;
  rig.dead = true; haptic('Heavy'); document.body.classList.add('dead');
  $('death-by').textContent = by ? `von ${by}` : '';
  $('death-stats').textContent = `${combat.kills} Eliminierungen · ${combat.score} Punkte · ${combat.deaths} Tode`;
  respawnTimer = PLAYER.respawnTime;
  setTimeout(() => $('death').classList.remove('hidden'), 700);
  document.exitPointerLock?.();
}
function onRespawn() {
  $('death').classList.add('hidden'); document.body.classList.remove('dead');
  player.pos.set(SPAWN.x, world.terrain.height(SPAWN.x, SPAWN.z), SPAWN.z); player.vel.set(0, 0, 0);
  player.yaw = SPAWN.yaw; player.pitch = -0.03; player.crouched = false; player.sliding = false; player.stopSprint();
  player.enabled = true; weapon.enabled = true; weapon.mag = weapon.magSize; weapon.reserve = Math.max(weapon.reserve, 150); weapon.onAmmo();
  rig.dead = false; vm.root.visible = true;
  if (!isTouch && started) canvas.requestPointerLock?.();
}
$('respawn-btn').addEventListener('click', () => { if (respawnTimer <= 0 && combat && !combat.alive) combat.respawn(); });

function idle(dt) {
  // slow cinematic drift behind the title screen
  player.yaw += dt * 0.02;
  rig.update(dt, player); vm.update(dt, player, { x: 0, y: 0 });
  world.update(simT, player.pos); fx.update(dt);
  if (combat) { combat.bots.update(dt, { player, playerEye: camera.position.clone(), playerAlive: false, graceT: 1 }); combat.targets.update(dt); }
}

function step(dt) {
  const st = touch.stick, kb = kbm.kbMove || { x: 0, y: 0 };
  const move = { x: st.x + kb.x, y: st.y + kb.y, sprintHeld: input.sprintHeld, pastRing: st.sprint, analog: !!st.active, walkHeld: input.walkHeld };
  if (input.consume('inspect') && !player.sprinting && !player.sliding && player.grounded && !vm.reloading) vm.startInspect();
  // lower look sensitivity while aiming
  touch.adsScale = 1 - vm.ads * 0.4; kbm.sens = 0.0022 * (1 - vm.ads * 0.4);
  // aim assist (touch): slowdown for this frame's look input + rotational pull / ADS snap
  const lookMag = Math.abs(input.lookDelta.x) + Math.abs(input.lookDelta.y);
  const hasInput = combat.alive && (Math.hypot(move.x, move.y) > 0.1 || lookMag > 1e-4 || input.fireHeld);
  const slow = combat.alive ? aim.update(dt, { player, camera, bots: combat.bots.alive(), adsTarget: vm.adsTarget, ads: vm.ads, hasInput }) : 1;
  if (slow < 1 && touch.stickId !== undefined) { input.lookDelta.x *= slow; input.lookDelta.y *= slow; }
  const look = { ...input.lookDelta };
  weapon.update(dt, input);
  player.update(dt, input, move);
  for (const e of player.takeEvents()) { vm.onPlayerEvent(e, player); rig.onPlayerEvent(e); audio?.onPlayerEvent(e, player); }
  rig.ads = vm.ads;
  rig.update(dt, player);
  vm.update(dt, player, look);
  world.update(simT, player.pos);
  combat.update(dt, { weapon });
  if (!combat.alive) {
    vm.root.visible = combat.deadT < 0.35;
    if (respawnTimer > 0) respawnTimer -= dt;
    $('respawn-count').textContent = respawnTimer > 0 ? Math.ceil(respawnTimer) : '';
    if (combat.deadT > PLAYER.respawnTime + 4) combat.respawn(); // auto respawn
  }
  fx.update(dt);
  input.endFrame();
}

function render() {
  // viewmodel light + reflections follow the world sun in camera space
  camQInv.copy(camera.quaternion).invert();
  sunCam.copy(world.sunDir).applyQuaternion(camQInv);
  vmSun.position.copy(vmSun.target.position).addScaledVector(sunCam, 2);
  eul.setFromQuaternion(camQInv, 'YXZ');
  vmScene.environmentRotation.set(eul.x, eul.y + world.skyYaw, eul.z);
  // sun glare position for the composite
  sunNdc.copy(world.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
  const vis = sunNdc.z < 1 && Math.abs(sunNdc.x) < 1.3 && Math.abs(sunNdc.y) < 1.3 ? 1 - Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y)) / 1.3 : 0;
  post.uniforms.uSunUv.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5); post.uniforms.uSunVis.value = vis * 0.6;
  renderer.info.autoReset = false; renderer.info.reset();
  renderer.setRenderTarget(post.sceneRT);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(vmScene, vmCamera);
  post.render(simT);
}

// Debug/test hooks (used by the automated Playwright tests)
window.__game = { player, vm, vmCamera, scene, vmScene, input, camera, renderer, world, post, MOVE, DEG, settings, ready: false,
  start: () => start(), advance, sim, get started() { return started; }, get weapon() { return weapon; }, quality,
  get combat() { return combat; }, aim, rig, hud, fx, touch, kbm,
  // test helper: emulate the touch stick (x right, y forward, 0..1; pastRing = pushed beyond the ring)
  setStick: (x, y, pastRing = false) => { touch.stick = { x, y, sprint: pastRing, active: x !== 0 || y !== 0 }; },
};

boot();
requestAnimationFrame(frame);
