// Support page (#/support): raise a ticket about anything that goes wrong in the app or on the website —
// trouble signing in, registration, payments, playback, content — and follow the conversation.
//
// Signed-in viewers see their previous tickets and their replies in one place. Guests can still write in:
// the form asks for a name and an e-mail, the reference is shown on screen and mailed to them, and the
// ticket form is the only thing they need (the reply thread is reachable with the same e-mail).
import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { html, $, timeAgo, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { sectionHeader, toast } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { go } from '../router.js';
import { platform } from '../platform.js';
import { friendly } from '../errors.js';

// The categories offered to viewers; the ids match the server's TICKET_CATEGORIES.
const CATEGORIES = [
  ['signin', 'Trouble signing in', 'lock'],
  ['registration', 'Registration / new account', 'user'],
  ['payment', 'Payment or plan', 'card'],
  ['playback', 'Video won’t play', 'play'],
  ['content', 'Missing or wrong content', 'film'],
  ['account', 'Account, profile or PIN', 'shield'],
  ['other', 'Something else', 'chat'],
];
const STATUS = {
  open: ['Open', 'ok'], pending: ['In progress', 'warn'], resolved: ['Resolved', 'ok'], closed: ['Closed', ''],
};
const labelFor = (id) => CATEGORIES.find(([c]) => c === id)?.[1] || 'Something else';
const ref = (id) => `ADD-${String(id).slice(0, 8).toUpperCase()}`;

/** The page. */
export default async function support(ctx) {
  const u = app.user;
  ctx.setTitle('Support');
  if (!u.supportsAuth) {
    ctx.root.innerHTML = html`<div class="page page-narrow"><div class="empty">${icon('chat', { size: 44 })}
      <h2>Support needs a connection</h2><p>This copy of ADDABAAZ runs without the server, so tickets can’t be sent from here. Please write to us once you’re back online.</p>
      <a class="btn btn-primary" href="#/contact">Contact us instead</a></div></div>`.s;
    return;
  }
  const acc = u.account;
  const isPhoneAccount = !!acc?.emailIsPlaceholder;
  let tickets = [];
  if (acc) { try { tickets = (await u.myTickets({ limit: 25 })).tickets || []; } catch { /* the form still works */ } }
  if (ctx.stale?.()) return;   // see the sign-in page: an older shell may not have it yet

  ctx.root.innerHTML = html`<div class="page page-narrow">
    ${sectionHeader({ tag: 'We’re here to help', title: 'Support', subtitle: 'Tell us what went wrong and we’ll get back to you by e-mail — usually within one working day.' })}
    ${acc ? html`<div class="card-panel notice"><div>${icon('mail', { size: 22 })}</div><div><b>Signed in as ${acc.name}</b>
      <p class="muted">${acc.emailIsPlaceholder ? `Replies go to your mobile number’s account — add an e-mail below so we can write back.` : `We’ll reply to ${acc.email}.`}</p></div></div>` : ''}
    <section class="card-panel form" id="supForm">
      <h2>Raise a ticket</h2>
      <label>What is this about?<select name="category" id="supCat">${CATEGORIES.map(([id, label]) => html`<option value="${id}">${label}</option>`)}</select></label>
      <label>Subject<input name="subject" id="supSubject" maxlength="160" required placeholder="Short summary of the issue"></label>
      <label>Describe the issue<textarea name="body" id="supBody" rows="6" maxlength="5000" required placeholder="What happened? What did you expect? Any error message you saw helps a lot."></textarea></label>
      ${!acc || isPhoneAccount ? html`<label>Your name<input name="name" maxlength="80" value="${acc?.name || ''}" required autocomplete="name"></label>
        <label>Email address<input name="email" type="email" maxlength="254" value="${acc && !isPhoneAccount ? acc.email : ''}" required autocomplete="email" placeholder="name@example.com"></label>` : ''}
      <label>Phone / WhatsApp <small>(optional)</small><input name="phone" type="tel" maxlength="24" value="${acc?.phone || ''}" autocomplete="tel" placeholder="+91 90000 00000"></label>
      <input type="text" name="website" id="supHp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
      <div class="form-status" id="supStatus" role="alert"></div>
      <button type="submit" class="btn btn-primary btn-lg block" id="supSend">Send to support</button>
      <p class="muted small">We use this only to answer your request. See the <a href="#/privacy">Privacy Policy</a>.</p>
    </section>
    ${acc ? html`<section aria-labelledby="supMine"><h2 class="sub-h" id="supMine">Your tickets</h2>
      <div class="card-panel list" id="supList">${tickets.length ? tickets.map(ticketRow).join('') : html`<p class="muted sup-empty">No tickets yet — anything you send appears here.</p>`}</div></section>` : html`<section aria-labelledby="supMine"><h2 class="sub-h" id="supMine">Already wrote in?</h2>
        <div class="card-panel list"><button class="row-link" id="supLookup">${icon('search', { size: 22 })}<span><b>Find my ticket</b><small>Open a ticket with the e-mail you used and its reference.</small></span>${icon('right', { size: 18, cls: 'chev' })}</button></div></section>`}
    <section><h2 class="sub-h">Before you write</h2>
      <div class="card-panel list">
        <div class="row-link static">${icon('user', { size: 22 })}<span><b>Can’t sign in?</b><small>Use “Forgot password” on the sign-in page, or sign in with the Google / Facebook button you used.</small></span></div>
        <div class="row-link static">${icon('card', { size: 22 })}<span><b>Paid but no access?</b><small>Subscriptions activate automatically when the payment succeeds. It can take a few minutes — include the payment id if it doesn’t.</small></span></div>
        <div class="row-link static">${icon('play', { size: 22 })}<span><b>Video won’t play?</b><small>Try another network or the ADDABAAZ app, and mention the title you were watching.</small></span></div>
        <a class="row-link" href="#/contact">${icon('mail', { size: 22 })}<span><b>Business &amp; production enquiries</b><small>Use the contact page instead.</small></span>${icon('right', { size: 18, cls: 'chev' })}</a>
      </div></section>
  </div>`.s;

  const form = $('#supForm', ctx.root);
  const status = $('#supStatus', ctx.root);
  // The ticket carries where it was raised from: platform + app version make bug reports reproducible.
  const context = { platform: platform === 'web' ? 'web' : platform, appVersion: CONFIG.version, device: navigator.userAgent.slice(0, 120) };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#supSend', ctx.root);
    const f = new FormData(form);
    const subject = String(f.get('subject') || '').trim();
    const body = String(f.get('body') || '').trim();
    status.className = 'form-status';
    if (subject.length < 3) { status.textContent = 'Please add a short subject.'; return; }
    if (body.length < 10) { status.textContent = 'Please describe the issue in a little more detail.'; return; }
    btn.disabled = true;
    try {
      const r = await u.submitTicket({
        category: String(f.get('category') || 'other'), subject, body,
        name: String(f.get('name') || acc?.name || '').trim() || undefined,
        email: String(f.get('email') || '').trim() || undefined,
        phone: String(f.get('phone') || '').trim() || undefined,
        website: String(f.get('website') || ''),
        ...context,
      });
      form.reset();
      const reference = r?.ticket?.reference || '';
      toast('Sent — we’ll reply by e-mail.');
      openDialog(html`<div class="dlg-icon">${icon('check', { size: 26 })}</div><h2>Ticket sent</h2>
        <p class="muted">Thanks — our team has your request${reference ? html` (reference <b>${reference}</b>)` : ''}. ${acc ? 'You can follow the conversation below.' : 'We’ll reply to the e-mail you gave us.'}</p>
        <div class="row end"><button class="btn btn-primary" data-close>Done</button></div>`, { title: 'Ticket sent', cls: 'dialog-sm dlg-centered' });
      if (acc) { try { tickets = (await u.myTickets({ limit: 25 })).tickets || []; renderList(); } catch { /* ignore */ } }
    } catch (err) { status.textContent = friendly(err); }
    finally { btn.disabled = false; }
  });

  // Signed-in list: tapping a ticket opens its conversation.
  const renderList = () => { const list = $('#supList', ctx.root); if (list) list.innerHTML = tickets.length ? tickets.map(ticketRow).join('') : '<p class="muted sup-empty">No tickets yet — anything you send appears here.</p>'; };
  ctx.root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-ticket]');
    if (row) { openTicket(ctx, row.dataset.ticket, ''); return; }
    if (e.target.closest('#supLookup')) { askLookup(ctx); }
  });
  // Deep link from the receipt e-mail: /support?ticket=<id>&email=<address> (or with a reference).
  if (ctx.query.ticket) openTicket(ctx, ctx.query.ticket, String(ctx.query.email || '').toLowerCase());
  else if (ctx.query.reference) askLookup(ctx);
}

