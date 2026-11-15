import * as THREE from 'three';

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isNative = !!window.Capacitor?.isNativePlatform?.();

// Quality presets. "high" targets A15+ iPhones / Apple-silicon Macs, "medium" older phones.
// renderScale multiplies devicePixelRatio (capped); the post chain upscales with a sharpening composite.
const PRESETS = {
  low:    { name: 'low',    dpr: 1.0,  msaa: 0, shadow: 1024, shadowDist: 40, vmShadow: 512,  anisotropy: 2, grass: 26000, grassRadius: 26, trees: 0.6, bloomLevels: 4, grain: 0 },
  medium: { name: 'medium', dpr: 1.5,  msaa: 2, shadow: 2048, shadowDist: 55, vmShadow: 1024, anisotropy: 4, grass: 56000, grassRadius: 34, trees: 0.85, bloomLevels: 5, grain: 1 },
  high:   { name: 'high',   dpr: 2.0,  msaa: 4, shadow: 2048, shadowDist: 70, vmShadow: 2048, anisotropy: 8, grass: 90000, grassRadius: 42, trees: 1.0, bloomLevels: 6, grain: 1 },
};

export function qualityPreset(saved) {
  const q = new URLSearchParams(location.search).get('q') || saved || (isTouch ? 'medium' : 'high');
  const p = { ...(PRESETS[q] || PRESETS.medium) };
  p.pixelRatio = Math.min(devicePixelRatio || 1, p.dpr);
  return p;
}

export function createRenderer(canvas, quality) {
  // AA is done by the MSAA scene target in PostFX; the default framebuffer only receives the composite.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false, alpha: false, preserveDrawingBuffer: /[?&]manual/.test(location.search) });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping + grading happen in the composite pass
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  return renderer;
}
