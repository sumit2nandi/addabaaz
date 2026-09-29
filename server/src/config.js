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
  if (env.DATABASE_URL) {
    const u = new URL(env.DATABASE_URL);
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
