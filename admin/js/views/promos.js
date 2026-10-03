// Admin → Promotions: the running offer, the credit ledger and the referral programme.
//
// The defaults come from the server's environment (PROMO_* in .env — see docs/PROMOS.md); everything on this
// page is stored in app_settings, so an offer can be started, changed or stopped in seconds without a
// redeploy. Amounts are typed in rupees here and sent in paise.
//
//   Offer card    — on/off, welcome bonus, referral bonus, when the inviter is paid, caps, expiry
//   Ledger        — every credit movement (filter by kind or account, revoke an untouched grant)
//   Grant         — goodwill credit for one account (e-mailed to the viewer, written to the audit log)
//   Referrals     — who invited whom and its state; a referral can be cancelled
import { api } from '../api.js';
import { html, $, $$, inr, icon, badge, empty, pager, pageHead, toast, errMsg, fmtDT, ago, debounce } from '../ui.js';

const KINDS = [['', 'All kinds'], ['signup', 'Welcome bonus'], ['referral_join', 'Invite bonus (friend)'], ['referral_invite', 'Referral reward (inviter)'], ['admin', 'Added by an admin'], ['spend', 'Spent on a plan'], ['refund', 'Returned']];
const STATUS = [['', 'All referrals'], ['completed', 'Completed'], ['pending', 'Waiting for the friend'], ['void', 'Cancelled']];
const HOLD_LABEL = { signup: 'as soon as they sign up', verified: 'after they confirm email/phone', payment: 'after their first payment' };

