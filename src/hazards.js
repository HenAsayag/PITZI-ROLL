// Hazards & interactive pieces: start, goal, checkpoints, bumper, rival, spinner, hammer, saw, mover,
// launcher, speedpad, bonus, tube and lift. Kinematics are pure functions of level time (step at 120 Hz,
// render at interpolated time). Trigger checks are geometric in each piece's local frame.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { poseAt, frameAt, segLen, dirOf, rightOf, GRAVITY, clamp, smooth, rand } from './util.js';

const V = () => new THREE.Vector3();
const _r = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function stripeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#FFC83D'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1B1F3B';
  for (let i = -64; i < 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + 64, 64); g.lineTo(i + 64, 64); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Local coordinates of p relative to frame f: {f: forward, r: right, u: up}. */
function local(f, p) {
  _r.subVectors(p, f.pos);
  return { f: _r.dot(f.dir), r: _r.dot(f.right), u: _r.y };
}
/** Distance from point p to segment a→b. */
function segPointDist(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}
function frameQuat(f, out = new THREE.Quaternion()) {
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.up, f.fwd.clone().negate()));
}

export class Hazards {
  constructor(game, level) {
    this.g = game; this.lv = level; this.world = level.world; this.group = level.group;
    this.T = game.tex;
    const own = (x) => level.own(x);
    this.own = own;
    this.stripe = own(stripeTexture());
    this.decalMats = {};
    this.list = { bumper: [], rival: [], spinner: [], hammer: [], saw: [], mover: [], launcher: [], speedpad: [], bonus: [] };
    this.checkpoints = []; this.tubes = []; this.lifts = []; this.goal = null;
    this.loops = [];

    const segs = level.segs;
    segs.forEach((s, i) => {
      if (s.checkpoint) this.addCheckpoint(s, i);
      if (s.type === 'tube') this.addTube(s, i);
      if (s.type === 'lift') this.addLift(s, i);
      for (const h of s.hazards || []) {
        const fn = this['add_' + h.type];
        if (fn) fn.call(this, h, s, i);
      }
    });
    if (!this.startPose) { const f = frameAt(segs[0], 0.3); this.startPose = { pos: f.pos.clone().addScaledVector(f.up, 0.6), heading: f.h, seg: 0 }; }
  }

