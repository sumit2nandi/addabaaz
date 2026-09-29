/**
 * Database configuration from the environment.
 *   DATABASE_URL=mysql://user:pass@host:3306/addabaaz          (preferred; e.g. PlanetScale/RDS/Railway style)
 *   or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   DB_SSL=true            enable TLS (managed MySQL: RDS, Cloud SQL, PlanetScale, Azure…)
 *   DB_POOL_SIZE=10
 */
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
  if (/^(1|true|yes)$/i.test(env.DB_SSL || '')) cfg.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: !/^(0|false)$/i.test(env.DB_SSL_VERIFY || '') };
  // How many connections the pool may keep open.
  cfg.connectionLimit = Number(env.DB_POOL_SIZE) || 10;
  return cfg;
}
