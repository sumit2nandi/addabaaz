// Authentication and identity-provider HTTP endpoints. Business persistence is injected as ports.
import crypto from 'node:crypto';
import { isDuplicate } from '../db-errors.js';
import { hashPassword, verifyPassword, signToken, signJwt, verifyToken, DUMMY_PASSWORD_HASH } from '../auth.js';
import { HttpError, bad, wrap } from '../http.js';
import { normalizeEmail } from '../email-address.js';
import { SocialError } from '../social-errors.js';

export function registerAuthRoutes(api, { db, secret, social, features, mailer, authLimit, publicUser, notDisabled, sms = null }) {
  // Create an account with e-mail + password. A verification-mail failure must be visible to the user (the account is still created so they can sign in and retry).
  api.post('/auth/signup', authLimit, wrap(async (req, res) => {
    const { name = '', email = '', password = '' } = req.body || {};
    // One address = one account: the address is normalized (case, full-width characters and invisible
    // paste artefacts removed) before it is compared or stored — see server/src/email-address.js.
    const norm = normalizeEmail(email);
    // An address that only becomes usable after cleaning ("rupa @example.com", a full-width ＠) is fine:
    // the stored address is always the normalized one.
    if (typeof email !== 'string' || email.length > 254 || !norm.ok || (typeof email === 'string' && email.trim() === '')) throw bad('Please enter a valid email address.', 'invalid_email');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw bad('Password must be 8–128 characters.', 'weak_password');
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw bad('Please enter your name.', 'invalid_name');
    // Passwords are hashed (scrypt) before they touch the database.
    const user = { id: crypto.randomUUID(), email: norm.email, emailNorm: norm.email, name: name.trim(), passwordHash: await hashPassword(password) };
    const profile = { id: crypto.randomUUID(), name: user.name.split(/\s+/)[0].slice(0, 24), color: 0 };
    // The unique e-mail index is the real duplicate check (safe against two simultaneous sign-ups).
    try { await db.users.createWithProfile(user, profile); }
    catch (e) {
      if (!isDuplicate(e)) throw e;
      const ex = await db.users.byEmail(user.email);
      throw new HttpError(409, 'email_taken', ex && !ex.passwordHash ? 'This email is already registered — use “Continue with Google/Facebook” to sign in.' : 'An account with this email already exists.');
    }
    let verificationEmailSent = false;
    try {
      await features.sendVerification({ ...user, emailVerifiedAt: null }, { strict: true });
      verificationEmailSent = mailer.provider === 'smtp';
    } catch (e) {
      // Keep the newly created account usable, but don't silently pretend its confirmation mail went out.
      console.warn(`[auth] verification email failed${e.code ? ` (${e.code})` : ''}:`, e.message);
    }
    res.status(201).json({ token: signToken(user.id, secret), user: publicUser(user), profiles: [profile], verificationEmailSent });
  }));
  // Log in with e-mail + password. Returns a session token.
  api.post('/auth/login', authLimit, wrap(async (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const user = (await db.users.byEmailNorm(normalizeEmail(email).email)) || (await db.users.byEmail(String(email).trim().toLowerCase()));
    // Always run an asynchronous hash to keep timing similar whether or not the user exists, without blocking the event loop.
    const matches = await verifyPassword(String(password), user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user?.passwordHash || !matches) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
    notDisabled(user);
    res.json({ token: signToken(user.id, secret, undefined, user.sessionVersion), user: publicUser(user) });
  }));

  /* ---------- social sign-in ---------- */
  // Tells the front end which social buttons to show.
  // `otp` tells the sign-in page whether to offer phone sign-in first (SMS OTP) and which country code
  // the number field should assume. It is false whenever MSG91 is not configured, so the page falls back
  // to email + password without any errors.
  api.get('/auth/providers', (_req, res) => res.json({
    password: true,
    otp: !!sms?.configured && sms.provider !== 'none',
    otpCountryCode: sms?.countryCode || '91',
    ...social.config,
  }));
  const LABEL = { google: 'Google', facebook: 'Facebook', apple: 'Apple' };
  // Shared by Google, Facebook and Apple: verify the provider's token, then find or create our own account.
  // An existing account with the same *verified* e-mail is linked rather than duplicated.
  async function socialSignIn(provider, credential, opts = {}) {
    const verifier = social.verifiers?.[provider];
    if (!verifier) throw new HttpError(501, 'provider_not_configured', `${LABEL[provider]} sign-in isn’t enabled on this server.`);
    let claims;
    try { claims = await verifier(credential); }
    catch (e) { if (e instanceof SocialError) throw new HttpError(e.code === 'provider_unavailable' ? 503 : 401, e.code, e.message); throw e; }
    const ident = { provider, subject: claims.subject, email: claims.email };
    let user = await db.identities.userFor(provider, claims.subject), isNew = false;
    // First time we see this social identity.
    if (!user) {
      const norm = normalizeEmail(claims.email);
      if (!claims.email || !norm.ok) throw bad(`${LABEL[provider]} didn’t share an email address. Please sign up with email instead.`, 'email_required');
      if (!claims.emailVerified) throw bad('Your email address isn’t verified with the provider.', 'email_unverified');
      claims.email = norm.email;
      user = (await db.users.byEmailNorm(norm.email)) || (await db.users.byEmail(claims.email));
      if (user) await db.identities.link(user.id, ident);              // same verified email → same person: link the provider
      else {
        const name = (claims.name || claims.email.split('@')[0]).trim().slice(0, 60);
        const fresh = { id: crypto.randomUUID(), email: norm.email, emailNorm: norm.email, name };
        const profile = { id: crypto.randomUUID(), name: name.split(/\s+/)[0].slice(0, 24), color: 0 };
        try { await db.identities.createUser(fresh, profile, ident); user = fresh; isNew = true; }
        catch (e) {
          if (!isDuplicate(e)) throw e;                                   // lost a race with a parallel request: use the winner
          user = (await db.identities.userFor(provider, claims.subject)) || (await db.users.byEmailNorm(norm.email));
          if (user) await db.identities.link(user.id, ident);
        }
      }
    }
    // Should be unreachable; guards against an unexpected race.
    if (!user) throw new HttpError(500, 'server_error', 'Something went wrong.');
    notDisabled(user);
    await db.identities.touch(provider, claims.subject);
    if (!user.emailVerifiedAt) await db.accounts.markVerified(user.id);           // the provider already verified this address
    // Native apps: instead of handing the session to the (external) browser that did the OAuth
    // dance, hand back a 2-minute single-use ticket the app exchanges for its own session.
    if (opts.ticket) return { ticket: signJwt({ aud: 'oauth-ticket', sub: user.id, sv: user.sessionVersion, jti: crypto.randomUUID() }, secret, 120) };
    return { token: signToken(user.id, secret, undefined, user.sessionVersion), user: publicUser({ ...user, emailVerifiedAt: user.emailVerifiedAt || true }), profiles: await db.profiles.list(user.id), isNew };
  }
  // One endpoint per provider; the body carries the provider's ID token / access token.
  api.post('/auth/google', authLimit, wrap(async (req, res) => res.json(await socialSignIn('google', req.body?.idToken, { ticket: req.body?.ticket === true }))));
  api.post('/auth/facebook', authLimit, wrap(async (req, res) => res.json(await socialSignIn('facebook', req.body?.accessToken))));
  api.post('/auth/apple', authLimit, wrap(async (req, res) => res.json(await socialSignIn('apple', { identityToken: req.body?.identityToken, name: req.body?.name }))));

  /* ---------- native Google sign-in (Custom Tab + one-time ticket deep link) ----------
   * Google refuses sign-in inside WebViews, and the native SDK needs every build keystore's
   * SHA-1 registered in the Google console. So the app opens a same-origin page in real Chrome
   * (Custom Tab) that shows the very same Google Identity Services button the website uses -
   * the site origin is already an authorized JavaScript origin, so NO console change is needed
   * (no redirect URIs, no SHA-1, no client secret). The verified id_token is exchanged for a
   * 2-minute single-use ticket that is deep-linked back into the app for its own session. */
  const APP_SCHEME = 'in.addabaaz.app';   // = the Capacitor appId; AndroidManifest gets this scheme as a redirect filter
  const usedTickets = new Map();          // jti -> expiry (ms); single-use enforcement for /auth/ticket
  const forgetUsedTickets = () => { const now = Date.now(); for (const [k, v] of usedTickets) if (v < now) usedTickets.delete(k); };
  // The Custom Tab lands here: a tiny same-origin page (JS in an external file - the CSP forbids inline scripts).
  api.get('/auth/google/native-page', (_req, res) => {
    res.type('html').set('Cache-Control', 'no-store').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADDABAAZ</title><body style="margin:0;background:#050505;color:#eee;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;gap:14px">
<div style="display:grid;justify-items:center;gap:14px"><p id="out">Continue with Google to sign in to the ADDABAAZ app.</p><div id="g"></div></div>
<script src="/api/v1/auth/google-native.js"></script>`);
  });
  api.get('/auth/google-native.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-store').send(`(function () {
  var out = document.getElementById('out');
  var say = function (m) { out.textContent = m; };
  fetch('/api/v1/auth/providers').then(function (r) { return r.json(); }).then(function (p) {
    if (!p.google) { say('Google sign-in isn’t enabled on this server.'); return; }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onerror = function () { say('Couldn’t reach Google — check the connection and try again.'); };
    s.onload = function () {
      window.google.accounts.id.initialize({ client_id: p.google.clientId, callback: onCred, use_fedcm_for_prompt: true });
      window.google.accounts.id.renderButton(document.getElementById('g'), { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left' });
      try { window.google.accounts.id.prompt(); } catch (e) { /* the button is always there */ }
    };
    document.head.appendChild(s);
  }).catch(function () { say('Couldn’t reach the ADDABAAZ API — check the connection and try again.'); });
  function onCred(r) {
    if (!r.credential) return;
    say('Signing you in — returning to the app…');
    fetch('/api/v1/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: r.credential, ticket: true }) })
      .then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error((j.error && j.error.message) || 'Sign-in failed'); return j; }); })
      .then(function (j) { location.replace('${APP_SCHEME}://oauth?ticket=' + encodeURIComponent(j.ticket)); })
      .catch(function (e) { say(e.message || 'Sign-in failed — please try again in the app.'); });
  }
})();`);
  });
  // The app's WebView exchanges the single-use ticket for its own session token.
  api.post('/auth/ticket', authLimit, wrap(async (req, res) => {
    const claims = verifyToken(String(req.body?.ticket || ''), secret);
    if (!claims || claims.aud !== 'oauth-ticket' || !claims.jti) throw new HttpError(401, 'invalid_ticket', 'Sign-in ticket invalid or expired.');
    forgetUsedTickets();
    if (usedTickets.has(claims.jti)) throw new HttpError(401, 'invalid_ticket', 'This sign-in ticket was already used.');
    usedTickets.set(claims.jti, Date.now() + 130_000);
    const user = notDisabled(await db.users.byId(String(claims.sub)));
    if (!user) throw new HttpError(401, 'invalid_ticket', 'Sign-in ticket invalid or expired.');
    res.json({ token: signToken(user.id, secret, undefined, user.sessionVersion), user: publicUser(user), profiles: await db.profiles.list(user.id), isNew: false });
  }));
}
