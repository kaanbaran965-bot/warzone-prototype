import * as THREE from 'three';

// Hand-rolled post chain tuned for phones (few full-res passes):
//   scene (HalfFloat, MSAA) -> bloom: prefilter + dual-filter down/up chain at 1/2..1/64 res
//   -> composite: CAS-style sharpen, bloom, exposure, filmic tone curve, colour grade (split tone,
//      white balance, saturation, contrast), lens dirt-free glow, chromatic fringe, vignette, grain, sRGB.
const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee;
vec3 tap(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main(){
  // 13-tap downsample (CoD AW "next generation post processing") with Karis average against fireflies
  vec3 a = tap(vec2(-2.,-2.)), b = tap(vec2(0.,-2.)), c = tap(vec2(2.,-2.));
  vec3 d = tap(vec2(-1.,-1.)), e = tap(vec2(1.,-1.));
  vec3 f = tap(vec2(-2.,0.)), g = tap(vec2(0.,0.)), h = tap(vec2(2.,0.));
  vec3 i = tap(vec2(-1.,1.)), j = tap(vec2(1.,1.));
  vec3 k = tap(vec2(-2.,2.)), l = tap(vec2(0.,2.)), m = tap(vec2(2.,2.));
  vec3 col = (d+e+i+j)*0.125 + (a+b+f+g)*0.03125 + (b+c+g+h)*0.03125 + (f+g+k+l)*0.03125 + (g+h+l+m)*0.03125;
  col = min(col, vec3(64.0));
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee); soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(col * w, 1.0);
}`;

const DOWN = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-1.,-1.)*uTexel).rgb; s += texture2D(tSrc, vUv + vec2(1.,-1.)*uTexel).rgb;
  s += texture2D(tSrc, vUv + vec2(-1.,1.)*uTexel).rgb;  s += texture2D(tSrc, vUv + vec2(1.,1.)*uTexel).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D tSrc, tBase; uniform vec2 uTexel; uniform float uRadius;
void main(){
  vec2 o = uTexel * uRadius;
  vec3 s = texture2D(tSrc, vUv + vec2(-o.x, 0.)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(o.x, 0.)).rgb * 2.0
         + texture2D(tSrc, vUv + vec2(0., -o.y)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(0., o.y)).rgb * 2.0
         + texture2D(tSrc, vUv + vec2(-o.x,-o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x,-o.y)).rgb
         + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb
         + texture2D(tSrc, vUv).rgb * 4.0;
  gl_FragColor = vec4(s / 16.0 + texture2D(tBase, vUv).rgb, 1.0);
}`;

const COMPOSITE = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D tScene, tBloom; uniform vec2 uTexel;
uniform float uExposure, uBloom, uTime, uGrain, uVignette, uCA, uSharpen, uSat, uContrast;
uniform vec3 uLift, uGain, uWB;
uniform vec2 uSunUv; uniform float uSunVis; uniform vec3 uSunTint;

