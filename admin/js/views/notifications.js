// Broadcast: send an app push notification or an e-mail to viewers (Admin → Broadcast).
// Two channels, one composer each: "App push" reaches phones/tablets (native FCM tokens) and browsers
// that turned notifications on; "E-mail" reaches accounts by their Users-page filter. Sending happens
// in the background, so the page polls the campaign row and shows live progress.
import { api } from '../api.js';
import { empty, html, $, icon, pageHead, toast, errMsg, guard, fmtDT, badge, wireImages, openModal } from '../ui.js';

// Status badge for a campaign row.
const STATUS = { queued: ['Queued', 'warn'], sending: ['Sending…', 'warn'], sent: ['Sent', 'ok'], partial: ['Partly sent', 'warn'], failed: ['Failed', 'bad'], cancelled: ['Cancelled', ''] };
const statusBadge = (s) => badge(...(STATUS[s] || [s, '']));
const CHANNEL = { push: 'App push', email: 'E-mail' };
const k = (n) => (Number(n) || 0).toLocaleString('en-IN');
const campaignImageSrc = (path) => (!path ? '' : /^https?:\/\//i.test(path) ? path : `/${String(path).replace(/^\/+/, '')}`);
const done = (s) => ['sent', 'partial', 'failed', 'cancelled'].includes(s);
// The optional image attached to a broadcast: shown inside the notification (rich push) and at the top of
// the e-mail. The markup matches the console's other image controls, so `wireImages()` gives it upload + preview.
const imageField = (max, help) => html`<div class="field wide"><label for="bc_img">Image <small class="muted">(optional — shown in the notification and in the e-mail)</small></label>
  <div class="imgf" data-image="imageUrl" data-upload="r2" data-maxw="1200">
    <div class="imgf-prev"><span class="muted small">No image</span></div>
    <div class="imgf-in">
      <input id="bc_img" name="imageUrl" maxlength="500" placeholder="Upload to R2, or paste /media/… or https://…">
      <label class="btn sm">${icon('upload', 16)} Upload<input type="file" accept="image/*" hidden></label>
      <input name="imageAlt" maxlength="200" placeholder="Describe the image (alt text)" aria-label="Image description">
      <span class="imgf-st small muted">${help || ''}</span>
    </div>
  </div></div>`;

// One step line in a "not set up yet" card; `parts` alternate text / code.
const step = (...parts) => html`<span>${parts.map((p, i) => (i % 2 ? html`<code>${p}</code>` : p))}</span>`;

export default async function notifications(root, _p, ctx) {
  let channel = 'push';
  let meta = await api.get('/notifications'); if (ctx.stale()) return;
  let timer = null;

  root.innerHTML = html`${pageHead('Broadcast', 'Send an app push notification or an e-mail to your viewers — the way film and series apps announce new releases. Test it on yourself first.')}
    <div class="tabs" id="bctabs">${[['push', 'App push', 'bell'], ['email', 'E-mail', 'mail']].map(([v, l, i]) => html`<button class="tab" data-ch="${v}">${icon(i, 15)} ${l}</button>`)}</div>
    <div id="bcbody"></div>
    <section class="card flush" style="margin-top:16px"><div class="card-head pad"><h2>Recent broadcasts</h2><span class="muted small" id="bclive"></span></div><div id="bchistory"></div></section>`.s;

  const body = $('#bcbody', root), history = $('#bchistory', root), live = $('#bclive', root);
  history.addEventListener('click', (e) => {
    const button = e.target.closest('[data-campaign-open]');
    const row = button || e.target.closest('tr[data-campaign]');
    if (row && history.contains(row)) openBroadcast(button?.dataset.campaignOpen || row.dataset.campaign);
  });
  for (const t of [...root.querySelectorAll('[data-ch]')]) {
    t.classList.toggle('on', t.dataset.ch === channel);
    t.addEventListener('click', () => { channel = t.dataset.ch; for (const x of [...root.querySelectorAll('[data-ch]')]) x.classList.toggle('on', x === t); paint(); });
  }

  /* ---------- recent broadcasts (with live progress while one is sending) ---------- */
  const row = (c) => html`<tr class="link broadcast-row" data-campaign="${c.id}">
    <td>${badge(CHANNEL[c.channel] || c.channel)} <button class="broadcast-open" type="button" data-campaign-open="${c.id}" aria-label="View details for ${c.title || 'broadcast'}" aria-haspopup="dialog">${icon('eye', 14)} <strong>${c.title || 'Untitled broadcast'}</strong></button><br><small class="muted">${(c.body || '').slice(0, 110)}${(c.body || '').length > 110 ? '…' : ''}</small></td>
    <td class="small">${c.audience}${c.test ? html` ${badge('test')}` : ''}</td>
    <td class="small">${k(c.sent)}${c.total ? html` / ${k(c.total)}` : ''} sent${c.failed ? html` ${badge(`${k(c.failed)} failed`, 'warn')}` : ''}${c.skipped ? html`<br><small class="muted">${k(c.skipped)} skipped</small>` : ''}</td>
    <td>${statusBadge(c.status)}${c.error ? html`<br><small class="muted">${c.error}</small>` : ''}</td>
    <td class="small muted">${fmtDT(c.at || c.createdAt)}<br>${c.by || ''}</td></tr>`;
  const paintHistory = () => {
    const list = meta.campaigns || [];
    history.innerHTML = list.length
      ? html`<table class="tbl compact"><thead><tr><th>Broadcast</th><th>Audience</th><th>Progress</th><th>Status</th><th>When</th></tr></thead><tbody>${list.map(row)}</tbody></table>`.s
      : empty('Nothing broadcast yet.').s;
    const active = list.filter((c) => !done(c.status)).length;
    live.textContent = active ? `${active} sending…` : '';
  };

  const DELIVERY = {
    pending: ['Pending', 'warn'], sent: ['Sent', 'ok'], failed: ['Failed', 'bad'], skipped: ['Skipped', ''],
  };
  const deliveryBadge = (status) => badge(...(DELIVERY[status] || [status || 'Unknown', '']));

  function deliveryRows(page, state, campaign) {
    const list = page.deliveries || [];
    const offset = Number(page.offset) || 0, limit = Number(page.limit) || 50, total = Number(page.total) || 0;
    const from = total ? offset + 1 : 0, to = Math.min(total, offset + list.length);
    return html`<div class="broadcast-delivery-list">
      <div class="toolbar broadcast-delivery-toolbar">
        <select data-delivery-status aria-label="Filter recipient outcomes">
          ${[['all', 'All outcomes'], ['pending', 'Pending'], ['sent', 'Sent'], ['failed', 'Failed'], ['skipped', 'Skipped']].map(([value, label]) => html`<option value="${value}" ${state.status === value ? 'selected' : ''}>${label}</option>`)}
        </select>
        <label class="search"><input type="search" data-delivery-query value="${state.search}" placeholder="Search name, email or account ID" aria-label="Search recipients"></label>
        <button class="btn sm" type="button" data-delivery-search>Search</button>
      </div>
      ${list.length ? html`<div class="broadcast-delivery-table-wrap"><table class="tbl compact broadcast-delivery-table">
        <thead><tr><th>Recipient</th><th>Account ID</th><th>Destination</th><th>Outcome</th></tr></thead>
        <tbody>${list.map((d) => html`<tr>
          <td><strong>${d.name || d.email || (d.userId ? 'Account' : 'Guest device')}</strong>${d.email && d.name ? html`<br><small class="muted">${d.email}</small>` : ''}</td>
          <td class="small">${d.userId ? html`<code>${d.userId}</code>` : html`<span class="muted">No linked account</span>`}</td>
          <td class="small">${d.destination || d.transport || '—'}</td>
          <td>${deliveryBadge(d.status)}${d.error ? html`<br><small class="broadcast-delivery-error">${d.error}</small>` : ''}</td>
        </tr>`)}</tbody>
      </table></div>` : empty(state.search || state.status !== 'all' ? 'No recipients match this filter.' : Number(campaign.total) > 0 && done(campaign.status) ? 'Recipient-level outcomes were not recorded for this older broadcast.' : 'No recipient results recorded yet.')}
      <div class="broadcast-delivery-count muted small">${k(from)}–${k(to)} of ${k(total)} recipient results</div>
      ${total > limit ? html`<div class="row end broadcast-delivery-pager">
        <button class="btn sm" type="button" data-delivery-page="${Math.max(0, offset - limit)}" ${offset <= 0 ? 'disabled' : ''}>Previous</button>
        <button class="btn sm" type="button" data-delivery-page="${offset + limit}" ${offset + limit >= total ? 'disabled' : ''}>Next</button>
      </div>` : ''}
    </div>`;
  }

  function campaignDetails(c) {
    const audiences = c.channel === 'email' ? (meta.email?.audiences || []) : (meta.audiences || []);
    const audience = audiences.find((a) => a.id === c.audience)?.label || c.audience || '—';
    const details = [
      ['Audience', audience], ['Created', fmtDT(c.createdAt || c.at)], ['Updated', fmtDT(c.updatedAt)],
      ['Finished', fmtDT(c.finishedAt)], ['Sent by', c.by || '—'],
      ...(c.channel !== 'email' || c.button ? [[c.channel === 'email' ? 'Button opens' : 'Opens', c.url || '/']] : []),
      ...(c.button ? [['Button label', c.button]] : []), ['Campaign ID', c.id || '—'],
    ];
    return html`<div class="broadcast-detail">
      <div class="broadcast-detail-head">${badge(CHANNEL[c.channel] || c.channel)} ${c.test ? badge('test') : ''}<span data-campaign-status>${statusBadge(c.status)}</span></div>
      <div><h3>${c.title || 'Untitled broadcast'}</h3><p class="muted small">${c.channel === 'email' ? 'E-mail subject' : 'Push notification title'}</p></div>
      <div class="broadcast-detail-stats">${[['Recipients', c.total], ['Sent', c.sent], ['Failed', c.failed], ['Skipped', c.skipped]].map(([label, value]) => html`<div class="broadcast-detail-stat"><span class="muted small">${label}</span><strong data-campaign-stat="${label.toLowerCase()}">${k(value)}</strong></div>`)}</div>
      <section><b>Message</b><p class="broadcast-detail-message">${c.body || '—'}</p></section>
      <dl class="broadcast-detail-meta">${details.map(([label, value]) => html`<div><dt>${label}</dt><dd>${label === 'Opens' || label === 'Button opens' || label === 'Campaign ID' ? html`<code class="broadcast-detail-code">${value}</code>` : value}</dd></div>`)}</dl>
      ${c.imageUrl ? html`<section><b>Attached image</b><div class="broadcast-detail-image"><img src="${campaignImageSrc(c.imageUrl)}" alt="${c.imageAlt || ''}" loading="lazy"></div>${c.imageAlt ? html`<p class="muted small">${c.imageAlt}</p>` : ''}</section>` : ''}
      <section class="broadcast-recipient-panel">
        <div class="card-head"><div><h3>Recipients and outcomes</h3><p class="muted small">Accounts and devices reached by this broadcast, with individual delivery status.</p></div></div>
        <div data-campaign-deliveries><p class="muted small">Loading recipient results…</p></div>
        <p class="muted small">Sent means the mail or push provider accepted the request; it is not a read receipt.</p>
      </section>
      <div data-campaign-error>${c.error ? html`<p class="form-err broadcast-detail-error"><b>Campaign error:</b> ${c.error}</p>` : ''}</div>
    </div>`;
  }

  function updateCampaignSummary(container, c) {
    const status = $('[data-campaign-status]', container);
    if (status) status.innerHTML = statusBadge(c.status).s;
    for (const [key, value] of [['recipients', c.total], ['sent', c.sent], ['failed', c.failed], ['skipped', c.skipped]]) {
      const target = $(`[data-campaign-stat="${key}"]`, container);
      if (target) target.textContent = k(value);
    }
    const error = $('[data-campaign-error]', container);
    if (error) error.innerHTML = c.error ? html`<p class="form-err broadcast-detail-error"><b>Campaign error:</b> ${c.error}</p>`.s : '';
  }

  async function openBroadcast(id) {
    const initial = (meta.campaigns || []).find((c) => String(c.id) === String(id));
    if (!initial) return;
    const modal = openModal(campaignDetails(initial), { title: 'Broadcast details', wide: true });
    const state = { status: 'all', search: '', offset: 0 };
    let active = true, timer = null, request = 0, campaign = initial, firstRefresh = true;
    modal.el.addEventListener('close', () => { active = false; clearTimeout(timer); });

    const loadRecipients = async () => {
      const sequence = ++request, section = $('[data-campaign-deliveries]', modal.body);
      if (!section || !active) return;
      const queryInput = $('[data-delivery-query]', section), keepFocus = queryInput && document.activeElement === queryInput;
      const caret = keepFocus ? queryInput.selectionStart : null;
      section.innerHTML = '<p class="muted small">Loading recipient results…</p>';
      const params = new URLSearchParams({ status: state.status, q: state.search, limit: '50', offset: String(state.offset) });
      try {
        const result = await api.get(`/notifications/${encodeURIComponent(id)}/deliveries?${params}`);
        if (!active || sequence !== request) return;
        section.innerHTML = deliveryRows(result, state, campaign).s;
        if (keepFocus) {
          const next = $('[data-delivery-query]', section);
          next?.focus();
          if (next && caret !== null) next.setSelectionRange(caret, caret);
        }
      } catch (e) {
        if (active && sequence === request) section.innerHTML = html`<p class="form-err">Could not load recipient results: ${errMsg(e)}</p>`.s;
      }
    };
    modal.body.addEventListener('input', (event) => {
      if (event.target.matches('[data-delivery-query]')) state.search = event.target.value;
    });
    modal.body.addEventListener('change', (event) => {
      if (!event.target.matches('[data-delivery-status]')) return;
      state.status = event.target.value; state.offset = 0; loadRecipients();
    });
    modal.body.addEventListener('click', (event) => {
      if (event.target.closest('[data-delivery-search]')) {
        state.search = $('[data-delivery-query]', modal.body)?.value?.trim() || ''; state.offset = 0; loadRecipients();
        return;
      }
      const page = event.target.closest('[data-delivery-page]');
      if (page && !page.disabled) { state.offset = Number(page.dataset.deliveryPage) || 0; loadRecipients(); }
    });
    modal.body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.matches('[data-delivery-query]')) {
        event.preventDefault(); state.search = event.target.value.trim(); state.offset = 0; loadRecipients();
      }
    });

    const refresh = async () => {
      if (!active) return;
      try {
        const latest = await api.get(`/notifications/${encodeURIComponent(id)}`);
        if (!active) return;
        campaign = latest;
        if (firstRefresh) { modal.body.innerHTML = campaignDetails(campaign).s; firstRefresh = false; }
        else updateCampaignSummary(modal.body, campaign);
      } catch { /* the saved history snapshot remains useful if status refresh fails */ }
      await loadRecipients();
      if (active && !done(campaign.status)) timer = setTimeout(refresh, 3000);
    };
    await refresh();
  }

  // While something is sending, refresh the list every few seconds (and stop when the page changes).
  function schedule() {
    clearTimeout(timer);
    if (!(meta.campaigns || []).some((c) => !done(c.status)) || !history.isConnected) return;
    timer = setTimeout(async () => {
      if (ctx.stale() || !history.isConnected) return;
      try { meta = await api.get('/notifications'); } catch { /* keep the last view */ }
      paintHistory(); schedule();
    }, 3000);
  }

  /* ---------- composer + channel status ---------- */
  const setupCard = (title, steps) => html`<div class="card setup"><h2>${icon('alert', 20)} ${title}</h2>${steps.map((s) => html`<p>${s}</p>`)}</div>`;
  const line = (label, value, sub = '') => html`<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--border)"><span class="muted small">${label}</span><span><strong>${value}</strong>${sub ? html` <small class="muted">${sub}</small>` : ''}</span></div>`;

  function paint() {
    clearTimeout(timer);
    body.innerHTML = (channel === 'push' ? pushHtml() : emailHtml()).s;
    wire();
    paintHistory(); schedule();
  }

  /* ---------- preview: exactly what will be sent, before anything is sent ---------- */
  // Rendered by the server with the same builders the sender uses (POST /notifications/preview), so the
  // preview cannot drift from the real notification/e-mail. Debounced as the composer is typed into.
  const previewHtml = () => html`<section class="card" id="bcPreview">
    <div class="card-head"><h2>${icon('eye', 18)} Preview</h2><span class="muted small" id="bcPvState">Write a title and a message to see the preview.</span></div>
    <div id="bcPvBody"><p class="muted small">Nothing is sent by previewing.</p></div>
  </section>`;

  function previewText(form) {
    return { channel, title: (form.title?.value || '').trim(), body: (form.body?.value || '').trim(), url: (form.url?.value || '').trim(), button: (form.button?.value || '').trim(), imageUrl: (form.imageUrl?.value || '').trim(), imageAlt: (form.imageAlt?.value || '').trim() };
  }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 500);
  }

  async function runPreview() {
    const form = $('#bcf', body), pvBody = $('#bcPvBody', body), state = $('#bcPvState', body);
    if (!form || !pvBody) return;
    const p = previewText(form);
    if (!p.title && !p.body) { pvBody.innerHTML = '<p class="muted small">Write a title and a message to see the preview.</p>'; state.textContent = ''; return; }
    state.textContent = 'Rendering…';
    let r;
    try { r = await api.post('/notifications/preview', p); }
    catch (e) { state.textContent = errMsg(e); pvBody.innerHTML = ''; return; }
    if (!pvBody.isConnected) return;                       // navigated away while rendering
    state.textContent = 'Nothing has been sent.';
    if (r.channel === 'push') {
      const n = r.push || {};
      pvBody.innerHTML = html`<div class="push-row">
        <div class="push-mock" role="img" aria-label="Notification preview">
          <div class="push-app"><img src="/media/icons/logo-96.webp" width="18" height="18" alt=""><span>ADDABAAZ</span><small>now</small></div>
          <b class="push-title">${n.title || '(no title)'}</b>
          ${n.body ? html`<span class="push-body">${n.body}</span>` : ''}
          ${r.image ? html`<img class="push-img" src="${r.image}" alt="${p.imageAlt || ''}" loading="lazy">` : ''}
        </div>
        <div class="pv-meta">
          <p class="muted small">${r.image ? 'With an image, phones show a large picture notification.' : 'Add an image for a large picture notification.'}</p>
          <p class="muted small">Tapping it opens <code>${n.url || '/'}</code>.</p>
          <details><summary class="small">Payload sent to devices</summary><pre class="pv-json">${JSON.stringify(n, null, 2)}</pre></details>
        </div>
      </div>`.s;
    } else {
      const m = r.email || {};
      pvBody.innerHTML = html`<div class="mail-mock">
        <div class="mail-subj"><small class="muted">Subject</small> <b>${m.subject || '(no subject)'}</b></div>
        <iframe class="mail-frame" title="E-mail preview" sandbox referrerpolicy="no-referrer" srcdoc="${m.html || ''}"></iframe>
      </div>
      <details><summary class="small">Plain-text version</summary><pre class="pv-json">${m.text || ''}</pre></details>`.s;
    }
  }

  /* ---------- app push ---------- */
  function pushHtml() {
    const p = meta.push || {};
    const ready = !!(p.web || p.native);
    const setup = ready ? '' : setupCard('Push isn’t set up yet', [
      step('Browsers and the installed web app: generate VAPID keys with ', 'npx web-push generate-vapid-keys', ', then set ', 'VAPID_PUBLIC_KEY', ', ', 'VAPID_PRIVATE_KEY', ' and ', 'VAPID_SUBJECT', '.'),
      step('Phone apps: add your Firebase service account as ', 'FCM_SERVICE_ACCOUNT', ' (the JSON itself) or ', 'FCM_SERVICE_ACCOUNT_FILE', ' (a path) — see docs/MOBILE.md.'),
      'Restart the service, then reload this page.',
    ]);
    return html`${setup}
      <div class="grid two">
        <form class="card" id="bcf" novalidate><div class="card-head"><h2>Send an app notification</h2></div>
          <div class="field"><label for="bc_aud">Send to</label><select id="bc_aud" name="audience">${(meta.audiences || []).map((a) => html`<option value="${a.id}">${a.label}</option>`)}</select></div>
          <div class="field"><label for="bc_t">Title <small class="muted">(max 80)</small></label><input id="bc_t" name="title" maxlength="80" required placeholder="New episode is live"></div>
          <div class="field"><label for="bc_b">Message <small class="muted">(max 180)</small></label><textarea id="bc_b" name="body" rows="3" maxlength="180" required placeholder="Season 2, Episode 1 is now streaming."></textarea></div>
          <div class="field"><label for="bc_u">Opens <small class="muted">(a page on the site, e.g. /show/…)</small></label><input id="bc_u" name="url" value="/" maxlength="300"></div>
          ${imageField('', 'A wide (16:9) image looks best in the notification.')}
          <div class="form-err" id="bc_err" hidden></div>
          <div class="row"><button class="btn primary" type="submit" ${ready ? '' : 'disabled'}>${icon('bell', 16)} Send now</button>
            <button class="btn" type="button" id="bc_test" ${ready ? '' : 'disabled'}>${icon('check', 16)} Send a test to me</button>
            <button class="btn" type="button" id="bc_preview">${icon('eye', 16)} Refresh preview</button></div>
          <p class="muted small">Notifications appear on the phones and tablets where the app is installed, and in browsers where the viewer allowed them. Every app installation receives the broadcast; browser subscriptions follow the viewer's own preferences. A test goes only to your own devices.</p>
        </form>
        <section class="card"><div class="card-head"><h2>Reach</h2></div>
          ${line('Browsers & web app', k(p.webSubscribers), p.web ? '' : 'not configured')}
          ${line('App installations', k(p.nativeDevices), p.native ? '' : 'not configured')}
          <p class="muted small" style="margin-top:10px">${p.native
            ? 'App push goes through Firebase Cloud Messaging to every device token the apps registered at sign-in.'
            : 'App push needs a Firebase service account (FCM_SERVICE_ACCOUNT or FCM_SERVICE_ACCOUNT_FILE) — see docs/MOBILE.md.'}</p>
        </section>
      </div>
      ${previewHtml()}`;
  }

  /* ---------- e-mail ---------- */
  function emailHtml() {
    const e = meta.email || {}, auds = e.audiences || [];
    const setup = e.configured ? '' : setupCard('E-mail isn’t set up yet', [
      step('Set ', 'SMTP_URL', ' (for example ', 'smtps://user:pass@smtp.example.com:465', ') and ', 'MAIL_FROM', ', then restart the service.'),
      step('Use ', 'Send a test to me', ' once it is configured — that catches wrong credentials or a blocked port.'),
    ]);
    return html`${setup}
      <div class="grid two">
        <form class="card" id="bcf" novalidate><div class="card-head"><h2>Send an e-mail announcement</h2></div>
          <div class="field"><label for="bc_aud">Send to</label><select id="bc_aud" name="audience">${auds.map((a) => html`<option value="${a.id}">${a.label} — ${k(a.count)} ${a.count === 1 ? 'account' : 'accounts'}</option>`)}</select></div>
          <div class="field"><label for="bc_t">Subject <small class="muted">(max 120)</small></label><input id="bc_t" name="title" maxlength="120" required placeholder="New on ADDABAAZ this week"></div>
          <div class="field"><label for="bc_b">Message <small class="muted">(plain text; a blank line starts a new paragraph)</small></label><textarea id="bc_b" name="body" rows="7" maxlength="4000" required placeholder="Hello!&#10;&#10;Season 2 of your favourite show is streaming now."></textarea></div>
          <div class="field"><label for="bc_u">Button opens <small class="muted">(a page on the site, e.g. /plans)</small></label><input id="bc_u" name="url" value="/" maxlength="300"></div>
          <div class="field"><label for="bc_btn">Button label <small class="muted">(optional)</small></label><input id="bc_btn" name="button" maxlength="40" placeholder="Watch now"></div>
          ${imageField('', 'Appears as a banner at the top of the e-mail.')}
          <div class="form-err" id="bc_err" hidden></div>
          <div class="row"><button class="btn primary" type="submit" ${e.configured ? '' : 'disabled'}>${icon('mail', 16)} <span id="bc_sendlabel">Send now</span></button>
            <button class="btn" type="button" id="bc_test" ${e.configured ? '' : 'disabled'}>${icon('check', 16)} Send a test to me</button>
            <button class="btn" type="button" id="bc_preview">${icon('eye', 16)} Refresh preview</button></div>
          <p class="muted small">Every message carries a one-click unsubscribe link; people who use it are skipped from then on. Receipts and account e-mails are never affected.</p>
        </form>
        <section class="card"><div class="card-head"><h2>Reach</h2></div>
          ${auds.map((a) => line(a.label, k(a.count)))}
          ${line('Unsubscribed', k(e.optedOut), 'excluded')}
          <p class="muted small" style="margin-top:10px">Sent from <strong>${e.from || '—'}</strong>. Disabled accounts are always skipped.</p>
        </section>
      </div>
      ${previewHtml()}`;
  }

  /* ---------- wiring ---------- */
  function wire() {
    const form = $('#bcf', body), err = $('#bc_err', body);
    wireImages(form);                                     // upload + live thumbnail for the image field
    const payload = () => ({ channel, audience: form.audience.value, title: form.title.value, body: form.body.value, url: form.url.value, button: form.button ? form.button.value : '',
      imageUrl: form.imageUrl ? form.imageUrl.value.trim() : '', imageAlt: form.imageAlt ? form.imageAlt.value.trim() : '' });
    const label = $('#bc_sendlabel', body);
    const count = () => {
      if (channel !== 'email' || !label) return;
      const a = (meta.email?.audiences || []).find((x) => x.id === form.audience.value);
      label.textContent = `Send to ${k(a?.count)} ${a?.count === 1 ? 'account' : 'accounts'}`;
    };
    if (channel === 'email') { count(); form.audience.addEventListener('change', count); }
    // Live preview while typing (debounced), and instantly when the image changes.
    form.addEventListener('input', schedulePreview);
    form.addEventListener('change', schedulePreview);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      await guard($('button[type=submit]', form), async () => {
        try {
          const c = await api.post('/notifications/send', payload());
          form.title.value = ''; form.body.value = '';
          if (form.imageUrl) { form.imageUrl.value = ''; form.imageAlt.value = ''; }
          schedulePreview();
          meta = await api.get('/notifications');
          paintHistory(); schedule();
          toast(c && c.status === 'failed' ? (c.error || 'The broadcast could not be started.') : 'Queued — sending in the background.', c && c.status === 'failed' ? 'err' : 'ok');
        } catch (x) { err.textContent = errMsg(x); err.hidden = false; }
      });
    });
    $('#bc_preview', body)?.addEventListener('click', (e) => guard(e.currentTarget, runPreview));
    $('#bc_test', body)?.addEventListener('click', (e) => guard(e.currentTarget, async () => {
      try { await api.post('/notifications/test', payload()); toast('Test sent to you.'); }
      catch (x) { err.textContent = errMsg(x); err.hidden = false; }
    }));
  }

  paint();
  // Stop the poller once the page has been replaced by a navigation.
  const stop = setInterval(() => { if (ctx.stale() || !root.isConnected) { clearTimeout(timer); clearInterval(stop); } }, 5000);
}