  // ---------- helpers ----------
  decal(texName, f, w, l, lift = 0.025) {
    let mat = this.decalMats[texName];
    if (!mat) {
      mat = this.decalMats[texName] = this.own(new THREE.MeshStandardMaterial({
        map: this.T[texName], transparent: true, depthWrite: false, roughness: 0.55,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
    }
    const geo = this.own(new THREE.PlaneGeometry(w, l));
    const m = new THREE.Mesh(geo, mat);
    const fwd = f.fwd.clone();
    new THREE.Matrix4().makeBasis(f.right, fwd, f.up).decompose(m.position, m.quaternion, m.scale);
    m.position.copy(f.pos).addScaledVector(f.up, lift);
    m.receiveShadow = true; m.renderOrder = 2;
    this.group.add(m);
    return m;
  }
  mat(o) { return this.own(new THREE.MeshStandardMaterial(o)); }
  mesh(geo, mat, parent = this.group) {
    const m = new THREE.Mesh(this.own(geo), mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }

  // ---------- start / goal / checkpoints ----------
  add_start(h, s, i) {
    const f = frameAt(s, h.at, h.x);
    this.startPose = { pos: f.pos.clone().addScaledVector(f.up, 0.6), heading: f.h, seg: i };
    this.decal('pad_checkpoint', f, Math.min(2.4, s.width * 0.6), Math.min(2.4, s.width * 0.6));
  }

  add_goal(h, s, i) {
    const f = frameAt(s, h.at, h.x);
    this.decal('pad_goal', f, 6, 6, 0.03);
    const beamMat = this.own(new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const beam = this.mesh(new THREE.CylinderGeometry(2.6, 3, 9, 40, 1, true), beamMat);
    beam.castShadow = false; beam.position.copy(f.pos).y += 4.5;
    const ringMat = this.own(new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.8 }));
    const ring = this.mesh(new THREE.TorusGeometry(3, 0.06, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2; ring.castShadow = false; ring.position.copy(f.pos).y += 0.1;
    this.goal = { f, seg: i, beam, ring, t: 0 };
  }

  addCheckpoint(s, i) {
    const f = frameAt(s, 0, 0), hw = s.width / 2;
    const ringMat = this.own(new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.95 }));
    const glowMat = this.own(new THREE.MeshBasicMaterial({ color: 0x7fdbff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    const grp = new THREE.Group();
    new THREE.Matrix4().makeBasis(f.right, f.up, f.fwd.clone().negate()).decompose(grp.position, grp.quaternion, grp.scale);
    grp.position.copy(f.pos).addScaledVector(f.dir, 0.15);
    const r = hw + 0.35;
    const ring = new THREE.Mesh(this.own(new THREE.TorusGeometry(r, 0.07, 10, 56, Math.PI)), ringMat);
    const glow = new THREE.Mesh(this.own(new THREE.TorusGeometry(r, 0.22, 10, 56, Math.PI)), glowMat);
    grp.add(ring, glow); this.group.add(grp);
    const fr = frameAt(s, Math.min(0.5, 1.6 / segLen(s)), 0);
    this.decal('pad_checkpoint', frameAt(s, Math.min(0.5, 1.4 / segLen(s)), 0), Math.min(2.2, s.width * 0.55), Math.min(2.2, s.width * 0.55));
    this.checkpoints.push({ seg: i, f, hw, grp, ringMat, glowMat, passed: false, pulse: 0,
      respawn: { pos: fr.pos.clone().addScaledVector(fr.up, 0.6), heading: fr.h, seg: i } });
  }

  // ---------- bumper ----------
  add_bumper(h, s, i) {
    const f = frameAt(s, h.at, h.x);
    // r 0.8 by default; on ledges too narrow to squeeze past, shrink it so a ball still fits beside it.
    const hw = s.width / 2, R = hw - 0.8 < 1.1 ? Math.max(0.4, hw - 1.15) : 0.8;
    const grp = new THREE.Group(); grp.position.copy(f.pos); grp.scale.set(R / 0.8, 1, R / 0.8); this.group.add(grp);
    const side = this.mat({ color: 0xff4f8b, roughness: 0.35, emissive: 0xff4f8b, emissiveIntensity: 0.15 });
    const top = this.mat({ map: this.T.bumper_top, roughness: 0.4, emissive: 0xffffff, emissiveMap: this.T.bumper_top, emissiveIntensity: 0.1 });
    const cyl = this.mesh(new THREE.CylinderGeometry(0.8, 0.86, 0.8, 32), [side, top, side], grp);
    cyl.position.y = 0.4;
    const base = this.mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 32), this.mat({ color: 0x1b1f3b, roughness: 0.6 }), grp);
    base.position.y = 0.06;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(f.pos.x, f.pos.y + 0.4, f.pos.z));
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.4, R).setRestitution(0.5), body);
    this.list.bumper.push({ f, grp, cyl, side, top, pop: 1, cd: 0, R, hw });
  }

  // ---------- rival ----------
  add_rival(h, s, i) {
    const f = frameAt(s, h.at, h.x);
    const home = f.pos.clone().addScaledVector(f.up, 0.6);
    const mat = this.own(new THREE.MeshPhysicalMaterial({ color: 0x15152a, roughness: 0.18, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }));
    const stripe = this.mat({ color: 0xff4f8b, emissive: 0xff4f8b, emissiveIntensity: 0.6, roughness: 0.3 });
    const mesh = this.mesh(new THREE.SphereGeometry(0.55, 32, 20), mat);
    const band = this.mesh(new THREE.TorusGeometry(0.55, 0.07, 10, 40), stripe, mesh);
    band.castShadow = false;
    const dot = this.mesh(new THREE.CircleGeometry(0.16, 20), this.mat({ color: 0xfff4e0, roughness: 0.4 }), mesh);
    dot.position.set(0, 0.2, 0.52); dot.lookAt(0, 0.4, 2);
    const r = { home, mesh, mat, body: null, dead: 0, lastTouch: -99, touchCd: 0, seg: i, prev: home.clone(), cur: home.clone(), prevQ: new THREE.Quaternion(), curQ: new THREE.Quaternion() };
    this.spawnRival(r);
    this.list.rival.push(r);
  }
  spawnRival(r) {
    if (r.body) this.world.removeRigidBody(r.body);
    const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(r.home.x, r.home.y, r.home.z).setCcdEnabled(true).setLinearDamping(0.3).setAngularDamping(0.5));
    const pm = this.g.player?.mass || 2.4;
    this.world.createCollider(RAPIER.ColliderDesc.ball(0.55).setMass(pm * 1.4).setRestitution(0.35).setFriction(1), b);
    r.body = b; r.dead = 0; r.mesh.visible = true;
    r.prev.copy(r.home); r.cur.copy(r.home);
  }

