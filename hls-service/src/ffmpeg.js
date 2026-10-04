/**
 * Everything about ffmpeg that can be decided without running it: the quality ladder, the command
 * line, the ffprobe reading, the progress lines and the MIME types of the produced files.
 *
 * Pure functions only (no I/O, no child processes) — that is what makes them unit-testable, and the
 * rest of the service depends on this module instead of on ffmpeg itself.
 *
 * Rungs are described by their SHORT EDGE (`short`), not their height, so a 1080×1920 reel and a
 * 1920×1080 episode both get a sensible "1080p" rung. Nothing is ever upscaled.
 */

/** Master ladder (Apple HLS authoring-spec bitrates). `short` = the shorter side of the frame. */
export const LADDER = [
  { name: '1080p', short: 1080, vb: '5000k', maxrate: '5350k', buf: '7500k', ab: '160k' },
  { name: '720p', short: 720, vb: '2800k', maxrate: '2996k', buf: '4200k', ab: '128k' },
  { name: '540p', short: 540, vb: '1600k', maxrate: '1712k', buf: '2400k', ab: '128k' },
  { name: '480p', short: 480, vb: '1400k', maxrate: '1498k', buf: '2100k', ab: '128k' },
  { name: '360p', short: 360, vb: '800k', maxrate: '856k', buf: '1200k', ab: '96k' },
  { name: '240p', short: 240, vb: '400k', maxrate: '428k', buf: '600k', ab: '64k' },
];

/**
 * Named quality sets shown in the portal.
 *   auto   — every rung the source can actually fill (never upscaled) — the default
 *   full   — the same, but capped at 1080p even for 4K sources
 *   hd     — 720p downwards (fast, small)
 *   fast   — 480p downwards (very fast; good for dailies / previews)
 *   source — one rung at the source resolution (no ladder: smallest file, fastest encode)
 *   mobile — 540p / 360p only (operator's pick for weak networks)
 */
export const PRESETS = {
  auto: { label: 'Auto — every resolution the source fills', cap: null, only: null, single: false },
  full: { label: 'Up to 1080p (1080/720/540/480/360/240)', cap: 1080, only: null, single: false },
  hd: { label: 'Up to 720p (720/540/480/360/240)', cap: 720, only: null, single: false },
  mobile: { label: 'Mobile (540/360/240)', cap: null, only: [540, 360, 240], single: false },
  fast: { label: 'Fast draft (480/360)', cap: null, only: [480, 360], single: false },
  source: { label: 'Single quality at source resolution', cap: null, only: null, single: true },
};
export const presetNames = () => Object.keys(PRESETS);

/** How many pixels the source video actually shows (rotation metadata swaps the sides for playback). */
export function displaySize(info) {
  const w = Number(info?.width) || 0, h = Number(info?.height) || 0;
  const rot = Math.abs(Number(info?.rotation) || 0) % 180 === 90;
  return rot ? { width: h, height: w } : { width: w, height: h };
}

/**
 * The rungs to encode for this source + preset.
 * Returns `{ rungs, orientation, skipped }` where every rung carries the pixel size it produces.
 */
export function pickLadder(info, { preset = 'auto', maxShort = 1080, minShort = 0 } = {}) {
  const { width, height } = displaySize(info);
  const source = Math.min(width, height) || 720;                 // shorter edge — unknown sources assume 720p
  const orientation = width >= height ? 'landscape' : 'portrait';
  const spec = PRESETS[preset] || PRESETS.auto;
  const cap = Math.min(spec.cap ?? Infinity, maxShort);
  // Their short edge must fit inside the source (a little slack for odd sizes) and inside the cap.
  let rungs = LADDER.filter((r) => r.short <= cap && r.short <= source + 8 && r.short >= minShort);
  if (spec.only) rungs = rungs.filter((r) => spec.only.includes(r.short));
  if (spec.single) rungs = [rungs[0] || LADDER[0]];
  // Never end up with nothing to encode (tiny sources fall back to the smallest rung at source size).
  if (!rungs.length) rungs = [{ ...LADDER.at(-1), short: Math.max(2, Math.round(source / 2) * 2) }];
  // Label each rung with the pixel size it will actually produce (even numbers: x264 requires them).
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const withSize = rungs.map((r) => ({
    ...r,
    size: orientation === 'portrait' ? `${r.short}×${even((r.short * height) / width)}` : `${even((r.short * width) / height)}×${r.short}`,
  }));
  return { rungs: withSize, orientation, sourceShort: source, preset: PRESETS[preset] ? preset : 'auto' };
}

/** Scale filter for one rung — keep the aspect ratio, x264 needs even dimensions (`-2`). */
export const scaleFilter = (rung, orientation) => (orientation === 'portrait' ? `scale=${rung.short}:-2` : `scale=-2:${rung.short}`);

/**
 * The full ffmpeg command line: one process, one pass, every rung at once (that is far cheaper than
 * decoding the source again for each quality) → `master.m3u8` + `<rung>/index.m3u8` + segments.
 *
 * `-progress pipe:1` makes ffmpeg print machine-readable progress on stdout, which the queue parses.
 */
