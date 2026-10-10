/* Two interchangeable persistence back-ends behind one interface.
 *   LocalAdapter  – everything lives in localStorage on this device (static hosting, offline).
 *   RemoteAdapter – accounts, profiles, list, progress and subscriptions live on the API.
 * The UI only talks to `User` (user.js), never to an adapter directly, so adding e.g. Firebase or
 * Supabase later means writing a third adapter with these same methods. */
import { storage, store, uid } from '../util.js';
import { ApiError } from './api.js';
import { openCheckout } from '../payments.js';

// An empty library: My List, watch progress per video, and reminders.
const emptyLib = () => ({ list: [], progress: {}, reminders: [] });

// Plans shown when there is no API (static mode). Keep in sync with server/src/plans.js; in API mode the server's list is used instead.
export const PLANS_FALLBACK = [
  { id: 'free', name: 'Free', priceINR: 0, interval: 'forever', features: ['All free episodes & reels', 'Watch on any device', 'My List & Continue Watching'] },
  { id: 'plus-monthly', name: 'ADDABAAZ Premium', priceINR: 99, interval: 'month', features: ['Everything in Free', 'Premium originals & early access', 'Ad-free viewing', 'Up to 5 profiles'] },
  { id: 'plus-yearly', name: 'ADDABAAZ Premium (Yearly)', priceINR: 799, interval: 'year', features: ['Everything in Premium', '2 months free'] },
];

// Billing capabilities in local mode: none.
const NO_BILLING = { gst: false, coupons: false, states: [] };

