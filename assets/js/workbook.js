import { COPY_KEYS } from './copy-keys.js';

export const WORKBOOK_URL = 'data/website.xlsx';
export const PREVIEW_KEY = 'addabaaz.content-preview.v1';
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const videoColumns = ['id', 'position', 'title', 'youtubeId', 'publishDate', 'duration', 'views', 'thumbnail', 'availability', 'project', 'episode', 'kind'];
export const SCHEMA = {
  Shows: { columns: ['key', 'title', 'subtitle', 'description', 'image', 'genre'], required: ['key', 'title'], help: 'One row per show. Keep each key unique. Episodes use this key in their project column. Home cards are ranked by episode views.' },
  Episodes: { columns: videoColumns, required: ['id', 'project', 'title', 'availability', 'kind'], help: 'One row per episode, in playback order. project must match a Shows key. Use an 11-character YouTube ID, not a full URL. Format durations and dates as Text in Excel.' },
  Promos: { columns: videoColumns, required: ['id', 'title', 'availability', 'kind'], help: 'Promotional videos in display order. kind is PROMO or SPECIAL. Duration is text, for example 00:30.' },
  Upcoming: { columns: ['file', 'title', 'featured', 'home'], required: ['file', 'featured', 'home'], help: 'Poster filename inside upcomingFolder. featured=yes selects the wide featured poster (at most one). home=yes includes a poster in the home rail. Titles are optional.' },
  BTS: { columns: ['file', 'title'], required: ['file'], help: 'Behind-the-scenes filenames inside btsFolder, in display order. Upload the image files separately; this workbook does not embed media.' },
  Team: { columns: ['id', 'name', 'role', 'quote', 'image'], required: ['id', 'name'], help: 'Team members in display order. image is a site-relative path or an HTTPS URL. Quotes are optional.' },
  Services: { columns: ['id', 'number', 'title', 'description'], required: ['id', 'title'], help: 'Services in display order. Keep number as text to preserve leading zeroes (01, 02, …).' },
  Missions: { columns: ['id', 'language', 'text'], required: ['id', 'language', 'text'], help: 'Mission statements in display order. language is en or bn. Bengali text is fully supported.' },
  Copy: { columns: ['key', 'value'], required: ['key'], fixed: true, help: 'Headings, navigation, contact details, links, form labels and footer. Edit values, not keys. Contact display text and href links are separate values; update both. Values are plain text, not HTML.' },
  Settings: { columns: ['key', 'value'], required: ['key'], fixed: true, help: 'Folders, home limits and public inquiry-form configuration. Do not store passwords or secrets here. Keep schemaVersion at 1.' }
};
export const SETTING_KEYS = ['schemaVersion', 'upcomingFolder', 'btsFolder', 'upcomingHomeLimit', 'btsHomeLimit', 'appsScriptUrl', 'googleFormAction', 'formField.name', 'formField.email', 'formField.phone', 'formField.message'];

