// Admin → System → Database: live schema storage, historical charts and MySQL instance health.
import { api } from '../api.js';
import { lineChart } from '../charts.js';
import { html, $, icon, badge, empty, pageHead, fmtDT, loadingPage, errMsg, confirmBox, toast } from '../ui.js';

const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
const RANGE_OPTIONS = [
  { id: '1h', label: 'Last hour', seconds: 3_600 },
  { id: '6h', label: 'Last 6 hours', seconds: 21_600 },
  { id: '24h', label: 'Last 24 hours', seconds: 86_400 },
  { id: '3d', label: 'Last 3 days', seconds: 259_200 },
  { id: '7d', label: 'Last 7 days', seconds: 604_800 },
  { id: '14d', label: 'Last 14 days', seconds: 1_209_600 },
  { id: '30d', label: 'Last 30 days', seconds: 2_592_000 },
];
const RETENTION_OPTIONS = [1, 3, 7, 14, 30];
const REFRESH_OPTIONS = [0, 15, 30, 60];
const REFRESH_STORAGE_KEY = 'ab.admin.database.refreshSeconds';
const validNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function fmtBytes(value) {
  if (!validNumber(value)) return '—';
  const bytes = Math.max(0, Number(value));
  if (bytes < 1) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), byteUnits.length - 1);
  const digits = unit === 0 ? 0 : bytes / (1024 ** unit) < 10 ? 2 : 1;
  return `${(bytes / (1024 ** unit)).toLocaleString('en-IN', { maximumFractionDigits: digits })} ${byteUnits[unit]}`;
}
const fmtCount = (value) => !validNumber(value) ? '—' : Math.max(0, Math.trunc(Number(value))).toLocaleString('en-IN');
function compactNumber(value, digits = 1) {
  const number = Math.max(0, Number(value));
  for (const [limit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (number >= limit) return `${(number / limit).toLocaleString('en-IN', { maximumFractionDigits: digits })}${suffix}`;
  }
  return number.toLocaleString('en-IN', { maximumFractionDigits: digits });
}
const fmtAxisCount = (value) => !validNumber(value) ? '—' : compactNumber(value);
const fmtPct = (value) => !validNumber(value) ? '—' : `${Math.max(0, Number(value)).toFixed(1)}%`;
const fmtEstimate = (value) => !validNumber(value) ? '—' : `~${fmtCount(value)}`;
const fmtRate = (value) => !validNumber(value) ? '—' : `${compactNumber(value, 2)}/min`;
function fmtUptime(value) {
  if (!validNumber(value)) return '—';
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

const seriesMetric = (key, label, color, format) => ({ key, label, color, format });
function chartPanel({ title, unit, note, points, series, rangeSeconds, formatAxis, zeroBaseline = false }) {
  const latest = [...points].reverse().find((point) => series.some((metric) => validNumber(point[metric.key]))) || {};
  return html`<section class="card db-chart-card">
    <header class="db-chart-head"><div><h3>${title}</h3>${note ? html`<p class="muted small">${note}</p>` : ''}</div><span class="db-chart-unit">${unit}</span></header>
    ${lineChart(points, series, { rangeSeconds, formatAxis, zeroBaseline, label: `${title} over time` })}
    <div class="db-chart-legend" aria-label="${title} series">${series.map((metric) => html`<span class="db-chart-legend-item">
      <i class="db-chart-swatch ${metric.color}" aria-hidden="true"></i><span>${metric.label}</span><strong>${metric.format(latest[metric.key])}</strong>
    </span>`)}</div>
  </section>`;
}

function renderCharts(snapshot) {
  const points = Array.isArray(snapshot.history) ? snapshot.history : [];
  const rangeSeconds = Number(snapshot.rangeSeconds) || 604_800;
  return html`<section class="db-history-section">
    <div class="db-section-heading"><div><h2>Historical metrics</h2><p class="muted small">One-minute samples, grouped for chart readability. Gauges show bucket averages; activity shows per-minute rates.</p></div><span class="badge">${fmtCount(points.length)} chart buckets</span></div>
    ${points.length ? html`<div class="db-chart-grid">
      ${chartPanel({ title: 'Schema storage', unit: 'Bytes · on disk', note: 'Data, indexes and their combined footprint.', points, rangeSeconds,
        formatAxis: fmtBytes, series: [
          seriesMetric('dataBytes', 'Data', 'blue', fmtBytes),
          seriesMetric('indexBytes', 'Indexes', 'gold', fmtBytes),
          seriesMetric('totalStorageBytes', 'Total', 'green', fmtBytes),
        ] })}
      ${chartPanel({ title: 'InnoDB buffer pool', unit: 'Bytes · server-wide RAM', note: 'Shared MySQL cache; not memory attributable to this schema.', points, rangeSeconds,
        formatAxis: fmtBytes, series: [
          seriesMetric('bufferPoolUsedBytes', 'Used', 'blue', fmtBytes),
          seriesMetric('bufferPoolCapacityBytes', 'Capacity', 'gold', fmtBytes),
        ] })}
      ${chartPanel({ title: 'Connections', unit: 'Connections', note: 'Current and running threads against the configured connection limit.', points, rangeSeconds,
        formatAxis: fmtAxisCount, zeroBaseline: true, series: [
          seriesMetric('connectionsCurrent', 'Connected', 'blue', fmtCount),
          seriesMetric('connectionsRunning', 'Running', 'gold', fmtCount),
          seriesMetric('connectionsMax', 'Limit', 'red', fmtCount),
        ] })}
      ${chartPanel({ title: 'SQL activity', unit: 'Operations / minute', note: 'Rates derived from global MySQL counters; counters reset on server restart.', points, rangeSeconds,
        formatAxis: fmtRate, zeroBaseline: true, series: [
          seriesMetric('queriesPerMinute', 'Queries', 'blue', fmtRate),
          seriesMetric('slowQueriesPerMinute', 'Slow queries', 'red', fmtRate),
          seriesMetric('diskTempTablesPerMinute', 'Disk temp tables', 'gold', fmtRate),
        ] })}
      ${chartPanel({ title: 'Estimated rows', unit: 'Rows · schema-wide', note: 'InnoDB table row estimates; null estimates are excluded.', points, rangeSeconds,
        formatAxis: fmtAxisCount, series: [seriesMetric('estimatedRows', 'Rows', 'purple', fmtEstimate)] })}
      ${chartPanel({ title: 'Buffer-pool hit rate', unit: 'Percent · server-wide', note: 'Cumulative MySQL buffer-pool hit ratio since restart.', points, rangeSeconds,
        formatAxis: fmtPct, series: [seriesMetric('bufferPoolHitRatePct', 'Hit rate', 'green', fmtPct)] })}
    </div>` : html`<div class="card db-history-empty" role="status">
      <span class="db-history-empty-icon">${icon('chart', 24)}</span><div><h3>History is starting to collect</h3>
        <p class="muted">The server saves one database sample per minute. Historical lines will appear as samples accumulate; the live snapshot above is already available.</p></div>
    </div>`}
  </section>`;
}

function renderSnapshot(snapshot, state) {
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
  const tables = tableList(snapshot, state.sortBy);
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
  const retentionDays = RETENTION_OPTIONS.includes(Number(snapshot.retentionDays)) ? Number(snapshot.retentionDays) : 7;
  const rangeOptions = RANGE_OPTIONS.map((range) => html`<option value="${range.id}" ${range.id === state.range ? 'selected' : ''} ${range.seconds > retentionDays * 86_400 ? 'disabled' : ''}>${range.label}</option>`);
  const retentionOptions = RETENTION_OPTIONS.map((days) => html`<option value="${days}" ${days === retentionDays ? 'selected' : ''}>${days} ${days === 1 ? 'day' : 'days'}</option>`);
  const refreshOptions = REFRESH_OPTIONS.map((seconds) => html`<option value="${seconds}" ${seconds === state.refreshSeconds ? 'selected' : ''}>${seconds ? `Every ${seconds} seconds` : 'Off'}</option>`);

  return html`
    <div class="db-monitor-toolbar card" aria-label="History and refresh controls">
      <label class="db-monitor-control"><span>History window</span><select id="dbRange" aria-label="History window">${rangeOptions}</select><small>Up to ${retentionDays} days retained</small></label>
      <label class="db-monitor-control"><span>Keep history</span><select id="dbRetention" aria-label="History retention">${retentionOptions}</select><small>Older samples are pruned automatically</small></label>
      <label class="db-monitor-control"><span>Auto-refresh</span><select id="dbAutoRefresh" aria-label="Chart auto-refresh interval">${refreshOptions}</select><small>Refreshes the live snapshot and charts</small></label>
    </div>

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
    ${renderCharts(snapshot)}
    <section class="card flush db-table-card">
      <div class="card-head db-table-head">
        <div><h2>Largest tables</h2><p class="muted small">Sorted by total data and index storage. Row counts are estimates for InnoDB.</p></div>
        <label class="db-sort"><span class="muted small">Sort by</span><select id="dbSort" aria-label="Sort tables by">
          <option value="size" ${state.sortBy === 'size' ? 'selected' : ''}>Largest overall</option>
          <option value="data" ${state.sortBy === 'data' ? 'selected' : ''}>Most data</option>
          <option value="indexes" ${state.sortBy === 'indexes' ? 'selected' : ''}>Largest indexes</option>
          <option value="rows" ${state.sortBy === 'rows' ? 'selected' : ''}>Most estimated rows</option>
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

function storedRefreshSeconds() {
  try {
    const stored = globalThis.localStorage?.getItem(REFRESH_STORAGE_KEY);
    if (stored === null || stored === undefined || stored === '') return 30;
    const value = Number(stored);
    return REFRESH_OPTIONS.includes(value) ? value : 30;
  } catch { return 30; }
}
function saveRefreshSeconds(value) {
  try { globalThis.localStorage?.setItem(REFRESH_STORAGE_KEY, String(value)); } catch { /* browser storage can be disabled */ }
}

export default async function database(root, _params, ctx) {
  const state = { snapshot: null, sortBy: 'size', range: '7d', refreshSeconds: storedRefreshSeconds() };
  let pending = false;
  let queuedLoad = false;
  let timer = null;
  root.innerHTML = html`${pageHead('Database monitoring', 'Explore historical trends for this schema and the shared MySQL instance, alongside the live snapshot.', html`<button type="button" class="btn" id="dbRefresh">${icon('refresh', 16)} Refresh</button>`)}
    <div class="db-meta" id="dbMeta" role="status" aria-live="polite">Reading live database metrics…</div>
    <div id="dbContent">${loadingPage('database metrics')}</div>`.s;

  const content = $('#dbContent', root);
  const status = $('#dbMeta', root);
  const refresh = $('#dbRefresh', root);
  const loadedStatus = () => {
    const snapshot = state.snapshot;
    if (!snapshot) return 'Reading live database metrics…';
    const refreshText = state.refreshSeconds ? `Auto-refresh every ${state.refreshSeconds}s` : 'Auto-refresh off';
    const historyCount = Array.isArray(snapshot.history) ? snapshot.history.length : 0;
    return `Schema ${snapshot.schemaName || 'unknown'}${snapshot.serverVersion ? ` · MySQL ${snapshot.serverVersion}` : ''} · Sampled ${fmtDT(snapshot.sampledAt)} · ${historyCount.toLocaleString('en-IN')} chart buckets · ${refreshText}`;
  };
  const scheduleRefresh = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (!state.refreshSeconds) return;
    timer = setInterval(() => {
      if (ctx.stale()) { clearInterval(timer); timer = null; return; }
      void load();
    }, state.refreshSeconds * 1000);
  };
  const wireControls = () => {
    $('#dbSort', content)?.addEventListener('change', (event) => {
      state.sortBy = ['size', 'data', 'indexes', 'rows'].includes(event.target.value) ? event.target.value : 'size';
      content.innerHTML = renderSnapshot(state.snapshot, state);
      wireControls();
    });
    $('#dbRange', content)?.addEventListener('change', (event) => {
      if (!RANGE_OPTIONS.some((range) => range.id === event.target.value)) return;
      state.range = event.target.value;
      void load({ queue: true });
    });
    $('#dbAutoRefresh', content)?.addEventListener('change', (event) => {
      const seconds = Number(event.target.value);
      if (!REFRESH_OPTIONS.includes(seconds)) return;
      state.refreshSeconds = seconds;
      saveRefreshSeconds(seconds);
      scheduleRefresh();
      status.textContent = loadedStatus();
    });
    $('#dbRetention', content)?.addEventListener('change', async (event) => {
      const days = Number(event.target.value);
      const previous = Number(state.snapshot?.retentionDays) || 7;
      if (!RETENTION_OPTIONS.includes(days) || days === previous) return;
      const lowersRetention = days < previous;
      const confirmed = await confirmBox({
        title: 'Change database history retention?',
        text: lowersRetention
          ? `Samples older than ${days} ${days === 1 ? 'day' : 'days'} will be permanently deleted.`
          : `New samples will be kept for ${days} days. History already removed under the previous retention period cannot be restored.`,
        confirm: 'Apply retention', danger: lowersRetention,
      });
      if (!confirmed || ctx.stale()) { event.target.value = String(previous); return; }
      try {
        await api.patch('/database/monitor/settings', { retentionDays: days });
        const maxRange = days * 86_400;
        if ((RANGE_OPTIONS.find((range) => range.id === state.range)?.seconds || 0) > maxRange) {
          state.range = [...RANGE_OPTIONS].reverse().find((range) => range.seconds <= maxRange)?.id || '1h';
        }
        await load({ queue: true });
        toast(`Database history will be retained for ${days} ${days === 1 ? 'day' : 'days'}.`);
      } catch (error) {
        if (ctx.stale()) return;
        toast(errMsg(error), 'err');
        event.target.value = String(previous);
      }
    });
  };
  async function load({ queue = false } = {}) {
    if (pending) { if (queue) queuedLoad = true; return; }
    if (ctx.stale()) return;
    pending = true;
    const requestedRange = state.range;
    refresh.disabled = true;
    refresh.classList.add('busy');
    if (!state.snapshot) content.innerHTML = loadingPage('database metrics').s;
    status.classList.remove('err');
    status.textContent = state.snapshot ? `Refreshing · last sample ${fmtDT(state.snapshot.sampledAt)}` : 'Reading live database metrics…';
    try {
      const next = await api.get(`/database/monitor?range=${encodeURIComponent(state.range)}`);
      if (ctx.stale()) return;
      state.snapshot = next;
      if (state.range === requestedRange && RANGE_OPTIONS.some((range) => range.id === next.range)) state.range = next.range;
      else if (state.range !== requestedRange) queuedLoad = true;
      content.innerHTML = renderSnapshot(next, state);
      status.textContent = loadedStatus();
      wireControls();
    } catch (error) {
      if (ctx.stale()) return;
      status.textContent = state.snapshot ? `Refresh failed · showing the last successful sample from ${fmtDT(state.snapshot.sampledAt)} · ${errMsg(error)}` : `Couldn’t load database metrics · ${errMsg(error)}`;
      status.classList.add('err');
      if (!state.snapshot) content.innerHTML = html`<section class="card error-card"><h2>Couldn’t load database metrics</h2><p>${errMsg(error)}</p><button type="button" class="btn" id="dbRetry">Try again</button></section>`.s;
      $('#dbRetry', content)?.addEventListener('click', load);
    } finally {
      pending = false;
      refresh.disabled = false;
      refresh.classList.remove('busy');
      if (queuedLoad) {
        queuedLoad = false;
        if (!ctx.stale()) queueMicrotask(() => { void load(); });
      }
    }
  }
  refresh.addEventListener('click', () => { void load({ queue: true }); });
  scheduleRefresh();
  await load();
}
