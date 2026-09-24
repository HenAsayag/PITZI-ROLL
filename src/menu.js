// Main-menu diorama: Pitzi in the ball idly rolling around a small turntable island, soft pointer parallax.
// The view is offset so the diorama sits in the screen space the menu card leaves free.
import * as THREE from 'three';
import { BallVisual } from './player.js';
import { horizonColor } from './util.js';

export class MenuScene {
  constructor(game, sky, env) {
    const T = game.tex;
    this.g = game;
    this.scene = new THREE.Scene();
    this.scene.background = sky;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.8;
    this.scene.fog = new THREE.Fog(horizonColor(sky), 18, 40);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

    this.scene.add(new THREE.HemisphereLight(0xe3f4ff, 0x6d8f4c, 1.2));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.position.set(4, 9, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    // Turntable island
    this.table = new THREE.Group(); this.scene.add(this.table);
    const floor = T.floor_meadow.clone(); floor.repeat.set(1.6, 1.6); floor.needsUpdate = true;
    const side = T.side_meadow.clone(); side.repeat.set(6, 1); side.needsUpdate = true;
    const topM = new THREE.MeshStandardMaterial({ map: floor, roughness: 0.85 });
    const sideM = new THREE.MeshStandardMaterial({ map: side, roughness: 0.9 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.6, 0.7, 64), [sideM, topM, sideM]);
    disc.position.y = -0.35; disc.receiveShadow = true; disc.castShadow = true;
    this.table.add(disc);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 1, flatShading: true }));
    rock.position.y = -2; rock.rotation.x = Math.PI; this.table.add(rock);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(3.08, 0.13, 10, 80), new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.45 }));
    rail.rotation.x = Math.PI / 2; rail.position.y = 0.1; rail.castShadow = true; this.table.add(rail);
    const goal = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshStandardMaterial({ map: T.pad_goal, transparent: true, roughness: 0.6 }));
    goal.rotation.x = -Math.PI / 2; goal.position.y = 0.01; this.table.add(goal);
    const bumperM = [new THREE.MeshStandardMaterial({ color: 0xff4f8b, roughness: 0.35 }), new THREE.MeshStandardMaterial({ map: T.bumper_top }), new THREE.MeshStandardMaterial({ color: 0xff4f8b })];
    for (const a of [0.6, 2.7, 4.6]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.3, 24), bumperM);
      b.position.set(Math.cos(a) * 2.55, 0.15, Math.sin(a) * 2.55); b.castShadow = true; this.table.add(b);
    }
    const bushM = new THREE.MeshStandardMaterial({ color: 0x7cc34f, roughness: 0.9, flatShading: true });
    for (const [a, s] of [[1.6, 0.42], [3.7, 0.34], [5.6, 0.38]]) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), bushM);
      b.position.set(Math.cos(a) * 2.75, s * 0.6, Math.sin(a) * 2.75); b.castShadow = true; this.table.add(b);
    }

    this.ball = new BallVisual(T, game.quality === 'high');
    this.ball.group.traverse((o) => { if (o.isMesh && o !== this.ball.ball && o !== this.ball.seam) o.castShadow = true; });
    this.scene.add(this.ball.group);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: T.shadow_blob, transparent: true, depthWrite: false, opacity: 0.5 }));
    shadow.rotation.x = -Math.PI / 2; this.shadow = shadow; this.scene.add(shadow);

    this.theta = 0; this.t = 0;
    this.vel = new THREE.Vector3();
    this.pointer = { x: 0, y: 0 }; this.par = { x: 0, y: 0 };
    addEventListener('pointermove', (e) => { this.pointer.x = (e.clientX / innerWidth) * 2 - 1; this.pointer.y = (e.clientY / innerHeight) * 2 - 1; });
    this.offset = { x: 0, y: 0, dist: 1 };
  }

  setQuality(high) { this.ball.setQuality(high); }

  /** Frame the diorama in the space the menu UI leaves free. */
  layout(w, h) {
    this.camera.aspect = w / h;
    const wrap = document.querySelector('#scr-menu .menu-wrap');
    const card = document.querySelector('#scr-menu .menu-card'), logo = document.querySelector('#scr-menu .logo');
    let cx = w / 2, cy = h / 2, dist = 1;
    if (wrap && card && logo && document.getElementById('scr-menu').classList.contains('show')) {
      const r = wrap.getBoundingClientRect();
      if (w / h >= 1.05) {
        const leftFree = r.left, rightFree = w - r.right;
        cx = leftFree > rightFree ? leftFree / 2 : r.right + rightFree / 2;
        dist = Math.max(1, 0.55 / Math.max(0.3, Math.max(leftFree, rightFree) / w));
      } else {
        const lb = logo.getBoundingClientRect().bottom, ct = card.getBoundingClientRect().top;
        const gap = Math.max(60, ct - lb);
        cy = lb + gap / 2;
        dist = Math.min(3.6, Math.max(1, (h * 0.34) / gap) * Math.max(1, 0.8 / (w / h)));
      }
    }
    this.offset = { x: w / 2 - cx, y: h / 2 - cy, dist };
    this.camera.setViewOffset(w, h, this.offset.x, this.offset.y, w, h);
    this.camera.fov = w / h < 1 ? 52 : 38;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;
    const R = 1.85, v = 2.1;
    this.theta += (v / R) * dt;
    const x = Math.cos(this.theta) * R, z = Math.sin(this.theta) * R;
    this.vel.set(-Math.sin(this.theta) * v, 0, Math.cos(this.theta) * v);
    const g = this.ball.group;
    g.position.set(x, 0.5 + Math.abs(Math.sin(this.t * 4.2)) * 0.03, z);
    const axis = new THREE.Vector3(0, 1, 0).cross(this.vel).normalize();
    this.ball.roll.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (v / 0.5) * dt));
    this.ball.hamster.update(dt, this.vel, true);
    this.shadow.position.set(x, 0.015, z);
    this.table.rotation.y = Math.sin(this.t * 0.15) * 0.2;

    const reduced = this.g.store.settings.reducedMotion;
    const k = 1 - Math.exp(-3 * dt);
    this.par.x += ((reduced ? 0 : this.pointer.x) - this.par.x) * k;
    this.par.y += ((reduced ? 0 : this.pointer.y) - this.par.y) * k;
    const d = this.offset.dist;
    this.camera.position.set(this.par.x * 1.2 * d, (4.3 - this.par.y * 0.6) * d, 8.2 * d);
    this.camera.lookAt(0, 0.2, 0);
  }
}
