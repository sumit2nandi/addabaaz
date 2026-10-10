// Sign-in / sign-up page (#/signin and #/signup).
//
// Primary method: a mobile number with an SMS one-time code (MSG91) — the same flow signs a new viewer up
// and lets an existing one back in, which is what people expect from an Indian OTT app. It is offered
// only when the server has SMS configured (`otp: true` from /auth/providers); otherwise the page shows the
// e-mail + password form exactly as before, so nothing breaks without MSG91 (see docs/MSG91.md).
//
// Google / Facebook / Apple buttons, the email + password form and `?next=` handling all stay available.
import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { toast } from '../ui/components.js';
import { mountSocialButtons } from '../social.js';
import { friendly } from '../errors.js';
import { passwordProblem, PASSWORD_HINT } from '../password-rule.js';
import { wirePhoneSplits } from '../ui/phone-field.js';

const RESEND_SECONDS = 60;   // matches the server's one-a-minute limit

export default async function auth(ctx) {
  const u = app.user; const signup = ctx.path === '/signup';
  const next = ctx.query.next ? decodeURIComponent(ctx.query.next) : '/';
  // `?ref=CODE` — someone opened a friend's invite link. The code rides along with whichever sign-up
  // method is used, so both sides get their bonus (see server/src/promos.js).
  const ref = String(ctx.query.ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  ctx.setTitle(signup ? 'Create account' : 'Sign in');
  if (!u.supportsAuth) { ctx.root.innerHTML = html`<div class="page"><div class="empty"><h2>Accounts aren’t enabled</h2><p>This copy of ADDABAAZ runs in local mode, so your list and progress are saved on this device. Connect the ADDABAAZ API to enable sign-in and cross-device sync.</p><a class="btn btn-primary" href="#/">Back to Home</a></div></div>`.s; return; }
  if (u.account) { go('/account', { replace: true }); return; }

  // Which methods the server offers. `/auth/providers` never throws; the email form is the floor.
  const providers = await u.providers().catch(() => ({ password: true }));
  const canOtp = !!providers.otp;
  let country = String(providers.otpCountryCode || '91').replace(/\D/g, '') || '91';
  let mode = canOtp ? 'otp' : 'email';        // OTP first whenever it is configured
  let phoneSent = '';
  let timer = null;
  // `stale` is optional on purpose: a browser can briefly hold the previous shell (which cached it) next
  // to this newer page module (which it did not). Without the guard that mix crashed the whole sign-in page
  // with "ctx.stale is not a function".
  if (ctx.stale?.()) return;

  ctx.root.innerHTML = html`<div class="page auth-page auth-entry">
    <form class="auth-card form" id="af" novalidate>
      <button type="button" class="auth-close" id="authClose" aria-label="Close">${icon('x', { size: 16 })}</button>
      <aside class="auth-side">
        <span class="brand-lockup"><b>ADDA</b><i>BAAZ</i></span>
        <h2>One account.<br>Every screen.</h2>
        <p>Premium originals, early access &amp; ad-free viewing — pick up on any device right where you left off.</p>
        <ul>
          <li>${icon('check', { size: 16 })}<span>Watch on TV, laptop &amp; mobile</span></li>
          <li>${icon('check', { size: 16 })}<span>Up to 5 viewing profiles</span></li>
          <li>${icon('check', { size: 16 })}<span>Pay once — no auto-renewal</span></li>
        </ul>
      </aside>
      <div class="auth-main">
      <h1>${signup ? 'Create account' : 'Welcome back'}</h1>
      ${ref ? html`<div class="notice ok" id="refNote">${icon('gift', { size: 18 })}<span>Invite code <b>${ref}</b> will be applied — you and your friend both get credit.</span></div>` : ''}
      <p class="muted" id="authSub">${canOtp ? 'Use your mobile number to get started.' : (signup ? 'Save your favourites and watch across devices.' : 'Pick up where you left off.')}</p>

      ${canOtp ? html`<div class="seg seg-full" role="tablist" aria-label="Sign-in method">
        <button type="button" role="tab" class="on" id="tabOtp" aria-selected="true">${icon('phone', { size: 15 })} Mobile Number</button>
        <button type="button" role="tab" id="tabEmail" aria-selected="false">${icon('mail', { size: 15 })} Email</button>
      </div>` : ''}

      ${canOtp ? html`<div id="otpPane">
        <div id="otpPhoneStep">
          <label><span class="auth-field-label">Mobile Number</span><span class="otp-phone" data-phone-split data-dial="${country}"><button type="button" class="otp-cc" data-cc-btn aria-label="Select country code"><span data-cc-dial>+${country}</span>${icon('chev-down', { size: 13 })}</button><input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" required placeholder="Mobile number" maxlength="14"></span></label>
          <p class="fine fine-left">We’ll send a 6-digit code by SMS. Standard message rates may apply.</p>
          <button class="btn btn-primary btn-lg block" type="submit" id="otpSend">Send Me a Code</button>
        </div>
        <div id="otpCodeStep" hidden>
          <p class="muted" id="otpSentTo"></p>
          <label><span class="auth-field-label">Enter the 6-Digit Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" class="pin-input" placeholder="6-digit code"></label>
          <label class="auth-icon-field"><span class="auth-field-label">Your name (new accounts only)</span>${icon('user', { size: 18 })}<input name="name" maxlength="60" autocomplete="name" placeholder="Full name"></label>
          <button class="btn btn-primary btn-lg block" type="submit" id="otpVerify">Verify &amp; Continue</button>
          <div class="row between otp-links"><button type="button" class="linklike" id="otpResend" disabled>Resend Code</button><button type="button" class="linklike" id="otpChange">Change Number</button></div>
        </div>
      </div>` : ''}

      <div id="emailPane" ${canOtp ? 'hidden' : ''}>
        <div class="social" id="social" hidden></div>
        <div class="or" id="or" hidden><span>or use your email</span></div>
        ${signup ? html`<label class="auth-icon-field"><span class="auth-field-label">Your Name</span>${icon('user', { size: 18 })}<input name="name" autocomplete="name" required maxlength="60" placeholder="Full name"></label>` : ''}
        <label class="auth-icon-field"><span class="auth-field-label">Email</span>${icon('mail', { size: 18 })}<input name="email" type="email" autocomplete="email" required placeholder="Email address" inputmode="email"></label>
        <label class="auth-icon-field"><span class="auth-field-label">Password</span>${icon('lock', { size: 18 })}<span class="pw"><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${signup ? 'Password (8+ chars, upper, lower, number, symbol)' : 'Password'}"><button type="button" class="icon-btn" id="pwt" aria-label="Show password">${icon('eye', { size: 18 })}</button></span></label>
        ${signup ? '' : html`<a class="forgot-link" href="#/forgot">Forgot Password?</a>`}
        <button class="btn btn-primary btn-lg block" type="submit" id="asub">${signup ? 'Create account' : 'Sign in'}${icon('arrow-right', { size: 18 })}</button>
      </div>

      <div class="form-status" id="as" role="alert"></div>
      ${signup ? html`<p class="fine">By creating an account you agree to our <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>.</p>` : ''}
      <p class="switch-auth">${signup ? html`Already have an account? <a href="#/signin?next=${encodeURIComponent(next)}">Sign In</a>` : html`Don’t have an account? <a href="#/signup?next=${encodeURIComponent(next)}">Create an Account</a>`}</p>
      <div class="auth-footer-links"><p class="fine">Trouble Signing In? <a href="#/support">Get Help</a></p>
      <a class="skip guest-btn" href="#/">Browse as Guest</a></div>
      </div>
      <div class="auth-busy" id="asBusy" hidden><div class="spinner"></div><p id="asBusyMsg">Signing you in…</p></div>
    </form></div>`.s;

  const st = () => $('#as', ctx.root);
  const setStatus = (msg, kind = 'err') => { const el = st(); el.textContent = msg; el.className = kind === 'ok' ? 'form-status success' : 'form-status'; };
  const finish = (msg, type = 'ok') => { toast(msg, type); if (u.needsProfileChoice()) go('/profiles?next=' + encodeURIComponent(next), { replace: true }); else go(next, { replace: true }); };
  // The overlay covers the whole card (it sits outside the two panes), so the viewer always sees why the
  // form is frozen — on the mobile-number tab and on the email tab with the Google/Apple buttons.
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

  /* ---------- social buttons + password visibility ---------- */
  u.providers().then((prov) => {                                    // Google / Facebook appear only if the server has them
    const box = $('#social', ctx.root);
    if (!box) return;                                               // navigated away meanwhile
    const shown = mountSocialButtons(box, prov, {
      signup,
      onError: (m) => { setStatus(m); toast(m); },
      onCredential: async (provider, cred) => {
        setStatus('');
        busy(true, provider === 'google' ? 'Signing you in with Google…' : provider === 'apple' ? 'Signing you in with Apple…' : 'Signing you in…');
        try { const r = await u.signInSocial(provider, cred, ref); busy(false); finish(r.isNew ? 'Welcome to ADDABAAZ!' : 'Signed in'); }
        catch (err) { busy(false); const m = friendly(err); setStatus(m); toast(m); }
      },
    });
    if (shown) { box.hidden = false; $('#or', ctx.root).hidden = false; }
  });
  $('#pwt', ctx.root)?.addEventListener('click', () => { const i = $('[name=password]', ctx.root); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('#authClose', ctx.root).addEventListener('click', () => go(!u.account && /^\/account(?:[/?]|$)/.test(next) ? '/' : next));   // the × at the top-right closes the form

  /* ---------- phone sign-in (SMS OTP) ---------- */
  // The number is sent to the server in the form people type it; the server normalizes it (country code,
  // spaces) so the same number always maps to the same account.
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
      toast(isResend ? 'Code Resent' : 'Code Sent');
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

  /* ---------- submit: the form itself switches between the two flows ---------- */
  // One <form> covers every method, so Enter behaves like the visible button on mobile keyboards.
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
    // Email + password (the original flow).
    const f = new FormData(e.target);
    const body = { email: String(f.get('email')).trim(), password: String(f.get('password')) };
    if (signup) { body.name = String(f.get('name')).trim(); if (ref) body.ref = ref; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { setStatus('Please enter a valid email address.'); return; }
    if (signup) { const pwProblem = passwordProblem(body.password); if (pwProblem) { setStatus(pwProblem); return; } }
    else if (!body.password) { setStatus('Please enter your password.'); return; }
    if (signup && !body.name) { setStatus('Please enter your name.'); return; }
    const btn = $('#asub', ctx.root);
    btn.disabled = true; setStatus('');
    busy(true, signup ? 'Creating your account…' : 'Signing you in…');
    try {
      const result = await (signup ? u.signUp(body) : u.signIn(body));
      // The server answers as soon as the account exists: a slow mail server never freezes this screen. A mail
      // still in flight is "pending" (it lands a moment later); a real failure says so and offers the resend path.
      if (signup && result.verificationEmailPending) finish('Account created — the confirmation email is on its way. Resend it from Account if it doesn’t arrive.');
      else if (signup && result.verificationEmailSent === false) finish('Account created, but the confirmation email could not be sent. Try Resend link from Account.', 'err');
      else finish(signup ? 'Welcome to ADDABAAZ!' : 'Signed in');
    } catch (err) { busy(false); setStatus(friendly(err)); btn.disabled = false; }
  });
}
