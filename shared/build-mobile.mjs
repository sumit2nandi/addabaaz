// Shared build implementation; each platform owns its package/config/native files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

export async function buildMobile(appRoot, platform, { native = false } = {}) {
  const root = path.resolve(appRoot, '..');
  const require = createRequire(path.join(appRoot, 'package.json'));
  const { build } = require('esbuild');
  const api = process.env.API_BASE_URL || '';
  if (api) {
    const url = new URL(api);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('API_BASE_URL must be your publicly reachable HTTPS backend origin, without a path or credentials.');
  } else if (native) throw new Error('Set API_BASE_URL to your deployed HTTPS backend before creating a native build. No localhost or bundled catalogue fallback is used.');
  const output = path.join(appRoot, 'www');
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  const components = ['home', 'player', 'upcoming', 'bts', 'video-preview', 'poster-preview', 'modal'];
  const scripts = ['helpers', 'hero', 'video-preview', 'galleries', 'featured-upcoming', 'poster-preview', 'navigation', 'catalog', 'app'];
  await fs.copyFile(path.join(root, 'backend/media/images/addabaaz-logo-small.webp'), path.join(output, 'assets/logo.webp'));
  for (const name of ['site', 'splash']) await fs.copyFile(path.join(root, `frontend/assets/css/${name}.css`), path.join(output, `assets/${name}.css`));
  await fs.copyFile(path.join(appRoot, 'web/mobile.css'), path.join(output, 'assets/mobile.css'));
  const templates = await Promise.all(components.map(name => fs.readFile(path.join(root, `frontend/components/${name}.html`), 'utf8')));
  let shell = await fs.readFile(path.join(appRoot, 'web/index.html'), 'utf8');
  shell = shell.replace("connect-src 'self'", `connect-src 'self'${api ? ' ' + new URL(api).origin : ''}`);
  await fs.writeFile(path.join(output, 'index.html'), shell.replace('<!-- APP_COMPONENTS -->', templates.join('\n')));
  const legacy = (await Promise.all(scripts.map(name => fs.readFile(path.join(root, `frontend/assets/js/site/${name}.js`), 'utf8')))).join('\n');
  const entry = await fs.readFile(path.join(appRoot, 'web/app.js'), 'utf8');
  await build({ stdin: { contents: legacy + '\n' + entry, resolveDir: appRoot, sourcefile: 'mobile-entry.js' },
    bundle: true, format: 'iife', target: platform === 'iOS' ? 'safari15' : 'chrome109', minify: true,
    define: { __API_BASE_URL__: JSON.stringify(api) },
    outfile: path.join(output, 'assets/app.js'), legalComments: 'eof' });
  console.log(`${platform} bundle built. Content is fetched from ${api || 'the preview proxy'}; no workbook or catalogue is packaged.`);
}
