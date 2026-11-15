const KEY = 'ochre-ridge-settings-v1';
const DEFAULTS = { quality: null, sens: 1.0, fov: 92, adsHold: false, compass: true, debug: false, aimAssist: 0.3, autoSprint: true, bots: true };
const $ = (id) => document.getElementById(id);

export class Settings {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
    this.v = { ...DEFAULTS, ...saved };
    this.listeners = [];
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* ignore */ } }
  onChange(fn) { this.listeners.push(fn); fn(this.v); }
  emit() { this.save(); for (const f of this.listeners) f(this.v); }

  bindUI({ currentQuality, onOpen, onClose }) {
    const el = $('settings');
    const q = $('set-quality'), sens = $('set-sens'), fov = $('set-fov'), adsHold = $('set-adshold'), comp = $('set-compass'), dbg = $('set-debug');
    q.value = this.v.quality || currentQuality; sens.value = this.v.sens; fov.value = this.v.fov; $('fov-val').textContent = this.v.fov;
    adsHold.checked = this.v.adsHold; comp.checked = this.v.compass; dbg.checked = this.v.debug;
    const aa = $('set-aa'), as = $('set-autosprint'), bots = $('set-bots');
    aa.value = this.v.aimAssist; $('aa-val').textContent = Math.round(this.v.aimAssist * 100) + '%'; as.checked = this.v.autoSprint; bots.checked = this.v.bots;
    aa.oninput = () => { this.v.aimAssist = +aa.value; $('aa-val').textContent = Math.round(aa.value * 100) + '%'; this.emit(); };
    as.onchange = () => { this.v.autoSprint = as.checked; this.emit(); };
    bots.onchange = () => { this.v.bots = bots.checked; this.emit(); };
    q.onchange = () => { this.v.quality = q.value; this.save(); location.reload(); };
    sens.oninput = () => { this.v.sens = +sens.value; this.emit(); };
    fov.oninput = () => { this.v.fov = +fov.value; $('fov-val').textContent = fov.value; this.emit(); };
    adsHold.onchange = () => { this.v.adsHold = adsHold.checked; this.emit(); };
    comp.onchange = () => { this.v.compass = comp.checked; this.emit(); };
    dbg.onchange = () => { this.v.debug = dbg.checked; this.emit(); };
    const open = () => { el.classList.remove('hidden'); onOpen?.(); };
    const close = () => { el.classList.add('hidden'); onClose?.(); };
    $('btn-menu').addEventListener('click', open);
    $('settings-close').addEventListener('click', close);
    $('settings-resume').addEventListener('click', close);
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && !el.classList.contains('hidden')) close(); });
    this.open = open; this.close = close;
    this.isOpen = () => !el.classList.contains('hidden');
  }
}
