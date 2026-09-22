import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { SCHEMA, readWorkbook, writeWorkbook, validateTables, validUrl, MAX_FILE_SIZE } from '../shared/workbook.js';
import { runtimeData } from '../shared/runtime-data.js';
import { COPY_KEYS } from '../shared/copy-keys.js';

globalThis.ExcelJS = ExcelJS;
const source = await fs.readFile(new URL('../backend/seed/website.xlsx', import.meta.url));
const original = await readWorkbook(source);
const clone = () => structuredClone(original);

test('workbook contains all migrated sections and original media', () => {
  assert.deepEqual(validateTables(original), []);
  assert.deepEqual(Object.fromEntries(Object.entries(original).map(([name, rows]) => [name, rows.length])), {
    Shows: 4, Episodes: 35, Promos: 158, Upcoming: 15, BTS: 19, Team: 9, Services: 6, Missions: 10, Copy: 111, Settings: 11
  });
  assert.equal(original.Shows[0].title, 'শহীদ (Shahid)');
  assert.equal(original.Episodes[0].duration, '15:48');
  assert.equal(original.Services[0].number, '01');
  assert.equal(original.Upcoming[0].file, 'Durga.png');
});

test('Excel round trip preserves every field, Unicode, leading zeros and plain text', async () => {
  const data = clone();
  data.Shows[0].title = 'বাংলা — "quoted" & <plain text>';
  data.Services[0].description = '=HYPERLINK("https://example.com", "Text, not a formula")';
  const bytes = await writeWorkbook(data);
  assert.deepEqual(await readWorkbook(bytes), data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.getWorksheet('Services').getCell('D2').type, ExcelJS.ValueType.String);
});

test('mapping derives counts and associates episodes without duplicating content', () => {
  const runtime = runtimeData(original);
  assert.equal(runtime.projectDetails.laughBite.videoCount, 16);
  assert.equal(runtime.projectDetails.centralCalcuttaBoarding.videoCount, 0);
  assert.equal(runtime.projectDetails.shahid.episodes[0].id, 'v35');
  assert.equal(runtime.BTS_HOME_LIMIT, 10);
  assert.equal(runtime.FORM_CONFIG.googleFormFields.email, 'entry.608979481');
});

test('add, edit, reorder and delete rows survive saving', async () => {
  const data = clone();
  data.Shows.push({ ...data.Shows[0], key: 'new-show', title: 'New show' });
  data.Episodes.push({ ...data.Episodes[0], id: 'new-episode', project: 'new-show' });
  data.BTS.reverse();
  data.Team.splice(0, 1);
  assert.deepEqual(await readWorkbook(await writeWorkbook(data)), data);
});

test('empty optional catalogues are supported', async () => {
  const data = clone();
  for (const name of Object.keys(SCHEMA)) if (!SCHEMA[name].fixed) data[name] = [];
  assert.deepEqual(await readWorkbook(await writeWorkbook(data)), data);
});

test('duplicate IDs, missing fields and broken relationships are rejected', () => {
  const data = clone();
  data.Episodes[0].project = 'missing';
  assert.match(validateTables(data).join('\n'), /unknown show: missing/);
  data.Team.push({ ...data.Team[0] });
  data.Shows[0].title = '';
  assert.match(validateTables(data).join('\n'), /duplicate/);
  assert.match(validateTables(data).join('\n'), /title: required/);
});

test('settings, required bindings, media IDs and feature flags are validated', () => {
  const data = clone();
  data.Settings.find(row => row.key === 'btsHomeLimit').value = '-2';
  data.Settings.find(row => row.key === 'schemaVersion').value = '2';
  data.Copy.pop();
  assert.match(validateTables(data).join('\n'), /required key is missing/);
  assert.match(validateTables(data).join('\n'), /expected version 1/);
  assert.match(validateTables(data).join('\n'), /whole number from 0 to 100/);
  data.Episodes[0].youtubeId = 'https://youtu.be/123';
  assert.match(validateTables(data).join('\n'), /11-character YouTube ID/);
});

test('unsafe URLs, IDs and prototype keys are rejected', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//evil.test', '../secret', 'java\nscript:alert(1)', 'a" onerror="alert(1)', "a');color:red;/*", 'file:///tmp/test', '\\evil.test']) assert.equal(validUrl(value, true), false, value);
  for (const value of ['images/কিছু কথা.webp', 'https://example.com/image.png', 'mailto:office@addabaaz.in', 'tel:+913331866791']) assert.equal(validUrl(value, true), true, value);
  const data = clone();
  data.Shows[0].key = '__proto__';
  data.Promos[0].id = "x');alert(1);//";
  data.Copy.find(row => row.key.includes('.href')).value = 'javascript:alert(1)';
  assert.ok(validateTables(data).length >= 2);
  data.Shows[0].key = 'shahid'; data.Promos[0].id = 'v1';
  assert.match(validateTables(data).join('\n'), /unsafe URL/);
});

test('bad files, missing sheets, formulas and wrong headers have actionable errors', async () => {
  await assert.rejects(readWorkbook(Buffer.from('not an Excel file')), /valid .xlsx/);
  await assert.rejects(readWorkbook({ byteLength: MAX_FILE_SIZE + 1 }), /10 MB/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(source);
  workbook.getWorksheet('Shows').getCell('B2').value = { formula: '1+1', result: 2 };
  await assert.rejects(readWorkbook(await workbook.xlsx.writeBuffer()), /plain text or numbers/);
  workbook.getWorksheet('Shows').getCell('B2').value = 'title';
  workbook.getWorksheet('Shows').getCell('B1').value = 'wrong header';
  await assert.rejects(readWorkbook(await workbook.xlsx.writeBuffer()), /headers must be exactly/);
  workbook.removeWorksheet('Shows');
  await assert.rejects(readWorkbook(await workbook.xlsx.writeBuffer()), /Missing worksheet: Shows/);
});

test('template bindings and workbook keys stay in sync', async () => {
  const root = new URL('../frontend/', import.meta.url);
  const files = ['index.html', ...(await fs.readdir(new URL('components/', root))).map(name => `components/${name}`)];
  const used = [];
  for (const file of files) {
    const html = await fs.readFile(new URL(file, root), 'utf8');
    used.push(...[...html.matchAll(/data-copy(?:-[\w-]+)?="([^"]+)"/g)].map(match => match[1]));
  }
  assert.deepEqual([...new Set(used)].sort(), [...COPY_KEYS].sort());
});

test('all original local image references resolve on disk', async () => {
  const settings = Object.fromEntries(original.Settings.map(row => [row.key, row.value]));
  const images = [
    ...original.Shows.map(row => row.image), ...original.Team.map(row => row.image),
    ...original.Upcoming.map(row => settings.upcomingFolder + row.file),
    ...original.BTS.map(row => settings.btsFolder + row.file)
  ];
  for (const image of images) await fs.access(path.resolve('backend/media', image));
});


test('multiple featured posters validate and retain workbook order on round trip', async () => {
  const data = clone();
  data.Upcoming.forEach((row, index) => { row.featured = [0, 1, 3].includes(index) ? 'yes' : 'no'; });
  assert.deepEqual(validateTables(data), []);
  const reread = await readWorkbook(await writeWorkbook(data));
  assert.deepEqual(reread.Upcoming.filter(row => row.featured === 'yes').map(row => row.file), ['Durga.png', 'POSTER (1).png', 'POSTER (4).png']);
});
