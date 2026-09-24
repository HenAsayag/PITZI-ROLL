// PITZI ROLL · HEN'S ARCADE
// Game: boot, render loop, fixed 120 Hz physics with interpolation, and the state machine
// boot → menu → intro → countdown → racing → finished | timeup → results.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Store } from './src/store.js';
import { Audio } from './src/audio.js';
import { UI, medalHint } from './src/ui.js';
import { Input } from './src/input.js';
import { FX } from './src/fx.js';
import { Level } from './src/level.js';
import { Player } from './src/player.js';
import { CameraRig } from './src/camera.js';
import { MenuScene } from './src/menu.js';
import { Leaderboard } from './src/leaderboard.js';
import { OnlineUI, requestFullscreen } from './src/online-ui.js';
import { loadTex, dirOf, rightOf, mirrorLevel, isTouch, smooth, fmtTime, clamp, DEG } from './src/util.js';

const STEP = 1 / 120;
const DIFF = { easy: 1.3, normal: 1.0, hard: 0.75 };
const NO_MOVE = { x: 0, z: 0 };
const RACE_STATES = new Set(['intro', 'countdown', 'racing', 'finished', 'timeup']);

const TEX = [
  ...['meadow', 'candy', 'factory', 'castle', 'sky', 'neon', 'ice'].flatMap((t) => [[`floor_${t}`, 'textures', true], [`side_${t}`, 'textures', true]]),
  ['pad_speed', 'textures'], ['pad_bonus', 'textures'], ['pad_goal', 'textures'], ['pad_checkpoint', 'textures'], ['pad_launcher', 'textures'], ['bumper_top', 'textures'],
  ['surface_tar', 'textures', true], ['surface_collapse', 'textures'], ['surface_glass', 'textures', true],
  ['ball_roughness', 'textures', false, false], ['ball_seam', 'textures'],
  ['star_dizzy', 'sprites'], ['sparkle', 'sprites'], ['soft_dot', 'sprites'], ['dust', 'sprites'], ['glass_shard', 'sprites'], ['shadow_blob', 'sprites'],
];

