import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { html, $, esc } from '../util.js';
import { icon } from '../icons.js';
import { img, sectionHeader } from '../ui/components.js';

async function studioData() {
  if (!app.studio) { const r = await fetch('data/studio.json'); if (!r.ok) throw new Error('Could not load studio info'); app.studio = await r.json(); }
  return app.studio;
}

export default async function studio(ctx) {
  const d = await studioData();
  ({ '/about': about, '/services': services, '/contact': contact }[ctx.path])(ctx, d);
}

function about(ctx, d) {
  ctx.setTitle('About');
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'About the production house', title: 'ADDABAAZ', subtitle: d.studio.tagline })}
    <div class="two-col">
      <div class="card-panel"><h2>আমাদের লক্ষ্য</h2><ul class="mission bn">${d.missionBn.map((m) => html`<li>${m}</li>`)}</ul></div>
      <div class="card-panel"><h2>Our mission</h2><ul class="mission">${d.missionEn.map((m) => html`<li>${m}</li>`)}</ul></div>
    </div>
    ${sectionHeader({ tag: 'The people behind ADDABAAZ', title: 'Leaders & team', subtitle: 'The creative minds shaping every ADDABAAZ story.' })}
    <div class="team-grid">${d.team.map((t) => html`<article class="team-card">${img(t.photo, t.name, { cls: 'team-photo' })}<div><div class="eyebrow">${t.role}</div><h3>${t.name}</h3>${t.quote ? html`<p class="quote">${t.quote}</p>` : ''}</div></article>`)}</div>
  </div>`.s;
}

function services(ctx, d) {
  ctx.setTitle('Services');
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'Capabilities & production', title: 'Our expertise', subtitle: 'Full-service film and commercial advertisement production based in Kolkata.' })}
    <div class="services">${d.services.map((s) => html`<article class="service"><span class="num">${s.num}</span><h3>${s.title}</h3><p>${s.text}</p></article>`)}</div>
    <section class="cta-band"><div><h2>Your vision. Our expertise.</h2><p>“Let’s make great films together.”</p></div><a class="btn btn-primary btn-lg" href="#/contact">Talk to us</a></section>
  </div>`.s;
}

function contact(ctx, d) {
  const s = d.studio;
  ctx.setTitle('Contact');
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'Collaborate', title: 'Initiate a project', subtitle: 'Reach out for production inquiries, commercial briefs, press relations, or general correspondence.' })}
    <div class="two-col contact">
      <form class="card-panel form" id="cf" novalidate>
        <h2>Project inquiry</h2>
        <label>Your name<input name="name" required autocomplete="name" placeholder="Enter your full name"></label>
        <label>Email address<input name="email" type="email" required autocomplete="email" placeholder="name@company.com"></label>
        <label>Phone / WhatsApp <small>(optional)</small><input name="phone" type="tel" autocomplete="tel" placeholder="+91 90000 00000"></label>
        <label>Project details / message<textarea name="message" rows="5" required placeholder="Describe your film, advertisement concept, or inquiry…"></textarea></label>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <label>Verification — type the characters shown
          <div class="captcha"><canvas id="cap" width="160" height="52" role="img" aria-label="Verification code"></canvas><input name="captcha" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code" required><button type="button" class="icon-btn" id="capr" aria-label="New code">${icon('next', { size: 18 })}</button></div></label>
        <div class="form-status" id="cs" role="status"></div>
        <button class="btn btn-primary btn-lg block" type="submit" id="csub">Send message</button>
        <p class="muted small">Your details are sent securely to our production desk and never shared with third parties.</p>
      </form>
      <div class="contact-cards">
        <div class="card-panel"><h3>Direct contact</h3>
          <a class="contact-line" href="mailto:${s.email}">${icon('mail', { size: 20 })}<span>${s.email}</span></a>
          ${s.phones.map((p) => html`<a class="contact-line" href="tel:${p.replace(/\s/g, '')}">${icon('phone', { size: 20 })}<span>${p}</span></a>`)}
          <a class="contact-line" href="https://wa.me/${s.whatsapp}?text=${encodeURIComponent("Hello ADDABAAZ, I'd like to discuss a project.")}" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp fa-lg"></i><span>WhatsApp us</span></a></div>
        <div class="card-panel"><h3>Headquarters</h3><a class="contact-line" href="${s.mapsUrl}" target="_blank" rel="noopener noreferrer">${icon('pin', { size: 20 })}<span>${s.address.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}</span></a></div>
        <div class="card-panel"><h3>Follow us</h3><div class="social-row">
          <a href="${s.social.youtube}" target="_blank" rel="noopener noreferrer" class="social-link"><i class="fab fa-youtube"></i> YouTube</a>
          <a href="${s.social.instagram}" target="_blank" rel="noopener noreferrer" class="social-link"><i class="fab fa-instagram"></i> Instagram</a>
          <a href="${s.social.facebook}" target="_blank" rel="noopener noreferrer" class="social-link"><i class="fab fa-facebook-f"></i> Facebook</a></div></div>
      </div>
    </div></div>`.s;

  // --- tiny canvas CAPTCHA (deters casual bots; the API adds rate-limiting + a honeypot) ---
  let code = '';
  const cv = $('#cap', ctx.root);
  const draw = () => {
    const c = cv.getContext('2d'); const W = cv.width, H = cv.height;
    code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    c.fillStyle = '#16161a'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) { c.strokeStyle = `hsla(${Math.random() * 360},60%,60%,.5)`; c.beginPath(); c.moveTo(Math.random() * W, Math.random() * H); c.lineTo(Math.random() * W, Math.random() * H); c.stroke(); }
    c.font = '700 28px "Plus Jakarta Sans", sans-serif'; c.textBaseline = 'middle';
    [...code].forEach((ch, i) => { c.save(); c.translate(16 + i * 28, H / 2); c.rotate((Math.random() - 0.5) * 0.5); c.fillStyle = `hsl(${Math.random() * 60 + 30},90%,70%)`; c.fillText(ch, 0, 0); c.restore(); });
  };
  draw(); $('#capr', ctx.root).addEventListener('click', draw); cv.addEventListener('click', draw);

  $('#cf', ctx.root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); const st = $('#cs', ctx.root), btn = $('#csub', ctx.root);
    const fail = (m, cls = 'error') => { st.textContent = m; st.className = 'form-status ' + cls; };
    if (f.website) return;                                        // honeypot
    if (!f.name.trim() || !f.email.trim() || !f.message.trim()) return fail('Please fill in your name, email and message.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return fail('Please enter a valid email address.');
    if (f.captcha.trim().toUpperCase() !== code) { draw(); e.target.captcha.value = ''; return fail('Incorrect code — here is a new one.'); }
    btn.disabled = true; btn.textContent = 'Sending…'; fail('', '');
    const payload = { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), message: f.message.trim() };
    try {
      if (app.api) await app.user.submitContact(payload);
      else if (CONFIG.googleForm?.action) {
        const g = CONFIG.googleForm.fields, body = new URLSearchParams();
        body.append(g.name, payload.name); body.append(g.email, payload.email); if (g.phone) body.append(g.phone, payload.phone); body.append(g.message, payload.message);
        await fetch(CONFIG.googleForm.action, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      } else throw new Error('Contact form is not connected.');
      fail('✓ Thank you! Your message has been received. We will get back to you shortly.', 'success');
      e.target.reset(); draw();
    } catch (err) { fail(`Something went wrong. Please email us directly at ${s.email}`); draw(); }
    finally { btn.disabled = false; btn.textContent = 'Send message'; }
  });
}
