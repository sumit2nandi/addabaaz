// Dashboard: headline stats, recent payments and users, catalog counts and system status (from /stats, /catalog, /health).
import { api } from '../api.js';
import { html, $, icon, inr, ago, fmtD, badge, barChart, pageHead, plural, toast, errMsg, formModal } from '../ui.js';

const PLAN = { 'plus-monthly': 'Plus · monthly', 'plus-yearly': 'Plus · yearly' };
const statusBadge = (p) => p.refundedPaise >= p.amountPaise && p.status === 'paid' ? badge('refunded', 'warn') : badge(p.status, p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : '');

export default async function dashboard(root, _p, ctx) {
  const [s, health, cat] = await Promise.all([api.get('/stats'), api.get('/health'), api.get('/catalog')]);
  if (ctx.stale()) return;
  const eps = cat.videos.filter((v) => v.kind === 'episode').length, reels = cat.videos.filter((v) => v.kind === 'reel').length, prem = cat.videos.filter((v) => v.access === 'premium').length + cat.shows.filter((x) => x.access === 'premium').length;
  const todo = health.checks.filter((c) => !c.ok && c.level !== 'info');
  const mailConfigured = health.checks.find((c) => c.id === 'mail')?.ok;
  const smsConfigured = health.checks.find((c) => c.id === 'sms')?.ok;
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
        <h3 class="mt">Catalog <a class="small" href="#/catalog">open Content overview →</a></h3><p class="catalog-line"><a href="#/shows">${plural(cat.shows.length, 'show')}</a> · <a href="#/videos">${plural(eps, 'episode')}, ${plural(reels, 'reel')}</a> · <a href="#/upcoming">${cat.upcoming.length} coming soon</a> · ${prem} premium</p></section>
    </div>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>Recent payments</h2><a href="#/payments" class="small">All payments</a></div>
        ${s.recentPayments.length ? html`<table class="tbl compact"><tbody>${s.recentPayments.map((p) => html`<tr><td><strong>${p.userEmail || '—'}</strong><br><small class="muted">${PLAN[p.planId] || p.planId} · ${ago(p.createdAt)}</small></td><td class="num">${inr(p.amountPaise)}</td><td>${statusBadge(p)}</td></tr>`)}</tbody></table>` : html`<p class="empty">No payments yet.</p>`}</section>
      <section class="card"><div class="card-head"><h2>New users</h2><a href="#/users" class="small">All users</a></div>
        <table class="tbl compact"><tbody>${s.recentUsers.map((u) => html`<tr><td><a href="#/users/${u.id}"><strong>${u.name}</strong></a><br><small class="muted">${u.email}</small></td><td class="muted small num">${ago(u.createdAt)}</td></tr>`)}</tbody></table></section>
    </div>
    ${health.checks.some((c) => c.level === 'info' || c.ok) ? html`<details class="card sys"><summary>System status</summary><ul class="checks">${health.checks.map((c) => html`<li class="${c.level}">${icon(c.ok ? 'check' : c.level === 'info' ? 'info' : 'alert', 16)}<div><strong>${c.label}</strong><small>${c.detail}</small></div></li>`)}</ul>
      ${mailConfigured || smsConfigured ? html`<div class="row wrap mt">
        ${mailConfigured ? html`<button class="btn sm" id="mailTest">Send test email to ${ctx.admin.email}</button>` : ''}
        ${smsConfigured ? html`<button class="btn sm" id="smsTest">Send test SMS…</button>` : ''}
        <small>${mailConfigured ? 'The e-mail test sends a real message to your administrator inbox.' : ''}${mailConfigured && smsConfigured ? ' ' : ''}${smsConfigured ? 'The SMS test sends the same kind of 6-digit code viewers get to a number you type — standard SMS charges apply.' : ''}</small>
      </div>` : ''}
    </details>` : ''}`.s;
  // Delivery diagnostics: both send something real, which is the only way to catch a provider problem that
  // the checklist cannot see (SMTP ports, an unapproved DLT template, a wrong number format).
  const smsTest = $('#smsTest', root);
  if (smsTest) smsTest.addEventListener('click', () => formModal({
    title: 'Send a test SMS',
    fields: [{ k: 'to', label: 'Phone number', type: 'tel', req: true, max: 20, placeholder: '+91 98123 45678', help: 'The code goes straight to this number through MSG91. Nothing is stored and the viewer sign-in flow is not touched.' }],
    submit: 'Send test SMS',
    onSubmit: async ({ to }) => {
      const r = await api.post('/sms/test', { to });
      toast(`Test SMS sent to ${r.to}`);
    },
  }));
  const mailTest = $('#mailTest', root);
  if (mailTest) mailTest.addEventListener('click', async () => {
    mailTest.disabled = true; mailTest.textContent = 'Sending test email…';
    try { await api.post('/email/test'); toast(`Test email sent to ${ctx.admin.email}`); }
    catch (e) { toast(errMsg(e), 'err'); }
    finally { mailTest.disabled = false; mailTest.textContent = `Send test email to ${ctx.admin.email}`; }
  });
}
