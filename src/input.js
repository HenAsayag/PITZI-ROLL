// Keyboard, mouse (hold to roll toward cursor), gamepad (standard mapping) and a floating touch joystick.
// getMove() returns a screen-space vector {x: right, y: up}, magnitude ≤ 1.
import { clamp } from './util.js';

const JOY_R = 62; // px radius of the touch joystick

export class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.mouse = { down: false, x: 0, y: 0 };
    this.touch = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false };
    this.brakeTouch = false;
    this.handlers = {};
    this.lastSource = 'keys';
    this.enabled = false; // gameplay input (joystick etc.) only while racing screens are up
    this.joy = document.getElementById('joy');
    this.knob = document.getElementById('joy-knob');

    addEventListener('keydown', (e) => {
      if (e.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
      this.keys.add(e.code);
      this.lastSource = 'keys';
      if (this.enabled && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.handlers.key?.(e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.endTouch(); this.brakeTouch = false; });

    const canvas = game.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      this.handlers.canvasTap?.(e);
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 0) { this.mouse.down = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.lastSource = 'mouse'; }
        return;
      }
      if (this.touch.id !== null) return;
      // Floating joystick: its base appears where the thumb lands.
      this.touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, active: true };
      this.lastSource = 'touch';
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.drawJoy();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { this.mouse.x = e.clientX; this.mouse.y = e.clientY; return; }
      if (e.pointerId !== this.touch.id) return;
      this.touch.x = e.clientX; this.touch.y = e.clientY;
      // Drag the base along if the thumb goes far past the rim (keeps the stick responsive).
      const dx = this.touch.x - this.touch.ox, dy = this.touch.y - this.touch.oy, d = Math.hypot(dx, dy);
      if (d > JOY_R * 1.6) { const k = (d - JOY_R * 1.6) / d; this.touch.ox += dx * k; this.touch.oy += dy * k; }
      this.drawJoy();
    });
    const up = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) this.mouse.down = false; return; }
      if (e.pointerId === this.touch.id) this.endTouch();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);

    // Touch buttons (brake is hold-to-brake).
    const brake = document.getElementById('t-brake');
    const on = (e) => { e.preventDefault(); this.brakeTouch = true; brake.classList.add('held'); };
    const off = () => { this.brakeTouch = false; brake.classList.remove('held'); };
    brake.addEventListener('pointerdown', on);
    brake.addEventListener('pointerup', off);
    brake.addEventListener('pointercancel', off);
    brake.addEventListener('pointerleave', off);
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.mouse.down = false; this.endTouch(); this.brakeTouch = false; }
  }

  endTouch() {
    this.touch.id = null; this.touch.active = false;
    this.drawJoy();
  }

  drawJoy() {
    const j = this.joy; if (!j) return;
    if (this.touch.active) {
      j.classList.add('active');
      j.style.left = `${this.touch.ox}px`; j.style.top = `${this.touch.oy}px`;
      let dx = this.touch.x - this.touch.ox, dy = this.touch.y - this.touch.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else {
      j.classList.remove('active');
      j.style.left = ''; j.style.top = '';
      this.knob.style.transform = '';
    }
  }

  gamepad() {
    try {
      for (const gp of navigator.getGamepads?.() || []) if (gp && gp.connected) return gp;
    } catch { /* ignore */ }
    return null;
  }

  /** ballScreen: {x,y} pixel position of the ball, used for mouse steering. */
  getMove(ballScreen) {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) y += 1;
    if (k.has('ArrowDown') || k.has('KeyS')) y -= 1;
    if (x || y) { const l = Math.hypot(x, y); return { x: x / l, y: y / l }; }

    const gp = this.gamepad();
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, m = Math.hypot(ax, ay);
      if (m > 0.18) { const s = Math.min(1, (m - 0.18) / 0.82) / m; this.lastSource = 'pad'; return { x: ax * s, y: -ay * s }; }
    }
    if (this.touch.active) {
      const dx = this.touch.x - this.touch.ox, dy = this.touch.y - this.touch.oy, d = Math.hypot(dx, dy);
      if (d < 6) return { x: 0, y: 0 };
      const m = clamp((d - 6) / (JOY_R - 6), 0, 1);
      return { x: (dx / d) * m, y: (-dy / d) * m };
    }
    if (this.mouse.down && ballScreen) {
      let dx = this.mouse.x - ballScreen.x, dy = this.mouse.y - ballScreen.y;
      if (this.game.store.settings.invertMouse) { dx = -dx; dy = -dy; }
      const d = Math.hypot(dx, dy);
      if (d < 12) return { x: 0, y: 0 };
      const m = clamp(d / 160, 0, 1);
      return { x: (dx / d) * m, y: (-dy / d) * m };
    }
    return { x: 0, y: 0 };
  }

  get braking() {
    if (this.keys.has('Space') || this.brakeTouch) return true;
    const gp = this.gamepad();
    return !!(gp && (gp.buttons[0]?.pressed || gp.buttons[7]?.pressed));
  }

  /** Edge-detected gamepad buttons for pause (Start) and give-up (Y). */
  pollPadButtons() {
    const gp = this.gamepad(); if (!gp) return;
    const prev = this._padPrev || [];
    const now = gp.buttons.map((b) => b.pressed);
    if (now[9] && !prev[9]) this.handlers.pad?.('pause');
    if (now[3] && !prev[3]) this.handlers.pad?.('giveup');
    if (now[0] && !prev[0]) this.handlers.pad?.('confirm');
    this._padPrev = now;
  }
}