  // ---------- spinner ----------
  add_spinner(h, s, i) {
    const f = frameAt(s, h.at, h.x), len = h.length || 4;
    const center = f.pos.clone().addScaledVector(f.up, 0.5);
    const baseQ = frameQuat(f);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z).setRotation(baseQ));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 0.3, 0.3).setRestitution(0.4).setFriction(0.4), body);
    const post = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(f.pos.x, f.pos.y + 0.55, f.pos.z));
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.55, 0.28), post);
    const grp = new THREE.Group(); grp.position.copy(center); grp.quaternion.copy(baseQ); this.group.add(grp);
    const tex = this.stripe.clone(); tex.repeat.set(len / 1.2, 1); tex.needsUpdate = true; this.own(tex);
    const barMat = this.mat({ map: tex, roughness: 0.5 });
    this.mesh(new THREE.BoxGeometry(len, 0.6, 0.6), barMat, grp);
    for (const sx of [-1, 1]) { const cap = this.mesh(new THREE.SphereGeometry(0.34, 16, 12), this.mat({ color: 0xff4f8b, roughness: 0.4 }), grp); cap.position.x = sx * len / 2; }
    const postM = this.mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.1, 20), this.mat({ color: 0x1b1f3b, roughness: 0.5, metalness: 0.4 }));
    postM.position.set(f.pos.x, f.pos.y + 0.55, f.pos.z);
    this.list.spinner.push({ f, body, grp, baseQ, speed: h.speed || 1, center });
  }

  // ---------- hammer ----------
  add_hammer(h, s, i) {
    const f = frameAt(s, h.at, h.x), baseQ = frameQuat(f);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(f.pos.x, f.pos.y + 3.6, f.pos.z).setRotation(baseQ));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.6, 1).setFriction(0.6), body);
    const grp = new THREE.Group(); grp.quaternion.copy(baseQ); this.group.add(grp);
    const sideTex = this.stripe.clone(); sideTex.repeat.set(2, 0.6); sideTex.needsUpdate = true; this.own(sideTex);
    // Materials are per hammer and transparent-capable so the block can fade when it hides the ball.
    const sideM = this.mat({ map: sideTex, roughness: 0.5, metalness: 0.2, transparent: true });
    const steel = this.mat({ color: 0x5b5f73, roughness: 0.35, metalness: 0.7, transparent: true });
    const glow = this.mat({ color: 0xff5a4f, emissive: 0xff3b2f, emissiveIntensity: 0.4, roughness: 0.4, transparent: true });
    this.mesh(new THREE.BoxGeometry(2, 1.2, 2), [sideM, sideM, steel, steel, sideM, sideM], grp);
    const rod = this.mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.4, 14), steel, grp); rod.position.y = 1.3;
    const cap = this.mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 20), glow, grp); cap.position.y = 2.05;
    const warn = this.decal('pad_launcher', f, 2.2, 2.2); warn.material = this.own(warn.material.clone()); warn.material.color.set(0xff6b6b); warn.material.opacity = 0.45;
    this.list.hammer.push({ f, body, grp, period: h.period || 2, phase: h.phase || 0, lastC: 0, warn, fadeMats: [sideM, steel, glow], glow, alpha: 1 });
  }
  hammerHeight(hm, t) {
    const c = (((t / hm.period) + hm.phase) % 1 + 1) % 1;
    let y, falling = false;
    if (c < 0.5) y = 3 + Math.sin(t * 3) * 0.05;
    else if (c < 0.7) { const k = smooth((c - 0.5) / 0.2); y = 3 + 0.7 * k + Math.sin(t * 40) * 0.03 * k; }
    else if (c < 0.76) { const k = (c - 0.7) / 0.06; y = 3.7 - 3.68 * k * k; falling = true; }
    else if (c < 0.86) y = 0.02;
    else y = 0.02 + 2.98 * smooth((c - 0.86) / 0.14);
    return { y, c, falling };
  }

  // ---------- saw ----------
  add_saw(h, s, i) {
    const f = frameAt(s, h.at, h.x);
    const grp = new THREE.Group(); this.group.add(grp);
    const spin = new THREE.Group(); grp.add(spin);
    new THREE.Matrix4().makeBasis(f.fwd, f.up, f.right).decompose(new THREE.Vector3(), grp.quaternion, new THREE.Vector3());
    // Blade: disc in the (right, up) plane; axis along forward. grp local X=fwd so the disc faces ±X.
    const steel = this.mat({ color: 0xc9ced9, roughness: 0.25, metalness: 0.85 });
    const teethM = this.mat({ color: 0xff2a2a, emissive: 0xff2020, emissiveIntensity: 1.2, roughness: 0.4 });
    const disc = this.mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.07, 32), steel, spin); disc.rotation.z = Math.PI / 2;
    const hub = this.mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.16, 16), this.mat({ color: 0x1b1f3b }), spin); hub.rotation.z = Math.PI / 2;
    const toothGeo = this.own(new THREE.ConeGeometry(0.1, 0.24, 4));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, t = new THREE.Mesh(toothGeo, teethM);
      t.position.set(0, Math.cos(a) * 0.84, Math.sin(a) * 0.84);
      t.rotation.x = a; t.scale.set(1, 1, 0.4);
      spin.add(t);
    }
    const travel = h.travel || 2;
    const slot = this.decal('pad_speed', f, travel + 2.2, 0.35, 0.02);
    slot.material = this.own(new THREE.MeshBasicMaterial({ color: 0x1b1f3b, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const loop = this.g.audio.loop('saw_loop', { vol: 0.55, pos: f.pos });
    this.loops.push(loop);
    this.list.saw.push({ f, grp, spin, teethM, travel, period: h.period || 2, center: f.pos.clone(), loop });
  }
  sawCenter(sw, t, out) {
    const off = (sw.travel / 2) * Math.sin((2 * Math.PI * t) / sw.period);
    return out.copy(sw.f.pos).addScaledVector(sw.f.right, off).addScaledVector(sw.f.up, 0.25);
  }

  // ---------- mover ----------
  add_mover(h, s, i) {
    const L = segLen(s), fMid = frameAt(s, 0.5), baseQ = frameQuat(fMid);
    // Dock with ≤ 0.3 m overlap so the 4 m deck never leaves a lip against a sloped neighbour.
    const travel = Math.min(h.travel || 4, L - 4 + 0.6);
    const p0 = this.moverPos({ s, L, travel, period: h.period || 4 }, 0, V());
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p0.x, p0.y, p0.z).setRotation(baseQ));
    const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.2, 2).setFriction(1).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max), body);
    const grp = new THREE.Group(); grp.quaternion.copy(baseQ); this.group.add(grp);
    const topM = this.lv.mats.normal, edge = this.mat({ color: 0x7fdbff, emissive: 0x7fdbff, emissiveIntensity: 0.8 });
    this.mesh(new THREE.BoxGeometry(4, 0.4, 4), [this.lv.mats.side, this.lv.mats.side, topM, this.lv.mats.side, this.lv.mats.side, this.lv.mats.side], grp);
    for (const [x, z, w, d] of [[0, 1.98, 4.04, 0.08], [0, -1.98, 4.04, 0.08], [1.98, 0, 0.08, 4.04], [-1.98, 0, 0.08, 4.04]]) {
      const e = this.mesh(new THREE.BoxGeometry(w, 0.12, d), edge, grp); e.position.set(x, 0.16, z); e.castShadow = false;
    }
    const m = { s, L, travel, period: h.period || 4, body, grp, vel: V(), pos: p0.clone() };
    this.list.mover.push(m);
    this.lv.colliderInfo.set(col.handle, { seg: i, surface: 'normal', mover: m });
  }
  moverPos(m, t, out) {
    const off = (m.travel / 2) * Math.sin((2 * Math.PI * t) / m.period);
    const p = poseAt(m.s, clamp(0.5 + off / m.L, 0, 1));
    return out.set(p.x, p.y - 0.2 + 0.03, p.z);
  }

  // ---------- launcher / speedpad / bonus ----------
  add_launcher(h, s, i) {
    const f = frameAt(s, h.at, h.x);
    this.decal('pad_launcher', f, 2.2, 2.2);
    let j = i + 1; while (j < this.lv.segs.length && this.lv.segs[j].type !== 'platform') j++;
    const ts = this.lv.segs[Math.min(j, this.lv.segs.length - 1)];
    const tp = poseAt(ts, 0.5);
    const plate = this.mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 24), this.mat({ color: 0xf4a259, roughness: 0.4, transparent: true, opacity: 0.0 }));
    plate.position.copy(f.pos);
    this.list.launcher.push({ f, target: new THREE.Vector3(tp.x, tp.y + 0.55, tp.z), power: h.power || 1, cd: 0, plate, kick: 0 });
  }
  add_speedpad(h, s, i) {
    const f = frameAt(s, h.at, h.x), w = Math.min(1.9, s.width * 0.8);
    this.decal('pad_speed', f, w, w);
    this.list.speedpad.push({ f, half: w / 2, cd: 0 });
  }
  add_bonus(h, s, i) {
    const f = frameAt(s, h.at, h.x);
    const grp = new THREE.Group(); grp.position.copy(f.pos); grp.quaternion.copy(frameQuat(f)); this.group.add(grp);
    this.mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.1, 28), this.mat({ color: 0x1b1f3b, roughness: 0.6 }), grp).position.y = 0.05;
    const capMat = this.mat({ color: 0xff3b4e, roughness: 0.35, emissive: 0xff3b4e, emissiveIntensity: 0.25 });
    const topMat = this.mat({ map: this.T.pad_bonus, transparent: true, roughness: 0.4 });
    const btn = this.mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.14, 28), [capMat, topMat, capMat], grp);
    btn.position.y = 0.16;
    this.list.bonus.push({ f, grp, btn, capMat, used: false, seconds: h.seconds || 5, press: 0 });
  }

  // ---------- tube ----------
  addTube(s, i) {
    const a = poseAt(s, 0), b = poseAt(s, 1);
    const S = new THREE.Vector3(a.x, a.y + 1.2, a.z), E = new THREE.Vector3(b.x, b.y + 1.2, b.z);
    const axis = E.clone().sub(S), len = axis.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    const glass = this.own(new THREE.MeshPhysicalMaterial({ color: 0xbff1ff, transparent: true, opacity: 0.28, roughness: 0.08, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5 }));
    const tube = this.mesh(new THREE.CylinderGeometry(1.5, 1.5, len, 32, 1, true), glass);
    tube.position.copy(S).add(E).multiplyScalar(0.5); tube.quaternion.copy(q); tube.castShadow = false; tube.renderOrder = 9;
    const rimM = this.mat({ color: this.lv.theme.rail, roughness: 0.4, metalness: 0.3 });
    const bandGeo = this.own(new THREE.TorusGeometry(1.52, 0.09, 8, 40));
    const nb = Math.max(2, Math.round(len / 4));
    for (let k = 0; k <= nb; k++) {
      const r = new THREE.Mesh(bandGeo, k === 0 || k === nb ? rimM : glass);
      r.position.lerpVectors(S, E, k / nb); r.quaternion.copy(q).multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      if (k === 0 || k === nb) r.scale.setScalar(1.04);
      this.group.add(r);
    }
    const d = dirOf(a.h);
    this.tubes.push({ seg: i, s, a: new THREE.Vector3(a.x, a.y, a.z), b: new THREE.Vector3(b.x, b.y, b.z), dir: d, right: rightOf(a.h), len });
  }

  // ---------- lift (vacuum) ----------
  addLift(s, i) {
    const base = frameAt(s, 0.5), h = s.drop;
    base.pos.y = s.start.y; // the lift floor sits at the bottom; drop is the lift height
    const glass = this.own(new THREE.MeshBasicMaterial({ color: 0x7fdbff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const cyl = this.mesh(new THREE.CylinderGeometry(1.35, 1.35, h + 2.6, 32, 1, true), glass);
    cyl.position.copy(base.pos).y += (h + 2.6) / 2; cyl.castShadow = false; cyl.renderOrder = 9;
    const rimM = this.mat({ color: 0x7fdbff, emissive: 0x7fdbff, emissiveIntensity: 0.9 });
    for (const y of [0.05, h + 2.6]) {
      const r = this.mesh(new THREE.TorusGeometry(1.38, 0.08, 8, 40), rimM); r.rotation.x = Math.PI / 2; r.position.copy(base.pos).y += y; r.castShadow = false;
    }
    // rising particles
    const n = 60, pos = new Float32Array(n * 3), seeds = [];
    for (let k = 0; k < n; k++) seeds.push({ a: rand(0, 6.28), r: rand(0.2, 1.2), y: rand(0, h + 2.6), sp: rand(2, 5) });
    const geo = this.own(new THREE.BufferGeometry()); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, this.own(new THREE.PointsMaterial({ map: this.T.soft_dot, size: 0.25, color: 0xcff6ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })));
    pts.position.copy(base.pos); pts.frustumCulled = false; this.group.add(pts);
    const next = this.lv.segs[i + 1];
    const nf = next ? frameAt(next, Math.min(0.45, 1.5 / Math.max(1, segLen(next))), 0) : frameAt(s, 1);
    const loop = this.g.audio.loop('vacuum_loop', { vol: 0.25, pos: base.pos });
    this.loops.push(loop);
    this.lifts.push({ seg: i, base, h, pts, seeds, geo, exit: nf.pos.clone().addScaledVector(nf.up, 0.55), exitDir: nf.dir.clone(), loop });
  }

  // ======================= simulation =======================
  /** Kinematic poses for the upcoming step (time t = time after the step). */
  stepKinematics(t, dt) {
    for (const sp of this.list.spinner) {
      _q.setFromAxisAngle(sp.f.up, sp.speed * t);
      sp.body.setNextKinematicRotation(_q2.copy(_q).multiply(sp.baseQ));
    }
    for (const hm of this.list.hammer) {
      const { y, c } = this.hammerHeight(hm, t);
      const p = hm.f.pos.clone().addScaledVector(hm.f.up, y + 0.6);
      hm.body.setNextKinematicTranslation(p);
      if (hm.lastC < 0.76 && c >= 0.76) this.onSlam(hm);
      hm.lastC = c;
    }
    for (const m of this.list.mover) {
      const prev = m.pos.clone();
      this.moverPos(m, t, m.pos);
      m.body.setNextKinematicTranslation(m.pos);
      m.vel.subVectors(m.pos, prev).divideScalar(dt);
    }
  }

  onSlam(hm) {
    const g = this.g, pl = g.player;
    g.audio.play('hammer_slam', { vol: 0.9, pos: hm.f.pos });
    const d = pl ? pl.pos.distanceTo(hm.f.pos) : 99;
    if (d < 16) g.cam.shake(0.35 * (1 - d / 16));
    g.fx.dust(hm.f.pos.clone().addScaledVector(hm.f.up, 0.1), 12, 0xd9cdb8);
  }

  /** Post-physics trigger checks against the player. */
  check(t, dt) {
    const g = this.g, pl = g.player;
    const alive = pl.alive && !pl.transport;
    const P = pl.pos, vel = pl.vel;

    // Checkpoints
    for (const cp of this.checkpoints) {
      if (cp.passed || !alive) continue;
      const l = local(cp.f, P);
      if (l.f > -0.2 && l.f < 5 && Math.abs(l.r) < cp.hw + 0.6 && l.u > -1 && l.u < 3.5) {
        cp.passed = true; cp.pulse = 1;
        g.onCheckpoint(cp);
      }
    }
    // Goal
    if (this.goal && alive) {
      const l = local(this.goal.f, P);
      if (Math.hypot(l.f, l.r) < 3 && l.u > -0.5 && l.u < 2) g.onGoal();
    }
    // Bumpers
    for (const b of this.list.bumper) {
      b.cd -= dt;
      if (!alive) continue;
      const dx = P.x - b.f.pos.x, dz = P.z - b.f.pos.z, d = Math.hypot(dx, dz), dy = P.y - b.f.pos.y;
      if (d < b.R + 0.5 + 0.06 && dy > -0.3 && dy < 1.4 && b.cd <= 0) {
        b.cd = 0.18; b.pop = 0;
        const nx = dx / (d || 1), nz = dz / (d || 1);
        pl.setVelocity(nx * 12, Math.max(vel.y, 1.5), nz * 12);
        g.audio.play('bumper', { vol: 0.9, pos: b.f.pos, rate: rand(0.95, 1.08) });
        g.fx.sparkle(P.clone(), 5, 0.4, 0xff9ec0);
      }
    }
    // Saws
    for (const sw of this.list.saw) {
      if (!alive || pl.invuln > 0) continue;
      const c = this.sawCenter(sw, t, _r.clone());
      const rel = P.clone().sub(c);
      const along = rel.dot(sw.f.fwd), lr = rel.dot(sw.f.right), lu = rel.dot(sw.f.up);
      if (Math.abs(along) < 0.52 && Math.hypot(lr, lu) < 1.28) pl.breakBall('saw');
    }
    // Hammers
    for (const hm of this.list.hammer) {
      if (!alive || pl.invuln > 0) continue;
      const { y, falling, c } = this.hammerHeight(hm, t);
      if (!(falling || (c >= 0.76 && c < 0.78))) continue;
      const l = local(hm.f, P);
      if (Math.abs(l.r) < 1.35 && Math.abs(l.f) < 1.35 && pl.grounded && y < l.u + 0.55 && l.u < 1.6) pl.breakBall('hammer');
    }
    // Launchers
    for (const ln of this.list.launcher) {
      ln.cd -= dt;
      if (!alive || ln.cd > 0) continue;
      const l = local(ln.f, P);
      if (Math.abs(l.f) < 1.2 && Math.abs(l.r) < 1.2 && l.u < 1.1 && l.u > -0.3) {
        ln.cd = 1.2; ln.kick = 1;
        const tgt = ln.target, y0 = P.y, apex = Math.max(y0, tgt.y) + 3;
        const vy = Math.sqrt(2 * GRAVITY * (apex - y0));
        const T = vy / GRAVITY + Math.sqrt((2 * (apex - tgt.y)) / GRAVITY);
        pl.launch(new THREE.Vector3(((tgt.x - P.x) / T) * ln.power, vy * ln.power, ((tgt.z - P.z) / T) * ln.power));
        g.audio.play('launcher', { vol: 0.9 });
        g.fx.dust(ln.f.pos.clone(), 10, 0xffd08a);
      }
    }
    // Speed pads
    for (const sp of this.list.speedpad) {
      sp.cd -= dt;
      if (!alive || sp.cd > 0) continue;
      const l = local(sp.f, P);
      if (Math.abs(l.f) < sp.half + 0.25 && Math.abs(l.r) < sp.half + 0.25 && l.u < 1 && l.u > -0.3) {
        sp.cd = 0.45;
        const d = sp.f.dir, along = vel.x * d.x + vel.z * d.z;
        const latX = vel.x - d.x * along, latZ = vel.z - d.z * along;
        const na = Math.min(14, Math.max(along, 0) + 9);
        pl.setVelocity(d.x * na + latX * 0.4, vel.y, d.z * na + latZ * 0.4);
        g.audio.play('launcher', { vol: 0.45, rate: 1.5 });
        for (let k = 0; k < 8; k++) g.fx.streak(P.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.2, 0.3), rand(-0.4, 0.4))), d.clone().multiplyScalar(-20));
      }
    }
    // Bonus buttons
    for (const bn of this.list.bonus) {
      if (bn.used || !alive) continue;
      const l = local(bn.f, P);
      if (Math.hypot(l.f, l.r) < 0.95 && l.u < 1.2 && l.u > -0.3) {
        bn.used = true; bn.press = 1;
        bn.capMat.color.set(0x8a8fa3); bn.capMat.emissiveIntensity = 0;
        g.onBonus(bn.seconds, bn.f.pos.clone().addScaledVector(bn.f.up, 1));
      }
    }
    // Tubes
    for (const tb of this.tubes) {
      if (!alive) continue;
      const rel = P.clone().sub(tb.a);
      const lf = rel.dot(tb.dir), lr = rel.dot(tb.right);
      if (lf > -0.4 && lf < 1.8 && Math.abs(lr) < 1.5 && rel.y > -0.6 && rel.y < 2.6) {
        const S = tb.a.clone().addScaledVector(tb.dir, 0.3).setY(tb.a.y + 0.55);
        const E = tb.b.clone().setY(tb.b.y + 0.55), X = tb.b.clone().addScaledVector(tb.dir, 1.0).setY(tb.b.y + 0.55);
        const dur = Math.max(1.2, tb.len / 12);
        pl.startTransport([{ p: P.clone(), t: 0 }, { p: S, t: 0.15 }, { p: E, t: 0.15 + dur }, { p: X, t: 0.3 + dur }], tb.dir.clone().multiplyScalar(8), 'tube');
        g.audio.play('fall_whoosh', { vol: 0.5, rate: 1.3 });
      }
    }
    // Lifts
    for (const lf of this.lifts) {
      if (!alive) continue;
      const dx = P.x - lf.base.pos.x, dz = P.z - lf.base.pos.z, dy = P.y - lf.base.pos.y;
      if (Math.hypot(dx, dz) < 1.4 && dy > -0.2 && dy < 1.6) {
        const B = lf.base.pos.clone().setY(lf.base.pos.y + 0.55), C = lf.base.pos.clone().setY(lf.base.pos.y + lf.h + 1.1);
        pl.startTransport([{ p: P.clone(), t: 0 }, { p: B, t: 0.25 }, { p: C, t: 1.45 }, { p: lf.exit.clone(), t: 1.85 }], lf.exitDir.clone().multiplyScalar(3), 'lift');
        lf.loop.setVol(1.1, 0.1); lf.active = 1.9;
      }
    }
  }

  /** Rival AI + knock-off detection (physics rate, before world.step). */
  stepRivals(t, dt) {
    const g = this.g, pl = g.player;
    for (const r of this.list.rival) {
      if (r.dead > 0) {
        r.dead -= dt;
        if (r.dead <= 0) this.spawnRival(r);
        continue;
      }
      const b = r.body, p = b.translation(), v = b.linvel();
      if (p.y < g.level.data.killY) {
        const credited = t - r.lastTouch < 6;
        r.mesh.visible = false; r.dead = 4;
        this.world.removeRigidBody(b); r.body = null;
        if (credited) g.onRivalKnocked(new THREE.Vector3(p.x, p.y, p.z));
        continue;
      }
      const P = pl.pos;
      const dx = P.x - p.x, dz = P.z - p.z, dist = Math.hypot(dx, dz), dy = Math.abs(P.y - p.y);
      if (dist < 1.2 && dy < 1.2 && pl.alive) {
        r.lastTouch = t;
        r.touchCd -= dt;
        if (r.touchCd <= 0) { r.touchCd = 0.35; }
      }
      let tx = 0, tz = 0;
      // Rams come in bursts (charge ≤ 1.6 s, then ~1 s to recover) so a narrow ledge never deadlocks.
      r.rest = Math.max(0, (r.rest || 0) - dt);
      const chase = pl.alive && !pl.transport && dist < 7 && dy < 2.5 && g.state === 'racing' && r.rest <= 0;
      if (chase) {
        r.ram = (r.ram || 0) + dt;
        if (r.ram > 1.6) { r.ram = 0; r.rest = 1 + Math.random() * 0.4; }
        tx = (dx / (dist || 1)) * 7; tz = (dz / (dist || 1)) * 7;
      } else if (r.rest > 0) { r.ram = 0; }
      else {
        const hx = r.home.x - p.x, hz = r.home.z - p.z, hd = Math.hypot(hx, hz);
        if (hd > 0.3) { const sp = Math.min(3.2, hd * 1.5); tx = (hx / hd) * sp; tz = (hz / hd) * sp; }
      }
      const maxA = (chase ? 14 : r.rest > 0 ? 5 : 10) * dt;
      let ax = tx - v.x, az = tz - v.z; const al = Math.hypot(ax, az);
      if (al > maxA) { ax *= maxA / al; az *= maxA / al; }
      const m = b.mass();
      b.applyImpulse({ x: ax * m, y: 0, z: az * m }, true);
    }
  }

  // ======================= rendering =======================
  render(t, dt, alpha) {
    const g = this.g;
    for (const cp of this.checkpoints) {
      cp.pulse = Math.max(0, cp.pulse - dt * 1.2);
      const k = cp.pulse;
      cp.grp.scale.setScalar(1 + k * 0.25);
      cp.glowMat.opacity = (cp.passed ? 0.12 : 0.25 + Math.sin(t * 4) * 0.08) + k * 0.6;
      cp.ringMat.color.set(cp.passed ? 0x9ad7ff : 0x5cc8ff);
    }
    if (this.goal) {
      const gl = this.goal;
      gl.beam.material.opacity = 0.13 + Math.sin(t * 3) * 0.04;
      gl.ring.scale.setScalar(1 + Math.sin(t * 2.4) * 0.03);
      gl.t += dt;
      if (gl.t > 0.08) { gl.t = 0; g.fx.sparkle(gl.f.pos.clone().setY(gl.f.pos.y + 0.3), 1, 2.6); }
    }
    for (const b of this.list.bumper) {
      b.pop = Math.min(1, b.pop + dt / 0.2);
      const s = 1.3 - 0.3 * smooth(b.pop);
      b.cyl.scale.set(s, 1 + (s - 1) * 0.5, s); // group carries the size; this is the pop
      b.side.emissiveIntensity = 0.15 + (1 - b.pop) * 1.6;
      b.top.emissiveIntensity = 0.1 + (1 - b.pop) * 0.9;
    }
    for (const r of this.list.rival) {
      if (!r.body) continue;
      const p = r.body.translation(), q = r.body.rotation();
      r.mesh.position.set(p.x, p.y, p.z); r.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    for (const sp of this.list.spinner) {
      _q.setFromAxisAngle(sp.f.up, sp.speed * t);
      sp.grp.quaternion.copy(_q).multiply(sp.baseQ);
    }
    for (const hm of this.list.hammer) {
      const { y, c } = this.hammerHeight(hm, t);
      hm.grp.position.copy(hm.f.pos).addScaledVector(hm.f.up, y + 0.6);
      hm.warn.material.opacity = c > 0.45 && c < 0.8 ? 0.35 + 0.4 * Math.abs(Math.sin(t * 14)) : 0.3;
      hm.glow.emissiveIntensity = c > 0.45 && c < 0.76 ? 0.6 + 1.6 * Math.abs(Math.sin(t * 14)) : 0.4;
      // Fade the block while it sits between the camera and the ball.
      const blocking = segPointDist(g.camera.position, g.player.renderPos, hm.grp.position) < 1.9;
      hm.alpha += ((blocking ? 0.28 : 1) - hm.alpha) * (1 - Math.exp(-10 * dt || 0));
      for (const m of hm.fadeMats) { m.opacity = hm.alpha; m.depthWrite = hm.alpha > 0.95; }
    }
    for (const sw of this.list.saw) {
      this.sawCenter(sw, t, sw.grp.position);
      sw.spin.rotation.x = -t * 16;
      sw.teethM.emissiveIntensity = 1.2 + Math.sin(t * 10) * 0.6;
      sw.loop.setPos(sw.grp.position);
    }
    for (const m of this.list.mover) this.moverPos(m, t, m.grp.position);
    for (const ln of this.list.launcher) {
      ln.kick = Math.max(0, ln.kick - dt * 3);
      ln.plate.material.opacity = ln.kick * 0.9;
      ln.plate.position.copy(ln.f.pos).addScaledVector(ln.f.up, 0.05 + Math.sin((1 - ln.kick) * Math.PI) * 0.4 * (ln.kick > 0 ? 1 : 0));
    }
    for (const bn of this.list.bonus) {
      if (bn.used) bn.btn.position.y = Math.max(0.08, bn.btn.position.y - dt * 0.6);
      else bn.btn.position.y = 0.16 + Math.sin(t * 5) * 0.02;
    }
    for (const lf of this.lifts) {
      const a = lf.geo.attributes.position, H = lf.h + 2.6;
      lf.seeds.forEach((s, k) => {
        s.y += s.sp * dt; if (s.y > H) s.y -= H;
        s.a += dt * 1.5;
        a.setXYZ(k, Math.cos(s.a) * s.r, s.y, Math.sin(s.a) * s.r);
      });
      a.needsUpdate = true;
      if (lf.active > 0) { lf.active -= dt; if (lf.active <= 0) lf.loop.setVol(0.25, 0.3); }
    }
  }

  reset() {
    for (const bn of this.list.bonus) { bn.used = false; bn.btn.position.y = 0.16; bn.capMat.color.set(0xff3b4e); bn.capMat.emissiveIntensity = 0.25; }
  }

  dispose() {
    for (const l of this.loops) l.stop();
    this.loops.length = 0;
  }
}
