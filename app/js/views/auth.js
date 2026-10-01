// Sign-in / sign-up page (#/signin and #/signup): email + password plus Google, Facebook and Apple buttons.
// After success the user is sent back to the page they came from (`?next=`).
import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { toast } from '../ui/components.js';
import { mountSocialButtons } from '../social.js';
import { friendly } from '../errors.js';

export default async function auth(ctx) {
  const u = app.user; const signup = ctx.path === '/signup';
  const next = ctx.query.next ? decodeURIComponent(ctx.query.next) : '/';
  ctx.setTitle(signup ? 'Create account' : 'Sign in');
  document.body.classList.add('bare'); ctx.onCleanup(() => document.body.classList.remove('bare'));
  if (!u.supportsAuth) { ctx.root.innerHTML = html`<div class="auth-page"><div class="empty"><h2>Accounts aren’t enabled</h2><p>This copy of ADDABAAZ runs in local mode, so your list and progress are saved on this device. Connect the ADDABAAZ API to enable sign-in and cross-device sync.</p><a class="btn btn-primary" href="#/">Back to home</a></div></div>`.s; return; }
  if (u.account) { go('/account', { replace: true }); return; }

  ctx.root.innerHTML = html`<div class="auth-page">
    <a href="#/" class="auth-brand"><img src="media/icons/icon-96.png" width="56" height="56" alt=""><span class="brand-text"><b>ADDA</b><i>BAAZ</i></span></a>
    <form class="auth-card form" id="af" novalidate>
      <button type="button" class="auth-close" id="authClose" aria-label="Close">${icon('x', { size: 16 })}</button>
      <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
      <p class="muted">${signup ? 'Sync My List and Continue Watching across all your devices.' : 'Sign in to pick up where you left off.'}</p>
      <div class="social" id="social" hidden></div>
      <div class="or" id="or" hidden><span>or use your email</span></div>
      ${signup ? html`<label>Your name<input name="name" autocomplete="name" required maxlength="60" placeholder="Full name"></label>` : ''}
      <label>Email<input name="email" type="email" autocomplete="email" required placeholder="name@example.com" inputmode="email"></label>
      <label>Password<span class="pw"><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${signup ? 'At least 8 characters' : 'Your password'}"><button type="button" class="icon-btn" id="pwt" aria-label="Show password">${icon('eye', { size: 18 })}</button></span></label>
      ${signup ? '' : html`<a class="forgot-link" href="#/forgot">Forgot password?</a>`}
      <div class="form-status" id="as" role="alert"></div>
      <button class="btn btn-primary btn-lg block" type="submit" id="asub">${signup ? 'Create account' : 'Sign in'}</button>
      <div class="auth-busy" id="asBusy" hidden><div class="spinner"></div><p>Signing you in…</p></div>
      ${signup ? html`<p class="fine">By creating an account you agree to our <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>.</p>` : ''}
      <p class="switch-auth">${signup ? html`Already have an account? <a href="#/signin?next=${encodeURIComponent(next)}">Sign in</a>` : html`New to ADDABAAZ? <a href="#/signup?next=${encodeURIComponent(next)}">Create an account</a>`}</p>
      <a class="skip" href="#/">Continue without an account</a>
    </form></div>`.s;

  const st0 = () => $('#as', ctx.root);
  const finish = (msg, type = 'ok') => { toast(msg, type); if (u.needsProfileChoice()) go('/profiles?next=' + encodeURIComponent(next), { replace: true }); else go(next, { replace: true }); };
  // Full-card loading state while a provider sign-in finishes (the form must not sit idle after the popup).
  const busy = (on) => { const el = $('#asBusy', ctx.root); if (el) el.hidden = !on; };
  u.providers().then((prov) => {                                    // Google / Facebook buttons appear only if the server has them configured
    if (!$('#social', ctx.root)) return;                             // navigated away meanwhile
    const shown = mountSocialButtons($('#social', ctx.root), prov, {
      signup,
      onError: (m) => { st0().textContent = m; toast(m); },
      onCredential: async (provider, cred) => {
        st0().textContent = '';
        busy(true);
        try { const r = await u.signInSocial(provider, cred); busy(false); finish(r.isNew ? 'Welcome to ADDABAAZ!' : 'Signed in'); }
        catch (err) { busy(false); const m = friendly(err); st0().textContent = m; toast(m); }
      },
    });
    if (shown) { $('#social', ctx.root).hidden = false; $('#or', ctx.root).hidden = false; }
  });

  $('#pwt', ctx.root).addEventListener('click', () => { const i = $('[name=password]', ctx.root); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('#authClose', ctx.root).addEventListener('click', () => go(next));   // round × at the top-right corner closes the form
  $('#af', ctx.root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const st = $('#as', ctx.root), btn = $('#asub', ctx.root);
    const body = { email: String(f.get('email')).trim(), password: String(f.get('password')) };
    if (signup) body.name = String(f.get('name')).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { st.textContent = 'Please enter a valid email address.'; return; }
    if (body.password.length < 8) { st.textContent = 'Password must be at least 8 characters.'; return; }
    if (signup && !body.name) { st.textContent = 'Please enter your name.'; return; }
    btn.disabled = true; st.textContent = '';
    try {
      const result = await (signup ? u.signUp(body) : u.signIn(body));
      if (signup && result.verificationEmailSent === false) {
        finish('Account created, but the confirmation email could not be sent. Try Resend link from Account.', 'err');
      } else finish(signup ? 'Welcome to ADDABAAZ!' : 'Signed in');
    } catch (err) { st.textContent = friendly(err); btn.disabled = false; }
  });
}
