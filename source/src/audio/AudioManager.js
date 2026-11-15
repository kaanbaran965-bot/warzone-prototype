// Web Audio sound system. Samples are AAC (.m4a) so iOS Safari can decode them.
// iOS needs the AudioContext to be resumed inside a user gesture -> unlock() is called from the start button.
const FILES = {
  step: ['footstep_grass_000', 'footstep_grass_001', 'footstep_grass_002', 'footstep_grass_003', 'footstep_grass_004'],
  stepHard: ['footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002', 'footstep_concrete_003', 'footstep_concrete_004'],
  thud: ['impact_soft_medium_000', 'impact_soft_medium_001', 'impact_soft_medium_002'],
  punch: ['impact_punch_medium_000'],
  metal: ['impact_metal_light_000'],
  click: ['switch'],
  shot: ['shot_1', 'shot_2', 'shot_3'],
  boltBack: ['bolt_back'], boltFwd: ['bolt_fwd'], rack: ['rifle_rack'], magOut: ['rifle_magout'], magIn: ['rifle_magin'], dry: ['rifle_dry'],
};

export class AudioManager {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
    // gentle bus compression keeps peaks controlled on phone speakers
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 3; this.comp.attack.value = 0.003; this.comp.release.value = 0.15;
    this.master.connect(this.comp).connect(this.ctx.destination);
    // open-field slap-back / valley echo for gunshots
    this.echoIn = this.ctx.createGain(); this.echoIn.gain.value = 0.22;
    const d1 = this.ctx.createDelay(1.5); d1.delayTime.value = 0.32;
    const d2 = this.ctx.createDelay(2.5); d2.delayTime.value = 0.83;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.5;
    this.echoIn.connect(lp); lp.connect(d1).connect(this.master); lp.connect(d2).connect(g2).connect(this.master);
    this.buffers = {};
    this.noise = this.makeNoise();
    this.ok = 0; this.failed = 0;
  }
  makeNoise() {
    const len = this.ctx.sampleRate * 1.5, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.86 + w * 0.14; d[i] = (w * 0.35 + last * 1.6); }
    return b;
  }
  async load(onProgress) {
    const jobs = [];
    for (const [key, names] of Object.entries(FILES)) {
      this.buffers[key] = [];
      for (const n of names) jobs.push(fetch(`./assets/audio/${n}.m4a`).then((r) => r.arrayBuffer())
        .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
        .then((buf) => { this.buffers[key].push(buf); this.ok++; onProgress?.(); })
        .catch((e) => { this.failed++; console.warn('audio decode failed', n, e); }));
    }
    await Promise.all(jobs);
  }
  unlock() {
    if (this.ctx.state !== 'running') this.ctx.resume();
    // play a silent buffer: required by older iOS versions to fully unlock output
    const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0);
  }
  play(key, { vol = 1, rate = 1, rateVar = 0.06, delay = 0, pan = 0 } = {}) {
    const list = this.buffers[key]; if (!list || !list.length || this.ctx.state !== 'running') return;
    const buf = list[(Math.random() * list.length) | 0];
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * rateVar);
    const g = this.ctx.createGain(); g.gain.value = vol;
    let node = src.connect(g);
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(this.master);
    src.start(this.ctx.currentTime + delay);
  }
  // Synthesised cloth / gear rustle: band-passed noise with a soft envelope (no tonal beeps).
  cloth({ vol = 0.25, dur = 0.22, freq = 1800, q = 0.9, delay = 0 } = {}) {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * (0.85 + Math.random() * 0.3); bp.Q.value = q;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.0); src.stop(t + dur + 0.05);
  }

  shot() {
    const list = this.buffers.shot; if (!list?.length || this.ctx.state !== 'running') return;
    const buf = list[(Math.random() * list.length) | 0];
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = 0.97 + Math.random() * 0.08;
    const g = this.ctx.createGain(); g.gain.value = 0.85;
    src.connect(g); g.connect(this.master); g.connect(this.echoIn);
    src.start();
    this.cloth({ vol: 0.05, dur: 0.12, freq: 3000 });
  }
  // ---- combat sounds (procedural) ----
  tone({ freq = 1000, type = 'sine', vol = 0.2, dur = 0.1, delay = 0, to = null }) {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  noiseHit({ vol = 0.2, dur = 0.05, freq = 4000, type = 'highpass', delay = 0, q = 0.7 }) {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
  // hit marker tick: crisp click, higher and brighter for head shots
  hitTick(head = false) {
    this.noiseHit({ vol: 0.22, dur: 0.035, freq: head ? 5200 : 3800 });
    this.tone({ freq: head ? 3200 : 2300, type: 'triangle', vol: head ? 0.12 : 0.09, dur: 0.06, to: head ? 2600 : 1800 });
    if (head) this.tone({ freq: 5400, vol: 0.05, dur: 0.12, delay: 0.01 });
  }
  killConfirm(head = false) {
    this.tone({ freq: 160, type: 'sine', vol: 0.35, dur: 0.18, to: 70 });
    this.noiseHit({ vol: 0.18, dur: 0.06, freq: 900, type: 'lowpass' });
    this.tone({ freq: head ? 1900 : 1500, type: 'triangle', vol: 0.1, dur: 0.25, delay: 0.05 });
  }
  steelDing(dist = 20) {
    const v = Math.min(0.5, 6 / (dist + 4)), d = dist / 343;
    this.tone({ freq: 1180, vol: v, dur: 1.1, delay: d }); this.tone({ freq: 2930, vol: v * 0.5, dur: 0.6, delay: d }); this.tone({ freq: 4710, vol: v * 0.25, dur: 0.3, delay: d });
  }
  // distant shot from a bot: distance attenuation, air absorption (low-pass), travel delay, stereo pan
  shotAt(dist, pan) {
    const list = this.buffers.shot; if (!list?.length || this.ctx.state !== 'running') return;
    const buf = list[(Math.random() * list.length) | 0];
    const t = this.ctx.currentTime + Math.min(0.4, dist / 343);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = 0.9 + Math.random() * 0.06;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 11000 - dist * 140);
    const g = this.ctx.createGain(); g.gain.value = Math.min(0.6, 0.55 / (1 + dist / 18));
    let node = src.connect(lp).connect(g);
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-0.85, Math.min(0.85, pan)); node = node.connect(p); }
    node.connect(this.master); g.connect(this.echoIn);
    src.start(t);
  }
  whiz(pan = 0) { // supersonic crack + whoosh of a near miss
    this.noiseHit({ vol: 0.16, dur: 0.03, freq: 2500 });
    this.noiseHit({ vol: 0.12, dur: 0.16, freq: 1400, type: 'bandpass', q: 1.4, delay: 0.01 });
  }
  hurt() { this.tone({ freq: 110, vol: 0.4, dur: 0.16, to: 60 }); this.noiseHit({ vol: 0.2, dur: 0.12, freq: 600, type: 'lowpass' }); this.cloth({ vol: 0.12, dur: 0.2, freq: 1200 }); }
  pickup() { this.play('magIn', { vol: 0.5, rate: 1.1 }); this.play('click', { vol: 0.2, delay: 0.12 }); this.cloth({ vol: 0.15, dur: 0.3, freq: 1700 }); }

  onWeaponCue(id) {
    if (id === 'magOut') this.play('magOut', { vol: 0.7 });
    if (id === 'magIn') this.play('magIn', { vol: 0.75 });
    if (id === 'rack') this.play('rack', { vol: 0.7 });
    if (id === 'dry') this.play('dry', { vol: 0.6 });
    if (id === 'cloth') this.cloth({ vol: 0.16, dur: 0.3, freq: 1500 });
    if (id === 'ads') { this.cloth({ vol: 0.12, dur: 0.18, freq: 2200 }); this.play('click', { vol: 0.05, rate: 1.3 }); }
  }

  // ---- gameplay hooks ----
  onPlayerEvent(e, player) {
    switch (e.type) {
      case 'step': {
        const sp = e.data; const run = player.sprinting || player.tactical;
        const v = player.crouched ? 0.28 : run ? 0.75 : 0.5;
        this.play('step', { vol: v, rate: run ? 1.05 : 0.95, rateVar: 0.08 });
        this.play('stepHard', { vol: v * 0.25, rate: 0.9 });
        // gear/cloth movement on each step, stronger when running
        this.cloth({ vol: run ? 0.11 : 0.05, dur: run ? 0.2 : 0.16, freq: run ? 2200 : 1700 });
        if (run && Math.random() < 0.35) this.play('metal', { vol: 0.05, rate: 1.6, rateVar: 0.15 });
        break;
      }
      case 'jump':
        this.play('step', { vol: 0.6, rate: 0.85 });
        this.cloth({ vol: 0.22, dur: 0.3, freq: 1500 });
        this.play('click', { vol: 0.12, rate: 0.8, delay: 0.04 });
        break;
      case 'land': {
        const f = Math.min(1.4, e.data / 6);
        this.play('thud', { vol: 0.35 + 0.35 * f, rate: 0.9 });
        this.play('step', { vol: 0.55 * f + 0.2, rate: 0.85 });
        this.play('step', { vol: 0.4 * f + 0.15, rate: 0.9, delay: 0.045 });
        this.cloth({ vol: 0.2 * f + 0.08, dur: 0.25, freq: 1300 });
        this.play('metal', { vol: 0.08 * f, rate: 1.4, delay: 0.03 });
        break;
      }
      case 'slideStart':
        this.cloth({ vol: 0.35, dur: 0.9, freq: 900, q: 0.5 });
        this.play('thud', { vol: 0.35, rate: 0.8 });
        break;
      case 'sprintStart': this.cloth({ vol: 0.14, dur: 0.25, freq: 2000 }); this.play('click', { vol: 0.08, rate: 1.2 }); break;
      case 'tacStart': this.cloth({ vol: 0.2, dur: 0.3, freq: 2300 }); this.play('click', { vol: 0.14, rate: 0.9 }); break;
      case 'crouch': case 'stand': this.cloth({ vol: 0.14, dur: 0.28, freq: 1400 }); break;
    }
  }
  onInspectCue(id) {
    if (id === 'cloth') this.cloth({ vol: 0.14, dur: 0.35, freq: 1600 });
    if (id === 'handle') { this.play('click', { vol: 0.18, rate: 0.75 }); this.cloth({ vol: 0.1, dur: 0.25, freq: 2400, delay: 0.05 }); }
    if (id === 'handle2') { this.play('click', { vol: 0.2, rate: 0.7 }); this.play('metal', { vol: 0.06, rate: 1.8 }); }
    if (id === 'settle') { this.play('click', { vol: 0.16, rate: 0.85 }); this.cloth({ vol: 0.12, dur: 0.2, freq: 1800 }); }
  }
}
