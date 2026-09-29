import { Emitter, storage, store } from '../util.js';
import { CONFIG } from '../config.js';

const PALETTE = ['#e50914', '#f5c518', '#2f80ed', '#27ae60', '#9b51e0', '#eb5757', '#00b8a9', '#f2994a'];
export const avatarColor = (i) => PALETTE[(i || 0) % PALETTE.length];
export const AVATAR_COUNT = PALETTE.length;

/**
 * Session + per-profile library state (My List, Continue Watching, reminders) + preferences.
 * Reads are synchronous (in-memory); writes are optimistic and forwarded to the adapter.
 * Events: 'account' | 'profile' | 'library' | 'prefs' | 'subscription'
 */
export class User extends Emitter {
  account = null;
  profiles = [];
  activeId = null;
  lib = { list: [], progress: {}, reminders: [] };
  subscription = { planId: 'free', status: 'active' };
  prefs = { autoplayNext: true, ...storage('ab.prefs', {}) };
  #progressTimers = new Map();

  /** `local` always exists (guest / offline). `remote` is optional and is used while signed in. */
  constructor(local, remote = null) { super(); this.local = local; this.remote = remote; }
  get adapter() { return this.remote && this.account ? this.remote : this.local; }
  get mode() { return this.remote ? 'remote' : 'local'; }
  get supportsAuth() { return !!this.remote; }
  get profile() { return this.profiles.find((p) => p.id === this.activeId) || null; }

  async init() {
    let s = this.remote ? await this.remote.init().catch(() => null) : null;
    if (!s || !s.account) s = await this.local.init();
    this.account = s.account; this.profiles = s.profiles; this.subscription = s.subscription || this.subscription;
    const saved = storage('ab.activeProfile', null);
    const pick = this.profiles.find((p) => p.id === saved) || (this.profiles.length === 1 ? this.profiles[0] : null);
    if (pick) await this.selectProfile(pick.id, { silent: true });
  }
  /** true when the "Who's watching?" screen should be shown before the app. */
  needsProfileChoice() {
    if (!this.profiles.length) return false;
    if (this.profiles.length === 1) return !this.profile;
    return !sessionStorage.getItem('ab.profileChosen');
  }

