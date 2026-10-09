/**
 * Database configuration from the environment.
 *   DATABASE_URL=mysql://user:pass@host:3306/addabaaz          (preferred; e.g. PlanetScale/RDS/Railway style)
 *   or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   DB_SSL=true            enable TLS (managed MySQL: RDS, Cloud SQL, PlanetScale, Azure, Aiven…)
 *   DB_SSL_CA_FILE=/etc/secrets/ca.pem   CA certificate to trust (Aiven, some others, sign with their own CA) - a file path, or
 *   DB_SSL_CA="-----BEGIN CERTIFICATE-----..."   the same certificate pasted as text (\n written as \\n is fine)
 *   DB_SSL_VERIFY_IDENTITY=false  only for providers whose valid certificate does not match DB_HOST (hostname verification is on by default)
 *   A URL ending in ?ssl-mode=REQUIRED (what Aiven shows) turns TLS on by itself.
 *   DB_POOL_SIZE=10
 */
import fs from 'node:fs';

/** Rebuilds a certificate pasted into an environment-variable box. Hosting dashboards often turn the line breaks into spaces or a
 *  literal \n, or wrap the value in quotes; OpenSSL then cannot read it and every connection fails with HANDSHAKE_SSL_ERROR. We pull the
 *  certificate(s) out and write them back in the standard 64-characters-per-line form. */
