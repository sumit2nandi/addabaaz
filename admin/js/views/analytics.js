// Analytics page: plays and watch time per day, top shows and videos (from first-party play events).
import { api } from '../api.js';
import { empty, html, $$, icon, inr, fmtD, barChart, pageHead, badge } from '../ui.js';

const mins = (sec) => `${Math.round(sec / 60).toLocaleString('en-IN')} min`;
export default async function analytics(root, _p, ctx) {
  const days = [7, 30, 90].includes(Number(ctx.query.get('days'))) ? Number(ctx.query.get('days')) : 30;
  const a = await api.get(`/analytics?days=${days}`); if (ctx.stale()) return;
  const map = new Map(a.daily.map((d) => [d.date, d]));
  const series = [...Array(days)].map((_, i) => { const d = new Date(Date.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10); return { date: d, ...(map.get(d) || { plays: 0, seconds: 0 }) }; });
  const rev = a.business.days || [];
  const stat = (label, value, sub) => html`<div class="stat"><div><small>${label}</small><strong>${value}</strong><em>${sub}</em></div></div>`;
  root.innerHTML = html`${pageHead('Analytics', 'What people watch, and how the business is doing.', html`<div class="tabs">${[7, 30, 90].map((d) => html`<a class="tab ${d === days ? 'on' : ''}" href="#/analytics?days=${d}">${d} days</a>`)}</div>`)}
    <div class="stats">
      ${stat('Plays', a.totals.plays.toLocaleString('en-IN'), `last ${days} days`)}
      ${stat('Watch time', mins(a.totals.seconds), a.totals.plays ? `${Math.round(a.totals.seconds / a.totals.plays / 60 * 10) / 10} min per play` : '—')}
      ${stat('Revenue', inr(a.business.revenue?.last30dPaise ?? 0), 'last 30 days, net of refunds')}
    </div>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>Plays per day</h2></div>${barChart(series.map((d) => d.plays), { labels: series.map((d) => fmtD(d.date)), label: (v) => `${v} plays` })}<div class="axis"><span>${fmtD(series[0].date)}</span><span>${fmtD(series.at(-1).date)}</span></div></section>
      <section class="card"><div class="card-head"><h2>Watch time per day</h2></div>${barChart(series.map((d) => Math.round(d.seconds / 60)), { labels: series.map((d) => fmtD(d.date)), label: (v) => `${v} min` })}<div class="axis"><span>${fmtD(series[0].date)}</span><span>${fmtD(series.at(-1).date)}</span></div></section>
    </div>
    <div class="grid two">
      <section class="card flush"><div class="card-head pad"><h2>Top shows</h2></div>${a.shows.length ? html`<table class="tbl compact"><thead><tr><th>Show</th><th class="num">Plays</th><th class="num">Watch time</th></tr></thead><tbody>${a.shows.map((s) => html`<tr><td>${s.title}</td><td class="num">${s.plays.toLocaleString('en-IN')}</td><td class="num">${mins(s.seconds)}</td></tr>`)}</tbody></table>` : empty('No plays recorded yet.')}</section>
      <section class="card flush"><div class="card-head pad"><h2>Top videos</h2></div>${a.videos.length ? html`<table class="tbl compact"><thead><tr><th>Video</th><th class="num">Plays</th><th class="num">Watch time</th></tr></thead><tbody>${a.videos.map((v) => html`<tr><td>${v.title}${v.show ? html`<br><small class="muted">${v.show}</small>` : ''}</td><td class="num">${v.plays.toLocaleString('en-IN')}</td><td class="num">${mins(v.seconds)}</td></tr>`)}</tbody></table>` : empty('No plays recorded yet.')}</section>
    </div>
    <p class="muted small">${a.note} Analytics are counted once a video actually starts playing; ad-blockers and people who leave within seconds may not be counted.</p>`.s;
}
