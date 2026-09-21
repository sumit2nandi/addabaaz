import { SCHEMA, PREVIEW_KEY, MAX_FILE_SIZE, loadPublishedWorkbook, readWorkbook, writeWorkbook, assertValid } from './workbook.js?v=6fbd4bccb8bf';

const $ = id => document.getElementById(id);
let tables, currentSheet = 'Shows', selected = 0, dirty = false, fileHandle = null, fileModified = null, busy = false;
let startupSignal;
const fixed = () => SCHEMA[currentSheet].fixed;

function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function setDirty(value) {
  dirty = value;
  $('dirtyIndicator').classList.toggle('dirty', dirty);
  $('saveState').textContent = dirty ? 'Unsaved changes · not published' : 'Workbook ready · local editor';
}
function refreshActions() {
  const locked = busy || !globalThis.ExcelJS?.Workbook || startupSignal?.aborted;
  for (const id of ['downloadButton', 'previewButton']) $(id).disabled = locked || !tables;
  $('saveFileButton').disabled = locked || !tables || !fileHandle;
  for (const id of ['importButton', 'linkButton', 'reloadButton']) $(id).disabled = locked;
  $('workspace').inert = !!locked;
}
async function run(action) {
  if (busy) return;
  busy = true;
  refreshActions();
  try { await action(); } catch (error) {
    if (error.name !== 'AbortError') {
      message(error.message, true);
      $('status').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } finally { busy = false; refreshActions(); }
}
function confirmReplace() { return !dirty || confirm('Discard unsaved edits and replace the workbook currently in the editor?'); }
function accept(data, source, handle = null, modified = null) {
  tables = data;
  fileHandle = handle;
  fileModified = modified;
  selected = 0;
  $('sourceName').textContent = source;
  $('search').value = '';
  $('workspace').hidden = false;
  setDirty(false);
  renderSheet();
}
function rowTitle(row) { return row.title || row.name || row.text || row.key || row.file || '(New row)'; }
function rowSubtitle(row, index) { return `Row ${index + 2} · ${row.id || row.key || row.language || row.file || ''}`; }

function renderNav() {
  $('sheetNav').replaceChildren();
  for (const name of Object.keys(SCHEMA)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('active', name === currentSheet);
    button.setAttribute('aria-pressed', String(name === currentSheet));
    const label = document.createElement('span'); label.textContent = name;
    const count = document.createElement('small'); count.textContent = tables[name].length;
    button.append(label, count);
    button.addEventListener('click', () => {
      currentSheet = name; selected = 0; $('search').value = ''; renderSheet();
    });
    $('sheetNav').append(button);
  }
}
function renderRows() {
  const query = $('search').value.toLocaleLowerCase();
  $('rowList').replaceChildren();
  let count = 0;
  tables[currentSheet].forEach((row, index) => {
    if (query && !Object.values(row).some(value => value.toLocaleLowerCase().includes(query))) return;
    count++;
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('active', selected === index);
    button.setAttribute('aria-pressed', String(selected === index));
    const title = document.createElement('strong'); title.textContent = rowTitle(row);
    const sub = document.createElement('small'); sub.textContent = rowSubtitle(row, index);
    button.append(title, sub);
    button.addEventListener('click', () => { selected = index; renderRows(); renderForm(); });
    $('rowList').append(button);
  });
  $('rowCount').textContent = `${count} of ${tables[currentSheet].length} rows`;
  if (!count) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = query ? 'No matching rows. Try another search.' : 'No rows yet. Add one to get started.';
    $('rowList').append(empty);
  }
}
const choices = { availability: ['available', 'unavailable'], featured: ['yes', 'no'], home: ['yes', 'no'], language: ['en', 'bn'] };
function renderForm() {
  const row = tables[currentSheet][selected];
  const schema = SCHEMA[currentSheet];
  $('recordForm').replaceChildren();
  $('recordTitle').textContent = row ? `Editing row ${selected + 2}` : 'No row selected';
  $('deleteButton').disabled = !row || !!fixed();
  $('moveUp').disabled = !row || !!fixed() || selected === 0;
  $('moveDown').disabled = !row || !!fixed() || selected === tables[currentSheet].length - 1;
  if (!row) return;
  for (const field of schema.columns) {
    const label = document.createElement('label'); label.className = 'field';
    const caption = document.createElement('span'); caption.textContent = field + (schema.required.includes(field) ? ' *' : '');
    let input;
    const options = field === 'kind' ? (currentSheet === 'Episodes' ? ['EPISODE', 'SPECIAL'] : ['PROMO', 'SPECIAL']) : choices[field];
    if (options) {
      input = document.createElement('select');
      for (const value of options) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
    } else if (['description', 'text', 'quote', 'value', 'title'].includes(field)) {
      input = document.createElement('textarea');
      input.rows = ['title', 'quote'].includes(field) ? 2 : 4;
      label.classList.add('wide');
    } else { input = document.createElement('input'); input.type = 'text'; }
    input.id = `field-${field}`;
    input.name = field;
    input.value = row[field];
    input.required = schema.required.includes(field);
    input.maxLength = 16000;
    input.spellcheck = ['title', 'description', 'quote', 'text', 'value'].includes(field);
    if (fixed() && field === 'key') input.disabled = true;
    input.addEventListener('input', () => {
      row[field] = input.value;
      setDirty(true);
      message('Changes are local. Preview or download to validate the workbook.');
      renderRows();
    });
    label.append(caption, input);
    if (field === 'project' && currentSheet === 'Episodes') {
      const hint = document.createElement('small'); hint.textContent = `Show keys: ${tables.Shows.map(show => show.key).join(', ') || 'Add a show first.'}`; label.append(hint);
    }
    $('recordForm').append(label);
  }
}
function renderSheet() {
  renderNav();
  $('sheetTitle').textContent = currentSheet;
  $('sheetHelp').textContent = SCHEMA[currentSheet].help;
  $('addButton').hidden = !!fixed();
  renderRows(); renderForm();
}
$('recordForm').addEventListener('submit', event => event.preventDefault());
$('search').addEventListener('input', renderRows);
$('addButton').addEventListener('click', () => {
  const row = Object.fromEntries(SCHEMA[currentSheet].columns.map(column => [column, '']));
  if ('id' in row || 'key' in row) row['key' in row ? 'key' : 'id'] = `${currentSheet.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  for (const [key, values] of Object.entries(choices)) if (key in row) row[key] = values[0];
  if ('featured' in row) row.featured = 'no';
  if ('kind' in row) row.kind = currentSheet === 'Episodes' ? 'EPISODE' : 'PROMO';
  if (currentSheet === 'Episodes') row.project = tables.Shows[0]?.key || '';
  tables[currentSheet].push(row);
  selected = tables[currentSheet].length - 1;
  $('search').value = '';
  setDirty(true); renderSheet();
  message('New row added. Fill in required fields before previewing or saving.');
  $('recordForm').querySelector('input:not(:disabled), textarea, select')?.focus();
});
$('deleteButton').addEventListener('click', () => {
  const row = tables[currentSheet][selected];
  if (!row || fixed()) return;
  if (currentSheet === 'Shows' && tables.Episodes.some(ep => ep.project === row.key)) {
    message('Remove or reassign this show’s episodes before deleting the show.', true); return;
  }
  if (!confirm(`Delete “${rowTitle(row)}”? This removes one row from the local workbook.`)) return;
  tables[currentSheet].splice(selected, 1);
  selected = Math.max(0, selected - 1);
  setDirty(true); renderSheet(); message('Row deleted locally. Download or save to keep this change.');
});
for (const [id, delta] of [['moveUp', -1], ['moveDown', 1]]) $(id).addEventListener('click', () => {
  const rows = tables[currentSheet], target = selected + delta;
  if (fixed() || target < 0 || target >= rows.length) return;
  [rows[selected], rows[target]] = [rows[target], rows[selected]];
  selected = target; setDirty(true); renderRows(); renderForm();
});
$('importButton').addEventListener('click', () => { if (confirmReplace()) $('fileInput').click(); });
$('fileInput').addEventListener('change', () => run(async () => {
  const file = $('fileInput').files[0];
  $('fileInput').value = '';
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Choose an .xlsx workbook.');
  if (file.size > MAX_FILE_SIZE) throw new Error('Workbook must be smaller than 10 MB.');
  const data = await readWorkbook(await file.arrayBuffer());
  accept(data, file.name);
  message('Workbook imported. Edit, preview and download an updated copy. Nothing has been published.');
}));
$('reloadButton').addEventListener('click', () => {
  if (confirmReplace()) run(async () => {
    const data = await loadPublishedWorkbook();
    accept(data, 'data/website.xlsx'); message('Published workbook reloaded.');
  });
});
$('downloadButton').addEventListener('click', () => run(async () => {
  const bytes = await writeWorkbook(tables);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a'); link.href = url; link.download = 'website.xlsx';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setDirty(false);
  $('saveState').textContent = 'Excel downloaded · not published';
  message('Excel downloaded. To publish, replace data/website.xlsx in the website and deploy.');
}));
$('previewButton').addEventListener('click', () => {
  try {
    assertValid(tables);
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(tables));
    const preview = window.open('index.html?preview=1', '_blank');
    if (preview) { preview.opener = null; message('Preview opened in a new tab. The published website is unchanged.'); }
    else message('Preview saved. Your browser blocked the new tab; allow pop-ups or open index.html?preview=1 on this site.', true);
  } catch (error) { message(error.message, true); $('status').scrollIntoView({ block: 'nearest' }); }
});
const fileAccessSupported = 'showOpenFilePicker' in window && window.isSecureContext;
$('linkButton').hidden = !fileAccessSupported;
$('saveFileButton').hidden = !fileAccessSupported;
$('fileSupport').textContent = fileAccessSupported ? 'Local file access available. Your browser will ask for permission before opening or saving.' : 'Direct file saving is unavailable in this browser. Use Open Excel and Download Excel instead.';
$('linkButton').addEventListener('click', () => {
  if (!confirmReplace()) return;
  run(async () => {
    const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
    const file = await handle.getFile();
    if (file.size > MAX_FILE_SIZE) throw new Error('Workbook must be smaller than 10 MB.');
    const data = await readWorkbook(await file.arrayBuffer());
    accept(data, `Linked: ${file.name}`, handle, file.lastModified);
    message('Local workbook linked. Save to linked file will overwrite this file, not the hosted website.');
  });
});
$('saveFileButton').addEventListener('click', () => run(async () => {
  assertValid(tables);
  if (!confirm(`Overwrite the linked local file “${fileHandle.name}” with these changes?`)) return;
  // Ask while the click still has user activation (before XLSX serialization).
  if (await fileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Write permission was not granted. Download Excel instead.');
  const bytes = await writeWorkbook(tables);
  const current = await fileHandle.getFile();
  if (current.lastModified !== fileModified) throw new Error('The linked file changed outside this editor. Download your edits as a backup, then link the latest file again to avoid overwriting changes.');
  const writable = await fileHandle.createWritable();
  try { await writable.write(bytes); await writable.close(); } catch (error) { await writable.abort().catch(() => {}); throw error; }
  fileModified = (await fileHandle.getFile()).lastModified;
  setDirty(false);
  $('saveState').textContent = 'Local file saved · not published';
  message('Saved to the linked local Excel file. Replace the hosted workbook and deploy to publish.');
}));
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
export async function start({ signal, readerReady }) {
  startupSignal = signal;
  await run(async () => {
    if (location.protocol === 'file:') throw new Error('Serve the website over HTTP to use the editor. See README.md.');
    // Even when the workbook fails early, import must wait for a usable reader.
    const [content, reader] = await Promise.allSettled([
      loadPublishedWorkbook({ signal, readerReady }), readerReady
    ]);
    signal.throwIfAborted();
    if (reader.status === 'rejected') throw reader.reason;
    if (content.status === 'rejected') throw content.reason;
    accept(content.value, 'data/website.xlsx');
    message('Published workbook loaded. Select a worksheet to begin editing.');
  });
  // If only the published workbook fails, keep import available for recovery.
  document.getElementById('loadRecovery').hidden = !!tables;
}
