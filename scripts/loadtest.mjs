#!/usr/bin/env node
/* Dependency-free load test.   npm run loadtest -- --url http://localhost:3000 --users 50 --seconds 20 [--scenario browse|mixed]
 *
 *   browse  anonymous visitors: /catalog, /plans, /studio, a watch-page render (SEO HTML), comments, ratings
 *   mixed   80% browse + 20% signed-in viewers: progress saves, heartbeats, list/ratings reads
 *
 * ⚠ Run it against a STAGING copy, never production. It creates accounts (loadtest+N@example.invalid) and the API's per-IP rate
 *   limits (signup 20/min …) will turn most requests into 429s unless you start the server with DISABLE_RATE_LIMIT=true
 *   (ignored when NODE_ENV=production).
 * ⚠ The numbers depend on the machine running the test, the network in between and the database size — treat them as a way to
 *   compare before/after a change and to find the knee of the curve, not as a capacity promise. */
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const BASE = String(args.url || 'http://localhost:3000').replace(/\/$/, ''), API = BASE + '/api/v1';
const USERS = Number(args.users) || 25, SECONDS = Number(args.seconds) || 15, SCENARIO = args.scenario === 'browse' ? 'browse' : 'mixed';
if (/\.(in|com|org|net)\b/.test(new URL(BASE).hostname) && !args['i-know']) { console.error('That looks like a public site. Load-test a staging copy, or pass --i-know if you really mean it.'); process.exit(2); }

const lat = new Map(), status = new Map(); let total = 0, bytes = 0, netErrors = 0;
const rec = (name, ms, code) => { (lat.get(name) || lat.set(name, []).get(name)).push(ms); const k = `${name} ${code}`; status.set(k, (status.get(k) || 0) + 1); total++; };
async function hit(name, method, url, { token, body } = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}`, 'X-Device-Id': 'load-' + token.slice(-8) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const buf = await r.arrayBuffer(); bytes += buf.byteLength; rec(name, performance.now() - t0, r.status);
    return { status: r.status, json: () => { try { return JSON.parse(Buffer.from(buf).toString()); } catch { return null; } } };
  } catch { netErrors++; rec(name, performance.now() - t0, 'ERR'); return { status: 0, json: () => null }; }
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const cat = (await (await fetch(API + '/catalog')).json().catch(() => null));
if (!cat?.videos?.length) { console.error('Could not read', API + '/catalog — is the server up?'); process.exit(1); }
const eps = cat.videos.filter((v) => v.kind === 'episode'), free = eps.filter((v) => v.access !== 'premium');
const stop = Date.now() + SECONDS * 1000;

async function anonymous() {
  while (Date.now() < stop) {
    const v = pick(free.length ? free : eps), r = Math.random();
    if (r < .3) await hit('GET /catalog', 'GET', API + '/catalog');
    else if (r < .45) await hit('GET /plans', 'GET', API + '/plans');
    else if (r < .6) await hit('GET /studio', 'GET', API + '/studio');
    else if (r < .8) await hit('GET /watch/:id (SEO HTML)', 'GET', `${BASE}/watch/${v.id}`);
    else if (r < .9) await hit('GET comments', 'GET', `${API}/videos/${v.id}/comments`);
    else await hit('GET ratings', 'GET', `${API}/ratings/video/${v.id}`);
    await new Promise((r2) => setTimeout(r2, 20 + Math.random() * 80));       // think time
  }
}
async function viewer(n) {
  const email = `loadtest+${Date.now().toString(36)}${n}@example.invalid`;
  const s = await hit('POST /auth/signup', 'POST', API + '/auth/signup', { body: { name: 'Load Test', email, password: 'loadtest-pass-1' } });
  const j = s.json(); if (!j?.token) return anonymous();
  const token = j.token, pid = j.profiles[0].id;
  while (Date.now() < stop) {
    const v = pick(free.length ? free : eps), r = Math.random();
    if (r < .35) await hit('PUT progress', 'PUT', `${API}/profiles/${pid}/progress/${v.id}`, { token, body: { position: Math.floor(Math.random() * 600), duration: v.duration || 900 } });
    else if (r < .55) await hit('GET library', 'GET', `${API}/profiles/${pid}/library`, { token });
    else if (r < .7) await hit('GET /me', 'GET', `${API}/me`, { token });
    else if (r < .85) await hit('GET ratings (mine)', 'GET', `${API}/profiles/${pid}/ratings`, { token });
    else await hit('PUT rating', 'PUT', `${API}/profiles/${pid}/ratings/video/${v.id}`, { token, body: { value: 1 } });
    await new Promise((r2) => setTimeout(r2, 50 + Math.random() * 150));
  }
}
console.log(`Load test: ${USERS} virtual users × ${SECONDS}s against ${BASE}  (scenario: ${SCENARIO})`);
const t0 = performance.now();
await Promise.all([...Array(USERS)].map((_, i) => (SCENARIO === 'mixed' && i % 5 === 0 ? viewer(i) : anonymous())));
const secs = (performance.now() - t0) / 1000;
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`\n${total} requests in ${secs.toFixed(1)}s = ${(total / secs).toFixed(0)} req/s, ${(bytes / 1048576).toFixed(1)} MB received, ${netErrors} network errors\n`);
console.log('endpoint'.padEnd(30), 'count'.padStart(7), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), '  statuses');
for (const [name, a] of [...lat].sort()) {
  a.sort((x, y) => x - y); const st = [...status].filter(([k]) => k.startsWith(name + ' ')).map(([k, c]) => `${k.slice(name.length + 1)}×${c}`).join(' ');
  console.log(name.padEnd(30), String(a.length).padStart(7), `${q(a, .5).toFixed(0)}ms`.padStart(7), `${q(a, .95).toFixed(0)}ms`.padStart(7), `${q(a, .99).toFixed(0)}ms`.padStart(7), ' ', st);
}
const limited = [...status].filter(([k]) => / 429$/.test(k)).reduce((n, [, c]) => n + c, 0);
if (limited) console.log(`\n⚠ ${limited} requests were rate limited (429). Start the server with DISABLE_RATE_LIMIT=true to measure raw capacity.`);
const bad = [...status].filter(([k]) => / (5\d\d|ERR)$/.test(k)).reduce((n, [, c]) => n + c, 0);
process.exit(bad ? 1 : 0);
