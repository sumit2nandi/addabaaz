/**
 * The converter portal. Plain ES modules, no build step — the same convention as the main site.
 *
 * Flow: pick a source (browser upload / R2 object / URL) → the service stages it → ffmpeg produces the
 * ladder → the package is uploaded to R2 → the portal shows the exact key to use in the Content studio.
 * The API token lives in localStorage; every request carries it as a Bearer header.
 */
const TOKEN_KEY = 'ab.hls.token';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bytesText = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const secsText = (s) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

let token = localStorage.getItem(TOKEN_KEY) || '';
let cfg = null, health = null, jobs = [], counts = {}, filter = '';
let selectedFile = null, uploading = false, listTimer = null, streamAbort = null, openJobId = null;

/* ---------- tiny helpers ---------- */
function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = esc(message).replace(/\n/g, '<br>');
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 9000 : 4500);
}
function showErr(where, message) {
  const box = $(where);
  box.hidden = !message;
  box.textContent = message || '';
}
async function api(path, { method = 'GET', body, raw, signal } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method, signal,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `Request failed (${res.status})`), { status: res.status, code: data?.error?.code });
  return data;
}
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const slugify = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]{1,10}$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/* ---------- gate (API token) ---------- */
function showGate({ message = '', cancel = false } = {}) {
  $('#gate').hidden = false;
  $('#main').hidden = true;
  $('#gateCancel').hidden = !cancel;
  $('#tok').value = token;
  showErr('#gateErr', message);
  setTimeout(() => $('#tok').focus(), 50);
}
function hideGate() { $('#gate').hidden = true; $('#main').hidden = false; }

$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = $('#tok').value.trim();
  if (value.length < 24) return showErr('#gateErr', 'That token looks too short — CONVERTER_TOKEN must be at least 24 characters.');
  token = value;
  try { localStorage.setItem(TOKEN_KEY, token); await boot(); hideGate(); toast('Connected.', 'ok'); }
  catch (error) {
    token = localStorage.getItem(TOKEN_KEY) || '';
    showErr('#gateErr', error.status === 401 ? 'The service rejected that token (401). Check CONVERTER_TOKEN in the service’s .env.' : error.message);
  }
});
$('#gateCancel').onclick = () => hideGate();
$('#settingsBtn').onclick = () => showGate({ cancel: !!cfg });

/* ---------- health pills ---------- */
function renderPills() {
  if (!health) return;
  const f = health.ffmpeg || {};
  const r2 = health.r2 || {};
  const q = health.queue || { counts: {} };
  const active = (q.active || 0) + (q.queued || 0);
  const disk = health.disk ? bytesText(health.disk.freeBytes) : null;
  $('#pills').innerHTML = [
    `<span class="pill ${f.found ? 'ok' : 'bad'}"><i class="dot"></i>ffmpeg <b>${esc(f.found ? f.version : 'missing')}</b></span>`,
    `<span class="pill ${r2.configured ? 'ok' : 'bad'}"><i class="dot"></i>R2 <b>${esc(r2.configured ? (r2.bucket || 'bucket') : 'not configured')}</b></span>`,
    `<span class="pill ${active ? 'busy' : ''}"><i class="dot"></i>queue <b>${active ? `${active} waiting/running` : 'idle'}</b></span>`,
    disk ? `<span class="pill"><i class="dot"></i>disk free <b>${esc(disk)}</b></span>` : '',
    `<span class="pill"><i class="dot"></i>jobs <b>${counts.done || 0} done</b></span>`,
  ].join('');
  if (!f.found) $('#newErr').hidden = false, ($('#newErr').textContent = `ffmpeg was not found at “${f.path}”. Install it (apt/apk/brew/winget install ffmpeg), set FFMPEG_PATH, or run “npm run get:ffmpeg” inside the service folder, then restart the service.`);
}

