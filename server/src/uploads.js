import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Image sniffing by magic bytes — never trust the client's Content-Type or file name. SVG is deliberately NOT accepted (scriptable). */
export function sniffImage(buf) {
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return { ext: 'gif', type: 'image/gif' };
  return null;
}

/** What a stored upload is called: 24 hex characters of its content hash + an extension (webp png jpg gif for images, vtt for subtitles). */
export const UPLOAD_NAME = /^[0-9a-f]{24}\.(?:webp|png|jpg|gif|vtt)$/;
const UPLOAD_TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', vtt: 'text/vtt; charset=utf-8' };
/** The Content-Type a stored upload is served with, from its file name. */
export const uploadType = (name) => UPLOAD_TYPES[String(name).split('.').pop()] || 'application/octet-stream';
// File name = hash of the content, so identical uploads share one file and URLs never change meaning (and can be cached for a year).
const hashName = (content, ext) => `${crypto.createHash('sha256').update(content).digest('hex').slice(0, 24)}.${ext}`;

/** Checks an uploaded image (by its bytes) and names it by content hash. Nothing is written. -> { name, path, bytes, type, data } or null if it is not an accepted image. */
export function describeImage(buf) {
  // Detect the real image type from its bytes; reject anything that is not WebP/PNG/JPEG/GIF.
  const kind = sniffImage(buf);
  if (!kind) return null;
  const name = hashName(buf, kind.ext);
  return { name, path: `uploads/${name}`, bytes: buf.length, type: kind.type, data: buf };
}

/** Writes a copy of an upload into the local upload folder. Best effort: MySQL holds the real copy and the folder is only a cache
 *  (a restart or redeploy may empty it, or the disk may be read-only), so a failure here is not an error. Returns whether the file is there. */
export function cacheUpload(dir, name, data) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    // Write to a temp file then rename, so a half-written file is never served.
    if (!fs.existsSync(file)) { const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
    return true;
  } catch { return false; }
}

// Video types accepted for upload to R2.
const VIDEO_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm' };
/** Object key for a browser upload to the private R2 bucket: premium/<slug>/<random>-<clean-name>.<ext>. */
export function videoKey(filename, slug = '') {
  const m = /\.([a-z0-9]{2,4})$/i.exec(String(filename || ''));
  const ext = m && VIDEO_EXT[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
  if (!ext) return null;
  const clean = (s) => String(s).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
  const base = clean(String(filename).replace(/\.[^.]+$/, '')) || 'video';
  return { key: `premium/${clean(slug) || 'uploads'}/${crypto.randomBytes(4).toString('hex')}-${base}.${ext}`, contentType: VIDEO_EXT[ext], format: 'mp4' };
}

/** Subtitles: WebVTT as-is, or SubRip (.srt) converted on the way in. Returns { vtt, cues } or null when it isn't a subtitle file. */
export function toVtt(input) {
  let t = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  t = t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!t || t.length > 2_000_000) return null;
  if (/^WEBVTT(\s|$)/.test(t)) { const cues = (t.match(/\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}/g) || []).length; return cues ? { vtt: `${t}\n`, cues } : null; }
  const body = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');   // SRT uses a comma before the milliseconds
  const cues = (body.match(/\d{1,2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
  return cues ? { vtt: `WEBVTT\n\n${body}\n`, cues } : null;
}
/** Checks a subtitle file and names the WebVTT it converts to by content hash. Nothing is written. -> { name, path, bytes, cues, type, data } or null. */
export function describeSubtitle(buf) {
  const v = toVtt(buf); if (!v) return null;
  const data = Buffer.from(v.vtt, 'utf8'), name = hashName(data, 'vtt');
  return { name, path: `uploads/${name}`, bytes: data.length, cues: v.cues, type: uploadType(name), data };
}
