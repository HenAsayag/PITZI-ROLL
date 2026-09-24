// Persistence under localStorage "pitziroll.v1". Every access is guarded: the game works without storage.
const KEY = 'pitziroll.v1';

const DEFAULTS = () => ({
  v: 1,
  unlocked: 1,            // how many races (from the first) are unlocked
  best: {},               // levelId -> best time-trial time
  medals: {},             // levelId -> 'bronze'|'silver'|'gold'|'acorn'
  ghosts: {},             // levelId -> base64(Float32 xyz every 0.05 s)
  tourneyDone: false,
  tourneyBest: 0,
  settings: { music: 0.7, sfx: 0.85, lang: 'en', fps: false, invertMouse: false, reducedMotion: false, quality: 'auto', difficulty: 'normal', mirror: false },
});

export const MEDALS = ['bronze', 'silver', 'gold', 'acorn'];

export class Store {
  constructor() {
    this.data = DEFAULTS();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw), def = DEFAULTS();
        this.data = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) } };
        // English is the default; a saved language only sticks once the player picked it themselves.
        if (!this.data.settings.langChosen) this.data.settings.lang = 'en';
      }
    } catch { /* storage unavailable or corrupt: keep defaults in memory */ }
  }
  get settings() { return this.data.settings; }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* quota / disabled */ }
  }
  unlock(count) { if (count > this.data.unlocked) { this.data.unlocked = Math.min(8, count); this.save(); } }

  /** Records a time-trial result. Returns {newBest, medal, medalUpgrade}. */
  recordTrial(level, time, ghostSamples) {
    const id = level.id, prev = this.data.best[id];
    const newBest = prev == null || time < prev;
    let medal = null;
    for (const m of MEDALS) if (time <= level.medals[m]) medal = m;
    const oldMedal = this.data.medals[id];
    const medalUpgrade = medal && (!oldMedal || MEDALS.indexOf(medal) > MEDALS.indexOf(oldMedal));
    if (newBest) {
      this.data.best[id] = time;
      if (ghostSamples && ghostSamples.length) this.data.ghosts[id] = encodeGhost(ghostSamples);
    }
    if (medalUpgrade) this.data.medals[id] = medal;
    this.save();
    return { newBest, medal, medalUpgrade };
  }
  ghost(id) { try { return this.data.ghosts[id] ? decodeGhost(this.data.ghosts[id]) : null; } catch { return null; } }
}

export function encodeGhost(arr) {
  const f = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeGhost(b64) {
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
