import { SCHEMA, assertValid } from '../../shared/workbook.js';
import { runtimeData } from '../../shared/runtime-data.js';

export const sections = Object.keys(SCHEMA);
export const identity = name => SCHEMA[name].columns[0];
export const sqlTable = name => `content_${name.toLowerCase()}`;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validateContent(tables) {
  try {
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new Error('Expected a content object.');
    if (Object.keys(tables).some(name => !sections.includes(name))) throw new Error('Unknown content section.');
    for (const name of sections) {
      if (!Array.isArray(tables[name])) throw new Error(`Missing section: ${name}`);
      for (const row of tables[name]) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid ${name} row.`);
        if (Object.keys(row).some(key => !SCHEMA[name].columns.includes(key))) throw new Error(`Unknown ${name} field.`);
        const key = row[identity(name)];
        if (typeof key !== 'string' || key.length > 190 || key !== key.trim()) throw new Error(`${name} identity must be trimmed text up to 190 characters.`);
      }
    }
    assertValid(tables);
    if (Buffer.byteLength(JSON.stringify(tables)) > 10 * 1024 * 1024) throw new Error('Content exceeds 10 MB.');
    return tables;
  } catch (error) { throw new HttpError(422, error.message); }
}
function mediaUrl(value) {
  if (!value || /^https?:\/\//i.test(value)) return value;
  // Stored references are relative to backend/media; encode filenames including Bengali.
  return '/media/' + value.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}
export function publicPayload(snapshot, view = 'web') {
  const tables = structuredClone(snapshot.tables);
  for (const name of ['Shows', 'Episodes', 'Promos', 'Team']) {
    for (const row of tables[name]) for (const field of ['image', 'thumbnail']) {
      if (field in row) row[field] = mediaUrl(row[field]);
    }
  }
  for (const row of tables.Settings) if (['upcomingFolder', 'btsFolder'].includes(row.key)) row.value = mediaUrl(row.value);
  for (const row of tables.Copy) {
    if (row.value === 'images/addabaaz-logo.png') row.value = row.key.includes('.href') ? 'images/addabaaz-icon.png' : 'images/addabaaz-logo-small.webp';
    if (/\.(src|href)(\.\d+)?$/.test(row.key) && /^(images|UpcomingReleases|BTS)\//.test(row.value)) row.value = mediaUrl(row.value);
  }
  const base = { schemaVersion: 1, revision: snapshot.revision, updatedAt: snapshot.updatedAt };
  if (view === 'home') {
    const { FORM_CONFIG, ...runtime } = runtimeData(tables);
    const copy = Object.fromEntries(tables.Copy.filter(row => /^(home|player|upcoming|bts|video-preview|poster-preview|modal)\./.test(row.key)).map(row => [row.key, row.value]));
    return { ...base, copy, runtime };
  }
  return { ...base, tables };
}