export default async function promos(root, _p, ctx) {
  let data;
  try { data = await api.get('/promos'); }
  catch (e) { root.innerHTML = html`${pageHead('Promotions', 'Credit and referrals.')}<div class="card error-card"><h2>Couldn’t load the offer</h2><p>${errMsg(e)}</p></div>`.s; return; }
  if (ctx.stale()) return;

  const c = data.config, d = data.config.defaults || {};
  const st = { kind: '', q: '', offset: 0, rstatus: '', roffset: 0 };
  root.innerHTML = html`
    ${pageHead('Promotions', 'A bonus for new viewers and for the people who invite them. Credit is spent on plans only — it is never paid out.')}
    <div id="offer"></div>
    <div id="stats"></div>
    <div class="grid two">
      <section class="card" id="grantCard"></section>
      <section class="card" id="topsCard"></section>
    </div>
    <section class="card">
      <h2>${icon('gift', 18)} Credit ledger</h2>
      <div class="toolbar"><div class="search">${icon('search', 16)}<input id="cq" type="search" placeholder="Filter by account or reason…" value="${st.q}"></div>
        <select id="ckind">${KINDS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      <div id="credits"></div>
    </section>
    <section class="card">
      <h2>${icon('users', 18)} Referrals</h2>
      <div class="toolbar"><select id="rstatus">${STATUS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      <div id="referrals"></div>
    </section>`.s;

  /* ---------- the offer ---------- */
  const rupeesToPaise = (v) => Math.round(Number(v || 0) * 100);
  const drawOffer = () => {
    $('#offer').innerHTML = html`<section class="card">
      <h2>${icon('crown', 18)} The offer ${c.enabled ? badge('running', 'ok') : badge('paused', 'warn')}</h2>
      <form id="offerForm" class="fields">
        <label class="row-switch"><span><b>Promotions are on</b><small>Switch off to stop new grants immediately. Credit already in accounts stays spendable.</small></span><span class="switch"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''}><span class="track"></span></span></label>
        <div class="field"><label>Welcome bonus (₹) — new accounts</label><input name="signup" type="number" min="0" max="1000" step="1" value="${c.signupPaise / 100}"><small class="muted">Default ${(d.signupPaise ?? 10000) / 100}. Set 0 to stop giving a welcome bonus.</small></div>
        <div class="field"><label>Referral bonus (₹) — each side</label><input name="referral" type="number" min="0" max="1000" step="1" value="${c.referralPaise / 100}"><small class="muted">The invited friend gets it at sign-up; the inviter is paid ${HOLD_LABEL[c.hold]}.</small></div>
        <div class="field"><label>Pay the inviter</label><select name="hold">
          <option value="signup" ${c.hold === 'signup' ? 'selected' : ''}>Immediately (on sign-up)</option>
          <option value="verified" ${c.hold === 'verified' ? 'selected' : ''}>After the friend confirms email/phone</option>
          <option value="payment" ${c.hold === 'payment' ? 'selected' : ''}>After the friend’s first payment</option></select></div>
        <div class="field"><label>Rewards one account may earn</label><input name="maxReferrals" type="number" min="0" max="10000" step="1" value="${c.maxReferrals}"></div>
        <div class="field"><label>Credit expires after (days, 0 = never)</label><input name="expiryDays" type="number" min="0" max="3650" step="1" value="${c.expiryDays}"></div>
        <div class="field"><label>Invite code can be added within (days of signup)</label><input name="redeemDays" type="number" min="0" max="365" step="1" value="${c.redeemDays}"></div>
        <button class="btn primary" type="submit">${icon('check', 16)} Save offer</button>
      </form>
      <p class="muted small">Prices are in rupees; the server stores paise. A change applies to the next sign-up or code — nobody has to reinstall or reload. Environment defaults: welcome ₹${(d.signupPaise ?? 10000) / 100}, referral ₹${(d.referralPaise ?? 10000) / 100}, hold “${d.hold}”.</p>
    </section>`.s;
    $('#offerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = {
        enabled: f.get('enabled') === 'on', signupPaise: rupeesToPaise(f.get('signup')), referralPaise: rupeesToPaise(f.get('referral')),
        hold: String(f.get('hold')), maxReferrals: Number(f.get('maxReferrals')), expiryDays: Number(f.get('expiryDays')), redeemDays: Number(f.get('redeemDays')),
      };
      try { const r = await api.patch('/promos', body); Object.assign(c, r.config); toast('Offer saved'); drawOffer(); drawStats(); }
      catch (err) { toast(errMsg(err), 'bad'); }
    });
  };

  /* ---------- headline numbers ---------- */
  const drawStats = () => {
    const s = data.stats, r = s.referrals || {};
    $('#stats').innerHTML = html`<div class="grid four">
      <section class="card stat"><span class="muted small">Credit outstanding</span><strong>${inr(s.outstandingPaise)}</strong><small class="muted">in ${s.accounts} account${s.accounts === 1 ? '' : 's'}</small></section>
      <section class="card stat"><span class="muted small">Granted all time</span><strong>${inr(s.grantedPaise)}</strong><small class="muted">${s.byKind?.signup?.count || 0} welcome · ${(s.byKind?.referral_join?.count || 0) + (s.byKind?.referral_invite?.count || 0)} referral</small></section>
      <section class="card stat"><span class="muted small">Spent on plans</span><strong>${inr(s.spentPaise)}</strong><small class="muted">expired ${inr(s.expiredPaise)}</small></section>
      <section class="card stat"><span class="muted small">Referrals</span><strong>${r.completed || 0} <small class="muted">of ${r.total || 0}</small></strong><small class="muted">${r.pending || 0} waiting · ${inr(r.bonusPaise)} paid</small></section>
    </div>`.s;
  };

  /* ---------- goodwill grant ---------- */
  $('#grantCard').innerHTML = html`<h2>${icon('gift', 18)} Give credit</h2>
    <form id="grantForm" class="fields">
      <div class="field"><label>Account (email or id)</label><input name="user" type="text" placeholder="viewer@example.com" required autocapitalize="off"></div>
      <div class="field"><label>Amount (₹)</label><input name="amount" type="number" min="1" max="10000" step="1" required></div>
      <div class="field"><label>Reason (sent to the viewer)</label><input name="reason" type="text" maxlength="200" placeholder="Sorry about the outage"></div>
      <button class="btn primary" type="submit">${icon('plus', 16)} Add credit</button>
    </form>
    <p class="muted small">Use it for goodwill or a competition prize. The viewer is e-mailed, the entry is logged and the amount is capped at ₹10,000.</p>`.s;
  $('#grantForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api.post('/credits/grant', { user: String(f.get('user')).trim(), amountINR: Number(f.get('amount')), reason: String(f.get('reason') || '') });
      toast(`Added ${inr(r.credit.amountPaise)} for ${r.email} — balance ${inr(r.balancePaise)}`);
      e.target.reset();
      await refresh();
    } catch (err) { toast(errMsg(err), 'bad'); }
  });

  /* ---------- top referrers ---------- */
  const drawTops = () => {
    const rows = data.topReferrers || [];
    $('#topsCard').innerHTML = html`<h2>${icon('star', 18)} Top referrers</h2>${rows.length ? html`<table class="tbl"><tbody>
      ${rows.map((r, i) => html`<tr><td class="muted">${i + 1}</td><td><strong>${r.name}</strong><br><small class="muted">${r.email}</small></td><td class="end">${badge(`${r.completed} joined`, 'ok')} <b>${inr(r.bonusPaise)}</b></td></tr>`)}</tbody></table>` : empty('No referrals yet — share an invite link to get started.')}`.s;
  };

  /* ---------- ledger ---------- */
  const drawCredits = async () => {
    let r;
    try { r = await api.get(`/credits?limit=25&offset=${st.offset}${st.kind ? `&kind=${st.kind}` : ''}${st.q ? `&q=${encodeURIComponent(st.q)}` : ''}`); }
    catch (e) { $('#credits').innerHTML = html`<div class="card error-card">${errMsg(e)}</div>`.s; return; }
    if (ctx.stale()) return;
    $('#credits').innerHTML = html`<div class="card flush">${r.items.length ? html`<table class="tbl"><thead><tr><th>When</th><th>Account</th><th>Kind</th><th>Amount</th><th>Reason</th><th></th></tr></thead><tbody>
      ${r.items.map((x) => html`<tr><td class="small">${fmtDT(x.createdAt)}<br><span class="muted">${ago(x.createdAt)}</span></td>
        <td class="small"><strong>${x.userName || '—'}</strong><br><span class="muted">${x.userEmail || x.userId}</span></td>
        <td>${badge(KINDS.find(([v]) => v === x.kind)?.[1] || x.kind, x.amountPaise < 0 ? 'warn' : 'ok')}</td>
        <td class="num ${x.amountPaise < 0 ? 'muted' : ''}">${x.amountPaise < 0 ? '−' : '+'}${inr(Math.abs(x.amountPaise))}${x.amountPaise > 0 && x.remainingPaise !== x.amountPaise ? html`<br><small class="muted">${inr(x.remainingPaise)} left</small>` : ''}</td>
        <td class="small">${x.reason || '—'}${x.status !== 'available' && x.amountPaise > 0 ? html`<br><small class="muted">${x.status}</small>` : ''}</td>
        <td class="end">${x.amountPaise > 0 && x.remainingPaise > 0 && (x.status === 'available' || x.status === 'pending') ? html`<button class="btn sm danger" data-revoke="${x.id}">Remove</button>` : ''}</td></tr>`)}</tbody></table>` : empty('No credit movements match.')}</div>
      ${pager({ total: r.total, offset: st.offset, limit: 25 })}`.s;
    $$('[data-page]', $('#credits')).forEach((b) => b.onclick = () => { st.offset = Number(b.dataset.page); drawCredits(); });
    $$('[data-revoke]', $('#credits')).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { const out = await api.post(`/credits/${b.dataset.revoke}/revoke`, {}); toast(`Removed ${inr(out.removedPaise)}`); await refresh(); }
      catch (err) { toast(errMsg(err), 'bad'); b.disabled = false; }
    });
  };
  $('#ckind').addEventListener('change', (e) => { st.kind = e.target.value; st.offset = 0; drawCredits(); });
  $('#cq').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.offset = 0; drawCredits(); }, 250));

  /* ---------- referrals ---------- */
  const drawReferrals = async () => {
    let r;
    try { r = await api.get(`/referrals?limit=25&offset=${st.roffset}${st.rstatus ? `&status=${st.rstatus}` : ''}`); }
    catch (e) { $('#referrals').innerHTML = html`<div class="card error-card">${errMsg(e)}</div>`.s; return; }
    if (ctx.stale()) return;
    $('#referrals').innerHTML = html`<div class="card flush">${r.items.length ? html`<table class="tbl"><thead><tr><th>Inviter</th><th>Friend</th><th>Code</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.items.map((x) => html`<tr><td class="small"><strong>${x.inviterName || '—'}</strong><br><span class="muted">${x.inviterEmail || ''}</span></td>
        <td class="small"><strong>${x.inviteeName || '—'}</strong><br><span class="muted">${x.inviteeEmail || ''}</span></td>
        <td class="small">${x.code || '—'}</td>
        <td>${x.status === 'completed' ? badge('rewarded', 'ok') : x.status === 'pending' ? badge('waiting', 'warn') : badge('cancelled')}<br><small class="muted">${fmtDT(x.createdAt)}</small></td>
        <td class="end">${x.status !== 'void' ? html`<button class="btn sm danger" data-void="${x.id}">Cancel</button>` : ''}</td></tr>`)}</tbody></table>` : empty('No referrals match.')}</div>
      ${pager({ total: r.total, offset: st.roffset, limit: 25 })}`.s;
    $$('[data-page]', $('#referrals')).forEach((b) => b.onclick = () => { st.roffset = Number(b.dataset.page); drawReferrals(); });
    $$('[data-void]', $('#referrals')).forEach((b) => b.onclick = async () => {
      if (!confirm('Cancel this referral? Rewards that are still untouched will be removed.')) return;
      b.disabled = true;
      try { const out = await api.post(`/referrals/${b.dataset.void}/void`, {}); toast(out.removedPaise ? `Cancelled — removed ${inr(out.removedPaise)}` : 'Cancelled'); await refresh(); }
      catch (err) { toast(errMsg(err), 'bad'); b.disabled = false; }
    });
  };
  $('#rstatus').addEventListener('change', (e) => { st.rstatus = e.target.value; st.roffset = 0; drawReferrals(); });

  // Re-read everything after a change (a grant or a removal moves the headline numbers too).
  async function refresh() {
    try { data = await api.get('/promos'); Object.assign(c, data.config); } catch { /* keep the numbers we have */ }
    if (ctx.stale()) return;
    drawOffer(); drawStats(); drawTops();
    await Promise.all([drawCredits(), drawReferrals()]);
  }

  drawOffer(); drawStats(); drawTops();
  await Promise.all([drawCredits(), drawReferrals()]);
}
