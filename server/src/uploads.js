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

/** Image objects have content hashes and optional high/low rendition suffixes. */
export const IMAGE_UPLOAD_NAME = /^(?:[0-9a-f]{24}(?:-hq)?\.(?:webp|png|jpg|gif)|[0-9a-f]{24}-low\.webp)$/;
/** MySQL still serves legacy image blobs and subtitle files uploaded before R2 became the image store. */
export const UPLOAD_NAME = /^(?:[0-9a-f]{24}(?:-hq)?\.(?:webp|png|jpg|gif)|[0-9a-f]{24}-low\.webp|[0-9a-f]{24}\.vtt)$/;
const IMAGE_PARENT_NAME = /^[0-9a-f]{24}-hq\.(?:webp|png|jpg|gif)$/;
const UPLOAD_TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', vtt: 'text/vtt; charset=utf-8' };
/** The Content-Type a stored upload is served with, from its file name. */
export const uploadType = (name) => UPLOAD_TYPES[String(name).split('.').pop()] || 'application/octet-stream';
// File name = hash of the content, so identical uploads share one file and URLs never change meaning (and can be cached for a year).
const hashName = (content, ext) => `${crypto.createHash('sha256').update(content).digest('hex').slice(0, 24)}.${ext}`;

/** Checks an uploaded image (by its bytes) and names it by content hash. When a low rendition will follow,
 *  `progressive` gives the full-size file an `-hq` suffix so the app requests its matching `-low.webp` only
 *  for new, paired uploads. Nothing is written. -> { name, path, bytes, type, data } or null if invalid. */
export function describeImage(buf, { progressive = false } = {}) {
  // Detect the real image type from its bytes; reject anything that is not WebP/PNG/JPEG/GIF.
  const kind = sniffImage(buf);
  if (!kind) return null;
  const hashed = hashName(buf, kind.ext);
  const name = progressive ? hashed.replace(`.${kind.ext}`, `-hq.${kind.ext}`) : hashed;
  return { name, path: `uploads/${name}`, bytes: buf.length, type: kind.type, data: buf };
}

/** Describes the compact WebP child of a newly uploaded high-quality image. The child name is tied to the
 *  high-quality content hash, so the front end can discover it without adding rendition fields to the catalog. */
export function describeImageVariant(buf, highName) {
  const parent = IMAGE_PARENT_NAME.exec(String(highName || ''));
  const kind = sniffImage(buf);
  if (!parent || !kind || kind.ext !== 'webp') return null;
  const name = `${parent[0].slice(0, 24)}-low.webp`;
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

// Video types accepted for upload to R2 — any standard video container/codec or browser-reported video/* MIME type.
const VIDEO_EXT = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', asf: 'video/x-ms-asf', flv: 'video/x-flv', f4v: 'video/mp4',
  ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', mpe: 'video/mpeg', mpv: 'video/mpeg', m2v: 'video/mpeg',
  '3gp': 'video/3gpp', '3g2': 'video/3gpp2', ogv: 'video/ogg', ogg: 'video/ogg',
  vob: 'video/dvd', divx: 'video/divx', xvid: 'video/x-xvid', rm: 'application/vnd.rn-realmedia', rmvb: 'application/vnd.rn-realmedia-vbr',
  mxf: 'application/mxf', hevc: 'video/hevc', h264: 'video/h264',
};
const VIDEO_MIME = {
  'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/x-matroska': 'mkv', 'video/avi': 'avi', 'video/msvideo': 'avi', 'video/x-msvideo': 'avi',
  'video/x-ms-wmv': 'wmv', 'video/x-ms-asf': 'asf', 'video/x-flv': 'flv', 'video/mp2t': 'ts',
  'video/mpeg': 'mpg', 'video/3gpp': '3gp', 'video/3gpp2': '3g2', 'video/ogg': 'ogv',
};
// Non-video / executable / script / document extensions that must never be accepted even if a client sends a video/* MIME type.
const NON_VIDEO_EXT = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'sh', 'bash', 'zsh', 'csh', 'ksh',
  'html', 'htm', 'xhtml', 'svg', 'xml', 'js', 'mjs', 'cjs', 'ts.js', 'jsx', 'tsx', 'css', 'json', 'wasm',
  'php', 'phtml', 'asp', 'aspx', 'jsp', 'py', 'rb', 'pl', 'cgi', 'jar', 'war', 'class', 'dll', 'so', 'dylib',
  'apk', 'ipa', 'deb', 'rpm', 'dmg', 'iso', 'img', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'ini', 'env', 'sql',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'srt', 'vtt',
]);
/** Object key for a browser upload to the private R2 bucket: premium/<slug>/<random>-<clean-name>.<ext>. */
export function videoKey(filename, slug = '', mimeType = '') {
  const raw = String(filename || '').trim();
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const isVideoMime = /^video\/[a-z0-9.+-]+$/.test(mime);
  const m = /\.([a-z0-9]{1,10})$/i.exec(raw);
  const rawExt = m ? m[1].toLowerCase() : '';
  if (rawExt && NON_VIDEO_EXT.has(rawExt)) return null;
  let ext = rawExt && VIDEO_EXT[rawExt] ? rawExt : null;
  let contentType = ext ? VIDEO_EXT[ext] : null;
  if (!ext && isVideoMime) {
    ext = rawExt || VIDEO_MIME[mime] || 'mp4';
    contentType = VIDEO_EXT[ext] || mime;
  }
  if (!ext || !contentType) return null;
  const clean = (s) => String(s).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
  const base = clean(raw.replace(/\.[^.]+$/, '')) || 'video';
  return { key: `premium/${clean(slug) || 'uploads'}/${crypto.randomBytes(4).toString('hex')}-${base}.${ext}`, contentType, format: 'mp4' };
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
