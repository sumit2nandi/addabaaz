// Admin → System → Database: schema storage, largest tables and MySQL instance health.
import { api } from '../api.js';
import { html, $, icon, badge, empty, pageHead, fmtDT, loadingPage, errMsg } from '../ui.js';

const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
function fmtBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const bytes = Math.max(0, Number(value));
  if (bytes < 1) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), byteUnits.length - 1);
  const digits = unit === 0 ? 0 : bytes / (1024 ** unit) < 10 ? 2 : 1;
  return `${(bytes / (1024 ** unit)).toLocaleString('en-IN', { maximumFractionDigits: digits })} ${byteUnits[unit]}`;
}
const fmtCount = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Math.max(0, Math.trunc(Number(value))).toLocaleString('en-IN');
const fmtPct = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.max(0, Number(value)).toFixed(1)}%`;
const fmtEstimate = (value) => value === null || value === undefined ? '—' : `~${fmtCount(value)}`;
function fmtUptime(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  let seconds = Math.max(0, Math.trunc(Number(value)));
  const days = Math.floor(seconds / 86_400); seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600); seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);
  return [days ? `${days}d` : '', hours || days ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}
const safePct = (value) => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
const meterTone = (value) => Number(value) >= 90 ? 'bad' : Number(value) >= 75 ? 'warn' : '';
const meter = (value, label) => {
  const percent = safePct(value);
  return html`<div class="db-meter ${meterTone(value)}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>`;
};
const fact = (label, value) => html`<div><dt>${label}</dt><dd>${value ?? '—'}</dd></div>`;

function tableList(snapshot, sortBy) {
  const comparators = {
    size: (a, b) => b.totalBytes - a.totalBytes,
    data: (a, b) => b.dataBytes - a.dataBytes,
    indexes: (a, b) => b.indexBytes - a.indexBytes,
    rows: (a, b) => (b.estimatedRows ?? -1) - (a.estimatedRows ?? -1),
  };
  return [...(snapshot.tables || [])].sort((a, b) => comparators[sortBy](a, b) || a.name.localeCompare(b.name));
}

