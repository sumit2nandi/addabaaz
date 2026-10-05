// Browser, mobile, playback and server failures with searchable context and copyable diagnostics.
import { api } from '../api.js';
import { empty, html, $, $$, badge, icon, pageHead, confirmBox, toast, errMsg, ago, fmtDT, pager, debounce, loadingTable } from '../ui.js';

const LIMIT = 50;
const SOURCES = [['', 'All sources'], ['client', 'Browser & mobile'], ['server', 'Server']];
const display = (value, fallback = '—') => value === null || value === undefined || value === '' ? fallback
  : typeof value === 'object' ? JSON.stringify(value) : String(value);
const sourceLabel = (source) => source === 'client' ? 'Browser / mobile' : source === 'server' ? 'Server' : source || 'Unknown';
const methodLabel = (source) => source === 'client' ? 'Report method' : 'HTTP method';
const requestIdLabel = (source) => source === 'client' ? 'Report request ID' : 'Request ID';
const urlLabel = (source) => source === 'client' ? 'Page route' : 'Request URL';
const severityTone = (severity) => severity === 'fatal' || severity === 'error' ? 'bad' : severity === 'warning' ? 'gold' : '';
const statusTone = (status) => Number(status) >= 500 ? 'bad' : Number(status) >= 400 ? 'gold' : '';
const pretty = (value) => { try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ''); } };

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* try the selection-based fallback below */ }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' });
  document.body.append(field);
  let copied = false;
  try {
    field.focus(); field.select(); field.setSelectionRange(0, field.value.length);
    copied = document.execCommand?.('copy') === true;
  } finally { field.remove(); }
  if (!copied) throw new Error('Clipboard copy is not available.');
}

const errorText = (e) => [
  `ADDABAAZ error report #${e.id}`,
  `When: ${fmtDT(e.at)}`,
  `Source: ${sourceLabel(e.source)}`,
  `Severity: ${e.severity || 'error'}`,
  `Error: ${e.errorName || 'Error'}${e.errorCode ? ` · ${e.errorCode}` : ''}`,
  `Message: ${e.message}`,
  `HTTP status: ${display(e.status)}`,
  `${methodLabel(e.source)}: ${display(e.method)}`,
  `${requestIdLabel(e.source)}: ${display(e.requestId)}`,
  `Release: ${display(e.release)}`,
  `Environment: ${display(e.environment)}`,
  `Instance: ${display(e.instanceId)}`,
  `User ID: ${e.userId || 'unknown / anonymous'}`,
  `Account name: ${e.accountName || '(not available)'}`,
  `Account email: ${e.accountEmail || '(not available)'}`,
  `${urlLabel(e.source)}: ${e.url || '(not recorded)'}`,
  `User agent: ${e.userAgent || '(not recorded)'}`,
  ...(e.details ? ['Diagnostic context:', pretty(e.details)] : []),
  ...(e.sqlQuery ? [`SQL template (bound values omitted; ${e.sqlParamCount ?? 'unknown'} parameter(s)):`, e.sqlQuery] : []),
  ...(e.sqlException ? ['SQL exception:', pretty(e.sqlException)] : []),
  'Stack:', e.stack || 'No stack trace.',
].join('\n');

function detail(label, value, fallback = '—') {
  if (value === null || value === undefined || value === '') return '';
  return html`<div class="error-runtime-item"><span>${label}</span><strong>${display(value, fallback)}</strong></div>`;
}

function renderClientContext(error) {
  const client = error.details?.client;
  if (!client || typeof client !== 'object' || Array.isArray(client)) return '';
  const viewport = client.viewport && typeof client.viewport === 'object' ? client.viewport : {};
  const screen = client.screen && typeof client.screen === 'object' ? client.screen : {};
  const network = client.network && typeof client.network === 'object' ? client.network : {};
  const viewportLabel = [viewport.width && `${viewport.width}×${viewport.height || '?'}`, viewport.pixelRatio && `${viewport.pixelRatio}× pixel ratio`].filter(Boolean).join(' · ');
  const screenLabel = [screen.width && `${screen.width}×${screen.height || '?'}`, screen.orientation].filter(Boolean).join(' · ');
  const networkLabel = [network.type, network.effectiveType, network.downlinkMbps != null && `${network.downlinkMbps} Mbps`, network.rttMs != null && `${network.rttMs} ms RTT`, network.saveData === true && 'data saver'].filter(Boolean).join(' · ');
  return html`<section class="error-diagnostics">
    <h3>Client diagnostics</h3>
    <div class="error-runtime-grid">
      ${detail('Captured at', client.where)}
      ${detail('App version', client.version)}
      ${detail('Runtime', [client.runtime, client.platform].filter(Boolean).join(' · '))}
      ${detail('App state', client.appState)}
      ${detail('Online', typeof client.online === 'boolean' ? (client.online ? 'Yes' : 'No') : null)}
      ${detail('Visibility', client.visibility)}
      ${detail('Viewport', viewportLabel)}
      ${detail('Screen', screenLabel)}
      ${detail('Network', networkLabel)}
      ${detail('Hardware threads', client.hardwareConcurrency)}
      ${detail('Device memory', client.deviceMemoryGiB != null ? `${client.deviceMemoryGiB} GiB` : null)}
      ${detail('Locale / timezone', [client.language, client.timezone].filter(Boolean).join(' · '))}
      ${detail('Color scheme', client.colorScheme)}
      ${detail('Browser user agent', client.userAgent || error.userAgent)}
    </div>
  </section>`;
}

