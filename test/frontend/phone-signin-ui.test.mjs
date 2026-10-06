// Phone sign-in UI (SMS OTP first) and the one-time notification prompt.
//
// The server half lives in server/test/phone-signin.test.js; these are source pins for the browser side:
// the sign-in page must lead with the mobile number when the server says OTP is on, fall back to the email
// form when it is off, and the notification prompt must ask exactly once and never nag.
// Run: node --test test/frontend/phone-signin-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const auth = read('app/js/views/auth.js');
const prompt = read('app/js/notify-prompt.js');
const main = read('app/js/main.js');
const user = read('app/js/data/user.js');
const adapters = read('app/js/data/adapters.js');
const css = read('app/css/styles.css');

test('the sign-in page leads with the mobile number, and only when the server offers OTP', () => {
  assert.match(auth, /const providers = await u\.providers\(\)/, 'the page asks the server which methods exist');
  assert.match(auth, /const canOtp = !!providers\.otp/, 'OTP is offered only when /auth/providers says so');
  assert.match(auth, /let mode = canOtp \? 'otp' : 'email'/, 'mobile number is the default method, email is the fallback');
  assert.match(auth, /Mobile number<\/button>/, 'the method switch has a Mobile number tab');
  assert.match(auth, /Email<\/button>/, 'and an Email tab');
  assert.match(auth, /Send me a code/, 'step one sends the code');
  assert.match(auth, /Verify &amp; continue/, 'step two verifies it');
  assert.match(auth, /autocomplete="one-time-code"/, 'the code field is offered the SMS code by the OS keyboard');
  assert.match(auth, /pattern="\[0-9\]\*" maxlength="6"/, 'the code field is numeric and six digits');
  assert.match(auth, /Resend code in \$\{left\}s/, 'resending waits out the server’s one-a-minute limit');
  assert.match(auth, /Trouble signing in\? <a href="#\/support">Get help<\/a>/, 'the sign-in page points at Support');
  // The email + password form is unchanged when OTP is unavailable — and still present when it is.
  assert.match(auth, /id="emailPane"/);
  assert.match(auth, /signup \? u\.signUp\(body\) : u\.signIn\(body\)/);
});