function renderSnapshot(snapshot, sortBy) {
  const storage = snapshot.storage || {};
  const instance = snapshot.instance || {};
  const pool = instance.bufferPool;
  const connections = instance.connections || {};
  const activity = instance.activity || {};
  const rowEstimateTables = Number(storage.rowEstimateTables) || 0;
  const rowsEstimate = rowEstimateTables ? `~${fmtCount(storage.estimatedRows)}` : '—';
  const tableCount = Number(storage.tableCount) || 0;
  const kpi = (label, value, sub, iconName) => html`<article class="stat db-kpi">
    <span class="stat-ic">${icon(iconName, 20)}</span><div><small>${label}</small><strong>${value}</strong><em>${sub}</em></div>
  </article>`;
  const resourceTitle = (name, scope) => html`<div class="card-head"><h2>${name}</h2><span class="badge">${scope}</span></div>`;
  const tables = tableList(snapshot, sortBy);
  const bufferUsage = pool?.usagePct;
  const connectionUsage = connections.usagePct;
  const poolDisplay = pool ? html`
    <div class="db-resource-summary"><strong>${fmtBytes(pool.usedBytes)}</strong><span>used of ${fmtBytes(pool.capacityBytes)}</span></div>
    ${bufferUsage === null || bufferUsage === undefined ? '' : html`${meter(bufferUsage, 'InnoDB buffer-pool use')}<small class="muted">${fmtPct(bufferUsage)} of the configured buffer-pool capacity</small>`}
    <dl class="db-facts">
      ${fact('Free pages', fmtBytes(pool.freeBytes))}
      ${fact('Data pages', fmtBytes(pool.dataBytes))}
      ${fact('Dirty pages', fmtBytes(pool.dirtyBytes))}
      ${fact('Buffer-pool hit rate', fmtPct(pool.hitRatePct))}
    </dl>` : html`<p class="muted small">InnoDB buffer-pool metrics are not available from this MySQL account or server configuration.</p>`;
  const connectionDisplay = html`
    <div class="db-resource-summary"><strong>${fmtCount(connections.connected)}</strong><span>active connections${connections.max !== null && connections.max !== undefined ? ` of ${fmtCount(connections.max)}` : ''}</span></div>
    ${connections.usagePct === null || connections.usagePct === undefined ? '' : html`${meter(connectionUsage, 'MySQL connection capacity')}<small class="muted">${fmtPct(connectionUsage)} of max connections</small>`}
    <dl class="db-facts">
      ${fact('Threads running', fmtCount(connections.running))}
      ${fact('Peak connections', fmtCount(connections.peak))}
      ${fact('Connection limit', fmtCount(connections.max))}
      ${fact('Connections since restart', fmtCount(activity.connectionsSinceStart))}
    </dl>`;
  const activityDisplay = html`
    <dl class="db-facts db-facts-first">
      ${fact('Server uptime', fmtUptime(activity.uptimeSeconds))}
      ${fact('Queries since restart', fmtCount(activity.queriesSinceStart))}
      ${fact('Slow queries', fmtCount(activity.slowQueries))}
      ${fact('Temporary tables', fmtCount(activity.temporaryTables))}
      ${fact('Temporary tables written to disk', fmtCount(activity.diskTemporaryTables))}
    </dl>`;

  return html`
    <div class="stats db-kpis">
      ${kpi('Database storage', fmtBytes(storage.totalBytes), 'Estimated on-disk data + indexes', 'database')}
      ${kpi('Table data', fmtBytes(storage.dataBytes), 'Estimated table-data storage', 'chart')}
      ${kpi('Indexes', fmtBytes(storage.indexBytes), 'Estimated index storage', 'log')}
      ${kpi('Base tables', fmtCount(storage.tableCount), 'Tables in this schema', 'dashboard')}
      ${kpi('Estimated rows', rowsEstimate, `${fmtCount(rowEstimateTables)} of ${fmtCount(tableCount)} tables report a row estimate`, 'users')}
    </div>

    <div class="db-resource-grid">
      <section class="card db-resource-card">
        ${resourceTitle('InnoDB buffer pool', 'Server-wide')}
        <p class="muted small">Shared MySQL memory cache. This is an instance-level RAM metric, not memory used by this schema alone.</p>
        ${poolDisplay}
      </section>
      <section class="card db-resource-card">
        ${resourceTitle('Connections', 'Server-wide')}
        <p class="muted small">Current and peak client connections compared with the MySQL connection limit.</p>
        ${connectionDisplay}
      </section>
      <section class="card db-resource-card">
        ${resourceTitle('MySQL activity', 'Since restart')}
        <p class="muted small">Global counters reset when the MySQL server restarts.</p>
        ${activityDisplay}
      </section>
    </div>

    ${instance.statusAvailable ? '' : html`<div class="db-status-note">${icon('info', 16)} Global MySQL status is unavailable to this database user. Per-schema storage metrics are still shown below.</div>`}
    <section class="card flush db-table-card">
      <div class="card-head db-table-head">
        <div><h2>Largest tables</h2><p class="muted small">Sorted by total data and index storage. Row counts are estimates for InnoDB.</p></div>
        <label class="db-sort"><span class="muted small">Sort by</span><select id="dbSort" aria-label="Sort tables by">
          <option value="size" ${sortBy === 'size' ? 'selected' : ''}>Largest overall</option>
          <option value="data" ${sortBy === 'data' ? 'selected' : ''}>Most data</option>
          <option value="indexes" ${sortBy === 'indexes' ? 'selected' : ''}>Largest indexes</option>
          <option value="rows" ${sortBy === 'rows' ? 'selected' : ''}>Most estimated rows</option>
        </select></label>
      </div>
      ${tables.length ? html`<table class="tbl compact db-tables">
        <thead><tr><th>Table</th><th>Engine</th><th class="num">Est. rows</th><th class="num">Data</th><th class="num">Indexes</th><th class="num">Avg row</th><th class="num">Total</th><th>Schema share</th></tr></thead>
        <tbody>${tables.map((table) => html`<tr>
          <td><code class="db-table-name">${table.name}</code>${table.autoIncrement === null || table.autoIncrement === undefined ? '' : html`<small class="muted">Next ID ${fmtCount(table.autoIncrement)}</small>`}</td>
          <td>${badge(table.engine, String(table.engine).toLowerCase() === 'innodb' ? 'ok' : '')}</td>
          <td class="num">${fmtEstimate(table.estimatedRows)}</td>
          <td class="num">${fmtBytes(table.dataBytes)}</td>
          <td class="num">${fmtBytes(table.indexBytes)}</td>
          <td class="num">${fmtBytes(table.averageRowBytes)}</td>
          <td class="num"><strong>${fmtBytes(table.totalBytes)}</strong></td>
          <td><div class="db-share"><div class="db-share-track" aria-hidden="true"><span style="width:${safePct(table.sharePct)}%"></span></div><small>${fmtPct(table.sharePct)}</small></div></td>
        </tr>`)}</tbody>
      </table>` : empty('No base tables were found in this database schema.')}
    </section>
    <p class="db-footnote">${icon('info', 16)} <span><b>Reading these figures:</b> MySQL reports table sizes and InnoDB row counts as estimates; they are not exact filesystem usage. Schema footprint means data + indexes on disk. Buffer-pool memory, connections and activity counters are shared by the MySQL server and are not attributable to this schema alone.</span></p>
  `.s;
}

