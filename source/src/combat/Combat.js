import * as THREE from 'three';
import { BotManager } from './Bots.js';
import { Targets } from './Targets.js';

// Player health/armour, damage + regen, scoring, kill feed, death/respawn, ammo crates.
export const PLAYER = { health: 100, plates: 3, plateHp: 50, regenDelay: 4.0, regenRate: 30, respawnTime: 4.0, graceTime: 3.0 };
export const DMG = { base: 30, head: 2.0, body: 1.0, limb: 0.8, falloffStart: 40, falloffMin: 0.8 };

export class Combat {
  constructor({ world, scene, player, audio, fx, ui, rig }) {
    Object.assign(this, { world, scene, player, audio, fx, ui, rig });
    this.health = PLAYER.health; this.plates = PLAYER.plates; this.plateHp = PLAYER.plateHp;
    this.sinceHit = 99; this.alive = true; this.deadT = 0; this.graceT = PLAYER.graceTime;
    this.kills = 0; this.score = 0; this.deaths = 0; this.headshots = 0;
    this.targets = new Targets(world.terrain); scene.add(this.targets.group);
    this.bots = new BotManager(world, scene, { onBotShot: (...a) => this.onBotShot(...a) });
    this.bots.initialSpawn(player.pos);
    this.onDeath = null; this.onRespawn = null;
    this._eye = new THREE.Vector3();
  }

  // ---- player shooting ----
  // called by the weapon for every shot; returns the effective hit distance (for tracers / impacts)
  resolveShot(o, d, worldHit, maxT) {
    const limit = worldHit ? worldHit.t : maxT;
    const bh = this.bots.raycast(o, d, limit);
    const th = this.targets.raycast(o, d, bh ? bh.t : limit);
    if (th) {
      const p = o.clone().addScaledVector(d, th.t);
      this.targets.hit(th);
      this.audio?.steelDing(th.t);
      this.fx.impact(p, d.clone().negate(), 'rock');
      this.ui.hitMarker(th.part === 'head', false);
      this.addScore(th.part === 'head' ? 15 : 10, null);
      return { t: th.t, consumed: true };
    }
    if (bh) {
      const p = o.clone().addScaledVector(d, bh.t);
      const mult = DMG[bh.part] ?? 1;
      const fall = bh.t > DMG.falloffStart ? Math.max(DMG.falloffMin, 1 - (bh.t - DMG.falloffStart) / 200) : 1;
      const dmg = DMG.base * mult * fall;
      const killed = bh.bot.damage(dmg, bh.part, this.player);
      this.fx.bloodPuff(p, d);
      this.ui.hitMarker(bh.part === 'head', killed);
      this.audio?.hitTick(bh.part === 'head');
      if (killed) {
        this.kills++; if (bh.part === 'head') this.headshots++;
        this.audio?.killConfirm(bh.part === 'head');
        this.addScore(100 + (bh.part === 'head' ? 50 : 0), bh.part === 'head' ? 'KOPFSCHUSS' : 'ELIMINIERT');
        this.ui.killFeed('DU', bh.bot.name, bh.part === 'head');
      }
      return { t: bh.t, consumed: true };
    }
    return null;
  }
  addScore(n, label) { this.score += n; this.ui.score(this.kills, this.score, n, label); }

  // ---- bots shooting at the player ----
  onBotShot(bot, from, dir, len, hit, aim) {
    this.fx.tracer(from, dir, len, true);
    this.fx.worldFlash(from);
    const p = this.player;
    const toBot = new THREE.Vector3().subVectors(from, p.pos); const dist = toBot.length();
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const pan = toBot.clone().normalize().dot(right);
    this.audio?.shotAt(dist, pan);
    if (hit && this.alive) this.damagePlayer(BOT_DAMAGE(), from, bot.name);
    else if (this.alive) {
      // near miss crack
      const eye = this._eye.set(p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
      const w = eye.clone().sub(from); const t = w.dot(dir); const closest = from.clone().addScaledVector(dir, t);
      if (t > 0 && t < len && closest.distanceTo(eye) < 2.5) this.audio?.whiz(pan);
    }
  }

  damagePlayer(amount, fromPos, by) {
    if (!this.alive) return;
    this.sinceHit = 0;
    let rest = amount;
    while (rest > 0 && this.plates > 0) {
      const take = Math.min(rest, this.plateHp); this.plateHp -= take; rest -= take;
      if (this.plateHp <= 0) { this.plates--; this.plateHp = this.plates > 0 ? PLAYER.plateHp : 0; this.audio?.play('metal', { vol: 0.3, rate: 0.7 }); }
    }
    this.health -= rest;
    this.audio?.hurt();
    this.rig?.shake(0.6);
    this.ui.damage(amount, fromPos, this.player);
    if (this.health <= 0) this.die(by);
  }

  die(by) {
    this.health = 0; this.alive = false; this.deadT = 0; this.deaths++;
    this.ui.killFeed(by, 'DU', false);
    this.onDeath?.(by);
  }
  respawn() {
    this.health = PLAYER.health; this.plates = PLAYER.plates; this.plateHp = PLAYER.plateHp;
    this.alive = true; this.sinceHit = 99; this.graceT = PLAYER.graceTime;
    this.onRespawn?.();
  }

  update(dt, ctx) {
    const p = this.player;
    this.sinceHit += dt;
    if (this.graceT > 0) this.graceT -= dt;
    if (this.alive && this.sinceHit > PLAYER.regenDelay && this.health < PLAYER.health) this.health = Math.min(PLAYER.health, this.health + PLAYER.regenRate * dt);
    if (!this.alive) this.deadT += dt;
    // ammo crates: refill reserve + plates when standing next to one
    for (const c of this.world.cover.crates) {
      if (c.cool > 0) { c.cool -= dt; continue; }
      if (!this.alive) continue;
      const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z;
      if (dx * dx + dz * dz < 2.0 * 2.0 && ctx.weapon) {
        const w = ctx.weapon, need = w.maxReserve - w.reserve;
        const plateNeed = PLAYER.plates - this.plates + (this.plateHp < PLAYER.plateHp && this.plates > 0 ? 1 : 0);
        if (need > 0 || plateNeed > 0) {
          w.reserve = w.maxReserve; w.onAmmo?.();
          this.plates = PLAYER.plates; this.plateHp = PLAYER.plateHp;
          c.cool = 12; this.audio?.pickup();
          this.ui.toast(need > 0 ? `MUNITION +${need}` : 'PLATTEN AUFGEFÜLLT');
        }
      }
    }
    const eye = this._eye.set(p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
    this.bots.update(dt, { player: p, playerEye: eye.clone(), playerAlive: this.alive, graceT: this.graceT });
    this.targets.update(dt);
    this.ui.vitals(this.health / PLAYER.health, this.plates, this.plateHp / PLAYER.plateHp, this.sinceHit);
  }
}
const BOT_DAMAGE = () => 5 + Math.floor(Math.random() * 3);