// One row in "Your tickets".
const ticketRow = (t) => {
  const [label, kind] = STATUS[t.status] || [t.status, ''];
  return html`<button class="row-link" data-ticket="${t.id}">${icon('chat', { size: 22 })}
    <span><b>${t.subject}</b><small>${labelFor(t.category)} · ${label} · updated ${timeAgo(t.updatedAt || t.createdAt)}${t.replies ? ` · ${t.replies} repl${t.replies === 1 ? 'y' : 'ies'}` : ''}</small></span>
    <span class="sup-ref">${t.reference || ref(t.id)}</span></button>`;
};

/** The conversation with support: the original message plus every reply. */
export async function openTicket(ctx, id, email) {
  const u = app.user;
  const { el } = openDialog(html`<h2>Your support ticket</h2><div id="tkBody"><div class="spinner" style="margin:20px auto"></div></div>`, { title: 'Support ticket' });
  const draw = async () => {
    const box = $('#tkBody', el); if (!box) return;
    let data;
    try { data = await u.ticket(id, email); }
    catch (err) { box.innerHTML = html`<p class="form-status">${friendly(err)}</p>`.s; return; }
    const t = data.ticket, replies = data.replies || [];
    const [label] = STATUS[t.status] || [t.status];
    box.innerHTML = html`<div class="tk-head"><b>${t.subject}</b><span class="pill">${label}</span></div>
      <p class="muted small">${labelFor(t.category)} · reference ${t.reference || ref(t.id)} · opened ${fmtDate(t.createdAt)}</p>
      <div class="tk-thread">
        <article class="tk-msg"><header><b>You</b><small>${fmtDate(t.createdAt)}</small></header><p>${t.body}</p></article>
        ${replies.map((r) => html`<article class="tk-msg ${r.author === 'admin' ? 'admin' : ''}"><header><b>${r.author === 'admin' ? 'ADDABAAZ Support' : 'You'}</b><small>${fmtDate(r.createdAt)}</small></header><p>${r.body}</p></article>`)}
      </div>
      ${t.status === 'closed' ? html`<p class="muted">This ticket is closed. Raise a new one if the issue is back.</p>`
        : html`<form class="form" id="tkReply"><label>Add a message<textarea name="body" rows="3" maxlength="4000" required placeholder="Add anything that helps — screenshots, payment id, what you tried."></textarea></label>
          <div class="row end"><button class="btn btn-primary" type="submit">Send reply</button></div></form>`}`.s;
    const replyForm = $('#tkReply', el);
    replyForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', replyForm);
      const body = String(new FormData(replyForm).get('body') || '').trim();
      if (body.length < 2) return;
      btn.disabled = true;
      try { await u.replyTicket(t.id, body, email); toast('Reply sent to support.'); await draw(); }
      catch (err) { toast(friendly(err)); btn.disabled = false; }
    });
  };
  await draw();
}

