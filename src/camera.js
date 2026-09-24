// CameraRig: fixed-angle chase at offset (0, 9, 9) rotated to the section's forward yaw, re-oriented only
// at checkpoints (1 s lerp). Critically damped follow, speed pull-back, portrait-aware framing,
// anti-clipping ray, screen shake.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { DEG, angDiff, smooth, clamp, rand } from './util.js';

const OMEGA = 9;

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0; this.yawFrom = 0; this.yawTo = 0; this.yawT = 1;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shakeAmt = 0; this.reduced = false;
    this.speedK = 1;
  }
  setYaw(y, instant = false) {
    if (instant) { this.yaw = this.yawFrom = this.yawTo = y; this.yawT = 1; return; }
    if (Math.abs(angDiff(this.yawTo, y)) < 0.5) return;
    this.yawFrom = this.yaw; this.yawTo = y; this.yawT = 0;
  }
  shake(a) { if (!this.reduced) this.shakeAmt = Math.min(1, this.shakeAmt + a); }

  /** Framing scale for narrow (portrait) screens. */
  aspectK() { return 1; } // portrait widens the FOV instead (see fovFor) so the ball stays big

  desired(target, out) {
    const h = this.yaw * DEG, fx = Math.sin(h), fz = -Math.cos(h);
    const k = this.aspectK() * this.speedK;
    return out.set(target.x - fx * 9 * k, target.y + 9 * k, target.z - fz * 9 * k);
  }

  snap(target) {
    this.desired(target, this.pos); this.vel.set(0, 0, 0);
    this.look.copy(target);
    this.apply(null, null);
  }

  update(dt, target, speed, world) {
    if (this.yawT < 1) {
      this.yawT = Math.min(1, this.yawT + dt / 1.0);
      this.yaw = this.yawFrom + angDiff(this.yawFrom, this.yawTo) * smooth(this.yawT);
    }
    this.speedK += ((1 + clamp(speed / 14, 0, 1) * 0.18) - this.speedK) * (1 - Math.exp(-2 * dt));
    const des = this.desired(target, _d);
    // Critically damped spring, sub-stepped for stability.
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      _a.subVectors(des, this.pos).multiplyScalar(OMEGA * OMEGA).addScaledVector(this.vel, -2 * OMEGA);
      this.vel.addScaledVector(_a, h);
      this.pos.addScaledVector(this.vel, h);
    }
    const hh = this.yaw * DEG;
    _l.set(target.x + Math.sin(hh) * 1.5, target.y, target.z - Math.cos(hh) * 1.5);
    this.look.lerp(_l, 1 - Math.exp(-14 * dt));
    this.shakeAmt *= Math.exp(-5 * dt);
    this.apply(world, target);
  }

  apply(world, target) {
    const c = this.cam;
    c.position.copy(this.pos);
    // Never clip into/under the course: pull in front of any static geometry between ball and camera.
    if (world && target) {
      _dir.subVectors(this.pos, target); const dist = _dir.length(); _dir.divideScalar(dist || 1);
      const hit = world.castRay(new RAPIER.Ray(target, _dir), dist, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      if (hit) {
        const toi = hit.timeOfImpact ?? hit.toi;
        if (toi > 0.8) c.position.copy(target).addScaledVector(_dir, toi - 0.4);
      }
    }
    if (this.shakeAmt > 0.001 && !this.reduced) {
      const s = this.shakeAmt * 0.5;
      c.position.x += rand(-s, s); c.position.y += rand(-s, s); c.position.z += rand(-s, s);
    }
    c.lookAt(this.look);
  }

  /** Vertical FOV that keeps a sane horizontal view on portrait phones. */
  static fovFor(aspect) {
    if (aspect >= 1) return 50;
    const v = 2 * Math.atan(Math.tan((40 * DEG) / 2) / aspect) / DEG;
    return clamp(v, 50, 64);
  }
}
const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _l = new THREE.Vector3(), _dir = new THREE.Vector3();
