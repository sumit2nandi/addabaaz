import { app } from '../app.js';
import { replaceUrl } from '../router.js';
import { html, $, $$ } from '../util.js';
import { icon } from '../icons.js';
import { showCard, videoCard, sectionHeader, showMeta, emptyState } from '../ui/components.js';

const PAGE = 24;
export default async function browse(ctx) {
  const cat = app.catalog;
  const st = { view: ctx.query.view === 'episodes' ? 'episodes' : 'shows', genre: ctx.query.genre || '', show: ctx.query.show || '', sort: ctx.query.sort || 'new', n: PAGE };
  ctx.setTitle('Shows');
  ctx.root.innerHTML = html`
    <div class="page">
      ${sectionHeader({ tag: 'Browse', title: 'Shows & Episodes', subtitle: 'Every ADDABAAZ original in one place.' })}
      <div class="tabs" role="tablist">
        <button role="tab" data-view="shows">Shows</button><button role="tab" data-view="episodes">All episodes</button>
      </div>
      <div class="filters" id="filters"></div>
      <div id="results"></div>
    </div>`.s;

  const sync = () => {
    const q = new URLSearchParams(); if (st.view !== 'shows') q.set('view', st.view);
    if (st.genre) q.set('genre', st.genre); if (st.show) q.set('show', st.show); if (st.sort !== 'new') q.set('sort', st.sort);
    replaceUrl('/shows' + (q.toString() ? '?' + q : ''));
  };
  const chip = (label, key, value) => html`<button type="button" class="chip-btn ${st[key] === value ? 'active' : ''}" data-f="${key}" data-v="${value}">${label}</button>`;

  const draw = () => {
    $$('.tabs [data-view]', ctx.root).forEach((b) => { b.classList.toggle('active', b.dataset.view === st.view); b.setAttribute('aria-selected', b.dataset.view === st.view); });
    const f = $('#filters', ctx.root), out = $('#results', ctx.root);
    if (st.view === 'shows') {
      f.innerHTML = html`<div class="filter-group">${chip('All', 'genre', '')}${cat.genres.map((g) => chip(g, 'genre', g))}</div>`.s;
      const list = cat.shows.filter((s) => !st.genre || (s.genres || []).includes(st.genre));
      out.innerHTML = list.length ? html`<div class="grid grid-shows">${list.map((s) => html`<div class="show-tile">${showCard(s)}<div class="show-tile-info"><a href="#/show/${s.id}" class="bn">${s.title}</a>${showMeta(s)}</div></div>`)}</div>
        ${cat.upcoming.length ? html`<h2 class="sub-h">Coming soon</h2><div class="grid grid-shows">${cat.upcoming.map((u) => html`<a class="show-tile" href="#/soon/${u.id}"><div class="card card-poster"><div class="poster"><img src="${u.poster}" alt="${u.title}" loading="lazy"><span class="chip chip-soon">Coming soon</span></div></div><div class="show-tile-info"><span class="bn">${u.title}</span></div></a>`)}</div>` : ''}`.s
        : emptyState({ title: 'No shows in this genre yet' }).s;
    } else {
      const shows = cat.shows.filter((s) => cat.episodes(s.id).length);
      f.innerHTML = html`<div class="filter-group">${chip('All shows', 'show', '')}${shows.map((s) => chip(s.titleEn || s.title, 'show', s.id))}</div>
        <label class="select-wrap"><span class="sr-only">Sort</span><select id="sortSel"><option value="new">Newest first</option><option value="popular">Most watched</option><option value="old">Oldest first</option></select></label>`.s;
      $('#sortSel', ctx.root).value = st.sort;
      let list = cat.allEpisodes().filter((v) => !st.show || v.showId === st.show);
      list = list.sort(st.sort === 'popular' ? (a, b) => b.views - a.views : st.sort === 'old' ? (a, b) => a.publishedAt.localeCompare(b.publishedAt) : (a, b) => b.publishedAt.localeCompare(a.publishedAt));
      const page = list.slice(0, st.n);
      out.innerHTML = html`<div class="grid grid-videos">${page.map((v) => videoCard(v))}</div>
        <p class="grid-count">Showing ${page.length} of ${list.length} episodes</p>
        ${list.length > page.length ? html`<div class="center"><button class="btn btn-ghost" id="more">Load more</button></div>` : ''}`.s;
    }
    sync();
  };
  ctx.root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view]'); if (t) { st.view = t.dataset.view; st.n = PAGE; draw(); return; }
    const c = e.target.closest('[data-f]'); if (c) { st[c.dataset.f] = c.dataset.v; st.n = PAGE; draw(); return; }
    if (e.target.closest('#more')) { st.n += PAGE; draw(); }
  });
  ctx.root.addEventListener('change', (e) => { if (e.target.id === 'sortSel') { st.sort = e.target.value; st.n = PAGE; draw(); } });
  draw();
}
