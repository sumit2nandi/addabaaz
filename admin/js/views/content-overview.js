// Content studio → Overview: the state of the catalog in one screen.
//
// Counts for shows/episodes/reels/coming-soon, the titles that still need artwork or a video source
// before they can be published, and the most recently published titles. Every card links into the page
// where the work happens (Shows, Videos & reels, Coming soon, Top 10).
import { api } from '../api.js';
import { html, icon, empty, pageHead, errMsg, imgSrc, ago } from '../ui.js';

// Same thumbnail rule as the Videos page: the uploaded thumbnail, else YouTube's.
const thumbOf = (v) => v.thumbnail ? imgSrc(v.thumbnail) : v.source?.type === 'youtube' ? `https://i.ytimg.com/vi/${v.source.id}/default.jpg` : '';

export default async function contentOverview(root, _p, ctx) {
  root.innerHTML = html`<div class="loading"><span class="spin"></span> Loading…</div>`.s;
  let cat;
  try { cat = await api.get('/catalog'); }
  catch (e) { root.innerHTML = html`${pageHead('Content overview')}<div class="card error-card"><h2>Couldn’t load the catalog</h2><p>${errMsg(e)}</p></div>`.s; return; }
  if (ctx.stale()) return;

  const shows = cat.shows || [], videos = cat.videos || [];
  const reels = videos.filter((v) => v.kind === 'reel');
  const episodes = videos.filter((v) => v.kind !== 'reel');
  const upcoming = (cat.upcoming || []).length || videos.filter((v) => v.publishAt && Date.parse(v.publishAt) > Date.now()).length;
  const premium = videos.filter((v) => v.access === 'premium').length + shows.filter((s) => s.access === 'premium').length;
  // What an editor should fix before a title goes live.
  const noArt = episodes.filter((v) => !thumbOf(v));
  const noSource = videos.filter((v) => !v.source?.type || !v.source?.id);
  const noDuration = videos.filter((v) => !v.duration);
  const recent = [...videos].sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)).slice(0, 8);
  const showName = (id) => { const s = shows.find((x) => x.id === id) || (cat.upcoming || []).find((x) => x.id === id); return s ? (s.titleEn || s.title) : ''; };

  const tile = (n, label, href, ic) => html`<a class="tile" href="${href}">${icon(ic, 22)}<b>${Number(n) || 0}</b><span>${label}</span></a>`;
  const issue = (list, text, hint, href) => list.length ? html`<div class="tile-issue">
    <div><b>${list.length}</b> ${text}<small class="muted">${hint}</small></div>
    <a class="btn sm" href="${href}">Fix</a></div>` : '';

  root.innerHTML = html`${pageHead('Content overview', 'Shows, episodes, reels and everything waiting to be published.')}
    <div class="stats">
      ${tile(shows.length, 'Shows & seasons', '#/shows', 'film')}
      ${tile(episodes.length, 'Episodes & videos', '#/videos', 'tv')}
      ${tile(reels.length, 'Reels', '#/videos?kind=reel', 'play')}
      ${tile(upcoming, 'Coming soon', '#/upcoming', 'clock')}
    </div>
    <div class="grid two">
      <section class="card">
        <h2>${(noArt.length + noSource.length + noDuration.length) ? `${icon('alert', 18)} Needs attention` : `${icon('check', 18)} Catalog looks healthy`}</h2>
        ${(noArt.length + noSource.length + noDuration.length) ? html`
          ${issue(noSource, 'titles have no video source', 'Upload the file or paste a YouTube link, then save the title.', '#/videos')}
          ${issue(noArt, 'episodes have no thumbnail', 'The thumbnail is what viewers see in every row.', '#/videos')}
          ${issue(noDuration, 'titles have no duration', 'Duration is shown on the card and drives the progress bar.', '#/videos')}`
          : html`<p class="muted">Every title has artwork, a source and a duration.</p>`}
        <p class="muted small">${premium} premium ${premium === 1 ? 'title' : 'titles'}</p>
      </section>
      <section class="card">
        <h2>Recently published</h2>
        ${recent.length ? html`<div class="rows">${recent.map((v) => html`<a class="row-item" href="#/videos?q=${encodeURIComponent(v.title || '')}">
          ${thumbOf(v) ? html`<img class="row-thumb" src="${thumbOf(v)}" alt="" loading="lazy">` : html`<span class="row-thumb blank">${icon('tv', 16)}</span>`}
          <span class="row-main"><b>${v.title || '(untitled)'}</b><small class="muted">${v.kind === 'reel' ? 'Reel' : 'Video'}${showName(v.showId) ? ` · ${showName(v.showId)}` : ''}</small></span>
          <span class="muted small">${ago(v.publishedAt)}</span></a>`)}</div>`
          : empty('Nothing in the catalog yet — add a show or upload your first video.')}
        <div class="row wrap"><a class="btn primary" href="#/shows">${icon('film', 16)} Manage shows</a><a class="btn" href="#/videos">${icon('tv', 16)} Videos & reels</a><a class="btn" href="#/upcoming">${icon('clock', 16)} Coming soon</a></div>
      </section>
    </div>
    <p class="muted small">Customers, payments, support tickets and broadcasts live in the <a href="/admin/">Admin console</a>.</p>`.s;
}
