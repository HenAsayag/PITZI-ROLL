// Pitzi: a procedural low-poly hamster matching assets/ui/pitzi_idle. Stays upright, yaws toward travel,
// run cycle ∝ rolling speed, expressions: normal / dizzy (spiral eyes + orbiting stars) / happy (arc eyes + hop).
import * as THREE from 'three';
import { damp, angDiff, DEG } from './util.js';

const ORANGE = 0xf4a259, DARK = 0xd9823b, CREAM = 0xfff1dc, PINK = 0xff8fb1, NAVY = 0x1b1f3b;

function eyeTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (kind === 'normal') {
    const grd = g.createRadialGradient(56, 54, 6, 64, 66, 60);
    grd.addColorStop(0, '#2c3160'); grd.addColorStop(1, '#10132a');
    g.fillStyle = grd; g.beginPath(); g.ellipse(64, 64, 52, 58, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(80, 42, 15, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(50, 86, 7, 0, Math.PI * 2); g.fill();
  } else if (kind === 'dizzy') {
    g.strokeStyle = '#1B1F3B'; g.lineWidth = 11; g.beginPath();
    for (let a = 0; a < Math.PI * 5.2; a += 0.1) { const r = 4 + a * 3.3; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.stroke();
  } else {
    g.strokeStyle = '#1B1F3B'; g.lineWidth = 16; g.beginPath(); g.arc(64, 84, 38, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let EYES = null;

export class Hamster {
  constructor({ starTex = null, lowPoly = false } = {}) {
    if (!EYES) EYES = { normal: eyeTexture('normal'), dizzy: eyeTexture('dizzy'), happy: eyeTexture('happy') };
    const seg = lowPoly ? [10, 8] : [16, 12];
    const mats = {
      orange: new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.75 }),
      dark: new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.75 }),
      cream: new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.8 }),
      pink: new THREE.MeshStandardMaterial({ color: PINK, roughness: 0.6 }),
      nose: new THREE.MeshStandardMaterial({ color: 0xff5c8a, roughness: 0.3 }),
      eye: new THREE.MeshStandardMaterial({ map: EYES.normal, alphaTest: 0.5, roughness: 0.15, metalness: 0.1, side: THREE.DoubleSide }),
    };
    this.mats = mats;
    const sph = (r) => new THREE.SphereGeometry(r, seg[0], seg[1]);
    const part = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
      m.castShadow = true; (parent || this.body).add(m); return m;
    };

    this.group = new THREE.Group();      // positioned at ball center, yawed
    this.lean = new THREE.Group();       // leans into the run
    this.body = new THREE.Group();       // bob / squash / hop
    this.group.add(this.lean); this.lean.add(this.body);
    this.body.position.y = -0.08;

    part(sph(0.27), mats.orange, 0, 0, 0, 1, 1.08, 0.95);                       // round body+head
    part(sph(0.2), mats.cream, 0, -0.1, 0.1, 1, 0.95, 0.72);                      // belly
    part(sph(0.085), mats.cream, 0, -0.005, 0.215, 1.35, 0.85, 0.72);             // muzzle
    part(sph(0.021), mats.nose, 0, 0.038, 0.27);                                   // nose
    part(sph(0.032), mats.cream, 0, 0.215, 0.18, 0.75, 2.1, 0.5).rotation.x = -0.6; // forehead stripe
    part(sph(0.045), mats.pink, 0.155, 0.0, 0.2, 1.1, 0.7, 0.35).rotation.y = 0.75;  // cheeks
    part(sph(0.045), mats.pink, -0.155, 0.0, 0.2, 1.1, 0.7, 0.35).rotation.y = -0.75;
    this.ears = [1, -1].map((s) => {
      const e = new THREE.Group(); e.position.set(0.155 * s, 0.245, -0.03); e.rotation.z = -0.3 * s; this.body.add(e);
      part(sph(0.078), mats.dark, 0, 0, 0, 1, 1, 0.45, e);
      part(sph(0.047), mats.pink, 0, 0.004, 0.022, 1, 1, 0.3, e);
      return e;
    });
    const eyeGeo = new THREE.PlaneGeometry(0.075, 0.08);
    this.eyes = [1, -1].map((s) => {
      const e = new THREE.Mesh(eyeGeo, mats.eye); e.position.set(0.092 * s, 0.075, 0.243); e.rotation.y = 0.36 * s; e.rotation.x = -0.12;
      this.body.add(e); return e;
    });
    this.hands = [1, -1].map((s) => part(sph(0.045), mats.dark, 0.125 * s, -0.11, 0.2, 1, 0.85, 1));
    this.feet = [1, -1].map((s) => part(sph(0.055), mats.pink, 0.1 * s, -0.3, 0.07, 1, 0.55, 1.35));
    part(sph(0.04), mats.dark, 0, -0.17, -0.25);                                   // tail

    this.handBase = this.hands.map((h) => h.position.clone());
    this.footBase = this.feet.map((f) => f.position.clone());

    // Dizzy stars orbit above the ball (outside the glass so they are always visible).
    this.stars = [];
    if (starTex) {
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false }));
        s.scale.setScalar(0.28); s.visible = false; s.renderOrder = 15;
        this.group.add(s); this.stars.push(s);
      }
    }
    this.phase = 0; this.t = 0; this.yaw = 0;
    this.squash = 0; this.squashV = 0; this.hop = 0; this.blink = 2;
    this.expr = 'normal';
  }

  setExpression(e) {
    if (e === this.expr) return;
    this.expr = e;
    this.mats.eye.map = EYES[e] || EYES.normal;
    this.mats.eye.needsUpdate = true;
    for (const s of this.stars) s.visible = e === 'dizzy';
    if (e !== 'dizzy') for (const eye of this.eyes) eye.rotation.z = 0;
    if (e === 'happy') this.hop = 0.001;
  }

  /** Landing squash; strength 0..1. */
  land(strength) { this.squashV -= 6 * strength; }

  /** vel: world velocity (THREE.Vector3) or null; worldYaw: current parent yaw offset (menu). */
  update(dt, vel, grounded = true) {
    this.t += dt;
    const speed = vel ? Math.hypot(vel.x, vel.z) : 0;
    if (vel && speed > 0.6) {
      const target = Math.atan2(vel.x, vel.z) / DEG;
      this.yaw += angDiff(this.yaw, target) * (1 - Math.exp(-8 * dt));
    }
    this.group.rotation.set(0, this.yaw * DEG, 0);

    // Run cycle: phase advances with ball rotation (ω = v / r).
    const amt = Math.min(1, speed / 5);
    this.phase += dt * speed * 2.0 * (grounded ? 1 : 0.4);
    const ph = this.phase;
    this.feet.forEach((f, i) => {
      const o = i ? Math.PI : 0, b = this.footBase[i];
      f.position.set(b.x, b.y + Math.max(0, Math.sin(ph + o + Math.PI / 2)) * 0.045 * amt, b.z + Math.sin(ph + o) * 0.075 * amt);
    });
    this.hands.forEach((h, i) => {
      const o = i ? 0 : Math.PI, b = this.handBase[i];
      h.position.set(b.x, b.y + Math.cos(ph + o) * 0.02 * amt, b.z + Math.sin(ph + o) * 0.045 * amt);
    });
    this.ears.forEach((e, i) => {
      const s = i ? -1 : 1;
      e.rotation.z = -s * (0.3 + Math.sin(ph * 2 + i) * 0.22 * amt + (grounded ? 0 : 0.35));
      e.rotation.x = -0.25 * amt;
    });
    this.lean.rotation.x = damp(this.lean.rotation.x, 0.28 * amt, 6, dt);

    // Squash-stretch spring (landings) + bob + hop.
    this.squashV += (-80 * this.squash - 9 * this.squashV) * dt;
    this.squash += this.squashV * dt;
    const breathe = speed < 0.3 ? Math.sin(this.t * 2.2) * 0.015 : 0;
    const sq = Math.max(-0.35, Math.min(0.3, this.squash));
    this.body.scale.set(1 - sq * 0.6, 1 + sq + breathe, 1 - sq * 0.6);
    let y = -0.08 + Math.abs(Math.sin(ph)) * 0.028 * amt;
    if (this.expr === 'happy') { this.hop += dt; y += Math.abs(Math.sin(this.hop * 7)) * 0.1; }
    this.body.position.y = y;

    // Eyes: blink, spiral spin while dizzy.
    this.blink -= dt;
    let eyeSy = 1;
    if (this.expr === 'normal') {
      if (this.blink < 0) { eyeSy = 0.1; if (this.blink < -0.12) this.blink = 2 + Math.random() * 3; }
    }
    for (const e of this.eyes) { e.scale.y = eyeSy; if (this.expr === 'dizzy') e.rotation.z += dt * 9; }

    if (this.expr === 'dizzy') {
      this.stars.forEach((s, i) => {
        const a = this.t * 4 + (i * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.38, 0.68 + Math.sin(this.t * 6 + i) * 0.04, Math.sin(a) * 0.38);
        s.material.rotation = this.t * 3 + i;
      });
    }
  }
}
