// Search page (#/search?q=): instant results, recent searches (kept on this device) and suggestions.
import { app } from '../app.js';
import { replaceUrl } from '../router.js';
import { html, $, debounce, storage, store } from '../util.js';
import { icon } from '../icons.js';
import { showCard, videoCard, reelCard, soonCard, emptyState } from '../ui/components.js';

const RECENT = 'ab.recent';
// Suggested searches shown when the box is empty.
const SUGGEST = ['শহীদ', 'Laugh Bite', 'ফালতু কথা', 'Subhadip Ghosh', 'comedy', 'Khudiram', 'Fake podcast', 'Holmes'];

export default async function search(ctx) {
  const cat = app.catalog;
  ctx.setTitle('Search');
  ctx.root.innerHTML = html`<div class="page search-page">
    <form class="search-field" id="sf" role="search">${icon('search', { size: 22 })}
      <input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search shows, episodes, reels, comedians…" aria-label="Search" value="${ctx.query.q || ''}">
      <button type="button" class="icon-btn" id="clr" aria-label="Clear" hidden>${icon('x', { size: 20 })}</button></form>
    <div id="out" aria-live="polite"></div></div>`.s;
  const q = $('#q', ctx.root), out = $('#out', ctx.root), clr = $('#clr', ctx.root);

  const idle = () => {
    const recent = storage(RECENT, []);
    out.innerHTML = html`
      ${recent.length ? html`<div class="chips-block"><div class="section-bar"><h2>Recent</h2><button class="btn btn-ghost btn-sm" id="clearRecent">Clear</button></div><div class="filter-group">${recent.map((r) => html`<button class="chip-btn" data-q="${r}">${icon('clock', { size: 14 })} ${r}</button>`)}</div></div>` : ''}
      <div class="chips-block"><div class="section-bar"><h2>Popular searches</h2></div><div class="filter-group">${SUGGEST.map((r) => html`<button class="chip-btn" data-q="${r}">${r}</button>`)}</div></div>
      <div class="section-bar"><h2>Trending now</h2></div><div class="grid grid-videos">${cat.trending(6).map((v, i) => videoCard(v, { rank: i + 1 }))}</div>`.s;
  };
  const run = () => {
    const term = q.value.trim(); clr.hidden = !term;
    replaceUrl('/search' + (term ? '?q=' + encodeURIComponent(term) : ''));
    if (!term) return idle();
    const r = cat.search(term);
    const eps = r.videos.filter((v) => v.kind === 'episode'), reels = r.videos.filter((v) => v.kind !== 'episode');
    const total = r.shows.length + r.videos.length + r.upcoming.length;
    out.innerHTML = !total ? emptyState({ iconName: 'search', title: `No results for “${term}”`, text: 'Try a show name, a comedian or a different spelling.' }).s : html`
      ${r.shows.length ? html`<h2 class="sub-h">Shows</h2><div class="grid grid-shows">${r.shows.map((s) => showCard(s))}</div>` : ''}
      ${r.upcoming.length ? html`<h2 class="sub-h">Coming soon</h2><div class="grid grid-shows">${r.upcoming.map(soonCard)}</div>` : ''}
      ${eps.length ? html`<h2 class="sub-h">Episodes <span class="count">${eps.length}</span></h2><div class="grid grid-videos">${eps.map((v) => videoCard(v))}</div>` : ''}
      ${reels.length ? html`<h2 class="sub-h">Reels & clips <span class="count">${reels.length}</span></h2><div class="grid grid-reels">${reels.map((v) => (v.kind === 'reel' ? reelCard(v) : videoCard(v)))}</div>` : ''}`.s;
  };
  const remember = () => { const t = q.value.trim(); if (t.length > 1) store(RECENT, [t, ...storage(RECENT, []).filter((x) => x !== t)].slice(0, 8)); };
  const debounced = debounce(run, 180);
  q.addEventListener('input', debounced);
  q.addEventListener('blur', remember);
  $('#sf', ctx.root).addEventListener('submit', (e) => { e.preventDefault(); run(); remember(); q.blur(); });
  clr.addEventListener('click', () => { q.value = ''; run(); q.focus(); });
  ctx.root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-q]'); if (c) { q.value = c.dataset.q; run(); remember(); }
    if (e.target.closest('#clearRecent')) { store(RECENT, []); idle(); }
    if (e.target.closest('a.card')) remember();
  });
  run();
  if (!q.value) requestAnimationFrame(() => q.focus({ preventScroll: true }));
}
