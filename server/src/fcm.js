// Firebase Cloud Messaging (HTTP v1) — real app push for the native Android/iOS apps.
//
// The admin console sends a notification to every registered device token (see Admin → Notifications
// and POST /api/v1/devices, which the Capacitor apps call after `PushNotifications.register()`).
// Delivery uses FCM's HTTP v1 API with a Google service account:
//
//   1. build a JWT (RS256) signed with the service account's private key,
//   2. exchange it at oauth2.googleapis.com for an access token (cached until it expires),
//   3. POST one message per device token to fcm.googleapis.com/v1/projects/<id>/messages:send.
//
// Configuration (either one):
//   FCM_SERVICE_ACCOUNT       the service-account JSON itself (Firebase → Project settings → Service accounts)
//   FCM_SERVICE_ACCOUNT_FILE  path to that JSON file
// Without it, `configured` is false and everything else keeps working (push to browsers, e-mail) —
// the admin page shows the app-push channel as "not set up yet".
//
// Tests inject `fetchImpl` (and a self-generated service-account JSON), so no network or credentials
// are needed to exercise the signing, the token caching and the per-token result handling.
import crypto from 'node:crypto';
import fs from 'node:fs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Reads the service-account JSON from FCM_SERVICE_ACCOUNT (inline) or FCM_SERVICE_ACCOUNT_FILE. */
export function serviceAccountFromEnv(env = process.env) {
  const inline = (env.FCM_SERVICE_ACCOUNT || '').trim();
  if (inline) { try { return JSON.parse(inline); } catch { return null; } }
  const file = (env.FCM_SERVICE_ACCOUNT_FILE || '').trim();
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** True when the object looks like a usable Google service account. */
export const isServiceAccount = (c) => !!(c && c.client_email && c.private_key && c.project_id);

/**
 * @param {object}   o
 * @param {object?}  o.credentials  service-account JSON ({ project_id, client_email, private_key, token_uri })
 * @param {Function?} o.fetchImpl   fetch-compatible function (tests)
 * @param {object?}  o.log
 */
export function createFcm({ credentials = null, fetchImpl = null, log = console } = {}) {
  const creds = isServiceAccount(credentials) ? credentials : null;
  const projectId = creds?.project_id || '';
  const tokenUri = creds?.token_uri || TOKEN_URL;
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const configured = !!creds;
  let cached = null;                                   // { token, expiresAt }

  // Signed JWT assertion for the OAuth2 token exchange.
  function assertion() {
    const iat = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: creds.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }));
    const body = `${header}.${claims}`;
    return `${body}.${b64url(crypto.createSign('RSA-SHA256').update(body).sign(creds.private_key))}`;
  }

  /** Cached OAuth2 access token for the messaging scope. */
  async function accessToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await doFetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion() }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw Object.assign(new Error(`FCM auth failed (${res.status}): ${json.error_description || json.error || 'no access token'}`), { statusCode: res.status });
    cached = { token: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
    return cached.token;
  }

  const message = (token, m) => ({
    message: {
      token,
      notification: { title: String(m.title || 'ADDABAAZ').slice(0, 100), body: String(m.body || '').slice(0, 200), ...(m.image ? { image: m.image } : {}) },
      // Everything the app needs to open the right page when the notification is tapped.
      data: { url: String(m.url || '/'), ...(m.tag ? { tag: String(m.tag) } : {}), ...(m.data || {}) },
      android: { priority: 'normal', notification: { sound: 'default', ...(m.tag ? { tag: String(m.tag) } : {}) } },
      apns: { payload: { aps: { sound: 'default', ...(m.tag ? { 'thread-id': String(m.tag) } : {}) } } },
    },
  });

  // FCM says a token is gone (app uninstalled, token rotated) with 404/410 or an UNREGISTERED status.
  const deadToken = (status, body) => status === 404 || status === 410 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(String(body?.error?.status || ''));

  /** Sends `m` ({title, body, url, image, tag}) to one token. @returns { ok, dead, error? } */
  async function sendOne(token, m) {
    if (!configured) return { ok: false, dead: false, error: 'not_configured' };
    const access = await accessToken();
    const res = await doFetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify(message(token, m)),
    });
    if (res.ok) return { ok: true, dead: false };
    const body = await res.json().catch(() => ({}));
    const dead = deadToken(res.status, body);
    const error = body?.error?.message || `HTTP ${res.status}`;
    if (!dead) log.warn?.(`[fcm] send failed (${res.status}): ${error}`);
    return { ok: false, dead, error };
  }

  return {
    configured, projectId, sendOne,
    /** Sends `m` to many tokens, a few in flight at a time. @returns { sent, failed, dead: string[] } */
    async send(tokens, m, { concurrency = 8 } = {}) {
      const list = [...new Set((tokens || []).filter(Boolean))];
      if (!configured || !list.length) return { sent: 0, failed: 0, dead: [] };
      let sent = 0, failed = 0; const dead = [];
      for (let i = 0; i < list.length; i += concurrency) {
        const results = await Promise.all(list.slice(i, i + concurrency).map((t) => sendOne(t, m).catch((e) => ({ ok: false, dead: false, error: e?.message }))));
        results.forEach((r, k) => { if (r.ok) sent++; else if (r.dead) dead.push(list[i + k]); else failed++; });
      }
      return { sent, failed, dead };
    },
  };
}

/** Builds the service from FCM_SERVICE_ACCOUNT / FCM_SERVICE_ACCOUNT_FILE. */
export const fcmFromEnv = (env = process.env) => createFcm({ credentials: serviceAccountFromEnv(env) });