// LOCAL mode: guest data lives in this browser's localStorage. Anything needing an account or server throws a friendly ApiError.
export class LocalAdapter {
  mode = 'local';
  supportsAuth = false;
  // Returns the starting state: no account, at least one local profile, free plan.
  async init() {
    let profiles = storage('ab.profiles', null);
    if (!profiles?.length) { profiles = [{ id: uid(), name: 'Me', color: 0 }]; store('ab.profiles', profiles); }
    return { account: null, profiles, subscription: { planId: 'free', status: 'active' } };
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
  // The whole library object is saved with saveLibrary(), so the per-item operations do nothing here.
  async addToList() {} async removeFromList() {} async saveProgress() {} async clearProgress() {} async setReminder() {}
  async plans() { return { plans: PLANS_FALLBACK, payments: { provider: 'none' }, billing: NO_BILLING }; }
  async quote() { throw Object.assign(new ApiError(400, 'Coupons aren’t available right now.'), {}); }
  async billingHistory() { return []; }
  async invoiceBlob() { throw new ApiError(400, 'Invoices aren’t available right now.'); }
  async emailInvoice() { throw new ApiError(400, 'Invoices aren’t available right now.'); }
  async checkout() { throw new ApiError(400, 'Subscriptions aren’t available right now — check your connection and try again.'); }
  async cancelSubscription() { return { planId: 'free', status: 'active' }; }
  async signUp() { throw new ApiError(400, 'Creating an account needs a connection to ADDABAAZ — check your internet and try again.'); }
  signIn() { return this.signUp(); }
  async signOut() {}
  async deleteAccount() { Object.keys(localStorage).filter((k) => k.startsWith('ab.')).forEach((k) => localStorage.removeItem(k)); }
  async submitContact() { throw new ApiError(400, 'This form needs a connection to ADDABAAZ — check your internet and try again.'); }
  // Support tickets and phone sign-in need the server (the UI hides them in local mode).
  async requestOtp() { throw new ApiError(400, 'Sign-in by SMS needs a connection to ADDABAAZ.'); }
  async verifyOtp() { return this.requestOtp(); }
  async submitTicket() { return this.submitContact(); }
  async myTickets() { return { tickets: [] }; }
  async ticket() { throw new ApiError(400, 'Support tickets need a connection to ADDABAAZ — check your internet and try again.'); }
  async lookupTicket() { return this.ticket(); }
  async replyTicket() { return this.submitTicket(); }
  // Features that need the server are simply absent in local mode (the UI checks `user.supportsAuth`).
  async myRatings() { return {}; } async ratingCounts() { return { up: 0, down: 0 }; }
  // Promotions live on the account, so without a server there is nothing to show or spend.
  async promo() { return { offer: null, viewer: null }; }
  async credits() { throw new ApiError(400, 'Credit and invites need a connection to ADDABAAZ.'); }
  async redeemInvite() { return this.credits(); }
  async inviteLink() { return this.credits(); }
}

// The parental PIN travels in a header for profile changes.
const pinHeader = (pin) => (pin ? { 'X-Parental-Pin': String(pin) } : {});

// REMOTE mode: every method is one call to the ADDABAAZ API (see docs/openapi.yaml). No state is kept here besides the cached providers list.
export class RemoteAdapter {
  mode = 'remote';
  supportsAuth = true;
  constructor(api) { this.api = api; }
  // Restore the session from the saved token: GET /me. A 401 (expired token) just means "signed out".
  async init() {
    if (!this.api.token) return { account: null, profiles: [], subscription: { planId: 'free', status: 'active' } };
    try {
      const me = await this.api.get('/me');
      return { account: { ...me.user, providers: me.providers || [], hasPassword: me.hasPassword !== false, hasPin: !!me.hasPin }, profiles: me.profiles, subscription: me.subscription };
    } catch (e) {
      if (e.status === 401) return { account: null, profiles: [], subscription: { planId: 'free', status: 'active' } };
      throw e;
    }
  }
  async signUp(p) { const r = await this.api.post('/auth/signup', p); this.api.setToken(r.token); return r; }
  async signIn(p) { const r = await this.api.post('/auth/login', p); this.api.setToken(r.token); return r; }
  /** Google / Facebook: the API verifies the provider credential and returns our own session. */
  async signInSocial(provider, credential, ref = '') {
    if (provider === 'apple') return this.signInApple(credential.identityToken, credential.name, ref);
    // Native Google hands over a one-time ticket (the OAuth dance happened in a Custom Tab).
    const r = credential?.ticket
      ? await this.api.post('/auth/ticket', { ticket: credential.ticket })
      : await this.api.post(`/auth/${provider}`, { ...(provider === 'google' ? { idToken: credential } : { accessToken: credential }), ...(ref ? { ref } : {}) });
    this.api.setToken(r.token); return r;
  }
  async providers() { try { return this.#providers ||= await this.api.get('/auth/providers'); } catch { return { password: true }; } }
  #providers = null;
  /** Signed URL for a video stored in Cloudflare R2 (the API decides whether this viewer may watch it). */
  streamUrl(videoId) { return this.api.post(`/videos/${encodeURIComponent(videoId)}/stream`); }
  async signOut() { this.api.setToken(null); }
  async deleteAccount() { await this.api.del('/me'); this.api.setToken(null); }
  async createProfile(p, pin) { return (await this.api.post('/profiles', p, { headers: pinHeader(pin) })).profile; }
  async updateProfile(id, patch, pin) { return (await this.api.patch(`/profiles/${id}`, patch, { headers: pinHeader(pin) })).profile; }
  async deleteProfile(id, pin) { await this.api.del(`/profiles/${id}`, undefined, { headers: pinHeader(pin) }); }
  async loadLibrary(pid) { return { ...emptyLib(), ...(await this.api.get(`/profiles/${pid}/library`)) }; }
  async saveLibrary() {}
  addToList(pid, type, id) { return this.api.put(`/profiles/${pid}/list/${type}/${encodeURIComponent(id)}`); }
  removeFromList(pid, type, id) { return this.api.del(`/profiles/${pid}/list/${type}/${encodeURIComponent(id)}`); }
  saveProgress(pid, videoId, position, duration) { return this.api.put(`/profiles/${pid}/progress/${encodeURIComponent(videoId)}`, { position, duration }); }
  clearProgress(pid, videoId) { return this.api.del(`/profiles/${pid}/progress/${encodeURIComponent(videoId)}`); }
  setReminder(pid, id, on) { return on ? this.api.put(`/profiles/${pid}/reminders/${id}`) : this.api.del(`/profiles/${pid}/reminders/${id}`); }
  async plans() { try { const r = await this.api.get('/plans'); return { plans: r.plans, payments: r.payments || { provider: 'none' }, billing: r.billing || NO_BILLING }; } catch { return { plans: PLANS_FALLBACK, payments: { provider: 'none' }, billing: NO_BILLING }; } }
  async quote(planId, couponCode, useCredit = false) { return (await this.api.post('/payments/quote', { planId, couponCode, ...(useCredit ? { useCredit: true } : {}) })).quote; }
  async billingHistory() { return (await this.api.get('/billing')).payments; }
  invoiceBlob(id) { return this.api.blob(`/invoices/${encodeURIComponent(id)}/pdf`); }
  async emailInvoice(id) { await this.api.post(`/invoices/${encodeURIComponent(id)}/email`); }
  /** Buy / renew a plan. Razorpay: server creates the order → Checkout takes the payment → server verifies the signature.
   *  Rejects with `.cancelled` if the viewer closes the payment window. Resolves with the new subscription. */
  async checkout(planId, { couponCode, billing, useCredit = false } = {}) {
    const c = await this.api.post('/payments/checkout', { planId, couponCode: couponCode || undefined, billing, ...(useCredit ? { useCredit: true } : {}) });
    // Nothing to pay when a 100%-off coupon or the viewer's credit covered the price.
    if (c.provider === 'mock' || c.provider === 'coupon' || c.provider === 'credit') return c.subscription;
    const paid = await openCheckout(c);
    return (await this.api.post('/payments/verify', { orderId: paid.razorpay_order_id, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature })).subscription;
  }
  async cancelSubscription() { return (await this.api.del('/subscription'))?.subscription ?? { planId: 'free', status: 'active' }; }
  submitContact(payload) { return this.api.post('/contact', payload); }

  /* ----- promotional credit & referrals (see server/src/promos.js) ----- */
  promo() { return this.api.get('/promo'); }
  credits() { return this.api.get('/credits'); }
  redeemInvite(code) { return this.api.post('/promo/redeem', { code }); }
  inviteLink() { return this.api.get('/promo/link'); }

  /* ----- phone sign-in (SMS OTP) and the support desk ----- */
  requestOtp(phone, ref = '') { return this.api.post('/auth/otp/request', { phone, ...(ref ? { ref } : {}) }); }
  async verifyOtp(phone, code, name, ref = '') { const r = await this.api.post('/auth/otp/verify', { phone, code, name, ...(ref ? { ref } : {}) }); this.api.setToken(r.token); return r; }
  submitTicket(payload) { return this.api.post('/support/tickets', payload); }
  myTickets({ limit = 25, offset = 0 } = {}) { return this.api.get(`/support/tickets?limit=${limit}&offset=${offset}`); }
  ticket(id, email = '') { return this.api.get(`/support/tickets/${encodeURIComponent(id)}${email ? `?email=${encodeURIComponent(email)}` : ''}`); }
  lookupTicket(reference, email) { return this.api.post('/support/lookup', { reference, email }); }
  replyTicket(id, body, email = '') { return this.api.post(`/support/tickets/${encodeURIComponent(id)}/replies`, { body, email }); }

  /* ----- account security ----- */
  async signInApple(identityToken, name, ref = '') { const r = await this.api.post('/auth/apple', { identityToken, name, ...(ref ? { ref } : {}) }); this.api.setToken(r.token); return r; }
  forgotPassword(email) { return this.api.post('/auth/forgot', { email }); }
  async resetPassword(token, password) { const r = await this.api.post('/auth/reset', { token, password }); this.api.setToken(r.token); return r; }
  verifyEmail(token) { return this.api.post('/auth/verify', { token }); }
  verifyAccountEmail(token) { return this.api.post('/auth/email-change/verify', { token }); }
  resendVerification() { return this.api.post('/me/verify/resend'); }
  requestPhoneLink(phone) { return this.api.post('/me/phone/request', { phone }); }
  verifyPhoneLink(phone, code) { return this.api.post('/me/phone/verify', { phone, code }); }
  updateAccountName(name) { return this.api.patch('/me', { name }); }
  requestAccountEmail(email) { return this.api.post('/me/email', { email }); }
  async changePassword(currentPassword, newPassword) { const r = await this.api.post('/me/password', { currentPassword, newPassword }); this.api.setToken(r.token); return r; }
  async signOutEverywhere() { const r = await this.api.post('/me/sessions/revoke'); this.api.setToken(r.token); return r; }

  /* ----- parental PIN & devices ----- */
  setPin(pin, currentPin) { return this.api.put('/me/pin', { pin, currentPin }); }
  removePin(pin) { return this.api.del('/me/pin', { pin }); }
  forgotPin() { return this.api.post('/me/pin/forgot'); }
  resetPin(token, pin) { return this.api.post('/auth/pin/reset', { token, pin }); }
  verifyPin(pin) { return this.api.post('/me/pin/verify', { pin }); }
  devices() { return this.api.get('/me/devices'); }
  forgetDevice(id) { return this.api.del(`/me/devices/${encodeURIComponent(id)}`); }
  heartbeat(videoId) { return this.api.post('/playback/heartbeat', { videoId }); }
  stopPlayback() { return this.api.post('/playback/stop'); }

  /* ----- ratings ----- */
  async myRatings(pid) { return (await this.api.get(`/profiles/${pid}/ratings`)).ratings || {}; }
  ratingCounts(type, id) { return this.api.get(`/ratings/${type}/${encodeURIComponent(id)}`); }
  rate(pid, type, id, value) { return value ? this.api.put(`/profiles/${pid}/ratings/${type}/${encodeURIComponent(id)}`, { value }) : this.api.del(`/profiles/${pid}/ratings/${type}/${encodeURIComponent(id)}`); }
  /* ----- push, refunds, analytics ----- */
  pushConfig() { return this.api.get('/push/config').catch(() => ({ enabled: false })); }
  pushSubscribe(subscription, prefs) { return this.api.post('/push/subscribe', { subscription, prefs }); }
  pushStatus(endpoint) { return this.api.post('/push/status', { endpoint }); }
  pushPrefs(endpoint, prefs) { return this.api.patch('/push/prefs', { endpoint, ...prefs }); }
  pushUnsubscribe(endpoint) { return this.api.post('/push/unsubscribe', { endpoint }); }
  // Native apps: account-linked and anonymous guest tokens (Admin → Broadcast sends to these).
  // `prefs` carries the same three notification choices the browser has (episodes / launches / news).
  registerDevice(token, platform = 'android', label = null, prefs = null) { return this.api.post('/devices', { token, platform, label, prefs }); }
  removeDevice(token) { return this.api.del('/devices', { token }); }
  registerGuestDevice(token, platform = 'android', label = null, prefs = null) { return this.api.post('/devices/guest', { token, platform, label, prefs }); }
  removeGuestDevice(token) { return this.api.del('/devices/guest', { token }); }
  // NOTE: no `devices()` here — that name belongs to the playback list above (GET /me/devices).
  // A duplicate `devices()` for GET /devices (push registrations) used to shadow it, which broke the
  // "Your Devices" dialog: no deviceId → Remove called DELETE /me/devices/ → 404 "Unknown endpoint."
  deviceStatus(token) { return this.api.post('/devices/status', { token }); }
  devicePrefs(token, prefs) { return this.api.patch('/devices/prefs', { token, ...prefs }); }
  requestRefund(paymentId, reason) { return this.api.post(`/payments/${encodeURIComponent(paymentId)}/refund-request`, { reason }); }
  refundRequests() { return this.api.get('/refund-requests'); }
  playEvent(videoId, event, seconds) { this.api.beacon('/events/play', { videoId, event, seconds }); }
  reportError(e) { this.api.beacon('/client-errors', e); }
}
