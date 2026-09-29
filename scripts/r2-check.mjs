// Verifies your R2 credentials and that a premium object is reachable:  npm run r2:check -- premium/shahid-ep6/master.m3u8
// Reads the same R2_* environment variables as the server (export them or use `node --env-file=.env`).
import { createR2 } from '../server/src/r2.js';

const r2 = createR2();
if (!r2.configured) { console.error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.'); process.exit(1); }
const key = process.argv[2];
if (!key) { console.error('Usage: npm run r2:check -- <object key>   (e.g. premium/shahid-ep6/video.mp4)'); process.exit(1); }
const h = await r2.head(key).catch((e) => ({ status: 0, error: e.message }));
if (h.status === 200) console.log(`✔ ${key} is readable (${h.type || 'unknown type'}, ${h.size ? (h.size / 1048576).toFixed(1) + ' MB' : 'size unknown'})`);
else {
  console.error(`✖ ${key}: HTTP ${h.status || 'network error'} ${h.error || ''}`);
  console.error({ 403: 'Credentials rejected, or the token has no access to this bucket.', 404: 'No such object — check the key (case-sensitive, no leading slash).', 0: 'Could not reach R2 — check R2_ACCOUNT_ID / network.' }[h.status] || '');
  process.exit(1);
}
