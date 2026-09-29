import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pageHead, fmtDT, debounce } from '../ui.js';

const LIMIT = 50;
const meta = (m) => (m ? Object.entries(m).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '');
export default async function audit(root, _p, ctx) {
  let entries = [], action = '', done = false;
  root.innerHTML = html`${pageHead('Audit log', 'Who changed what — every admin action is recorded and can’t be edited here.')}
    <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Filter by action, e.g. refund, user., catalog.show"></div></div>
    <div id="list"></div>`.s;
  const draw = () => {
    $('#list').innerHTML = html`<div class="card flush">${entries.length ? html`<table class="tbl compact"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>
      ${entries.map((e) => html`<tr><td class="small nowrap">${fmtDT(e.at)}</td><td class="small">${e.actor}</td><td>${badge(e.action)}</td><td class="small clip-cell">${e.target || ''}</td><td class="small muted clip-cell">${meta(e.meta)}</td></tr>`)}</tbody></table>` : empty('Nothing recorded yet.')}</div>
      ${!done && entries.length ? html`<div class="pager"><button class="btn" id="more">Load older entries</button></div>` : ''}`.s;
    $('#more')?.addEventListener('click', () => load(true));
  };
  const load = async (more = false) => {
    const before = more && entries.length ? entries.at(-1).id : '';
    const r = await api.get(`/audit?limit=${LIMIT}&action=${encodeURIComponent(action)}${before ? `&before=${before}` : ''}`); if (ctx.stale()) return;
    entries = more ? [...entries, ...r.entries] : r.entries; done = r.entries.length < LIMIT; draw();
  };
  $('#q').addEventListener('input', debounce((e) => { action = e.target.value.trim(); load(); }, 300));
  await load();
}
