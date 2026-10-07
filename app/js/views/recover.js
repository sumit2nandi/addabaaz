// Pages reached from emails: forgot password, reset password, and email verification.
import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { toast } from '../ui/components.js';
import { friendly } from '../errors.js';

// Shared page frame and card for the three screens.
const shell = (ctx, inner) => { ctx.root.innerHTML = html`<div class="auth-page"><a href="#/" class="auth-brand"><img src="media/icons/icon-96.png" width="56" height="56" alt=""><span class="brand-text"><b>ADDA</b><i>BAAZ</i></span></a>${inner}</div>`.s; };
const card = (title, body) => html`<div class="auth-card form"><h1>${title}</h1>${body}</div>`;

/** /forgot · /reset?token=… · /verify?token=…  (all three come from emails; none of them are indexed) */
export default async function recover(ctx) {
  const u = app.user;
  document.body.classList.add('bare'); ctx.onCleanup(() => document.body.classList.remove('bare'));
  if (!u.supportsAuth) { ctx.setTitle('Account recovery'); shell(ctx, html`<div class="empty"><h2>Accounts aren’t enabled</h2><p>This copy of ADDABAAZ runs without the ADDABAAZ API.</p><a class="btn btn-primary" href="#/">Back to home</a></div>`); return; }
  const token = ctx.query.token || '';

  if (ctx.path === '/reset' && ctx.query.parental === '1') {
    ctx.setTitle('Reset parental PIN');
    shell(ctx, html`<form class="auth-card form" id="pinResetForm"><h1>Reset parental PIN</h1><p class="muted">Choose a new 4–6 digit PIN. This replaces the old PIN without changing your password.</p>
      <label>New PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" required autocomplete="off"></label>
      <label>Confirm PIN<input name="confirm" type="password" inputmode="numeric" maxlength="6" required autocomplete="off"></label>
      <div class="form-status" id="pinResetStatus" role="alert"></div><button type="submit" class="btn btn-primary" id="savePin">Save new PIN</button><a href="#/support">Help &amp; support</a></form>`);
    $('#pinResetForm', ctx.root).addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget, pin = $('[name=pin]', form).value, status = $('#pinResetStatus', form), button = $('#savePin', form);
      if (!/^\d{4,6}$/.test(pin)) { status.textContent = 'Enter 4–6 digits.'; return; }
      if (pin !== $('[name=confirm]', form).value) { status.textContent = 'The PINs do not match.'; return; }
      button.disabled = true;
      try {
        await u.remote.resetPin(token, pin);
        u.pin = null;
        if (u.account) await u.refreshAccount().catch(() => {});
        shell(ctx, card('Parental PIN updated', html`<p class="muted">Use your new PIN to manage profiles and parental controls.</p><a class="btn btn-primary" href="#/account">Return to Account</a>`));
      } catch (error) { status.textContent = friendly(error); button.disabled = false; }
    });
    return;
  }

  if (ctx.path === '/verify') {
    const emailChange = ctx.query.emailChange === '1';
    ctx.setTitle(emailChange ? 'Confirm account email' : 'Confirm your email');
    shell(ctx, card('Confirming your email…', html`<div class="spinner" style="margin:auto"></div>`));
    try {
      if (!token) throw new Error('This link is incomplete. Open the link from your email again.');
      if (emailChange) await u.remote.verifyAccountEmail(token);
      else await u.remote.verifyEmail(token);
      if (u.account) await u.refreshAccount().catch(() => {});
      shell(ctx, card(emailChange ? 'Contact email confirmed' : 'Email confirmed', html`<p class="muted">${icon('check', { size: 18 })} ${emailChange ? 'This address is now verified and connected to your account. Account and billing emails can now be sent here.' : 'Your email address is confirmed. You can now use your account and receive account emails at this address.'}</p><a class="btn btn-primary btn-lg block" href="${u.account ? '#/account' : '#/signin'}">${u.account ? 'Go to your account' : 'Sign in'}</a>`));
    } catch (e) {
      shell(ctx, card('This link doesn’t work', html`<p class="muted">${friendly(e, 'It may have expired or been used already.')}</p>${emailChange ? u.account ? html`<a class="btn btn-primary btn-lg block" href="#/account">Return to Account</a>` : html`<a class="btn btn-primary btn-lg block" href="#/signin">Sign in to try again</a>` : u.account ? html`<button class="btn btn-primary btn-lg block" id="resend">Send me a new link</button><div class="form-status" id="rs" role="alert"></div>` : html`<a class="btn btn-primary btn-lg block" href="#/signin">Sign in to request a new link</a>`}`));
      $('#resend', ctx.root)?.addEventListener('click', async () => { try { await u.remote.resendVerification(); $('#rs', ctx.root).classList.add('success'); $('#rs', ctx.root).textContent = 'Sent — check your inbox.'; } catch (err) { $('#rs', ctx.root).textContent = friendly(err); } });
    }
    return;
  }

  if (ctx.path === '/reset' && token) {
    ctx.setTitle('Choose a new password');
    shell(ctx, html`<form class="auth-card form" id="rf" novalidate><h1>Choose a new password</h1><p class="muted">You’ll be signed out on your other devices.</p>
      <label>New password<span class="pw"><input name="p1" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters"><button type="button" class="icon-btn" id="pwt" aria-label="Show password">${icon('eye', { size: 18 })}</button></span></label>
      <label>Repeat password<input name="p2" type="password" autocomplete="new-password" required minlength="8"></label>
      <div class="form-status" id="rs" role="alert"></div><button class="btn btn-primary btn-lg block" type="submit" id="rsub">Save password &amp; sign in</button></form>`);
    $('#pwt', ctx.root).addEventListener('click', () => { const i = $('[name=p1]', ctx.root); i.type = i.type === 'password' ? 'text' : 'password'; });
    $('#rf', ctx.root).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target), st = $('#rs', ctx.root), btn = $('#rsub', ctx.root);
      const p1 = String(f.get('p1')), p2 = String(f.get('p2'));
      if (p1.length < 8) { st.textContent = 'Password must be at least 8 characters.'; return; }
      if (p1 !== p2) { st.textContent = 'The two passwords don’t match.'; return; }
      btn.disabled = true; st.textContent = '';
      try { await u.resetPassword(token, p1); toast('Password changed — you’re signed in'); go(u.needsProfileChoice() ? '/profiles' : '/', { replace: true }); }
      catch (err) { st.textContent = friendly(err); btn.disabled = false; }
    });
    return;
  }

  // /forgot (and /reset without a token)
  ctx.setTitle('Forgot password');
  shell(ctx, html`<form class="auth-card form" id="ff" novalidate><h1>Forgot your password?</h1><p class="muted">Enter your email and we’ll send you a link to choose a new one. It works for accounts created with Google, Facebook or Apple too.</p>
    <label>Email<input name="email" type="email" autocomplete="email" required placeholder="name@example.com" inputmode="email" value="${ctx.query.email || ''}"></label>
    <div class="form-status" id="fs" role="alert"></div><button class="btn btn-primary btn-lg block" type="submit" id="fsub">Email me a link</button>
    <p class="switch-auth"><a href="#/signin">Back to sign in</a></p></form>`);
  $('#ff', ctx.root).addEventListener('submit', async (e) => {
    e.preventDefault(); const email = String(new FormData(e.target).get('email')).trim(), st = $('#fs', ctx.root), btn = $('#fsub', ctx.root);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { st.textContent = 'Please enter a valid email address.'; return; }
    btn.disabled = true; st.textContent = '';
    try {
      await u.remote.forgotPassword(email);
      shell(ctx, card('Check your email', html`<p class="muted">If there’s an account for <b>${email}</b>, a reset link is on its way. It’s valid for one hour. Not there? Look in spam, or try again in a minute.</p><a class="btn btn-ghost btn-lg block" href="#/signin">Back to sign in</a>`));
    } catch (err) { st.textContent = friendly(err); btn.disabled = false; }
  });
}
