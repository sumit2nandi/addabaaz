import crypto from 'node:crypto';
import { wrap, HttpError, bad } from '../http.js';
import { normalizePhone, generateOtp } from '../sms.js';
import { isDuplicate } from '../db-errors.js';

export function registerPhoneLinkRoutes(api, { db, sms, secret, authLimit }) {
  const phoneFor = (req) => {
    if (req.user.phone) throw new HttpError(409, 'phone_already_set', 'A phone is already registered. Contact support to change it.');
    if (!sms?.configured || sms.provider === 'none') throw new HttpError(503, 'sms_not_configured', 'SMS verification is unavailable. Please try again later.');
    const phone = normalizePhone(req.body?.phone, sms.countryCode);
    if (!phone) throw bad('Enter a valid mobile number.', 'invalid_phone');
    return phone;
  };
  // Bind the hash to this account, number and purpose; a sign-in code cannot link a phone.
  const codeHash = (user, phone, code) => crypto.createHmac('sha256', secret).update(`phone-link:${user}:${phone}:${code}`).digest('hex');
  api.post('/me/phone/request', authLimit, wrap(async (req, res) => {
    const phone = phoneFor(req);
    if (await db.phones.byPhone(phone)) throw new HttpError(409, 'phone_unavailable', 'This number cannot be added. Use another number or contact support.');
    const code = generateOtp(6);
    const id = await db.phoneLinks.issue(req.user.id, phone, codeHash(req.user.id, phone, code));
    try { await sms.send({ phone, code, minutes: 10 }); }
    catch (error) { await db.phoneLinks.revoke(id); throw error; }
    res.status(202).json({ ok: true });
  }));
  api.post('/me/phone/verify', authLimit, wrap(async (req, res) => {
    const phone = phoneFor(req), code = String(req.body?.code || '');
    if (!/^\d{6}$/.test(code)) throw bad('Enter the six-digit code sent by SMS.', 'invalid_code');
    let result;
    try { result = await db.phoneLinks.verify(req.user.id, phone, codeHash(req.user.id, phone, code)); }
    catch (error) { if (isDuplicate(error)) throw new HttpError(409, 'phone_unavailable', 'This number cannot be added. Contact support.'); throw error; }
    if (result === 'already_set') throw new HttpError(409, 'phone_already_set', 'A phone is already registered.');
    if (result === 'disabled') throw new HttpError(403, 'account_disabled', 'This account is not available.');
    if (result !== 'ok') throw new HttpError(400, result === 'invalid' ? 'otp_invalid' : 'otp_expired', result === 'invalid' ? 'Incorrect code. Try again.' : 'The code expired or reached its attempt limit. Request a new one.');
    res.json({ phone, phoneVerified: true });
  }));
}
