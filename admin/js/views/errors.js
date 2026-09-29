import { api } from '../api.js';
import { empty, html, $, badge, pageHead, confirmBox, toast, errMsg, ago, fmtDT } from '../ui.js';

export default async function errors(root, _p, ctx) {
  const r = await api.get('/errors'); if (ctx.stale()) return;
  root.innerHTML = html`${pageHead('Errors', 'Crashes reported by the website (browser) and unexpected server errors, kept for 30 days. Set SENTRY_DSN for full monitoring.', r.groups.length ? html`<button class="btn danger" id="clear">Clear all</button>` : '')}
    <section class="card flush"><div class="card-head pad"><h2>Last 7 days, grouped</h2></div>${r.groups.length ? html`<table class="tbl compact"><thead><tr><th>Error</th><th>Where</th><th class="num">Times</th><th>Last seen</th></tr></thead><tbody>${r.groups.map((g) => html`<tr><td class="clip-cell"><strong>${g.message}</strong></td><td class="small">${badge(g.source, g.source === 'server' ? 'bad' : '')} <span class="muted">${g.url || ''}</span></td><td class="num">${g.count}</td><td class="small nowrap" title="${fmtDT(g.lastAt)}">${ago(g.lastAt)}</td></tr>`)}</tbody></table>` : empty('No errors in the last 7 days. 🎉')}</section>
    ${r.recent.length ? html`<h2 class="mt">Most recent</h2>${r.recent.map((e) => html`<details class="card"><summary>${badge(e.source)} ${e.message} <span class="muted small">· ${ago(e.at)}</span></summary><p class="small muted">${e.url || ''}<br>${e.userAgent || ''}</p><pre class="stack">${e.stack || 'No stack trace.'}</pre></details>`)}` : ''}`.s;
  $('#clear', root)?.addEventListener('click', async () => { if (await confirmBox({ title: 'Clear the error log?', confirm: 'Clear', danger: true })) { try { await api.del('/errors'); ctx.refreshCounts(); await errors(root, _p, ctx); } catch (e) { toast(errMsg(e), 'err'); } } });
}