export function normalizePem(text) {
  const out = [];
  for (const m of String(text).matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)) {
    const body = m[1].replace(/\\n|\\r|[\s"']/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(body)) continue;
    out.push(`-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
  }
  if (!out.length) throw new Error('DB_SSL_CA does not contain a certificate. Paste the whole ca.pem file, from the -----BEGIN CERTIFICATE----- line to the -----END CERTIFICATE----- line.');
  return out.join('');
}

// Turns environment variables into a mysql2 pool config.
// `env` is injectable so tests can pass a fake environment.
export function dbConfigFromEnv(env = process.env) {
  let cfg;
  // Preferred form: a single connection URL. Credentials are URL-decoded so special characters work.
  let u = null;
  if (env.DATABASE_URL) {
    try { u = new URL(env.DATABASE_URL); }
    catch {
      // A malformed URL (typically an unescaped special character in the password). Fall back to the separate DB_* settings when
      // they are present, otherwise stop with a message that says what to fix (never echo the URL: it contains the password).
      if (!env.DB_HOST && !env.DB_NAME && !env.DB_USER) throw new Error('DATABASE_URL is not a valid URL. Use the form mysql://user:password@host:3306/database (URL-encode special characters in the password: @ -> %40, # -> %23, : -> %3A, / -> %2F), or remove it and set DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD instead.');
      console.warn('[db] DATABASE_URL is not a valid URL - ignoring it and using DB_HOST / DB_NAME / DB_USER / DB_PASSWORD. Remove DATABASE_URL to silence this warning.');
    }
  }
  if (u) {
    cfg = { host: u.hostname, port: Number(u.port) || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, '') };
  // Fallback: individual DB_* variables, defaulting to a local MySQL.
  } else {
    cfg = { host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT) || 3306, user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME || 'addabaaz' };
  }
  // Optional TLS. Certificates are verified unless DB_SSL_VERIFY=false (only for self-signed lab servers).
  const urlSslMode = (u?.searchParams.get('ssl-mode') || u?.searchParams.get('sslmode') || '').toUpperCase();
  const wantSsl = /^(1|true|yes)$/i.test(env.DB_SSL || '') || !!env.DB_SSL_CA || !!env.DB_SSL_CA_FILE || (urlSslMode && urlSslMode !== 'DISABLED' && urlSslMode !== 'DISABLE');
  if (wantSsl) {
    cfg.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: !/^(0|false)$/i.test(env.DB_SSL_VERIFY || '') };
    // A private CA (Aiven signs every service with its own): from a file (Render "Secret Files") or pasted as an environment variable.
    if (env.DB_SSL_CA_FILE) {
      try { cfg.ssl.ca = normalizePem(fs.readFileSync(env.DB_SSL_CA_FILE, 'utf8')); }
      catch (e) { if (/DB_SSL_CA does not/.test(e.message)) throw new Error(e.message.replace('DB_SSL_CA', 'DB_SSL_CA_FILE')); throw new Error(`DB_SSL_CA_FILE: cannot read "${env.DB_SSL_CA_FILE}" (${e.code || e.message}). Upload the CA certificate as a secret file at that path.`); }
    } else if (env.DB_SSL_CA) cfg.ssl.ca = normalizePem(env.DB_SSL_CA);
    // Node verifies the certificate chain and hostname by default. For an unusual provider whose certificate
    // legitimately does not match DB_HOST, DB_SSL_VERIFY_IDENTITY=false opts out of hostname verification only.
    if (/^(0|false|no)$/i.test(env.DB_SSL_VERIFY_IDENTITY || '')) cfg.ssl.checkServerIdentity = () => undefined;
  }
  // How many connections the pool may keep open.
  cfg.connectionLimit = Number(env.DB_POOL_SIZE) || 10;
  return cfg;
}

/**
 * A database host that is on this machine or inside the same private network, i.e. not reachable over the
 * public internet: loopback, the RFC 1918 ranges, or a single-label name (`mysql`, `db`) that only a
 * Docker/compose or VPC-internal resolver can answer. `docker-compose.yml` runs MySQL on the compose
 * network, so that last case is the normal one for a self-hosted install — not a warning to ignore.
 */
const PRIVATE_DB_HOST = /^(127\.\d+\.\d+\.\d+|::1|localhost|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;
const isPrivateDbHost = (host) => PRIVATE_DB_HOST.test(String(host || '')) || !String(host || '').includes('.');

/**
 * Boot-time warnings about how the database connection itself is protected.
 *
 * `dbConfigFromEnv` stays a pure mapping (unit-tested, and shared with the CLI scripts), so the judgement
 * about what is acceptable lives here and index.js prints it once at startup — the same way it already
 * reports the resolved host and the TLS mode. Unencrypted MySQL in production leaks the DB password and
 * every row (including e-mail addresses and payment references) to anyone who can see the network path,
 * which is exactly the case for a hosted database reached over the public internet.
 * @returns {string[]} messages to log; empty when nothing is wrong
 */
export function dbTransportWarnings(cfg = {}, env = process.env) {
  const out = [];
  const production = env.NODE_ENV === 'production';
  const host = String(cfg.host || '');
  // An operator who has read this and decided TLS is unnecessary (a private network where the database is
  // only reachable by the app) can stop the warning with DB_SSL=disabled. Anything else than that exact
  // value keeps the warning, so a typo cannot silence it by accident.
  const tlsDeclined = /^(disabled|off|no)$/i.test(String(env.DB_SSL || '').trim());
  if (!cfg.ssl) {
    if (production && !tlsDeclined && host && !isPrivateDbHost(host)) {
      out.push(`[db] MySQL at "${host}" is reached WITHOUT TLS — the password and every query travel in clear text. Set DB_SSL=true (and DB_SSL_CA / DB_SSL_CA_FILE when the provider signs with its own CA). Set DB_SSL=disabled once you have confirmed the network really is private.`);
    }
  } else {
    if (production && cfg.ssl.rejectUnauthorized === false) out.push('[db] DB_SSL_VERIFY=false turns off certificate verification, so any host on the path can impersonate the database. Give us the provider CA in DB_SSL_CA instead of disabling verification.');
    if (production && typeof cfg.ssl.checkServerIdentity === 'function') out.push('[db] DB_SSL_VERIFY_IDENTITY=false skips the hostname check on the database certificate. Keep it off only for a provider whose certificate is legitimately issued for another name.');
    if (!cfg.ssl.ca && production && !isPrivateDbHost(host)) out.push('[db] TLS is on with no CA certificate: only publicly trusted issuers are accepted. Managed providers (Aiven, some RDS setups) sign with a private CA — set DB_SSL_CA or DB_SSL_CA_FILE, or connections will fail with HANDSHAKE_SSL_ERROR.');
  }
  return out;
}