class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.store = new Store();
    this.lb = new Leaderboard();
    this.audio = new Audio();
    this.ui = new UI(this);
    this.tex = {};
    this.state = 'boot';
    this.paused = false;
    this.acc = 0; this.levelTime = 0;
    this.fpsFrames = 0; this.fpsT = 0; this.fps = 60; this.slowT = 0;
    this.devOn = false;
    this.run = null;
    this.moveWorld = { x: 0, z: 0 };
    this.lowFpsTime = 0;
  }

  get quality() {
    const q = this.store.settings.quality;
    return q === 'auto' ? (this.autoLow || isTouch ? 'low' : 'high') : q;
  }

  async boot() {
    const s = this.store.settings;
    this.ui.applyLang(s.lang);
    this.audio.setVolumes(s.music, s.sfx);

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !isTouch, powerPreference: 'high-performance' });
    } catch (e) {
      this.ui.loadError(this.ui.t('noWebGL'));
      return;
    }
    const r = this.renderer;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envCache = {};

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.cam = new CameraRig(this.camera);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 70 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    // A soft light that travels with the ball keeps Pitzi readable on dark themes (Neon).
    this.ballLight = new THREE.PointLight(0xffe9d0, 7, 8, 1.6);
    this.ballLight.visible = false;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.ballLight);

    // ---- load everything (progress bar) ----
    // The online leaderboard loads alongside the assets (never blocks the game for long).
    const lbReady = Promise.race([this.lb.init(), new Promise((res) => setTimeout(res, 8000))]);
    let texDone = 0, sfxP = 0;
    const prog = () => this.ui.setLoad(0.1 + 0.9 * ((texDone / TEX.length) * 0.5 + sfxP * 0.5));
    try {
      await RAPIER.init();
      this.ui.setLoad(0.1);
      const lv = await fetch('levels/levels.json').then((x) => x.json());
      // Candy Zigzag opens the game; the other races keep their original order.
      const FIRST = 'zigzag';
      this.levels = [...lv.levels.filter((l) => l.id === FIRST), ...lv.levels.filter((l) => l.id !== FIRST)];
      await Promise.all([
        ...TEX.map(async ([name, dir, repeat, srgb = true]) => {
          this.tex[name] = await loadTex(`assets/${dir}/${name}.png`, { repeat: !!repeat, srgb });
          texDone++; prog();
        }),
        this.audio.load((p) => { sfxP = p; prog(); }),
      ]);
      const sky = await loadTex('assets/textures/sky_meadow.png');
      sky.mapping = THREE.EquirectangularReflectionMapping;
      this.menu = new MenuScene(this, sky, this.envFor(sky, 'meadow'));
      await lbReady;
      if (this.lb.enabled && !this.lb.ready) this.lb.failed = true;
    } catch (e) {
      console.error(e);
      this.ui.loadError(this.ui.t('loadFail'));
      return;
    }

    this.fx = new FX(this.scene, { dust: this.tex.dust, sparkle: this.tex.sparkle, shard: this.tex.glass_shard, dot: this.tex.soft_dot, star: this.tex.star_dizzy });
    this.player = new Player(this);
    this.player.vis.group.visible = false; this.player.shadow.visible = false;
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0x7fdbff, transparent: true, opacity: 0.28, depthWrite: false }));
    const ghostCore = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), new THREE.MeshBasicMaterial({ color: 0xf4a259, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.add(ghostCore); this.ghost.visible = false; this.scene.add(this.ghost);

    this.online = new OnlineUI(this);
    this.input = new Input(this);
    this.input.handlers.key = (e) => this.onKey(e);
    this.input.handlers.canvasTap = () => { if (this.state === 'intro' && !this.paused) this.skipIntro(); };
    this.input.handlers.pad = (b) => {
      if (b === 'pause') { if (this.paused) this.resume(); else if (RACE_STATES.has(this.state)) this.pause(); }
      if (b === 'giveup' && this.state === 'racing' && !this.paused) this.player.breakBall('giveup');
      if (b === 'confirm' && this.state === 'intro') this.skipIntro();
    };

    if (isTouch) document.documentElement.classList.add('touch');
    // Phones play landscape only: turning to portrait mid-race pauses behind the rotate prompt.
    const portrait = matchMedia('(orientation: portrait)');
    portrait.addEventListener?.('change', () => { if (portrait.matches && isTouch) this.autoPause(); });
    addEventListener('resize', () => this.resize());
    screen.orientation?.addEventListener?.('change', () => setTimeout(() => this.resize(), 150));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
    addEventListener('pagehide', () => this.autoPause());
    addEventListener('blur', () => { if (isTouch) this.autoPause(); });

    this.applyQuality();
    this.applySettings();
    this.audio.startMusic();
    this.resize();
    this.state = 'menu';
    this.ui.show('start'); // full screen / continue, then sign-up (if online), then the menu
    setTimeout(() => this.resize(), 60);
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---------- settings / quality ----------
  applySettings() {
    const s = this.store.settings;
    this.audio.setVolumes(s.music, s.sfx);
    this.cam.reduced = !!s.reducedMotion;
    this.ui.syncSettings();
  }
  applyQuality() {
    const high = this.quality === 'high';
    const r = this.renderer; if (!r) return;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, high ? 2 : 1.5));
    r.shadowMap.type = THREE.PCFShadowMap;
    const size = high ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    this.player?.vis.setQuality(high);
    this.menu?.setQuality(high);
    this.resize();
  }
  setLang(l) {
    this.store.settings.lang = l; this.store.save();
    this.ui.applyLang(l);
    this.online?.refreshLang();
  }
  showMenu() {
    this.ui.show('menu');
    this.menu.layout(innerWidth, innerHeight);
  }
  envFor(sky, theme) {
    if (!this.envCache[theme]) this.envCache[theme] = this.pmrem.fromEquirectangular(sky).texture;
    return this.envCache[theme];
  }
  setEnvironment(sky, theme) {
    this.scene.background = sky;
    this.scene.environment = this.envFor(sky, theme);
    this.scene.environmentIntensity = theme === 'neon' ? 0.6 : 0.85;
    this.scene.backgroundIntensity = 1;
  }
  setLights(th) {
    this.hemi.color.set(th.hemiSky); this.hemi.groundColor.set(th.hemiGround); this.hemi.intensity = th.hemiI;
    this.sun.color.set(th.sun); this.sun.intensity = th.sunI;
    this.bloomOn = !!th.bloom;
    this.ballLight.visible = !!th.emissive;
  }

  resize() {
    if (!this.renderer) return;
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = CameraRig.fovFor(w / h);
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      // Bloom is a soft glow: half (or quarter on battery saver) resolution looks the same and costs far less.
      const k = this.quality === 'low' ? 0.25 : 0.5;
      this.bloomPass.setSize(w * this.renderer.getPixelRatio() * k, h * this.renderer.getPixelRatio() * k);
    }
    this.menu?.layout(w, h);
  }

  ensureComposer() {
    if (this.composer) return;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.72);
    c.addPass(this.bloomPass);
    c.addPass(new OutputPass());
    c.setPixelRatio(this.renderer.getPixelRatio());
    this.composer = c;
    this.resize();
  }

  // ---------- input ----------
  onKey(e) {
    const c = e.code;
    if (c === 'Backquote') { this.devOn = !this.devOn; if (!this.devOn) this.ui.dev(null); return; }
    if (c === 'KeyN' && e.shiftKey && RACE_STATES.has(this.state) && !this.paused) { this.finishRace(true); return; }
    if (this.state === 'intro' && !this.paused && !['Escape', 'KeyP'].includes(c)) { this.skipIntro(); return; }
    if (c === 'Escape' || c === 'KeyP') {
      if (this.ui.overlay === 'settings') { this.onAction('back'); return; }
      if (this.paused) { this.resume(); return; }
      if (RACE_STATES.has(this.state)) { this.pause(); return; }
      if (c === 'Escape' && ['tourney', 'select'].includes(this.ui.cur)) this.onAction('back');
      return;
    }
    if (c === 'KeyR' && this.state === 'racing' && !this.paused) this.player.breakBall('giveup');
    if ((c === 'Enter' || c === 'Space') && this.state === 'results' && document.activeElement?.tagName !== 'BUTTON') this.onAction('continue');
  }

  onAction(act) {
    const ui = this.ui;
    switch (act) {
      case 'tourney': ui.syncTourney(); ui.show('tourney'); break;
      case 'timetrial': case 'practice': ui.buildSelect(act); ui.show('select'); break;
      case 'settings': this.settingsFrom = this.paused ? 'pause' : null; ui.syncSettings(); ui.overlayShow('settings'); break;
      case 'back':
        if (ui.overlay === 'settings') ui.overlayShow(this.settingsFrom);
        else this.showMenu();
        break;
      case 'lang': this.setLang(ui.lang === 'he' ? 'en' : 'he'); break;
      case 'mute': this.audio.setMuted(!this.audio.muted); ui.syncSettings(); break;
      case 'fullscreen': {
        const d = document, el = d.documentElement;
        if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
        else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
        break;
      }
      case 'start-tourney': this.startRun('tournament', 0); break;
      case 'start-fs': requestFullscreen(); this.online.afterStart(); break;
      case 'start-go': this.online.afterStart(); break;
      case 'board': this.online.openBoard(); break;
      case 'play-offline': this.showMenu(); break;
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'restart': this.retryRace(); break;
      case 'quit': this.quitToMenu(); break;
      case 'retry': this.retryRace(); break;
      case 'continue': this.continueAfterResults(); break;
      case 'giveup': if (this.state === 'racing' && !this.paused) this.player.breakBall('giveup'); break;
      default: break;
    }
  }

  pause() {
    if (this.paused || !RACE_STATES.has(this.state)) return;
    this.paused = true;
    this.input.setEnabled(false);
    this.audio.pauseWorld(true);
    this.ui.overlayShow('pause');
  }
  autoPause() { if (RACE_STATES.has(this.state) && !this.paused) this.pause(); }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.ui.overlayShow(null);
    this.input.setEnabled(true);
    this.audio.pauseWorld(false);
    this.last = performance.now();
  }

  // ---------- run / race flow ----------
  async startRun(mode, index) {
    const s = this.store.settings;
    this.run = {
      mode, index, pool: 0, score: 0, scoreAtStart: 0, poolAtStart: 0,
      mult: DIFF[s.difficulty] || 1, diff: DIFF[s.difficulty] ? s.difficulty : 'normal', mirror: mode === 'tournament' && !!s.mirror && this.store.data.tourneyDone,
    };
    await this.loadRace(index);
  }

  async loadRace(i) {
    const run = this.run;
    run.index = i;
    this.paused = false;
    this.ui.overlayShow(null);
    this.ui.hideAll();
    this.ui.banner(''); this.ui.countdown('');
    this.state = 'loading';
    this.teardownRace();

    let data = this.levels[i];
    if (run.mirror) data = mirrorLevel(data);
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = STEP;
    const level = new Level(this, data);
    await level.build(this.world);
    this.level = level;
    if (this.bloomOn) this.ensureComposer();
    this.player.attach(this.world, this.level.startPose);
    this.player.hold = true;
    this.hold(true);
    this.respawnPose = this.level.startPose;
    this.fx.clear();

    this.levelTime = 0; this.acc = 0;
    this.raceElapsed = 0; this.rivalBonus = 0; this.lastTick = 99;
    this.ghostRec = []; this.ghostT = 0;
    this.ghostData = run.mode === 'timetrial' ? this.store.ghost(data.id) : null;
    this.ghost.visible = false;
    if (run.mode === 'tournament') {
      run.poolAtStart = run.pool; run.scoreAtStart = run.score;
      run.added = data.raceTime * run.mult;
      run.pool += run.added;
      this.store.unlock(i + 1);
    }
    this.refreshHudText();
    this.ui.setProgress(0);
    this.ui.setMedalHint('');
    this.ui.setScore(run.mode === 'tournament' ? run.score : null);
    this.updateTimerHud();
    this.ui.hud(true);
    this.input.setEnabled(true);
    this.audio.duck(true);

    this.cam.setYaw(this.level.sectionYaw(this.level.startPose.seg), true);
    this.cam.snap(this.player.pos);
    if (this.store.settings.reducedMotion) this.startCountdown();
    else { this.state = 'intro'; this.introT = 0; this.introYaw = null; this.ui.skipHint(true); }
    this.last = performance.now();
  }

  hold(on) {
    const b = this.player.body; if (!b) return;
    this.player.hold = on;
    b.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
    if (!on) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  }

  skipIntro() {
    if (this.state !== 'intro') return;
    this.cam.pos.copy(this.camera.position); this.cam.vel.set(0, 0, 0);
    this.startCountdown();
  }
  startCountdown() {
    this.ui.skipHint(false);
    this.state = 'countdown'; this.cdT = 0; this.cdStep = -1;
    this.cam.look.copy(this.player.pos);
  }

  refreshHudText() {
    if (!this.run || !this.level) return;
    const ui = this.ui, lv = this.levels[this.run.index];
    const name = (lv.name[ui.lang] || lv.name.en) + (this.run.mirror ? ' ⇋' : '');
    const num = this.run.mode === 'tournament' ? ui.t('raceOf', { n: this.run.index + 1 }) : ui.t(this.run.mode === 'timetrial' ? 'ttLabel' : 'practiceLabel');
    ui.hudInfo(name, num);
  }

  updateTimerHud() {
    const run = this.run; if (!run) return;
    if (run.mode === 'tournament') this.ui.setTimer(run.pool, 'tournament', run.pool <= 10 && this.state === 'racing');
    else this.ui.setTimer(this.raceElapsed, run.mode, false);
  }

  teardownRace() {
    if (this.level) { this.level.dispose(); this.level = null; }
    if (this.player?.body) this.player.detach();
    if (this.world) { this.world.free(); this.world = null; }
    this.fx?.clear();
  }

  quitToMenu() {
    this.teardownRace();
    this.paused = false;
    this.audio.pauseWorld(false);
    this.audio.duck(false);
    this.run = null;
    this.state = 'menu';
    this.ui.hud(false);
    this.ui.banner(''); this.ui.countdown(''); this.ui.skipHint(false);
    this.input.setEnabled(false);
    this.player.vis.group.visible = false; this.player.shadow.visible = false; this.ghost.visible = false;
    this.showMenu();
  }

  retryRace() {
    const run = this.run; if (!run) return;
    if (run.mode === 'tournament') { run.pool = run.poolAtStart; run.score = run.scoreAtStart; }
    this.loadRace(run.index);
  }

  continueAfterResults() {
    const run = this.run;
    if (!run || this.state !== 'results') return;
    if (run.mode === 'tournament') {
      if (run.over) { this.quitToMenu(); return; }
      if (run.index + 1 < this.levels.length) this.loadRace(run.index + 1);
      else this.tournamentComplete();
    } else {
      const mode = run.mode;
      this.quitToMenu();
      this.ui.buildSelect(mode); this.ui.show('select');
    }
  }

  // ---------- events from gameplay ----------
  onCheckpoint(cp) {
    this.respawnPose = cp.respawn;
    this.audio.play('checkpoint', { vol: 0.85 });
    this.ui.toast(this.ui.t('checkpoint'), 'checkpoint');
    this.cam.setYaw(this.level.sectionYaw(cp.seg));
  }
  onGoal() { if (this.state === 'racing') this.finishRace(false); }
  onBreak() { /* the clock keeps running: that is the penalty */ }
  onRespawn() { this.cam.setYaw(this.level.sectionYaw(this.respawnPose.seg)); }
  onBonus(sec, pos) {
    const run = this.run;
    if (run.mode === 'tournament') run.pool += sec;
    else if (run.mode === 'timetrial') this.raceElapsed = Math.max(0, this.raceElapsed - sec);
    this.audio.play('time_bonus', { vol: 0.9 });
    const p = this.toScreen(pos);
    this.ui.popup(`+${sec}`, p.x, p.y);
    this.ui.toast(this.ui.t('timeAdded', { s: sec }), 'bonus_time');
    this.fx.sparkle(pos, 12, 0.7, 0xb8f35a);
  }
  onRivalKnocked(pos) {
    if (this.run.mode === 'tournament') { this.rivalBonus += 2000; }
    const p = this.toScreen(this.player.pos.clone().setY(this.player.pos.y + 1));
    this.ui.popup('+2000', p.x, p.y, 'gold');
    this.ui.toast(this.ui.t('rival'), 'trophy');
    this.audio.play('medal', { vol: 0.5, rate: 1.3 });
  }

  finishRace(skipped) {
    if (!['racing', 'countdown', 'intro'].includes(this.state)) return;
    if (this.state !== 'racing') { this.ui.skipHint(false); this.hold(false); }
    this.state = 'finished'; this.finT = 0;
    this.ui.countdown('');
    this.player.hamster.setExpression('happy');
    this.audio.play('goal_fanfare', { vol: 0.9 });
    setTimeout(() => this.audio.play('squeak', { vol: 0.9 }), 250);
    this.ui.banner(this.ui.t('finish'));
    if (!this.store.settings.reducedMotion) this.ui.flash();
    this.fx.sparkle(this.player.pos.clone(), 30, 1.5);
    this.audio.duck(true);
    this.finishedSkipped = skipped;
  }

  showRaceResults() {
    const run = this.run, ui = this.ui, lv = this.levels[run.index];
    this.state = 'results';
    this.ui.banner('');
    this.input.setEnabled(false);
    const time = this.raceElapsed;
    this.store.unlock(run.index + 2);
    if (run.mode === 'tournament') {
      const remaining = Math.max(0, run.pool);
      const par = time <= lv.par ? 1000 : 0;
      const raceScore = Math.floor(remaining * 100) + par + this.rivalBonus;
      run.score += raceScore;
      const rows = [[ui.t('time'), fmtTime(time)], [ui.t('remaining'), fmtTime(remaining)], [ui.t('parBonus'), par ? '+1,000' : '0']];
      if (this.rivalBonus) rows.push([ui.t('rivalBonus'), `+${this.rivalBonus.toLocaleString('en-US')}`]);
      ui.showResults({ title: `${lv.name[ui.lang] || lv.name.en} · ${ui.t('finish')}`, rows, score: run.score, scoreFrom: run.scoreAtStart,
        scoreLabel: ui.t('total'), note: par ? ui.t('parHit') : '', retry: true, confetti: true });
      this.reportOnline(lv.id, time);
    } else if (run.mode === 'timetrial') {
      const skipped = this.finishedSkipped;
      const res = skipped ? { newBest: false, medal: null } : this.store.recordTrial(lv, time, this.ghostRec);
      const best = this.store.data.best[lv.id];
      ui.showResults({ title: lv.name[ui.lang] || lv.name.en, rows: [[ui.t('time'), fmtTime(time)], [ui.t('best'), best != null ? fmtTime(best) : '—']],
        medal: res.medal, note: res.newBest ? ui.t('newBest') : (res.medal ? '' : ui.t('noMedal')), retry: true, confetti: res.newBest, score: null });
      this.reportOnline(lv.id, time);
    } else {
      ui.showResults({ title: lv.name[ui.lang] || lv.name.en, rows: [[ui.t('time'), fmtTime(time)]], retry: true, score: null, confetti: true });
      this.reportOnline(lv.id, time);
    }
  }

  /** Shared board: every real finish counts (not mirror runs, not the Shift+N dev skip). */
  reportOnline(levelId, time) {
    if (this.run.mirror || this.finishedSkipped) return;
    this.online.reportRace(levelId, time);
  }

  timeUp() {
    this.state = 'timeup'; this.tuT = 0;
    this.ui.banner(this.ui.t('timesUp'), true);
    this.audio.play('ball_crack', { vol: 0.6, rate: 0.7 });
    this.audio.play('fall_whoosh', { vol: 0.6, rate: 0.7 });
    this.player.hamster.setExpression('dizzy');
    this.audio.duck(true);
  }
  showTimeUpResults() {
    const run = this.run, ui = this.ui, d = this.store.data;
    this.state = 'results';
    this.ui.banner('');
    this.input.setEnabled(false);
    run.over = true;
    if (run.score > d.tourneyBest) { d.tourneyBest = run.score; this.store.save(); }
    ui.showResults({ title: ui.t('timesUp'), pitzi: 'dizzy', rows: [[ui.t('racesDone', { n: run.index }), `${run.index}/8`]],
      score: run.score, scoreFrom: run.score, scoreLabel: ui.t('total'), retry: false, continueLabel: ui.t('menu') });
    if (!run.mirror) this.online.reportTourney(run.diff, run.score);
  }
  tournamentComplete() {
    const run = this.run, ui = this.ui, d = this.store.data;
    const first = !d.tourneyDone;
    d.tourneyDone = true;
    if (run.score > d.tourneyBest) d.tourneyBest = run.score;
    this.store.save();
    run.over = true;
    this.teardownRace();
    this.ui.hud(false);
    this.state = 'results';
    ui.showResults({ title: ui.t('tourneyDone'), pitzi: 'happy', rows: [[ui.t('racesDone', { n: 8 }), '8/8'], [ui.t('bestScore'), d.tourneyBest.toLocaleString('en-US')]],
      score: run.score, scoreFrom: 0, scoreLabel: ui.t('total'), medal: 'acorn', note: first ? ui.t('mirrorUnlocked') : '', retry: false, continueLabel: ui.t('menu') });
    if (!run.mirror) this.online.reportTourney(run.diff, run.score);
  }

  // ---------- simulation ----------
  fixedStep(dt) {
    const pl = this.player, st = this.state;
    this.levelTime += dt;
    const racing = st === 'racing';
    this.level.hazards.stepKinematics(this.levelTime, dt);
    this.level.hazards.stepRivals(this.levelTime, dt);
    this.level.stepTiles(dt);
    // After the finish (or time-up) Pitzi coasts to a stop on the goal pad.
    const ending = st === 'finished' || st === 'timeup';
    if (!pl.hold) pl.preStep(dt, racing ? this.moveWorld : NO_MOVE, this.input.braking || ending, racing || ending);
    this.world.step();
    if (!pl.hold) pl.postStep(dt);
    if (racing) this.level.hazards.check(this.levelTime, dt);

    if (racing) {
      this.raceElapsed += dt;
      const run = this.run;
      if (run.mode === 'tournament') {
        run.pool -= dt;
        const sec = Math.ceil(run.pool);
        if (run.pool <= 10 && sec !== this.lastTick && sec >= 0) { this.lastTick = sec; this.audio.play('tick', { vol: 0.7 }); }
        if (run.pool <= 0) { run.pool = 0; this.timeUp(); }
      }
      if (run.mode === 'timetrial') {
        this.ghostT += dt;
        if (this.ghostT >= 0.05 || this.ghostRec.length === 0) {
          this.ghostT = this.ghostRec.length ? this.ghostT - 0.05 : 0;
          this.ghostRec.push(pl.pos.x, pl.pos.y, pl.pos.z);
        }
      }
    }
  }

  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  }

  computeMove() {
    const pl = this.player;
    const scr = this.state === 'racing' ? this.toScreen(pl.renderPos) : null;
    const m = this.input.getMove(scr);
    const yaw = this.cam.yaw;
    const f = dirOf(yaw), r = rightOf(yaw);
    this.moveWorld.x = r.x * m.x + f.x * m.y;
    this.moveWorld.z = r.z * m.x + f.z * m.y;
  }

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.fpsFrames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fps = this.fpsFrames / this.fpsT; this.fpsFrames = 0; this.fpsT = 0;
      if (this.store.settings.fps) this.ui.fps(`${Math.round(this.fps)} fps`);
      // Auto quality: drop to the battery-saver path if a race stays slow.
      if (this.store.settings.quality === 'auto' && !this.autoLow && this.state === 'racing' && !this.paused) {
        this.lowFpsTime = this.fps < 40 ? this.lowFpsTime + 0.5 : 0;
        if (this.lowFpsTime >= 4) { this.autoLow = true; this.applyQuality(); }
      }
    }
    this.input.pollPadButtons();

    if (!RACE_STATES.has(this.state) && this.state !== 'results' && this.state !== 'loading') {
      if (this.menu) {
        this.menu.update(dt);
        this.renderer.render(this.menu.scene, this.menu.camera);
      }
      return;
    }
    if (!this.level) {
      if (this.menu) { this.menu.update(dt); this.renderer.render(this.menu.scene, this.menu.camera); }
      return;
    }

    let alpha = 1;
    if (!this.paused) {
      this.computeMove();
      if (this.state === 'intro') this.updateIntro(dt);
      if (this.state === 'countdown') this.updateCountdown(dt);
      if (this.state === 'finished') {
        this.finT += dt;
        if (this.finT > 1.9) this.showRaceResults();
      }
      if (this.state === 'timeup') { this.tuT += dt; if (this.tuT > 2.2) this.showTimeUpResults(); }
      if (!this.level) return;
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 12) { this.fixedStep(STEP); this.acc -= STEP; n++; }
      if (n === 12) this.acc = 0;
      alpha = this.acc / STEP;
    } else alpha = 1;
    if (!this.level) return;

    const pl = this.player;
    const renderT = this.levelTime - (1 - alpha) * STEP;
    const rdt = this.paused ? 0 : dt;
    pl.render(alpha, rdt);
    this.level.hazards.render(renderT, rdt, alpha);
    this.level.renderTiles();
    this.fx.update(rdt);

    if (this.state !== 'intro') {
      const sp = Math.hypot(pl.vel.x, pl.vel.z);
      this.cam.update(rdt || 1e-4, pl.alive ? pl.renderPos : pl.pos, pl.alive ? sp : 0, this.world);
    }
    this.sun.position.copy(pl.renderPos).add(new THREE.Vector3(8, 18, 6));
    this.sun.target.position.copy(pl.renderPos);
    if (this.ballLight.visible) this.ballLight.position.copy(pl.renderPos).y += 1.6;
    this.audio.setListener(this.camera);

    // Ghost (time trial)
    if (this.ghostData && this.ghostData.length >= 6 && RACE_STATES.has(this.state) && this.state !== 'intro') {
      const n = this.ghostData.length / 3, k = clamp(this.raceElapsed / 0.05, 0, n - 1), i = Math.floor(k), f = k - i, j = Math.min(n - 1, i + 1), G = this.ghostData;
      this.ghost.position.set(G[i * 3] + (G[j * 3] - G[i * 3]) * f, G[i * 3 + 1] + (G[j * 3 + 1] - G[i * 3 + 1]) * f, G[i * 3 + 2] + (G[j * 3 + 2] - G[i * 3 + 2]) * f);
      this.ghost.visible = this.state === 'racing' || this.state === 'finished';
    } else this.ghost.visible = false;

    // HUD
    if (this.run && RACE_STATES.has(this.state)) {
      this.updateTimerHud();
      const loc = this.level.locate(pl.pos);
      this.curSeg = loc.seg;
      if (this.state === 'racing' || this.state === 'finished') this.ui.setProgress(this.state === 'finished' ? 1 : loc.dist / this.level.totalLength);
      if (this.run.mode === 'timetrial') this.ui.setMedalHint(medalHint(this.ui, this.levels[this.run.index], this.raceElapsed));
      if (this.run.mode === 'tournament') this.ui.setScore(this.run.score + this.rivalBonus);
    }
    if (this.devOn) {
      const m = this.renderer.info;
      this.ui.dev(`fps ${Math.round(this.fps)}  q:${this.quality}\nstate ${this.state}${this.paused ? ' (paused)' : ''}\nspeed ${Math.hypot(pl.vel.x, pl.vel.z).toFixed(2)} m/s  vy ${pl.vel.y.toFixed(2)}\ngrounded ${pl.grounded}  surface ${pl.surface}\nseg ${this.curSeg ?? '-'}  (${this.level.segs[this.curSeg ?? 0]?.type})\ncalls ${m.render.calls}  tris ${m.render.triangles}\ngeo ${m.memory.geometries}  tex ${m.memory.textures}\nShift+N: skip race`);
    }

    if (this.bloomOn && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  updateIntro(dt) {
    this.introT += dt;
    const D = 2.5, u = smooth(this.introT / D), P = this.level.path, n = P.length - 1;
    const k = (1 - u) * n, i = Math.floor(k), f = k - i;
    const a = P[i].p, b = P[Math.min(n, i + 1)].p;
    const p = a.clone().lerp(b, f);
    const target = this.level.sectionYaw(P[i].seg);
    if (this.introYaw == null || this.introT <= dt) this.introYaw = target;
    this.introYaw += (((target - this.introYaw + 540) % 360) - 180) * (1 - Math.exp(-2.5 * dt));
    const yaw = this.introYaw * DEG;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const h = 10 + (1 - u) * 4;
    this.camera.position.set(p.x - fx * 9, p.y + h, p.z - fz * 9);
    this.camera.lookAt(p.x, p.y, p.z);
    if (this.introT >= D) {
      this.cam.pos.copy(this.camera.position); this.cam.vel.set(0, 0, 0); this.cam.look.copy(p);
      this.startCountdown();
    }
  }

  updateCountdown(dt) {
    this.cdT += dt;
    const step = Math.floor(this.cdT / 0.85);
    if (step !== this.cdStep) {
      this.cdStep = step;
      if (step < 3) { this.ui.countdown(String(3 - step)); this.audio.play('countdown_beep', { vol: 0.8 }); }
      else {
        this.ui.countdown(this.ui.t('go'));
        this.audio.play('go', { vol: 0.9 });
        this.audio.duck(false);
        this.hold(false);
        this.state = 'racing';
        setTimeout(() => { if (this.state === 'racing' || this.state === 'finished') this.ui.countdown(''); }, 800);
        if (this.run.mode === 'tournament') this.ui.toast(this.ui.t('timeAdded', { s: Math.round(this.run.added * 10) / 10 }), 'timer');
      }
    }
  }
}

const game = new Game();
window.__pitzi = game; // handy for debugging from the console
game.boot();
