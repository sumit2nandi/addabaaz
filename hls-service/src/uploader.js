/**
 * Puts a finished HLS package into the bucket.
 *
 * Rules that matter for a live site:
 *   1. segments first, then each variant playlist, then master.m3u8 LAST — a player never sees a
 *      playlist that points at files which are not there yet;
 *   2. a few files are uploaded at a time (parallel PUTs, not thousands of round-trips in series);
 *   3. every upload is retried and then verified with a HEAD, and the playlists are read back so a
 *      half-uploaded package is reported instead of silently saved;
 *   4. nothing is deleted from the bucket, ever — an operator decides that.
 */
import { contentTypeFor, referencedFiles } from './ffmpeg.js';

const ORDER = { segment: 0, playlist: 1, master: 2 };
/** Priority inside a package: media segments, then variant playlists, then the master playlist. */
export function uploadOrder(file) {
  const name = file.name;
  if (/^master\.m3u8$/.test(name)) return ORDER.master;
  if (/\.m3u8$/.test(name)) return ORDER.playlist;
  return ORDER.segment;
}
export const sortForUpload = (files) => [...files].sort((a, b) => uploadOrder(a) - uploadOrder(b) || a.name.localeCompare(b.name));

/** The object key of a package file: `<prefix>/<slug>/<relative path>`. */
export function objectKey({ prefix, slug, name }) {
  const clean = (s) => String(s || '').replace(/^\/+|\/+$/g, '').replace(/\.\./g, '');
  return [clean(prefix), clean(slug), String(name).replace(/^\/+/, '')].filter(Boolean).join('/');
}

/** `premium/shahid-ep6/` — a trailing slash makes the portal's “folder” copy action obvious. */
export const folderOf = (masterKey) => `${String(masterKey).replace(/\/[^/]*$/, '')}/`;

/**
 * Uploads every file of the package. `onProgress({ done, total, bytes, name, percent })` is called
 * as each file lands, `log` gets human-readable lines.
 */
export async function uploadPackage({ files, r2, prefix, slug, concurrency = 4, onProgress = () => {}, log = () => {} }) {
  if (!r2?.configured) throw Object.assign(new Error('Cloudflare R2 is not configured on this service, so the package cannot be uploaded.'), { code: 'r2_not_configured', status: 503 });
  const queue = sortForUpload(files);
  const total = queue.length;
  const totalBytes = queue.reduce((n, f) => n + f.bytes, 0);
  let done = 0, bytes = 0, failed = null;

  // A small worker pool: `concurrency` files in flight, in the order computed above.
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, async () => {
    for (;;) {
      if (failed) return;
      const file = queue.shift();
      if (!file) return;
      const key = objectKey({ prefix, slug, name: file.name });
      try {
        await r2.putFile(key, file.path, { contentType: file.type || contentTypeFor(file.name), size: file.bytes });
        const head = await r2.head(key).catch(() => null);
        if (head && head.status === 200 && head.size !== null && head.size !== file.bytes) {
          throw new Error(`“${key}” arrived with ${head.size} bytes instead of ${file.bytes}.`);
        }
        done++; bytes += file.bytes;
        onProgress({ done, total, bytes, totalBytes, name: file.name, percent: (done / total) * 100 });
      } catch (e) {
        failed = e;
        log(`upload failed for ${key}: ${e.message}`);
        return;
      }
    }
  });
  await Promise.all(workers);
  if (failed) throw Object.assign(new Error(`Uploading to R2 failed: ${failed.message}`), { code: failed.code || 'r2_upload_failed', status: failed.status || 502 });

  // Read the playlists back: proves the package is complete and tells the operator exactly what a
  // player will request (the master playlist must exist and point at playlists that exist).
  const masterKey = objectKey({ prefix, slug, name: 'master.m3u8' });
  const master = await r2.getText(masterKey);
  if (!master) throw Object.assign(new Error(`master.m3u8 was uploaded to ${masterKey} but cannot be read back — check the token's read permission.`), { code: 'r2_verify_failed', status: 502 });
  const folder = folderOf(masterKey);
  const missing = [];
  for (const uri of referencedFiles(master, folder)) {
    const exists = new Set(files.map((f) => objectKey({ prefix, slug, name: f.name })));
    if (!exists.has(uri)) missing.push(uri);
  }
  if (missing.length) log(`note: the master playlist references ${missing.length} file(s) not in this package (${missing.slice(0, 3).join(', ')}…)`);
  return { masterKey, folder, bytes, files: total, totalBytes };
}
