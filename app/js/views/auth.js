// Sign-in / sign-up page (#/signin and #/signup).
//
// Primary method: a mobile number with an SMS one-time code (MSG91). The same flow signs a new viewer up and
// signs an existing one back in. It is offered only when the server has SMS configured (`otp: true` from
// /auth/providers). Otherwise the page shows the e-mail + password form.
//
// Google / Facebook / Apple buttons, the e-mail + password form and `?next=` handling are always available.
//
// Layout rule: everything the page shows is decided from /auth/providers BEFORE the page is drawn, so nothing
// is shown, hidden or resized after the viewer sees it.
import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { toast } from '../ui/components.js';
import { mountSocialButtons } from '../social.js';
import { friendly } from '../errors.js';
import { wirePhoneSplits } from '../ui/phone-field.js';

const RESEND_SECONDS = 60;   // matches the server's one-a-minute limit

export default async function auth(ctx) {
  const u = app.user;
  const signup = ctx.path === '/signup';
  const next = ctx.query.next ? decodeURIComponent(ctx.query.next) : '/';
  // `?ref=CODE`: someone opened a friend's invite link. The code rides along with whichever sign-up method is
  // used, so both sides get their bonus (see server/src/promos.js).
  const ref = String(ctx.query.ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  ctx.setTitle(signup ? 'Create account' : 'Sign in');
  if (!u.supportsAuth) {
    ctx.root.innerHTML = html`<div class="page"><div class="empty"><h2>Accounts aren’t enabled</h2><p>This copy of ADDABAAZ runs in local mode, so your list and progress are saved on this device. Connect the ADDABAAZ API to enable sign-in and cross-device sync.</p><a class="btn btn-primary" href="#/">Back to home</a></div></div>`.s;
    return;
  }
  if (u.account) { go('/account', { replace: true }); return; }

  // Which methods the server offers. `/auth/providers` never throws; the e-mail form is the floor.
  const providers = await u.providers().catch(() => ({ password: true }));
  // The page is drawn only after this point, so a navigation that started meanwhile wins.
  if (ctx.stale?.()) return;

  const canOtp = !!providers.otp;
  const hasSocial = ['google', 'facebook', 'apple'].some((p) => providers[p]);
  let country = String(providers.otpCountryCode || '91').replace(/\D/g, '') || '91';
  let mode = canOtp ? 'otp' : 'email';        // mobile number first whenever it is configured
  let phoneSent = '';
  let timer = null;

  const subLine = canOtp
    ? 'Use your mobile number to get started.'
    : (signup ? 'Save your favourites and watch across devices.' : 'Pick up where you left off.');

  // The whole page is built as one string and drawn once. Social buttons, the "or" line and the e-mail pane
  // are rendered with their final visibility already set.
  ctx.root.innerHTML = html`<div class="page auth-page auth-entry">
    <form class="auth-card form" id="af" novalidate>
      <button type="button" class="auth-close" id="authClose" aria-label="Close">${icon('x', { size: 16 })}</button>
      <h1>${signup ? 'Create account' : 'Welcome back'}</h1>
      ${ref ? html`<div class="notice ok" id="refNote">${icon('gift', { size: 18 })}<span>Invite code <b>${ref}</b> will be applied — you and your friend both get credit.</span></div>` : ''}
      <p class="muted" id="authSub">${subLine}</p>

      ${canOtp ? html`<div class="seg seg-full" role="tablist" aria-label="Sign-in method">
        <button type="button" role="tab" class="on" id="tabOtp" aria-selected="true">${icon('phone', { size: 15 })} Mobile number</button>
        <button type="button" role="tab" id="tabEmail" aria-selected="false">${icon('mail', { size: 15 })} Email</button>
      </div>` : ''}

      ${canOtp ? html`<div id="otpPane">
        <div id="otpPhoneStep">
          <label><span class="auth-field-label">Mobile number</span><span class="otp-phone" data-phone-split data-dial="${country}"><button type="button" class="otp-cc" data-cc-btn aria-label="Select country code"><span data-cc-dial>+${country}</span>${icon('chev-down', { size: 13 })}</button><input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" required placeholder="Mobile number" maxlength="14"></span></label>
          <p class="fine fine-left">We’ll send a 6-digit code by SMS. Standard message rates may apply.</p>
          <button class="btn btn-primary btn-lg block" type="submit" id="otpSend">Send me a code</button>
        </div>
        <div id="otpCodeStep" hidden>
          <p class="muted" id="otpSentTo"></p>
          <label><span class="auth-field-label">Enter the 6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" class="pin-input" placeholder="6-digit code"></label>
          <label class="auth-icon-field"><span class="auth-field-label">Your name (new accounts only)</span>${icon('user', { size: 18 })}<input name="name" maxlength="60" autocomplete="name" placeholder="Full name"></label>
          <button class="btn btn-primary btn-lg block" type="submit" id="otpVerify">Verify &amp; continue</button>
          <div class="row between otp-links"><button type="button" class="linklike" id="otpResend" disabled>Resend code</button><button type="button" class="linklike" id="otpChange">Change number</button></div>
        </div>
      </div>` : ''}

      <div id="emailPane" ${canOtp ? 'hidden' : ''}>
        <div class="social" id="social" ${hasSocial ? '' : 'hidden'}></div>
        <div class="or" id="or" ${hasSocial ? '' : 'hidden'}><span>or use your email</span></div>
        ${signup ? html`<label class="auth-icon-field"><span class="auth-field-label">Your name</span>${icon('user', { size: 18 })}<input name="name" autocomplete="name" required maxlength="60" placeholder="Full name"></label>` : ''}
        <label class="auth-icon-field"><span class="auth-field-label">Email</span>${icon('mail', { size: 18 })}<input name="email" type="email" autocomplete="email" required placeholder="Email address" inputmode="email"></label>
        <label class="auth-icon-field"><span class="auth-field-label">Password</span>${icon('lock', { size: 18 })}<span class="pw"><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${signup ? 'Password (8+ characters)' : 'Password'}"><button type="button" class="icon-btn" id="pwt" aria-label="Show password">${icon('eye', { size: 18 })}</button></span></label>
        ${signup ? '' : html`<a class="forgot-link" href="#/forgot">Forgot password?</a>`}
        <button class="btn btn-primary btn-lg block" type="submit" id="asub">${signup ? 'Create account' : 'Sign in'}</button>
      </div>

      <div class="auth-busy" id="asBusy" hidden><div class="spinner"></div><p id="asBusyMsg">Signing you in…</p></div>
      <div class="form-status" id="as" role="alert"></div>
      ${signup ? html`<p class="fine">By creating an account you agree to our <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>.</p>` : ''}
      <p class="switch-auth">${signup ? html`Already have an account? <a href="#/signin?next=${encodeURIComponent(next)}">Sign in</a>` : html`New to ADDABAAZ? <a href="#/signup?next=${encodeURIComponent(next)}">Create an account</a>`}</p>
      <div class="auth-footer-links"><p class="fine">Trouble signing in? <a href="#/support">Get help</a></p>
      <a class="skip" href="#/">Continue without an account</a></div>
    </form></div>`.s;

  // Everything below works on the page that is already drawn; nothing here changes its layout afterwards.
  if (hasSocial) {
    mountSocialButtons($('#social', ctx.root), providers, {
      signup,
      onError: (m) => { setStatus(m); toast(m); },
      onCredential: async (provider, cred) => {
        setStatus('');
        busy(true, provider === 'google' ? 'Signing you in with Google…' : provider === 'apple' ? 'Signing you in with Apple…' : 'Signing you in…');
        try { const r = await u.signInSocial(provider, cred, ref); busy(false); finish(r.isNew ? 'Welcome to ADDABAAZ!' : 'Signed in'); }
        catch (err) { busy(false); const m = friendly(err); setStatus(m); toast(m); }
      },
    });
  }

  const st = () => $('#as', ctx.root);
  const setStatus = (msg, kind = 'err') => { const el = st(); el.textContent = msg; el.className = kind === 'ok' ? 'form-status success' : 'form-status'; };
  const finish = (msg, type = 'ok') => { toast(msg, type); if (u.needsProfileChoice()) go('/profiles?next=' + encodeURIComponent(next), { replace: true }); else go(next, { replace: true }); };
  // The overlay covers the whole card, so the viewer always sees why the form is frozen.
  const busy = (on, what = 'Signing you in…') => {
    const el = $('#asBusy', ctx.root); if (!el) return;
    const msg = $('#asBusyMsg', ctx.root); if (msg) msg.textContent = what;
    el.hidden = !on;
  };

  /* ---------- mode switch (mobile number ⇄ email) ---------- */
  const setMode = (m) => {
    mode = m;
    $('#otpPane', ctx.root).hidden = m !== 'otp';
    $('#emailPane', ctx.root).hidden = m !== 'email';
    $('#tabOtp', ctx.root).classList.toggle('on', m === 'otp');
    $('#tabEmail', ctx.root).classList.toggle('on', m === 'email');
    $('#tabOtp', ctx.root).setAttribute('aria-selected', String(m === 'otp'));
    $('#tabEmail', ctx.root).setAttribute('aria-selected', String(m === 'email'));
    $('#authSub', ctx.root).textContent = m === 'otp'
      ? 'Use your mobile number to get started.'
      : (signup ? 'Save your favourites and watch across devices.' : 'Pick up where you left off.');
    setStatus('');
  };
  if (canOtp) ctx.onCleanup(wirePhoneSplits(ctx.root, { onCountry: (c) => { country = c.dial; } }));
  $('#tabOtp', ctx.root)?.addEventListener('click', () => setMode('otp'));
  $('#tabEmail', ctx.root)?.addEventListener('click', () => setMode('email'));

  /* ---------- password visibility, close button ---------- */
  $('#pwt', ctx.root)?.addEventListener('click', () => { const i = $('[name=password]', ctx.root); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('#authClose', ctx.root).addEventListener('click', () => go(!u.account && /^\/account(?:[/?]|$)/.test(next) ? '/' : next));   // the × closes the form

  /* ---------- phone sign-in (SMS OTP) ---------- */
  // The number is sent in the form people type it; the server normalizes it so the same number always maps to
  // the same account.
  const phoneInput = () => $('[name=phone]', ctx.root);
  const startResendTimer = () => {
    const btn = $('#otpResend', ctx.root); if (!btn) return;
    let left = RESEND_SECONDS;
    btn.disabled = true; btn.textContent = `Resend code in ${left}s`;
    clearInterval(timer);
    timer = setInterval(() => {
      left -= 1;
      if (!btn.isConnected) { clearInterval(timer); return; }
      if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = 'Resend code'; return; }
      btn.textContent = `Resend code in ${left}s`;
    }, 1000);
  };
  ctx.onCleanup(() => clearInterval(timer));

  const requestCode = async (isResend = false) => {
    const phone = phoneInput()?.value.trim() || phoneSent;
    const btn = isResend ? $('#otpResend', ctx.root) : $('#otpSend', ctx.root);
    if (!phone) { setStatus('Please enter your mobile number.'); return; }
    if (btn) btn.disabled = true;
    setStatus('');
    try {
      const r = await u.requestOtp(`${country}${phone.replace(/\D/g, '')}`, ref);
      phoneSent = phone;
      $('#otpPhoneStep', ctx.root).hidden = true;
      $('#otpCodeStep', ctx.root).hidden = false;
      $('#otpSentTo', ctx.root).textContent = `We sent a 6-digit code to +${country} ${phone}.`;
      $('[name=code]', ctx.root).focus();
      startResendTimer();
      toast(isResend ? 'Code resent' : 'Code sent');
      if (r?.devHint) console.info('[dev] SMS is not configured — the code was printed in the server log.');
    } catch (err) {
      setStatus(friendly(err));
      if (btn && isResend) btn.disabled = false;
    } finally {
      if (btn && !isResend) btn.disabled = false;
    }
  };
  $('#otpResend', ctx.root)?.addEventListener('click', (e) => { e.preventDefault(); requestCode(true); });
  $('#otpChange', ctx.root)?.addEventListener('click', (e) => {
    e.preventDefault();
    clearInterval(timer);
    $('#otpCodeStep', ctx.root).hidden = true;
    $('#otpPhoneStep', ctx.root).hidden = false;
    setStatus('');
    phoneInput()?.focus();
  });

  /* ---------- submit: one form covers every method, so Enter works on mobile keyboards ---------- */
  $('#af', ctx.root).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (mode === 'otp') {
      const onCodeStep = !$('#otpCodeStep', ctx.root).hidden;
      if (!onCodeStep) return requestCode(false);          // Enter in the number field = "send me a code"
      const code = String($('[name=code]', ctx.root)?.value || '').replace(/\D/g, '');
      const name = String($('[name=name]', ctx.root)?.value || '').trim();
      if (code.length < 4) { setStatus('Enter the code we sent you.'); return; }
      const btn = $('#otpVerify', ctx.root);
      btn.disabled = true; setStatus('');
      try {
        const r = await u.signInOtp(`${country}${phoneSent.replace(/\D/g, '')}`, code, name || undefined, ref);
        finish(r.isNew ? 'Welcome to ADDABAAZ!' : 'Signed in');
      } catch (err) { setStatus(friendly(err)); btn.disabled = false; }
      return;
    }
    // E-mail + password.
    const f = new FormData(e.target);
    const body = { email: String(f.get('email')).trim(), password: String(f.get('password')) };
    if (signup) { body.name = String(f.get('name')).trim(); if (ref) body.ref = ref; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { setStatus('Please enter a valid email address.'); return; }
    if (body.password.length < 8) { setStatus('Password must be at least 8 characters.'); return; }
    if (signup && !body.name) { setStatus('Please enter your name.'); return; }
    const btn = $('#asub', ctx.root);
    btn.disabled = true; setStatus('');
    busy(true, signup ? 'Creating your account…' : 'Signing you in…');
    try {
      const result = await (signup ? u.signUp(body) : u.signIn(body));
      if (signup && result.verificationEmailSent === false) finish('Account created, but the confirmation email could not be sent. Try Resend link from Account.', 'err');
      else finish(signup ? 'Welcome to ADDABAAZ!' : 'Signed in');
    } catch (err) { busy(false); setStatus(friendly(err)); btn.disabled = false; }
  });
}
