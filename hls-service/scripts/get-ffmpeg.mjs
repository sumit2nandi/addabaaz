#!/usr/bin/env node
/**
 * `npm run get:ffmpeg` — puts a ready-to-use ffmpeg + ffprobe into ./.tools, where the service picks
 * them up automatically (config.js checks ./.tools before PATH). Handy on a machine where you would
 * rather not install anything system-wide; the Docker image does not need this script at all.
 *
 * Downloads only from the well-known static-build sources:
 *   Linux   johnvansickle.com  (ffmpeg-release-{amd64,arm64}-static.tar.xz — GPL builds, ffmpeg + ffprobe)
 *   macOS   evermeet.cx        (signed universal binaries, one zip each)
 *   Windows — prints the winget/Chocolatey command (no consumer-grade static archive to trust blindly)
 *
 *   node scripts/get-ffmpeg.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, '.tools');
const force = process.argv.includes('--force');
const ext = process.platform === 'win32' ? '.exe' : '';
const target = (name) => path.join(TOOLS, name + ext);

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...opts });
const works = (file) => !!(fs.existsSync(file) && spawnSync(file, ['-version'], { stdio: 'ignore' }).status === 0);

async function download(url, dest, label) {
  process.stdout.write(`  downloading ${label}…\n`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let seen = 0, last = 0;
  const out = fs.createWriteStream(dest);
  for await (const chunk of res.body) {
    seen += chunk.length;
    out.write(chunk);
    if (total && Date.now() - last > 1000) { last = Date.now(); process.stdout.write(`\r  ${label}: ${(seen / 1024 ** 2).toFixed(1)}/${(total / 1024 ** 2).toFixed(1)} MB`); }
  }
  out.end();
  await new Promise((resolve) => out.on('close', resolve));
  process.stdout.write(`\r  ${label}: ${(seen / 1024 ** 2).toFixed(1)} MB done\n`);
}

fs.mkdirSync(TOOLS, { recursive: true });
if (works(target('ffmpeg')) && works(target('ffprobe')) && !force) {
  console.log(`ffmpeg is already in ${TOOLS} — nothing to do (use --force to replace it).`);
  process.exit(0);
}

try {
  if (process.platform === 'linux') {
    const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
    if (!arch) throw new Error(`unsupported Linux architecture “${process.arch}”`);
    const url = `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz`;
    const archive = path.join(TOOLS, 'ffmpeg-static.tar.xz');
    await download(url, archive, 'ffmpeg static build');
    console.log('  extracting…');
    if (run('tar', ['-xJf', archive, '-C', TOOLS]).status !== 0) throw new Error('extraction failed (is “tar” with xz support installed?)');
    fs.rmSync(archive, { force: true });
    // The archive unpacks into ffmpeg-*-static/ — move the two binaries up.
    const dir = fs.readdirSync(TOOLS).find((n) => n.startsWith('ffmpeg-') && n.endsWith('-static'));
    if (!dir) throw new Error('the archive did not contain the expected folder');
    for (const name of ['ffmpeg', 'ffprobe']) {
      fs.copyFileSync(path.join(TOOLS, dir, name), target(name));
      fs.chmodSync(target(name), 0o755);
    }
    fs.rmSync(path.join(TOOLS, dir), { recursive: true, force: true });
    fs.rmSync(path.join(TOOLS, 'GPLv3.txt'), { force: true });
  } else if (process.platform === 'darwin') {
    for (const name of ['ffmpeg', 'ffprobe']) {
      const zip = path.join(TOOLS, `${name}.zip`);
      await download(`https://evermeet.cx/ffmpeg/${name === 'ffmpeg' ? 'getrelease/ffmpeg.zip' : 'getrelease/ffprobe.zip'}`, zip, name);
      if (run('unzip', ['-o', '-q', zip, '-d', TOOLS]).status !== 0) throw new Error(`could not unzip ${name}`);
      fs.rmSync(zip, { force: true });
      fs.chmodSync(target(name), 0o755);
    }
  } else {
    console.log('On Windows, install ffmpeg with one of these, then re-run the service:\n');
    console.log('  winget install --id Gyan.FFmpeg -e        (or: choco install ffmpeg)');
    console.log('\nThe service finds it on PATH automatically; if not, set FFMPEG_PATH in .env.');
    process.exit(0);
  }
} catch (e) {
  console.error(`\nCould not download ffmpeg: ${e.message}`);
  console.error('Install it with your package manager instead (apt/apk/brew/winget install ffmpeg), or set FFMPEG_PATH.');
  process.exit(1);
}

const version = spawnSync(target('ffmpeg'), ['-version'], { encoding: 'utf8' }).stdout?.split('\n')[0] || '';
if (works(target('ffmpeg')) && works(target('ffprobe'))) console.log(`\n✔ ready in ${TOOLS}\n  ${version.trim()}\n\nThe service uses these automatically — just run “npm start”.`);
else { console.error('\nSomething went wrong: the binaries do not run on this machine.'); process.exit(1); }
