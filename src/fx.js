// Pooled sprite particles: dust, sparkles, glass shards, speed streaks, dizzy stars.
import * as THREE from 'three';
import { rand } from './util.js';

const POOL = 240;

export class FX {
  constructor(scene, tex) {
    this.scene = scene;
    this.tex = tex; // {dust, sparkle, shard, dot, star}
    this.free = [];
    this.live = [];
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
      const s = new THREE.Sprite(m);
      s.visible = false; s.renderOrder = 20;
      scene.add(s);
      this.free.push({ s, v: new THREE.Vector3(), life: 0, max: 1, size0: 1, size1: 1, g: 0, drag: 0, spin: 0, a0: 1 });
    }
  }

  spawn(kind, pos, vel, o = {}) {
    const p = this.free.pop() || this.live.shift();
    if (!p) return;
    const m = p.s.material;
    m.map = this.tex[kind] || this.tex.dot;
    m.color.set(o.color ?? 0xffffff);
    m.blending = o.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.rotation = o.rot ?? rand(0, Math.PI * 2);
    m.needsUpdate = true;
    p.s.position.copy(pos);
    p.v.copy(vel);
    p.life = 0; p.max = o.life ?? 0.8;
    p.size0 = o.size ?? 0.5; p.size1 = o.sizeEnd ?? p.size0;
    p.g = o.gravity ?? 0; p.drag = o.drag ?? 0; p.spin = o.spin ?? 0; p.a0 = o.opacity ?? 1;
    p.s.visible = true;
    this.live.push(p);
  }

  dust(pos, n = 10, color = 0xf3e7cf) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(1.8, 3.4);
      this.spawn('dust', pos, new THREE.Vector3(Math.cos(a) * sp, rand(0.4, 1.4), Math.sin(a) * sp),
        { life: rand(0.45, 0.7), size: rand(0.35, 0.55), sizeEnd: rand(0.9, 1.3), drag: 3, opacity: 0.85, color });
    }
  }
  shards(pos, n = 22) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8));
      this.spawn('shard', pos, v, { life: rand(0.8, 1.3), size: rand(0.18, 0.38), sizeEnd: 0.1, gravity: 16, spin: rand(-12, 12), color: 0xbff1ff });
    }
  }
  sparkle(pos, n = 1, spread = 1, color = 0xffe28a) {
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(new THREE.Vector3(rand(-spread, spread), rand(0, spread * 0.6), rand(-spread, spread)));
      this.spawn('sparkle', p, new THREE.Vector3(0, rand(0.6, 1.6), 0), { life: rand(0.6, 1.1), size: rand(0.2, 0.45), sizeEnd: 0.02, spin: rand(-3, 3), additive: true, color });
    }
  }
  streak(pos, vel) {
    this.spawn('dot', pos, vel.clone().multiplyScalar(-0.15), { life: 0.3, size: 0.28, sizeEnd: 0.05, additive: true, opacity: 0.7, color: 0xbff1ff });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      if (p.life >= p.max) { p.s.visible = false; this.live.splice(i, 1); this.free.push(p); continue; }
      const t = p.life / p.max;
      p.v.y -= p.g * dt;
      if (p.drag) p.v.multiplyScalar(Math.exp(-p.drag * dt));
      p.s.position.addScaledVector(p.v, dt);
      const sz = p.size0 + (p.size1 - p.size0) * t;
      p.s.scale.set(sz, sz, 1);
      p.s.material.rotation += p.spin * dt;
      p.s.material.opacity = p.a0 * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    }
  }

  clear() {
    for (const p of this.live) { p.s.visible = false; this.free.push(p); }
    this.live.length = 0;
  }
}
