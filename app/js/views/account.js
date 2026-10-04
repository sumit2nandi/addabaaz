// Account page (#/account): profile details, subscription, preferences, security, devices and the danger zone (delete account).
import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { html, $, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { avatar, toast, sectionHeader, confirmSignOut } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { go } from '../router.js';
import { platform } from '../platform.js';
import { accountExtras } from './account-extra.js';
import { friendly } from '../errors.js';

// Draws the page; sections from account-extra.js are added and wired here.
export default async function account(ctx) {
  const u = app.user;
  ctx.setTitle('Account');
  const p = u.profile;
  const plan = u.subscription?.planId || 'free';
  const link = (href, ic, label, sub = '') => html`<a class="row-link" href="${href}">${icon(ic, { size: 22 })}<span><b>${label}</b>${sub ? html`<small>${sub}</small>` : ''}</span>${icon('right', { size: 18, cls: 'chev' })}</a>`;

  const extras = accountExtras();
  ctx.root.innerHTML = html`<div class="page page-narrow account-page">
    ${sectionHeader({ tag: 'You', title: u.supportsAuth ? 'Account & settings' : 'Profile & settings' })}
    ${!u.supportsAuth ? html`<section class="card-panel notice" role="status"><div>${icon('info', { size: 22 })}</div><div><b>Local-only mode</b><p class="muted">This app isn’t connected to ADDABAAZ cloud. Profiles and settings stay on this phone; sign-in, sync, and push notifications need a cloud connection.</p></div></section>` : ''}
    ${extras.banner}
    <section class="card-panel who">
      ${p ? avatar(p, { size: 64 }) : ''}
      <div><h2>${u.account ? u.account.name : p ? p.name : 'Guest'}</h2>
        <p class="muted">${u.account ? u.account.email + (u.account.providers?.length ? ' · ' + u.account.providers.map((x) => ({ google: 'Google', facebook: 'Facebook', apple: 'Apple' }[x] || x)).join(' & ') + ' sign-in' : '') : u.supportsAuth ? 'Browsing as a guest — sign in to sync across devices.' : 'Your list and progress are saved on this device.'}</p></div>
      <div class="who-actions">${u.supportsAuth ? (u.account ? html`<button class="btn btn-ghost" id="signout">${icon('logout', { size: 18 })} Sign out</button>` : html`<a class="btn btn-primary" href="#/signin">Sign in</a><a class="btn btn-ghost" href="#/signup">Create account</a>`) : ''}</div>
    </section>
    <div class="account-grid">
      ${extras.sections}

      <section class="account-section">
        <h2 class="sub-h">Profiles</h2>
        <div class="card-panel list">${link('#/profiles', 'user', 'Who’s watching?', `${u.profiles.length} profile${u.profiles.length > 1 ? 's' : ''} · switch profile`)}${link('#/profiles?manage=1', 'edit', 'Manage profiles')}</div>
      </section>

      <section class="account-section">
        <h2 class="sub-h">Playback</h2>
        <div class="card-panel list">
          <label class="row-switch"><span><b>Autoplay next episode</b><small>Keep watching without lifting a finger.</small></span><span class="switch"><input type="checkbox" id="autoNext" ${u.pref('autoplayNext') ? 'checked' : ''}><span class="track"></span></span></label>
          <button class="row-link" id="clearHist">${icon('trash', { size: 22 })}<span><b>Clear watch history</b><small>Removes Continue Watching for this profile.</small></span></button>
        </div>
      </section>

      ${u.supportsAuth ? html`<section class="account-section"><h2 class="sub-h">Subscription</h2><div class="card-panel list">${link('#/plans', 'crown', plan === 'free' ? 'Free plan' : 'ADDABAAZ Plus', plan === 'free' ? 'Subscribe to watch premium originals' : (u.subscription.expiresAt ? `Active until ${fmtDate(u.subscription.expiresAt)}` : 'Manage your plan'))}${u.account ? link('#/billing', 'download', 'Billing & invoices', 'GST invoices, credit notes and refunds') : ''}</div></section>` : ''}

      <section class="account-section">
        <h2 class="sub-h">Explore</h2>
        <div class="card-panel list">
          ${link('#/list', 'list', 'My List')}${link('#/upcoming', 'clock', 'Coming Soon')}
          ${link('#/about', 'info', 'About ADDABAAZ')}${link('#/services', 'film', 'Services')}${link('#/contact', 'mail', 'Contact us')}${link('#/support', 'chat', 'Help & support', 'Raise a ticket and follow our replies')}
        </div>
      </section>

      <section class="account-section">
        <h2 class="sub-h">App</h2>
        <div class="card-panel list">
          <button class="row-link" data-install hidden>${icon('download', { size: 22 })}<span><b>Install ADDABAAZ</b><small>Add to your home screen for a full-screen app experience.</small></span></button>
          <div class="row-link static">${icon('info', { size: 22 })}<span><b>Version ${CONFIG.version}</b><small>${platform === 'web' ? 'Web' : platform} · ${u.mode === 'remote' ? 'Connected to ADDABAAZ cloud' : 'Local mode (data stays on this device)'}</small></span></div>
        </div>
      </section>
      ${u.account ? html`<section class="account-section"><h2 class="sub-h">Danger zone</h2><div class="card-panel list"><button class="row-link danger" id="delAcc">${icon('trash', { size: 22 })}<span><b>Delete account</b><small>Permanently removes your account, profiles, list and history.</small></span></button></div></section>` : ''}
    </div>
  </div>`.s;

  extras.wire(ctx.root, ctx);
  $('#signout', ctx.root)?.addEventListener('click', async () => {
    if (!(await confirmSignOut())) return;   // confirmation popup first — sign out only on confirm
    try { await u.signOut(); } catch { /* local state is already cleared */ }
    toast('Signed out'); go('/', { replace: true });
  });
  $('#autoNext', ctx.root).addEventListener('change', (e) => u.setPref('autoplayNext', e.target.checked));
  $('#clearHist', ctx.root).addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Clear watch history?', text: 'This removes Continue Watching for this profile.', confirm: 'Clear', danger: true })) { u.clearHistory(); toast('Watch history cleared'); }
  });
  $('#delAcc', ctx.root)?.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Delete your account?', text: 'This cannot be undone. All profiles, lists and history will be erased.', confirm: 'Delete account', danger: true })) {
      try { await u.deleteAccount(); toast('Account deleted'); go('/', { replace: true }); } catch (e) { toast(friendly(e)); }
    }
  });
}
