// Level data (segment chains) -> levels/levels.json + validation. Node port of make_levels.py (no preview images).
// Run: node tools/make_levels.mjs
// Coordinates: Y up, start faces -Z. heading h (deg): dir=(sin h, 0, -cos h), right=(cos h, 0, sin h).
// Positive curve angle turns RIGHT. `drop` = height change over the segment (negative = downhill).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAZARDS = new Set(['bumper', 'rival', 'spinner', 'hammer', 'saw', 'mover', 'launcher', 'speedpad', 'bonus', 'goal', 'start']);

const S = (L, w = 6, drop = 0, rails = 'both', k = {}) => ({ type: 'straight', length: L, width: w, drop, rails, ...k });
const C = (A, R, w = 5, drop = 0, rails = 'both', k = {}) => ({ type: 'curve', angle: A, radius: R, width: w, drop, rails, ...k });
const P = (w = 10, d = 10, drop = 0, rails = 'none', k = {}) => ({ type: 'platform', width: w, length: d, drop, rails, ...k });
const GAP = (L, drop = 0, k = {}) => ({ type: 'gap', length: L, width: 4, drop, rails: 'none', ...k });
const TUBE = (L, drop, k = {}) => ({ type: 'tube', length: L, width: 3, drop, rails: 'none', ...k });
const LIFT = (h, k = {}) => ({ type: 'lift', length: 3, width: 3, drop: h, rails: 'none', ...k });
const H = (type, at = 0.5, x = 0, p = {}) => ({ type, at, x, ...p });

