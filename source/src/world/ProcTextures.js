import * as THREE from 'three';
import { mulberry32 } from './Noise.js';

// Canvas-painted alpha textures for vegetation (no external assets needed).
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

// Dry grass card: many thin stalks, some with seed heads, dark at the root, pale straw at the tips.
export function grassCardTexture(renderer, variant = 0) {
  const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d');
  const rnd = mulberry32(1234 + variant * 77);
  g.clearRect(0, 0, W, H);
  const stalks = 46;
  for (let s = 0; s < stalks; s++) {
    const x0 = 30 + rnd() * (W - 60);
    const hgt = H * (0.45 + rnd() * 0.53);
    const lean = (rnd() - 0.5) * 120;
    const x1 = x0 + lean, y1 = H - hgt;
    const cx = x0 + lean * 0.25 + (rnd() - 0.5) * 30, cy = H - hgt * 0.55;
    const w0 = 3.2 + rnd() * 3.5;
    const tone = rnd();
    const base = [70 + tone * 30, 55 + tone * 20, 25 + tone * 10];
    const tip = [lerp(205, 245, tone), lerp(160, 205, tone), lerp(85, 130, tone)];
    const steps = 22;
    let px = x0, py = H;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
      const y = (1 - t) * (1 - t) * H + 2 * (1 - t) * t * cy + t * t * y1;
      const col = [lerp(base[0], tip[0], Math.pow(t, 0.7)), lerp(base[1], tip[1], Math.pow(t, 0.7)), lerp(base[2], tip[2], Math.pow(t, 0.7))];
      g.strokeStyle = rgb(col); g.lineWidth = Math.max(1.1, w0 * (1 - t * 0.8)); g.lineCap = 'round';
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      px = x; py = y;
    }
    // seed head (wheat / foxtail like) on ~45% of stalks
    if (rnd() < 0.45) {
      const ang = Math.atan2(y1 - cy, x1 - cx);
      const len = 26 + rnd() * 34;
      g.save(); g.translate(x1, y1); g.rotate(ang + Math.PI / 2);
      for (let k = 0; k < 14; k++) {
        const yy = -k / 14 * len, ww = 4.2 * Math.sin((k + 1) / 15 * Math.PI) + 1.5;
        g.fillStyle = rgb([lerp(215, 248, rnd()), lerp(175, 215, rnd()), lerp(100, 140, rnd())]);
        g.beginPath(); g.ellipse((k % 2 ? 1 : -1) * ww * 0.45, yy, ww * 0.6, 3.6, (k % 2 ? 0.4 : -0.4), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.premultiplyAlpha = false;
  return t;
}

// Pine branch card: a twig spine with dense drooping needle tufts. Alpha in A.
export function pineBranchTexture(renderer) {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d');
  const rnd = mulberry32(99);
  g.clearRect(0, 0, W, H);
  // main spine along x (root at left), secondary twigs
  const spineY = (x) => H * 0.42 + Math.pow(x / W, 1.6) * H * 0.18;
  const twigs = [];
  for (let i = 0; i < 16; i++) {
    const x = 20 + i / 16 * (W - 70);
    const side = i % 2 ? 1 : -1;
    const len = (1 - i / 18) * H * 0.42 + 20;
    twigs.push([x, spineY(x), x + len * 0.65, spineY(x) + side * len * 0.7]);
  }
  const needle = (x, y, ang, len, col) => {
    g.strokeStyle = col; g.lineWidth = 2.1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  };
  const tuftLine = (x0, y0, x1, y1, dens, scale) => {
    const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) * dens);
    const dir = Math.atan2(y1 - y0, x1 - x0);
    for (let k = 0; k < n; k++) {
      const t = k / n, x = lerp(x0, x1, t), y = lerp(y0, y1, t);
      const l = (16 + rnd() * 18) * scale * (1 - t * 0.35);
      const shade = rnd();
      const col = `rgb(${(28 + shade * 38) | 0},${(44 + shade * 50) | 0},${(20 + shade * 24) | 0})`;
      // needles point forward along the twig and droop slightly
      needle(x, y, dir + 0.75 + (rnd() - 0.5) * 0.5 + 0.15, l, col);
      needle(x, y, dir - 0.75 + (rnd() - 0.5) * 0.5 + 0.15, l, col);
      if (rnd() < 0.5) needle(x, y, dir + (rnd() - 0.5) * 0.6 + 0.25, l * 0.8, col);
    }
  };
  g.lineCap = 'round';
  for (const [x0, y0, x1, y1] of twigs) tuftLine(x0, y0, x1, y1, 0.9, 0.8);
  tuftLine(10, spineY(10), W - 20, spineY(W - 20), 0.9, 1.0);
  // twig wood
  g.strokeStyle = 'rgb(58,42,30)'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, spineY(0));
  for (let x = 0; x < W - 40; x += 16) g.lineTo(x, spineY(x)); g.stroke();
  // light tips (new growth) for a bit of colour variation
  for (let k = 0; k < 260; k++) {
    const x = rnd() * W, y = rnd() * H;
    const d = g.getImageData(x | 0, y | 0, 1, 1).data;
    if (d[3] > 200) { g.fillStyle = `rgba(${90 + rnd() * 40},${105 + rnd() * 40},${50 + rnd() * 20},0.55)`; g.fillRect(x, y, 3, 2); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// Soft round sprite (dust / smoke) and star-shaped muzzle flash
export function softSprite(size = 128) {
  const c = canvas(size, size), g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  // break up the disc with noise blobs
  const rnd = mulberry32(5);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`; g.beginPath(); g.arc(rnd() * size, rnd() * size, rnd() * size * 0.18, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function flashTexture(size = 256) {
  const c = canvas(size, size), g = c.getContext('2d'), h = size / 2;
  const rnd = mulberry32(17);
  g.translate(h, h); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + rnd() * 0.3, len = h * (0.55 + rnd() * 0.45), w = h * (0.07 + rnd() * 0.06);
    g.save(); g.rotate(a);
    const grd = g.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, 'rgba(255,240,200,0.95)'); grd.addColorStop(0.5, 'rgba(255,170,60,0.55)'); grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, -w); g.quadraticCurveTo(len * 0.5, -w * 0.6, len, 0); g.quadraticCurveTo(len * 0.5, w * 0.6, 0, w); g.fill(); g.restore();
  }
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.45);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.5, 'rgba(255,200,110,0.6)'); grd.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(0, 0, h * 0.45, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
