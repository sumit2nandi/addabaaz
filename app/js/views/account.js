// Profile page (#/account): inline expandable settings plus referral and support links. The banners stay on this page so nothing the old stacked layout surfaced gets silently dropped.
import { savedEntries, savedListStrip } from '../ui/saved-list.js';
import { profileStrip } from '../ui/profile-strip.js';
import { mayLeaveKids } from '../ui/parental.js';
import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { avatar, toast, confirmSignOut } from '../ui/components.js';
import { go } from '../router.js';
import { isNative } from '../platform.js';
import { accountGroup, wireAccountAccordion } from '../ui/account-accordion.js';
import { accountNav } from '../ui/account-nav.js';
import { accountPlan } from '../ui/account-plan.js';
import { verifyBanner, settingGroups, settingSection, wireSetting } from './account-extra.js';
import { friendly } from '../errors.js';

// Draws the page: banners, the profile header, the group list and sign-out.
export default async function account(ctx) {
  const u = app.user;
  if (!u.account) { go('/signin?next=/account', { replace: true }); return; }
  ctx.setTitle('Account');
  const p = u.profile;
  const identity = u.supportsAuth ? 'Browsing as a guest — sign in to sync across devices.' : 'Your list and progress are saved on this device.';
  // Desktop gets the shared sidebar + content shell (settings/support use it too); on phones the sidebar is
  // display:none and the wrappers collapse to today's single-column flow.
  ctx.root.innerHTML = html`<div class="page page-narrow account-page profile-page">
    <div class="account-layout">${accountNav(settingGroups(), 'overview')}<div class="account-content">
    ${!u.supportsAuth ? html`<section class="card-panel notice" role="status"><div>${icon('info', { size: 22 })}</div><div><b>Local-Only Mode</b><p class="muted">This app isn’t connected to ADDABAAZ cloud. Profiles and settings stay on this phone; sign-in, sync, and push notifications need a cloud connection.</p></div></section>` : ''}
    ${verifyBanner()}
    ${u.supportsAuth && !u.isPremium && !isNative ? html`<section class="card-panel subscribe-banner"><div><h2>Subscribe to <em class="premium-word">premium</em></h2><p>Premium Originals, Early Access</p></div><a class="btn btn-light" href="#/plans">Subscribe</a></section>` : ''}
    <section class="profile-head">
      ${p ? avatar(p, { size: 48 }) : ''}
      <div class="profile-id"><h2>${u.account ? u.account.name : p ? p.name : 'Guest'} ${u.isPremium ? html`<em class="premium-word premium-sup">premium</em>` : html`<em class="pill free">Free</em>`}${u.account ? html`<a class="profile-details-edit" href="#/account/details" aria-label="Edit account details" title="Edit account details">${icon('edit', { size: 16 })}</a>` : ''}</h2>
        ${u.account && !u.account.emailIsPlaceholder ? html`<p class="muted profile-email">${u.account.email}</p>` : ''}
        ${!u.account ? html`<p class="muted">${identity}</p>` : ''}</div>
      ${u.supportsAuth && !u.account ? html`<div class="profile-actions"><a class="btn btn-primary" href="#/signin">Sign In</a><a class="btn btn-ghost" href="#/signup">Create Account</a></div>` : ''}
    </section>
    <!-- Subscription summary: drawn everywhere but only *shown* on desktop-width browsers (CSS below), where the
         settings grid it replaces used to sit. Phones and the native apps keep today's page. -->
    ${u.supportsAuth && !isNative ? html`<div class="account-plan-overview" id="accountPlanOverview">${accountPlan(u)}</div>` : ''}
    ${profileStrip(u)}
    <div id="accountSavedList">${savedListStrip(savedEntries(u, app.catalog))}</div>
    <nav class="card-panel list group-list" aria-label="Settings">
      ${settingGroups().map(accountGroup)}
    </nav>
    <footer class="profile-footer">
      ${u.account ? html`<button class="logout-link" id="signout">Sign Out</button>` : ''}
    </footer>
    </div></div>
  </div>`.s;

  ctx.onCleanup(u.on('subscription', () => {
    const summary = $('#accountPlanOverview', ctx.root);
    if (summary) summary.innerHTML = accountPlan(u).s;
  }));
  ctx.onCleanup(u.on('library', () => {
    const saved = $('#accountSavedList', ctx.root);
    if (!saved) return;
    const scroll = saved.querySelector('.account-saved-track')?.scrollLeft || 0;
    saved.innerHTML = savedListStrip(savedEntries(u, app.catalog)).s;
    const track = saved.querySelector('.account-saved-track');
    if (track) track.scrollLeft = scroll;
  }));
  let switchingProfile = false;
  ctx.root.querySelectorAll('[data-account-profile]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (switchingProfile || button.dataset.accountProfile === u.activeId) return;
      const target = u.profiles.find((profile) => profile.id === button.dataset.accountProfile);
      if (!target) return;
      switchingProfile = true;
      try {
        if (!(await mayLeaveKids(u, target))) return;
        await u.selectProfile(target.id);
        go('/');
      } catch (error) { if (!error.cancelled) toast(friendly(error)); }
      finally { switchingProfile = false; }
    });
  });
  wireAccountAccordion(ctx.root, settingSection, wireSetting, ctx);

  $('#resendVerify', ctx.root)?.addEventListener('click', async (e) => { e.target.disabled = true; try { await u.remote.resendVerification(); toast('Sent — check your inbox.'); } catch (err) { toast(friendly(err)); e.target.disabled = false; } });
  $('#signout', ctx.root)?.addEventListener('click', async () => {
    if (!(await confirmSignOut())) return;   // confirmation popup first — sign out only on confirm
    try { await u.signOut(); } catch { /* local state is already cleared */ }
    toast('Signed Out'); go('/', { replace: true });
  });
}