export const LEVELS = [
  { id: 'neongrid', name: { he: 'רשת הניאון', en: 'Neon Grid' }, theme: 'neon',
    desc: { he: 'לילה בעיר הדיגיטלית: אריחים נופלים, מסורים ורצפת זכוכית.', en: 'Night in the digital city: falling tiles, saws and a glass floor.' },
    segments: [S(10, 6, -1, 'both', { hazards: [H('start', 0.3)] }), S(16, 6, -1, 'none', { collapse: true }),
      P(14, 14, 0, 'none', { checkpoint: true, hazards: [H('spinner', 0.5, 0, { length: 12, speed: 1.4 })] }),
      C(-90, 8, 4, -2, 'none', { hazards: [H('saw', 0.5, 0, { travel: 3.2, period: 2.5 })] }),
      GAP(14, -1, { hazards: [H('mover', 0.5, 0, { travel: 11, period: 4.5 })] }), P(10, 10, 0, 'none', { checkpoint: true }),
      S(18, 3, -2, 'none', { hazards: [H('rival', 0.3), H('bumper', 0.7, 0)] }), C(90, 6, 4, -1, 'left', { surface: 'glass' }),
      P(12, 12, 0, 'none', { hazards: [H('goal', 0.6)] })] },
  { id: 'glassrink', name: { he: 'משטח הקרח', en: 'Glass Rink' }, theme: 'ice',
    desc: { he: 'קרח חלקלק, זכוכית, מסורים וכל מה שלמדת.', en: 'Slippery ice, glass, saws and everything you learned.' },
    segments: [S(12, 7, -2, 'both', { surface: 'ice', hazards: [H('start', 0.2)] }), C(90, 10, 6, -1, 'left', { surface: 'ice' }),
      P(16, 16, 0, 'none', { checkpoint: true, surface: 'ice', hazards: [H('bumper', 0.3, -0.5), H('bumper', 0.3, 0.5), H('bumper', 0.7, 0), H('rival', 0.6, 0.4)] }),
      S(14, 3, -2, 'none', { surface: 'glass', hazards: [H('saw', 0.5, 0, { travel: 2.4, period: 2 })] }), TUBE(14, -6),
      P(12, 12, 0, 'none', { checkpoint: true, hazards: [H('spinner', 0.5, 0, { length: 10, speed: 1.2 })] }), C(-180, 7, 4, -2, 'right', { surface: 'ice' }),
      S(6, 4, 0, 'none', { hazards: [H('launcher', 0.7, 0, { power: 1.0 })] }), GAP(12, -2), P(10, 10, 0, 'none', { checkpoint: true }),
      S(16, 2.5, -3, 'none', { collapse: true }), P(12, 12, 0, 'none', { hazards: [H('goal', 0.6)] })] },

  // New, harder: narrow rail-less sky paths, a saw on a curve, a blind launch, a fast mover and an icy crumbling finish.
  { id: 'cloudgauntlet', name: { he: 'מסלול העננים', en: 'Cloud Gauntlet' }, theme: 'sky',
    desc: { he: 'שבילים צרים בלי מעקות, מסור בעיקול, קפיצה עיוורת ופלטפורמה מהירה.', en: 'Rail-less paths, a saw on a bend, a blind launch and a fast mover.' },
    segments: [S(10, 5, -1, 'both', { hazards: [H('start', 0.3)] }), S(14, 2.5, -2, 'none', { hazards: [H('speedpad', 0.15)] }),
      P(12, 12, 0, 'none', { checkpoint: true, hazards: [H('bumper', 0.3, -0.55), H('bumper', 0.3, 0.55), H('rival', 0.72, 0)] }),
      C(90, 6, 3, -1, 'none', { hazards: [H('saw', 0.5, 0, { travel: 2.2, period: 1.8 })] }),
      S(6, 4, 0, 'none', { hazards: [H('launcher', 0.7, 0, { power: 1.0 })] }), GAP(12, -2),
      P(10, 10, 0, 'none', { checkpoint: true, hazards: [H('spinner', 0.5, 0, { length: 8, speed: 1.9 })] }),
      GAP(10, 0, { hazards: [H('mover', 0.5, 0, { travel: 6.6, period: 3.2 })] }), P(8, 8, 0, 'none', { checkpoint: true }),
      C(-120, 7, 3, -2, 'none', { surface: 'ice' }), S(12, 3, -1, 'none', { collapse: true }),
      P(12, 12, 0, 'none', { hazards: [H('goal', 0.6)] })] },

  // New, hardest: hammer lanes, a double-hammer yard, a drop tube, a rival on a ledge, twin saws, a lift,
  // crumbling tiles, a tar bend and a final launch over the void.
  { id: 'factoryfinale', name: { he: 'גמר המפעל', en: 'Factory Finale' }, theme: 'factory',
    desc: { he: 'הגמר: פטישים, מסורים כפולים, צינור, שואב, אריחים נופלים וזינוק אחרון.', en: 'The finale: hammers, twin saws, a tube, a vacuum, crumbling tiles and one last leap.' },
    segments: [S(10, 6, -1, 'both', { hazards: [H('start', 0.3)] }), S(12, 4, -1, 'both', { hazards: [H('hammer', 0.5, -0.5, { period: 1.6 })] }),
      P(12, 12, 0, 'none', { checkpoint: true, hazards: [H('hammer', 0.3, -0.5, { period: 1.5 }), H('hammer', 0.7, 0.5, { period: 1.5, phase: 0.5 }), H('bonus', 0.5, 0.8, { seconds: 3 })] }),
      TUBE(16, -6), P(10, 10, 0, 'none', { checkpoint: true, hazards: [H('rival', 0.55, 0)] }),
      S(14, 3, -1, 'none', { hazards: [H('saw', 0.35, 0, { travel: 2.4, period: 1.6 }), H('saw', 0.75, 0, { travel: 2.4, period: 1.9 })] }),
      LIFT(6), P(10, 10, 0, 'none', { checkpoint: true }), S(8, 3, 0, 'none', { collapse: true }),
      C(90, 6, 3, -1, 'none', { surface: 'tar' }), S(6, 4, 0, 'none', { hazards: [H('launcher', 0.7, 0, { power: 1.0 })] }), GAP(10, -1),
      P(12, 12, 0, 'none', { hazards: [H('goal', 0.6)] })] },
];

const rad = (d) => (d * Math.PI) / 180;
const rightv = (h) => [Math.cos(rad(h)), Math.sin(rad(h))];
const dirv = (h) => [Math.sin(rad(h)), -Math.cos(rad(h))];

function walk(level, y0 = 30) {
  let x = 0, z = 0, y = y0, h = 0, total = 0;
  for (const seg of level.segments) {
    seg._start = { x, y, z, heading: h };
    const pts = []; let L;
    if (seg.type === 'curve') {
      const A = seg.angle, R = seg.radius, s = A > 0 ? 1 : -1, [rx, rz] = rightv(h);
      const cx = x + rx * R * s, cz = z + rz * R * s;
      for (let i = 0; i <= 32; i++) { const u = i / 32, hh = h + A * u, [rx2, rz2] = rightv(hh); pts.push([cx - rx2 * R * s, cz - rz2 * R * s, y + seg.drop * u, hh]); }
      L = Math.abs(rad(A)) * R;
    } else {
      L = seg.length; const [dx, dz] = dirv(h);
      for (let i = 0; i <= 16; i++) pts.push([x + (dx * L * i) / 16, z + (dz * L * i) / 16, y + (seg.drop * i) / 16, h]);
    }
    seg._pts = pts; [x, z, y, h] = pts[pts.length - 1];
    if (seg.type !== 'lift') total += L;
    seg._len = L;
  }
  return total;
}

