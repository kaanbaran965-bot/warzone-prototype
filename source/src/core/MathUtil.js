export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential smoothing. k = responsiveness (1/s).
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const DEG = Math.PI / 180;

// Damped spring (semi-implicit Euler, sub-stepped). Used for weapon kick, landing, sway.
export class Spring {
  constructor(stiffness = 120, damping = 14, value = 0) {
    this.k = stiffness; this.c = damping; this.x = value; this.v = 0; this.target = value;
  }
  impulse(v) { this.v += v; }
  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
}
// Vector of springs with the same tuning.
export class Spring3 {
  constructor(k, c) { this.x = new Spring(k, c); this.y = new Spring(k, c); this.z = new Spring(k, c); }
  impulse(x, y, z) { this.x.impulse(x); this.y.impulse(y); this.z.impulse(z); }
  setTarget(x, y, z) { this.x.target = x; this.y.target = y; this.z.target = z; }
  update(dt) { this.x.update(dt); this.y.update(dt); this.z.update(dt); }
}
