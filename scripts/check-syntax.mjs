import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function check(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(file);
    else if (/\.(m?js)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
for (const dir of ['frontend/assets/js', 'shared', 'backend/src', 'backend/scripts', 'android/web', 'android/scripts', 'iOS/web', 'iOS/scripts']) await check(dir);
console.log('JavaScript syntax checks passed.');
