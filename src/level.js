// Level: builds the course from levels.json segment chains (render meshes + one merged trimesh collider per
// segment), collapse tiles, path samples for progress, camera sections, and owns the Hazards. dispose() frees it all.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { poseAt, frameAt, segLen, rightOf, dirOf, THEMES, DEG, horizonColor, loadTex } from './util.js';
import { Hazards } from './hazards.js';

const SLAB = 0.6;
const FRICTION = { normal: 0.9, ice: 0.05, glass: 0.9, tar: 1.0 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// ---------- tiny geometry builder with outward-normal-hinted quads ----------
class GeoBuilder {
  constructor() { this.pos = []; this.uv = []; this.idx = []; this.groups = []; this.cur = -1; }
  group(mi) {
    if (this.cur === mi) return;
    this._close(); this.groups.push({ start: this.idx.length, count: 0, materialIndex: mi }); this.cur = mi;
  }
  _close() { const g = this.groups[this.groups.length - 1]; if (g) g.count = this.idx.length - g.start; }
  v(p, uv) { this.pos.push(p.x, p.y, p.z); this.uv.push(uv[0], uv[1]); return this.pos.length / 3 - 1; }
  quad(a, b, c, d, ua, ub, uc, ud, hint) {
    const n = _a.subVectors(b, a).cross(_b.subVectors(c, a));
    if (n.lengthSq() < 1e-10) n.subVectors(c, a).cross(_b.subVectors(d, a));
    const i0 = this.v(a, ua), i1 = this.v(b, ub), i2 = this.v(c, uc), i3 = this.v(d, ud);
    if (n.dot(hint) >= 0) this.idx.push(i0, i1, i2, i0, i2, i3); else this.idx.push(i0, i2, i1, i0, i3, i2);
  }
  tri(a, b, c, hint) {
    const n = _a.subVectors(b, a).cross(_b.subVectors(c, a));
    const i0 = this.v(a, [0, 0]), i1 = this.v(b, [1, 0]), i2 = this.v(c, [0, 1]);
    if (n.dot(hint) >= 0) this.idx.push(i0, i1, i2); else this.idx.push(i0, i2, i1);
  }
  geometry() {
    this._close();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    for (const gr of this.groups) if (gr.count > 0) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.computeVertexNormals();
    return g;
  }
}

/** Samples along a segment: pos (floor centre), right, dir, along distance. */
function samples(s, n) {
  const out = [], L = segLen(s);
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = poseAt(s, u);
    out.push({ p: new THREE.Vector3(p.x, p.y, p.z), r: rightOf(p.h), d: dirOf(p.h), along: L * u });
  }
  return out;
}
const subdiv = (s) => (s.type === 'curve' ? Math.max(24, Math.ceil(segLen(s) / 0.7)) : 1);

/** Floor slab (top = group 0, sides/bottom = group 1). */
function buildSlab(b, s, D0) {
  const hw = s.width / 2, S = samples(s, subdiv(s)), up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const L = (i) => S[i].p.clone().addScaledVector(S[i].r, -hw), R = (i) => S[i].p.clone().addScaledVector(S[i].r, hw);
  const dn = (v) => v.clone().setY(v.y - SLAB);
  b.group(0);
  for (let i = 0; i < S.length - 1; i++) {
    const v0 = (D0 + S[i].along) / 4, v1 = (D0 + S[i + 1].along) / 4;
    b.quad(L(i), R(i), R(i + 1), L(i + 1), [-hw / 4, v0], [hw / 4, v0], [hw / 4, v1], [-hw / 4, v1], up);
  }
  b.group(1);
  for (let i = 0; i < S.length - 1; i++) {
    const u0 = (D0 + S[i].along) / 2, u1 = (D0 + S[i + 1].along) / 2;
    b.quad(L(i), dn(L(i)), dn(L(i + 1)), L(i + 1), [u0, 1], [u0, 0], [u1, 0], [u1, 1], S[i].r.clone().negate());
    b.quad(R(i), dn(R(i)), dn(R(i + 1)), R(i + 1), [u0, 1], [u0, 0], [u1, 0], [u1, 1], S[i].r);
    b.quad(dn(L(i)), dn(R(i)), dn(R(i + 1)), dn(L(i + 1)), [0, 0], [1, 0], [1, 1], [0, 1], down);
  }
  const n = S.length - 1, w2 = s.width / 2;
  b.quad(L(0), R(0), dn(R(0)), dn(L(0)), [0, 1], [w2, 1], [w2, 0], [0, 0], S[0].d.clone().negate());
  b.quad(L(n), R(n), dn(R(n)), dn(L(n)), [0, 1], [w2, 1], [w2, 0], [0, 0], S[n].d);
}

