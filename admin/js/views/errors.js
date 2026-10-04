// Crashes reported by visitors' browsers, grouped by error with counts; "Clear all" empties the list.
import { api } from '../api.js';
import { empty, html, $, $$, badge, icon, pageHead, confirmBox, toast, errMsg, ago, fmtDT } from '../ui.js';

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
  `Source: ${e.source}`,
  `Message: ${e.message}`,
  `User ID: ${e.userId || 'unknown / anonymous'}`,
  `Account name: ${e.accountName || '(not available)'}`,
  `Account email: ${e.accountEmail || '(not available)'}`,
  `URL: ${e.url || '(not recorded)'}`,
  `User agent: ${e.userAgent || '(not recorded)'}`,
  ...(e.sqlQuery ? [`SQL template (bound values omitted; ${e.sqlParamCount ?? 'unknown'} parameter(s)):`, e.sqlQuery] : []),
  'Stack:', e.stack || 'No stack trace.',
].join('\n');

export default async function errors(root, _p, ctx) {
  const r = await api.get('/errors'); if (ctx.stale()) return;
  root.innerHTML = html`${pageHead('Errors', 'Browser crashes, fatal video/HLS playback diagnostics and unexpected server errors, kept for 30 days. Database reports include parameterized SQL templates; bound values are not stored. For server alerts, install @sentry/node and set SENTRY_DSN.', r.groups.length ? html`<button class="btn danger" id="clear">Clear all</button>` : '')}
    <section class="card flush"><div class="card-head pad"><h2>Last 7 days, grouped</h2></div>${r.groups.length ? html`<table class="tbl compact"><thead><tr><th>Error</th><th>Where</th><th class="num">Times</th><th>Last seen</th></tr></thead><tbody>${r.groups.map((g) => html`<tr><td class="clip-cell"><strong>${g.message}</strong></td><td class="small">${badge(g.source, g.source === 'server' ? 'bad' : '')} <span class="muted">${g.url || ''}</span></td><td class="num">${g.count}</td><td class="small nowrap" title="${fmtDT(g.lastAt)}">${ago(g.lastAt)}</td></tr>`)}</tbody></table>` : empty('No errors in the last 7 days. 🎉')}</section>
    ${r.recent.length ? html`<h2 class="mt">Most recent</h2>${r.recent.map((e) => html`<details class="card">
      <summary>${badge(e.source)} ${e.message} <span class="muted small">· ${ago(e.at)}</span></summary>
      <div class="error-detail-bar"><div class="error-context small muted">
        <div><b>Report:</b> #${e.id} · ${fmtDT(e.at)}</div>
        <div><b>Account ID:</b> <code>${e.userId || 'unknown / anonymous'}</code></div>
        <div><b>Account name:</b> ${e.accountName || '(not available)'}</div>
        <div><b>Account email:</b> ${e.accountEmail || '(not available)'}</div>
        <div><b>URL:</b> ${e.url || '(not recorded)'}</div>
        <div><b>User agent:</b> ${e.userAgent || '(not recorded)'}</div>
      </div><button class="btn sm" type="button" data-copy-error="${e.id}" aria-label="Copy error report ${e.id}">${icon('copy', 14)} Copy</button></div>
      ${e.sqlQuery ? html`<div class="error-sql"><b>Failed SQL template</b> <span class="small muted">· ${e.sqlParamCount ?? 'unknown'} bound parameter(s); values omitted</span><pre class="stack">${e.sqlQuery}</pre></div>` : ''}
      <pre class="stack">${e.stack || 'No stack trace.'}</pre>
    </details>`)}` : ''}`.s;
  $$('[data-copy-error]', root).forEach((button) => button.addEventListener('click', async () => {
    const entry = r.recent.find((e) => String(e.id) === button.dataset.copyError);
    if (!entry) return;
    button.disabled = true;
    try { await copyText(errorText(entry)); toast('Error details copied'); }
    catch { toast('Could not copy. Select the details and copy them manually.', 'err'); }
    finally { if (button.isConnected) button.disabled = false; }
  }));
  $('#clear', root)?.addEventListener('click', async () => { if (await confirmBox({ title: 'Clear the error log?', confirm: 'Clear', danger: true })) { try { await api.del('/errors'); ctx.refreshCounts(); await errors(root, _p, ctx); } catch (e) { toast(errMsg(e), 'err'); } } });
}
