// Desktop test controls: WASD, mouse look via pointer lock.
export class KeyboardMouse {
  constructor(input, canvas, { sensitivity = 0.0022 } = {}) {
    this.input = input; this.canvas = canvas; this.sens = sensitivity;
    this.keys = new Set();
    this.locked = false;
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    canvas.addEventListener('mousedown', () => { if (!this.locked && this.enabled) canvas.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    canvas.addEventListener('mousedown', (e) => { if (!this.locked) return; if (e.button === 0) input.fireHeld = true; if (e.button === 2) input.adsHeld = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) input.fireHeld = false; if (e.button === 2) input.adsHeld = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { input.fireHeld = false; input.adsHeld = false; } });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      input.lookDelta.x += e.movementX * this.sens * this.mul;
      input.lookDelta.y += e.movementY * this.sens * this.mul;
    });
    this.enabled = true; this.mul = 1;
  }
  onKey(e, down) {
    const k = e.code;
    if (down && this.keys.has(k)) return; // ignore auto-repeat
    if (down) this.keys.add(k); else this.keys.delete(k);
    const i = this.input;
    if (down) {
      if (k === 'Space') i.press('jump');
      if (k === 'ShiftLeft' || k === 'ShiftRight') i.press('sprintTap');
      if (k === 'KeyC' || k === 'ControlLeft') i.press('crouchPress');
      if (k === 'KeyV') i.press('slide');
      if (k === 'KeyI' || k === 'KeyF') i.press('inspect');
      if (k === 'KeyR') i.press('reload');
    }
    i.crouchHeld = this.keys.has('KeyC') || this.keys.has('ControlLeft');
    this.updateMove();
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) e.preventDefault();
  }
  updateMove() {
    const kk = this.keys;
    const x = (kk.has('KeyD') || kk.has('ArrowRight') ? 1 : 0) - (kk.has('KeyA') || kk.has('ArrowLeft') ? 1 : 0);
    const y = (kk.has('KeyW') || kk.has('ArrowUp') ? 1 : 0) - (kk.has('KeyS') || kk.has('ArrowDown') ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    this.kbMove = { x: x / l, y: y / l };
    this.input.sprintHeld = kk.has('ShiftLeft') || kk.has('ShiftRight');
    this.input.walkHeld = kk.has('AltLeft') || kk.has('KeyQ');
  }
}
