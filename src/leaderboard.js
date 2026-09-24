// Shared online leaderboard (Firebase Anonymous Auth + Firestore, SDK loaded from the CDN).
// No passwords: each device signs in anonymously and claims one free nickname (names/{lowercased name}).
// The claim is stored with the device's anonymous account, so the name sticks to that browser for good.
import { FIREBASE_CONFIG } from '../leaderboard-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.10.0';
const NAME_KEY = 'pitziroll.name';

export const NAME_MIN = 2, NAME_MAX = 12;

export function normName(name) { return (name || '').normalize('NFC').trim().replace(/\s+/g, ' '); }
const nameKey = (n) => normName(n).toLowerCase();

function cachedName() { try { return localStorage.getItem(NAME_KEY); } catch { return null; } }
function cacheName(n) { try { if (n) localStorage.setItem(NAME_KEY, n); else localStorage.removeItem(NAME_KEY); } catch { /* storage off */ } }

export class Leaderboard {
  constructor() {
    this.enabled = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);
    this.ready = false; this.failed = false;
    this.user = null;            // {uid, name} once this device owns a name
    this.uid = null;
    this.listeners = new Set();
    this.best = {};              // levelId -> my best on the board
  }

  /** Loads the SDK, restores this device's anonymous account and its claimed name. */
  async init() {
    if (!this.enabled) return;
    try {
      const [app, auth, fs] = await Promise.all([
        import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
      ]);
      this.A = auth; this.F = fs;
      const fbApp = app.initializeApp(FIREBASE_CONFIG);
      this.auth = auth.getAuth(fbApp);
      this.db = fs.getFirestore(fbApp);
      const u = await new Promise((resolve) => {
        const off = auth.onAuthStateChanged(this.auth, (usr) => { off(); resolve(usr); });
      });
      if (u) {
        this.uid = u.uid;
        let name = cachedName();
        try {
          const snap = await fs.getDoc(fs.doc(this.db, 'players', u.uid));
          name = snap.exists() ? snap.data().name : null;
        } catch { /* offline: trust the cached name */ }
        cacheName(name);
        if (name) this.user = { uid: u.uid, name };
      }
      this.ready = true;
      this.emit();
    } catch (e) {
      console.warn('Leaderboard unavailable:', e);
      this.failed = true;
    }
  }
  get online() { return this.enabled && this.ready && !this.failed; }
  onChange(cb) { this.listeners.add(cb); }
  emit() { for (const cb of this.listeners) cb(this.user); }

  validate(name) {
    const n = normName(name);
    if (n.length < NAME_MIN || n.length > NAME_MAX) return 'errName';
    if (!/^[\p{L}\p{N} _.\-]+$/u.test(n) || !/[\p{L}\p{N}]/u.test(n)) return 'errNameChars';
    return null;
  }

  /** Claims a free nickname for this device. Throws Error('errTaken' | 'errName' | ...). */
  async claim(name) {
    const bad = this.validate(name); if (bad) throw new Error(bad);
    const n = normName(name), key = nameKey(n), F = this.F;
    try {
      if (!this.auth.currentUser) await this.A.signInAnonymously(this.auth);
      const uid = this.auth.currentUser.uid;
      const nameRef = F.doc(this.db, 'names', key);
      let taken;
      try { taken = await F.getDoc(nameRef); } catch (e) { throw new Error(String(e?.code).includes('permission-denied') ? 'errSetup' : mapErr(e)); }
      if (taken.exists() && taken.data().uid !== uid) throw new Error('errTaken');
      const batch = F.writeBatch(this.db);
      batch.set(nameRef, { uid, name: n });
      batch.set(F.doc(this.db, 'players', uid), { name: n, created: F.serverTimestamp() });
      await batch.commit();
      this.uid = uid; this.user = { uid, name: n };
      cacheName(n);
      this.emit();
    } catch (e) { throw new Error(mapErr(e)); }
  }

  /** Submits a race time if it beats this player's best. Returns {improved, rank, best}. */
  async submitTime(levelId, time) {
    if (!this.online || !this.user) return null;
    const F = this.F, t = Math.round(time * 100) / 100;
    const ref = F.doc(this.db, 'levels', levelId, 'scores', this.user.uid);
    let best = this.best[levelId];
    if (best == null) { const snap = await F.getDoc(ref); best = snap.exists() ? snap.data().time : null; }
    let improved = false;
    if (best == null || t < best) {
      await F.setDoc(ref, { name: this.user.name, time: t, at: F.serverTimestamp() });
      best = t; improved = true;
    }
    this.best[levelId] = best;
    const faster = await F.getCountFromServer(F.query(F.collection(this.db, 'levels', levelId, 'scores'), F.where('time', '<', best)));
    return { improved, best, rank: faster.data().count + 1 };
  }

  async submitTourney(diff, score) {
    if (!this.online || !this.user || !(score > 0)) return null;
    const F = this.F, ref = F.doc(this.db, 'tourney', diff, 'scores', this.user.uid);
    const snap = await F.getDoc(ref);
    const prev = snap.exists() ? snap.data().score : null;
    const improved = prev == null || score > prev;
    if (improved) await F.setDoc(ref, { name: this.user.name, score: Math.round(score), at: F.serverTimestamp() });
    const best = improved ? Math.round(score) : prev;
    const better = await F.getCountFromServer(F.query(F.collection(this.db, 'tourney', diff, 'scores'), F.where('score', '>', best)));
    return { improved, best, rank: better.data().count + 1 };
  }

  /** Top entries: races sort by time ascending, tournament boards by score descending. */
  async top(kind, id, n = 20) {
    if (!this.online) return [];
    const F = this.F;
    const col = kind === 'race' ? F.collection(this.db, 'levels', id, 'scores') : F.collection(this.db, 'tourney', id, 'scores');
    const q = kind === 'race' ? F.query(col, F.orderBy('time', 'asc'), F.limit(n)) : F.query(col, F.orderBy('score', 'desc'), F.limit(n));
    const snap = await F.getDocs(q);
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  }

  async mine(kind, id) {
    if (!this.online || !this.user) return null;
    const F = this.F;
    const col = kind === 'race' ? F.collection(this.db, 'levels', id, 'scores') : F.collection(this.db, 'tourney', id, 'scores');
    const snap = await F.getDoc(F.doc(col, this.user.uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    const q = kind === 'race' ? F.query(col, F.where('time', '<', d.time)) : F.query(col, F.where('score', '>', d.score));
    const c = await F.getCountFromServer(q);
    return { ...d, uid: this.user.uid, rank: c.data().count + 1 };
  }
}

function mapErr(e) {
  const c = e?.code || e?.message || '';
  if (c.startsWith('err')) return c;
  if (c.includes('permission-denied')) return 'errTaken';
  if (c.includes('admin-restricted-operation') || c.includes('operation-not-allowed')) return 'errSetup';
  if (c.includes('too-many-requests')) return 'errTooMany';
  if (c.includes('network') || c.includes('unavailable')) return 'errNetwork';
  return 'errGeneric';
}