export function ffmpegArgs({ input, outDir, rungs, orientation = 'landscape', opts = {} }) {
  const {
    segmentSec = 6, fps = 30, hasAudio = true, packaging = 'ts',
    x264Preset = 'medium', profile = 'main', threads = 0, hlsBase = `${outDir}/%v/index.m3u8`,
  } = opts;
  if (!rungs?.length) throw new Error('ffmpegArgs: at least one rung is required');
  const n = rungs.length;
  const gop = Math.max(1, Math.round((Number(fps) || 30) * segmentSec));
  const split = `[0:v]split=${n}${rungs.map((_, i) => `[s${i}]`).join('')}`;
  const scales = rungs.map((r, i) => `[s${i}]${scaleFilter(r, orientation)}[v${i}]`).join(';');
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1', '-i', input, '-filter_complex', `${split};${scales}`];
  if (threads > 0) args.push('-threads', String(threads));
  rungs.forEach((r, i) => {
    args.push('-map', `[v${i}]`);
    if (hasAudio) args.push('-map', 'a:0');
    args.push(`-c:v:${i}`, 'libx264', `-b:v:${i}`, r.vb, `-maxrate:v:${i}`, r.maxrate, `-bufsize:v:${i}`, r.buf);
    if (hasAudio) args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, r.ab, '-ac', '2', '-ar', '48000');
  });
  args.push(
    '-preset', x264Preset, '-profile:v', profile, '-pix_fmt', 'yuv420p',
    // Every rung must have a keyframe exactly at each segment boundary, or a player switching
    // quality mid-stream shows artefacts.
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
    '-force_key_frames', `expr:gte(t,n_forced*${segmentSec})`,
    '-f', 'hls',
    '-hls_time', String(segmentSec),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_type', packaging === 'fmp4' ? 'fmp4' : 'mpegts',
  );
  if (packaging === 'fmp4') args.push('-hls_fmp4_init_filename', 'init_%v.mp4');
  args.push(
    '-hls_segment_filename', `${outDir}/%v/seg_%03d.${packaging === 'fmp4' ? 'm4s' : 'ts'}`,
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', rungs.map((r, i) => `v:${i}${hasAudio ? `,a:${i}` : ''},name:${r.name}`).join(' '),
    hlsBase,
  );
  return args;
}

/** Reads width/height/rotation/fps/audio/duration out of `ffprobe -show_streams -show_format -of json`. */
export function probeInfo(json) {
  const streams = json?.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found in the input file.');
  const [a, b] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  const fps = b ? a / b : a;
  // Rotation can live in the stream tags (older ffprobe) or in a display-matrix side datum (newer).
  const rotTag = Number(v.tags?.rotate ?? 0);
  const rotSide = (v.side_data_list || []).map((d) => Number(d.rotation)).find((r) => Number.isFinite(r)) || 0;
  const audio = streams.find((s) => s.codec_type === 'audio');
  return {
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    rotation: rotTag || rotSide || 0,
    fps: fps > 1 && fps < 241 ? Math.round(fps) : 30,
    hasAudio: !!audio,
    audioCodec: audio?.codec_name || null,
    videoCodec: v.codec_name || null,
    duration: Number(json?.format?.duration) || Number(v.duration) || 0,
    bitrate: Number(json?.format?.bit_rate) || null,
  };
}

/**
 * Parses one `-progress` block into a normalised reading.
 * `percent` is only meaningful once the duration is known (ffprobe almost always reports it).
 */
export function parseProgress(block, { duration = 0, elapsedMs = 0 } = {}) {
  const kv = {};
  for (const line of String(block).split('\n')) {
    const m = /^([a-z_]+)=(.*)$/.exec(line.trim());
    if (m) kv[m[1]] = m[2];
  }
  const outTimeSec = Number(kv.out_time_us) / 1e6 || Number(kv.out_time_ms) / 1e3 || 0;
  const speed = Number(String(kv.speed || '').replace('x', '')) || 0;
  const percent = duration > 0 ? Math.max(0, Math.min(100, (outTimeSec / duration) * 100)) : 0;
  const remaining = speed > 0 && duration > 0 ? Math.max(0, (duration - outTimeSec) / speed) : null;
  return {
    done: kv.progress === 'end',
    outTimeSec,
    duration,
    percent,
    fps: Number(kv.fps) || 0,
    speed,
    bitrate: kv.bitrate || '',
    totalBytes: Number(kv.total_size) || 0,
    etaSeconds: remaining == null ? null : Math.round(remaining),
    elapsedMs: elapsedMs || null,
  };
}

/** Content-Type for every file the encoder produces (playlists, TS segments, fMP4 init + segments). */
export function contentTypeFor(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  if (ext === 'm3u8') return 'application/vnd.apple.mpegurl';
  if (ext === 'ts') return 'video/mp2t';
  if (ext === 'm4s') return 'video/iso.segment';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'vtt') return 'text/vtt; charset=utf-8';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

/** Plays a playlist's relative URIs out of an m3u8 text (used to verify an uploaded package). */
export function playlistUris(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => (/^URI="([^"]+)"/.exec(l) ? /^URI="([^"]+)"/.exec(l)[1] : l));
}

/** Rewrites `#EXT-X-MAP:URI="..."` / bare URIs of a master playlist to absolute keys for verification. */
export function referencedFiles(text, folderPrefix) {
  const out = new Set();
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const uri = /^URI="([^"]+)"/.exec(t)?.[1] || t;
    out.add(folderPrefix ? `${folderPrefix.replace(/\/$/, '')}/${uri.replace(/^\.\//, '')}` : uri);
  }
  return [...out];
}