/* ---------- new-conversion form ---------- */
function fillOptions() {
  const presets = cfg.presets || [];
  $('#preset').innerHTML = presets.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  $('#preset').value = cfg.defaultPreset || 'auto';
  $('#segments').innerHTML = (cfg.segmentSeconds || [6]).map((s) => `<option value="${s}" ${s === 6 ? 'selected' : ''}>${s} seconds</option>`).join('');
  $('#packaging').innerHTML = (cfg.packaging || []).map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  $('#speed').innerHTML = (cfg.x264Presets || ['medium']).map((p) => `<option value="${p}" ${p === 'medium' ? 'selected' : ''}>${{ veryfast: 'Very fast (bigger files)', fast: 'Fast', medium: 'Balanced (recommended)', slow: 'Slow (smaller files)' }[p] || p}</option>`).join('');
  $('#prefix').value = cfg.r2?.prefix || 'premium';
  $('#file').setAttribute('accept', 'video/*,' + (cfg.videoExtensions || []).map((e) => `.${e}`).join(','));
  $('#limitsNote').textContent = `up to ${bytesText(cfg.limits.maxUploadBytes)} per file · ${cfg.limits.concurrency} job(s) at a time · local copies kept ${cfg.limits.retentionHours}h`;
  if (!cfg.r2?.configured) {
    $('#upload').checked = false;
    $('#upload').disabled = true;
    $('#newErr').hidden = false;
    $('#newErr').innerHTML = `Cloudflare R2 is not configured on the service, so packages cannot be uploaded. ${esc(cfg.r2?.reason || '')}<br>You can still encode and download the ZIP from the job page.`;
  }
  updateHints();
}
const updateHints = () => {
  $('#presetHint').textContent = { auto: 'Every resolution the source fills, never upscaled.', full: 'Caps a 4K master at 1080p.', hd: 'Faster, smaller packages.', mobile: 'For weak networks.', fast: 'Rough-cut drafts.', source: 'One quality — fastest encode.' }[$('#preset').value] || '';
  $('#packHint').textContent = $('#packaging').value === 'fmp4' ? 'CMAF: modern players (Safari 10+, Chrome, hls.js) and smaller files.' : 'MPEG-TS: the safest, plays on the widest range of devices.';
};
$('#preset').onchange = updateHints; $('#packaging').onchange = updateHints;
$('#segments').onchange = updateHints;

// Chrome only remembers the folder, not the file, so the file name is the slug hint.
const guessSlug = () => {
  const name = selectedFile?.name || $('#r2Key').value.split('/').pop() || (() => { try { return new URL($('#srcUrlIn').value).pathname.split('/').pop(); } catch { return ''; } })();
  return slugify(name || '');
};
const syncSlug = () => { const g = guessSlug(); if (g && !$('#slug').dataset.touched) $('#slug').value = g; };
$('#slug').oninput = () => { $('#slug').dataset.touched = $('#slug').value ? '1' : ''; };
$('#r2Key').oninput = syncSlug; $('#srcUrlIn').oninput = syncSlug;

for (const tab of $$('.tab')) {
  tab.onclick = () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const which = tab.dataset.src;
    $('#srcUpload').hidden = which !== 'upload';
    $('#srcR2').hidden = which !== 'r2';
    $('#srcUrl').hidden = which !== 'url';
    syncSlug(); updateStart();
  };
}
$('#drop').onclick = () => $('#file').click();
$('#file').onchange = () => setFile($('#file').files[0]);
for (const evt of ['dragenter', 'dragover']) $('#drop').addEventListener(evt, (e) => { e.preventDefault(); $('#drop').classList.add('over'); });
for (const evt of ['dragleave', 'drop']) $('#drop').addEventListener(evt, (e) => { e.preventDefault(); $('#drop').classList.remove('over'); });
$('#drop').addEventListener('drop', (e) => setFile(e.dataTransfer?.files?.[0]));
function setFile(file) {
  selectedFile = file || null;
  $('#fileName').hidden = !selectedFile;
  $('#fileName').textContent = selectedFile ? `${selectedFile.name} · ${bytesText(selectedFile.size)}` : '';
  document.getElementById('slug').dataset.touched = '';
  syncSlug(); updateStart();
}
$('#upload').onchange = updateStart; $('#keepLocal').onchange = updateStart;

