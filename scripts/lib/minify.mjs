/* Production minification for the web front-end: identical file paths, minified bodies.
 * Comments, formatting and redundant syntax never leave the server, so what the browser
 * downloads (and what casual "view source" shows) is not readable source code.
 * Uses esbuild (a normal dependency); safe to run on every build. */
import fs from 'node:fs';
import path from 'node:path';

const MINIFY_JS = new Set(['.js']);
const MINIFY_CSS = new Set(['.css']);

async function transform(ext, text, esbuild) {
  if (MINIFY_JS.has(ext)) return (await esbuild.transform(text, { minify: true, target: 'es2020', loader: 'js' })).code;
  if (MINIFY_CSS.has(ext)) return (await esbuild.transform(text, { minify: true, loader: 'css' })).code;
  return text;
}

/**
 * Copies srcDir into outDir, minifying every .js/.css along the way (other files are copied
 * byte-for-byte). outDir is created as needed; callers that want a clean mirror should
 * remove it first. Returns { files, saved } for logging.
 */
export async function minifyTree(srcDir, outDir) {
  const esbuild = await import('esbuild');
  let files = 0, saved = 0;
  const walk = async (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, entry.name);
      const dest = path.join(outDir, path.relative(srcDir, src));
      if (entry.isDirectory()) { fs.mkdirSync(dest, { recursive: true }); await walk(src); continue; }
      const raw = fs.readFileSync(src);
      const ext = path.extname(entry.name).toLowerCase();
      if (!MINIFY_JS.has(ext) && !MINIFY_CSS.has(ext)) { fs.writeFileSync(dest, raw); continue; }
      const out = await transform(ext, raw.toString('utf8'), esbuild);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, out);
      files++; saved += raw.length - Buffer.byteLength(out);
    }
  };
  fs.mkdirSync(outDir, { recursive: true });
  await walk(srcDir);
  return { files, saved };
}

/** Minifies one file (JS/CSS) into dest; anything else is copied. dest's directory is created. */
export async function minifyFile(src, dest) {
  const esbuild = await import('esbuild');
  const raw = fs.readFileSync(src);
  const ext = path.extname(src).toLowerCase();
  const out = await transform(ext, raw.toString('utf8'), esbuild);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  return { saved: raw.length - Buffer.byteLength(out) };
}