function renderGroups(groups) {
  return groups.length ? html`<div class="card flush"><table class="tbl compact error-groups"><thead><tr><th>Repeated error</th><th>Source / status</th><th class="num">Times</th><th>Last seen</th></tr></thead><tbody>
    ${groups.map((group) => html`<tr>
      <td class="error-group-message"><strong>${group.errorName || 'Error'}</strong> ${group.errorCode ? html`<code>${group.errorCode}</code>` : ''}<div>${group.message}</div></td>
      <td class="small">${badge(sourceLabel(group.source), group.source === 'server' ? 'bad' : '')}${group.severity ? html` ${badge(group.severity, severityTone(group.severity))}` : ''}${group.status != null ? html` ${badge(`HTTP ${group.status}`, statusTone(group.status))}` : ''}<div class="muted error-group-url">${group.url || '(no page recorded)'}</div></td>
      <td class="num">${Number(group.count || 0).toLocaleString('en-IN')}</td>
      <td class="small nowrap" title="${fmtDT(group.lastAt)}">${ago(group.lastAt)}</td>
    </tr>`)}</tbody></table></div>` : empty('No matching errors were reported in the last 7 days.');
}

function renderRecent(error) {
  const source = sourceLabel(error.source);
  const status = error.status == null ? '' : `HTTP ${error.status}`;
  return html`<details class="card error-entry">
    <summary>
      <span class="error-entry-badges">${badge(source, error.source === 'server' ? 'bad' : '')}${badge(error.severity || 'error', severityTone(error.severity))}${status ? badge(status, statusTone(error.status)) : ''}</span>
      <strong class="error-entry-message">${error.message}</strong>
      <span class="muted small error-entry-subtitle">${error.errorName || 'Error'}${error.errorCode ? ` · ${error.errorCode}` : ''}${error.url ? ` · ${error.url}` : ''} · ${ago(error.at)}</span>
    </summary>
    <div class="error-detail-bar"><div class="error-context small muted">
      <div><b>Report:</b> #${error.id} · ${fmtDT(error.at)}</div>
      <div><b>Severity:</b> ${error.severity || 'error'} · <b>Error:</b> ${error.errorName || 'Error'}${error.errorCode ? ` (${error.errorCode})` : ''}</div>
      <div><b>HTTP status:</b> ${display(error.status)} · <b>${methodLabel(error.source)}:</b> ${display(error.method)}</div>
      <div><b>${requestIdLabel(error.source)}:</b> <code>${display(error.requestId)}</code></div>
      <div><b>Release / environment:</b> ${display(error.release)} · ${display(error.environment)}</div>
      <div><b>Instance:</b> <code>${display(error.instanceId)}</code></div>
      <div><b>Account ID:</b> <code>${error.userId || 'unknown / anonymous'}</code></div>
      <div><b>Account name:</b> ${error.accountName || '(not available)'}</div>
      <div><b>Account email:</b> ${error.accountEmail || '(not available)'}</div>
      <div><b>${urlLabel(error.source)}:</b> ${error.url || '(not recorded)'}</div>
      <div><b>User agent:</b> ${error.userAgent || '(not recorded)'}</div>
    </div><button class="btn sm" type="button" data-copy-error="${error.id}" aria-label="Copy error report ${error.id}">${icon('copy', 14)} Copy report</button></div>
    ${renderClientContext(error)}
    ${error.sqlQuery ? html`<section class="error-sql"><h3>Failed SQL template</h3><p class="small muted">${error.sqlParamCount ?? 'unknown'} bound parameter(s); values are omitted.</p><pre class="stack">${error.sqlQuery}</pre></section>` : ''}
    ${error.sqlException ? html`<section class="error-sql"><h3>SQL exception details</h3><p class="small muted">Driver values and query parameters are omitted.</p><pre class="stack">${pretty(error.sqlException)}</pre></section>` : ''}
    ${error.details ? html`<details class="error-raw"><summary>Full diagnostic context</summary><pre class="stack">${pretty(error.details)}</pre></details>` : ''}
    <details class="error-raw"><summary>Stack trace</summary><pre class="stack">${error.stack || 'No stack trace.'}</pre></details>
  </details>`;
}

