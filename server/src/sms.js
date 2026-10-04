// SMS delivery for phone sign-in (OTP). MSG91 is the provider; the module is written so that
// everything else keeps working when it is not configured:
//
//   configured (MSG91_AUTH_KEY + MSG91_OTP_TEMPLATE_ID)      → real SMS through MSG91
//   not configured, development                              → the code is printed to the server log ("console" provider)
//   not configured, production                               → provider 'none': the OTP routes answer 503 and the
//                                                              sign-in page keeps offering email + password
//
// MSG91 OTP API (v5):  POST https://control.msg91.com/api/v5/otp?template_id=…&mobile=91XXXXXXXXXX&otp=…&otp_expiry=…
// with the `authkey` header. We generate the 6-digit code ourselves and hand it to MSG91 (the `otp`
// parameter), then verify it on OUR server against a stored hash — so MSG91 never decides who is signed in.
// The approved DLT template must contain the ##OTP## variable for that to work (see docs/MSG91.md).
//
// Errors from MSG91 answer HTTP 200 with `{ "type": "error", … }` — the body is always inspected, never
// just the status code.

import crypto from 'node:crypto';

/** Error for SMS-provider problems (503 unreachable, 502 provider rejected the request). */
export class SmsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// MSG91 expects the number in international format without "+" (e.g. 919812345678).
const DIGITS = /^\d{6,15}$/;

/**
 * Normalizes a phone number to MSG91's `91XXXXXXXXXX` form.
 * Accepts +91 98123 45678, 098123 45678, 9812345678, 0091-9812345678, (981) 234-5678 …
 * @param {string} input
 * @param {string} defaultCountry e.g. '91' (India)
 * @returns {string|null} the E.164 digits without "+", or null when it cannot be a phone number
 */
export function normalizePhone(input, defaultCountry = '91') {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  // Keep digits only; a leading + is implied by the compact form we store.
  let digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  // 00 is the international access prefix in many countries.
  if (digits.startsWith('00')) digits = digits.slice(2);
  // A national trunk 0 in front of the country code (0 98123 …).
  if (digits.startsWith('0') && !digits.startsWith('00')) digits = digits.replace(/^0+/, '');
  if (!DIGITS.test(digits)) return null;
  const cc = String(defaultCountry || '91').replace(/\D/g, '');
  // Already carries a country code: 10-digit Indian numbers never start with 91 (they start with 6-9),
  // so an 11-12 digit number that begins with the country code is already international.
  if (digits.length > 10 && cc && digits.startsWith(cc)) return digits;
  if (digits.length === 10) return cc + digits;
  // Any other length is passed through when it already looks international, otherwise refused.
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

// Accounts created by phone sign-in have no email address yet. `users.email` is NOT NULL (a unique key
// from before phone sign-in existed), so such an account gets an address on this reserved domain that
// can never receive mail. It is replaced the moment the viewer shares a real address, and no mail is ever
// sent to it (see features.js and the campaign audience queries).
export const PHONE_EMAIL_DOMAIN = 'phone.addabaaz.in';
export const phoneEmail = (phone) => `${String(phone).replace(/\D/g, '')}@${PHONE_EMAIL_DOMAIN}`;
export const isPhoneEmail = (email) => !!email && String(email).toLowerCase().endsWith(`@${PHONE_EMAIL_DOMAIN}`);

/** Masked form for logs and admin views: 919812345678 → +91 98•••••678. */
export const maskPhone = (phone) => {
  const p = String(phone || '').replace(/\D/g, '');
  if (p.length < 6) return p ? '•••' : '';
  if (p.length <= 10) return `${p.slice(0, 2)}•••••${p.slice(-3)}`;
  const cc = p.slice(0, p.length - 10), rest = p.slice(-10);
  return `+${cc} ${rest.slice(0, 3)}••••${rest.slice(-3)}`;
};

/**
 * MSG91 client (plain HTTPS, no SDK). `fetchImpl` is injectable so tests can simulate MSG91.
 * @param {object} o
 * @param {string} o.authKey      MSG91 → API → Auth Key
 * @param {string} o.templateId   MSG91 → OTP → Templates → the approved template's id
 * @param {string} [o.senderId]   the DLT-approved 6-character header (optional for OTP templates)
 * @param {string} [o.countryCode] default country prefix ('91')
 * @param {string} [o.endpoint]    override for self-hosted tests
 * @param {Function} [o.fetchImpl]
 * @param {object} [o.log]
 */
export function createMsg91({ authKey, templateId, senderId = '', countryCode = '91', endpoint = 'https://control.msg91.com/api/v5/otp', fetchImpl = null, log = console }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return {
    provider: 'msg91',
    configured: true,
    channel: 'sms',
    countryCode,
    /**
     * Sends the OTP by SMS.
     * @param {object} o
     * @param {string} o.phone   normalized number (91…)
     * @param {string} o.code    6-digit code
     * @param {number} [o.minutes] how long the code stays valid (MSG91's otp_expiry)
     * @returns {Promise<{sent: boolean, providerRef?: string}>}
     */
    async send({ phone, code, minutes = 10 }) {
      const params = new URLSearchParams({
        template_id: templateId,
        mobile: phone,
        otp: String(code),
        otp_length: String(String(code).length),
        otp_expiry: String(Math.max(1, Math.min(60, Math.round(Number(minutes) || 10)))),
      });
      if (senderId) params.set('sender', senderId);
      let res;
      try {
        res = await doFetch(`${endpoint}?${params.toString()}`, {
          method: 'POST',
          headers: { authkey: authKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ otp: String(code) }),
        });
      } catch {
        throw new SmsError(503, 'sms_unavailable', 'We couldn’t send the code right now — please try again in a minute.');
      }
      const body = await res.json().catch(() => ({}));
      // MSG91 answers HTTP 200 even for failures; `type` is the field that decides.
      const failed = body?.type === 'error' || body?.type === 'fail' || (body?.code && String(body.code) === '201');
      if (!res.ok || failed) {
        // Never log the OTP itself; the message from MSG91 is safe (it names the field, not the value).
        log.warn?.(`[sms] MSG91 rejected the OTP request (HTTP ${res.status}${body?.code ? `, code ${body.code}` : ''}): ${body?.message || 'no message'}`);
        // A rejected auth key is a configuration problem (502), anything else is usually the number/template.
        const authProblem = res.status === 401 || /authkey|auth key/i.test(String(body?.message || ''));
        throw new SmsError(
          502,
          authProblem ? 'sms_auth_failed' : 'sms_send_failed',
          authProblem
            ? 'SMS sign-in is temporarily unavailable (the SMS provider rejected our key). Please use email instead.'
            : 'We couldn’t send the code to that number right now — please try again or use email.',
        );
      }
      return { sent: true, providerRef: body?.message || '' };
    },
  };
}

