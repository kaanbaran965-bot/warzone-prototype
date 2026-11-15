import * as THREE from 'three';
import { softSprite, flashTexture } from '../world/ProcTextures.js';

// Muzzle flash (viewmodel scene, HDR-bright so it blooms), brass, tracers and impact dust (world scene).
export class Effects {
  constructor(scene, vmScene) {
    this.scene = scene; this.vmScene = vmScene;
    const flashTex = flashTexture(), soft = softSprite();
    this.flashMat = new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(6, 4.2, 2.4), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, fog: false });
    this.flash = new THREE.Sprite(this.flashMat); this.flash.visible = false; this.flash.renderOrder = 10;
    // side flash (elongated) for the profile view of the flash cone
    this.flash2 = new THREE.Sprite(this.flashMat.clone()); this.flash2.visible = false; this.flash2.renderOrder = 10;
    vmScene.add(this.flash, this.flash2);
    this.vmLight = new THREE.PointLight(0xffa860, 0, 0.9, 2); vmScene.add(this.vmLight);
    this.worldLight = new THREE.PointLight(0xffa860, 0, 9, 2); scene.add(this.worldLight);
    this.flashT = 0;

    // brass (camera space, in the viewmodel scene)
    const brassGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 0.0095, 10); brassGeo.rotateZ(Math.PI / 2);
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc89a48, metalness: 1, roughness: 0.28 });
    this.brass = [];
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(brassGeo, brassMat); m.visible = false; vmScene.add(m); this.brass.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0 }); }
    this.brassIdx = 0;

    // tracers
    const trGeo = new THREE.PlaneGeometry(1, 1); trGeo.translate(0, 0.5, 0); trGeo.rotateX(-Math.PI / 2);
    this.tracers = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 7, 3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0 });
    }
    this.trIdx = 0;
    this.ownTracer = new THREE.Color(12, 7, 3); this.enemyTracer = new THREE.Color(14, 4.5, 2.2);
    // enemy muzzle flash light (one shared light, moved to the latest shot)
    this.enemyLight = new THREE.PointLight(0xffa050, 0, 7, 2); scene.add(this.enemyLight);

    // impact dust: pooled soft sprites
    this.dust = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0xb59a74, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s); this.dust.push({ s, v: new THREE.Vector3(), t: 0, life: 1, size: 1 });
    }
    this.dustIdx = 0;
    this._v = new THREE.Vector3();
  }

  muzzle(vm, camera) {
    if (!vm.muzzle) return;
    vm.muzzle.getWorldPosition(this._v); // camera space (vm scene root = camera)
    const p = this._v;
    // nudge forward along the view axis so the flash sits in front of the muzzle
    p.z -= 0.012;
    const s = 0.06 + Math.random() * 0.035;
    this.flash.position.copy(p); this.flash.scale.set(s, s, s); this.flashMat.rotation = Math.random() * Math.PI * 2;
    this.flash2.position.copy(p).add(new THREE.Vector3(0, 0, -0.03)); this.flash2.scale.set(s * 0.55, s * 0.55, s);
    this.flash2.material.rotation = Math.random() * Math.PI;
    this.flash.visible = this.flash2.visible = true;
    this.flashT = 0.045;
    this.vmLight.position.copy(p); this.vmLight.intensity = 1.6;
    // world light ~1 m in front of the camera
    this.worldLight.position.set(0.15, -0.1, -1.0).applyMatrix4(camera.matrixWorld); this.worldLight.intensity = 40;
    // brass out of the ejection port to the right/up
    const b = this.brass[this.brassIdx++ % this.brass.length];
    vm.ejectPort.getWorldPosition(b.m.position);
    b.v.set(0.55 + Math.random() * 0.25, 0.45 + Math.random() * 0.25, 0.1 + Math.random() * 0.1);
    b.w.set(Math.random() * 20, Math.random() * 30, Math.random() * 20); b.t = 0.7; b.m.visible = true;
  }

  tracer(from, dir, dist, enemy = false) {
    const tr = this.tracers[this.trIdx++ % this.tracers.length];
    tr.m.material.color.copy(enemy ? this.enemyTracer : this.ownTracer);
    tr.from.copy(from); tr.dir.copy(dir); tr.dist = dist; tr.t = 0; tr.m.visible = true;
  }

  worldFlash(p) { this.enemyLight.position.copy(p); this.enemyLight.intensity = 25; }
  // hit on a soldier: small dark puff + fabric fibres (kept subtle)
  bloodPuff(p, d) {
    for (let i = 0; i < 4; i++) {
      const s = this.dust[this.dustIdx++ % this.dust.length];
      s.s.position.copy(p);
      s.v.copy(d).multiplyScalar(0.6 + Math.random() * 1.4).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.6, (Math.random() - 0.5) * 0.8));
      s.t = 0; s.life = 0.35 + Math.random() * 0.35; s.size = 0.1 + Math.random() * 0.12;
      s.s.material.color.set(i < 2 ? 0x5a1a12 : 0x6b6450); s.s.material.rotation = Math.random() * 6.28; s.s.visible = true;
    }
  }
  impact(p, n, kind = 'dirt') {
    const count = kind === 'wood' ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const d = this.dust[this.dustIdx++ % this.dust.length];
      d.s.position.copy(p).addScaledVector(n, 0.05);
      d.v.copy(n).multiplyScalar(0.8 + Math.random() * 1.8).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 1.2, (Math.random() - 0.5) * 1.2));
      d.t = 0; d.life = 0.9 + Math.random() * 0.9; d.size = 0.25 + Math.random() * 0.35;
      d.s.material.color.set(kind === 'wood' ? 0x8a6a48 : kind === 'rock' ? 0xa09a90 : 0xb39872);
      d.s.material.rotation = Math.random() * 6.28;
      d.s.visible = true;
    }
  }

  update(dt) {
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.visible = this.flash2.visible = false; } }
    this.vmLight.intensity *= Math.exp(-dt * 45); this.worldLight.intensity *= Math.exp(-dt * 45); this.enemyLight.intensity *= Math.exp(-dt * 40);
    for (const b of this.brass) {
      if (!b.m.visible) continue;
      b.t -= dt; b.v.y -= 3.2 * dt;
      b.m.position.addScaledVector(b.v, dt * 0.5);
      b.m.rotation.x += b.w.x * dt; b.m.rotation.y += b.w.y * dt; b.m.rotation.z += b.w.z * dt;
      if (b.t <= 0) b.m.visible = false;
    }
    for (const tr of this.tracers) {
      if (!tr.m.visible) continue;
      tr.t += dt;
      const speed = 420, len = 9;
      const head = Math.min(tr.dist, tr.t * speed + 2), tail = Math.max(0, head - len);
      if (tail >= tr.dist - 0.1) { tr.m.visible = false; continue; }
      tr.m.position.copy(tr.from).addScaledVector(tr.dir, tail);
      tr.m.lookAt(this._v.copy(tr.from).addScaledVector(tr.dir, head));
      tr.m.scale.set(1, 1, Math.max(0.01, head - tail));
    }
    for (const d of this.dust) {
      if (!d.s.visible) continue;
      d.t += dt; const u = d.t / d.life;
      if (u >= 1) { d.s.visible = false; continue; }
      d.v.multiplyScalar(Math.exp(-dt * 2.5)); d.v.y -= dt * 0.4;
      d.s.position.addScaledVector(d.v, dt);
      const sz = d.size * (1 + u * 2.6); d.s.scale.set(sz, sz, sz);
      d.s.material.opacity = (1 - u) * (1 - u) * 0.75;
    }
  }
}
