import { Emitter, storage, store } from '../util.js';
import { CONFIG } from '../config.js';

const PALETTE = ['#e50914', '#f5c518', '#2f80ed', '#27ae60', '#9b51e0', '#eb5757', '#00b8a9', '#f2994a'];
export const avatarColor = (i) => PALETTE[(i || 0) % PALETTE.length];
export const AVATAR_COUNT = PALETTE.length;

/**
 * Session + per-profile library state (My List, Continue Watching, reminders) + preferences.
 * Reads are synchronous (in-memory); writes are optimistic and forwarded to the adapter.
 * Events: 'account' | 'profile' | 'library' | 'prefs' | 'subscription' | 'push' (native push state changed)
 */
// The facade the whole UI talks to. It keeps the current account, profiles, library, subscription and preferences in memory (so reads are instant)
// and forwards changes to the right adapter: `remote` when signed in, otherwise `local`.
export class User extends Emitter {
  account = null;
  profiles = [];
  activeId = null;
  lib = { list: [], progress: {}, reminders: [] };
  subscription = { planId: 'free', status: 'active' };
  prefs = { autoplayNext: true, ...storage('ab.prefs', {}) };
  ratings = {};                // this profile's thumbs: 'show:shahid' → 1 | -1 (signed-in only)
  pin = null;                  // the parental PIN, kept in memory once the viewer has entered it (never stored)
  // Timers used to batch watch-progress saves.
  #progressTimers = new Map();

  /** `local` always exists (guest / offline). `remote` is optional and is used while signed in. */
  constructor(local, remote = null) { super(); this.local = local; this.remote = remote; }
  // Which back-end is active right now.
  get adapter() { return this.remote && this.account ? this.remote : this.local; }
  get mode() { return this.remote ? 'remote' : 'local'; }
  get supportsAuth() { return !!this.remote; }
  get profile() { return this.profiles.find((p) => p.id === this.activeId) || null; }
  get isKids() { return !!this.profile?.kids; }

