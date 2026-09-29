/* The account page's newer sections: email confirmation, password & sessions, parental PIN, devices, notifications, privacy. */
import { app } from '../app.js';
import { html, $, fmtDate, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { toast } from '../ui/components.js';
import { openDialog, confirmDialog, pinPrompt } from '../ui/dialog.js';
import { pushState, enablePush, disablePush, setPushPrefs } from '../push.js';
import { openConsentDialog } from '../consent.js';

const row = (id, ic, label, sub) => html`<button class="row-link" id="${id}">${icon(ic, { size: 22 })}<span><b>${label}</b>${sub ? html`<small>${sub}</small>` : ''}</span>${icon('right', { size: 18, cls: 'chev' })}</button>`;

/** Returns { banner, sections, wire(root) } — both go into the page, wire() attaches the handlers once it is in the DOM. */
export function accountExtras() {
  const u = app.user, acc = u.account;
  if (!u.supportsAuth || !acc) return { banner: '', sections: '', wire() {} };
  const verified = acc.emailVerified !== false;
  const banner = verified ? '' : html`<section class="card-panel notice" id="verifyBanner"><div>${icon('mail', { size: 22 })}</div><div><b>Confirm your email</b><p class="muted">We sent a link to ${acc.email}. Confirming lets you buy a plan and post comments.</p></div><button class="btn btn-primary" id="resendVerify">Resend link</button></section>`;
  const sections = html`
    <h2 class="sub-h">Security</h2>
    <div class="card-panel list">
      ${row('chgPw', 'lock', acc.hasPassword === false ? 'Set a password' : 'Change password', acc.hasPassword === false ? 'You signed up with a social account — add a password too.' : 'Signs you out on your other devices.')}
      ${row('signOutAll', 'logout', 'Sign out everywhere', 'Ends your session on every phone, TV and browser.')}
      ${row('devices', 'tv', 'Your devices', 'See where you’re watching and how many screens your plan allows.')}
    </div>
    <h2 class="sub-h">Kids &amp; parental controls</h2>
    <div class="card-panel list">
      ${row('pinBtn', 'lock', u.hasPin ? 'Change or remove parental PIN' : 'Set a parental PIN', u.hasPin ? 'Needed to leave a Kids profile or change profiles.' : 'Keeps children on their Kids profile and stops profile changes.')}
      <a class="row-link" href="#/profiles?manage=1">${icon('user', { size: 22 })}<span><b>Kids profiles</b><small>Mark any profile as “Kids” to show only titles rated for children.</small></span>${icon('right', { size: 18, cls: 'chev' })}</a>
    </div>
    <div id="notifySlot"></div>
    <h2 class="sub-h">Privacy</h2>
    <div class="card-panel list">${row('consentBtn', 'info', 'Privacy choices', 'Analytics and stored data.')}<a class="row-link" href="#/privacy">${icon('info', { size: 22 })}<span><b>Privacy Policy</b></span>${icon('right', { size: 18, cls: 'chev' })}</a><a class="row-link" href="#/terms">${icon('info', { size: 22 })}<span><b>Terms of Use</b></span>${icon('right', { size: 18, cls: 'chev' })}</a></div>`;

  const wire = (root) => {
    $('#resendVerify', root)?.addEventListener('click', async (e) => { e.target.disabled = true; try { await u.remote.resendVerification(); toast('Sent — check your inbox.'); } catch (err) { toast(err.message); e.target.disabled = false; } });
    $('#consentBtn', root)?.addEventListener('click', openConsentDialog);

    $('#chgPw', root)?.addEventListener('click', () => {
      if (acc.hasPassword === false) {
        openDialog(html`<h2>Set a password</h2><p class="muted">We’ll email <b>${acc.email}</b> a link to choose a password. You can keep using your social sign-in too.</p><div class="row end"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="sendLink">Email me the link</button></div>`, { cls: 'dialog-sm' })
          .el.querySelector('#sendLink').onclick = async (e) => { e.target.disabled = true; try { await u.remote.forgotPassword(acc.email); toast('Link sent — check your inbox.'); e.target.closest('dialog').close(); } catch (err) { toast(err.message); e.target.disabled = false; } };
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
        try { await u.changePassword(String(f.get('cur')), String(f.get('p1'))); close(); toast('Password changed. Other devices were signed out.'); } catch (err) { st.textContent = err.message; }
      });
    });
    $('#signOutAll', root)?.addEventListener('click', async () => {
      if (await confirmDialog({ title: 'Sign out everywhere?', text: 'Every device signed in to this account — including this one, after you confirm — will need to sign in again.', confirm: 'Sign out everywhere' })) {
        try { await u.signOutEverywhere(); toast('Signed out on your other devices'); } catch (err) { toast(err.message); }
      }
    });
    $('#devices', root)?.addEventListener('click', async () => {
      const { el } = openDialog(html`<h2>Your devices</h2><div id="devBody"><div class="spinner" style="margin:20px auto"></div></div>`, { cls: 'dialog-sm' });
      const draw = async () => {
        try {
          const d = await u.remote.devices();
          $('#devBody', el).innerHTML = html`<p class="muted">Your plan allows ${d.streamLimit} screen${d.streamLimit === 1 ? '' : 's'} watching premium titles at once.</p>
            <ul class="dev-list">${d.devices.length ? d.devices.map((x) => html`<li><span>${icon('tv', { size: 22 })}</span><div><b>${x.label || 'Device'}${x.current ? html` <em class="pill">This device</em>` : ''}</b><small>${x.watching ? 'Watching now' : `Last active ${timeAgo(x.lastSeen)}`}</small></div>${x.current ? '' : html`<button class="btn btn-ghost btn-sm" data-forget="${x.deviceId}">Remove</button>`}</li>`) : html`<li class="muted">No devices yet — they appear after you watch a premium title.</li>`}</ul>`.s;
        } catch (err) { $('#devBody', el).textContent = err.message; }
      };
      el.addEventListener('click', async (e) => { const b = e.target.closest('[data-forget]'); if (!b) return; b.disabled = true; try { await u.remote.forgetDevice(b.dataset.forget); await draw(); } catch (err) { toast(err.message); } });
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

    // notifications (only where the browser and the server support them)
    pushState().then((st) => {
      const slot = $('#notifySlot', root); if (!slot || !st.supported || !st.enabled) return;
      const draw = (s) => {
        slot.innerHTML = html`<h2 class="sub-h">Notifications</h2><div class="card-panel list">
          <label class="row-switch"><span><b>Notify me on this device</b><small>${s.permission === 'denied' ? 'Blocked in your browser settings.' : 'New episodes, launches and announcements.'}</small></span><span class="switch"><input type="checkbox" id="pushOn" ${s.subscribed ? 'checked' : ''} ${s.permission === 'denied' ? 'disabled' : ''}><span class="track"></span></span></label>
          ${s.subscribed ? html`<label class="row-switch"><span><b>New episodes of shows I follow</b></span><span class="switch"><input type="checkbox" data-pp="episodes" ${s.prefs.episodes ? 'checked' : ''}><span class="track"></span></span></label>
            <label class="row-switch"><span><b>When a Coming Soon title launches</b></span><span class="switch"><input type="checkbox" data-pp="launches" ${s.prefs.launches ? 'checked' : ''}><span class="track"></span></span></label>
            <label class="row-switch"><span><b>Announcements &amp; offers</b></span><span class="switch"><input type="checkbox" data-pp="news" ${s.prefs.news ? 'checked' : ''}><span class="track"></span></span></label>` : ''}</div>`.s;
      };
      draw(st);
      slot.addEventListener('change', async (e) => {
        try {
          if (e.target.id === 'pushOn') { if (e.target.checked) await enablePush(); else await disablePush(); }
          else if (e.target.dataset.pp) await setPushPrefs({ [e.target.dataset.pp]: e.target.checked });
          draw(await pushState());
        } catch (err) { toast(err.message); draw(await pushState().catch(() => st)); }
      });
    }).catch(() => {});
  };
  return { banner, sections, wire };
}