/**
 * Development stand-in: no SMS is sent and the code is printed to the server log, so phone sign-in can be
 * tested (and demoed) before MSG91 is configured. Never used in production.
 */
export const createConsoleSms = ({ log = console, countryCode = '91' } = {}) => ({
  provider: 'console',
  configured: true,
  dev: true,
  channel: 'sms',
  countryCode,
  async send({ phone, code }) {
    log.log?.(`[sms:dev] OTP for ${phone} is ${code} (MSG91 is not configured — see docs/MSG91.md)`);
    return { sent: true, providerRef: 'dev' };
  },
});

/** Chooses the provider from the environment. Mirrors paymentsFromEnv(): real / dev stand-in / none. */
export function smsFromEnv(env = process.env, { log = console, fetchImpl = null } = {}) {
  const authKey = String(env.MSG91_AUTH_KEY || '').trim();
  const templateId = String(env.MSG91_OTP_TEMPLATE_ID || '').trim();
  const countryCode = String(env.MSG91_COUNTRY_CODE || '91').replace(/\D/g, '') || '91';
  if (authKey && templateId) {
    return createMsg91({
      authKey,
      templateId,
      senderId: String(env.MSG91_SENDER_ID || '').trim(),
      countryCode,
      fetchImpl,
      log,
    });
  }
  if (authKey || templateId) {
    log.warn?.('[sms] MSG91 is half-configured: set BOTH MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID (see docs/MSG91.md). SMS sign-in stays off.');
  }
  if (env.NODE_ENV !== 'production') return createConsoleSms({ log, countryCode });
  return { provider: 'none', configured: false, channel: 'sms', countryCode, async send() { throw new SmsError(503, 'sms_not_configured', 'SMS sign-in isn’t set up yet — please use email.'); } };
}

/**
 * What Admin → Dashboard → System status says about SMS sign-in. Pure and secret-free: it looks at which
 * variables are present and which provider the server picked — never at their values.
 * @param {object} env       process.env (or an equivalent)
 * @param {string} provider  the running provider: 'msg91' | 'console' | 'none'
 * @returns {{ok: boolean, level: 'ok'|'warn'|'info', detail: string}}
 */
export function smsHealthCheck(env = process.env, provider = '') {
  const authKey = !!String(env.MSG91_AUTH_KEY || '').trim();
  const templateId = !!String(env.MSG91_OTP_TEMPLATE_ID || '').trim();
  if (provider === 'msg91' || (authKey && templateId)) {
    return {
      ok: true,
      level: 'ok',
      detail: 'MSG91 is connected: phone sign-in sends a real 6-digit code through your approved template. Use “Send test SMS” below to check delivery to a number.',
    };
  }
  if (provider === 'console' || env.NODE_ENV !== 'production') {
    return {
      ok: false,
      level: 'info',
      detail: 'Not set up for real SMS: on this server the code is only printed in the server log (development stand-in). Add MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID to send real texts — see docs/MSG91.md.',
    };
  }
  return {
    ok: false,
    level: 'warn',
    detail: !authKey && !templateId
      ? 'Phone sign-in is off: MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are not set, so viewers sign in with e-mail or a social provider. The whole setup — including the DLT template India requires — is in docs/MSG91.md.'
      : `Phone sign-in is off: only MSG91_${authKey ? 'AUTH_KEY' : 'OTP_TEMPLATE_ID'} is set — both are needed. See docs/MSG91.md.`,
  };
}

/* ---------- one-time codes ---------- */
// The digits a viewer types. crypto.randomInt is unbiased (Math.random would be fine for a 6-digit code,
// but the code guards account access, so the cheap correct call is used).
export const generateOtp = (digits = 6) => String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');