function currentSource() {
  const tab = $('.tab.active')?.dataset.src;
  if (tab === 'upload') return selectedFile ? { upload: true } : null;
  if (tab === 'r2') return $('#r2Key').value.trim() ? { r2Key: $('#r2Key').value.trim() } : null;
  return $('#srcUrlIn').value.trim() ? { url: $('#srcUrlIn').value.trim() } : null;
}
function updateStart() {
  const ready = !!currentSource() && !!$('#slug').value.trim() && !uploading && !!health?.ffmpeg?.found && !!token;
  $('#start').disabled = !ready;
  const src = currentSource();
  $('#estimate').textContent = health?.r2?.configured === false && $('#upload').checked ? '' : src?.upload && selectedFile ? `source ${bytesText(selectedFile.size)}` : '';
}

/* ---------- start a conversion ---------- */
function putFile(uploadId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/v1/uploads/${uploadId}?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error?.message || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted — is the converter service still running?'));
    xhr.onabort = () => reject(new Error('Upload canceled.'));
    xhr.send(file);
  });
}
const jobOptions = () => ({
  slug: $('#slug').value.trim(), preset: $('#preset').value, segmentSec: num($('#segments').value, 6),
  packaging: $('#packaging').value, x264Preset: $('#speed').value, r2Prefix: $('#prefix').value.trim() || cfg.r2?.prefix || 'premium',
  upload: $('#upload').checked, keepLocal: $('#keepLocal').checked,
});

$('#start').onclick = async () => {
  const src = currentSource();
  if (!src) return;
  showErr('#newErr', '');
  uploading = true; $('#start').disabled = true;
  const bar = $('#upBar'), note = $('#upNote');
  try {
    let source, name;
    if (src.upload) {
      name = selectedFile.name;
      bar.hidden = false; bar.classList.remove('done', 'bad'); bar.firstElementChild.style.width = '0%';
      note.textContent = 'Creating an upload slot…';
      const slot = await api('/uploads', { method: 'POST' });
      note.textContent = `Uploading ${name} (${bytesText(selectedFile.size)})…`;
      const out = await putFile(slot.uploadId, selectedFile, (p) => {
        bar.firstElementChild.style.width = `${(p * 100).toFixed(1)}%`;
        note.textContent = `Uploading ${name} — ${(p * 100).toFixed(0)}% of ${bytesText(selectedFile.size)}`;
      });
      bar.classList.add('done'); bar.firstElementChild.style.width = '100%';
      note.textContent = `Uploaded ${name} (${bytesText(out.bytes)}) — queued for conversion.`;
      source = { uploadId: out.uploadId, name: out.name };
    } else if (src.r2Key) { name = src.r2Key.split('/').pop(); source = { r2Key: src.r2Key }; }
    else { name = 'download.mp4'; source = { url: src.url }; }
    const { job } = await api('/jobs', { method: 'POST', body: { source, options: jobOptions() } });
    toast(`Queued ${job.id} — ${job.options.slug}`, 'ok');
    selectedFile = null; $('#file').value = ''; setFile(null); bar.hidden = true; note.textContent = '';
    await loadJobs();
    openJob(job.id);
  } catch (e) {
    showErr('#newErr', e.message);
    $('#upBar').classList.add('bad');
  } finally {
    uploading = false; updateStart();
  }
};