// Rounded curb profile (lateral offset, height): 0.25 wide, 0.5 high.
const PROF = (() => {
  const p = [[-0.125, 0], [-0.125, 0.375]];
  for (let k = 1; k <= 5; k++) { const a = Math.PI - (k * Math.PI) / 6; p.push([0.125 * Math.cos(a), 0.375 + 0.125 * Math.sin(a)]); }
  p.push([0.125, 0.375], [0.125, 0]);
  return p;
})();

function buildRail(b, s, side) {
  const hw = s.width / 2, c = side * (hw - 0.125), S = samples(s, subdiv(s));
  const P = (i, j) => S[i].p.clone().addScaledVector(S[i].r, c + PROF[j][0]).setY(S[i].p.y + PROF[j][1]);
  const axis = (i) => S[i].p.clone().addScaledVector(S[i].r, c).setY(S[i].p.y + 0.2);
  for (let i = 0; i < S.length - 1; i++) {
    for (let j = 0; j < PROF.length - 1; j++) {
      const a = P(i, j), bb = P(i, j + 1), cc = P(i + 1, j + 1), d = P(i + 1, j);
      const hint = a.clone().add(cc).multiplyScalar(0.5).sub(axis(i).add(axis(i + 1)).multiplyScalar(0.5));
      b.quad(a, bb, cc, d, [S[i].along / 2, j / 8], [S[i].along / 2, (j + 1) / 8], [S[i + 1].along / 2, (j + 1) / 8], [S[i + 1].along / 2, j / 8], hint);
    }
  }
  for (const [i, sg] of [[0, -1], [S.length - 1, 1]]) {
    const ctr = axis(i), hint = S[i].d.clone().multiplyScalar(sg);
    for (let j = 0; j < PROF.length - 1; j++) b.tri(ctr, P(i, j), P(i, j + 1), hint);
  }
}

export class Level {
  constructor(game, data) {
    this.game = game;
    this.data = data;
    this.segs = data.segments;
    this.theme = THEMES[data.theme] || THEMES.meadow;
    this.group = new THREE.Group();
    this.disposables = [];
    this.colliderInfo = new Map(); // collider handle → {seg, surface, tile?, mover?}
    this.tiles = [];
    game.scene.add(this.group);
  }
  own(x) { this.disposables.push(x); return x; }

