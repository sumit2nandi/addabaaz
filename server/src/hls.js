/** Pure helpers for scripts/encode-hls.mjs: choosing the quality ladder and building the ffmpeg command line. No I/O, so they are unit-tested. */
// The quality "ladder": each rung is one resolution + bitrate combination the encoder produces; players switch between them by connection speed.
export const LADDER = [
  { name: '1080p', height: 1080, vb: '5000k', maxrate: '5350k', buf: '7500k', ab: '160k' },
  { name: '720p', height: 720, vb: '2800k', maxrate: '2996k', buf: '4200k', ab: '128k' },
  { name: '480p', height: 480, vb: '1400k', maxrate: '1498k', buf: '2100k', ab: '128k' },
  { name: '360p', height: 360, vb: '800k', maxrate: '856k', buf: '1200k', ab: '96k' },
];
/** Never upscale: keep the rungs at or below the source height (always at least the smallest one). */
export function pickLadder(sourceHeight, { max = 1080 } = {}) {
  // Default to 720 if the source height is unknown.
  const h = Number(sourceHeight) || 720;
  const rungs = LADDER.filter((r) => r.height <= Math.min(max, h + 8));         // +8: 1080p sources are sometimes 1072 tall
  return rungs.length ? rungs : [LADDER.at(-1)];
}
/** ffmpeg arguments producing <out>/master.m3u8 plus <out>/<rung>/index.m3u8 and seg_000.ts … (VOD, 6 s segments, keyframes aligned). */
export function ffmpegArgs({ input, outDir, ladder, hlsTime = 6, fps = 30, hasAudio = true }) {
  // Split the decoded video into one stream per rung, scale each, then encode each with its own bitrate.
  const n = ladder.length, gop = Math.round(fps * hlsTime);
  const split = `[0:v]split=${n}${ladder.map((_, i) => `[s${i}]`).join('')}`;
  const scales = ladder.map((r, i) => `[s${i}]scale=-2:${r.height}[v${i}]`).join(';');
  const args = ['-hide_banner', '-y', '-i', input, '-filter_complex', `${split};${scales}`];
  ladder.forEach((r, i) => {
    args.push('-map', `[v${i}]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, r.vb, `-maxrate:v:${i}`, r.maxrate, `-bufsize:v:${i}`, r.buf);
    if (hasAudio) args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, r.ab, '-ac', '2');
  });
  args.push('-preset', 'medium', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0');
  args.push('-f', 'hls', '-hls_time', String(hlsTime), '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', `${outDir}/%v/seg_%03d.ts`, '-master_pl_name', 'master.m3u8',
    '-var_stream_map', ladder.map((r, i) => `v:${i}${hasAudio ? `,a:${i}` : ''},name:${r.name}`).join(' '), `${outDir}/%v/index.m3u8`);
  return args;
}
/** Parses `WIDTHxHEIGHT`, fps and whether an audio stream exists from `ffprobe -show_streams -of json` output. */
export function probeInfo(json) {
  const streams = json?.streams || [], v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found in the input.');
  const [a, b] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  const fps = b ? a / b : a;
  return { width: v.width, height: v.height, fps: fps > 1 && fps < 121 ? Math.round(fps) : 30, hasAudio: streams.some((s) => s.codec_type === 'audio'), duration: Number(json?.format?.duration) || Number(v.duration) || 0 };
}
// Content-Type for files uploaded to R2 (playlists vs. video segments).
export const contentType = (f) => (f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : f.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream');
// What an R2 object actually is, judged by its key: only a master/variant playlist (.m3u8) is HLS.
// A claimed `source.format` that contradicts this is a configuration error — catalog-schema.js rejects new
// ones, and the media gateway trusts the key so legacy rows still play as the file they really are.
export const detectR2Format = (key) => (/\.m3u8$/i.test(String(key || '')) ? 'hls' : 'mp4');
/**
 * Playlists travel from R2 through the gateway to the player. Lenient engines (Safari, TV browsers) still play
 * manifests saved with a UTF-8 BOM or a leading blank line — typical of Windows editors — but strict ones
 * (hls.js on desktop Chrome/Edge) fail fatally with "no EXTM3U delimiter" unless the body STARTS with #EXTM3U.
 * Strip such prefixes once at the gateway so every engine sees identical, clean bytes.
 */
export function normalizePlaylist(text) {
  if (typeof text !== 'string') return '';
  // One pass over any mix of BOM / zero-width / whitespace prefixes: stripping them separately would stop at
  // the first character the other class doesn't know (a space before a zero-width char would survive).
  return text.replace(/^[\uFEFF\u200B\u200C\u200D \t\r\n]+/, '');
}
/** RFC 8216 requires the playlist's first line to be #EXTM3U; anything else is not playable HLS. */
export const isHlsPlaylist = (text) => typeof text === 'string' && text.startsWith('#EXTM3U');
