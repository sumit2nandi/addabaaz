/* Two interchangeable persistence back-ends behind one interface.
 *   LocalAdapter  – everything lives in localStorage on this device (static hosting, offline).
 *   RemoteAdapter – accounts, profiles, list, progress and subscriptions live on the API.
 * The UI only talks to `User` (user.js), never to an adapter directly, so adding e.g. Firebase or
 * Supabase later means writing a third adapter with these same methods. */
import { storage, store, uid } from '../util.js';
import { ApiError } from './api.js';

const emptyLib = () => ({ list: [], progress: {}, reminders: [] });

export const PLANS_FALLBACK = [
  { id: 'free', name: 'Free', priceINR: 0, interval: 'forever', features: ['All free episodes & reels', 'Watch on any device', 'My List & Continue Watching'] },
  { id: 'plus-monthly', name: 'ADDABAAZ Plus', priceINR: 99, interval: 'month', features: ['Everything in Free', 'Premium originals & early access', 'Ad-free viewing', 'Up to 5 profiles'] },
  { id: 'plus-yearly', name: 'ADDABAAZ Plus (Yearly)', priceINR: 799, interval: 'year', features: ['Everything in Plus', '2 months free'] },
];

export class LocalAdapter {
  mode = 'local';
  supportsAuth = false;
  async init() {
    let profiles = storage('ab.profiles', null);
    if (!profiles?.length) { profiles = [{ id: uid(), name: 'Me', color: 0 }]; store('ab.profiles', profiles); }
    return { account: null, profiles, subscription: storage('ab.sub', { planId: 'free', status: 'active' }) };
  }
  async createProfile(p) { const list = storage('ab.profiles', []); const n = { id: uid(), ...p }; list.push(n); store('ab.profiles', list); return n; }
  async updateProfile(id, patch) {
    const list = storage('ab.profiles', []); const i = list.findIndex((p) => p.id === id);
    if (i < 0) throw new ApiError(404, 'Profile not found'); list[i] = { ...list[i], ...patch }; store('ab.profiles', list); return list[i];
  }
  async deleteProfile(id) { store('ab.profiles', storage('ab.profiles', []).filter((p) => p.id !== id)); localStorage.removeItem('ab.lib.' + id); }
  async loadLibrary(pid) { return { ...emptyLib(), ...storage('ab.lib.' + pid, emptyLib()) }; }
  async saveLibrary(pid, lib) { store('ab.lib.' + pid, lib); }
  // Fine-grained ops are no-ops locally: the facade persists the whole library object via saveLibrary().
  async addToList() {} async removeFromList() {} async saveProgress() {} async clearProgress() {} async setReminder() {}
  async plans() { return PLANS_FALLBACK; }
  async subscribe(planId) { const s = { planId, status: 'active', demo: true, startedAt: new Date().toISOString() }; store('ab.sub', s); return s; }
  async cancelSubscription() { const s = { planId: 'free', status: 'active' }; store('ab.sub', s); return s; }
  async signUp() { throw new ApiError(400, 'Accounts need the ADDABAAZ API (see docs/ARCHITECTURE.md).'); }
  signIn() { return this.signUp(); }
  async signOut() {}
  async deleteAccount() { Object.keys(localStorage).filter((k) => k.startsWith('ab.')).forEach((k) => localStorage.removeItem(k)); }
  async submitContact() { throw new ApiError(400, 'no-api'); }
}

export class RemoteAdapter {
  mode = 'remote';
  supportsAuth = true;
  constructor(api) { this.api = api; }
  async init() {
    if (!this.api.token) return { account: null, profiles: [], subscription: { planId: 'free', status: 'active' } };
    try {
      const me = await this.api.get('/me');
      return { account: me.user, profiles: me.profiles, subscription: me.subscription };
    } catch (e) {
      if (e.status === 401) return { account: null, profiles: [], subscription: { planId: 'free', status: 'active' } };
      throw e;
    }
  }
  async signUp(p) { const r = await this.api.post('/auth/signup', p); this.api.setToken(r.token); return r; }
  async signIn(p) { const r = await this.api.post('/auth/login', p); this.api.setToken(r.token); return r; }
  async signOut() { this.api.setToken(null); }
  async deleteAccount() { await this.api.del('/me'); this.api.setToken(null); }
  async createProfile(p) { return (await this.api.post('/profiles', p)).profile; }
  async updateProfile(id, patch) { return (await this.api.patch(`/profiles/${id}`, patch)).profile; }
  async deleteProfile(id) { await this.api.del(`/profiles/${id}`); }
  async loadLibrary(pid) { return { ...emptyLib(), ...(await this.api.get(`/profiles/${pid}/library`)) }; }
  async saveLibrary() {}
  addToList(pid, type, id) { return this.api.put(`/profiles/${pid}/list/${type}/${encodeURIComponent(id)}`); }
  removeFromList(pid, type, id) { return this.api.del(`/profiles/${pid}/list/${type}/${encodeURIComponent(id)}`); }
  saveProgress(pid, videoId, position, duration) { return this.api.put(`/profiles/${pid}/progress/${encodeURIComponent(videoId)}`, { position, duration }); }
  clearProgress(pid, videoId) { return this.api.del(`/profiles/${pid}/progress/${encodeURIComponent(videoId)}`); }
  setReminder(pid, id, on) { return on ? this.api.put(`/profiles/${pid}/reminders/${id}`) : this.api.del(`/profiles/${pid}/reminders/${id}`); }
  async plans() { try { return (await this.api.get('/plans')).plans; } catch { return PLANS_FALLBACK; } }
  async subscribe(planId) { return (await this.api.post('/subscription', { planId })).subscription; }
  async cancelSubscription() { return (await this.api.del('/subscription'))?.subscription ?? { planId: 'free', status: 'active' }; }
  submitContact(payload) { return this.api.post('/contact', payload); }
}
