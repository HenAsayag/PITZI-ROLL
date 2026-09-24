// Shared online leaderboard (Firebase Auth + Firestore, loaded from the CDN only when configured).
// Players register with a nickname + password; the nickname is encoded into a synthetic e-mail so
// Firebase Auth itself guarantees unique names. Best time per race, best tournament score per difficulty.
import { FIREBASE_CONFIG } from '../leaderboard-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.10.0';
const EMAIL_DOMAIN = 'players.pitzi-roll.app';

export const NAME_MIN = 2, NAME_MAX = 12, PASS_MIN = 6;

function normName(name) { return name.normalize('NFC').trim().replace(/\s+/g, ' '); }
function nameToEmail(name) {
  const bytes = new TextEncoder().encode(normName(name).toLowerCase());
  let hex = ''; for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `p${hex}@${EMAIL_DOMAIN}`;
}

export class Leaderboard {
  constructor() {
    this.enabled = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);
    this.ready = false; this.failed = false;
    this.user = null;            // {uid, name}
    this.listeners = new Set();
    this.best = {};              // cache of my submitted bests: levelId -> time
  }

  /** Loads the SDK and restores the session. Resolves once the auth state is known. */
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
      await new Promise((resolve) => {
        let first = true;
        auth.onAuthStateChanged(this.auth, (u) => {
          this.user = u ? { uid: u.uid, name: u.displayName || '?' } : null;
          this.best = {};
          this.emit();
          if (first) { first = false; resolve(); }
        });
      });
      this.ready = true;
    } catch (e) {
      console.warn('Leaderboard unavailable:', e);
      this.failed = true;
    }
  }
  get online() { return this.enabled && this.ready && !this.failed; }
  onChange(cb) { this.listeners.add(cb); }
  emit() { for (const cb of this.listeners) cb(this.user); }

  validate(name, pass) {
    const n = normName(name || '');
    if (n.length < NAME_MIN || n.length > NAME_MAX) return 'errName';
    if (!/^[\p{L}\p{N} _.\-]+$/u.test(n)) return 'errNameChars';
    if ((pass || '').length < PASS_MIN) return 'errPass';
    return null;
  }

  async register(name, pass) {
    const bad = this.validate(name, pass); if (bad) throw new Error(bad);
    const n = normName(name), A = this.A, F = this.F;
    try {
      const cred = await A.createUserWithEmailAndPassword(this.auth, nameToEmail(n), pass);
      await A.updateProfile(cred.user, { displayName: n });
      await F.setDoc(F.doc(this.db, 'players', cred.user.uid), { name: n, created: F.serverTimestamp() });
      this.user = { uid: cred.user.uid, name: n };
      this.emit();
    } catch (e) { throw new Error(mapErr(e)); }
  }

  async login(name, pass) {
    if (!name || !pass) throw new Error('errMissing');
    try {
      await this.A.signInWithEmailAndPassword(this.auth, nameToEmail(name), pass);
    } catch (e) { throw new Error(mapErr(e)); }
  }

  async logout() { try { await this.A.signOut(this.auth); } catch { /* ignore */ } }

  /** Submits a race time if it beats this player's stored best. Returns {improved, rank, best}. */
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
    if (improved) await F.setDoc(ref, { name: this.user.name, score, at: F.serverTimestamp() });
    const best = improved ? score : prev;
    const better = await F.getCountFromServer(F.query(F.collection(this.db, 'tourney', diff, 'scores'), F.where('score', '>', best)));
    return { improved, best, rank: better.data().count + 1 };
  }

  /** Top entries: race boards sort by time ascending, tournament boards by score descending. */
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
    const ref = kind === 'race' ? F.doc(this.db, 'levels', id, 'scores', this.user.uid) : F.doc(this.db, 'tourney', id, 'scores', this.user.uid);
    const snap = await F.getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data();
    const col = kind === 'race' ? F.collection(this.db, 'levels', id, 'scores') : F.collection(this.db, 'tourney', id, 'scores');
    const q = kind === 'race' ? F.query(col, F.where('time', '<', d.time)) : F.query(col, F.where('score', '>', d.score));
    const c = await F.getCountFromServer(q);
    return { ...d, uid: this.user.uid, rank: c.data().count + 1 };
  }
}

function mapErr(e) {
  const c = e?.code || e?.message || '';
  if (c.includes('email-already-in-use')) return 'errTaken';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return 'errLogin';
  if (c.includes('weak-password')) return 'errPass';
  if (c.includes('too-many-requests')) return 'errTooMany';
  if (c.includes('network')) return 'errNetwork';
  if (c.startsWith('err')) return c;
  return 'errGeneric';
}
