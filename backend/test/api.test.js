import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { original, MemoryRepository, token } from '../../tests/support/fixture.js';
import { databaseConfig, serverConfig } from '../src/config.js';
const auth = { Authorization: `Bearer ${token}` };
const setup = options => { const repository = new MemoryRepository(); return { repository, app: createApp({ repository, adminToken: token, ...options }) }; };

test('web and home read the same version, home excludes non-home content', async () => {
  const { app } = setup();
  const web = await request(app).get('/api/v1/content').expect(200);
  assert.equal(web.body.tables.Promos.length, 158);
  assert.match(web.body.tables.Shows[0].image, /^\/media\//);
  assert.equal(web.headers['cache-control'], 'no-store');
  const home = await request(app).get('/api/v1/content?view=home').expect(200);
  assert.equal(home.body.revision, web.body.revision);
  assert.equal(home.body.runtime.promoVideos.length, web.body.tables.Promos.length);
  assert.equal(home.body.runtime.FORM_CONFIG, undefined);
  assert.ok(!Object.keys(home.body.copy).some(k => /^(contact|about|services)\./.test(k)));
});
test('private content writes require authentication and optimistic revision', async () => {
  const { app } = setup();
  await request(app).put('/api/v1/admin/content').send({ tables: original }).expect(401);
  await request(app).get('/api/v1/admin/content').expect(401);
  await request(app).put('/api/v1/admin/content').set(auth).send({ tables: original }).expect(428);
  const changed = structuredClone(original); changed.Shows[0].title = 'New backend title বাংলা';
  await request(app).put('/api/v1/admin/content').set(auth).set('If-Match', '"1"').send({ tables: changed }).expect(200);
  await request(app).put('/api/v1/admin/content').set(auth).set('If-Match', '"1"').send({ tables: original }).expect(409);
  const web = await request(app).get('/api/v1/content').expect(200);
  assert.equal(web.body.revision, 2); assert.equal(web.body.tables.Shows[0].title, changed.Shows[0].title);
  const home = await request(app).get('/api/v1/content?view=home').expect(200);
  assert.equal(home.body.runtime.projectDetails[changed.Shows[0].key].title, changed.Shows[0].title);
});
test('invalid relationships, unknown fields and malicious URLs do not mutate data', async () => {
  const { app } = setup();
  for (const change of [tables => { tables.Episodes[0].project = 'missing'; }, tables => { tables.Shows[0].image = 'javascript:alert(1)'; }, tables => { tables.Shows[0].unknown = 'injected'; }]) {
    const tables = structuredClone(original); change(tables);
    await request(app).put('/api/v1/admin/content').set(auth).set('If-Match', '"1"').send({ tables }).expect(422);
  }
  assert.equal((await request(app).get('/api/v1/content')).body.revision, 1);
});
test('CORS allowlist supports native origins without opening the admin API', async () => {
  const { app } = setup({ origins: ['capacitor://app.addabaaz.in'] });
  const allowed = await request(app).get('/api/v1/content').set('Origin', 'capacitor://app.addabaaz.in');
  assert.equal(allowed.headers['access-control-allow-origin'], 'capacitor://app.addabaaz.in');
  const denied = await request(app).get('/api/v1/content').set('Origin', 'https://evil.example');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  await request(app).put('/api/v1/admin/content').set('Origin', 'capacitor://app.addabaaz.in').expect(401);
});
test('server never exposes workbook, admin editor, env or server source', async () => {
  const { app } = setup();
  for (const url of ['/data/website.xlsx', '/backend/seed/website.xlsx', '/admin.html', '/.env', '/src/config.js', '/media/../seed/website.xlsx']) await request(app).get(url).expect(404);
  await request(app).get('/').expect(200);
  await request(app).get('/media/images/addabaaz-logo-small.webp').expect(200);
});
test('database outages fail explicitly and do not leak credentials or fake stale data', async () => {
  const app = createApp({ adminToken: token, repository: { read() { throw new Error('mysql secret-password'); }, health() { throw new Error('down'); } } });
  const response = await request(app).get('/api/v1/content').expect(503);
  assert.deepEqual(response.body, { error: 'Service unavailable. Please try again later.' });
  await request(app).get('/api/health').expect(503);
});
test('contact messages are validated and only readable by an administrator', async () => {
  const { app, repository } = setup();
  await request(app).post('/api/v1/inquiries').send({ name: '', email: 'bad', phone: '', message: '' }).expect(422);
  await request(app).post('/api/v1/inquiries').send({ name: 'Visitor', email: 'person@example.com', phone: '', message: 'Project inquiry' }).expect(201);
  assert.equal(repository.messages.length, 1);
  await request(app).get('/api/v1/admin/inquiries').expect(401);
  assert.equal((await request(app).get('/api/v1/admin/inquiries').set(auth).expect(200)).body.inquiries.length, 1);
});
test('image upload validates bytes and cannot overwrite existing files', async () => {
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'addabaaz-media-'));
  try {
    const { app } = setup({ mediaRoot });
    const png = await fs.readFile(new URL('../media/images/addabaaz-icon.png', import.meta.url));
    await request(app).put('/api/v1/admin/media/images/test.png').set('Content-Type', 'image/png').send(png).expect(401);
    await request(app).put('/api/v1/admin/media/images/test.png').set(auth).set('Content-Type', 'image/png').send(png).expect(201);
    await request(app).put('/api/v1/admin/media/images/test.png').set(auth).set('Content-Type', 'image/png').send(png).expect(409);
    await request(app).put('/api/v1/admin/media/images/test.jpg').set(auth).set('Content-Type', 'image/jpeg').send(png).expect(415);
    await request(app).put('/api/v1/admin/media/other/test.png').set(auth).set('Content-Type', 'image/png').send(png).expect(400);
  } finally { await fs.rm(mediaRoot, { recursive: true, force: true }); }
});
test('invalid server configuration fails closed', () => {
  assert.throws(() => serverConfig({}), /ADMIN_TOKEN/);
  assert.throws(() => databaseConfig({}), /DB_HOST/);
});
test('inquiry rate limits and public HTTP contract errors are enforced', async () => {
  const { app } = setup();
  await request(app).get('/api/v1/content?view=admin').expect(400);
  for (let n = 0; n < 5; n++) await request(app).post('/api/v1/inquiries').send({ name: 'Visitor', email: 'test@example.com', phone: '', message: 'Inquiry' }).expect(201);
  await request(app).post('/api/v1/inquiries').send({ name: 'Visitor', email: 'test@example.com', phone: '', message: 'Inquiry' }).expect(429);
  await request(app).put('/api/v1/admin/content').set(auth).set('If-Match', '"1"').set('Content-Type', 'application/json').send('{bad').expect(400);
});
