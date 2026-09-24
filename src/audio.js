// Web Audio: decoded WAV buffers, one-shots, loops, positional (Panner) sources, music ducking.
import { Vector3 } from 'three';
// Everything degrades to silent no-ops if audio is unavailable or still locked.
export const SFX = ['roll_loop', 'vacuum_loop', 'saw_loop', 'music_loop', 'bump', 'bumper', 'fall_whoosh', 'ball_crack',
  'respawn_pop', 'checkpoint', 'time_bonus', 'countdown_beep', 'go', 'tick', 'goal_fanfare', 'launcher', 'dizzy', 'squeak',
  'ui_click', 'ui_hover', 'medal', 'hammer_slam', 'tile_crumble'];

const MUSIC_DB = -14;

export class Audio {
  constructor() {
    this.buffers = {};
    this.ok = false;
    this.loops = new Set();
    this.musicVol = 0.7; this.sfxVol = 0.85; this.duckAmt = 1; this.muted = false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.master);
      this.worldGain = this.ctx.createGain(); this.worldGain.connect(this.sfxGain); // world loops, muted while paused
      this.ok = true;
    } catch { this.ok = false; }
    // Unlock on the first user gesture (required on iOS/Chrome autoplay policies).
    const unlock = () => {
      if (!this.ok) return;
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      // iOS needs a sound started inside the gesture.
      try { const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); } catch { /* ignore */ }
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    this.applyVolumes();
  }
  get unlocked() { return this.ok && this.ctx.state === 'running'; }

  async load(onProgress) {
    if (!this.ok) { onProgress?.(1); return; }
    let done = 0;
    await Promise.all(SFX.map(async (n) => {
      try {
        const r = await fetch(`assets/sfx/${n}.wav`);
        const ab = await r.arrayBuffer();
        this.buffers[n] = await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
      } catch { /* missing sound: stays silent */ }
      onProgress?.(++done / SFX.length);
    }));
  }

  setVolumes(music, sfx) { this.musicVol = music; this.sfxVol = sfx; this.applyVolumes(); }
  setMuted(m) { this.muted = m; this.applyVolumes(); }
  applyVolumes() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.musicVol * Math.pow(10, MUSIC_DB / 20) * this.duckAmt, t, 0.15);
    this.sfxGain.gain.setTargetAtTime(this.sfxVol, t, 0.05);
  }
  pauseWorld(p) { if (this.ok) this.worldGain.gain.setTargetAtTime(p ? 0 : 1, this.ctx.currentTime, 0.04); }
  duck(on) { this.duckAmt = on ? 0.35 : 1; this.applyVolumes(); }

  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = 4; p.rolloffFactor = 1.3; p.maxDistance = 80;
    setParam(p, 'position', pos);
    return p;
  }

  /** One-shot. opts: vol, rate, pos (Vector3-like → positional). */
  play(name, { vol = 1, rate = 1, pos = null } = {}) {
    if (!this.ok || !this.buffers[name] || this.ctx.state !== 'running') return null;
    const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name]; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g);
    if (pos) { const p = this._panner(pos); g.connect(p); p.connect(this.sfxGain); } else g.connect(this.sfxGain);
    src.start();
    return src;
  }

  /** Looping source; returns a handle with setVol/setRate/setPos/stop. Safe when silent. */
  loop(name, { vol = 1, rate = 1, pos = null, music = false } = {}) {
    const out = () => (music ? this.musicGain : this.worldGain);
    const h = { setVol() {}, setRate() {}, setPos() {}, stop() {} };
    if (!this.ok || !this.buffers[name]) return h;
    const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name]; src.loop = true; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g);
    let p = null;
    if (pos) { p = this._panner(pos); g.connect(p); p.connect(out()); } else g.connect(out());
    src.start();
    const ctx = this.ctx;
    h.setVol = (v, tc = 0.06) => g.gain.setTargetAtTime(v, ctx.currentTime, tc);
    h.setRate = (r) => src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.05);
    h.setPos = (v) => p && setParam(p, 'position', v);
    h.stop = () => { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); src.stop(ctx.currentTime + 0.3); } catch { /* already stopped */ } this.loops.delete(h); };
    this.loops.add(h);
    return h;
  }

  startMusic() {
    if (this.music) return;
    this.music = this.loop('music_loop', { vol: 1, music: true });
  }

  /** Listener follows the camera. */
  setListener(cam) {
    if (!this.ok) return;
    const l = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(TMP);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }
}

const TMP = new Vector3();
function setParam(p, name, v) {
  if (p[name + 'X']) { p[name + 'X'].value = v.x; p[name + 'Y'].value = v.y; p[name + 'Z'].value = v.z; } else if (p.setPosition) p.setPosition(v.x, v.y, v.z);
}
