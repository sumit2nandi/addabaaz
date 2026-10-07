import crypto from 'node:crypto';
import { HttpError } from './http.js';

// The account row serializes resend, verification and concurrent attempts for that account.
export function phoneLinkDb({ q, tx }) {
  return {
    async issue(userId, phone, hash) {
      return tx(async (t) => {
        const [user] = await t.query('SELECT phone, disabled_at FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (!user || user.disabled_at) throw new HttpError(403, 'account_disabled', 'This account is not available.');
        if (user.phone) throw new HttpError(409, 'phone_already_set', 'This account already has a phone number. Contact support to change it.');
        const [limits] = await t.query('SELECT MAX(created_at) AS latest, COUNT(*) AS n FROM account_phone_otps WHERE user_id = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR', [userId]);
        if (limits.latest && Date.now() - new Date(limits.latest).getTime() < 60_000) throw new HttpError(429, 'otp_cooldown', 'Wait one minute before requesting another code.');
        const [{ n }] = await t.query('SELECT COUNT(*) AS n FROM account_phone_otps WHERE phone = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR', [phone]);
        if (Number(limits.n) >= 5 || Number(n) >= 5) throw new HttpError(429, 'otp_flood', 'Too many codes requested. Try again in an hour.');
        await t.query('UPDATE account_phone_otps SET consumed_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND consumed_at IS NULL', [userId]);
        const id = crypto.randomUUID();
        await t.query('INSERT INTO account_phone_otps (id, user_id, phone, code_hash, expires_at) VALUES (?,?,?,?,?)', [id, userId, phone, hash, new Date(Date.now() + 600_000)]);
        return id;
      });
    },
    async revoke(id) { await q('UPDATE account_phone_otps SET consumed_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]); },
    async verify(userId, phone, hash) {
      return tx(async (t) => {
        const [user] = await t.query('SELECT phone, disabled_at FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (!user || user.disabled_at) return 'disabled';
        if (user.phone) return 'already_set';
        const [otp] = await t.query('SELECT id, code_hash, attempts FROM account_phone_otps WHERE user_id = ? AND phone = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(3) ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [userId, phone]);
        if (!otp || otp.attempts >= 5) return 'expired';
        const expected = Buffer.from(otp.code_hash), actual = Buffer.from(hash);
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
          await t.query('UPDATE account_phone_otps SET attempts = attempts + 1, consumed_at = IF(attempts >= 5, UTC_TIMESTAMP(3), consumed_at) WHERE id = ?', [otp.id]);
          return 'invalid'; // Return rather than throw so the attempt increment commits.
        }
        // The unique users.phone index resolves races with sign-up or another account linking it.
        await t.query('UPDATE users SET phone = ?, phone_verified_at = UTC_TIMESTAMP(3) WHERE id = ? AND phone IS NULL', [phone, userId]);
        await t.query('UPDATE account_phone_otps SET consumed_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND consumed_at IS NULL', [userId]);
        return 'ok';
      });
    },
  };
}