export default async function database(root, _params, ctx) {
  let snapshot = null;
  let sortBy = 'size';
  root.innerHTML = html`${pageHead('Database monitoring', 'Monitor this schema’s on-disk size and largest tables, plus MySQL instance memory and health.', html`<button type="button" class="btn" id="dbRefresh">${icon('refresh', 16)} Refresh</button>`)}
    <div class="db-meta" id="dbMeta" role="status" aria-live="polite">Reading live database metrics…</div>
    <div id="dbContent">${loadingPage('database metrics')}</div>`.s;

  const content = $('#dbContent', root);
  const status = $('#dbMeta', root);
  const refresh = $('#dbRefresh', root);
  const wireSort = () => $('#dbSort', content)?.addEventListener('change', (event) => {
    sortBy = ['size', 'data', 'indexes', 'rows'].includes(event.target.value) ? event.target.value : 'size';
    content.innerHTML = renderSnapshot(snapshot, sortBy);
    wireSort();
  });
  const load = async () => {
    refresh.disabled = true;
    refresh.classList.add('busy');
    if (!snapshot) content.innerHTML = loadingPage('database metrics').s;
    status.classList.remove('err');
    status.textContent = snapshot ? `Refreshing · last sample ${fmtDT(snapshot.sampledAt)}` : 'Reading live database metrics…';
    try {
      const next = await api.get('/database/monitor');
      if (ctx.stale()) return;
      snapshot = next;
      content.innerHTML = renderSnapshot(snapshot, sortBy);
      status.textContent = `Schema ${snapshot.schemaName || 'unknown'}${snapshot.serverVersion ? ` · MySQL ${snapshot.serverVersion}` : ''} · Sampled ${fmtDT(snapshot.sampledAt)}`;
      wireSort();
    } catch (error) {
      if (ctx.stale()) return;
      status.textContent = snapshot ? `Refresh failed · showing the last successful sample from ${fmtDT(snapshot.sampledAt)} · ${errMsg(error)}` : `Couldn’t load database metrics · ${errMsg(error)}`;
      status.classList.add('err');
      if (!snapshot) content.innerHTML = html`<section class="card error-card"><h2>Couldn’t read database metrics</h2><p>${errMsg(error)}</p><button type="button" class="btn" id="dbRetry">Try again</button></section>`.s;
      $('#dbRetry', content)?.addEventListener('click', load);
    } finally {
      refresh.disabled = false;
      refresh.classList.remove('busy');
    }
  };
  refresh.addEventListener('click', load);
  await load();
}