/** Guest lookup: the reference from our e-mail plus the e-mail address that raised the ticket. */
function askLookup(ctx) {
  const { el, close } = openDialog(html`<h2>Find my ticket</h2>
    <p class="muted">Use the reference from the e-mail we sent you (it looks like ADD-1A2B3C4D).</p>
    <form class="form" id="lkForm">
      <label>Reference<input name="reference" required autocapitalize="characters" autocomplete="off" placeholder="ADD-1A2B3C4D" value="${(ctx.query.reference || '').toUpperCase()}"></label>
      <label>E-mail you used<input name="email" type="email" required autocomplete="email" placeholder="name@example.com" value="${ctx.query.email || ''}"></label>
      <div class="form-status" id="lkStatus" role="alert"></div>
      <div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Open ticket</button></div></form>`, { title: 'Find my ticket', cls: 'dialog-sm' });
  $('#lkForm', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', el);
    const f = new FormData(e.target);
    const st = $('#lkStatus', el);
    st.textContent = '';
    btn.disabled = true;
    try {
      const r = await app.user.lookupTicket(String(f.get('reference') || ''), String(f.get('email') || ''));
      close();
      openTicket(ctx, r.ticket.id, String(f.get('email') || ''));
    } catch (err) { st.textContent = friendly(err); btn.disabled = false; }
  });
}