vec3 sceneC(vec2 uv){ return texture2D(tScene, uv).rgb; }
// ACES fitted (Stephen Hill), slightly softer toe than Narkowicz
vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
vec3 aces(vec3 c){
  const mat3 IN = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
  const mat3 OUT = mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
  return clamp(OUT * RRTAndODTFit(IN * c), 0.0, 1.0);
}
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 uv = vUv; vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  // chromatic fringe grows towards the edges only
  vec2 caOff = cc * r2 * uCA;
  vec3 col = vec3(texture2D(tScene, uv - caOff).r, texture2D(tScene, uv).g, texture2D(tScene, uv + caOff).b);
  // contrast-adaptive sharpening (cheap 4-tap)
  vec3 n = sceneC(uv + vec2(0., uTexel.y)), s = sceneC(uv - vec2(0., uTexel.y)), e = sceneC(uv + vec2(uTexel.x, 0.)), w = sceneC(uv - vec2(uTexel.x, 0.));
  vec3 mn = min(col, min(min(n, s), min(e, w))), mx = max(col, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 wgt = -amp * uSharpen;
  col = max(vec3(0.0), (col + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt));

  vec3 bloom = texture2D(tBloom, uv).rgb;
  col += bloom * uBloom;
  // soft sun glow / veiling glare around the sun when it is on screen
  if (uSunVis > 0.0) {
    vec2 d = (uv - uSunUv) * vec2(uTexel.y / uTexel.x, 1.0);
    float g = exp(-length(d) * 5.5) * 0.55 + exp(-length(d) * 22.0) * 0.6;
    col += uSunTint * g * uSunVis;
  }
  col *= uExposure * uWB;
  // grade in pre-tonemap linear space: lift shadows towards cool, gain highlights towards warm
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSat);
  vec3 tm = aces(col);
  // contrast S-curve around mid grey (in display-ish space)
  tm = clamp((tm - 0.5) * uContrast + 0.5, 0.0, 1.0);
  tm = mix(tm, tm * tm * (3.0 - 2.0 * tm), 0.18);
  float l2 = dot(tm, vec3(0.2126, 0.7152, 0.0722));
  tm += uLift * (1.0 - l2) * (1.0 - l2) * 0.5;
  tm *= mix(vec3(1.0), uGain, smoothstep(0.35, 1.0, l2));
  // vignette
  float v = 1.0 - smoothstep(0.18, 0.95, r2 * 2.2) * uVignette;
  tm *= v;
  vec3 outc = toSRGB(clamp(tm, 0.0, 1.0));
  // film grain (luma-weighted, animated) + 1/255 dither against banding in the sky
  float gr = hash(uv * 1000.0 + fract(uTime * 7.3) * 91.0) - 0.5;
  outc += gr * uGrain * (0.6 + 0.4 * (1.0 - l2)) * 0.06 + (hash(uv * 733.0 + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
}`;

export class PostFX {
  constructor(renderer, quality) {
    this.renderer = renderer; this.q = quality;
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, samples: quality.msaa };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.sceneRT.texture.minFilter = THREE.LinearFilter; this.sceneRT.texture.generateMipmaps = false;
    this.levels = quality.bloomLevels;
    const mk = () => { const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }); t.texture.minFilter = THREE.LinearFilter; return t; };
    this.down = []; this.up = [];
    for (let i = 0; i < this.levels; i++) { this.down.push(mk()); this.up.push(mk()); }
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    const M = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    this.mPre = M(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.15 }, uKnee: { value: 0.6 } });
    this.mDown = M(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = M(UP, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } });
    this.mComp = M(COMPOSITE, {
      tScene: { value: this.sceneRT.texture }, tBloom: { value: null }, uTexel: { value: new THREE.Vector2() },
      uExposure: { value: 0.86 }, uBloom: { value: 0.085 }, uTime: { value: 0 }, uGrain: { value: quality.grain ? 0.35 : 0 },
      uVignette: { value: 0.42 }, uCA: { value: 0.0022 }, uSharpen: { value: 0.22 }, uSat: { value: 1.06 }, uContrast: { value: 1.06 },
      uLift: { value: new THREE.Vector3(-0.004, 0.006, 0.02) }, uGain: { value: new THREE.Vector3(1.035, 1.0, 0.95) },
      uWB: { value: new THREE.Vector3(1.03, 1.0, 0.955) },
      uSunUv: { value: new THREE.Vector2() }, uSunVis: { value: 0 }, uSunTint: { value: new THREE.Vector3(1.0, 0.82, 0.55) },
    });
    this.size = new THREE.Vector2();
  }
  get uniforms() { return this.mComp.uniforms; }

  setSize(w, h, pr) {
    const W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
    this.sceneRT.setSize(W, H);
    let bw = W >> 1, bh = H >> 1;
    for (let i = 0; i < this.levels; i++) {
      this.down[i].setSize(Math.max(1, bw), Math.max(1, bh)); this.up[i].setSize(Math.max(1, bw), Math.max(1, bh));
      bw >>= 1; bh >>= 1;
    }
    this.size.set(W, H);
    this.mComp.uniforms.uTexel.value.set(1 / W, 1 / H);
  }

  pass(mat, target) { this.quad.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(this.scene, this.cam); }

  render(time) {
    const r = this.renderer;
    // bloom chain
    this.mPre.uniforms.tSrc.value = this.sceneRT.texture;
    this.mPre.uniforms.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    this.pass(this.mPre, this.down[0]);
    for (let i = 1; i < this.levels; i++) {
      const src = this.down[i - 1];
      this.mDown.uniforms.tSrc.value = src.texture;
      this.mDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.mDown, this.down[i]);
    }
    let prev = this.down[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      this.mUp.uniforms.tSrc.value = prev.texture; this.mUp.uniforms.tBase.value = this.down[i].texture;
      this.mUp.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
      this.pass(this.mUp, this.up[i]);
      prev = this.up[i];
    }
    this.mComp.uniforms.tBloom.value = prev.texture;
    this.mComp.uniforms.uTime.value = time;
    this.pass(this.mComp, null);
    r.setRenderTarget(null);
  }
}