/* ---------- job list ---------- */
function statusBadge(job) {
  const label = job.status === 'done' && job.output?.local && !job.output?.masterKey ? 'done (local)' : job.stage && job.status === 'running' ? job.stage : job.status;
  return `<span class="badge ${job.status}">${esc(label)}</span>`;
}
function rungBars(job) {
  const rungs = job.rungs || [];
  if (!rungs.length) return '';
  const percent = job.status === 'done' ? 100 : job.progress?.percent || 0;
  const stage = job.progress?.stage || job.stage;
  const label = stage === 'uploading' ? 'upload to R2' : stage === 'encoding' ? 'encoding' : stage === 'packaging' ? 'checking' : stage;
  return `<div class="rungs">${rungs.map((r) => `
    <div class="rung"><span>${esc(r.name)}</span>
      <span class="bar"><i style="width:${Math.max(2, percent).toFixed(1)}%"></i></span>
      <span class="size">${esc(r.size || '')} ${r.segments ? `· ${r.segments} seg` : ''}</span></div>`).join('')}
    <div class="rung"><span class="muted">${esc(label)}</span><span class="bar"><i style="width:${Math.max(2, percent).toFixed(1)}%"></i></span>
      <span class="size">${percent ? `${percent.toFixed(0)}%` : ''}${job.progress?.speed ? ` · ${job.progress.speed.toFixed(2)}×` : ''}${job.progress?.etaSeconds ? ` · ${secsText(job.progress.etaSeconds)} left` : ''}</span></div>
  </div>`;
}
function jobCard(job) {
  const out = job.output || {};
  return `<article class="job ${job.status}" data-id="${job.id}">
    <div class="job-top">
      <span class="job-title">${esc(job.options.slug)}</span>${statusBadge(job)}
      <span class="job-meta">${esc(job.source.name)}${job.source.size ? ` · ${bytesText(job.source.size)}` : ''} · ${esc(job.options.packaging || 'ts')} · ${new Date(job.createdAt).toLocaleString()}</span>
      <span class="job-actions">
        ${job.status === 'running' || job.status === 'queued' ? `<button class="btn sm" data-act="cancel" data-id="${job.id}">Cancel</button>` : ''}
        ${['failed', 'canceled'].includes(job.status) ? `<button class="btn sm" data-act="retry" data-id="${job.id}">Retry</button>` : ''}
        ${job.status === 'done' && out.masterKey ? `<button class="btn sm" data-act="copy" data-key="${esc(out.masterKey)}">Copy key</button>` : ''}
        ${job.status === 'done' ? `<button class="btn sm" data-act="download" data-id="${job.id}">Download ZIP</button>` : ''}
        <button class="btn sm ghost" data-act="open" data-id="${job.id}">Details</button>
        <button class="btn sm danger" data-act="delete" data-id="${job.id}">Delete</button>
      </span>
    </div>
    ${job.status === 'running' || job.status === 'queued' ? rungBars(job) : ''}
    ${job.output?.masterKey ? `<div class="out"><span class="muted">R2 key</span> <code>${esc(job.output.masterKey)}</code>${job.output.files ? `<span class="muted">· ${job.output.files} files, ${bytesText(job.output.bytes || 0)}</span>` : ''}</div>` : ''}
    ${job.error ? `<div class="err">${esc(job.error.message)}${job.error.hint ? `\n${esc(job.error.hint)}` : ''}</div>` : ''}
  </article>`;
}
async function loadJobs() {
  try {
    const data = await api(`/jobs?limit=100${filter ? `&status=${filter}` : ''}`);
    jobs = data.jobs; counts = data.counts || {};
    renderPills();   // the “n done” counter lives in the pills, so refresh it with the list
    $('#jobs').innerHTML = jobs.length ? jobs.map(jobCard).join('') : '<p class="muted">No jobs yet — drop a video above and press Start conversion.</p>';
  } catch (e) {
    if (e.status === 401) return showGate({ message: 'The service rejected that token (401).' });
    $('#jobs').innerHTML = `<p class="muted">Could not load jobs: ${esc(e.message)}</p>`;
  }
  scheduleRefresh();
}
/** Poll fast while something is moving, slowly when everything is settled. */
function scheduleRefresh() {
  clearTimeout(listTimer);
  const busy = jobs.some((j) => j.status === 'running' || j.status === 'queued');
  listTimer = setTimeout(async () => {
    if (document.hidden) return scheduleRefresh();
    if (busy || openJobId) { await loadJobs(); if (openJobId) paintDrawer(await api(`/jobs/${openJobId}`).then((d) => d.job).catch(() => null)); }
    else scheduleRefresh();
  }, busy ? 1500 : 8000);
}
$('#refresh').onclick = () => { loadJobs(); toast('Refreshed.'); };
for (const chip of $$('.chip')) chip.onclick = () => { $$('.chip').forEach((c) => c.classList.toggle('active', c === chip)); filter = chip.dataset.status; loadJobs(); };

