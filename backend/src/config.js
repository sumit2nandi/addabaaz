import fs from 'node:fs';
export function databaseConfig(env = process.env) {
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!env[key]) throw new Error(`${key} is required. See backend/.env.example.`);
  const port = Number(env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT must be a valid TCP port.');
  return {
    host: env.DB_HOST, port, database: env.DB_NAME,
    user: env.DB_USER, password: env.DB_PASSWORD, charset: 'utf8mb4',
    connectionLimit: 5, connectTimeout: 10000, enableKeepAlive: true,
    ...(env.DB_SSL_CA ? { ssl: { ca: fs.readFileSync(env.DB_SSL_CA), rejectUnauthorized: true } } : {})
  };
}
export function serverConfig(env = process.env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) throw new Error('ADMIN_TOKEN must be a random secret of at least 32 characters.');
  const trustProxy = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  return { adminToken: env.ADMIN_TOKEN, origins: (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean), trustProxy };
}
