// UI: DOM screens, i18n (Hebrew RTL default / English), HUD, toasts & popups, race cards, settings, results.
import { STRINGS } from './strings.js';
import { fmtTime, isTouch, THEMES } from './util.js';
import { MEDALS } from './store.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'start', 'auth', 'board', 'menu', 'tourney', 'select', 'settings', 'pause', 'results'];

export class UI {
  constructor(game) {
    this.g = game;
    this.lang = 'en';
    this.cur = 'loading';
    this.overlay = null; // settings/pause stack on top of another screen
    this.hudEls = { timer: $('timer'), timerBox: $('timer-box'), fill: $('prog-fill'), ball: $('prog-ball'), medal: $('medal-hint'), score: $('score-chip') };

    // Button delegation + press sounds.
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) { this.g.audio.play('ui_click', { vol: 0.6 }); this.g.onAction(b.dataset.act, b); }
    });
    if (!isTouch) {
      document.addEventListener('pointerover', (e) => {
        const b = e.target.closest('.btn,.rcard:not(.locked),.chip');
        if (b && b !== this._hover) { this._hover = b; this.g.audio.play('ui_hover', { vol: 0.35 }); }
        if (!b) this._hover = null;
      });
    }
    // Settings controls
    const s = game.store.settings;
    const music = $('set-music'), sfx = $('set-sfx');
    music.value = s.music; sfx.value = s.sfx;
    music.addEventListener('input', () => { s.music = +music.value; game.applySettings(); });
    sfx.addEventListener('input', () => { s.sfx = +sfx.value; game.applySettings(); });
    music.addEventListener('change', () => game.store.save());
    sfx.addEventListener('change', () => { game.store.save(); game.audio.play('bump', { vol: 0.8 }); });
    $('set-lang').addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (b) { game.audio.play('ui_click', { vol: 0.6 }); game.setLang(b.dataset.lang); } });
    $('set-quality').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      game.audio.play('ui_click', { vol: 0.6 }); s.quality = b.dataset.q; game.store.save(); game.applyQuality(); this.syncSettings();
    });
    document.querySelectorAll('.tog[data-set]').forEach((t) => t.addEventListener('click', () => {
      game.audio.play('ui_click', { vol: 0.6 });
      s[t.dataset.set] = !s[t.dataset.set]; game.store.save(); game.applySettings(); this.syncSettings();
    }));
    $('diff').addEventListener('click', (e) => {
      const b = e.target.closest('[data-diff]'); if (!b) return;
      game.audio.play('ui_click', { vol: 0.6 }); s.difficulty = b.dataset.diff; game.store.save(); this.syncTourney();
    });
    $('tog-mirror').addEventListener('click', () => { game.audio.play('ui_click', { vol: 0.6 }); s.mirror = !s.mirror; game.store.save(); this.syncTourney(); });
    const fsBtn = $('btn-fs');
    if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsBtn.hidden = true;
  }

  t(key, vars) {
    let s = STRINGS[this.lang][key] ?? STRINGS.en[key] ?? key;
    if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
    return s;
  }

  applyLang(lang) {
    this.lang = lang;
    const html = document.documentElement;
    html.lang = lang; html.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.dataset.i18n); });
    $('lang-label').textContent = lang === 'he' ? 'EN' : 'עב';
    $('controls-hint').textContent = this.t(isTouch ? 'controlsHintTouch' : 'controlsHint');
    $('load-text').textContent = this.t('loading');
    this.syncSettings(); this.syncTourney();
    if (this.cur === 'select') this.buildSelect(this.selectMode);
    this.g.refreshHudText?.();
  }

  setLoad(p) { $('load-bar').style.width = `${Math.round(p * 100)}%`; }
  loadError(msg) { $('load-text').textContent = msg; $('load-bar').parentElement.hidden = true; }

  show(name) {
    this.cur = name; this.overlay = null;
    for (const s of SCREENS) $(`scr-${s}`).classList.toggle('show', s === name);
    const first = $(`scr-${name}`).querySelector('.btn,.rcard:not(.locked)');
    if (first && !isTouch && name !== 'results') setTimeout(() => first.focus({ preventScroll: true }), 50);
  }
  /** Overlay a screen (settings / pause) on top of whatever is up. */
  overlayShow(name) {
    if (this.overlay) $(`scr-${this.overlay}`).classList.remove('show');
    this.overlay = name;
    if (name) $(`scr-${name}`).classList.add('show');
  }
  hideAll() { for (const s of SCREENS) $(`scr-${s}`).classList.remove('show'); this.cur = null; this.overlay = null; }

  syncSettings() {
    const s = this.g.store.settings;
    document.querySelectorAll('#set-lang [data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === this.lang));
    document.querySelectorAll('#set-quality [data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === s.quality));
    document.querySelectorAll('.tog[data-set]').forEach((t) => t.classList.toggle('on', !!s[t.dataset.set]));
    $('mute-icon').src = this.g.audio.muted ? 'assets/icons/sound_off.svg' : 'assets/icons/sound_on.svg';
    $('fps').hidden = !s.fps;
  }
  syncTourney() {
    const s = this.g.store.settings, d = this.g.store.data;
    document.querySelectorAll('#diff [data-diff]').forEach((b) => b.classList.toggle('on', b.dataset.diff === s.difficulty));
    $('mirror-row').hidden = !d.tourneyDone;
    $('mirror-locked').hidden = d.tourneyDone;
    $('tog-mirror').classList.toggle('on', !!s.mirror && d.tourneyDone);
    $('tourney-best').textContent = d.tourneyBest ? `${this.t('bestScore')}: ${d.tourneyBest.toLocaleString('en-US')}` : '';
  }

  buildSelect(mode) {
    this.selectMode = mode;
    const g = this.g, d = g.store.data, wrap = $('cards');
    $('select-title').textContent = this.t(mode === 'timetrial' ? 'chooseRaceTT' : 'chooseRacePr');
    wrap.innerHTML = '';
    g.levels.forEach((lv, i) => {
      const locked = i >= d.unlocked;
      const card = document.createElement('button');
      card.className = 'rcard' + (locked ? ' locked' : '');
      card.style.setProperty('--c', (THEMES[lv.theme] || THEMES.meadow).accent);
      const medal = d.medals[lv.id], best = d.best[lv.id];
      card.innerHTML = `<div class="band"><span class="idx">${i + 1}</span>${medal ? `<img class="medal" src="assets/icons/medal_${medal}.svg" alt="${this.t(medal)}">` : ''}</div>
        <div class="body"><h3></h3><p></p>
        <div class="best"><img src="assets/icons/timer.svg" alt=""><span></span></div></div>`;
      card.querySelector('h3').textContent = lv.name[this.lang] || lv.name.en;
      card.querySelector('p').textContent = locked ? this.t('lockedHint') : (lv.desc[this.lang] || lv.desc.en);
      card.querySelector('.best span').innerHTML = mode === 'timetrial'
        ? `${this.t('best')}: <bdi>${best != null ? fmtTime(best) : '—'}</bdi> · ${this.t('gold')} <bdi>${fmtTime(lv.medals.gold)}</bdi>`
        : `${this.t('time')}: <bdi>${fmtTime(lv.raceTime)}</bdi>`;
      if (locked) card.setAttribute('aria-disabled', 'true');
      card.addEventListener('click', () => {
        if (locked) { g.audio.play('bump', { vol: 0.5 }); return; }
        g.audio.play('ui_click', { vol: 0.6 });
        g.startRun(mode, i);
      });
      wrap.appendChild(card);
    });
  }

  // ---------- HUD ----------
  hud(on) { $('hud').hidden = !on; $('touch').hidden = !(on && isTouch); }
  hudInfo(name, num) { $('race-name').textContent = name; $('race-num').textContent = num; }
  setTimer(t, mode, warn) {
    const e = this.hudEls;
    const txt = fmtTime(t);
    if (e.timer.textContent !== txt) e.timer.textContent = txt;
    e.timerBox.classList.toggle('warn', !!warn);
    e.timerBox.classList.toggle('tt', mode === 'timetrial');
  }
  setProgress(f) {
    const pct = `${(Math.max(0, Math.min(1, f)) * 100).toFixed(1)}%`;
    this.hudEls.fill.style.width = pct;
    this.hudEls.ball.style.insetInlineStart = pct;
  }
  setMedalHint(html) { if (this.hudEls.medal.innerHTML !== html) this.hudEls.medal.innerHTML = html; }
  setScore(n) {
    const e = this.hudEls.score;
    e.hidden = n == null;
    if (n != null) e.textContent = `★ ${n.toLocaleString('en-US')}`;
  }
  toast(text, icon) {
    const el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = icon ? `<img src="assets/icons/${icon}.png" alt="">` : "";
    el.append(text);
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
  popup(text, x, y, cls = '') {
    const el = document.createElement('div'); el.className = `popup ${cls}`; el.textContent = text;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    $('popups').appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
  countdown(text) {
    const c = $('countdown');
    c.innerHTML = '';
    if (text) { const s = document.createElement('span'); s.textContent = text; c.appendChild(s); }
  }
  banner(text, bad = false) {
    const b = $('banner'); b.innerHTML = '';
    if (text) { const s = document.createElement('span'); s.textContent = text; if (bad) s.className = 'bad'; b.appendChild(s); }
  }
  skipHint(on) { const e = $('skip-hint'); e.hidden = !on; e.textContent = this.t('skip'); }
  flash() { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = '0.7'; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; }); }
  fps(txt) { $('fps').textContent = txt; }
  dev(txt) { const d = $('dev'); d.hidden = txt == null; if (txt != null) d.textContent = txt; }

  // ---------- results ----------
  /** r: {title, pitzi, rows:[[label, value]], score, scoreLabel, medal, note, retry, continueLabel} */
  showResults(r) {
    $('res-title').textContent = r.title;
    $('res-pitzi').src = `assets/ui/pitzi_${r.pitzi || 'happy'}.svg`;
    const rows = $('res-rows'); rows.innerHTML = '';
    for (const [k, v] of r.rows) {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.textContent = k;
      const b = document.createElement('td'); b.innerHTML = `<bdi>${v}</bdi>`;
      tr.append(a, b); rows.appendChild(tr);
    }
    const md = $('res-medal'); md.innerHTML = '';
    if (r.medal) {
      md.innerHTML = `<img src="assets/icons/medal_${r.medal}.svg" alt=""><span></span>`;
      md.querySelector('span').textContent = this.t(r.medal);
      setTimeout(() => { this.g.audio.play('medal', { vol: 0.9 }); this.confetti(); }, 450);
    }
    $('res-score-box').hidden = r.score == null;
    $('res-score-label').textContent = r.scoreLabel || this.t('score');
    $('res-note').textContent = r.note || '';
    $('res-online').textContent = '';
    $('res-retry').hidden = !r.retry;
    $('res-continue').textContent = r.continueLabel || this.t('continue');
    this.show('results');
    if (r.score != null) {
      const el = $('res-score'), from = r.scoreFrom || 0, to = r.score, t0 = performance.now(), dur = 1100;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (to - from) * e).toLocaleString('en-US');
        if (k < 1 && this.cur === 'results') requestAnimationFrame(step);
        if (k < 1 && Math.random() < 0.25) this.g.audio.play('tick', { vol: 0.2, rate: 1.6 });
      };
      requestAnimationFrame(step);
    }
    if (r.confetti && !r.medal) setTimeout(() => this.confetti(), 300);
  }

  confetti() {
    if (this.g.store.settings.reducedMotion) return;
    const c = $('confetti');
    const tints = ['', 'hue-rotate(120deg)', 'hue-rotate(220deg)', 'hue-rotate(300deg)'];
    for (let i = 0; i < 46; i++) {
      const im = document.createElement('img'); im.src = 'assets/sprites/sparkle.png'; im.alt = '';
      im.style.left = `${Math.random() * 100}%`;
      im.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
      im.style.animationDelay = `${Math.random() * 0.5}s`;
      im.style.width = `${16 + Math.random() * 22}px`;
      im.style.filter = tints[i % 4];
      c.appendChild(im);
      setTimeout(() => im.remove(), 3800);
    }
  }
}

/** HUD hint: the best medal still reachable at the current elapsed time. */
export function medalHint(ui, level, elapsed) {
  const m = level.medals;
  let target = null;
  for (let i = MEDALS.length - 1; i >= 0; i--) if (elapsed <= m[MEDALS[i]]) { target = MEDALS[i]; break; }
  if (!target) return '';
  return `<img src="assets/icons/medal_${target}.svg" alt="">${ui.t('target')}: ${ui.t(target)} <bdi>${fmtTime(m[target])}</bdi>`;
}
