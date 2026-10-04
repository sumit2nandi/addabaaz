// The pure ffmpeg layer: ladder choice, the command line, reading ffprobe output and progress blocks.
// Run: node --test test/ffmpeg.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { LADDER, PRESETS, pickLadder, ffmpegArgs, probeInfo, parseProgress, contentTypeFor, displaySize, referencedFiles, playlistUris } from '../src/ffmpeg.js';

test('the ladder never upscales and always leaves something to encode', () => {
  assert.deepEqual(pickLadder({ width: 1920, height: 1080 }).rungs.map((r) => r.name), ['1080p', '720p', '540p', '480p', '360p', '240p']);
  assert.deepEqual(pickLadder({ width: 1280, height: 720 }).rungs.map((r) => r.name), ['720p', '540p', '480p', '360p', '240p']);
  assert.deepEqual(pickLadder({ width: 640, height: 360 }).rungs.map((r) => r.name), ['360p', '240p']);
  // A 1072-tall source still gets a 1080p rung (sources are rarely exactly 1080).
  assert.equal(pickLadder({ width: 1920, height: 1072 }).rungs[0].name, '1080p');
  // A tiny source keeps one rung instead of producing nothing.
  const tiny = pickLadder({ width: 320, height: 180 });
  assert.ok(tiny.rungs.length >= 1 && tiny.rungs[0].short <= 180, 'a 180p source still encodes at its own size');
  // Unknown size: assume 720p.
  assert.equal(pickLadder({}).rungs[0].name, '720p');
});

test('portrait (reel) sources are measured by their short edge, not their height', () => {
  const reel = pickLadder({ width: 1080, height: 1920 });
  assert.equal(reel.orientation, 'portrait');
  assert.deepEqual(reel.rungs.map((r) => r.name), ['1080p', '720p', '540p', '480p', '360p', '240p']);
  assert.equal(reel.rungs[0].size, '1080×1920', 'a portrait 1080p rung is 1080 wide');
  const has = (args, needle) => args.some((a) => String(a).includes(needle));
  const args = ffmpegArgs({ input: 'in.mp4', outDir: '/out', rungs: reel.rungs.slice(0, 1), orientation: 'portrait' });
  assert.ok(has(args, 'scale=1080:-2'), 'portrait rungs scale by width');
  const landscape = pickLadder({ width: 1920, height: 1080 });
  assert.equal(landscape.rungs[0].size, '1920×1080');
  assert.ok(has(ffmpegArgs({ input: 'in.mp4', outDir: '/out', rungs: landscape.rungs.slice(0, 1), orientation: 'landscape' }), 'scale=-2:1080'));
});

test('rotation metadata swaps the displayed sides (a phone clip is still portrait)', () => {
  assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: 90 }), { width: 1080, height: 1920 });
  assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: 180 }), { width: 1920, height: 1080 });
  assert.deepEqual(displaySize({ width: 1080, height: 1920, rotation: 270 }), { width: 1920, height: 1080 });
});

test('presets pick the expected rungs', () => {
  const fhd = pickLadder({ width: 3840, height: 2160 }, { preset: 'full' });
  assert.deepEqual(fhd.rungs.map((r) => r.name), ['1080p', '720p', '540p', '480p', '360p', '240p'], 'a 4K source is capped at 1080p by default');
  assert.deepEqual(pickLadder({ width: 1920, height: 1080 }, { preset: 'hd' }).rungs.map((r) => r.name), ['720p', '540p', '480p', '360p', '240p']);
  assert.deepEqual(pickLadder({ width: 1920, height: 1080 }, { preset: 'mobile' }).rungs.map((r) => r.name), ['540p', '480p', '360p', '240p'].filter((n) => [ '540p', '360p', '240p' ].includes(n)));
  assert.deepEqual(pickLadder({ width: 1920, height: 1080 }, { preset: 'fast' }).rungs.map((r) => r.name), ['480p', '360p']);
  assert.equal(pickLadder({ width: 1920, height: 1080 }, { preset: 'source' }).rungs.length, 1);
  assert.deepEqual(pickLadder({ width: 1920, height: 1080 }, { preset: 'source' }).rungs.map((r) => r.name), ['1080p']);
  // An unknown preset falls back to auto rather than failing.
  assert.equal(pickLadder({ width: 1920, height: 1080 }, { preset: 'nonsense' }).preset, 'auto');
  // MAX_SHORT_SIDE caps the top rung even for “auto”.
  assert.equal(pickLadder({ width: 3840, height: 2160 }, { maxShort: 720 }).rungs[0].name, '720p');
  assert.ok(Object.keys(PRESETS).every((k) => PRESETS[k].label));
});

