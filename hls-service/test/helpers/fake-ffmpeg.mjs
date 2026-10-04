/**
 * A stand-in for ffmpeg/ffprobe so the queue, the progress parser and the API can be tested without a
 * real encoder (and in a second, not a minute). It behaves like `child_process.spawn`:
 *
 *   - `ffprobe … -show_streams …`  → prints the probe JSON and exits 0
 *   - `ffmpeg -version`            → prints a version line
 *   - an encode                    → writes a real (tiny) HLS package, streams `-progress` blocks and exits 0
 *
 * `failEncodes` / `hangEncodes` let a test drive the failure and cancel paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

export const FAKE_PROBE = { width: 1920, height: 1080, fps: 30, hasAudio: true, duration: 12, rotation: 0, videoCodec: 'h264', audioCodec: 'aac' };

function streamOf() {
  return new Readable({ read() { /* pushed manually */ } });
}

export function createFakeFfmpeg({ probe = FAKE_PROBE, rungs = null, failEncodes = 0, hangEncodes = 0, failProbe = false } = {}) {
  const calls = [];
  const state = { failEncodes, hangEncodes };
  const spawn = (cmd, args = []) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    child.pid = 900000 + calls.length;
    child.stdout = streamOf();
    child.stderr = streamOf();
    child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
    const out = (s) => child.stdout.push(s);
    const err = (s) => child.stderr.push(s);
    const close = (code) => child.emit('close', code, null);

    setTimeout(() => {
      // ---- ffprobe ----
      if (args.includes('-show_streams')) {
        if (failProbe) { err('moov atom not found\n'); close(1); return; }
        out(JSON.stringify({
          streams: [
            { codec_type: 'video', codec_name: probe.videoCodec, width: probe.width, height: probe.height, avg_frame_rate: `${probe.fps}/1`, tags: probe.rotation ? { rotate: String(probe.rotation) } : {} },
            ...(probe.hasAudio ? [{ codec_type: 'audio', codec_name: probe.audioCodec }] : []),
          ],
          format: { duration: String(probe.duration), bit_rate: '5000000' },
        }));
        close(0);
        return;
      }
      // ---- ffmpeg -version ----
      if (args.includes('-version')) { out('ffmpeg version 6.1.1-fake Copyright (c) 2000-2024 --enable-libx264\n'); close(0); return; }
      // ---- an encode ----
      if (state.failEncodes > 0) { state.failEncodes--; err('[libx264 @ 0x1] bad things happened\n'); close(1); return; }
      const outDir = args[args.indexOf('-hls_segment_filename') + 1].replace(/\/%v\/.*$/, '');
      const map = String(args[args.indexOf('-var_stream_map') + 1] || '');
      const names = (rungs || map.split(' ').map((entry) => /name:([^,]+)/.exec(entry)?.[1]).filter(Boolean)) || ['720p'];
      fs.mkdirSync(outDir, { recursive: true });
      const variants = [];
      for (const name of names) {
        const dir = path.join(outDir, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'seg_000.ts'), Buffer.alloc(2048, 7));
        fs.writeFileSync(path.join(dir, 'seg_001.ts'), Buffer.alloc(2048, 7));
        fs.writeFileSync(path.join(dir, 'index.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nseg_000.ts\n#EXTINF:6.0,\nseg_001.ts\n#EXT-X-ENDLIST\n');
        variants.push(name);
      }
      fs.writeFileSync(path.join(outDir, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n' + variants.map((n, i) => `#EXT-X-STREAM-INF:BANDWIDTH=${3000000 - i * 500000},RESOLUTION=1280x720\n${n}/index.m3u8`).join('\n') + '\n');
      if (state.hangEncodes > 0) { state.hangEncodes--; return; }               // stays silent until killed
      // Real `-progress` blocks: three updates, then the end marker.
      const steps = [0.25, 0.6, 1];
      let i = 0;
      const tick = () => {
        const fraction = steps[i++];
        out(`frame=${Math.round(30 * probe.duration * fraction)}\nfps=27.5\nbitrate=2800.0kbits/s\ntotal_size=${Math.round(5e6 * fraction)}\nout_time_us=${Math.round(probe.duration * fraction * 1e6)}\nout_time_ms=${(probe.duration * fraction * 1000).toFixed(6)}\nspeed=1.42x\nprogress=${i >= steps.length ? 'end' : 'continue'}\n\n`);
        if (i >= steps.length) { setTimeout(() => close(0), 5); return; }
        setTimeout(tick, 5);
      };
      tick();
    }, 5);
    return child;
  };
  return { spawn, calls };
}
