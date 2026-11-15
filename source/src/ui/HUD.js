import { State } from '../game/PlayerController.js';
const LABEL = { idle: 'STEHEN', walk: 'GEHEN', run: 'LAUFEN', sprint: 'SPRINT', tacsprint: 'TAKT. SPRINT', crouch: 'DUCKEN', slide: 'SLIDE', jump: 'SPRUNG', ads: 'ZIELEN' };
const $ = (id) => document.getElementById(id);

// Minimal HUD: thin compass, plates/health, ammo, crosshair that opens with spread; optional debug text.
export class HUD {
  constructor() {
    this.cross = $('crosshair'); this.dbg = $('debug'); this.mag = $('ammo-mag'); this.res = $('ammo-res');
    this.strip = $('compass-strip'); this.compass = $('compass'); this.reloadHint = $('reload-hint');
    this.btnAds = $('btn-ads'); this.btnCrouch = $('btn-crouch');
    this.acc = 0; this.frames = 0; this.fps = 0; this.gap = 9; this.debug = false;
    // compass strip: one tick every 15 deg, three turns so we can wrap
    const PX = 2.2; this.pxPerDeg = PX;
    const names = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360, x = (d + 360) * PX;
      if (names[n] !== undefined) html += `<span class="card" style="left:${x}px">${names[n]}</span>`;
      else html += `<span style="left:${x}px">${n}</span>`;
      html += `<b style="left:${x}px"></b>`;
    }
    this.strip.innerHTML = html;
  }
  // ---------- combat feedback ----------
  initCombat() {
    this.hm = $('hitmarker'); this.hmT = 0; this.vig = $('dmg-vignette'); this.vigHit = 0; this.lowHp = 0;
    this.dirs = $('dmg-dirs'); this.dirEls = [];
    this.kf = $('killfeed'); this.pop = $('score-pop'); this.popT = 0; this.toastEl = $('toast'); this.toastT = 0;
    this.plateEls = [...document.querySelectorAll('#plates u')]; this.hpFill = $('health-fill');
  }
  hitMarker(head, kill) {
    this.hm.className = kill ? 'kill' : head ? 'head' : ''; this.hmT = kill ? 0.45 : 0.18;
    this.hm.style.opacity = '1'; this.hm.style.transform = `scale(${kill ? 1.25 : 1})`;
  }
  killFeed(a, b, head) {
    const d = document.createElement('div');
    const icon = head ? '<svg viewBox="0 0 18 9"><circle cx="9" cy="4.5" r="3.4"/><path d="M1 4.5h3M14 4.5h3"/></svg>' : '<svg viewBox="0 0 18 9"><path d="M1 6h12l3-3M4 6v2"/></svg>';
    d.innerHTML = `<span class="${a === 'DU' ? 'me' : 'foe'}">${a}</span>${icon}<span class="${b === 'DU' ? 'me' : 'foe'}">${b}</span>`;
    this.kf.prepend(d);
    while (this.kf.children.length > 4) this.kf.lastChild.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 4500);
  }
  score(kills, score, add, label) {
    $('score-k').textContent = kills; $('score-p').textContent = score;
    if (label || add >= 15) { this.pop.textContent = `+${add}${label ? '  ' + label : ''}`; this.pop.classList.add('show'); this.popT = 1.4; }
  }
  toast(text) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); this.toastT = 2.2; }
  damage(amount, from, p) {
    this.vigHit = Math.min(1, this.vigHit + 0.35 + amount * 0.03);
    // direction indicator: angle of the attacker relative to where we look
    const ang = Math.atan2(from.x - p.pos.x, from.z - p.pos.z); // world yaw of attacker (0 = +z)
    const rel = -(ang - (p.yaw + Math.PI)); // screen rotation, 0 = straight ahead (up)
    const el = document.createElement('i'); el.style.transform = `rotate(${rel}rad)`; this.dirs.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 600); setTimeout(() => el.remove(), 1200);
  }
  vitals(hp, plates, plateFrac, sinceHit) {
    this.plateEls.forEach((u, i) => { u.style.width = (i < plates - 1 ? 100 : i === plates - 1 ? plateFrac * 100 : 0) + '%'; });
    this.hpFill.style.width = (hp * 100).toFixed(1) + '%'; this.hpFill.classList.toggle('low', hp < 0.4);
    this.lowHp = hp;
  }
  updateCombat(dt) {
    if (this.hmT > 0) { this.hmT -= dt; if (this.hmT <= 0) this.hm.style.opacity = '0'; }
    if (this.popT > 0) { this.popT -= dt; if (this.popT <= 0) this.pop.classList.remove('show'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('show'); }
    this.vigHit = Math.max(0, this.vigHit - dt * 1.1);
    const low = this.lowHp < 0.6 ? (0.6 - this.lowHp) / 0.6 : 0;
    const pulse = low > 0 ? 0.85 + 0.15 * Math.sin(performance.now() / 260) : 1;
    this.vig.style.opacity = Math.min(1, this.vigHit + low * 0.75 * pulse).toFixed(3);
  }
  setDebug(on) { this.debug = on; this.dbg.classList.toggle('hidden', !on); }
  setCompass(on) { this.compass.classList.toggle('hidden', !on); }
  ammo(w) {
    this.mag.textContent = w.mag; this.res.textContent = w.reserve;
    this.mag.classList.toggle('low', w.mag <= 7);
  }
  update(dt, p, vm, weapon, renderer) {
    this.acc += dt; this.frames++;
    if (this.acc >= 0.5) {
      this.fps = Math.round(this.frames / this.acc); this.acc = 0; this.frames = 0;
      if (this.debug) {
        const info = renderer.info.render;
        this.dbg.textContent = `${this.fps} FPS · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris\n${LABEL[p.state] || p.state} · ${p.horizSpeed.toFixed(1)} m/s · TAC ${p.tacCooldown > 0 ? 'cd' : Math.round(p.tacTime / 4 * 100) + '%'}\npos ${p.pos.x.toFixed(0)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(0)}`;
      }
    }
    // heading (yaw 0 = looking -Z = north)
    let hdg = (-p.yaw * 180 / Math.PI) % 360; if (hdg < 0) hdg += 360;
    this.strip.style.transform = `translateX(${130 - (hdg + 360) * this.pxPerDeg}px)`;
    // crosshair gap follows movement / firing, hidden while aiming
    const target = 7 + Math.min(p.horizSpeed, 7) * 1.4 + (weapon?.shotsInString ? 5 : 0) + (p.grounded ? 0 : 8);
    this.gap += (target - this.gap) * Math.min(1, dt * 12);
    this.cross.style.setProperty('--gap', this.gap.toFixed(1));
    this.cross.style.opacity = vm ? String(Math.max(0, 1 - vm.ads * 3) * (p.sprinting ? 0.2 : 1)) : '1';
    this.btnAds?.classList.toggle('on', !!(vm && vm.adsTarget > 0));
    this.btnCrouch?.classList.toggle('on', p.crouched && !p.sliding);
    if (weapon) this.reloadHint.classList.toggle('hidden', !(weapon.mag <= 5 && weapon.reloadTimer < 0 && weapon.reserve > 0));
  }
}
