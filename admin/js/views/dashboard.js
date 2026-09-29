// Dashboard: headline stats, recent payments and users, catalog counts and system status (from /stats, /catalog, /health).
import { api } from '../api.js';
import { html, icon, inr, ago, fmtD, badge, barChart, pageHead, plural } from '../ui.js';

const PLAN = { 'plus-monthly': 'Plus · monthly', 'plus-yearly': 'Plus · yearly' };
const statusBadge = (p) => p.refundedPaise >= p.amountPaise && p.status === 'paid' ? badge('refunded', 'warn') : badge(p.status, p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : '');

export default async function dashboard(root, _p, ctx) {
  const [s, health, cat] = await Promise.all([api.get('/stats'), api.get('/health'), api.get('/catalog')]);
  if (ctx.stale()) return;
  const eps = cat.videos.filter((v) => v.kind === 'episode').length, reels = cat.videos.filter((v) => v.kind === 'reel').length, prem = cat.videos.filter((v) => v.access === 'premium').length + cat.shows.filter((x) => x.access === 'premium').length;
  const todo = health.checks.filter((c) => !c.ok && c.level !== 'info');
  const rev = s.days.map((d) => d.paise / 100), sign = s.days.map((d) => d.signups);
  const stat = (label, value, sub, ic, href) => html`<a class="stat" href="${href}"><span class="stat-ic">${icon(ic, 20)}</span><div><small>${label}</small><strong>${value}</strong><em>${sub}</em></div></a>`;
  root.innerHTML = html`
    ${pageHead('Dashboard', `Welcome back, ${ctx.admin.name || ctx.admin.email}.`)}
    ${todo.length ? html`<div class="card setup"><h2>${icon('alert', 20)} Finish setting up (${todo.length})</h2><ul>${todo.map((c) => html`<li class="${c.level}"><strong>${c.label}</strong> — ${c.detail}</li>`)}</ul></div>` : ''}
    <div class="stats">
      ${stat('Revenue this month', inr(s.revenue.monthToDatePaise), `${inr(s.revenue.last30dPaise)} in 30 days`, 'card', '#/payments')}
      ${stat('Active subscribers', s.subscribers.active.toLocaleString('en-IN'), `${s.subscribers.expiring7d} expiring in 7 days${s.subscribers.comped ? ` · ${s.subscribers.comped} complimentary` : ''}`, 'crown', '#/users')}
      ${stat('Users', s.users.total.toLocaleString('en-IN'), `+${s.users.last7d} this week · +${s.users.last30d} this month`, 'users', '#/users')}
      ${stat('Open messages', s.openMessages, s.openMessages ? 'waiting for a reply' : 'all caught up', 'inbox', '#/messages')}
    </div>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>Revenue · last 30 days</h2><span class="muted small">net of refunds, IST</span></div>${barChart(rev, { label: (v) => '₹' + v.toLocaleString('en-IN'), labels: s.days.map((d) => fmtD(d.date)) })}<div class="axis"><span>${fmtD(s.days[0].date)}</span><span>${fmtD(s.days.at(-1).date)}</span></div><p class="muted small">All time: ${inr(s.revenue.totalPaise)} from ${plural(s.revenue.payments, 'payment')}${s.revenue.refunds ? ` · ${inr(s.revenue.refundedPaise)} refunded (${s.revenue.refunds})` : ''}</p></section>
      <section class="card"><div class="card-head"><h2>Sign-ups · last 30 days</h2></div>${barChart(sign, { labels: s.days.map((d) => fmtD(d.date)) })}<div class="axis"><span>${fmtD(s.days[0].date)}</span><span>${fmtD(s.days.at(-1).date)}</span></div>
        <h3 class="mt">Catalog</h3><p class="catalog-line"><a href="#/shows">${plural(cat.shows.length, 'show')}</a> · <a href="#/videos">${plural(eps, 'episode')}, ${plural(reels, 'reel')}</a> · <a href="#/upcoming">${cat.upcoming.length} coming soon</a> · <a href="#/gallery">${plural(cat.gallery.length, 'photo')}</a> · ${prem} premium</p></section>
    </div>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>Recent payments</h2><a href="#/payments" class="small">All payments</a></div>
        ${s.recentPayments.length ? html`<table class="tbl compact"><tbody>${s.recentPayments.map((p) => html`<tr><td><strong>${p.userEmail || '—'}</strong><br><small class="muted">${PLAN[p.planId] || p.planId} · ${ago(p.createdAt)}</small></td><td class="num">${inr(p.amountPaise)}</td><td>${statusBadge(p)}</td></tr>`)}</tbody></table>` : html`<p class="empty">No payments yet.</p>`}</section>
      <section class="card"><div class="card-head"><h2>New users</h2><a href="#/users" class="small">All users</a></div>
        <table class="tbl compact"><tbody>${s.recentUsers.map((u) => html`<tr><td><a href="#/users/${u.id}"><strong>${u.name}</strong></a><br><small class="muted">${u.email}</small></td><td class="muted small num">${ago(u.createdAt)}</td></tr>`)}</tbody></table></section>
    </div>
    ${health.checks.some((c) => c.level === 'info' || c.ok) ? html`<details class="card sys"><summary>System status</summary><ul class="checks">${health.checks.map((c) => html`<li class="${c.level}">${icon(c.ok ? 'check' : c.level === 'info' ? 'info' : 'alert', 16)}<div><strong>${c.label}</strong><small>${c.detail}</small></div></li>`)}</ul></details>` : ''}`.s;
}