$('#jobs').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  const id = btn?.dataset.id || e.target.closest('.job')?.dataset.id;
  if (!btn) return e.target.closest('.job')?.dataset.id ? openJob(e.target.closest('.job').dataset.id) : undefined;
  const act = btn.dataset.act;
  try {
    if (act === 'open') return openJob(id);
    if (act === 'cancel') { await api(`/jobs/${id}/cancel`, { method: 'POST' }); toast('Canceling…'); }
    if (act === 'retry') { await api(`/jobs/${id}/retry`, { method: 'POST' }); toast('Queued again.', 'ok'); }
    if (act === 'delete') {
      if (!confirm('Delete this job? The local files are removed; anything already in R2 stays there.')) return;
      await api(`/jobs/${id}`, { method: 'DELETE', body: {} });
      if (openJobId === id) closeDrawer();
      toast('Job deleted.');
    }
    if (act === 'copy') { await navigator.clipboard.writeText(btn.dataset.key); return toast('R2 key copied — paste it in Content studio → Videos & reels → Video source → Private Cloudflare R2.', 'ok'); }
    if (act === 'download') {
      toast('Building the ZIP — for a large package this takes a moment…');
      const res = await fetch(`/api/v1/jobs/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || `Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || `hls-${id}.zip`}`;
      a.click(); URL.revokeObjectURL(url);
      return toast('Download started.', 'ok');
    }
    await loadJobs();
    if (openJobId === id) paintDrawer((await api(`/jobs/${id}`)).job);
  } catch (error) { toast(error.message, 'err'); }
});

/* ---------- drawer with full detail + live stream ---------- */
function closeDrawer() {
  openJobId = null;
  streamAbort?.abort(); streamAbort = null;
  $('#drawer').hidden = true; $('#scrim').hidden = true;
}
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

function openJob(id) {
  openJobId = id;
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  $('#drawerBody').innerHTML = '<p class="muted">Loading…</p>';
  streamAbort?.abort();
  const ac = new AbortController(); streamAbort = ac;
  // Live NDJSON: the server sends a fresh snapshot whenever anything changes and closes on a final state.
  (async () => {
    try {
      const res = await fetch(`/api/v1/jobs/${id}/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          try { const msg = JSON.parse(line); if (msg.job) paintDrawer(msg.job); if (msg.type === 'gone') closeDrawer(); } catch { /* heartbeat */ }
        }
      }
    } catch (e) { if (e.name !== 'AbortError') $('#drawerBody').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  })();
  loadJobs();
}