export function pairs(rows) {
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

// Values can never select HTML attributes, execute JS, or create CSS declarations.
export function validUrl(value, links = false) {
  if (!value) return true;
  if (/[<>"'`\\\u0000-\u001f\u007f]/.test(value) || value.trim() !== value) return false;
  if (/^https?:\/\/[^\s/]+/i.test(value)) {
    try { const url = new URL(value); return !!url.hostname && !url.username && !url.password; } catch { return false; }
  }
  if (links && /^(mailto:[^\s@]+@[^\s@]+|tel:\+?[\d ()-]+)$/i.test(value)) return true;
  return !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('//') && !value.split('/').includes('..');
}

export function validateTables(tables) {
  const errors = [];
  const issue = (sheet, row, field, message) => errors.push(`${sheet}${row ? ` row ${row}` : ''}${field ? ` / ${field}` : ''}: ${message}`);
  for (const [name, schema] of Object.entries(SCHEMA)) {
    const rows = tables[name];
    if (!Array.isArray(rows)) { issue(name, 0, '', 'missing worksheet'); continue; }
    if (rows.length > 5000) { issue(name, 0, '', 'maximum 5,000 rows'); continue; }
    const ids = new Set();
    rows.forEach((row, index) => {
      const n = index + 2;
      for (const field of schema.columns) {
        if (typeof row[field] !== 'string') { issue(name, n, field, 'must be text'); continue; }
        const value = row[field];
        if (value.length > 16000) issue(name, n, field, 'maximum 16,000 characters');
        if (schema.required.includes(field) && !value.trim()) issue(name, n, field, 'required');
        if (['id', 'key', 'project'].includes(field) && value && !['Copy', 'Settings'].includes(name)) {
          if (!/^[a-zA-Z0-9_-]+$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) issue(name, n, field, 'use only letters, numbers, underscores or hyphens');
        }
        if (['image', 'thumbnail'].includes(field) && !validUrl(value)) issue(name, n, field, 'use a safe relative path or HTTP(S) URL (no quotes)');
        if (field === 'youtubeId' && value && !/^[\w-]{11}$/.test(value)) issue(name, n, field, 'must be an 11-character YouTube ID');
        if (['position', 'episode', 'views'].includes(field) && value && !/^\d+(,\d{3})*$/.test(value)) issue(name, n, field, 'must be a non-negative whole number');
        if (field === 'availability' && !['available', 'unavailable'].includes(value)) issue(name, n, field, 'use available or unavailable');
        if (field === 'kind' && !(name === 'Episodes' ? ['EPISODE', 'SPECIAL'] : ['PROMO', 'SPECIAL']).includes(value)) issue(name, n, field, 'invalid video kind');
        if (['featured', 'home'].includes(field) && !['yes', 'no'].includes(value)) issue(name, n, field, 'use yes or no');
        if (field === 'language' && !['en', 'bn'].includes(value)) issue(name, n, field, 'use en or bn');
        if (field === 'file' && (/[\\/\u0000-\u001f]/.test(value) || ['.', '..'].includes(value))) issue(name, n, field, 'use a filename only, not a folder or URL');
      }
      const identity = row.key ?? row.id ?? row.file;
      if (ids.has(identity)) issue(name, n, 'key / id / file', `duplicate: ${identity}`);
      ids.add(identity);
    });
  }
  if (errors.length) return errors;
  const shows = new Set(tables.Shows.map(row => row.key));
  tables.Episodes.forEach((row, i) => {
    if (!shows.has(row.project)) issue('Episodes', i + 2, 'project', `unknown show: ${row.project}`);
  });
  if (tables.Upcoming.filter(row => row.featured === 'yes').length > 1) issue('Upcoming', 0, 'featured', 'only one featured poster is allowed');
  for (const [name, keys] of [['Copy', COPY_KEYS], ['Settings', SETTING_KEYS]]) {
    const actual = new Set(tables[name].map(row => row.key));
    for (const key of keys) if (!actual.has(key)) issue(name, 0, key, 'required key is missing');
    for (const key of actual) if (!keys.includes(key)) issue(name, 0, key, 'unknown key');
  }
  tables.Copy.forEach((row, i) => {
    if (/\.(href|src)(\.\d+)?$/.test(row.key) && !validUrl(row.value, row.key.includes('.href'))) issue('Copy', i + 2, row.key, 'unsafe URL or path');
  });
  const settings = pairs(tables.Settings);
  if (settings.schemaVersion !== '1') issue('Settings', 0, 'schemaVersion', 'expected version 1');
  for (const key of ['upcomingHomeLimit', 'btsHomeLimit']) if (!/^\d+$/.test(settings[key]) || Number(settings[key]) > 100) issue('Settings', 0, key, 'use a whole number from 0 to 100');
  for (const key of ['upcomingFolder', 'btsFolder']) if (!settings[key] || !validUrl(settings[key]) || !settings[key].endsWith('/')) issue('Settings', 0, key, 'use a safe folder path ending in /');
  for (const key of ['appsScriptUrl', 'googleFormAction']) if (settings[key] && (!validUrl(settings[key]) || !settings[key].startsWith('https://'))) issue('Settings', 0, key, 'use an HTTPS URL or leave blank');
  return errors;
}

export function assertValid(tables) {
  const errors = validateTables(tables);
  if (errors.length) throw new Error(errors.slice(0, 20).join('\n') + (errors.length > 20 ? `\n… and ${errors.length - 20} more errors.` : ''));
  return tables;
}

export async function readWorkbook(bytes) {
  if (bytes.byteLength > MAX_FILE_SIZE) throw new Error('Workbook exceeds the 10 MB limit. Keep images outside the workbook.');
  const workbook = new globalThis.ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); } catch { throw new Error('Unable to read this file. Select a valid .xlsx workbook, not .xls or .csv.'); }
  const tables = {};
  for (const [name, schema] of Object.entries(SCHEMA)) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) throw new Error(`Missing worksheet: ${name}. Start from the supplied website.xlsx template.`);
    if (sheet.rowCount > 5001 || sheet.columnCount > 30) throw new Error(`${name}: worksheet is too large.`);
    const headers = sheet.getRow(1).values.slice(1).map(value => String(value ?? '').trim());
    if (schema.columns.some(column => !headers.includes(column)) || headers.some(column => !schema.columns.includes(column)) || new Set(headers).size !== headers.length) throw new Error(`${name}: headers must be exactly ${schema.columns.join(', ')} (any column order).`);
    tables[name] = [];
    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = {};
      headers.forEach((header, j) => {
        const value = sheet.getRow(i).getCell(j + 1).value;
        if (value && typeof value === 'object') throw new Error(`${name} row ${i} / ${header}: use plain text or numbers, not formulas, dates, rich text or hyperlinks. Format this column as Text in Excel.`);
        row[header] = String(value ?? '');
      });
      if (Object.values(row).some(value => value.trim())) tables[name].push(row);
    }
  }
  return assertValid(tables);
}

