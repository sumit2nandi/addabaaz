// All-shows page (#/shows): shows and episodes are presented together without a Shows / All episodes switch.
import { app } from '../app.js';
import { replaceUrl } from '../router.js';
import { html, $ } from '../util.js';
import { showCard, videoCard, showMeta, emptyState } from '../ui/components.js';

// How many episode cards to show per "Load more".
const PAGE = 24;
export default async function browse(ctx) {
  const cat = app.catalog;
  const st = { genre: ctx.query.genre || '', access: ctx.query.access || '', show: ctx.query.show || '', sort: ctx.query.sort || 'new', n: PAGE };
  ctx.setTitle('Shows & Episodes');
  ctx.root.innerHTML = html`
    <div class="page">
      <section aria-label="Shows">
        <div class="filters" id="showFilters"></div>
        <div id="showsResults"></div>
      </section>
      <section aria-labelledby="episodesHeading">
        <h2 class="sub-h" id="episodesHeading">All Episodes</h2>
        <div class="filters" id="episodeFilters"></div>
        <div id="episodesResults"></div>
      </section>
    </div>`.s;

  const sync = () => {
    const q = new URLSearchParams();
    if (st.genre) q.set('genre', st.genre);
    if (st.access) q.set('access', st.access);
    if (st.show) q.set('show', st.show);
    if (st.sort !== 'new') q.set('sort', st.sort);
    replaceUrl('/shows' + (q.toString() ? '?' + q : ''));
  };
  const chip = (label, key, value) => html`<button type="button" class="chip-btn ${st[key] === value ? 'active' : ''}" data-f="${key}" data-v="${value}">${label}</button>`;

  const draw = () => {
    const showFilters = $('#showFilters', ctx.root), showResults = $('#showsResults', ctx.root);
    const episodeFilters = $('#episodeFilters', ctx.root), episodeResults = $('#episodesResults', ctx.root);

    showFilters.innerHTML = html`<div class="filter-group">${chip('All', 'genre', '')}${chip('Premium', 'access', 'premium')}${chip('Free', 'access', 'free')}${cat.genres.map((g) => chip(g, 'genre', g))}</div>`.s;
    const shows = cat.shows.filter((s) => (!st.genre || (s.genres || []).includes(st.genre)) && (!st.access || (s.access || 'free') === st.access));
    showResults.innerHTML = shows.length ? html`<div class="grid grid-shows">${shows.map((s) => html`<div class="show-tile">${showCard(s)}<div class="show-tile-info"><a href="#/show/${s.id}">${s.title}</a>${showMeta(s)}</div></div>`)}</div>
      ${cat.upcoming.length ? html`<h3 class="sub-h">Coming Soon</h3><div class="grid grid-shows">${cat.upcoming.map((u) => html`<a class="show-tile" href="#/soon/${u.id}"><div class="card card-poster"><div class="poster"><img src="${u.poster}" alt="${u.title}" loading="lazy"><span class="chip chip-soon">Coming Soon</span></div></div><div class="show-tile-info"><span>${u.title}</span></div></a>`)}</div>` : ''}`.s
      : emptyState({ title: 'No shows match these filters' }).s;

    const episodeShows = cat.shows.filter((s) => cat.episodes(s.id).length);
    episodeFilters.innerHTML = html`<div class="filter-group">${chip('All shows', 'show', '')}${episodeShows.map((s) => chip(s.titleEn || s.title, 'show', s.id))}</div>
      <label class="select-wrap"><span class="sr-only">Sort Episodes</span><select id="sortSel"><option value="new">Newest First</option><option value="popular">Most Watched</option><option value="old">Oldest First</option></select></label>`.s;
    $('#sortSel', ctx.root).value = st.sort;
    let episodes = cat.allEpisodes().filter((v) => !st.show || v.showId === st.show);
    episodes = episodes.sort(st.sort === 'popular' ? (a, b) => b.views - a.views : st.sort === 'old' ? (a, b) => a.publishedAt.localeCompare(b.publishedAt) : (a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const page = episodes.slice(0, st.n);
    episodeResults.innerHTML = episodes.length ? html`<div class="grid grid-videos">${page.map((v) => videoCard(v))}</div>
      <p class="grid-count">Showing ${page.length} of ${episodes.length} episodes</p>
      ${episodes.length > page.length ? html`<div class="center"><button class="btn btn-ghost" id="more">Load More</button></div>` : ''}`.s
      : emptyState({ title: 'No episodes for this show yet' }).s;
    sync();
  };

  ctx.root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-f]'); if (c) { st[c.dataset.f] = c.dataset.v; if (c.dataset.f === 'genre' && !c.dataset.v) st.access = ''; st.n = PAGE; draw(); return; }
    if (e.target.closest('#more')) { st.n += PAGE; draw(); }
  });
  ctx.root.addEventListener('change', (e) => { if (e.target.id === 'sortSel') { st.sort = e.target.value; st.n = PAGE; draw(); } });
  draw();
}