test('the ffmpeg command encodes every rung in one pass, with aligned keyframes and a master playlist', () => {
  const { rungs, orientation } = pickLadder({ width: 1920, height: 1080 }, { preset: 'hd' });
  const args = ffmpegArgs({ input: '/src/in.mp4', outDir: '/out', rungs, orientation, opts: { segmentSec: 6, fps: 30, hasAudio: true, x264Preset: 'slow', threads: 4 } });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value('-i'), '/src/in.mp4');
  assert.match(value('-filter_complex'), /^\[0:v\]split=5/);
  assert.equal(args[args.indexOf('-map') + 1], '[v0]');
  assert.ok(args.includes('a:0'), 'audio is mapped once per rung');
  assert.equal(value('-c:v:0'), 'libx264');
  assert.equal(value('-b:v:0'), '2800k');
  assert.equal(value('-c:a:0'), 'aac');
  assert.equal(value('-g'), '180', '6 s at 30 fps');
  assert.equal(value('-keyint_min'), '180');
  assert.equal(value('-sc_threshold'), '0');
  assert.equal(value('-force_key_frames'), 'expr:gte(t,n_forced*6)');
  assert.equal(value('-hls_time'), '6');
  assert.equal(value('-hls_playlist_type'), 'vod');
  assert.match(value('-hls_flags'), /independent_segments/);
  assert.equal(value('-hls_segment_type'), 'mpegts');
  assert.equal(value('-master_pl_name'), 'master.m3u8');
  assert.equal(value('-preset'), 'slow');
  assert.equal(value('-threads'), '4');
  assert.equal(value('-progress'), 'pipe:1');
  assert.equal(args.at(-1), '/out/%v/index.m3u8');
  assert.equal(value('-var_stream_map'), 'v:0,a:0,name:720p v:1,a:1,name:540p v:2,a:2,name:480p v:3,a:3,name:360p v:4,a:4,name:240p');
  assert.match(value('-hls_segment_filename'), /^\/out\/%v\/seg_%03d\.ts$/);
});

test('fMP4/CMAF packaging and silent sources get the right flags', () => {
  const { rungs, orientation } = pickLadder({ width: 1280, height: 720 }, { preset: 'fast' });
  const args = ffmpegArgs({ input: 'in.webm', outDir: '/out', rungs, orientation, opts: { packaging: 'fmp4', hasAudio: false, segmentSec: 4, fps: 25 } });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value('-hls_segment_type'), 'fmp4');
  assert.equal(value('-hls_fmp4_init_filename'), 'init_%v.mp4');
  assert.match(value('-hls_segment_filename'), /\.m4s$/);
  assert.equal(value('-g'), '100', '4 s at 25 fps');
  assert.ok(!args.includes('a:0'), 'no audio stream is mapped for a silent source');
  assert.equal(value('-var_stream_map'), 'v:0,name:480p v:1,name:360p');
});

test('ffprobe output is understood, including rotation and missing audio', () => {
  const info = probeInfo({
    streams: [
      { codec_type: 'video', codec_name: 'hevc', width: 1080, height: 1920, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }], duration: '10.5' },
      { codec_type: 'audio', codec_name: 'opus' },
    ],
    format: { duration: '10.5', bit_rate: '1800000' },
  });
  assert.equal(info.fps, 30, '29.97 is rounded for the keyframe interval');
  assert.equal(info.rotation, -90);
  assert.equal(info.hasAudio, true);
  assert.equal(info.audioCodec, 'opus');
  assert.equal(info.duration, 10.5);
  assert.equal(probeInfo({ streams: [{ codec_type: 'video', width: 640, height: 360, tags: { rotate: '90' } }], format: {} }).rotation, 90);
  assert.throws(() => probeInfo({ streams: [{ codec_type: 'audio' }] }), /No video stream/);
});

test('progress blocks turn into percent, ETA and speed', () => {
  const block = 'frame=450\nfps=27.5\nbitrate=2800.0kbits/s\ntotal_size=5000000\nout_time_us=6000000\nout_time_ms=6000000\nspeed=1.5x\nprogress=continue\n';
  const p = parseProgress(block, { duration: 12, elapsedMs: 4000 });
  assert.equal(p.percent, 50);
  assert.equal(p.speed, 1.5);
  assert.equal(p.etaSeconds, 4);
  assert.equal(p.fps, 27.5);
  assert.equal(p.done, false);
  // Without a known duration the percentage stays 0 — better than a wrong number.
  assert.equal(parseProgress(block, { duration: 0 }).percent, 0);
  assert.equal(parseProgress('speed=N/A\nout_time_us=0\nprogress=end\n', { duration: 10 }).speed, 0);
  assert.equal(parseProgress('out_time_us=10000000\nspeed=2x\nprogress=end\n', { duration: 12 }).done, true);
});

test('content types and playlist reading match what players ask for', () => {
  assert.equal(contentTypeFor('master.m3u8'), 'application/vnd.apple.mpegurl');
  assert.equal(contentTypeFor('720p/seg_000.ts'), 'video/mp2t');
  assert.equal(contentTypeFor('720p/seg_000.m4s'), 'video/iso.segment');
  assert.equal(contentTypeFor('720p/init_720p.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('poster.jpg'), 'image/jpeg');
  assert.equal(contentTypeFor('weird.bin'), 'application/octet-stream');

  // Variant playlists are the plain (non-“#”) lines; #EXT-X-MEDIA lines describe alternate renditions.
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n720p/index.m3u8\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"\n480p/index.m3u8\n';
  assert.deepEqual(playlistUris(master), ['720p/index.m3u8', '480p/index.m3u8']);
  assert.deepEqual(referencedFiles(master, 'premium/ep6'), ['premium/ep6/720p/index.m3u8', 'premium/ep6/480p/index.m3u8']);
});