test('phone sign-in talks to the OTP endpoints through the data layer', () => {
  // The optional `ref` carries a friend's invite code (docs/PROMOS.md) — it does not change the flow.
  assert.match(user, /requestOtp\(phone, ref = ''\) \{ return this\.remote\.requestOtp\(phone, ref\); \}/, 'user.requestOtp exists');
  assert.match(user, /async signInOtp\(phone, code, name, ref = ''\)/, 'user.signInOtp exists');
  assert.match(adapters, /requestOtp\(phone, ref = ''\)/, 'the remote adapter calls the API');
  assert.match(adapters, /auth\/otp\/request/, 'the request endpoint is /auth/otp/request');
  assert.match(adapters, /auth\/otp\/verify/, 'the verify endpoint is /auth/otp/verify');
  assert.match(read('server/src/routes/otp.js'), /api\.post\('\/auth\/otp\/request'/, 'the server registers it');
  assert.match(read('server/src/routes/auth.js'), /otp: !!sms\?\.configured && sms\.provider !== 'none'/, 'and reports whether it is on');
});

test('the notification permission is asked once, gently, and never again', () => {
  assert.match(prompt, /const KEY = 'ab\.notifyAsked'/, 'the answer is remembered per installation');
  assert.match(prompt, /const DELAY = 6000/, 'the prompt waits for the first screen to settle');
  assert.match(prompt, /const BLOCKED = \['\/signin', '\/signup'/, 'never on the sign-in or player screens');
  assert.match(prompt, /if \(!pushSupported\(\) && !nativePushSupported\(\)\) \{ remember\(\); return false; \}/, 'unsupported clients are never asked');
  assert.match(prompt, /if \(state\.enabled === false\) return false;/, 'push must be configured server-side (and stays un-answered until it is)');
  assert.match(prompt, /if \(!nativePushSupported\(\) && Notification\.permission !== 'default'\) \{ remember\(\); return false; \}/, 'an OS-level decision is respected');
  assert.match(prompt, /Turn on notifications/, 'one clear action');
  assert.match(prompt, /Not now/, 'and a real way to decline');
  assert.match(prompt, /await enablePush\(\{ episodes: true, launches: true, news: true \}\)/, 'turning it on subscribes with all three kinds on');
  assert.match(prompt, /pending = true;/, 'repeated calls cannot schedule two prompts');
  assert.match(main, /initNotifyPrompt\(\{ path: currentPath\(\) \}\)/, 'the app asks through it on boot and on navigation');
  assert.match(main, /window\.addEventListener\('ab:ready', ask\)/, 'and after each route change (the module decides)');
  assert.match(css, /\.dlg-centered .dlg-body \.row\.end \.btn, \.dialog-sm \.row\.end \.btn \{ min-width: 132px/, 'confirm buttons share one size');
  assert.match(css, /\.btn-danger \{ background-color: var\(--accent\); background-image: var\(--accent-gradient\); border-color: var\(--accent\); color: #fff;/,
    'the destructive button uses the same branded red gradient as the primary button');
});

test('the sign-in page styles exist for the phone-first form', () => {
  for (const cls of ['.seg-full', '.otp-phone', '.otp-cc', '.otp-links', '.auth-busy'])
    assert.ok(css.includes(cls), `${cls} is styled`);
  assert.match(css, /\.auth-busy\[hidden\] \{ display: none; \}/, 'the busy state stays hidden until it is used');
  // Reported from a phone: "Forgot password?" sat almost on top of the Sign in button. It tucks up under the
  // password field and now carries its own bottom margin, which adds to the form's 16px row gap.
  const forgot = css.match(/\.forgot-link \{[^}]*\}/)?.[0] || '';
  assert.ok(forgot, 'the forgot link is styled');
  assert.match(forgot, /margin: -6px 0 10px;/, 'it keeps its tuck above and gains air below');
  // Read both numbers back out of the stylesheet: the link's own margin adds to the form's row gap.
  const gap = Number(css.match(/\.form \{ display: grid; gap: (\d+)px; \}/)?.[1]);
  const below = Number(forgot.match(/margin: -6px 0 (\d+)px;/)?.[1]);
  assert.ok(gap > 0 && below > 0, 'the row gap and the link margin are both declared');
  assert.ok(gap + below >= 26, `the link-to-button gap grows from ${gap}px to ${gap + below}px`);
});

test('the sign-in loader covers the whole card, on every method', () => {
  const auth = read('app/js/views/auth.js');
  // The overlay used to live inside the mobile-number pane, so on the e-mail tab (where the Google,
  // Facebook and Apple buttons are) its parent was hidden and the spinner never appeared.
  const card = auth.slice(auth.indexOf('<form class="auth-card form" id="af"'), auth.indexOf('</form>'));
  assert.match(card, /<div class="auth-busy" id="asBusy" hidden>/, 'one overlay, a child of the card itself');
  const otpPaneStart = card.indexOf('<div id="otpPane">');
  const otpPaneEnd = card.indexOf('<div id="emailPane"');
  const otpPane = card.slice(otpPaneStart, otpPaneEnd);
  assert.equal(otpPane.includes('asBusy'), false, 'it is not inside the mobile-number pane any more');
  assert.match(auth, /busy\(true, provider === 'google' \? 'Signing you in with Google…'/, 'the social flow turns it on with a clear label');
  assert.match(auth, /busy\(true, signup \? 'Creating your account…'/, 'and so does the e-mail form');
  assert.match(read('app/css/styles.css'), /\.auth-busy \{ display: flex; flex-direction: column; align-items: center; justify-content: center;/, 'centred over the card, not pinned to the top');
});
