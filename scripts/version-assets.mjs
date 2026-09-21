// Stamp all browser entry points and module dependencies with one content revision.
// Checked-in output works on GitHub Pages without a production build step.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== 'vendor') files.push(...await walk(path)); }
    else if (/\.(js|css|html|json)$/.test(path)) files.push(path);
  }
  return files;
}
const files = ['index.html', 'admin.html', ...await walk('assets'), ...await walk('components')].sort();
const canonical = text => text.replace(/\?v=[\w-]+/g, '').replace(/const ASSET_VERSION = '[^']*';/g, "const ASSET_VERSION = 'VERSION';");
const contents = await Promise.all(files.map(file => fs.readFile(file, 'utf8')));
const hash = createHash('sha256');
files.forEach((file, i) => hash.update(file + '\0' + canonical(contents[i]) + '\0'));
const version = hash.digest('hex').slice(0, 12);
for (let i = 0; i < files.length; i++) {
  let text = contents[i];
  if (files[i].endsWith('.html')) text = text.replace(/((?:src|href)="assets\/[^"?]+\.(?:js|css))(?:\?v=[\w-]+)?"/g, `$1?v=${version}"`);
  if (files[i].endsWith('.js')) {
    text = text.replace(/(from\s+['"]\.\.?\/[^'"?]+\.js)(?:\?v=[\w-]+)?(['"])/g, `$1?v=${version}$2`);
    text = text.replace(/const ASSET_VERSION = '[^']*';/g, `const ASSET_VERSION = '${version}';`);
  }
  if (text !== contents[i]) await fs.writeFile(files[i], text);
}
console.log(`Browser asset version: ${version}`);