export default async function errors(root, _p, ctx) {
  const state = {
    q: String(ctx.query?.get('q') || '').slice(0, 120),
    source: ['client', 'server'].includes(ctx.query?.get('source')) ? ctx.query.get('source') : '',
    offset: 0, revision: 0,
  };
  root.innerHTML = html`${pageHead('Errors', 'Search recent browser, mobile, playback and server reports. Client details are privacy-filtered; database SQL values are never stored.', html`<button class="btn danger" id="clearErrors" type="button">Clear all</button>`)}
    <form class="toolbar error-toolbar" id="errorFilters">
      <div class="search">${icon('search', 16)}<input id="errorQuery" type="search" value="${state.q}" placeholder="Message, code, route or request ID" aria-label="Search error reports"></div>
      <select id="errorSource" aria-label="Filter errors by source">${SOURCES.map(([value, label]) => html`<option value="${value}" ${state.source === value ? 'selected' : ''}>${label}</option>`)}</select>
      <button class="btn sm" type="submit">Search</button>
    </form>
    <section class="card flush error-group-section"><div class="card-head pad"><h2>Last 7 days · repeated errors</h2><span class="muted small">Grouped by source, severity, code, status and message</span></div><div id="errorGroups">${loadingTable(4, 4)}</div></section>
    <div class="error-recent-heading"><h2>Recent reports</h2><span id="errorCount" class="muted small"></span></div>
    <div id="errorRecent">${loadingTable(5, 2)}</div>`.s;

  const load = async () => {
    const revision = ++state.revision;
    const params = new URLSearchParams({ q: state.q, source: state.source, limit: String(LIMIT), offset: String(state.offset) });
    try {
      const result = await api.get(`/errors?${params}`);
      if (ctx.stale() || revision !== state.revision) return;
      $('#errorGroups', root).innerHTML = renderGroups(result.groups || []).s;
      $('#errorCount', root).textContent = `${Number(result.total || 0).toLocaleString('en-IN')} report${Number(result.total) === 1 ? '' : 's'} · last 30 days`;
      $('#errorRecent', root).innerHTML = html`${result.recent?.length ? html`${result.recent.map(renderRecent)}` : empty('No recent reports match this filter.')}
        ${pager({ total: Number(result.total || 0), offset: Number(result.offset || 0), limit: Number(result.limit || LIMIT) })}`.s;
      $$('[data-page]', root).forEach((button) => button.addEventListener('click', () => {
        state.offset = Number(button.dataset.page) || 0;
        load();
      }));
      $$('[data-copy-error]', root).forEach((button) => button.addEventListener('click', async () => {
        const entry = result.recent?.find((item) => String(item.id) === button.dataset.copyError);
        if (!entry) return;
        button.disabled = true;
        try { await copyText(errorText(entry)); toast('Error report copied'); }
        catch { toast('Could not copy. Select the details and copy them manually.', 'err'); }
        finally { if (button.isConnected) button.disabled = false; }
      }));
    } catch (error) {
      if (ctx.stale() || revision !== state.revision) return;
      $('#errorGroups', root).innerHTML = empty('The grouped errors could not be loaded.').s;
      $('#errorRecent', root).innerHTML = html`<div class="card form-err">${errMsg(error)}</div>`.s;
      $('#errorCount', root).textContent = '';
    }
  };

  $('#errorFilters', root).addEventListener('submit', (event) => {
    event.preventDefault();
    state.q = $('#errorQuery', root).value.trim().slice(0, 120);
    state.source = $('#errorSource', root).value;
    state.offset = 0;
    load();
  });
  $('#errorSource', root).addEventListener('change', () => {
    state.q = $('#errorQuery', root).value.trim().slice(0, 120);
    state.source = $('#errorSource', root).value;
    state.offset = 0;
    load();
  });
  $('#errorQuery', root).addEventListener('input', debounce((event) => {
    state.q = event.target.value.trim().slice(0, 120);
    state.offset = 0;
    load();
  }, 300));
  $('#clearErrors', root).addEventListener('click', async () => {
    if (!await confirmBox({ title: 'Clear the error log?', text: 'This removes all stored error reports, regardless of the current filters.', confirm: 'Clear all', danger: true })) return;
    try {
      await api.del('/errors');
      state.offset = 0;
      ctx.refreshCounts();
      toast('Error log cleared');
      await load();
    } catch (error) { toast(errMsg(error), 'err'); }
  });
  await load();
}
