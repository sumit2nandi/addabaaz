import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const script = path.resolve('scripts/version-assets.mjs');
test('frontend revision is stable until frontend or shared code changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'addabaaz-version-'));
  try {
    for (const dir of ['frontend/assets', 'frontend/components', 'shared']) await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, 'frontend/index.html'), '<script src="assets/app.js"></script>');
    await fs.writeFile(path.join(root, 'frontend/assets/app.js'), "const ASSET_VERSION = 'old';");
    const run = () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    const first = run(); assert.equal(run(), first);
    await fs.writeFile(path.join(root, 'shared/api-client.js'), '// new API behavior');
    assert.notEqual(run(), first);
    const html = await fs.readFile(path.join(root, 'frontend/index.html'), 'utf8');
    assert.match(html, /app.js\?v=[a-f0-9]{12}/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
