// Player: Rapier ball (r 0.5, CCD) + glass visuals + Pitzi inside + shadow blob. Handles screen-relative
// control, brake, surfaces, landings/dizzy, bumps, break/respawn and tube/lift transport.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { Hamster } from './hamster.js';
import { clamp, rand, GRAVITY, DEG } from './util.js';

export const BALL_MASS = 2.4;           // collision weight (rival is ×1.4); steering uses ACCEL directly
const MAX_SPEED = 11.5, AIR_CONTROL = 0.35;
// Arcade handling (Hamsterball-style): direct acceleration, quick turn/reversal assist, spin kept in sync
// with travel so old momentum does not drag the ball through corners. Ice skips the assists.
const ACCEL = 34, TURN_GRIP = 6, REVERSE_GRIP = 5, SPIN_SYNC = 22;
const DOWN = { x: 0, y: -1, z: 0 };

export function makeBallMaterial(T, high) {
  return high
    ? new THREE.MeshPhysicalMaterial({
      color: 0xf4fdff, transmission: 0.9, thickness: 0.3, ior: 1.3, roughness: 0.1, roughnessMap: T.ball_roughness,
      clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0, attenuationColor: new THREE.Color(0x9fe6ff), attenuationDistance: 2.5, envMapIntensity: 1.3,
    })
    : new THREE.MeshPhysicalMaterial({
      color: 0xbfefff, transparent: true, opacity: 0.24, roughness: 0.08, roughnessMap: T.ball_roughness,
      clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, envMapIntensity: 1.5,
    });
}

/** Glass ball + seam shell (rotating) with an upright hamster inside. Used by the race and the menu diorama. */
export class BallVisual {
  constructor(T, high) {
    this.group = new THREE.Group();
    this.roll = new THREE.Group();
    this.group.add(this.roll);
    this.ballGeo = new THREE.SphereGeometry(0.5, 48, 32);
    this.ball = new THREE.Mesh(this.ballGeo, makeBallMaterial(T, high));
    this.ball.renderOrder = 5;
    this.seam = new THREE.Mesh(new THREE.SphereGeometry(0.507, 48, 32),
      new THREE.MeshStandardMaterial({ map: T.ball_seam, color: 0xd9f6ff, transparent: true, depthWrite: false, roughness: 0.3 }));
    this.seam.renderOrder = 6;
    this.roll.add(this.ball, this.seam);
    this.hamster = new Hamster({ starTex: T.star_dizzy });
    this.group.add(this.hamster.group);
    this.T = T;
  }
  setQuality(high) {
    this.ball.material.dispose();
    this.ball.material = makeBallMaterial(this.T, high);
  }
}

export class Player {
  constructor(game) {
    this.g = game;
    this.vis = new BallVisual(game.tex, game.quality === 'high');
    game.scene.add(this.vis.group);
    this.hamster = this.vis.hamster;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: game.tex.shadow_blob, transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.shadow.renderOrder = 3;
    game.scene.add(this.shadow);
    this.mass = BALL_MASS;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3(); this.curPos = new THREE.Vector3();
    this.prevQ = new THREE.Quaternion(); this.curQ = new THREE.Quaternion();
    this.renderPos = new THREE.Vector3();
    this.vPrev = new THREE.Vector3();
    this.body = null;
    this.alive = true;
  }

