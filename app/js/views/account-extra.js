/* The profile page's settings groups: each group draws on its own sub-page (app/js/views/settings.js)
 * behind /account/<group>; the profile page itself only lists them. Visibility follows the session:
 * local mode and guests see a shorter list, signed-in accounts the full one. */
import { forgotParentalPin } from '../ui/parental.js';
import { app } from '../app.js';
import { html, $, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { toast, emptyState } from '../ui/components.js';
import { openDialog, confirmDialog, pinPrompt } from '../ui/dialog.js';
import { pushState, enablePush, disablePush, setPushPrefs, pushSupported } from '../push.js';
import { friendly } from '../errors.js';
import { go } from '../router.js';
import { isNative } from '../platform.js';

// [id, title, subtitle, icon, who sees it ('all' | 'auth' | 'account'), link override for rows that leave the page]
const GROUPS = [
  ['playback', 'Playback', 'Autoplay and Watch History', 'play', 'all'],
  ['security', 'Security', 'Password, Sessions and Devices', 'lock', 'account'],
  ['kids', 'Parental Control', 'Parental PIN and Kids Profiles', 'user', 'account'],
  ['notify', 'Notifications', 'Episode, Launch and Announcement Alerts', 'bell', 'auth'],
  ['refer', 'Refer & Earn', 'Invite Credit and Rewards', 'gift', 'account'],
  ['help', 'Help & Support', 'Help Centre and Contact Us', 'chat', 'all', '#/support'],
];

/** The rows the profile page lists for this viewer: [{ id, title, sub, ic, href }]. */
export function settingGroups() {
  const u = app.user;
  return GROUPS.filter(([, , , , vis]) => vis === 'all' || (vis === 'auth' && u.supportsAuth) || (vis === 'account' && u.account))
    .map(([id, title, sub, ic, , href]) => ({ id, title, sub, ic, href: href || `#/account/${id}` }));
}

/** The confirm-your-email strip; the profile page keeps it above the list so it is never missed. */
export function verifyBanner() {
  const acc = app.user.account;
  if (!acc || acc.emailVerified !== false) return '';
  return html`<section class="card-panel notice" id="verifyBanner"><div>${icon('mail', { size: 22 })}</div><div><b>Confirm Your Email</b><p class="muted">We sent a link to ${acc.email}. Confirming your email lets you buy a plan.</p></div><button class="btn btn-primary" id="resendVerify">Resend Link</button></section>`;
}

// Settings row markup (icon, label, sub-label) that opens a dialog when clicked.
const row = (id, ic, label, sub) => html`<button class="row-link" id="${id}">${icon(ic, { size: 22 })}<span><b>${label}</b>${sub ? html`<small>${sub}</small>` : ''}</span>${icon('right', { size: 18, cls: 'chev' })}</button>`;

// Shared notification control for account settings and connected guest settings. Native guest
// notifications are general broadcasts only; local profile/list data never leaves the device.
function wireNotifications(root, { guest = false, onCleanup = null } = {}) {
  const slot = $('#notifySlot', root); if (!slot) return;
  const draw = (s) => {
    // The slot is a whole sub-page now, so an unavailable state explains itself instead of hiding —
    // with the actual reason: the browser can't do push (iPhone Safari tabs, very old browsers), the
    // viewer is signed out, or the server hasn't switched notifications on.
    if (!s?.supported || !s.enabled) {
      const u = app.user;
      const state = !s?.supported && !pushSupported() && !isNative
        ? { title: 'Notifications Unavailable', text: 'This browser can’t receive push notifications — install the ADDABAAZ app to get episode, launch and announcement alerts.' }
        : !s?.supported && !u?.account
          ? { title: 'Sign In for Notifications', text: 'Episode, launch and announcement alerts need an account to target.', action: html`<a class="btn btn-primary" href="#/signin">Sign In</a>` }
          : { title: 'Notifications Unavailable', text: 'Notifications aren’t switched on right now — check back later.' };
      slot.innerHTML = emptyState({ iconName: 'bell', ...state }).s;
      return;
    }
    const blocked = s.permission === 'denied'
      ? (s.native ? 'Blocked in Android settings. Allow notifications for ADDABAAZ there.' : 'Blocked in your browser settings.')
      : guest && s.native ? 'General updates only; your local profile and watch data stay on this phone.' : 'New episodes, launches and announcements.';
    // The browser and the app both keep three choices per device (docs/ENGAGEMENT.md): a guest app has no
    // account to link episode/launch notifications to, so it gets the master switch only.
    const topics = s.subscribed && (!s.native || !s.guest);
    slot.innerHTML = html`<h2 class="sub-h">Notifications</h2><div class="card-panel list">
      <label class="row-switch"><span><b>Notify Me on This Device</b><small>${blocked}</small></span><span class="switch"><input type="checkbox" id="pushOn" ${s.subscribed ? 'checked' : ''} ${s.permission === 'denied' ? 'disabled' : ''}><span class="track"></span></span></label>
      ${topics ? html`<label class="row-switch"><span><b>New Episodes of Shows I Follow</b></span><span class="switch"><input type="checkbox" data-pp="episodes" ${s.prefs.episodes ? 'checked' : ''}><span class="track"></span></span></label>
        <label class="row-switch"><span><b>When a Coming Soon Title Launches</b></span><span class="switch"><input type="checkbox" data-pp="launches" ${s.prefs.launches ? 'checked' : ''}><span class="track"></span></span></label>
        <label class="row-switch"><span><b>Announcements &amp; Offers</b></span><span class="switch"><input type="checkbox" data-pp="news" ${s.prefs.news ? 'checked' : ''}><span class="track"></span></span></label>` : ''}</div>`.s;
  };
  const refresh = () => pushState().then(draw).catch(() => {});
  const unsubscribe = app.user.on('push', refresh);
  onCleanup?.(unsubscribe);
  refresh();
  slot.addEventListener('change', async (e) => {
    try {
      if (e.target.id === 'pushOn') { if (e.target.checked) await enablePush(); else await disablePush(); }
      else if (e.target.dataset.pp) await setPushPrefs({ [e.target.dataset.pp]: e.target.checked });
      await refresh();
    } catch (err) { toast(friendly(err)); await refresh(); }
  });
}

/**
 * "Refer & earn": the viewer's own invite code, their credit balance, who joined with their link and a box
 * to add a friend's code. Filled in asynchronously (like the notifications slot) so a slow API — or the
 * offer being switched off — never delays the settings page.
 */
function wireReferral(root) {
  const u = app.user;
  const slot = $('#referSlot', root); if (!slot) return;
  slot.innerHTML = html`<h2 class="sub-h">Refer &amp; Earn</h2><div class="card-panel"><div class="spinner" style="margin:14px auto"></div></div>`.s;
  const draw = async () => {
    let data = null;
    try { data = await u.credits(); } catch { /* the section shows the empty state below */ }
    if (!data || !data.offer?.enabled || (!data.offer.referralPaise && !data.creditPaise)) {
      slot.innerHTML = emptyState({ iconName: 'gift', title: 'Refer & Earn Is Off', text: 'There is no invite offer running right now — check back later.' }).s;
      return;
    }
    const inr = (p) => `₹${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
    let share = null;
    try { share = await u.inviteLink(); } catch { /* the code alone is enough */ }
    const code = share?.code || '';
    const link = share?.link || '';
    slot.innerHTML = html`<h2 class="sub-h">Refer &amp; Earn</h2>
      <div class="card-panel refer-card">
        <div class="refer-head">${icon('gift', { size: 22 })}<div><b>${inr(data.offer.referralPaise)} for you and ${inr(data.offer.referralPaise)} for your friend</b>
          <small>${data.offer.hold === 'signup' ? 'Credit lands as soon as they sign up.' : data.offer.hold === 'payment' ? 'Your reward unlocks after their first payment.' : 'Your reward unlocks when they confirm their email or phone.'}</small></div></div>
        <div class="refer-bal">${inr(data.creditPaise)}${data.pendingPaise || data.heldPaise ? html` <small>+ ${inr((data.pendingPaise || 0) + (data.heldPaise || 0))} on hold</small>` : ''}<em>Credit Available</em></div>
        ${data.heldPaise ? html`<p class="fine fine-left">${inr(data.heldPaise)} is held by an order that was not completed — it comes back automatically.</p>` : ''}
        ${code ? html`<label>Your Invite Code<span class="co-row"><input id="refCode" readonly value="${code}"><button class="btn btn-ghost" type="button" data-copy="${code}">Copy</button></span></label>
          <label>Your Invite Link<span class="co-row"><input id="refLink" readonly value="${link}"><button class="btn btn-ghost" type="button" data-copy="${link}">Copy</button></span></label>` : ''}
        <div class="row"><button class="btn btn-ghost btn-sm" id="refShare" type="button">${icon('share', { size: 16 })} Share Invite</button></div>
        ${data.invited?.items?.length ? html`<ul class="dev-list">${data.invited.items.map((f) => html`<li><span>${icon('user', { size: 20 })}</span><div><b>${f.name}</b><small>${f.status === 'completed' ? `Reward unlocked · ${timeAgo(f.completedAt)}` : 'Waiting for them to confirm'}</small></div><b class="muted">+${inr(f.bonusPaise)}</b></li>`)}</ul>` : html`<p class="fine fine-left">Nobody has joined with your code yet — share your link on WhatsApp.</p>`}
        ${data.canRedeem ? html`<label>Have a Friend’s Invite Code?<span class="co-row"><input id="refRedeem" maxlength="12" autocapitalize="characters" placeholder="e.g. AB12CD34"><button class="btn btn-primary" type="button" id="refApply">Apply</button></span></label>` : ''}
        ${data.referredBy ? html`<p class="fine fine-left">You joined with a friend’s invite — ${data.referredBy.status === 'completed' ? 'their reward is unlocked.' : 'your first confirmation unlocks their reward.'}</p>` : ''}
        ${data.ledger?.length ? html`<details class="refer-ledger"><summary>Credit History</summary><ul>${data.ledger.map((r) => html`<li><span>${r.reason || r.label}</span><b class="${r.amountPaise < 0 ? 'muted' : ''}">${r.amountPaise < 0 ? '' : '+'}${inr(Math.abs(r.amountPaise))}</b></li>`)}</ul></details>` : ''}
      </div>`.s;
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy the code from the box'); } };
  slot.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) return copy(c.dataset.copy);
    if (e.target.closest('#refShare')) {
      const link = $('#refLink', slot)?.value || '';
      const text = `Join me on ADDABAAZ${link ? ` — ${link}` : ''}`;
      try { if (navigator.share) await navigator.share({ title: 'ADDABAAZ', text, url: link || undefined }); else return copy(text); }
      catch { /* the viewer dismissed the share sheet */ }
      return;
    }
    const b = e.target.closest('#refApply'); if (!b) return;
    const input = $('#refRedeem', slot), code = String(input?.value || '').trim();
    if (!code) return;
    b.disabled = true;
    try { const r = await u.redeemInvite(code); toast(r.message || 'Invite applied'); await draw(); }
    catch (err) { toast(friendly(err)); b.disabled = false; }
  });
  draw();
}

function playbackSection() {
  const u = app.user;
  return html`<section class="account-section">
    <h2 class="sub-h">Playback</h2>
    <div class="card-panel list">
      <label class="row-switch"><span><b>Autoplay Next Episode</b><small>Keep watching without lifting a finger.</small></span><span class="switch"><input type="checkbox" id="autoNext" ${u.pref('autoplayNext') ? 'checked' : ''}><span class="track"></span></span></label>
    </div>
  </section>`;
}

function securitySection() {
  const acc = app.user.account;
  if (!acc) return '';
  const signInMethod = acc.phoneVerified
    ? html`<div class="row-link static">${icon('phone', { size: 22 })}<span><b>SMS Sign-In</b><small>Use your verified mobile number and one-time code to sign in.</small></span></div>
        ${acc.emailIsPlaceholder ? '' : row('chgPw', 'lock', acc.hasPassword === false ? 'Set a Password' : 'Change Password', acc.hasPassword === false ? 'Add a password to also sign in with your confirmed email.' : 'Signs you out on your other devices.')}`
    : row('chgPw', 'lock', acc.hasPassword === false ? 'Set a Password' : 'Change Password', acc.hasPassword === false ? 'You signed up with a social account — add a password too.' : 'Signs you out on your other devices.');
  const contactEmail = acc.phoneVerified ? html`
    <section class="account-section">
      <h2 class="sub-h">${acc.emailIsPlaceholder ? 'Contact Email' : 'Update Contact Email'}</h2>
      <div class="card-panel">
        <p class="muted">${acc.emailIsPlaceholder ? 'Add an email address you can access. We’ll send a one-time confirmation link. Your SMS sign-in stays the same, and this address won’t be used for billing or account emails until you confirm it.' : 'You can replace your confirmed contact email. Your current address remains active for account and billing emails until you confirm the replacement; SMS sign-in stays the same.'}</p>
        <form class="form" id="contactEmailForm" novalidate>
          <label>Email Address<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label>
          <div class="form-status" id="contactEmailStatus" role="status" aria-live="polite"></div>
          <button class="btn btn-primary" type="submit">${acc.emailIsPlaceholder ? 'Send Confirmation Link' : 'Send Email-Change Link'}</button>
        </form>
      </div>
    </section>` : '';
  return html`${contactEmail}<section class="account-section">
    <h2 class="sub-h">Security</h2>
    <div class="card-panel list">
      ${signInMethod}
      ${row('signOutAll', 'logout', 'Sign Out of Other Devices', 'Signs out every other phone, TV and browser. This device stays signed in.')}
      ${row('devices', 'tv', 'Your Devices', 'See where you’re watching and how many screens your plan allows.')}
    </div>
  </section>`;
}

function kidsSection() {
  const u = app.user;
  if (!u.account) return '';
  return html`<section class="account-section">
    <h2 class="sub-h">Parental Control</h2>
    <div class="card-panel list">
      ${row('pinBtn', 'lock', u.hasPin ? 'Change or Remove Parental PIN' : 'Set a Parental PIN', u.hasPin ? 'Needed to leave a Kids profile or change profiles.' : 'Keeps children on their Kids profile and stops profile changes.')}
    </div>
  </section>`;
}

/** The sub-page body for a group id, or '' when the id has no section (Help leaves the page). */
export function settingSection(id) {
  if (id === 'playback') return playbackSection();
  if (id === 'security') return securitySection();
  if (id === 'kids') return kidsSection();
  if (id === 'refer') return html`<div id="referSlot" class="account-section"></div>`;
  if (id === 'notify') return html`<div id="notifySlot" class="account-section"></div>`;
  return '';
}

function wirePlayback(root) {
  const u = app.user;
  $('#autoNext', root).addEventListener('change', (e) => u.setPref('autoplayNext', e.target.checked));
}

function wireSecurity(root) {
  const u = app.user, acc = u.account;
  $('#contactEmailForm', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('input[name="email"]', e.currentTarget), status = $('#contactEmailStatus', root), button = e.currentTarget.querySelector('button[type="submit"]');
    const email = String(input?.value || '').trim();
    if (!email) { status.textContent = 'Enter an email address you can access.'; input?.focus(); return; }
    button.disabled = true; status.textContent = '';
    try {
      await u.remote.requestAccountEmail(email);
      status.textContent = acc.emailIsPlaceholder ? `Confirmation email sent to ${email}. Billing and account emails will use it only after you confirm the link.` : `Confirmation email sent to ${email}. Your current verified address stays active until you confirm the replacement.`;
    } catch (err) { status.textContent = friendly(err); }
    finally { button.disabled = false; }
  });
  $('#chgPw', root)?.addEventListener('click', () => {
    if (acc.hasPassword === false) {
      openDialog(html`<h2>Set a Password</h2><p class="muted">We’ll email <b>${acc.email}</b> a link to choose a password. ${acc.phoneVerified ? 'You can keep signing in by SMS too.' : 'You can keep using your social sign-in too.'}</p><div class="row end"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="sendLink">Email Me the Link</button></div>`, { cls: 'dialog-sm' })
        .el.querySelector('#sendLink').onclick = async (e) => { e.target.disabled = true; try { await u.remote.forgotPassword(acc.email); toast('Link sent — check your inbox.'); e.target.closest('dialog').close(); } catch (err) { toast(friendly(err)); e.target.disabled = false; } };
      return;
    }
    const { el, close } = openDialog(html`<h2>Change Password</h2><form class="form" id="pwf" novalidate>
      <label>Current Password<input name="cur" type="password" autocomplete="current-password" required></label>
      <label>New Password<input name="p1" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters"></label>
      <label>Repeat New Password<input name="p2" type="password" autocomplete="new-password" required minlength="8"></label>
      <div class="form-status" id="pws" role="alert"></div><div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Change Password</button></div></form>`, { cls: 'dialog-sm' });
    $('#pwf', el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target), st = $('#pws', el);
      if (String(f.get('p1')).length < 8) { st.textContent = 'The new password must be at least 8 characters.'; return; }
      if (f.get('p1') !== f.get('p2')) { st.textContent = 'The two new passwords don’t match.'; return; }
      try { await u.changePassword(String(f.get('cur')), String(f.get('p1'))); close(); toast('Password changed. Other devices were signed out.'); } catch (err) { st.textContent = friendly(err); }
    });
  });
  $('#signOutAll', root)?.addEventListener('click', async () => {
    if (await confirmDialog({ icon: 'logout', title: 'Sign out of other devices?', text: 'Every other phone, TV and browser signed in to this account will need to sign in again. This device stays signed in.', confirm: 'Sign Out Other Devices', danger: true })) {
      try { await u.signOutEverywhere(); toast('Signed out of your other devices'); } catch (err) { toast(friendly(err)); }
    }
  });
  $('#devices', root)?.addEventListener('click', async () => {
    const { el } = openDialog(html`<h2>Your Devices</h2><div id="devBody"><div class="spinner" style="margin:20px auto"></div></div><div class="form-status" id="devStatus" role="alert"></div>`, { cls: 'dialog-sm' });
    const draw = async () => {
      try {
        const d = await u.remote.devices();
        $('#devBody', el).innerHTML = html`${d.streamLimit > 0 ? html`<p class="muted">Your plan allows ${d.streamLimit} screen${d.streamLimit === 1 ? '' : 's'} watching premium titles at once.</p>` : ''}
          <ul class="dev-list">${d.devices.length ? d.devices.map((x) => html`<li><span>${icon('tv', { size: 22 })}</span><div><b>${x.label || 'Device'}${x.current ? html` <em class="pill">This device</em>` : ''}</b><small>${x.watching ? 'Watching now' : `Last active ${timeAgo(x.lastSeen)}`}</small></div>${x.current ? '' : html`<button class="btn btn-ghost btn-sm" type="button" data-forget="${x.deviceId}">Remove</button>`}</li>`) : html`<li class="muted">No devices yet — they appear after you watch a premium title.</li>`}</ul>`.s;
      } catch (err) { $('#devBody', el).textContent = friendly(err); }
    };
    // Errors surface INSIDE the dialog: a toast would be hidden behind the modal (top layer), and the
    // button re-enables on failure so a network blip never leaves Remove permanently dead.
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-forget]'); if (!b) return;
      b.disabled = true;
      const status = $('#devStatus', el); if (status) status.textContent = '';
      try { await u.remote.forgetDevice(b.dataset.forget); await draw(); }
      catch (err) { b.disabled = false; const m = friendly(err); if (status) status.textContent = m; else toast(m); }
    });
    draw();
  });
}

function wireKids(root) {
  const u = app.user;
  $('#pinBtn', root)?.addEventListener('click', async () => {
    if (!u.hasPin) {
      const pin = await pinPrompt({ title: 'Set a Parental PIN', text: 'Choose 4–6 digits. You’ll need it to leave a Kids profile or change profiles.', confirm: 'Set PIN', check: (p) => u.setPin(p) });
      if (pin) { toast('Parental PIN set'); location.reload(); }
      return;
    }
    const { el, close } = openDialog(html`<h2>Parental PIN</h2><div class="stack-sm"><button class="btn btn-ghost block" id="pinChange">Change PIN</button><button class="btn btn-danger block" id="pinRemove">Remove PIN</button><button class="linklike" id="pinForgot">Forgot PIN?</button></div>`, { cls: 'dialog-sm' });
    $('#pinForgot', el).onclick = () => { close(); forgotParentalPin(u); };
    $('#pinChange', el).onclick = async () => {
      close(); const cur = await pinPrompt({ title: 'Current PIN', check: (p) => u.verifyPin(p), onForgot: () => forgotParentalPin(u) }); if (!cur) return;
      const pin = await pinPrompt({ title: 'New PIN', text: '4–6 digits.', confirm: 'Save', check: (p) => u.setPin(p) }); if (pin) toast('PIN changed');
    };
    $('#pinRemove', el).onclick = async () => {
      close(); const cur = await pinPrompt({ title: 'Remove PIN', text: 'Enter your PIN to remove it.', confirm: 'Remove', check: (p) => u.removePin(p), onForgot: () => forgotParentalPin(u) }); if (cur) { toast('PIN removed'); location.reload(); }
    };
  });
}

export function wireAccountDeletion(root) {
  const u = app.user;
  $('#delAcc', root)?.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Delete your account?', text: 'This cannot be undone. Your account and linked data will be deleted. Payment and invoice records may be kept detached from your account; see the Privacy Policy.', confirm: 'Delete account', danger: true })) {
      try { await u.deleteAccount(); toast('Account deleted'); go('/', { replace: true }); } catch (e) { toast(friendly(e)); }
    }
  });
}

/** Attaches a sub-page's handlers once its section is in the DOM. */
export function wireSetting(id, root, ctx) {
  if (id === 'playback') return wirePlayback(root);
  if (id === 'security') return wireSecurity(root);
  if (id === 'kids') return wireKids(root);
  if (id === 'refer') return wireReferral(root);
  if (id === 'notify' && !app.user.account) return wireNotifications(root, { guest: true, onCleanup: ctx?.onCleanup });
  if (id === 'notify') return wireNotifications(root, { onCleanup: ctx?.onCleanup });
}
