import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { publicPayload, HttpError, validateContent } from './content.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const defaultMediaRoot = path.join(root, 'backend/media');
export function createApp({ repository, adminToken, origins = [], trustProxy = 0, mediaRoot = defaultMediaRoot, limit = 120 }) {
  if (!adminToken || adminToken.length < 32) throw new Error('A strong admin token is required.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Authentication, not CORS, protects writes. Requests with no Origin (CLI/native) are allowed.
  app.use('/api', cors({ origin(origin, callback) {
    callback(null, !origin || origins.includes(origin));
  }, methods: ['GET', 'PUT', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'], exposedHeaders: ['ETag'] }));
  app.use('/api', rateLimit({ windowMs: 60000, limit, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const expectedToken = createHash('sha256').update(adminToken).digest();
  function authorize(req, res, next) {
    const token = /^Bearer (.+)$/.exec(req.get('Authorization') || '')?.[1] || '';
    if (!timingSafeEqual(createHash('sha256').update(token).digest(), expectedToken)) return res.status(401).json({ error: 'Authentication required.' });
    next();
  }
  app.get('/api/health', async (_req, res) => { await repository.health(); res.json({ status: 'ok' }); });
  app.get('/api/v1/content', async (req, res) => {
    if (req.query.view && !['web', 'home'].includes(req.query.view)) throw new HttpError(400, 'Unknown content view.');
    const snapshot = await repository.read();
    res.set('ETag', `"${snapshot.revision}"`).json(publicPayload(snapshot, req.query.view));
  });
  app.use('/api/v1/admin', authorize);
  app.get('/api/v1/admin/content', async (_req, res) => {
    const snapshot = await repository.read();
    res.set('ETag', `"${snapshot.revision}"`).json(snapshot);
  });
  app.put('/api/v1/admin/content', express.json({ limit: '10mb' }), async (req, res) => {
    const match = /^"(\d+)"$/.exec(req.get('If-Match') || '');
    if (!match) throw new HttpError(428, 'Send the current revision in If-Match, for example "1".');
    const revision = Number(match[1]);
    if (!Number.isSafeInteger(revision)) throw new HttpError(400, 'Invalid revision.');
    const tables = validateContent(req.body?.tables);
    const updated = await repository.replace(tables, revision);
    res.set('ETag', `"${updated}"`).json({ revision: updated });
  });
  app.put('/api/v1/admin/media/:bucket/:filename', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], limit: '10mb' }), async (req, res) => {
    const { bucket, filename } = req.params;
    if (!['images', 'UpcomingReleases', 'BTS'].includes(bucket) || filename.startsWith('.') || /[\\/\u0000-\u001f]/.test(filename) || filename !== filename.trim() || filename.length > 190) throw new HttpError(400, 'Invalid media path.');
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'Upload a PNG, JPEG, WebP or GIF image.');
    const type = await fileTypeFromBuffer(req.body).catch(() => null);
    const extension = path.extname(filename).slice(1).toLowerCase().replace('jpeg', 'jpg');
    if (!type || !['png', 'jpg', 'webp', 'gif'].includes(type.ext) || type.ext !== extension) throw new HttpError(415, 'Image bytes do not match the filename. SVG and executable files are not accepted.');
    await fs.mkdir(path.join(mediaRoot, bucket), { recursive: true });
    try { await fs.writeFile(path.join(mediaRoot, bucket, filename), req.body, { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') throw new HttpError(409, 'File already exists; upload with a new name.'); throw error; }
    res.status(201).json({ path: `${bucket}/${filename}` });
  });
  app.get('/api/v1/admin/inquiries', async (_req, res) => res.json({ inquiries: await repository.inquiries() }));
  app.post('/api/v1/inquiries', rateLimit({ windowMs: 15 * 60000, limit: 5, standardHeaders: true, legacyHeaders: false }), express.json({ limit: '16kb' }), async (req, res) => {
    const value = req.body || {};
    for (const [field, max] of [['name', 120], ['email', 254], ['phone', 40], ['message', 4000]]) {
      if (typeof value[field] !== 'string' || value[field].length > max || (field !== 'phone' && !value[field].trim())) throw new HttpError(422, `Invalid ${field}.`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) throw new HttpError(422, 'Invalid email.');
    await repository.addInquiry(Object.fromEntries(['name', 'email', 'phone', 'message'].map(key => [key, value[key].trim()])));
    res.status(201).json({ message: 'Your inquiry was saved.' });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use('/media', express.static(mediaRoot, { dotfiles: 'deny', index: false, maxAge: '1h' }));
  // Only these frontend directories are public. No repository root, seed workbook,
  // admin page, server configuration or environment files are served.
  app.use('/assets', express.static(path.join(root, 'frontend/assets'), { dotfiles: 'deny', index: false }));
  app.use('/components', express.static(path.join(root, 'frontend/components'), { dotfiles: 'deny', index: false }));
  for (const name of ['workbook.js', 'copy-keys.js', 'runtime-data.js', 'api-client.js']) app.get(`/shared/${name}`, (_req, res) => res.sendFile(path.join(root, 'shared', name)));
  app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(root, 'frontend/index.html')));
  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 503);
    if (status >= 500) console.error('[backend]', error.code || error.name);
    res.status(status).json({ error: status >= 500 && !error.status ? 'Service unavailable. Please try again later.' : error.message });
  });
  return app;
}