  // Load state at start-up: the signed-in account if there is one, otherwise the guest profile; then re-select the last used profile.
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
  // Sign-up and sign-in. A guest's local My List / progress is copied into a brand-new account so nothing is lost.
  async signUp(p) {
    const local = this.#localSnapshot();
    const r = await this.remote.signUp(p);
    await this.#afterAuth(r);
    if (local && this.profile) await this.#migrate(local);
    return r;
  }
  async signIn(p) { const r = await this.remote.signIn(p); await this.#afterAuth(r); return r; }
  /** Phone sign-in step 1: ask for a code. Throws a friendly error when SMS is not set up. */
  requestOtp(phone) { return this.remote.requestOtp(phone); }
  /** Phone sign-in step 2: the code signs the viewer in, or creates the account on first use (like sign-up). */
  async signInOtp(phone, code, name) {
    const local = this.#localSnapshot();
    const r = await this.remote.verifyOtp(phone, code, name);
    await this.#afterAuth(r);
    if (r.isNew && local && this.profile) await this.#migrate(local);   // a new account inherits the device's guest list/progress
    return r;
  }
  /** Google / Facebook sign-in. A brand-new account inherits the device's guest list & progress, like sign-up. */
  async signInSocial(provider, credential) {
    const local = this.#localSnapshot();
    const r = await this.remote.signInSocial(provider, credential);
    await this.#afterAuth(r);
    if (r.isNew && local && this.profile) await this.#migrate(local);
    return r;
  }
  /** Reset-password link: the server signs the person in and sign-out-everywhere has already happened. */
  async resetPassword(token, password) { const r = await this.remote.resetPassword(token, password); await this.#afterAuth(r); return r; }
  async changePassword(cur, next) { await this.remote.changePassword(cur, next); }
  async signOutEverywhere() { await this.remote.signOutEverywhere(); }
  async refreshAccount() { const s = await this.remote.init(); if (s.account) { this.account = s.account; this.emit('account'); } }
  providers() { return this.remote ? this.remote.providers() : Promise.resolve({ password: false }); }
  /** Can this viewer play `video` right now? Premium access may come from its parent series. */
  gateFor(video, catalog) {
    if (catalog?.isFreeKind?.(video)) return 'ok';   // trailers, clips and reels are never locked, even on premium shows
    if (video?.access !== 'premium' && catalog?.show?.(video?.showId)?.access !== 'premium') return 'ok';
    if (!this.supportsAuth) return 'unavailable';
    if (!this.account) return 'login';
    return this.isPremium ? 'ok' : 'plan';
  }
  /** Signed playback URL for a video stored in R2 → { type: 'mp4'|'hls', url, expiresAt } */
  streamUrl(video) { if (!this.remote) throw Object.assign(new Error('Streaming isn’t available right now — check your connection.'), { friendly: true }); return this.remote.streamUrl(video.id); }
  // After any sign-in: reload the account state from the server and reset the active profile.
  async #afterAuth(r) {
    const s = await this.remote.init();
    this.account = s.account || r.user;
    this.profiles = s.profiles; this.subscription = s.subscription;
    this.activeId = null; this.lib = { list: [], progress: {}, reminders: [] };
    sessionStorage.removeItem('ab.profileChosen');
    if (this.profiles.length === 1) await this.selectProfile(this.profiles[0].id, { silent: true });
    this.emit('account'); this.emit('profile');
  }
  // Sign out: detach push notifications, forget the native Google/Facebook session, clear all in-memory state and fall back to the guest profile.
  async signOut() {
    try { if (this.account) await (await import('../push.js')).detachPush(); } catch { /* best effort */ }
    try { await (await import('../social.js')).forgetNativeSession?.(); } catch { /* best effort */ }
    try { await this.remote?.signOut(); } catch { /* the local sign-out below must happen regardless */ }
    this.pin = null; this.ratings = {};
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
  // Switch profile: load its library (and thumbs, when signed in).
  async selectProfile(id, { silent = false } = {}) {
    this.activeId = id; store('ab.activeProfile', id); sessionStorage.setItem('ab.profileChosen', '1');
    this.lib = { list: [], progress: {}, reminders: [] }; this.ratings = {};
    try { this.lib = await this.adapter.loadLibrary(id); } catch (e) { console.warn('[user] library load failed', e); }
    if (this.account && this.remote) this.ratings = await this.remote.myRatings(id).catch(() => ({}));
    if (!silent) { this.emit('profile'); this.emit('library'); }
  }
  async createProfile({ name, color, kids = false }) {
    if (this.profiles.length >= CONFIG.maxProfiles) throw new Error(`You can have up to ${CONFIG.maxProfiles} profiles.`);
    const p = await this.adapter.createProfile({ name: name.trim().slice(0, 24), color: color ?? this.profiles.length, kids }, this.pin);
    this.profiles.push(p); this.emit('profile'); return p;
  }
  async updateProfile(id, patch) {
    const p = await this.adapter.updateProfile(id, patch, this.pin);
    this.profiles = this.profiles.map((x) => (x.id === id ? p : x)); this.emit('profile'); return p;
  }
  async deleteProfile(id) {
    if (this.profiles.length <= 1) throw new Error('At least one profile is required.');
    await this.adapter.deleteProfile(id, this.pin);
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeId === id) { this.activeId = null; localStorage.removeItem('ab.activeProfile'); sessionStorage.removeItem('ab.profileChosen'); }
    this.emit('profile');
  }

  /** Parental PIN: verify with the server (5 wrong tries lock it for 15 minutes) and remember it for this tab. */
  get hasPin() { return !!this.account?.hasPin; }
  async verifyPin(pin) { await this.remote.verifyPin(pin); this.pin = pin; }
  async setPin(pin) { await this.remote.setPin(pin, this.pin || undefined); this.pin = pin; this.account = { ...this.account, hasPin: true }; this.emit('account'); }
  async removePin(pin) { await this.remote.removePin(pin); this.pin = null; this.account = { ...this.account, hasPin: false }; this.emit('account'); }

  /* ---------- thumbs & recommendations ---------- */
  ratingOf(type, id) { return this.ratings[`${type}:${id}`] || 0; }
  /** value: 1 (like) | -1 (dislike) | 0 (clear). Returns the new public counts { up, down }. */
  async rate(type, id, value) {
    if (!this.activeId || !this.account) throw new Error('Sign in to rate.');
    const was = this.ratings[`${type}:${id}`] || 0;
    if (value) this.ratings[`${type}:${id}`] = value; else delete this.ratings[`${type}:${id}`];
    try { return await this.remote.rate(this.activeId, type, id, value); } catch (e) { if (was) this.ratings[`${type}:${id}`] = was; else delete this.ratings[`${type}:${id}`]; throw e; }
  }
  /** "Because you watched …": shows in the genres of what this profile watched or liked, that it hasn't started yet. Computed on the device from the library. */
  recommendations(catalog, n = 12) {
    const seenShows = new Map();      // showId → weight
    // Only signed-in accounts have watch history to seed from (guests: My List and likes still count).
    if (this.account) for (const [vid, p] of Object.entries(this.lib.progress)) { const v = catalog.video(vid); if (v?.showId && p.position >= CONFIG.resumeMinSeconds) seenShows.set(v.showId, Math.max(seenShows.get(v.showId) || 0, p.updatedAt || '1')); }
    for (const it of this.lib.list) if (it.type === 'show') seenShows.set(it.id, seenShows.get(it.id) || it.addedAt || '1');
    for (const [k, v] of Object.entries(this.ratings)) { if (v > 0 && k.startsWith('show:')) seenShows.set(k.slice(5), seenShows.get(k.slice(5)) || 'z'); }
    const anchors = [...seenShows.entries()].filter(([id]) => catalog.show(id)).sort((a, b) => String(b[1]).localeCompare(String(a[1])));
    if (!anchors.length) return null;
    const disliked = new Set(Object.entries(this.ratings).filter(([, v]) => v < 0).map(([k]) => k.replace(/^show:/, '')));
    const pool = catalog.shows.filter((s) => !seenShows.has(s.id) && !disliked.has(s.id));
    const [anchorId] = anchors[0], anchor = catalog.show(anchorId), g = new Set(anchor.genres || []);
    const scored = pool.map((s) => ({ s, sc: (s.genres || []).filter((x) => g.has(x)).length })).sort((a, b) => b.sc - a.sc);
    const items = scored.filter((x) => x.sc > 0).concat(scored.filter((x) => !x.sc)).slice(0, n).map((x) => x.s);
    return items.length ? { because: anchor, items } : null;
  }

  /* ---------- My List ---------- */
  // Write the library back (only local mode actually stores it; remote mode saves per action).
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

  /* ---------- watch progress ----------
   * Watch history (progress bars, resume, Continue Watching, "Because you watched") is maintained ONLY
   * for a signed-in account. Guests / non-logged-in visitors never accumulate a history on the device:
   * saveProgress() is a no-op for them and every read (progressOf/continueWatching/resume) comes back empty. */
  progressOf(videoId) { return this.account ? this.lib.progress[videoId] || null : null; }
  fraction(videoId, fallbackDuration) {
    const p = this.progressOf(videoId); if (!p) return 0;
    const d = p.duration || fallbackDuration || 0;
    return d ? Math.min(1, p.position / d) : 0;
  }
  isFinished(videoId, fallbackDuration) { return this.fraction(videoId, fallbackDuration) >= CONFIG.watchedThreshold; }
  saveProgress(videoId, position, duration, { flush = false } = {}) {
    if (!this.account) return;   // guest / signed-out: no history is maintained
    if (!this.activeId || !(position >= 0)) return;
    const pos = position > 0 ? Math.max(1, Math.floor(position)) : 0;
    const dur = Math.floor(duration || this.lib.progress[videoId]?.duration || 0);
    this.lib.progress[videoId] = { position: pos, duration: dur, updatedAt: new Date().toISOString() };
    this.#persistLib();
    clearTimeout(this.#progressTimers.get(videoId));
    const send = () => { this.#progressTimers.delete(videoId); this.adapter.saveProgress(this.activeId, videoId, pos, dur).catch(() => {}); };
    if (flush) send(); else this.#progressTimers.set(videoId, setTimeout(send, 4000));
  }
  clearProgress(videoId) {
    delete this.lib.progress[videoId]; this.#persistLib(); this.emit('library');
    if (this.activeId) this.adapter.clearProgress(this.activeId, videoId).catch(() => {});
  }
  /** Videos partially watched (plus short videos recently played), newest first. Signed-in accounts only — guests have no history. */
  continueWatching(catalog) {
    if (!this.account) return [];
    return Object.entries(this.lib.progress)
      .map(([id, p]) => {
        const video = catalog.video(id);
        const dur = p.duration || video?.duration || 0;
        return { video, p, dur };
      })
      .filter(({ video, p, dur }) => {
        if (!video || !(p.position >= CONFIG.resumeMinSeconds)) return false;
        // Short videos (<= 30s) reach their end in seconds while watching; keep them in Continue Watching so they don't vanish immediately.
        if (dur > 30 && p.position / dur >= CONFIG.watchedThreshold) return false;
        return true;
      })
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
  async checkout(planId, opts) { this.subscription = await this.adapter.checkout(planId, opts); this.emit('subscription'); return this.subscription; }
  quote(planId, couponCode) { return this.adapter.quote(planId, couponCode); }
  billingHistory() { return this.adapter.billingHistory(); }
  invoiceBlob(id) { return this.adapter.invoiceBlob(id); }
  emailInvoice(id) { return this.adapter.emailInvoice(id); }
  async cancelSubscription() { this.subscription = await this.adapter.cancelSubscription(); this.emit('subscription'); }
  plans() { return this.adapter.plans(); }
  submitContact(p) { return (this.remote || this.local).submitContact(p); }

  /* ---------- support ----------
   * These always go through `remote` (never `adapter`): a viewer who is signed out — or looking at a ticket
   * from the receipt e-mail — must still reach the API. The local (no-server) adapter explains that it needs
   * a connection instead of pretending to file a ticket. */
  submitTicket(p) { return (this.remote || this.local).submitTicket(p); }
  myTickets(opts) { return (this.remote || this.local).myTickets(opts); }
  ticket(id, email) { return (this.remote || this.local).ticket(id, email); }
  /** Guest lookup: the reference from our e-mail plus the address that raised the ticket. */
  lookupTicket(reference, email) { return (this.remote || this.local).lookupTicket(reference, email); }
  replyTicket(id, body, email) { return (this.remote || this.local).replyTicket(id, body, email); }
}
