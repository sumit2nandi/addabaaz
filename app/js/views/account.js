// Profile page (#/account): a compact identity header plus the settings groups, each opening its own
// sub-page. The banners stay on this page so nothing the old stacked layout surfaced gets silently dropped.
import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { avatar, toast, confirmSignOut } from '../ui/components.js';
import { go } from '../router.js';
import { isNative } from '../platform.js';
import { verifyBanner, settingGroups } from './account-extra.js';
import { friendly } from '../errors.js';

// Draws the page: banners, the profile header, the group list and sign-out.
export default async function account(ctx) {
  const u = app.user;
  ctx.setTitle('Account');
  const p = u.profile;
  const identity = u.account
    ? u.account.emailIsPlaceholder
      ? `SMS sign-in${u.account.phone ? ` · +${u.account.phone}` : ''}`
      : [u.account.email, u.account.phoneVerified ? `SMS sign-in${u.account.phone ? ` · +${u.account.phone}` : ''}` : '', u.account.providers?.length ? u.account.providers.map((x) => ({ google: 'Google', facebook: 'Facebook', apple: 'Apple' }[x] || x)).join(' & ') + ' sign-in' : ''].filter(Boolean).join(' · ')
    : u.supportsAuth ? 'Browsing as a guest — sign in to sync across devices.' : 'Your list and progress are saved on this device.';
  ctx.root.innerHTML = html`<div class="page page-narrow account-page">
    ${!u.supportsAuth ? html`<section class="card-panel notice" role="status"><div>${icon('info', { size: 22 })}</div><div><b>Local-only mode</b><p class="muted">This app isn’t connected to ADDABAAZ cloud. Profiles and settings stay on this phone; sign-in, sync, and push notifications need a cloud connection.</p></div></section>` : ''}
    ${verifyBanner()}
    ${u.supportsAuth && !u.isPremium && !isNative ? html`<section class="card-panel subscribe-banner"><div><h2>Subscribe to <em class="premium-word">premium</em></h2><p>Premium originals, early access</p></div><a class="btn btn-light" href="#/plans">Subscribe</a></section>` : ''}
    <section class="profile-head">
      ${p ? avatar(p, { size: 48 }) : ''}
      <div class="profile-id"><h2>${u.account ? u.account.name : p ? p.name : 'Guest'} ${u.isPremium ? html`<em class="premium-word premium-sup">premium</em>` : html`<em class="pill free">Free</em>`}</h2>
        <p class="muted">${identity}</p></div>
      ${u.supportsAuth && !u.account ? html`<div class="profile-actions"><a class="btn btn-primary" href="#/signin">Sign in</a><a class="btn btn-ghost" href="#/signup">Create account</a></div>` : ''}
    </section>
    <nav class="card-panel list group-list" aria-label="Settings">
      ${settingGroups().map((g) => html`<a class="row-link${g.id === 'danger' ? ' danger' : ''}" href="${g.href}">${icon(g.ic, { size: 22 })}<span><b>${g.title}</b><small>${g.sub}</small></span>${icon('right', { size: 18, cls: 'chev' })}</a>`)}
    </nav>
    <footer class="profile-footer">
      ${u.account ? html`<button class="logout-link" id="signout">Sign out</button>` : ''}
    </footer>
  </div>`.s;

  $('#resendVerify', ctx.root)?.addEventListener('click', async (e) => { e.target.disabled = true; try { await u.remote.resendVerification(); toast('Sent — check your inbox.'); } catch (err) { toast(friendly(err)); e.target.disabled = false; } });
  $('#signout', ctx.root)?.addEventListener('click', async () => {
    if (!(await confirmSignOut())) return;   // confirmation popup first — sign out only on confirm
    try { await u.signOut(); } catch { /* local state is already cleared */ }
    toast('Signed out'); go('/', { replace: true });
  });
}
