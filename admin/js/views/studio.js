// Studio and team editor: the About / Services / Contact page content (changes go live immediately).
import { api } from '../api.js';
import { html, $, $$, icon, pageHead, formHtml, wireImages, toast, errMsg, guard, imgSrc } from '../ui.js';

// Textarea -> list of non-empty lines.
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export default async function studio(root, _p, ctx) {
  const cat = await api.get('/catalog'); if (ctx.stale()) return;
  const d = cat.studio || { studio: { name: 'ADDABAAZ', social: {} }, missionEn: [], missionBn: [], services: [], team: [] };
  const st = d.studio, soc = st.social || {};
  let services = [...(d.services || [])], team = [...(d.team || [])];

  const fld = (name, label, v = '', { wide = false, type = 'text', ph = '', max = 300 } = {}) => html`<div class="field ${wide ? 'wide' : ''}"><label for="s_${name}">${label}</label><input id="s_${name}" name="${name}" type="${type}" value="${v}" placeholder="${ph}" maxlength="${max}"></div>`;
  const area = (name, label, v, rows = 4, help = 'One per line') => html`<div class="field wide"><label for="s_${name}">${label}</label><textarea id="s_${name}" name="${name}" rows="${rows}">${(v || []).join('\n')}</textarea><small class="muted">${help}</small></div>`;

  const svcRow = (s, i) => html`<div class="rep" data-i="${i}"><div class="rep-fields"><input name="num" value="${s.num || ''}" placeholder="01" maxlength="4" class="tiny"><input name="title" value="${s.title || ''}" placeholder="Service name" maxlength="100"><textarea name="text" rows="2" placeholder="Short description" maxlength="600">${s.text || ''}</textarea></div>${repBtns(i, services.length, 'svc')}</div>`;
  const teamRow = (t, i) => html`<div class="rep team" data-i="${i}"><div class="rep-fields">${formHtml([{ k: 'photo', type: 'image', label: '', maxWidth: 600 }], t)}<div class="field"><input name="name" value="${t.name || ''}" placeholder="Name" maxlength="80"></div><div class="field"><input name="role" value="${t.role || ''}" placeholder="Role" maxlength="100"></div><div class="field wide"><textarea name="quote" rows="2" placeholder="Quote" maxlength="400">${t.quote || ''}</textarea></div></div>${repBtns(i, team.length, 'team')}</div>`;
  const repBtns = (i, n, kind) => html`<div class="rep-btns"><button type="button" class="icon-btn" data-rep="${kind}:up:${i}" ${i === 0 ? 'disabled' : ''} title="Move up">${icon('up', 16)}</button><button type="button" class="icon-btn" data-rep="${kind}:down:${i}" ${i === n - 1 ? 'disabled' : ''} title="Move down">${icon('down', 16)}</button><button type="button" class="icon-btn danger" data-rep="${kind}:del:${i}" title="Remove">${icon('trash', 16)}</button></div>`;

  root.innerHTML = html`${pageHead('Studio & team', 'The About, Services and Contact pages. Changes go live straight away.')}
    <form id="sf" novalidate>
      <div class="form-err" hidden></div>
      <section class="card"><h2>Studio</h2><div class="fields">
        ${fld('studioName', 'Studio name', st.name)}${fld('email', 'Contact email', st.email || '', { type: 'email', max: 254 })}
        ${fld('tagline', 'Tagline', st.tagline || '', { wide: true })}
        ${area('address', 'Address', st.address, 3)}${area('phones', 'Phone numbers', st.phones, 3)}
        ${fld('whatsapp', 'WhatsApp number (digits with country code)', st.whatsapp || '', { ph: '919876543210', max: 15 })}${fld('mapsUrl', 'Google Maps link', st.mapsUrl || '', { max: 500 })}
        ${fld('facebook', 'Facebook URL', soc.facebook || '', { max: 500 })}${fld('instagram', 'Instagram URL', soc.instagram || '', { max: 500 })}${fld('youtube', 'YouTube URL', soc.youtube || '', { max: 500 })}
      </div></section>
      <section class="card"><h2>Mission</h2><div class="fields">${area('missionEn', 'In English', d.missionEn, 6)}${area('missionBn', 'In Bengali', d.missionBn, 6)}</div></section>
      <section class="card"><div class="card-head"><h2>Services</h2><button type="button" class="btn sm" data-add="svc">${icon('plus', 14)} Add service</button></div><div id="svc"></div></section>
      <section class="card"><div class="card-head"><h2>Team</h2><button type="button" class="btn sm" data-add="team">${icon('plus', 14)} Add member</button></div><div id="team"></div></section>
      <div class="savebar"><button class="btn primary" type="submit">Save changes</button></div>
    </form>`.s;
  const form = $('#sf'), err = $('.form-err', form);

  const readRows = (box, fields) => $$('.rep', box).map((r) => Object.fromEntries(fields.map((f) => [f, r.querySelector(`[name=${f}]`).value.trim()])));
  const sync = () => { services = readRows($('#svc'), ['num', 'title', 'text']); team = readRows($('#team'), ['photo', 'name', 'role', 'quote']); };
  const paint = () => { $('#svc').innerHTML = services.map(svcRow).join('') || '<p class="empty">No services.</p>'; $('#team').innerHTML = team.map(teamRow).join('') || '<p class="empty">No team members.</p>'; wireImages(form); };
  paint();
  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'), rep = e.target.closest('[data-rep]');
    if (add) { sync(); (add.dataset.add === 'svc' ? services : team).push(add.dataset.add === 'svc' ? { num: String(services.length + 1).padStart(2, '0') } : {}); paint(); }
    if (rep) { sync(); const [kind, op, i] = rep.dataset.rep.split(':'), arr = kind === 'svc' ? services : team, n = Number(i); if (op === 'del') arr.splice(n, 1); else { const j = op === 'up' ? n - 1 : n + 1; [arr[n], arr[j]] = [arr[j], arr[n]]; } paint(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true; sync();
    const v = (n) => form.elements[n].value.trim();
    const social = Object.fromEntries(['facebook', 'instagram', 'youtube'].map((k) => [k, v(k)]).filter(([, x]) => x));
    const body = {
      studio: { name: v('studioName'), tagline: v('tagline'), address: lines(form.address.value), mapsUrl: v('mapsUrl'), email: v('email'), phones: lines(form.phones.value), whatsapp: v('whatsapp'), social },
      missionEn: lines(form.missionEn.value), missionBn: lines(form.missionBn.value),
      services: services.filter((s) => s.title || s.text).map((s) => ({ ...s })), team: team.filter((t) => t.name).map((t) => ({ ...t })),
    };
    await guard($('button[type=submit]', form), async () => {
      try { await api.put('/studio', body); toast('Studio profile saved'); } catch (x) { err.textContent = errMsg(x); err.hidden = false; err.scrollIntoView({ block: 'center' }); }
    });
  });
}
