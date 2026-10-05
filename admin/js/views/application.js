// Admin → System → Application: per-process runtime health and aggregate API performance history.
import { api } from '../api.js';
import { lineChart } from '../charts.js';
import { html, $, icon, pageHead, fmtDT, loadingPage, errMsg, confirmBox, toast } from '../ui.js';

const RANGES = [
  { id: '1h', label: 'Last hour', seconds: 3_600 },
  { id: '6h', label: 'Last 6 hours', seconds: 21_600 },
  { id: '24h', label: 'Last 24 hours', seconds: 86_400 },
  { id: '3d', label: 'Last 3 days', seconds: 259_200 },
  { id: '7d', label: 'Last 7 days', seconds: 604_800 },
  { id: '14d', label: 'Last 14 days', seconds: 1_209_600 },
  { id: '30d', label: 'Last 30 days', seconds: 2_592_000 },
];
const RETENTION = [1, 3, 7, 14, 30];
const REFRESH = [0, 15, 30, 60];
const REFRESH_KEY = 'ab.admin.application.refreshSeconds';
const valid = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const count = (value) => valid(value) ? Math.max(0, Math.trunc(Number(value))).toLocaleString('en-IN') : '—';
const compact = (value) => {
  const number = Math.max(0, Number(value));
  for (const [limit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (number >= limit) return `${(number / limit).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}`;
  }
  return number.toLocaleString('en-IN', { maximumFractionDigits: 1 });
};
const percent = (value) => valid(value) ? `${Math.max(0, Number(value)).toFixed(1)}%` : '—';
const milliseconds = (value) => valid(value) ? `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ms` : '—';
const rate = (value) => valid(value) ? `${compact(value)}/min` : '—';
const bytes = (value) => {
  if (!valid(value)) return '—';
  const n = Math.max(0, Number(value));
  if (n < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unit = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const size = n / (1024 ** unit);
  return `${size.toLocaleString('en-IN', { maximumFractionDigits: unit === 0 ? 0 : size < 10 ? 2 : 1 })} ${units[unit]}`;
};
function uptime(value) {
  if (!valid(value)) return '—';
  let seconds = Math.max(0, Math.trunc(Number(value)));
  const days = Math.floor(seconds / 86_400); seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600); seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);
  return [days ? `${days}d` : '', hours || days ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}
const metric = (key, label, color, format) => ({ key, label, color, format });
function chartCard({ title, unit, note, points, series, rangeSeconds, axisFormat, zeroBaseline = false }) {
  const latest = [...points].reverse().find((point) => series.some((item) => valid(point[item.key]))) || {};
  return html`<section class="card db-chart-card appmon-chart-card">
    <header class="db-chart-head"><div><h3>${title}</h3>${note ? html`<p class="muted small">${note}</p>` : ''}</div><span class="db-chart-unit">${unit}</span></header>
    ${lineChart(points, series, { rangeSeconds, formatAxis: axisFormat, zeroBaseline, label: `${title} over time` })}
    <div class="db-chart-legend" aria-label="${title} series">${series.map((item) => html`<span class="db-chart-legend-item">
      <i class="db-chart-swatch ${item.color}" aria-hidden="true"></i><span>${item.label}</span><strong>${item.format(latest[item.key])}</strong>
    </span>`)}</div>
  </section>`;
}

function renderHistory(data) {
  const points = Array.isArray(data.history) ? data.history : [];
  const rangeSeconds = Number(data.rangeSeconds) || 604_800;
  return html`<section class="db-history-section">
    <div class="db-section-heading"><div><h2>Application history</h2><p class="muted small">Minute samples from active app processes. Memory is summed across instances; CPU is averaged per process.</p></div>
      <span class="badge">${count(points.length)} chart buckets</span></div>
    ${points.length ? html`<div class="db-chart-grid appmon-chart-grid">
      ${chartCard({ title: 'Process CPU', unit: '% of one core', note: 'Mean CPU usage across app processes; a busy process may exceed 100%.', points, rangeSeconds,
        axisFormat: percent, series: [metric('cpuPercent', 'CPU', 'blue', percent)] })}
      ${chartCard({ title: 'Application memory', unit: 'Bytes · all active instances', note: 'Resident set size and Node.js heap totals, summed across processes.', points, rangeSeconds,
        axisFormat: bytes, series: [metric('memoryRssBytes', 'RSS', 'blue', bytes), metric('heapUsedBytes', 'Heap used', 'gold', bytes), metric('heapTotalBytes', 'Heap total', 'green', bytes)] })}
      ${chartCard({ title: 'API throughput', unit: 'Requests / minute', note: 'API requests per minute; health/status probes, monitor polls and video gateway streams are excluded.', points, rangeSeconds,
        axisFormat: rate, zeroBaseline: true, series: [metric('requestsPerMinute', 'Requests', 'blue', rate)] })}
      ${chartCard({ title: 'Response latency', unit: 'Milliseconds', note: 'Request-weighted average; p95 is the highest sampled per-process p95 in each bucket.', points, rangeSeconds,
        axisFormat: milliseconds, series: [metric('responseAverageMs', 'Average', 'blue', milliseconds), metric('responseP95Ms', 'Worst process p95', 'red', milliseconds)] })}
      ${chartCard({ title: 'HTTP errors', unit: 'Error responses / minute', note: '4xx client responses and 5xx server responses, aggregated across instances.', points, rangeSeconds,
        axisFormat: rate, zeroBaseline: true, series: [metric('clientErrorsPerMinute', '4xx responses', 'gold', rate), metric('serverErrorsPerMinute', '5xx responses', 'red', rate)] })}
      ${chartCard({ title: 'System load', unit: 'Load average', note: 'Host-level one-minute load average reported by the operating system.', points, rangeSeconds,
        axisFormat: (value) => valid(value) ? compact(value) : '—', zeroBaseline: true, series: [metric('load1', 'Load · 1 minute', 'purple', (value) => valid(value) ? Number(value).toFixed(2) : '—')] })}
    </div>` : html`<div class="card db-history-empty" role="status">
      <span class="db-history-empty-icon">${icon('chart', 24)}</span><div><h3>Application history is starting to collect</h3>
        <p class="muted">The server records process and API performance samples once per minute. Historical charts will appear as samples accumulate; the current instance snapshot is available above.</p></div>
    </div>`}
  </section>`;
}

function render(data, state) {
  const current = data.current || {};
  const memory = current.memory || {};
  const system = current.system || {};
  const http = current.http || {};
  const points = Array.isArray(data.history) ? data.history : [];
  const retentionDays = RETENTION.includes(Number(data.retentionDays)) ? Number(data.retentionDays) : 7;
  const rangeOptions = RANGES.map((item) => html`<option value="${item.id}" ${item.id === state.range ? 'selected' : ''} ${item.seconds > retentionDays * 86_400 ? 'disabled' : ''}>${item.label}</option>`);
  const retentionOptions = RETENTION.map((days) => html`<option value="${days}" ${days === retentionDays ? 'selected' : ''}>${days} ${days === 1 ? 'day' : 'days'}</option>`);
  const refreshOptions = REFRESH.map((seconds) => html`<option value="${seconds}" ${seconds === state.refreshSeconds ? 'selected' : ''}>${seconds ? `Every ${seconds} seconds` : 'Off'}</option>`);
  const kpi = (label, value, sub, iconName) => html`<article class="stat db-kpi appmon-kpi"><span class="stat-ic">${icon(iconName, 20)}</span><div><small>${label}</small><strong>${value}</strong><em>${sub}</em></div></article>`;
  const serverRate = points.at(-1)?.serverErrorRatePct;
  const activeInstances = points.at(-1)?.activeInstances;

  return html`
    <div class="db-monitor-toolbar card" aria-label="Application history and refresh controls">
      <label class="db-monitor-control"><span>History window</span><select id="appmonRange" aria-label="Application history window">${rangeOptions}</select><small>Up to ${retentionDays} days retained</small></label>
      <label class="db-monitor-control"><span>Keep history</span><select id="appmonRetention" aria-label="Application history retention">${retentionOptions}</select><small>Older samples are pruned automatically</small></label>
      <label class="db-monitor-control"><span>Auto-refresh</span><select id="appmonRefresh" aria-label="Application auto-refresh interval">${refreshOptions}</select><small>Refreshes this instance and the charts</small></label>
    </div>
    <div class="appmon-instance-note"><span class="badge">This instance</span><span>Process uptime ${uptime(current.uptimeSeconds)} · ${count(current.processors)} available CPU core${Number(current.processors) === 1 ? '' : 's'} · current request window ${valid(http.intervalSeconds) ? `${Number(http.intervalSeconds).toFixed(0)}s` : '—'}${valid(activeInstances) ? ` · ${count(activeInstances)} process${Number(activeInstances) === 1 ? '' : 'es'} sampled in latest bucket` : ''}</span></div>
    <div class="stats db-kpis appmon-kpis">
      ${kpi('Process CPU', percent(current.cpuPercent), 'Share of one CPU core', 'chart')}
      ${kpi('Resident memory', bytes(memory.rssBytes), 'Process RSS', 'database')}
      ${kpi('Node heap', bytes(memory.heapUsedBytes), `of ${bytes(memory.heapTotalBytes)} allocated`, 'chart')}
      ${kpi('API throughput', rate(http.requestsPerMinute), `${count(http.requests)} requests in this window`, 'inbox')}
      ${kpi('Average response', milliseconds(http.averageResponseMs), 'API response time', 'clock')}
      ${kpi('P95 response', milliseconds(http.p95ResponseMs), 'Approximate latency percentile', 'clock')}
      ${kpi('5xx error rate', percent(http.serverErrorRatePct), `${count(http.serverErrors)} server errors in this window${valid(serverRate) ? ` · ${percent(serverRate)} in latest history` : ''}`, 'bug')}
    </div>
    <div class="appmon-detail-strip">
      <span><b>API requests:</b> ${count(http.requests)} · ${count(http.clientErrors)} 4xx · ${count(http.serverErrors)} 5xx</span>
      <span><b>Response range:</b> p50 ${milliseconds(http.p50ResponseMs)} · max ${milliseconds(http.maxResponseMs)}</span>
      <span><b>Host load:</b> ${valid(system.load1) ? Number(system.load1).toFixed(2) : '—'} (1m) · ${valid(system.load5) ? Number(system.load5).toFixed(2) : '—'} (5m)</span>
    </div>
    ${renderHistory(data)}
    <p class="db-footnote">${icon('info', 16)} <span>CPU and memory cards show the server process handling this page request. Historical charts combine all sampled app instances; total memory and HTTP traffic are summed, CPU is averaged. Request paths and user data are not stored. Response p50/p95 values are histogram estimates.</span></p>
  `.s;
}

function storedRefresh() {
  try {
    const stored = globalThis.localStorage?.getItem(REFRESH_KEY);
    if (stored === null || stored === undefined || stored === '') return 30;
    const value = Number(stored);
    return REFRESH.includes(value) ? value : 30;
  } catch { return 30; }
}
function saveRefresh(value) {
  try { globalThis.localStorage?.setItem(REFRESH_KEY, String(value)); } catch { /* storage may be disabled */ }
}

export default async function application(root, _params, ctx) {
  const state = { data: null, range: '7d', refreshSeconds: storedRefresh() };
  let pending = false, queuedLoad = false, timer = null;
  root.innerHTML = html`${pageHead('Application monitoring', 'Track Node.js process health and API performance across running app instances.', html`<button type="button" class="btn" id="appmonRefreshNow">${icon('refresh', 16)} Refresh</button>`)}
    <div class="db-meta" id="appmonMeta" role="status" aria-live="polite">Reading application metrics…</div>
    <div id="appmonContent">${loadingPage('application metrics')}</div>`.s;
  const content = $('#appmonContent', root);
  const status = $('#appmonMeta', root);
  const refreshButton = $('#appmonRefreshNow', root);
  const loadedStatus = () => {
    if (!state.data) return 'Reading application metrics…';
    const buckets = Array.isArray(state.data.history) ? state.data.history.length : 0;
    const auto = state.refreshSeconds ? `Auto-refresh every ${state.refreshSeconds}s` : 'Auto-refresh off';
    return `This process sampled ${fmtDT(state.data.current?.sampledAt)} · ${count(buckets)} chart buckets · ${auto}`;
  };
  const schedule = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (!state.refreshSeconds) return;
    timer = setInterval(() => {
      if (ctx.stale()) { clearInterval(timer); timer = null; return; }
      void load();
    }, state.refreshSeconds * 1000);
  };
  const wireControls = () => {
    $('#appmonRange', content)?.addEventListener('change', (event) => {
      if (!RANGES.some((item) => item.id === event.target.value)) return;
      state.range = event.target.value;
      void load({ queue: true });
    });
    $('#appmonRefresh', content)?.addEventListener('change', (event) => {
      const seconds = Number(event.target.value);
      if (!REFRESH.includes(seconds)) return;
      state.refreshSeconds = seconds;
      saveRefresh(seconds);
      schedule();
      status.textContent = loadedStatus();
    });
    $('#appmonRetention', content)?.addEventListener('change', async (event) => {
      const days = Number(event.target.value);
      const previous = Number(state.data?.retentionDays) || 7;
      if (!RETENTION.includes(days) || days === previous) return;
      const confirmed = await confirmBox({
        title: 'Change application history retention?',
        text: days < previous
          ? `Samples older than ${days} ${days === 1 ? 'day' : 'days'} will be permanently deleted.`
          : `New samples will be kept for ${days} days. History already removed under the previous setting cannot be restored.`,
        confirm: 'Apply retention', danger: days < previous,
      });
      if (!confirmed || ctx.stale()) { event.target.value = String(previous); return; }
      try {
        await api.patch('/application/monitor/settings', { retentionDays: days });
        const maxRange = days * 86_400;
        if ((RANGES.find((item) => item.id === state.range)?.seconds || 0) > maxRange) {
          state.range = [...RANGES].reverse().find((item) => item.seconds <= maxRange)?.id || '1h';
        }
        await load({ queue: true });
        toast(`Application history will be retained for ${days} ${days === 1 ? 'day' : 'days'}.`);
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
    refreshButton.disabled = true;
    refreshButton.classList.add('busy');
    if (!state.data) content.innerHTML = loadingPage('application metrics').s;
    status.classList.remove('err');
    status.textContent = state.data ? `Refreshing · current process snapshot ${fmtDT(state.data.current?.sampledAt)}` : 'Reading application metrics…';
    try {
      const next = await api.get(`/application/monitor?range=${encodeURIComponent(state.range)}`);
      if (ctx.stale()) return;
      state.data = next;
      if (state.range === requestedRange && RANGES.some((item) => item.id === next.range)) state.range = next.range;
      else if (state.range !== requestedRange) queuedLoad = true;
      content.innerHTML = render(next, state);
      status.textContent = loadedStatus();
      wireControls();
    } catch (error) {
      if (ctx.stale()) return;
      status.textContent = state.data ? `Refresh failed · showing the last successful sample · ${errMsg(error)}` : `Couldn’t load application metrics · ${errMsg(error)}`;
      status.classList.add('err');
      if (!state.data) content.innerHTML = html`<section class="card error-card"><h2>Couldn’t load application metrics</h2><p>${errMsg(error)}</p><button type="button" class="btn" id="appmonRetry">Try again</button></section>`.s;
      $('#appmonRetry', content)?.addEventListener('click', () => { void load({ queue: true }); });
    } finally {
      pending = false;
      refreshButton.disabled = false;
      refreshButton.classList.remove('busy');
      if (queuedLoad) {
        queuedLoad = false;
        if (!ctx.stale()) queueMicrotask(() => { void load(); });
      }
    }
  }
  refreshButton.addEventListener('click', () => { void load({ queue: true }); });
  schedule();
  await load();
}