  attach(world, pose) {
    this.world = world;
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.pos.x, pose.pos.y, pose.pos.z).setCcdEnabled(true).setLinearDamping(0.15).setAngularDamping(0.4));
    const vol = (4 / 3) * Math.PI * 0.125;
    this.collider = world.createCollider(RAPIER.ColliderDesc.ball(0.5).setRestitution(0.25).setFriction(1.0).setDensity(BALL_MASS / vol), b);
    this.body = b;
    this.spawn(pose);
    if (!this.rollLoop) this.rollLoop = this.g.audio.loop('roll_loop', { vol: 0 });
  }
  detach() { this.body = null; this.world = null; this.transport = null; this.rollLoop?.setVol(0); }

  spawn(pose) {
    const b = this.body;
    if (b.bodyType() !== RAPIER.RigidBodyType.Dynamic) b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    b.setTranslation(pose.pos, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.pos.copy(pose.pos); this.prevPos.copy(pose.pos); this.curPos.copy(pose.pos); this.renderPos.copy(pose.pos);
    this.prevQ.identity(); this.curQ.identity();
    this.vel.set(0, 0, 0); this.vPrev.set(0, 0, 0);
    this.alive = true; this.deadT = 0; this.invuln = 0; this.dizzy = 0; this.brakeT = 0;
    this.grounded = false; this.airT = 0; this.fallSfx = false; this.transport = null; this.forced = 2;
    this.surface = 'normal'; this.ground = null; this.bumpCd = 0; this.lastDamp = null; this.flying = false;
    this.hamster.yaw = 180 - pose.heading;
    this.hamster.setExpression('normal');
    this.vis.group.visible = true;
  }

  setVelocity(x, y, z) {
    if (!this.body || this.transport) return;
    this.body.setLinvel({ x, y, z }, true);
    this.vel.set(x, y, z); this.forced = 2;
  }
  launch(v) { this.setVelocity(v.x, v.y, v.z); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); this.flying = true; this.airT = 0; }

  startTransport(points, exitVel, kind) {
    if (this.transport || !this.alive) return;
    this.transport = { pts: points, t: 0, exit: exitVel, kind, last: points[0].p.clone() };
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.dizzy = 0; this.hamster.setExpression('normal');
  }

  breakBall(reason) {
    if (!this.alive || this.transport) return;
    if (this.invuln > 0 && (reason === 'saw' || reason === 'hammer')) return;
    const g = this.g;
    this.alive = false; this.deadT = 1.5;
    if (reason === 'giveup') g.audio.play('fall_whoosh', { vol: 0.6 });
    else {
      g.audio.play('ball_crack', { vol: 1 });
      g.fx.shards(this.pos.clone());
      g.cam.shake(reason === 'fall' ? 0.2 : 0.5);
    }
    this.vis.group.visible = false;
    this.shadow.visible = false;
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.body.setNextKinematicTranslation(this.pos);
    g.onBreak(reason);
  }

  respawn() {
    const pose = this.g.respawnPose;
    this.spawn(pose);
    this.invuln = 1;
    this.g.level.resetTiles();
    this.g.audio.play('respawn_pop', { vol: 0.9 });
    this.g.fx.sparkle(pose.pos.clone(), 10, 0.6, 0xbff1ff);
    this.g.onRespawn();
  }

  /** Before world.step. move: world-space {x,z} with magnitude ≤ 1. */
  preStep(dt, move, braking, controlsOn) {
    const b = this.body; if (!b) return;
    if (!this.alive) {
      this.deadT -= dt;
      if (this.deadT <= 0) this.respawn();
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.dizzy = Math.max(0, this.dizzy - dt);
    if (this.dizzy <= 0 && this.hamster.expr === 'dizzy') this.hamster.setExpression('normal');

    if (this.transport) { this.stepTransport(dt); return; }

    const v = b.linvel();
    this.vPrev.set(v.x, v.y, v.z);

    // Surface: tar = heavy linear damping, ice = almost no angular damping.
    const onTar = this.grounded && this.surface === 'tar', onIce = this.grounded && this.surface === 'ice';
    // Launched balls fly undamped so the ballistic arc lands where it was aimed.
    const key = this.flying ? 'fly' : onTar ? 'tar' : onIce ? 'ice' : 'n';
    if (key !== this.lastDamp) {
      b.setLinearDamping(this.flying ? 0 : onTar ? 3 : 0.15);
      b.setAngularDamping(onIce ? 0.05 : 0.4);
      this.lastDamp = key;
    }

    let vx = v.x, vz = v.z;
    if (controlsOn && (move.x || move.z)) {
      let mx = move.x, mz = move.z;
      if (this.dizzy > 0) {
        const a = this.wobble + Math.sin(this.g.levelTime * 2.7) * 25 * DEG;
        const c = Math.cos(a), s = Math.sin(a);
        [mx, mz] = [(mx * c - mz * s) * 0.5, (mx * s + mz * c) * 0.5];
      }
      let ctrl = this.grounded ? 1 : AIR_CONTROL;
      if (onIce) ctrl *= 0.55;
      const mag = Math.min(1, Math.hypot(mx, mz)), ux = mx / (mag || 1), uz = mz / (mag || 1);
      const hx = vx, hz = vz, hs = Math.hypot(hx, hz);
      let nx = hx + mx * ACCEL * ctrl * dt, nz = hz + mz * ACCEL * ctrl * dt;
      const grip = this.grounded && !onIce && !this.dizzy;
      if (grip) {
        // Bleed off sideways drift and backwards momentum relative to the stick direction.
        let along = nx * ux + nz * uz;
        const px = (nx - ux * along) * Math.exp(-TURN_GRIP * mag * dt), pz = (nz - uz * along) * Math.exp(-TURN_GRIP * mag * dt);
        if (along < 0) along *= Math.exp(-REVERSE_GRIP * mag * dt);
        nx = ux * along + px; nz = uz * along + pz;
      }
      const ns = Math.hypot(nx, nz), cap = Math.max(MAX_SPEED, hs);
      if (ns > MAX_SPEED && ns > hs) { nx *= cap / ns; nz *= cap / ns; }
      b.setLinvel({ x: nx, y: v.y, z: nz }, true);
      if (grip) {
        // Rolling spin ω = (up × v) / r, so friction pushes the ball where it is going, not where it was.
        const w = b.angvel(), k = 1 - Math.exp(-SPIN_SYNC * dt);
        b.setAngvel({ x: w.x + (nz / 0.5 - w.x) * k, y: w.y, z: w.z + (-nx / 0.5 - w.z) * k }, true);
      }
      vx = nx; vz = nz;
    }
    // Moving platforms: a rolling ball only picks up ~2/7 of a platform's acceleration through friction,
    // so pull its horizontal velocity firmly toward the platform's (input still steers on top of that).
    if (this.grounded && this.ground?.mover) {
      const steering = controlsOn && (move.x || move.z);
      const mv = this.ground.mover.vel, k = 1 - Math.exp(-(steering ? 3 : 14) * dt);
      b.applyImpulse({ x: (mv.x - vx) * k * this.mass, y: 0, z: (mv.z - vz) * k * this.mass }, true);
    }
    // Brake: strong horizontal damping for 0.5 s (held = keeps braking).
    if (braking && controlsOn) this.brakeT = 0.5;
    if (this.brakeT > 0) {
      this.brakeT -= dt;
      const lv = b.linvel(), av = b.angvel(), k = Math.exp(-10 * dt);
      b.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
      b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
    }
  }

  stepTransport(dt) {
    const tr = this.transport, pts = tr.pts;
    tr.t += dt;
    const end = pts[pts.length - 1];
    if (tr.t >= end.t) {
      const b = this.body;
      b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      b.setTranslation(end.p, true);
      b.setLinvel({ x: tr.exit.x, y: tr.exit.y, z: tr.exit.z }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.transport = null; this.forced = 3; this.airT = 0; this.lastDamp = null;
      this.g.onTransportEnd?.(tr.kind);
      return;
    }
    let k = 1;
    while (k < pts.length - 1 && pts[k].t < tr.t) k++;
    const a = pts[k - 1], c = pts[k];
    const u = clamp((tr.t - a.t) / Math.max(1e-4, c.t - a.t), 0, 1);
    const e = tr.kind === 'lift' ? u * u * (3 - 2 * u) : u;
    const p = a.p.clone().lerp(c.p, e);
    this.body.setNextKinematicTranslation(p);
    this.vel.subVectors(p, tr.last).divideScalar(dt);
    tr.last.copy(p);
  }

  /** After world.step. */
  postStep(dt) {
    const b = this.body; if (!b) return;
    const g = this.g;
    const p = b.translation(), q = b.rotation();
    this.prevPos.copy(this.curPos); this.prevQ.copy(this.curQ);
    this.curPos.set(p.x, p.y, p.z); this.curQ.set(q.x, q.y, q.z, q.w);
    this.pos.copy(this.curPos);
    if (!this.alive) return;
    if (this.transport) { this.grounded = false; return; }

    const v = b.linvel();
    this.vel.set(v.x, v.y, v.z);

    // Ground probe (excludes dynamic bodies: the ball itself and rivals).
    const wasGrounded = this.grounded;
    const hit = this.world.castRay(new RAPIER.Ray(p, DOWN), 0.72, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    this.grounded = !!hit;
    if (hit) {
      const info = g.level.colliderInfo.get(hit.collider.handle);
      this.ground = info || null;
      this.surface = info ? info.surface : 'normal';
      this.groundSeg = info ? info.seg : this.groundSeg;
      if (info?.tile) g.level.touchTile(info.tile);
    } else this.ground = null;

    // Landings: juice on medium, dizzy on hard (> 9 m/s vertical impact).
    if (this.grounded && !wasGrounded && this.airT > 0.12) {
      const impact = -this.vPrev.y;
      if (impact > 4) {
        this.hamster.land(clamp(impact / 12, 0.2, 1));
        g.fx.dust(this.pos.clone().setY(this.pos.y - 0.45), impact > 9 ? 14 : 7);
      }
      if (impact > 9 && this.invuln <= 0 && !this.flying) { // planned launcher arcs never daze
        this.dizzy = 1.5; this.wobble = (Math.random() < 0.5 ? -1 : 1) * rand(30, 60) * DEG;
        this.hamster.setExpression('dizzy');
        g.audio.play('dizzy', { vol: 0.8 });
      }
    }
    this.airT = this.grounded ? 0 : this.airT + dt;
    if (this.grounded && this.flying && this.airT === 0 && this.forced === 0) this.flying = false;

    // Impact bumps: velocity change beyond gravity.
    this.bumpCd -= dt;
    if (this.forced > 0) this.forced--;
    else {
      const dvx = v.x - this.vPrev.x, dvy = v.y - this.vPrev.y + GRAVITY * dt, dvz = v.z - this.vPrev.z;
      const dvm = Math.hypot(dvx, dvy, dvz);
      if (dvm > 3 && this.bumpCd <= 0) {
        this.bumpCd = 0.12;
        g.audio.play('bump', { vol: clamp(dvm / 12, 0.15, 1), rate: rand(0.9, 1.1) });
      }
    }

    // Falling off the course.
    if (!this.grounded && this.vel.y < -9 && this.airT > 0.35 && !this.fallSfx) {
      this.fallSfx = true; g.audio.play('fall_whoosh', { vol: 0.7 });
    }
    if (this.grounded) this.fallSfx = false;
    if (p.y < g.level.data.killY) this.breakBall('fall');
  }

  render(alpha, dt) {
    const v = this.vis;
    this.renderPos.lerpVectors(this.prevPos, this.curPos, alpha);
    v.group.position.copy(this.renderPos);
    v.roll.quaternion.slerpQuaternions(this.prevQ, this.curQ, alpha);
    const blink = this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0;
    v.group.visible = this.alive && !blink;
    this.hamster.update(dt, this.vel, this.grounded || !!this.transport);

    // Shadow blob: projected onto the floor below, scaled/faded with height.
    this.shadow.visible = false;
    if (this.alive && this.world) {
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(this.renderPos, DOWN), 30, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      if (hit) {
        const h = hit.timeOfImpact ?? hit.toi, n = hit.normal;
        const pt = this.renderPos.clone().addScaledVector(new THREE.Vector3(0, -1, 0), h);
        this.shadow.position.set(pt.x + n.x * 0.03, pt.y + n.y * 0.03, pt.z + n.z * 0.03);
        this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, n.y, n.z));
        const hh = Math.max(0, h - 0.5);
        this.shadow.scale.setScalar(1.15 * (1 + hh * 0.09));
        this.shadow.material.opacity = 0.55 * clamp(1 - hh / 12, 0, 1);
        this.shadow.visible = this.shadow.material.opacity > 0.02;
      }
    }

    // Rolling sound and speed streaks.
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const rolling = this.alive && this.grounded && !this.transport && this.g.state !== 'menu';
    this.rollLoop?.setVol(rolling ? clamp(sp / 9, 0, 1) * 0.75 : 0, 0.05);
    this.rollLoop?.setRate(0.7 + clamp(sp / 14, 0, 1) * 0.8);
    if (this.alive && sp > 9 && Math.random() < 0.8) this.g.fx.streak(this.renderPos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3))), this.vel);
  }
}
