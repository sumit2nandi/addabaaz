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
import { passwordProblem, PASSWORD_HINT } from '../password-rule.js';
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
  let data = null;
  const inr = (paise) => {
    const amount = Math.max(0, Number(paise) || 0) / 100;
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  };
  const draw = async () => {
    let response;
    try { response = await u.promos(); }
    catch (err) {
      slot.innerHTML = html`<h2 class="sub-h">Refer &amp; Earn</h2><div class="referral-empty card-panel" role="status">
        <span class="referral-empty-icon">${icon('gift', { size: 24 })}</span><h3>Couldn’t load your invite details</h3>
        <p>${friendly(err)}</p><button class="btn btn-primary" type="button" id="refRetry">Try again</button>
      </div>`.s;
      return;
    }
    data = response?.viewer || null;
    if (!data) {
      slot.innerHTML = html`<h2 class="sub-h">Refer &amp; Earn</h2><div class="referral-empty card-panel" role="status">
        <span class="referral-empty-icon">${icon('gift', { size: 24 })}</span><h3>Sign in to see your invite details</h3>
        <p>Your referral code, rewards and activity will appear here when you’re signed in.</p>
      </div>`.s;
      return;
    }
    if (!data.offer?.enabled) {
      slot.innerHTML = html`<h2 class="sub-h">Refer &amp; Earn</h2>${emptyState({ iconName: 'gift', title: 'Refer & Earn Is Off', text: 'There is no invite offer running right now — check back later.' })}`.s;
      return;
    }

    const offer = data.offer;
    const rewardPaise = Math.max(0, Number(offer.referralPaise) || 0);
    const welcomePaise = Math.max(0, Number(offer.signupPaise) || 0);
    const hold = offer.hold === 'signup' ? 'as soon as they join' : offer.hold === 'payment' ? 'after their first plan payment' : 'after they confirm their email or phone';
    const invitees = data.invited || {};
    const invitedItems = (invitees.items || []).filter((friend) => friend.status !== 'void');
    const pendingPaise = Math.max(0, Number(data.pendingPaise) || 0);
    const heldPaise = Math.max(0, Number(data.heldPaise) || 0);
    const code = data.code || '';
    const link = data.link || '';
    const shareText = rewardPaise
      ? `Join me on ADDABAAZ using my invite. You get ${inr(rewardPaise)} in credit, and I get ${inr(rewardPaise)} ${hold}.`
      : 'Join me on ADDABAAZ and discover something great to watch.';
    const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${shareText}${link ? ` ${link}` : ''}`)}`;
    const telegram = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
    const earnedPaise = Math.max(0, Number(invitees.earnedPaise) || 0);
    const invitedTotal = Math.max(0, Number(invitees.activeTotal ?? invitees.total) || 0);
    const completedTotal = Math.max(0, Number(invitees.completed) || 0);
    const inviteSummary = rewardPaise
      ? `Your friend gets ${inr(rewardPaise)} in ADDABAAZ credit when they use your code. You earn the same after they ${offer.hold === 'signup' ? 'join' : offer.hold === 'payment' ? 'make their first plan payment' : 'confirm their email or phone'}.`
      : 'Your invite code is ready to share, but no referral-credit amount is configured right now.';

    slot.innerHTML = html`<h2 class="sub-h referral-page-heading">Refer &amp; Earn</h2>
      <div class="referral-shell">
        <section class="referral-hero" aria-labelledby="referralHeroTitle">
          <img class="referral-hero-image" src="media/referral-invite.jpg" alt="Friends enjoying a show together" fetchpriority="high" decoding="async">
          <div class="referral-hero-copy">
            <span class="referral-eyebrow">GOOD STORIES TRAVEL FURTHER</span>
            <h1 id="referralHeroTitle">Invite Friends.<br><span>Watch More.</span></h1>
            <p>${inviteSummary}</p>
            <button class="btn btn-primary" id="refShare" data-referral-share type="button">${icon('share', { size: 17 })} Share your invite</button>
          </div>
          ${rewardPaise ? html`<div class="referral-hero-stamp"><span>${icon('gift', { size: 20 })}</span><b>${inr(rewardPaise)} each</b><small>for every qualifying referral</small></div>` : ''}
        </section>

        <section class="referral-flow" aria-label="How your referral works">
          <div class="referral-flow-step"><span class="referral-flow-icon">${icon('share', { size: 18 })}</span><b>Share your link</b></div>
          <span class="referral-flow-arrow" aria-hidden="true">›</span>
          <div class="referral-flow-step"><span class="referral-flow-icon">${icon('user', { size: 18 })}</span><b>Friend joins</b></div>
          <span class="referral-flow-arrow" aria-hidden="true">›</span>
          <div class="referral-flow-step"><span class="referral-flow-icon">${icon('gift', { size: 18 })}</span><b>Reward unlocks</b></div>
          <span class="referral-flow-arrow" aria-hidden="true">›</span>
          <div class="referral-flow-step"><span class="referral-flow-icon">${icon('play', { size: 16 })}</span><b>Watch more</b></div>
        </section>

        <section class="referral-wallet" aria-labelledby="referralWalletTitle">
          <div class="referral-wallet-head">
            <div class="referral-wallet-title"><span class="referral-wallet-icon">${icon('gift', { size: 23 })}</span><div><span class="referral-eyebrow">YOUR REWARDS</span><h2 id="referralWalletTitle">Available credit</h2></div></div>
            <div class="referral-wallet-balance">${inr(data.creditPaise)}<small>ADDABAAZ credit</small></div>
          </div>
          <p class="referral-wallet-note">Use your credit toward a plan at checkout. Credit is not cash and can’t be withdrawn.</p>
          <div class="referral-stats" aria-label="Referral statistics">
            <div><b>${inr(earnedPaise)}</b><span>Referral credit unlocked</span></div>
            <div><b>${invitedTotal}</b><span>Friends joined</span></div>
            <div><b>${completedTotal}</b><span>Rewards unlocked</span></div>
          </div>
          ${pendingPaise ? html`<p class="referral-wallet-status">${icon('clock', { size: 15 })}${inr(pendingPaise)} is pending while referral rewards complete their offer requirements.</p>` : ''}
          ${heldPaise ? html`<p class="referral-wallet-status">${icon('info', { size: 15 })}${inr(heldPaise)} is reserved for an unfinished order and returns automatically if it isn’t completed.</p>` : ''}
        </section>

        <section class="referral-code-card" id="refer-code" aria-labelledby="referralCodeTitle">
          <div class="referral-card-heading"><div><span class="referral-eyebrow">YOUR PERSONAL INVITE</span><h2 id="referralCodeTitle">Share the good stuff</h2><p>Send your code or link to someone who’d love ADDABAAZ.</p></div><span class="referral-code-mark">${icon('share', { size: 22 })}</span></div>
          ${code ? html`<div class="referral-fields">
            <label class="referral-field">Your Invite Code<span class="referral-input-row"><input id="refCode" readonly value="${code}" aria-label="Your invite code"><button class="btn btn-ghost" type="button" data-copy="${code}">Copy code</button></span></label>
            <label class="referral-field">Your Invite Link<span class="referral-input-row"><input id="refLink" readonly value="${link}" aria-label="Your invite link"><button class="btn btn-ghost" type="button" data-copy="${link}">Copy link</button></span></label>
          </div>` : html`<p class="referral-inline-notice">Your invite code is still being prepared. Try again in a moment.</p>`}
          <div class="referral-share-row">
            <button class="btn btn-primary" data-referral-share type="button">${icon('share', { size: 17 })} Share invite</button>
            <a class="referral-social-link" href="${whatsapp}" target="_blank" rel="noopener noreferrer" aria-label="Share your invite on WhatsApp">${icon('chat', { size: 17 })} WhatsApp</a>
            <a class="referral-social-link" href="${telegram}" target="_blank" rel="noopener noreferrer" aria-label="Share your invite on Telegram">${icon('share', { size: 17 })} Telegram</a>
          </div>
        </section>

        <div class="referral-details-grid">
          <section class="referral-panel" aria-labelledby="referralBenefitsTitle">
            <div class="referral-panel-heading"><span class="referral-eyebrow">A LITTLE SOMETHING FOR BOTH</span><h2 id="referralBenefitsTitle">Benefits for both of you</h2></div>
            <div class="referral-benefits">
              <article class="referral-benefit"><span class="referral-benefit-icon">${icon('user', { size: 19 })}</span><div><span class="referral-benefit-label">YOUR FRIEND GETS</span><b>${rewardPaise ? inr(rewardPaise) : 'No amount set'}</b><p>${rewardPaise ? 'in referral credit when they use your code to join.' : 'No referral-credit amount is configured at the moment.'}</p>
                ${welcomePaise ? html`<small>New accounts may also receive a ${inr(welcomePaise)} welcome bonus, if eligible.</small>` : ''}</div></article>
              <article class="referral-benefit"><span class="referral-benefit-icon">${icon('gift', { size: 19 })}</span><div><span class="referral-benefit-label">YOU GET</span><b>${rewardPaise ? inr(rewardPaise) : 'No amount set'}</b><p>${rewardPaise ? `in referral credit ${hold}.` : 'No referral-credit amount is configured at the moment.'}</p></div></article>
            </div>
            <p class="referral-footnote">Referral credit can be used toward plans; it is not a cash payout.</p>
          </section>

          <section class="referral-panel referral-milestone" aria-labelledby="referralMilestoneTitle">
            <span class="referral-milestone-icon">${icon('crown', { size: 22 })}</span>
            <span class="referral-eyebrow">NO HIDDEN MILESTONES</span>
            <h2 id="referralMilestoneTitle">Every qualifying friend counts</h2>
            <p>${rewardPaise ? `The current offer is ${inr(rewardPaise)} per successful referral. No extra invite threshold or milestone bonus is configured.` : 'The referral programme is active, but no referral-credit amount is configured right now.'}</p>
            <button class="referral-text-action" type="button" data-referral-scroll>Get your invite link ${icon('arrow-right', { size: 16 })}</button>
          </section>
        </div>

        <section class="referral-panel referral-activity" aria-labelledby="referralActivityTitle">
          <div class="referral-panel-heading referral-activity-heading"><div><span class="referral-eyebrow">YOUR REFERRAL JOURNEY</span><h2 id="referralActivityTitle">Friends you invited</h2></div><span class="referral-count">${invitedTotal} total</span></div>
          ${invitedItems.length ? html`<ul class="referral-activity-list">${invitedItems.map((friend) => {
            const completed = friend.status === 'completed';
            const amount = Math.max(0, Number(friend.bonusPaise) || 0);
            const timestamp = completed ? timeAgo(friend.completedAt || friend.joinedAt) : timeAgo(friend.joinedAt);
            return html`<li class="referral-activity-item">
              <span class="referral-activity-icon ${completed ? 'is-complete' : ''}">${icon(completed ? 'check' : 'clock', { size: 18 })}</span>
              <span class="referral-activity-person"><b>${friend.name || 'Friend'}</b><small>${friend.email ? `${friend.email} · ` : ''}Joined ${timestamp || 'recently'}</small></span>
              <span class="referral-activity-state ${completed ? 'is-complete' : ''}">${completed ? 'Reward unlocked' : 'In progress'}</span>
              ${amount ? html`<b class="referral-activity-amount">+${inr(amount)}</b>` : ''}
            </li>`;
          })}</ul>` : invitedTotal ? html`<p class="referral-empty-copy">Your referral count is up to date; there’s no recent active invite to show here.</p>` : html`<div class="referral-activity-empty"><span>${icon('user', { size: 22 })}</span><div><b>Your first invite is waiting</b><p>Share your link and your friends will appear here when they join.</p></div><button class="btn btn-primary btn-sm" type="button" data-referral-share>Invite a friend</button></div>`}
        </section>

        <div class="referral-tools-grid">
          ${data.canRedeem ? html`<section class="referral-panel referral-redeem" aria-labelledby="referralRedeemTitle">
            <span class="referral-eyebrow">JOINED RECENTLY?</span><h2 id="referralRedeemTitle">Have a Friend’s Invite Code?</h2>
            <p>If you’re within the offer’s code-redemption window, you can add their code once.</p>
            <label class="referral-field" for="refRedeem">Friend’s Invite Code<span class="referral-input-row"><input id="refRedeem" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="e.g. AB12CD34"><button class="btn btn-primary" type="button" id="refApply">Apply code</button></span></label>
          </section>` : data.referredBy ? html`<section class="referral-panel referral-redeem" aria-labelledby="referralRedeemTitle">
            <span class="referral-eyebrow">YOUR INVITE</span><h2 id="referralRedeemTitle">You joined with a friend’s code</h2>
            <p>${data.referredBy.status === 'completed' ? 'Their referral reward has been unlocked.' : 'The referral is still in progress.'}</p>
          </section>` : ''}
          ${data.ledger?.length ? html`<details class="referral-panel referral-ledger"><summary><span><span class="referral-eyebrow">YOUR ACCOUNT</span><b>Credit history</b></span><span class="referral-ledger-count">${data.ledger.length} entries ${icon('chev-down', { size: 16 })}</span></summary><ul>${data.ledger.map((entry) => html`<li><span><b>${entry.reason || entry.label || 'Credit activity'}</b><small>${entry.createdAt ? timeAgo(entry.createdAt) : ''}</small></span><strong class="${entry.amountPaise < 0 ? 'is-negative' : ''}">${entry.amountPaise < 0 ? '−' : '+'}${inr(Math.abs(entry.amountPaise))}</strong></li>`)}</ul></details>` : ''}
        </div>

        <section class="referral-closing-cta"><div><span class="referral-eyebrow">GOOD STORIES ARE BETTER TOGETHER</span><h2>Know someone who’d love ADDABAAZ?</h2><p>Send them your invite and start your next referral.</p></div><button class="btn btn-primary" type="button" data-referral-share>${icon('share', { size: 17 })} Invite a friend</button></section>
      </div>`.s;
  };

  const copy = async (text) => {
    if (!text) return;
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch { /* try the legacy clipboard path below */ }
    if (!copied) {
      const field = document.createElement('textarea');
      field.value = text; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.append(field); field.select();
      try { copied = Boolean(document.execCommand?.('copy')); } catch { /* clipboard is unavailable */ }
      field.remove();
    }
    if (copied) toast(text === data?.code ? 'Invite code copied' : 'Invite link copied');
    else {
      const field = [$('#refLink', slot), $('#refCode', slot)].find((input) => input?.value === text);
      field?.focus(); field?.select(); toast('Select the invite text and copy it');
    }
  };
  const shareInvite = async () => {
    const shareLink = data?.link || '';
    const rewardPaise = Math.max(0, Number(data?.offer?.referralPaise) || 0);
    const hold = data?.offer?.hold === 'signup' ? 'as soon as they join' : data?.offer?.hold === 'payment' ? 'after their first plan payment' : 'after they confirm their email or phone';
    const text = rewardPaise
      ? `Join me on ADDABAAZ using my invite. You get ${inr(rewardPaise)} in credit, and I get ${inr(rewardPaise)} ${hold}.`
      : 'Join me on ADDABAAZ and discover something great to watch.';
    if (navigator.share) {
      try { await navigator.share({ title: 'Invite a friend to ADDABAAZ', text, url: shareLink || undefined }); }
      catch (err) { if (err?.name !== 'AbortError') await copy(shareLink || text); }
    } else await copy(shareLink || text);
  };

  slot.addEventListener('click', async (e) => {
    const copyButton = e.target.closest('[data-copy]');
    if (copyButton) return copy(copyButton.dataset.copy);
    if (e.target.closest('[data-referral-share]')) return shareInvite();
    if (e.target.closest('[data-referral-scroll]')) {
      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth';
      $('#refer-code', slot)?.scrollIntoView({ behavior, block: 'center' });
      return;
    }
    if (e.target.closest('#refRetry')) return draw();
    const button = e.target.closest('#refApply'); if (!button) return;
    const input = $('#refRedeem', slot), code = String(input?.value || '').trim().toUpperCase();
    if (!code) { input?.focus(); return; }
    button.disabled = true;
    try { const result = await u.redeemInvite(code); toast(result.message || 'Invite applied'); await draw(); }
    catch (err) { toast(friendly(err)); button.disabled = false; }
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
      <label>New Password<input name="p1" type="password" autocomplete="new-password" required minlength="8" placeholder="${PASSWORD_HINT}"></label>
      <label>Repeat New Password<input name="p2" type="password" autocomplete="new-password" required minlength="8"></label>
      <div class="form-status" id="pws" role="alert"></div><div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Change Password</button></div></form>`, { cls: 'dialog-sm' });
    $('#pwf', el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target), st = $('#pws', el);
      const pwProblem = passwordProblem(String(f.get('p1'))); if (pwProblem) { st.textContent = pwProblem; return; }
      if (f.get('p1') !== f.get('p2')) { st.textContent = 'The two new passwords don’t match.'; return; }
      try { await u.changePassword(String(f.get('cur')), String(f.get('p1'))); close(); toast('Password changed. Other devices were signed out.'); } catch (err) { st.textContent = friendly(err); }
    });
  });
  $('#signOutAll', root)?.addEventListener('click', async () => {
    if (await confirmDialog({ icon: 'logout', title: 'Sign Out of Other Devices?', text: 'Every other phone, TV and browser signed in to this account will need to sign in again. This device stays signed in.', confirm: 'Sign Out Other Devices', danger: true })) {
      try { await u.signOutEverywhere(); toast('Signed Out of Your Other Devices'); } catch (err) { toast(friendly(err)); }
    }
  });
  // The row icon follows what the label says the device IS: a phone/tablet (the app, iPhone/iPad,
  // Android and the recognised handset brands), a computer (Windows/Mac/Linux browsers), or a TV.
  const devIcon = (label) => {
    const l = String(label || '');
    if (/\btv\b|chromecast|firestick/i.test(l)) return 'tv';
    if (/iphone|ipad|android|· app|oneplus|samsung|realme|oppo|vivo|iqoo|xiaomi|redmi|poco|motorola|nothing|pixel/i.test(l)) return 'smartphone';
    return 'monitor';
  };
  $('#devices', root)?.addEventListener('click', async () => {
    const { el } = openDialog(html`<h2>Your Devices</h2><div id="devBody"><div class="spinner" style="margin:20px auto"></div></div><div class="form-status" id="devStatus" role="alert"></div>`, { cls: 'dialog-sm' });
    const draw = async () => {
      try {
        const d = await u.remote.devices();
        // One row per device NAME: the same phone accrues several device ids over time (new browser
        // profile, cleared storage, app reinstall), which showed as confusing duplicates. The list
        // arrives newest-first, so the first row of a group carries the freshest "last active";
        // Remove clears every id behind the row so a duplicate never resurfaces.
        const groups = [];
        const byLabel = new Map();
        for (const x of d.devices) {
          const key = x.label || 'Device';
          const g = byLabel.get(key);
          if (!g) { const fresh = { ...x, ids: [x.deviceId] }; byLabel.set(key, fresh); groups.push(fresh); }
          else { g.ids.push(x.deviceId); g.current = g.current || x.current; g.watching = g.watching || x.watching; }
        }
        $('#devBody', el).innerHTML = html`${d.streamLimit > 0 ? html`<p class="muted">Your plan allows ${d.streamLimit} screen${d.streamLimit === 1 ? '' : 's'} watching premium titles at once.</p>` : ''}
          <ul class="dev-list">${groups.length ? groups.map((x) => html`<li><span>${icon(devIcon(x.label), { size: 22 })}</span><div><b>${x.label || 'Device'}${x.current ? html` <em class="pill">This Device</em>` : ''}</b><small>${x.watching ? 'Watching now' : `Last active ${timeAgo(x.lastSeen)}`}</small></div>${x.current ? '' : html`<button class="btn btn-ghost btn-sm" type="button" data-forget="${x.ids.join(',')}">Remove</button>`}</li>`) : html`<li class="muted">No devices yet — they appear after you watch a premium title.</li>`}</ul>`.s;
      } catch (err) { $('#devBody', el).textContent = friendly(err); }
    };
    // Errors surface INSIDE the dialog: a toast would be hidden behind the modal (top layer), and the
    // button re-enables on failure so a network blip never leaves Remove permanently dead.
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-forget]'); if (!b) return;
      b.disabled = true;
      const status = $('#devStatus', el); if (status) status.textContent = '';
      try { for (const id of b.dataset.forget.split(',').filter(Boolean)) await u.remote.forgetDevice(id); await draw(); }
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
      if (pin) { toast('Parental PIN Set'); location.reload(); }
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
    if (await confirmDialog({ title: 'Delete Your Account?', text: 'This cannot be undone. Your account and linked data will be deleted. Payment and invoice records may be kept detached from your account; see the Privacy Policy.', confirm: 'Delete account', danger: true })) {
      try { await u.deleteAccount(); toast('Account Deleted'); go('/', { replace: true }); } catch (e) { toast(friendly(e)); }
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
