import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const stamp = path.resolve('scripts/version-assets.mjs');
test('asset stamping is repeatable and keeps unchanged Excel cached across app releases', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'addabaaz-version-'));
  try {
    await fs.mkdir(path.join(root, 'assets/vendor'), { recursive: true });
    await fs.mkdir(path.join(root, 'components'));
    const html = '<link href="assets/vendor/exceljs.min.js"><script src="assets/app.js"></script>';
    await fs.writeFile(path.join(root, 'index.html'), html);
    await fs.writeFile(path.join(root, 'admin.html'), html);
    await fs.writeFile(path.join(root, 'assets/app.js'), "const ASSET_VERSION = 'old';\nconst EXCEL_ASSET_VERSION = 'old';");
    await fs.writeFile(path.join(root, 'assets/vendor/exceljs.min.js'), 'reader-one');
    const run = () => execFileSync(process.execPath, [stamp], { cwd: root, encoding: 'utf8' });
    const read = () => fs.readFile(path.join(root, 'assets/app.js'), 'utf8');
    const vendorHash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
    const first = run(), code = await read();
    assert.equal(run(), first);
    assert.equal(await read(), code);
    assert.match(code, new RegExp(`const EXCEL_ASSET_VERSION = '${vendorHash('reader-one')}'`));
    await fs.appendFile(path.join(root, 'assets/app.js'), '\n// New application release');
    const second = run();
    assert.notEqual(second, first);
    assert.match(await read(), new RegExp(`const EXCEL_ASSET_VERSION = '${vendorHash('reader-one')}'`));
    await fs.writeFile(path.join(root, 'assets/vendor/exceljs.min.js'), 'reader-two');
    assert.notEqual(run(), second);
    assert.match(await read(), new RegExp(`const EXCEL_ASSET_VERSION = '${vendorHash('reader-two')}'`));
    for (const name of ['index.html', 'admin.html']) {
      assert.ok((await fs.readFile(path.join(root, name), 'utf8')).includes(`assets/vendor/exceljs.min.js?v=${vendorHash('reader-two')}`));
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
