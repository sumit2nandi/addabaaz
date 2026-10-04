/* The account page's newer sections: email confirmation, password & sessions, parental PIN, devices, notifications, privacy. */
import { app } from '../app.js';
import { html, $, fmtDate, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { toast } from '../ui/components.js';
import { openDialog, confirmDialog, pinPrompt } from '../ui/dialog.js';
import { pushState, enablePush, disablePush, setPushPrefs } from '../push.js';
import { openConsentDialog } from '../consent.js';
import { friendly } from '../errors.js';

// Settings row markup (icon, label, sub-label) that opens a dialog when clicked.
const row = (id, ic, label, sub) => html`<button class="row-link" id="${id}">${icon(ic, { size: 22 })}<span><b>${label}</b>${sub ? html`<small>${sub}</small>` : ''}</span>${icon('right', { size: 18, cls: 'chev' })}</button>`;

// Shared notification control for account settings and connected guest settings. Native guest
// notifications are general broadcasts only; local profile/list data never leaves the device.
function wireNotifications(root, { guest = false, onCleanup = null } = {}) {
  const slot = $('#notifySlot', root); if (!slot) return;
  const draw = (s) => {
    if (!s?.supported || !s.enabled) { slot.innerHTML = ''; return; }
    const blocked = s.permission === 'denied'
      ? (s.native ? 'Blocked in Android settings. Allow notifications for ADDABAAZ there.' : 'Blocked in your browser settings.')
      : guest && s.native ? 'General updates only; your local profile and watch data stay on this phone.' : 'New episodes, launches and announcements.';
    // The browser and the app both keep three choices per device (docs/ENGAGEMENT.md): a guest app has no
    // account to link episode/launch notifications to, so it gets the master switch only.
    const topics = s.subscribed && (!s.native || !s.guest);
    slot.innerHTML = html`<h2 class="sub-h">Notifications</h2><div class="card-panel list">
      <label class="row-switch"><span><b>Notify me on this device</b><small>${blocked}</small></span><span class="switch"><input type="checkbox" id="pushOn" ${s.subscribed ? 'checked' : ''} ${s.permission === 'denied' ? 'disabled' : ''}><span class="track"></span></span></label>
      ${topics ? html`<label class="row-switch"><span><b>New episodes of shows I follow</b></span><span class="switch"><input type="checkbox" data-pp="episodes" ${s.prefs.episodes ? 'checked' : ''}><span class="track"></span></span></label>
        <label class="row-switch"><span><b>When a Coming Soon title launches</b></span><span class="switch"><input type="checkbox" data-pp="launches" ${s.prefs.launches ? 'checked' : ''}><span class="track"></span></span></label>
        <label class="row-switch"><span><b>Announcements &amp; offers</b></span><span class="switch"><input type="checkbox" data-pp="news" ${s.prefs.news ? 'checked' : ''}><span class="track"></span></span></label>` : ''}</div>`.s;
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
 * offer being switched off — never delays the account page.
 */
function wireReferral(root) {
  const u = app.user;
  const slot = $('#referSlot', root); if (!slot) return;
  slot.innerHTML = html`<h2 class="sub-h">Refer &amp; earn</h2><div class="card-panel"><div class="spinner" style="margin:14px auto"></div></div>`.s;
  const draw = async () => {
    let data = null;
    try { data = await u.credits(); } catch { /* the section simply stays hidden */ }
    if (!data || !data.offer?.enabled || (!data.offer.referralPaise && !data.creditPaise)) { slot.innerHTML = ''; return; }
    const inr = (p) => `₹${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
    let share = null;
    try { share = await u.inviteLink(); } catch { /* the code alone is enough */ }
    const code = share?.code || '';
    const link = share?.link || '';
    slot.innerHTML = html`<h2 class="sub-h">Refer &amp; earn</h2>
      <div class="card-panel refer-card">
        <div class="refer-head">${icon('gift', { size: 22 })}<div><b>${inr(data.offer.referralPaise)} for you and ${inr(data.offer.referralPaise)} for your friend</b>
          <small>${data.offer.hold === 'signup' ? 'Credit lands as soon as they sign up.' : data.offer.hold === 'payment' ? 'Your reward unlocks after their first payment.' : 'Your reward unlocks when they confirm their email or phone.'}</small></div></div>
        <div class="refer-bal">${inr(data.creditPaise)}${data.pendingPaise || data.heldPaise ? html` <small>+ ${inr((data.pendingPaise || 0) + (data.heldPaise || 0))} on hold</small>` : ''}<em>credit available</em></div>
        ${data.heldPaise ? html`<p class="fine fine-left">${inr(data.heldPaise)} is held by an order that was not completed — it comes back automatically.</p>` : ''}
        ${code ? html`<label>Your invite code<span class="co-row"><input id="refCode" readonly value="${code}"><button class="btn btn-ghost" type="button" data-copy="${code}">Copy</button></span></label>
          <label>Your invite link<span class="co-row"><input id="refLink" readonly value="${link}"><button class="btn btn-ghost" type="button" data-copy="${link}">Copy</button></span></label>` : ''}
        <div class="row"><button class="btn btn-ghost btn-sm" id="refShare" type="button">${icon('share', { size: 16 })} Share invite</button></div>
        ${data.invited?.items?.length ? html`<ul class="dev-list">${data.invited.items.map((f) => html`<li><span>${icon('user', { size: 20 })}</span><div><b>${f.name}</b><small>${f.status === 'completed' ? `Reward unlocked · ${timeAgo(f.completedAt)}` : 'Waiting for them to confirm'}</small></div><b class="muted">+${inr(f.bonusPaise)}</b></li>`)}</ul>` : html`<p class="fine fine-left">Nobody has joined with your code yet — share your link on WhatsApp.</p>`}
        ${data.canRedeem ? html`<label>Have a friend’s invite code?<span class="co-row"><input id="refRedeem" maxlength="12" autocapitalize="characters" placeholder="e.g. AB12CD34"><button class="btn btn-primary" type="button" id="refApply">Apply</button></span></label>` : ''}
        ${data.referredBy ? html`<p class="fine fine-left">You joined with a friend’s invite — ${data.referredBy.status === 'completed' ? 'their reward is unlocked.' : 'your first confirmation unlocks their reward.'}</p>` : ''}
        ${data.ledger?.length ? html`<details class="refer-ledger"><summary>Credit history</summary><ul>${data.ledger.map((r) => html`<li><span>${r.reason || r.label}</span><b class="${r.amountPaise < 0 ? 'muted' : ''}">${r.amountPaise < 0 ? '' : '+'}${inr(Math.abs(r.amountPaise))}</b></li>`)}</ul></details>` : ''}
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

/** Returns { banner, sections, wire(root) } — both go into the page, wire() attaches the handlers once it is in the DOM. */
export function accountExtras() {
  const u = app.user, acc = u.account;
  if (!u.supportsAuth) return { banner: '', sections: '', wire() {} };
  if (!acc) {
    return {
      banner: '',
      sections: html`<div id="notifySlot" class="account-section"></div><section class="account-section"><h2 class="sub-h">Privacy</h2><div class="card-panel list">${row('consentBtn', 'info', 'Privacy choices', 'Analytics and stored data.')}<a class="row-link" href="#/privacy">${icon('info', { size: 22 })}<span><b>Privacy Policy</b></span>${icon('right', { size: 18, cls: 'chev' })}</a></div></section>`,
      wire(root, ctx) { $('#consentBtn', root)?.addEventListener('click', openConsentDialog); wireNotifications(root, { guest: true, onCleanup: ctx?.onCleanup }); },
    };
  }
  const verified = acc.emailVerified !== false;
  const banner = verified ? '' : html`<section class="card-panel notice" id="verifyBanner"><div>${icon('mail', { size: 22 })}</div><div><b>Confirm your email</b><p class="muted">We sent a link to ${acc.email}. Confirming lets you buy a plan and post comments.</p></div><button class="btn btn-primary" id="resendVerify">Resend link</button></section>`;
  const sections = html`
    <section class="account-section">
      <h2 class="sub-h">Security</h2>
      <div class="card-panel list">
        ${row('chgPw', 'lock', acc.hasPassword === false ? 'Set a password' : 'Change password', acc.hasPassword === false ? 'You signed up with a social account — add a password too.' : 'Signs you out on your other devices.')}
        ${row('signOutAll', 'logout', 'Sign out everywhere', 'Ends your session on every phone, TV and browser.')}
        ${row('supportBtn', 'chat', 'Help & support', 'Trouble signing in, payments, playback — raise a ticket.')}
        ${row('devices', 'tv', 'Your devices', 'See where you’re watching and how many screens your plan allows.')}
      </div>
    </section>
    <section class="account-section">
      <h2 class="sub-h">Kids &amp; parental controls</h2>
      <div class="card-panel list">
        ${row('pinBtn', 'lock', u.hasPin ? 'Change or remove parental PIN' : 'Set a parental PIN', u.hasPin ? 'Needed to leave a Kids profile or change profiles.' : 'Keeps children on their Kids profile and stops profile changes.')}
        <a class="row-link" href="#/profiles?manage=1">${icon('user', { size: 22 })}<span><b>Kids profiles</b><small>Mark any profile as “Kids” to show only titles rated for children.</small></span>${icon('right', { size: 18, cls: 'chev' })}</a>
      </div>
    </section>
    <div id="referSlot" class="account-section"></div>
    <div id="notifySlot" class="account-section"></div>
    <section class="account-section">
      <h2 class="sub-h">Privacy</h2>
      <div class="card-panel list">${row('consentBtn', 'info', 'Privacy choices', 'Analytics and stored data.')}<a class="row-link" href="#/privacy">${icon('info', { size: 22 })}<span><b>Privacy Policy</b></span>${icon('right', { size: 18, cls: 'chev' })}</a><a class="row-link" href="#/terms">${icon('info', { size: 22 })}<span><b>Terms of Use</b></span>${icon('right', { size: 18, cls: 'chev' })}</a></div>
    </section>`;

  const wire = (root, ctx) => {
    $('#resendVerify', root)?.addEventListener('click', async (e) => { e.target.disabled = true; try { await u.remote.resendVerification(); toast('Sent — check your inbox.'); } catch (err) { toast(friendly(err)); e.target.disabled = false; } });
    $('#consentBtn', root)?.addEventListener('click', openConsentDialog);
    $('#supportBtn', root)?.addEventListener('click', () => { location.hash = '#/support'; });

    $('#chgPw', root)?.addEventListener('click', () => {
      if (acc.hasPassword === false) {
        openDialog(html`<h2>Set a password</h2><p class="muted">We’ll email <b>${acc.email}</b> a link to choose a password. You can keep using your social sign-in too.</p><div class="row end"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="sendLink">Email me the link</button></div>`, { cls: 'dialog-sm' })
          .el.querySelector('#sendLink').onclick = async (e) => { e.target.disabled = true; try { await u.remote.forgotPassword(acc.email); toast('Link sent — check your inbox.'); e.target.closest('dialog').close(); } catch (err) { toast(friendly(err)); e.target.disabled = false; } };
        return;
      }
      const { el, close } = openDialog(html`<h2>Change password</h2><form class="form" id="pwf" novalidate>
        <label>Current password<input name="cur" type="password" autocomplete="current-password" required></label>
        <label>New password<input name="p1" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters"></label>
        <label>Repeat new password<input name="p2" type="password" autocomplete="new-password" required minlength="8"></label>
        <div class="form-status" id="pws" role="alert"></div><div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Change password</button></div></form>`, { cls: 'dialog-sm' });
      $('#pwf', el).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(e.target), st = $('#pws', el);
        if (String(f.get('p1')).length < 8) { st.textContent = 'The new password must be at least 8 characters.'; return; }
        if (f.get('p1') !== f.get('p2')) { st.textContent = 'The two new passwords don’t match.'; return; }
        try { await u.changePassword(String(f.get('cur')), String(f.get('p1'))); close(); toast('Password changed. Other devices were signed out.'); } catch (err) { st.textContent = friendly(err); }
      });
    });
    $('#signOutAll', root)?.addEventListener('click', async () => {
      if (await confirmDialog({ icon: 'logout', title: 'Sign out everywhere?', text: 'Every device signed in to this account — including this one, after you confirm — will need to sign in again.', confirm: 'Sign out everywhere', danger: true })) {
        try { await u.signOutEverywhere(); toast('Signed out on your other devices'); } catch (err) { toast(friendly(err)); }
      }
    });
    $('#devices', root)?.addEventListener('click', async () => {
      const { el } = openDialog(html`<h2>Your devices</h2><div id="devBody"><div class="spinner" style="margin:20px auto"></div></div>`, { cls: 'dialog-sm' });
      const draw = async () => {
        try {
          const d = await u.remote.devices();
          $('#devBody', el).innerHTML = html`<p class="muted">Your plan allows ${d.streamLimit} screen${d.streamLimit === 1 ? '' : 's'} watching premium titles at once.</p>
            <ul class="dev-list">${d.devices.length ? d.devices.map((x) => html`<li><span>${icon('tv', { size: 22 })}</span><div><b>${x.label || 'Device'}${x.current ? html` <em class="pill">This device</em>` : ''}</b><small>${x.watching ? 'Watching now' : `Last active ${timeAgo(x.lastSeen)}`}</small></div>${x.current ? '' : html`<button class="btn btn-ghost btn-sm" data-forget="${x.deviceId}">Remove</button>`}</li>`) : html`<li class="muted">No devices yet — they appear after you watch a premium title.</li>`}</ul>`.s;
        } catch (err) { $('#devBody', el).textContent = friendly(err); }
      };
      el.addEventListener('click', async (e) => { const b = e.target.closest('[data-forget]'); if (!b) return; b.disabled = true; try { await u.remote.forgetDevice(b.dataset.forget); await draw(); } catch (err) { toast(friendly(err)); } });
      draw();
    });

    $('#pinBtn', root)?.addEventListener('click', async () => {
      if (!u.hasPin) {
        const pin = await pinPrompt({ title: 'Set a parental PIN', text: 'Choose 4–6 digits. You’ll need it to leave a Kids profile or change profiles.', confirm: 'Set PIN', check: (p) => u.setPin(p) });
        if (pin) { toast('Parental PIN set'); location.reload(); }
        return;
      }
      const { el, close } = openDialog(html`<h2>Parental PIN</h2><div class="stack-sm"><button class="btn btn-ghost block" id="pinChange">Change PIN</button><button class="btn btn-danger block" id="pinRemove">Remove PIN</button></div>`, { cls: 'dialog-sm' });
      $('#pinChange', el).onclick = async () => {
        close(); const cur = await pinPrompt({ title: 'Current PIN', check: (p) => u.verifyPin(p) }); if (!cur) return;
        const pin = await pinPrompt({ title: 'New PIN', text: '4–6 digits.', confirm: 'Save', check: (p) => u.setPin(p) }); if (pin) toast('PIN changed');
      };
      $('#pinRemove', el).onclick = async () => {
        close(); const cur = await pinPrompt({ title: 'Remove PIN', text: 'Enter your PIN to remove it.', confirm: 'Remove', check: (p) => u.removePin(p) }); if (cur) { toast('PIN removed'); location.reload(); }
      };
    });

    wireNotifications(root, { onCleanup: ctx?.onCleanup });
    wireReferral(root);
  };
  return { banner, sections, wire };
}