  async build(world) {
    const g = this.game, T = g.tex, th = this.theme, theme = this.data.theme;
    this.world = world;

    // --- sky, environment, fog, lights ---
    const sky = await loadTex(`assets/textures/sky_${theme}.png`);
    sky.mapping = THREE.EquirectangularReflectionMapping;
    g.setEnvironment(sky, theme);
    const fogC = horizonColor(sky);
    if (theme === 'neon') fogC.multiplyScalar(0.8);
    g.scene.fog = new THREE.Fog(fogC, 55, 190);
    g.setLights(th);

    // --- materials ---
    const floorTex = T[`floor_${theme}`], sideTex = T[`side_${theme}`];
    const em = th.emissive ? { emissive: 0xffffff, emissiveMap: floorTex, emissiveIntensity: 0.55 } : {};
    this.mats = {
      normal: this.own(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, ...em })),
      ice: this.own(new THREE.MeshStandardMaterial({ map: T.floor_ice, roughness: 0.12, metalness: 0.05, envMapIntensity: 1.4, color: 0xeaf8ff })),
      tar: this.own(new THREE.MeshStandardMaterial({ map: T.surface_tar, roughness: 0.35, metalness: 0.1 })),
      glass: this.own(new THREE.MeshStandardMaterial({ map: T.surface_glass, transparent: true, opacity: 0.9, depthWrite: false, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.6, side: THREE.DoubleSide })),
      side: this.own(new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9, ...(th.emissive ? { emissive: 0x7f5bff, emissiveIntensity: 0.25 } : {}) })),
      glassSide: this.own(new THREE.MeshStandardMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.1 })),
      rail: this.own(new THREE.MeshStandardMaterial({ color: th.rail, roughness: 0.45, ...(th.emissive ? { emissive: th.rail, emissiveIntensity: 0.9 } : {}) })),
      collapse: this.own(new THREE.MeshStandardMaterial({ map: T.surface_collapse, roughness: 0.8, ...(th.emissive ? { emissive: 0xffffff, emissiveMap: T.surface_collapse, emissiveIntensity: 0.35 } : {}) })),
    };

    this.fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const flags = RAPIER.TriMeshFlags ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined;

    // --- segments ---
    let D = 0;
    this.segDist = [];
    this.segs.forEach((s, i) => {
      this.segDist.push(D);
      const surface = s.surface || 'normal';
      if (['straight', 'curve', 'platform', 'lift'].includes(s.type)) {
        const base = s.type === 'lift' ? { ...s, type: 'platform', drop: 0 } : s;
        const fb = new GeoBuilder(), rb = new GeoBuilder();
        if (s.collapse) this.buildTiles(base, i);
        else buildSlab(fb, base, D);
        if (s.rails === 'both' || s.rails === 'left') buildRail(rb, base, -1);
        if (s.rails === 'both' || s.rails === 'right') buildRail(rb, base, 1);
        const meshes = [];
        if (fb.pos.length) {
          const geo = this.own(fb.geometry());
          const top = s.type === 'lift' ? this.mats.normal : this.mats[surface];
          const m = new THREE.Mesh(geo, [top, surface === 'glass' ? this.mats.glassSide : this.mats.side]);
          m.receiveShadow = true; m.castShadow = surface !== 'glass';
          if (surface === 'glass') m.renderOrder = 10;
          this.group.add(m); meshes.push(fb);
        }
        if (rb.pos.length) {
          const m = new THREE.Mesh(this.own(rb.geometry()), this.mats.rail);
          m.castShadow = true; m.receiveShadow = true;
          this.group.add(m); meshes.push(rb);
        }
        // One merged trimesh collider per segment (floor + rails).
        if (meshes.length) {
          const pos = [], idx = [];
          for (const mb of meshes) { const off = pos.length / 3; pos.push(...mb.pos); for (const k of mb.idx) idx.push(k + off); }
          let cd;
          try { cd = RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx), flags); } catch { cd = RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)); }
          cd.setFriction(FRICTION[surface]).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0);
          const col = world.createCollider(cd, this.fixed);
          this.colliderInfo.set(col.handle, { seg: i, surface });
        }
      } else if (s.type === 'gap') {
        const pts = [], n = Math.ceil(segLen(s) / 0.8);
        for (let k = 1; k < n; k++) { const p = poseAt(s, k / n); pts.push(p.x, p.y + 0.05, p.z); }
        const geo = this.own(new THREE.BufferGeometry());
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const mat = this.own(new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, map: T.soft_dot, transparent: true, opacity: 0.55, depthWrite: false }));
        this.group.add(new THREE.Points(geo, mat));
      }
      D += s.type === 'lift' ? 0 : segLen(s);
    });
    this.totalLength = D;

    this.buildPath();
    this.buildSections();
    this.hazards = new Hazards(g, this);
    this.startPose = this.hazards.startPose;
  }

  /** collapse: 2×2 m tiles, each a kinematic body with its own collider. */
  buildTiles(s, segIndex) {
    const L = segLen(s), nx = Math.max(1, Math.round(s.width / 2)), nz = Math.max(1, Math.round(L / 2));
    const tw = s.width / nx, tl = L / nz, g = this.game;
    const geo = this.own(new THREE.BoxGeometry(tw - 0.06, SLAB, tl - 0.06));
    const mats = [this.mats.side, this.mats.side, this.mats.collapse, this.mats.side, this.mats.side, this.mats.side];
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const f = frameAt(s, (iz + 0.5) / nz, -1 + ((ix + 0.5) * 2) / nx);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.up, f.fwd.clone().negate()));
      const home = f.pos.clone().addScaledVector(f.up, -SLAB / 2);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(home.x, home.y, home.z).setRotation(q));
      const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(tw / 2, SLAB / 2, tl / 2).setFriction(0.9).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), body);
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.copy(home); mesh.quaternion.copy(q); mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      const tile = { body, col, mesh, home, q, state: 'idle', t: 0, y: 0, v: 0, seg: segIndex };
      this.tiles.push(tile);
      this.colliderInfo.set(col.handle, { seg: segIndex, surface: 'normal', tile });
    }
    g.hasCollapse = true;
  }

  touchTile(tile) {
    if (tile.state !== 'idle') return;
    tile.state = 'shake'; tile.t = 0;
  }

  /** Physics-rate update for tiles (kinematic). */
  stepTiles(dt) {
    for (const t of this.tiles) {
      if (t.state === 'idle') continue;
      t.t += dt;
      if (t.state === 'shake' && t.t >= 0.35) {
        t.state = 'fall'; t.t = 0; t.v = 0; t.y = 0;
        this.game.audio.play('tile_crumble', { vol: 0.55, pos: t.home });
      } else if (t.state === 'fall') {
        t.v += 22 * dt; t.y -= t.v * dt;
        t.body.setNextKinematicTranslation({ x: t.home.x, y: t.home.y + t.y, z: t.home.z });
        if (t.t > 0.9) { t.state = 'gone'; t.t = 0; t.col.setEnabled(false); t.mesh.visible = false; }
      } else if (t.state === 'gone' && t.t >= 5) this.resetTile(t);
    }
  }
  resetTile(t) {
    t.state = 'idle'; t.t = 0; t.y = 0; t.v = 0;
    t.body.setTranslation({ x: t.home.x, y: t.home.y, z: t.home.z }, true);
    t.body.setNextKinematicTranslation({ x: t.home.x, y: t.home.y, z: t.home.z });
    t.col.setEnabled(true); t.mesh.visible = true;
    t.mesh.position.copy(t.home);
  }
  resetTiles() { for (const t of this.tiles) if (t.state !== 'idle') this.resetTile(t); }
  renderTiles() {
    for (const t of this.tiles) {
      if (t.state === 'shake') {
        const k = 0.05 * (0.5 + t.t / 0.35);
        t.mesh.position.set(t.home.x + (Math.random() - 0.5) * k, t.home.y + (Math.random() - 0.5) * k * 0.5, t.home.z + (Math.random() - 0.5) * k);
      } else if (t.state === 'fall') {
        const p = t.body.translation(); t.mesh.position.set(p.x, p.y, p.z);
        t.mesh.rotation.setFromQuaternion(t.q); t.mesh.rotateX(t.t * 0.6); t.mesh.rotateZ(t.t * 0.4);
      } else if (t.state === 'idle') { t.mesh.position.copy(t.home); t.mesh.quaternion.copy(t.q); }
    }
  }

  // ---------- path / progress ----------
  buildPath() {
    const P = [];
    this.segs.forEach((s, i) => {
      const D0 = this.segDist[i];
      if (s.type === 'lift') {
        const a = poseAt(s, 0), b = poseAt(s, 1);
        P.push({ p: new THREE.Vector3(a.x, a.y, a.z), d: D0, seg: i }, { p: new THREE.Vector3(b.x, b.y, b.z), d: D0, seg: i });
        return;
      }
      const L = segLen(s), n = Math.max(2, Math.ceil(L));
      for (let k = 0; k <= n; k++) { const p = poseAt(s, k / n); P.push({ p: new THREE.Vector3(p.x, p.y, p.z), d: D0 + (L * k) / n, seg: i }); }
    });
    this.path = P;
  }
  /** Nearest path sample → {dist, seg}. */
  locate(pos) {
    let best = null, bd = Infinity;
    for (const s of this.path) {
      const dx = s.p.x - pos.x, dz = s.p.z - pos.z, dy = (s.p.y - pos.y) * 2.5;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { dist: best.d, seg: best.seg } : { dist: 0, seg: 0 };
  }

  /** Camera yaw per checkpoint section: the general forward direction from one checkpoint to the next. */
  buildSections() {
    const cps = [0];
    this.segs.forEach((s, i) => { if (s.checkpoint) cps.push(i); });
    const endPose = poseAt(this.segs[this.segs.length - 1], 0.6);
    this.sections = cps.map((si, k) => {
      const a = poseAt(this.segs[si], 0);
      const b = k + 1 < cps.length ? poseAt(this.segs[cps[k + 1]], 0) : endPose;
      const dx = b.x - a.x, dz = b.z - a.z;
      let L = 0; for (let j = si; j < (k + 1 < cps.length ? cps[k + 1] : this.segs.length); j++) L += this.segs[j].type === 'lift' ? 0 : segLen(this.segs[j]);
      const net = Math.hypot(dx, dz);
      const yaw = net > Math.max(5, L * 0.3) ? Math.atan2(dx, -dz) / DEG : a.h;
      return { seg: si, yaw };
    });
  }
  sectionYaw(segIndex) {
    let y = this.sections[0].yaw;
    for (const s of this.sections) if (s.seg <= segIndex) y = s.yaw;
    return y;
  }

  dispose() {
    this.hazards?.dispose();
    this.game.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry && !this.disposables.includes(o.geometry)) o.geometry.dispose(); });
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
    this.tiles.length = 0;
    this.colliderInfo.clear();
  }
}
