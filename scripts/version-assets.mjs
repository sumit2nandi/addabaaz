// Version only frontend assets; workbook/library startup is no longer used.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(dir) {
  const result = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) result.push(...await walk(`${dir}/${item.name}`));
    else if (/\.(html|css|js)$/.test(item.name)) result.push(`${dir}/${item.name}`);
  }
  return result;
}
const files = ['frontend/index.html', ...await walk('frontend/assets'), ...await walk('frontend/components'), ...await walk('shared')].sort();
const normalize = s => s.replace(/\?v=[\w-]+/g, '').replace(/const ASSET_VERSION = '[^']*';/g, "const ASSET_VERSION = 'VERSION';");
const contents = await Promise.all(files.map(file => fs.readFile(file, 'utf8')));
const hash = createHash('sha256');
files.forEach((file, i) => hash.update(file + '\0' + normalize(contents[i])));
const version = hash.digest('hex').slice(0, 12);
for (let i = 0; i < files.length; i++) {
  // Shared modules are unversioned and served with revalidation; no generated
  // values are inserted into the backend schema or native build helpers.
  if (!files[i].startsWith('frontend/')) continue;
  let text = contents[i].replace(/const ASSET_VERSION = '[^']*';/g, `const ASSET_VERSION = '${version}';`);
  text = text.replace(/((?:src|href)="assets\/[^"?]+\.(?:js|css))(?:\?v=[\w-]+)?"/g, `$1?v=${version}"`);
  text = text.replace(/(from\s+['"]\.\.?\/[^'"?]+\.js)(?:\?v=[\w-]+)?(['"])/g, `$1?v=${version}$2`);
  if (text !== contents[i]) await fs.writeFile(files[i], text);
}
console.log(`Frontend asset version: ${version}`);
