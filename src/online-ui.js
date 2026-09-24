// Start gate (full screen / continue), sign-up / log-in, and the shared leaderboard screen.
import { fmtTime, isTouch } from './util.js';
import { NAME_MAX } from './leaderboard.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const IS_IOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const CAN_FULLSCREEN = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

export function requestFullscreen() {
  const el = document.documentElement;
  try {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
    p?.catch?.(() => {});
  } catch { /* not allowed: keep playing windowed */ }
}

export class OnlineUI {
  constructor(game) {
    this.g = game; this.lb = game.lb; this.ui = game.ui;
    this.mode = 'register'; this.tab = 0; this.diff = game.store.settings.difficulty || 'normal';

    $('btn-start-fs').hidden = !CAN_FULLSCREEN;
    $('ios-hint').hidden = !(IS_IOS && !CAN_FULLSCREEN && !navigator.standalone);

    $('auth-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      game.audio.play('ui_click', { vol: 0.6 });
      this.setMode(b.dataset.mode);
    });
    $('auth-form').addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
    $('board-diff').addEventListener('click', (e) => {
      const b = e.target.closest('[data-diff]'); if (!b) return;
      game.audio.play('ui_click', { vol: 0.6 }); this.diff = b.dataset.diff; this.loadBoard();
    });
    this.lb.onChange(() => this.syncUser());
    this.syncUser();
  }

  /** After the start gate: registration is required whenever the online board is available. */
  afterStart() {
    if (this.lb.online && !this.lb.user) this.showAuth();
    else this.g.showMenu();
  }

  setMode(m) {
    this.mode = m;
    document.querySelectorAll('#auth-tabs [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('auth-submit').querySelector('span').textContent = this.ui.t(m === 'register' ? 'register' : 'login');
    $('auth-pass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    $('auth-err').textContent = '';
  }
  showAuth() {
    this.setMode(this.mode);
    $('auth-offline').hidden = !this.lb.failed;
    this.ui.show('auth');
    if (!isTouch) setTimeout(() => $('auth-name').focus(), 60);
  }
  async submit() {
    const name = $('auth-name').value, pass = $('auth-pass').value, btn = $('auth-submit');
    $('auth-err').textContent = '';
    btn.disabled = true;
    try {
      if (this.mode === 'register') await this.lb.register(name, pass);
      else await this.lb.login(name, pass);
      $('auth-pass').value = '';
      this.g.audio.play('checkpoint', { vol: 0.6 });
      this.g.showMenu();
    } catch (e) {
      $('auth-err').textContent = this.ui.t(e.message);
      this.g.audio.play('bump', { vol: 0.6 });
    } finally { btn.disabled = false; }
  }

  syncUser() {
    const u = this.lb.user, chip = $('user-chip');
    chip.hidden = !u;
    if (u) chip.textContent = `👤 ${u.name}`;
    $('board-user').textContent = u ? this.ui.t('loggedAs', { n: u.name }) : '';
    $('btn-logout').hidden = !u;
    $('btn-board').hidden = !this.lb.enabled;
    $('auth-name').maxLength = NAME_MAX;
  }
  refreshLang() {
    this.setMode(this.mode); this.syncUser();
    if (this.ui.cur === 'board') this.buildTabs(), this.loadBoard();
  }

  // ---------- leaderboard screen ----------
  openBoard(tab = this.tab) {
    this.tab = tab;
    this.ui.show('board');
    this.buildTabs();
    this.loadBoard();
  }
  buildTabs() {
    const wrap = $('board-tabs'); wrap.innerHTML = '';
    const tabs = this.g.levels.map((_, i) => ({ id: i, label: String(i + 1) })).concat([{ id: 'T', label: '🏆' }]);
    for (const t of tabs) {
      const b = document.createElement('button');
      b.textContent = t.label; b.className = t.id === this.tab ? 'on' : '';
      b.title = t.id === 'T' ? this.ui.t('tourneyTab') : (this.g.levels[t.id].name[this.ui.lang] || this.g.levels[t.id].name.en);
      b.addEventListener('click', () => { this.g.audio.play('ui_click', { vol: 0.6 }); this.tab = t.id; this.buildTabs(); this.loadBoard(); });
      wrap.appendChild(b);
    }
  }
  async loadBoard() {
    const ui = this.ui, list = $('board-list'), status = $('board-status'), tour = this.tab === 'T';
    $('board-diff').hidden = !tour;
    document.querySelectorAll('#board-diff [data-diff]').forEach((b) => b.classList.toggle('on', b.dataset.diff === this.diff));
    const lv = tour ? null : this.g.levels[this.tab];
    $('board-title').textContent = tour ? `${ui.t('tourneyTab')} · ${ui.t(this.diff)}` : `${this.tab + 1}. ${lv.name[ui.lang] || lv.name.en}`;
    list.innerHTML = '';
    if (!this.lb.enabled) { status.textContent = ui.t('boardOff'); return; }
    if (!this.lb.online) { status.textContent = ui.t('boardOffline'); return; }
    status.textContent = ui.t('boardLoading');
    const req = (this._req = {});
    try {
      const kind = tour ? 'tourney' : 'race', id = tour ? this.diff : lv.id;
      const [rows, me] = await Promise.all([this.lb.top(kind, id, 20), this.lb.mine(kind, id)]);
      if (req !== this._req) return; // a newer tab was opened meanwhile
      const fmt = (r) => (tour ? r.score.toLocaleString('en-US') : fmtTime(r.time));
      const uid = this.lb.user?.uid;
      let html = rows.map((r, i) => `<li class="${r.uid === uid ? 'me' : ''}"><span class="rk">${i + 1}</span><span>${esc(r.name)}</span><bdi>${fmt(r)}</bdi></li>`).join('');
      if (me && !rows.some((r) => r.uid === uid)) html += `<li class="sep">⋯</li><li class="me"><span class="rk">${me.rank}</span><span>${esc(me.name)}</span><bdi>${fmt(me)}</bdi></li>`;
      list.innerHTML = html;
      status.textContent = rows.length ? (me ? ui.t('yourBest', { r: me.rank }) : '') : ui.t('boardEmpty');
    } catch (e) {
      console.warn(e);
      if (req === this._req) status.textContent = ui.t('boardOffline');
    }
  }

  // ---------- results integration ----------
  async reportRace(levelId, time) {
    const el = $('res-online'); el.textContent = '';
    if (!this.lb.online || !this.lb.user) return;
    try {
      const r = await this.lb.submitTime(levelId, time);
      if (!r) return;
      el.textContent = r.improved ? this.ui.t('onlineNew', { r: r.rank }) : this.ui.t('onlineKept', { b: fmtTime(r.best), r: r.rank });
    } catch (e) { console.warn(e); el.textContent = this.ui.t('onlineFail'); }
  }
  async reportTourney(diff, score) {
    const el = $('res-online'); el.textContent = '';
    if (!this.lb.online || !this.lb.user) return;
    try {
      const r = await this.lb.submitTourney(diff, score);
      if (!r) return;
      el.textContent = r.improved ? this.ui.t('onlineNew', { r: r.rank }) : this.ui.t('onlineKept', { b: r.best.toLocaleString('en-US'), r: r.rank });
    } catch (e) { console.warn(e); el.textContent = this.ui.t('onlineFail'); }
  }
}