export async function loadPublishedWorkbook() {
  const response = await fetch(WORKBOOK_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${WORKBOOK_URL} (HTTP ${response.status}).`);
  return readWorkbook(await response.arrayBuffer());
}

export async function writeWorkbook(tables) {
  assertValid(tables);
  const workbook = new globalThis.ExcelJS.Workbook();
  workbook.creator = 'ADDABAAZ Content Admin';
  const guide = workbook.addWorksheet('Read Me');
  guide.columns = [{ header: 'Section', key: 'section', width: 24 }, { header: 'Instructions', key: 'instructions', width: 110 }];
  guide.addRows([
    { section: 'Getting started', instructions: 'Edit data rows, not sheet names or column headers. Save as website.xlsx. Format cells as Text to preserve dates, durations, Bengali text and leading zeroes. No formulas or embedded images.' },
    { section: 'Publishing', instructions: 'Replace data/website.xlsx in the hosted website and deploy. Admin edits, previews and downloads do not publish automatically. Never store secrets in this public workbook.' },
    { section: 'Media', instructions: 'Upload images to the site separately. Paths are relative to index.html. Existing filenames with spaces and Bengali characters are supported.' },
    ...Object.entries(SCHEMA).map(([section, schema]) => ({ section, instructions: schema.help }))
  ]);
  for (const [name, schema] of Object.entries(SCHEMA)) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = schema.columns.map(key => ({ header: key, key, width: ['description', 'text', 'value', 'title', 'quote'].includes(key) ? 64 : 25, style: { numFmt: '@' } }));
    for (const row of tables[name]) sheet.addRow(schema.columns.map(key => row[key]));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: schema.columns.length } };
  }
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9E1621' } };
    sheet.getRow(1).height = 26;
    sheet.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });
  }
  return workbook.xlsx.writeBuffer();
}
