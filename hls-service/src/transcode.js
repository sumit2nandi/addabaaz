/**
 * The ffmpeg half of the service: probe the source, run one encode pass that produces the whole
 * ladder, and inspect what came out.
 *
 * Everything is injected (the ffmpeg path, the spawn function, the clock) so the pipeline can be
 * tested without a real encoder — see test/api.test.js — while test/e2e-ffmpeg.test.js runs the real
 * thing on a generated clip when ffmpeg is available.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { ffmpegArgs, probeInfo, parseProgress, contentTypeFor, playlistUris } from './ffmpeg.js';

/** Collects the tail of a child process' stderr so a failure can explain itself. */
function tailCollector(limit = 40) {
  const lines = [];
  return {
    push(text) {
      for (const line of String(text).split('\n')) {
        const t = line.trim();
        if (t) lines.push(t);
      }
      if (lines.length > limit) lines.splice(0, lines.length - limit);
    },
    text: () => lines.join('\n'),
  };
}

export function createTranscoder(cfg, { spawn = nodeSpawn, log = () => {} } = {}) {
  /** Runs ffprobe and returns the normalised stream information. */
  function probe(inputPath, { timeoutMs = 120_000 } = {}) {
    return new Promise((resolve, reject) => {
      const args = ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', inputPath];
      const child = spawn(cfg.ffprobe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffprobe timed out reading the file.')); }, timeoutMs);
      child.stdout?.on('data', (c) => { out += c; });
      child.stderr?.on('data', (c) => { err += c; });
      child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Could not run ffprobe (${cfg.ffprobe}): ${e.message}. Install ffmpeg or set FFPROBE_PATH.`)); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`ffprobe could not read this file (exit ${code}): ${err.trim().split('\n').pop() || 'unknown reason'}. Is it a real video file?`));
        try { resolve(probeInfo(JSON.parse(out))); }
        catch (e) { reject(new Error(`Unexpected video file: ${e.message}`)); }
      });
    });
  }

  /** ffmpeg -version, for /health (tells the operator whether the encoder is actually installed). */
  function version({ timeoutMs = 10_000 } = {}) {
    return new Promise((resolve) => {
      const child = spawn(cfg.ffmpeg, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, timeoutMs);
      child.stdout?.on('data', (c) => { out += c; });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return resolve(null);
        const first = out.split('\n')[0] || '';
        const m = /ffmpeg version (\S+)/.exec(first);
        return resolve({ raw: first.trim(), version: m ? m[1] : 'unknown', x264: /--enable-libx264|libx264/.test(out) });
      });
    });
  }

  /**
   * Encodes the ladder. Returns `{ code, canceled, stderrTail, lastProgress, elapsedMs }` — the queue
   * turns a non-zero code into a user-facing error.
   *
   * Progress: ffmpeg writes `key=value` blocks on stdout; `onProgress` receives a parsed reading per block.
   */
  function encode({ input, outDir, rungs, orientation, opts = {}, onProgress = () => {}, onLog = () => {} }) {
    const args = ffmpegArgs({ input, outDir, rungs, orientation, opts });
    onLog(`ffmpeg ${args.slice(args.indexOf('-i') + 1).join(' ')}`.slice(0, 400));
    const child = spawn(cfg.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const stderr = tailCollector();
    let lastProgress = null, canceled = false;
    const startedAt = Date.now();

    // Killing the process group also stops any thread/child ffmpeg may have started.
    const kill = (signal) => {
      try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
      catch { try { child.kill(signal); } catch { /* already gone */ } }
    };

    // ffmpeg writes progress as `key=value` lines; a block is complete at `progress=continue|end`.
    let stdoutBuf = '', block = '';
    child.stdout?.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      let newline;
      while ((newline = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, newline).replace(/\r$/, '');
        stdoutBuf = stdoutBuf.slice(newline + 1);
        if (!line) continue;
        block += line + '\n';
        if (line.startsWith('progress=')) {
          const reading = parseProgress(block, { duration: opts.duration || 0, elapsedMs: Date.now() - startedAt });
          block = '';
          lastProgress = reading;
          onProgress(reading);
        }
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      for (const line of text.split('\n')) if (line.trim()) onLog(line.trim());
    });

    const done = new Promise((resolve) => {
      child.on('error', (e) => resolve({ code: 127, canceled, stderrTail: `Could not run ffmpeg (${cfg.ffmpeg}): ${e.message}`, lastProgress, elapsedMs: Date.now() - startedAt }));
      child.on('close', (code, signal) => resolve({ code: canceled ? 0 : code ?? (signal ? 1 : 0), canceled, signal, stderrTail: stderr.text(), lastProgress, elapsedMs: Date.now() - startedAt }));
    });

    return {
      done,
      cancel() {
        canceled = true;
        kill('SIGTERM');
        // Escalate if it ignores the polite request.
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5000).unref?.();
      },
    };
  }

  /** Counts the segments produced for one rung (the portal shows a per-quality progress bar). */
  function countSegments(dir) {
    try { return fs.readdirSync(dir).filter((f) => /\.(ts|m4s)$/.test(f)).length; }
    catch { return 0; }
  }

  /** Every file of a finished package with its archive-relative name and size. */
  function listPackage(outDir) {
    const out = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push({ path: full, name: path.relative(outDir, full).split(path.sep).join('/'), bytes: fs.statSync(full).size, type: contentTypeFor(entry.name) });
      }
    };
    walk(outDir);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Reads the produced package back and reports what the players will see: the rungs in the master
   * playlist, the segment counts and any missing file. Throws when the master playlist is unusable.
   */
  function verifyPackage(outDir) {
    const masterPath = path.join(outDir, 'master.m3u8');
    if (!fs.existsSync(masterPath)) throw Object.assign(new Error('ffmpeg finished but master.m3u8 is missing.'), { code: 'no_master' });
    const master = fs.readFileSync(masterPath, 'utf8');
    const variants = playlistUris(master);
    if (!variants.length) throw Object.assign(new Error('The master playlist lists no quality levels.'), { code: 'empty_master' });
    const detail = variants.map((uri) => {
      const file = path.join(outDir, uri);
      const exists = fs.existsSync(file);
      const dir = path.dirname(file);
      return { name: uri.replace(/\/index\.m3u8$/, '').replace(/\.m3u8$/, ''), uri, exists, segments: exists ? countSegments(dir) : 0, bytes: exists ? fs.statSync(file).size : 0 };
    });
    const missing = detail.filter((d) => !d.exists || d.segments === 0);
    if (missing.length) throw Object.assign(new Error(`The package is incomplete: ${missing.map((m) => m.uri).join(', ')}`), { code: 'incomplete_package' });
    return { master, variants: detail, totalSegments: detail.reduce((n, d) => n + d.segments, 0) };
  }

  return { probe, encode, version, countSegments, listPackage, verifyPackage };
}
