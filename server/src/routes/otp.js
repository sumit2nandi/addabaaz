// Phone sign-in with an SMS one-time password (MSG91 — see docs/MSG91.md).
//
//   POST /auth/otp/request  { phone }              → sends a 6-digit code; 202 on success
//   POST /auth/otp/verify   { phone, code, name? } → signs in, or creates the account on first use
//
// The code is generated and verified HERE (only its SHA-256 hash is stored); the SMS provider (sms.js)
// only delivers it. When MSG91 is not configured the endpoints answer 503 with a clear message while the
// sign-in page keeps offering email + password, so the app never breaks (in development a "console"
// provider prints the code to the server log instead).
//
// Guard rails: one code a minute per number, at most 5 codes per hour, 6-digit codes that expire after
// 10 minutes, at most 5 wrong tries per code (then it is burnt), per-IP rate limiting through the shared
// `authLimit`, and generic answers so nobody can discover which numbers have accounts.
import crypto from 'node:crypto';
import { isDuplicate } from '../db-errors.js';
import { signToken } from '../auth.js';
import { HttpError, bad, wrap } from '../http.js';
import { normalizePhone, generateOtp, phoneEmail } from '../sms.js';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const OTP_TTL_MS = 10 * 60_000;          // the code stays valid for 10 minutes
const RESEND_COOLDOWN_MS = 60_000;       // one SMS a minute per number
const MAX_PER_HOUR = 5;                  // flood guard per number
const MAX_ATTEMPTS = 5;                  // wrong tries before the code is burnt

/**
 * @param {object} api        the /api/v1 router (before the auth middleware — these routes are public)
 * @param {object} o
 * @param {object} o.db
 * @param {object} o.sms      sms provider from sms.js ({ configured, provider, send })
 * @param {string} o.secret   session secret
 * @param {Function} o.publicUser
 * @param {Function} o.notDisabled
 * @param {Function} o.authLimit  per-IP rate limiter for authentication endpoints
 */
export function registerOtpRoutes(api, { db, sms, secret, publicUser, notDisabled, authLimit }) {
  // Feature switch the sign-in page reads: without a configured provider no OTP tab is offered.
  const otpEnabled = () => !!sms?.configured && sms.provider !== 'none';
  // The answer is always the same whether or not the number belongs to an account: phone numbers must not
  // be enumerable. `devHint` is only present in development so the flow can be tested without an SMS.
  const accepted = (extra = {}) => ({ ok: true, ...extra });

  api.post('/auth/otp/request', authLimit, wrap(async (req, res) => {
    if (!otpEnabled()) throw new HttpError(503, 'sms_not_configured', 'Sign-in by SMS isn’t set up on this server yet — please use your email and password.');
    const phone = normalizePhone(req.body?.phone, sms.countryCode);
    if (!phone) throw bad('Please enter a valid mobile number (10 digits for India).', 'invalid_phone');
    const last = await db.phoneOtps.lastIssuedAt(phone);
    if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last.getTime())) / 1000);
      throw new HttpError(429, 'otp_cooldown', `A code was just sent. Please wait ${wait} second${wait === 1 ? '' : 's'} and try again.`);
    }
    if ((await db.phoneOtps.recentCount(phone, 3600)) >= MAX_PER_HOUR) {
      throw new HttpError(429, 'otp_flood', 'Too many codes requested for this number. Please try again in an hour or use your email.');
    }
    const code = generateOtp(6);
    // Send first, store second: a provider failure must not leave a code the viewer never received.
    await sms.send({ phone, code, minutes: OTP_TTL_MS / 60_000 });
    await db.phoneOtps.issue(phone, sha256(code), OTP_TTL_MS);
    res.status(202).json(accepted(otpEnabled() && sms.dev ? { devHint: true } : {}));
  }));

  api.post('/auth/otp/verify', authLimit, wrap(async (req, res) => {
    if (!otpEnabled()) throw new HttpError(503, 'sms_not_configured', 'Sign-in by SMS isn’t set up on this server yet — please use your email and password.');
    const phone = normalizePhone(req.body?.phone, sms.countryCode);
    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (!phone) throw bad('Please enter a valid mobile number (10 digits for India).', 'invalid_phone');
    if (!/^\d{4,8}$/.test(code)) throw bad('Enter the code we sent you.', 'invalid_code');
    const active = await db.phoneOtps.active(phone);
    if (!active) throw new HttpError(400, 'otp_expired', 'That code has expired. Request a new one.');
    if (active.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'otp_locked', 'Too many wrong codes. Please request a new one.');
    // Constant-time compare of the hashes (both sides are the same length).
    const given = Buffer.from(sha256(code), 'utf8'), expected = Buffer.from(active.codeHash, 'utf8');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      await db.phoneOtps.fail(active.id, MAX_ATTEMPTS);
      const left = Math.max(0, MAX_ATTEMPTS - (active.attempts + 1));
      throw new HttpError(400, 'otp_invalid', left > 0 ? `That code isn’t right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Please request a new one.');
    }
    if (!(await db.phoneOtps.consume(active.id))) throw new HttpError(400, 'otp_expired', 'That code was already used. Request a new one.');

    // Signs in an existing account, or creates one on first use (sign-up and sign-in are the same flow,
    // exactly like the OTP-first apps people are used to).
    let user = await db.phones.byPhone(phone), isNew = false;
    if (!user) {
      const name = String(req.body?.name || '').trim().slice(0, 60) || 'ADDABAAZ viewer';
      const fresh = { id: crypto.randomUUID(), name, phone, email: phoneEmail(phone) };
      const profile = { id: crypto.randomUUID(), name: name.split(/\s+/)[0].slice(0, 24), color: 0 };
      try { await db.phones.createWithPhone(fresh, profile); user = fresh; isNew = true; }
      catch (e) {
        if (!isDuplicate(e)) throw e;                       // lost a race with a parallel verify: use the winner
        user = await db.phones.byPhone(phone);
      }
    } else {
      // A number that exists but was never confirmed (e.g. typed by mistake earlier): confirm it now.
      if (!user.phoneVerifiedAt) await db.phones.attach(user.id, phone);
    }
    if (!user) throw new HttpError(500, 'server_error', 'Something went wrong.');
    notDisabled(user);
    // A verified phone counts as a verified identity, so commenting/buying are not blocked for phone accounts.
    if (!user.emailVerifiedAt) await db.accounts.markVerified(user.id).catch(() => {});
    res.json({
      token: signToken(user.id, secret, undefined, user.sessionVersion),
      user: publicUser({ ...user, emailVerifiedAt: user.emailVerifiedAt || new Date(), phoneVerifiedAt: user.phoneVerifiedAt || new Date() }),
      profiles: await db.profiles.list(user.id),
      isNew,
      phoneSignIn: true,
    });
  }));
}
