// Floating left stick + right-side look area + small translucent action buttons (Pointer Events, multi-touch).
// The fire button keeps tracking the finger after press so you can aim while shooting (like CoD Mobile).
export class TouchControls {
  constructor(input, root, { lookSensitivity = 0.0058 } = {}) {
    this.input = input; this.root = root; this.sens = lookSensitivity; this.mul = 1; this.adsHold = false;
    this.base = root.querySelector('#joy-base'); this.knob = root.querySelector('#joy-knob');
    this.radius = 46;
    this.stickId = null; this.stickOrigin = { x: 0, y: 0 };
    this.lookIds = new Map();
    this.stick = { x: 0, y: 0, sprint: false, active: false };
    this.lastStickUp = -1;
    this.fireIds = new Set(); this.adsIds = new Set();
    const surface = document.getElementById('game');
    surface.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e));
    for (const btn of root.querySelectorAll('.tbtn')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        btn.classList.add('press');
        const a = btn.dataset.action;
        if (a === 'fire') { this.fireIds.add(e.pointerId); input.fireHeld = true; }
        else if (a === 'ads') { if (this.adsHold) { this.adsIds.add(e.pointerId); input.adsHeld = true; } else input.press('adsToggle'); }
        else if (a === 'crouch') input.press('crouchToggle');
        else input.press(a);
        this.navigatorHaptic?.();
        this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY, btn });
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const stop = (e) => e.preventDefault();
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, stop, { passive: false });
    document.addEventListener('touchmove', (e) => { if (!e.target.closest?.('.sheet')) e.preventDefault(); }, { passive: false });
  }
  onDown(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    if (e.clientX < innerWidth * 0.42 && this.stickId === null) {
      this.stickId = e.pointerId; this.stickOrigin = { x: e.clientX, y: e.clientY };
      // double-tap the stick (second touch within 0.3 s) => sprint / tactical sprint
      const now = performance.now() / 1000;
      if (now - this.lastStickUp < 0.3) this.input.press('sprintTap');
      this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
      this.base.classList.add('active'); this.updateStick(e.clientX, e.clientY);
    } else this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  onMove(e) {
    if (e.pointerType === 'mouse') return;
    if (e.pointerId === this.stickId) { e.preventDefault(); this.updateStick(e.clientX, e.clientY); return; }
    const p = this.lookIds.get(e.pointerId);
    if (p) {
      e.preventDefault();
      const k = this.sens * this.mul * (this.adsScale || 1);
      this.input.lookDelta.x += (e.clientX - p.x) * k; this.input.lookDelta.y += (e.clientY - p.y) * k;
      p.x = e.clientX; p.y = e.clientY;
    }
  }
  onUp(e) {
    if (e.pointerId === this.stickId) {
      this.stickId = null; this.stick = { x: 0, y: 0, sprint: false, active: false }; this.lastStickUp = performance.now() / 1000;
      this.knob.style.transform = ''; this.base.classList.remove('active', 'sprint'); this.base.style.left = ''; this.base.style.top = '';
    }
    if (this.fireIds.delete(e.pointerId) && this.fireIds.size === 0) this.input.fireHeld = false;
    if (this.adsIds.delete(e.pointerId) && this.adsIds.size === 0) this.input.adsHeld = false;
    const p = this.lookIds.get(e.pointerId);
    if (p) { p.btn?.classList.remove('press'); this.lookIds.delete(e.pointerId); }
  }
  updateStick(x, y) {
    let dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const sprint = dy < -this.radius * 1.3 && Math.abs(dx) < -dy * 0.7;
    const cl = Math.min(len, this.radius);
    if (len > 0) { dx = dx / len * cl; dy = dy / len * cl; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    let nx = dx / this.radius, ny = -dy / this.radius;
    const m = Math.hypot(nx, ny), dead = 0.12;
    if (m < dead) { nx = 0; ny = 0; } else { const s = (m - dead) / (1 - dead) / m; nx *= s; ny *= s; }
    this.stick = { x: nx, y: ny, sprint, active: true };
    this.base.classList.toggle('sprint', sprint);
  }
}