  /* ---------- auth ---------- */
  async signUp(p) {
    const local = this.#localSnapshot();
    const r = await this.remote.signUp(p);
    await this.#afterAuth(r);
    if (local && this.profile) await this.#migrate(local);
    return r;
  }
  async signIn(p) { const r = await this.remote.signIn(p); await this.#afterAuth(r); return r; }
  /** Google / Facebook sign-in. A brand-new account inherits the device's guest list & progress, like sign-up. */
  async signInSocial(provider, credential) {
    const local = this.#localSnapshot();
    const r = await this.remote.signInSocial(provider, credential);
    await this.#afterAuth(r);
    if (r.isNew && local && this.profile) await this.#migrate(local);
    return r;
  }
  providers() { return this.remote ? this.remote.providers() : Promise.resolve({ password: false }); }
  /** Can this viewer play `video` right now?  'ok' | 'login' (sign in first) | 'plan' (signed in but no active Plus plan) | 'unavailable' (no accounts in local mode) */
  gateFor(video) {
    if (video?.access !== 'premium') return 'ok';
    if (!this.supportsAuth) return 'unavailable';
    if (!this.account) return 'login';
    return this.isPremium ? 'ok' : 'plan';
  }
  /** Signed playback URL for a video stored in R2 → { type: 'mp4'|'hls', url, expiresAt } */
  streamUrl(video) { if (!this.remote) throw new Error('Streaming needs the ADDABAAZ API.'); return this.remote.streamUrl(video.id); }
  async #afterAuth(r) {
    const s = await this.remote.init();
    this.account = s.account || r.user;
    this.profiles = s.profiles; this.subscription = s.subscription;
    this.activeId = null; this.lib = { list: [], progress: {}, reminders: [] };
    sessionStorage.removeItem('ab.profileChosen');
    if (this.profiles.length === 1) await this.selectProfile(this.profiles[0].id, { silent: true });
    this.emit('account'); this.emit('profile');
  }
  async signOut() {
    await this.remote?.signOut();
    this.account = null; this.activeId = null; this.lib = { list: [], progress: {}, reminders: [] };
    sessionStorage.removeItem('ab.profileChosen'); localStorage.removeItem('ab.activeProfile');
    const s = await this.local.init();               // fall back to the device-only guest profile(s)
    this.profiles = s.profiles; this.subscription = s.subscription;
    if (this.profiles.length === 1) await this.selectProfile(this.profiles[0].id, { silent: true });
    this.emit('account'); this.emit('profile'); this.emit('library'); this.emit('subscription');
  }
  async deleteAccount() { await this.remote.deleteAccount(); await this.signOut(); }
  #localSnapshot() {
    // Carry a device-only guest library into a brand-new account so nothing is lost on sign-up.
    const id = this.account ? null : (this.activeId || storage('ab.profiles', [])[0]?.id);
    const lib = id ? storage('ab.lib.' + id, null) : null;
    return lib && (lib.list?.length || Object.keys(lib.progress || {}).length) ? lib : null;
  }
  async #migrate(lib) {
    try {
      for (const it of lib.list || []) await this.adapter.addToList(this.activeId, it.type, it.id);
      for (const [id, p] of Object.entries(lib.progress || {})) await this.adapter.saveProgress(this.activeId, id, p.position, p.duration);
      this.lib = await this.adapter.loadLibrary(this.activeId); this.emit('library');
    } catch (e) { console.warn('[user] migrate failed', e); }
  }

  /* ---------- profiles ---------- */
  async selectProfile(id, { silent = false } = {}) {
    this.activeId = id; store('ab.activeProfile', id); sessionStorage.setItem('ab.profileChosen', '1');
    this.lib = { list: [], progress: {}, reminders: [] };
    try { this.lib = await this.adapter.loadLibrary(id); } catch (e) { console.warn('[user] library load failed', e); }
    if (!silent) { this.emit('profile'); this.emit('library'); }
  }
  async createProfile({ name, color }) {
    if (this.profiles.length >= CONFIG.maxProfiles) throw new Error(`You can have up to ${CONFIG.maxProfiles} profiles.`);
    const p = await this.adapter.createProfile({ name: name.trim().slice(0, 24), color: color ?? this.profiles.length });
    this.profiles.push(p); this.emit('profile'); return p;
  }
  async updateProfile(id, patch) {
    const p = await this.adapter.updateProfile(id, patch);
    this.profiles = this.profiles.map((x) => (x.id === id ? p : x)); this.emit('profile'); return p;
  }
  async deleteProfile(id) {
    if (this.profiles.length <= 1) throw new Error('At least one profile is required.');
    await this.adapter.deleteProfile(id);
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeId === id) { this.activeId = null; localStorage.removeItem('ab.activeProfile'); sessionStorage.removeItem('ab.profileChosen'); }
    this.emit('profile');
  }

  /* ---------- My List ---------- */
  #persistLib() { if (this.activeId) this.adapter.saveLibrary(this.activeId, this.lib); }
  inList(type, id) { return this.lib.list.some((x) => x.type === type && x.id === id); }
  listItems() { return [...this.lib.list].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '')); }
  async toggleList(type, id) {
    if (!this.activeId) return false;
    const has = this.inList(type, id);
    this.lib.list = has ? this.lib.list.filter((x) => !(x.type === type && x.id === id)) : [...this.lib.list, { type, id, addedAt: new Date().toISOString() }];
    this.#persistLib(); this.emit('library');
    try { await (has ? this.adapter.removeFromList(this.activeId, type, id) : this.adapter.addToList(this.activeId, type, id)); } catch (e) { console.warn(e); }
    return !has;
  }

  /* ---------- reminders (Coming Soon) ---------- */
  hasReminder(id) { return this.lib.reminders.includes(id); }
  async toggleReminder(id) {
    if (!this.activeId) return false;
    const on = !this.hasReminder(id);
    this.lib.reminders = on ? [...this.lib.reminders, id] : this.lib.reminders.filter((x) => x !== id);
    this.#persistLib(); this.emit('library');
    try { await this.adapter.setReminder(this.activeId, id, on); } catch (e) { console.warn(e); }
    return on;
  }

  /* ---------- watch progress ---------- */
  progressOf(videoId) { return this.lib.progress[videoId] || null; }
  fraction(videoId, fallbackDuration) {
    const p = this.progressOf(videoId); if (!p) return 0;
    const d = p.duration || fallbackDuration || 0;
    return d ? Math.min(1, p.position / d) : 0;
  }
  isFinished(videoId, fallbackDuration) { return this.fraction(videoId, fallbackDuration) >= CONFIG.watchedThreshold; }
  saveProgress(videoId, position, duration, { flush = false } = {}) {
    if (!this.activeId || !(position >= 0)) return;
    this.lib.progress[videoId] = { position: Math.floor(position), duration: Math.floor(duration || 0), updatedAt: new Date().toISOString() };
    this.#persistLib();
    clearTimeout(this.#progressTimers.get(videoId));
    const send = () => { this.#progressTimers.delete(videoId); this.adapter.saveProgress(this.activeId, videoId, Math.floor(position), Math.floor(duration || 0)).catch(() => {}); };
    if (flush) send(); else this.#progressTimers.set(videoId, setTimeout(send, 4000));
  }
  clearProgress(videoId) {
    delete this.lib.progress[videoId]; this.#persistLib(); this.emit('library');
    if (this.activeId) this.adapter.clearProgress(this.activeId, videoId).catch(() => {});
  }
  /** Videos partially watched, newest first. */
  continueWatching(catalog) {
    return Object.entries(this.lib.progress)
      .map(([id, p]) => ({ video: catalog.video(id), p }))
      .filter(({ video, p }) => video && p.position >= CONFIG.resumeMinSeconds && !(p.duration && p.position / p.duration >= CONFIG.watchedThreshold))
      .sort((a, b) => (b.p.updatedAt || '').localeCompare(a.p.updatedAt || ''));
  }
  /** Where "Play" should take you for a show: resume → next unwatched → first episode. */
  resumeTarget(catalog, showId) {
    const eps = catalog.episodes(showId);
    if (!eps.length) return null;
    const inProgress = eps.map((e) => ({ e, p: this.progressOf(e.id) })).filter(({ e, p }) => p && p.position >= CONFIG.resumeMinSeconds && !this.isFinished(e.id, e.duration))
      .sort((a, b) => b.p.updatedAt.localeCompare(a.p.updatedAt))[0];
    if (inProgress) return { video: inProgress.e, resume: true };
    const seen = eps.filter((e) => this.isFinished(e.id, e.duration));
    const next = eps.find((e) => !this.isFinished(e.id, e.duration));
    if (seen.length && next) return { video: next, resume: false, continued: true };
    return { video: eps[0], resume: false };
  }
  clearHistory() { Object.keys(this.lib.progress).forEach((id) => this.clearProgress(id)); }

  /* ---------- prefs & plan ---------- */
  pref(k) { return this.prefs[k]; }
  setPref(k, v) { this.prefs = { ...this.prefs, [k]: v }; store('ab.prefs', this.prefs); this.emit('prefs'); }
  get isPremium() { const s = this.subscription; return !!(s?.planId && s.planId !== 'free' && s.status === 'active' && (!s.expiresAt || Date.parse(s.expiresAt) > Date.now())); }
  async checkout(planId) { this.subscription = await this.adapter.checkout(planId); this.emit('subscription'); return this.subscription; }
  async cancelSubscription() { this.subscription = await this.adapter.cancelSubscription(); this.emit('subscription'); }
  plans() { return this.adapter.plans(); }
  submitContact(p) { return (this.remote || this.local).submitContact(p); }
}