let publishedList = null;
function paintDrawer(job) {
  if (!job || job.id !== openJobId) return;
  const p = job.probe, out = job.output, prog = job.progress || {};
  const stages = ['fetching', 'probing', 'encoding', 'packaging', 'uploading', 'verifying', 'done'];
  const step = Math.max(0, stages.indexOf(job.stage));
  $('#drawerBody').innerHTML = `
    <div class="drawer-head">
      <div style="flex:1"><h2 style="margin:0">${esc(job.options.slug)}</h2>
        <div class="job-meta">${esc(job.source.name)} · ${esc(job.options.preset)} · ${esc(job.options.segmentSec)}s segments · ${esc(job.options.packaging)}</div></div>
      ${statusBadge(job)}<button class="btn sm ghost" data-close>Close</button>
    </div>

    <div class="rungs">${stages.slice(0, -1).map((s, i) => `
      <div class="rung"><span>${esc(s)}</span><span class="bar"><i style="width:${i < step ? 100 : i === step ? Math.max(3, prog.percent || 0) : 0}%"></i></span>
      <span class="size">${i < step ? 'done' : i === step ? `${(prog.percent || 0).toFixed(0)}%` : ''}</span></div>`).join('')}</div>

    ${job.error ? `<div class="err">${esc(job.error.message)}${job.error.hint ? `\n\n${esc(job.error.hint)}` : ''}</div>` : ''}

    <div class="card" style="background:var(--panel-2)">
      <h3>Source</h3>
      <dl class="kv">
        <dt>Type</dt><dd>${esc(job.source.type)}${job.source.key ? ` · ${esc(job.source.key)}` : ''}${job.source.url ? ` · ${esc(job.source.url)}` : ''}</dd>
        ${p ? `<dt>Resolution</dt><dd>${esc(p.display || `${p.width}×${p.height}`)} @${p.fps}fps</dd>
        <dt>Duration</dt><dd>${p.duration ? `${Math.round(p.duration)}s (${secsText(p.duration)})` : 'unknown'}</dd>
        <dt>Codecs</dt><dd>${esc(p.videoCodec || '?')}${p.hasAudio ? ` + ${esc(p.audioCodec || 'audio')}` : ' · no audio'}</dd>
        <dt>Size</dt><dd>${p.size ? bytesText(p.size) : '—'}</dd>` : ''}
      </dl>
    </div>

    ${job.rungs?.length ? `<div class="card" style="background:var(--panel-2)"><h3>Quality ladder</h3>
      <div class="rungs">${job.rungs.map((r) => `<div class="rung"><span>${esc(r.name)}</span><span class="bar"><i style="width:${job.status === 'done' ? 100 : Math.max(2, r.percent || 0)}%"></i></span><span class="size">${esc(r.size || '')} · ${esc(r.vb || '')}${r.ab ? ` + ${esc(r.ab)}` : ''}${r.segments ? ` · ${r.segments} seg` : ''}</span></div>`).join('')}</div></div>` : ''}

    ${out?.masterKey ? `<div class="card" style="background:var(--panel-2)"><h3>In R2</h3>
      <dl class="kv">
        <dt>Master playlist</dt><dd><code>${esc(out.masterKey)}</code></dd>
        <dt>Folder</dt><dd>${esc(out.folder || '')} <button class="btn sm ghost" data-copy="${esc(out.folder || '')}">Copy folder</button></dd>
        <dt>Files</dt><dd>${out.files} (${bytesText(out.bytes || 0)})${out.segments ? ` · ${out.segments} segments` : ''}</dd>
        ${out.publicUrl ? `<dt>Public URL</dt><dd><a href="${esc(out.publicUrl)}" target="_blank" rel="noopener">${esc(out.publicUrl)}</a></dd>` : ''}
      </dl>
      <div class="row" style="margin-top:12px">
        <button class="btn sm" data-copy="${esc(out.masterKey)}">Copy R2 key</button>
        <button class="btn sm ghost" data-copy='{"video":{"source":{"type":"r2","key":"${esc(out.masterKey)}","format":"hls"}}}'>Copy catalog JSON</button>
        <button class="btn sm ghost" data-act="download" data-id="${job.id}">Download ZIP</button>
      </div>
      <p class="small muted" style="margin-top:10px">Paste the key in the Content studio: <b>Videos &amp; reels → Edit → Video source: Private Cloudflare R2</b>. Premium access is a separate switch on the same form.</p>
      ${cfg.site?.configured && !job.published ? `<div class="row" style="margin-top:8px"><select id="pubSel" style="flex:1"><option value="">Publish to a catalog video…</option></select><button class="btn sm" data-publish="${job.id}">Publish</button></div>` : ''}
      ${job.published ? `<p class="small" style="color:#8fe0b1">Published to “${esc(job.published.title || job.published.videoId)}” — the site now streams this HLS package.</p>` : ''}
    </div>` : ''}

    ${job.status === 'done' && !out?.masterKey ? `<div class="note">Encoded locally (no R2 upload). <button class="btn sm" data-act="download" data-id="${job.id}">Download the ZIP</button> and put it in <code>${esc(job.options.r2Prefix)}/${esc(job.options.slug)}/</code> yourself.</div>` : ''}

    <div class="card" style="background:var(--panel-2)">
      <div class="row"><h3 style="flex:1">Log</h3>${prog.speed ? `<span class="muted small">${prog.speed.toFixed(2)}× realtime${prog.fps ? ` · ${prog.fps.toFixed(0)} fps` : ''}${prog.etaSeconds ? ` · ${secsText(prog.etaSeconds)} left` : ''}</span>` : ''}</div>
      <div class="logs">${(job.logs || []).map((l) => `<div class="${esc(l.level)}">${esc(new Date(l.t).toLocaleTimeString())} ${esc(l.message)}</div>`).join('') || '<span class="muted">No log lines yet.</span>'}</div>
      <div class="row" style="margin-top:12px">
        ${job.status === 'running' || job.status === 'queued' ? `<button class="btn sm" data-act="cancel" data-id="${job.id}">Cancel</button>` : ''}
        ${['failed', 'canceled'].includes(job.status) ? `<button class="btn sm" data-act="retry" data-id="${job.id}">Retry</button>` : ''}
        <button class="btn sm danger" data-act="delete" data-id="${job.id}">Delete job</button>
      </div>
    </div>`;

  $('#drawerBody').querySelector('[data-close]').onclick = closeDrawer;
  for (const el of $$('#drawerBody [data-copy]')) el.onclick = async () => { await navigator.clipboard.writeText(el.dataset.copy); toast('Copied.', 'ok'); };
  for (const el of $$('#drawerBody [data-act]')) el.onclick = async () => {
    const id = el.dataset.id, act = el.dataset.act;
    try {
      if (act === 'cancel') { await api(`/jobs/${id}/cancel`, { method: 'POST' }); toast('Canceling…'); }
      if (act === 'retry') { await api(`/jobs/${id}/retry`, { method: 'POST' }); toast('Queued again.', 'ok'); }
      if (act === 'delete') { if (!confirm('Delete this job and its local files? Objects already in R2 stay.')) return; await api(`/jobs/${id}`, { method: 'DELETE', body: {} }); closeDrawer(); toast('Job deleted.'); loadJobs(); }
      if (act === 'download') {
        const res = await fetch(`/api/v1/jobs/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('No local package to download.');
        const blob = await res.blob(); const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${job.options.slug}-hls.zip`; a.click(); URL.revokeObjectURL(a.href);
      }
    } catch (e) { toast(e.message, 'err'); }
  };
  const publishBtn = $('#drawerBody [data-publish]');
  if (publishBtn) {
    // The video list comes from the main ADDABAAZ API (only when APP_API_URL + APP_ADMIN_TOKEN are set).
    (async () => {
      if (!publishedList) publishedList = await api('/site/videos').then((d) => d.videos).catch(() => []);
      const sel = $('#pubSel');
      if (sel) sel.innerHTML = '<option value="">Publish to a catalog video…</option>' + publishedList.map((v) => `<option value="${esc(v.id)}">${esc(v.title)}${v.show ? ` — ${esc(v.show)}` : ''}${v.source?.type === 'r2' ? ' (R2)' : ''}</option>`).join('');
    })();
    publishBtn.onclick = async () => {
      const videoId = $('#pubSel')?.value;
      if (!videoId) return toast('Pick a video first.', 'err');
      try { await api(`/jobs/${job.id}/publish`, { method: 'POST', body: { videoId } }); toast('Published to the catalog.', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    };
  }
}

/* ---------- R2 self-check ---------- */
$('#checkR2').onclick = async () => {
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  openJobId = null; streamAbort?.abort();
  $('#drawerBody').innerHTML = `<div class="drawer-head"><h2 style="flex:1;margin:0">R2 connection</h2><button class="btn sm ghost" data-close>Close</button></div><p class="muted">Uploading a probe file, reading it back and deleting it…</p>`;
  $('#drawerBody').querySelector('[data-close]').onclick = closeDrawer;
  try {
    const out = await api('/r2/check');
    $('#drawerBody').insertAdjacentHTML('beforeend', `
      <div class="card" style="background:var(--panel-2)"><h3>${out.ok ? 'All good' : 'Something is wrong'}</h3>
      <dl class="kv">${out.steps.map((s) => `<dt>${esc(s.name)}</dt><dd>${s.ok ? '✅' : '❌'} ${esc(s.detail)}</dd>`).join('')}</dl>
      <p class="small muted">Bucket: <code>${esc(out.bucket)}</code>. The token needs <b>Object Read &amp; Write</b> on this bucket (Cloudflare → R2 → Manage API tokens).</p></div>`);
  } catch (e) {
    $('#drawerBody').insertAdjacentHTML('beforeend', `<div class="err">${esc(e.message)}</div>`);
  }
};

/* ---------- boot ---------- */
async function boot() {
  cfg = await api('/config');
  health = await fetch('/health').then((r) => r.json()).catch(() => null);
  if (!health) throw new Error('The converter service did not answer /health.');
  fillOptions();
  renderPills();
  await loadJobs();
  updateStart();
}
(async () => {
  if (!token) return showGate();
  try { await boot(); hideGate(); }
  catch (e) {
    if (e.status === 401) return showGate({ message: 'That token was rejected — paste CONVERTER_TOKEN again.' });
    showGate({ message: e.message });
  }
})();