function validate(level) {
  const errs = [], segs = level.segments;
  const kinds = segs.flatMap((s) => (s.hazards || []).map((hz) => hz.type));
  if (kinds.filter((k) => k === 'start').length !== 1) errs.push('exactly one start');
  if (kinds.filter((k) => k === 'goal').length !== 1) errs.push('exactly one goal');
  if (!(segs[segs.length - 1].hazards || []).some((hz) => hz.type === 'goal')) errs.push('goal must be on last segment');
  if (!segs.some((s) => s.checkpoint)) errs.push('needs >=1 checkpoint');
  segs.forEach((s, i) => {
    for (const hz of s.hazards || []) if (!HAZARDS.has(hz.type)) errs.push(`seg${i} hazard ${hz.type}`);
    if (s.type === 'gap') {
      const prev = segs[i - 1], hasMover = (s.hazards || []).some((hz) => hz.type === 'mover');
      const hasLaunch = (prev.hazards || []).some((hz) => hz.type === 'launcher' || hz.type === 'speedpad');
      if (!(hasMover || hasLaunch)) errs.push(`seg${i} gap is not crossable`);
      if (!segs[i + 1] || segs[i + 1].type !== 'platform') errs.push(`seg${i} gap must land on a platform`);
    }
    if (s.type === 'curve' && s.radius < s.width / 2 + 1) errs.push(`seg${i} curve radius too tight`);
  });
  for (let i = 0; i < segs.length; i++) for (let j = i + 2; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.type === 'gap' || b.type === 'gap') continue;
    outer: for (const p of a._pts) for (const q of b._pts) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < ((a.width + b.width) / 2) * 0.9 && Math.abs(p[2] - q[2]) < 4) { errs.push(`seg${i} overlaps seg${j} (dy=${Math.abs(p[2] - q[2]).toFixed(1)})`); break outer; }
    }
  }
  return errs;
}

function times(level, L) {
  const fixed = level.segments.filter((s) => s.type === 'tube' || s.type === 'lift').length * 2.5;
  const base = L / 6.5 + fixed, r = (v) => Math.round(v * 2) / 2;
  return { raceTime: r(base * 1.6 + 8), par: r(base * 1.15), medals: { bronze: r(base * 1.35), silver: r(base * 1.1), gold: r(base * 0.95), acorn: r(base * 0.85) } };
}

const out = []; let ok = true;
const round3 = (v) => Math.round(v * 1000) / 1000;
for (const lv of LEVELS) {
  const L = walk(lv), errs = validate(lv), tm = times(lv, L);
  if (errs.length) { ok = false; console.log('✗', lv.id, errs); }
  const ymin = Math.min(...lv.segments.flatMap((s) => s._pts.map((p) => p[2])));
  const { segments, ...meta } = lv;
  out.push({ ...meta, ...tm, killY: Math.round((ymin - 8) * 100) / 100, pathLength: Math.round(L * 10) / 10,
    segments: segments.map((s) => { const c = {}; for (const k in s) if (!k.startsWith('_')) c[k] = s[k];
      c.start = { x: round3(s._start.x), y: round3(s._start.y), z: round3(s._start.z), heading: round3(s._start.heading) }; return c; }) });
  console.log(`✓ ${lv.id.padEnd(14)} ${L.toFixed(1).padStart(6)} m  race ${tm.raceTime}s  gold ${tm.medals.gold}s  killY ${(ymin - 8).toFixed(1)}`);
}
fs.writeFileSync(path.join(ROOT, 'levels', 'levels.json'), JSON.stringify({ version: 2, units: 'meters/seconds', ballRadius: 0.5,
  conventions: 'Y up; heading deg, dir=(sin h,0,-cos h); +angle turns right; drop=Δy over segment; hazard.at 0..1 along segment; hazard.x -1..1 across half-width (+ = right)',
  levels: out }, null, 1));
console.log(ok ? 'valid' : 'INVALID');
process.exitCode = ok ? 0 : 1;
