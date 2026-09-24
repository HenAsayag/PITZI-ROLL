// Shared math helpers, level-pose math, themes and asset loading.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const GRAVITY = 20;
export const BALL_R = 0.5;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180; // degrees, shortest a→b
export const rand = (a, b) => a + Math.random() * (b - a);

export const isTouch = (() => {
  try { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch { return false; }
})();

export function dirOf(h, v = new THREE.Vector3()) { return v.set(Math.sin(h * DEG), 0, -Math.cos(h * DEG)); }
export function rightOf(h, v = new THREE.Vector3()) { return v.set(Math.cos(h * DEG), 0, Math.sin(h * DEG)); }
export function segLen(s) { return s.type === 'curve' ? Math.abs(s.angle * DEG) * s.radius : s.length; }

/** Centerline pose (floor top) of a segment at u ∈ [0,1]. */
export function poseAt(s, u) {
  const st = s.start;
  if (s.type === 'curve') {
    const sg = Math.sign(s.angle), R = s.radius;
    const r0 = rightOf(st.heading);
    const cx = st.x + r0.x * R * sg, cz = st.z + r0.z * R * sg;
    const h = st.heading + s.angle * u;
    const r = rightOf(h);
    return { x: cx - r.x * R * sg, y: st.y + s.drop * u, z: cz - r.z * R * sg, h };
  }
  const d = dirOf(st.heading);
  return { x: st.x + d.x * s.length * u, y: st.y + s.drop * u, z: st.z + d.z * s.length * u, h: st.heading };
}

const FLAT = new Set(['lift', 'tube', 'gap']);
/** Local frame at (u, lateral x ∈ −1..1): position on the floor plus right/up/forward axes (slope-aware). */
export function frameAt(s, u, x = 0) {
  const p = poseAt(s, u);
  const right = rightOf(p.h), dir = dirOf(p.h);
  const hw = s.width / 2;
  const pos = new THREE.Vector3(p.x + right.x * hw * x, p.y, p.z + right.z * hw * x);
  const fwd = FLAT.has(s.type) ? dir.clone() : dir.clone().multiplyScalar(segLen(s)).add(new THREE.Vector3(0, s.drop, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  return { pos, right, dir, fwd, up, h: p.h, hw };
}

/** Matrix whose local X=right, Y=up, −Z=forward, placed at the frame position (+ lift along up). */
export function frameMatrix(f, lift = 0) {
  const m = new THREE.Matrix4().makeBasis(f.right, f.up, f.fwd.clone().negate());
  m.setPosition(f.pos.clone().addScaledVector(f.up, lift));
  return m;
}

/** Mirror mode: negate X of the whole course (data-level transform, geometry follows). */
export function mirrorLevel(lv) {
  const c = JSON.parse(JSON.stringify(lv));
  for (const s of c.segments) {
    s.start.x = -s.start.x; s.start.heading = -s.start.heading;
    if (s.type === 'curve') s.angle = -s.angle;
    if (s.rails === 'left') s.rails = 'right'; else if (s.rails === 'right') s.rails = 'left';
    for (const h of s.hazards || []) h.x = -(h.x || 0);
  }
  return c;
}

export const THEMES = {
  meadow:  { rail: 0xfff4e0, accent: '#B8F35A', sun: 0xfff1d6, sunI: 2.6, hemiSky: 0xe3f4ff, hemiGround: 0x6d8f4c, hemiI: 1.1 },
  candy:   { rail: 0xff4f8b, accent: '#FF4F8B', sun: 0xfff0f6, sunI: 2.4, hemiSky: 0xfff0fa, hemiGround: 0xb46b93, hemiI: 1.15 },
  factory: { rail: 0xffc83d, accent: '#F4A259', sun: 0xffe6c4, sunI: 2.4, hemiSky: 0xf2e6d0, hemiGround: 0x4a4540, hemiI: 1.0 },
  castle:  { rail: 0xe4d5b7, accent: '#A58BE0', sun: 0xffe2c0, sunI: 2.3, hemiSky: 0xefe6ff, hemiGround: 0x5a4a6a, hemiI: 1.0 },
  sky:     { rail: 0xffffff, accent: '#7FDBFF', sun: 0xffffff, sunI: 2.6, hemiSky: 0xffffff, hemiGround: 0x8fb2d6, hemiI: 1.2 },
  neon:    { rail: 0x7fdbff, accent: '#9B6BFF', sun: 0xb9a8ff, sunI: 1.3, hemiSky: 0x6a4cff, hemiGround: 0x12081f, hemiI: 0.9, bloom: true, emissive: true },
  ice:     { rail: 0x7fdbff, accent: '#BFEFFF', sun: 0xffffff, sunI: 2.5, hemiSky: 0xffffff, hemiGround: 0xa0c8e2, hemiI: 1.2 },
};

// ---------- asset loading ----------
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
export function loadTex(url, { srgb = true, repeat = false } = {}) {
  const key = url + (repeat ? '#r' : '');
  if (texCache.has(key)) return texCache.get(key);
  const p = texLoader.loadAsync(url).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  });
  texCache.set(key, p);
  return p;
}

/** Average colour of the horizon band of an equirect sky: used as matching fog. */
export function horizonColor(tex) {
  try {
    const img = tex.image, c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 64, 32);
    const d = g.getImageData(0, 14, 64, 3).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return new THREE.Color(`rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})`);
  } catch { return new THREE.Color(0xcfe8ff); }
}

export function fmtTime(t, tenths = true) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = tenths ? s.toFixed(1) : String(Math.floor(s));
  return m > 0 ? `${m}:${ss.padStart(tenths ? 4 : 2, '0')}` : ss;
}
