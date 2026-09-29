import { api, putFile } from '../api.js';
import { html, raw, $, $$, icon, badge, empty, pager, pageHead, formModal, confirmBox, guard, toast, errMsg, imgSrc, fmtDur, parseDur, fmtDT, slug, ytId, plural, esc } from '../ui.js';

const SHOW_TYPES = [['series', 'Series'], ['standup', 'Stand-up'], ['podcast', 'Podcast'], ['film', 'Film']].map(([v, l]) => ({ v, l }));
const ACCESS = [{ v: 'free', l: 'Free' }, { v: 'premium', l: 'Premium (login + paid plan)' }];
const KINDS = [['episode', 'Episode'], ['reel', 'Reel'], ['clip', 'Clip'], ['trailer', 'Trailer']].map(([v, l]) => ({ v, l }));
const thumb = (v) => v.thumbnail ? imgSrc(v.thumbnail) : v.source?.type === 'youtube' ? `https://i.ytimg.com/vi/${v.source.id}/default.jpg` : '';
const PAGE = 25;

export default async function content(root, [section], ctx) {
  let data = await api.get('/catalog');
  if (ctx.stale()) return;
  const reload = async () => { data = await api.get('/catalog'); if (!ctx.stale()) draw(); };
  const draw = () => VIEWS[section]();
  const mutate = async (fn, ok) => { try { await fn(); toast(ok); await reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const videosOf = (id) => data.videos.filter((v) => v.showId === id);
  const showTitle = (id) => { const s = data.shows.find((x) => x.id === id) || data.upcoming.find((x) => x.id === id); return s ? (s.titleEn || s.title) : ''; };
  const move = (list, id, dir) => {
    const ids = list.map((x) => x.id), i = ids.indexOf(id), j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; return mutate(() => api.put(`/catalog/${section}/order`, { ids }), 'Order saved');
  };
  const note = 'Changes go live on the site straight away.';

  /* ---------- shows ---------- */
  const showFields = (create) => [
    { k: 'id', label: 'ID (used in links)', req: true, readonly: !create, max: 64, help: create ? 'Letters, digits, - and _. Can’t be changed later.' : '' },
    { k: 'title', label: 'Title', req: true }, { k: 'titleEn', label: 'Title in English' },
    { k: 'type', label: 'Type', type: 'select', options: SHOW_TYPES, dflt: 'series' },
    { k: 'status', label: 'Status', type: 'select', options: [{ v: 'ongoing', l: 'Ongoing' }, { v: 'completed', l: 'Completed' }, { v: 'paused', l: 'Paused' }], dflt: 'ongoing' },
    { k: 'access', label: 'Access', type: 'select', options: ACCESS, dflt: 'free' },
    { k: 'language', label: 'Language' }, { k: 'year', label: 'Year', type: 'number', min: 1900, max: 2100 },
    { k: 'genres', label: 'Genres', type: 'tags', wide: true }, { k: 'cast', label: 'Cast', type: 'tags', wide: true },
    { k: 'tagline', label: 'Tagline', wide: true, max: 300 }, { k: 'description', label: 'Description', type: 'textarea', req: true, wide: true },
    { k: 'featured', label: 'Feature on the home page (needs at least one episode)', type: 'bool', wide: true },
    { k: 'poster', label: 'Poster (card)', type: 'image', req: true, maxWidth: 700, wide: true }, { k: 'posterLg', label: 'Poster (large / hero)', type: 'image', maxWidth: 1600, wide: true },
  ];
  const editShow = (s) => {
    const create = !s;
    formModal({ title: create ? 'New show' : `Edit “${s.titleEn || s.title}”`, wide: true, fields: showFields(create), values: s || { type: 'series', status: 'ongoing', access: 'free', year: new Date().getFullYear() }, note,
      extra: (form) => { if (create) { let touched = false; form.id.addEventListener('input', () => { touched = true; }); form.titleEn.addEventListener('input', () => { if (!touched) form.id.value = slug(form.titleEn.value); }); } },
      onSubmit: async (v) => { create ? await api.post('/catalog/shows', v) : await api.put(`/catalog/shows/${encodeURIComponent(s.id)}`, v); toast(create ? 'Show created' : 'Show saved'); await reload(); } });
  };
  const deleteShow = async (s) => {
    const n = videosOf(s.id).length;
    if (!(await confirmBox({ title: `Delete “${s.titleEn || s.title}”?`, text: n ? `This also deletes its ${plural(n, 'video')} (episodes, reels…) and removes them from viewers’ lists. This can’t be undone.` : 'This can’t be undone.', confirm: n ? `Delete show and ${n} videos` : 'Delete', danger: true }))) return;
    mutate(() => api.del(`/catalog/shows/${encodeURIComponent(s.id)}${n ? '?cascade=1' : ''}`), 'Show deleted');
  };
  const orderBtns = (id, i, n) => html`<button class="icon-btn" data-move="${id}:-1" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 16)}</button><button class="icon-btn" data-move="${id}:1" title="Move down" ${i === n - 1 ? 'disabled' : ''}>${icon('down', 16)}</button>`;
  const wireMoves = (list) => $$('[data-move]', root).forEach((b) => b.onclick = () => { const [id, d] = b.dataset.move.split(':'); move(list, id, Number(d)); });

  function drawShows() {
    root.innerHTML = html`${pageHead('Shows', note, html`<button class="btn primary" id="new">${icon('plus', 16)} New show</button>`)}
      <div class="card flush">${data.shows.length ? html`<table class="tbl"><thead><tr><th></th><th>Show</th><th>Type</th><th>Videos</th><th>Access</th><th class="end">Order</th><th></th></tr></thead><tbody>
      ${data.shows.map((s, i) => html`<tr><td class="thumb"><img src="${imgSrc(s.poster)}" alt="" loading="lazy"></td>
        <td><strong>${s.titleEn || s.title}</strong>${s.titleEn ? html`<br><small class="muted bn">${s.title}</small>` : ''}${s.featured ? html` ${badge('featured', 'gold')}` : ''}</td>
        <td>${s.type}<br><small class="muted">${s.status}</small></td><td>${videosOf(s.id).length}</td><td>${s.access === 'premium' ? badge('premium', 'gold') : badge('free')}</td>
        <td class="end nowrap">${orderBtns(s.id, i, data.shows.length)}</td>
        <td class="end nowrap"><a class="icon-btn" href="/#/show/${s.id}" target="_blank" rel="noopener" title="View on site">${icon('external', 16)}</a><button class="icon-btn" data-edit="${s.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${s.id}" title="Delete">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>` : empty('No shows yet.')}</div>`.s;
    $('#new').onclick = () => editShow(null);
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editShow(data.shows.find((s) => s.id === b.dataset.edit)));
    $$('[data-del]', root).forEach((b) => b.onclick = () => deleteShow(data.shows.find((s) => s.id === b.dataset.del)));
    wireMoves(data.shows);
  }

  /* ---------- videos ---------- */
  const F = { q: '', show: '', kind: '', access: '', offset: 0 };
  const showOptions = () => [{ v: '', l: '— none (studio-wide) —' }, ...data.shows.map((s) => ({ v: s.id, l: s.titleEn || s.title })), ...data.upcoming.map((u) => ({ v: u.id, l: `(coming soon) ${u.titleEn || u.title}` }))];
  const sourceField = () => ({
    type: 'custom',
    render: (v) => {
      const s = v.source || { type: 'youtube' };
      return html`<div class="field wide src"><label>Video source <em>*</em></label>
        <select name="srcType"><option value="youtube" ${s.type === 'youtube' ? 'selected' : ''}>YouTube (free videos)</option><option value="r2" ${s.type === 'r2' ? 'selected' : ''}>Premium video in Cloudflare R2</option><option value="mp4" ${s.type === 'mp4' ? 'selected' : ''}>MP4 link</option><option value="hls" ${s.type === 'hls' ? 'selected' : ''}>HLS link (.m3u8)</option></select>
        <div data-for="youtube"><input name="ytUrl" placeholder="YouTube link or the 11-character id" value="${s.type === 'youtube' ? s.id : ''}"></div>
        <div data-for="r2"><div class="row wrap"><input name="r2Key" class="grow" placeholder="premium/show-name/episode-6.mp4" value="${s.type === 'r2' ? s.key : ''}"><label class="btn sm">${icon('upload', 16)} Upload video<input type="file" name="r2File" accept="video/mp4,video/webm,.mp4,.m4v,.webm" hidden></label></div>
          <progress max="1" value="0" hidden></progress><small class="muted r2-st">Pick a file to upload it straight to your private bucket, or type the key of a file (or an HLS <code>.m3u8</code>) you uploaded another way.</small>
          <select name="r2Format"><option value="" ${!s.format ? 'selected' : ''}>Format: detect from the file name</option><option value="mp4" ${s.format === 'mp4' ? 'selected' : ''}>Force MP4</option><option value="hls" ${s.format === 'hls' ? 'selected' : ''}>Force HLS</option></select></div>
        <div data-for="url"><input name="srcUrl" placeholder="https://…" value="${s.type === 'mp4' || s.type === 'hls' ? s.url : ''}"></div></div>`;
    },
    read: (f) => {
      const t = f.elements.srcType.value;
      if (t === 'youtube') return { source: { type: 'youtube', id: ytId(f.elements.ytUrl.value) || f.elements.ytUrl.value.trim() } };
      if (t === 'r2') return { source: { type: 'r2', key: f.elements.r2Key.value.trim(), ...(f.elements.r2Format.value ? { format: f.elements.r2Format.value } : {}) } };
      return { source: { type: t, url: f.elements.srcUrl.value.trim() } };
    },
  });
  const videoFields = (create) => [
    { k: 'kind', label: 'Kind', type: 'select', options: KINDS, dflt: 'episode' },
    { k: 'showId', label: 'Show', type: 'select', options: showOptions() },
    { k: 'title', label: 'Title', req: true, wide: true, max: 300 }, { k: 'shortTitle', label: 'Short title (optional, shown on cards)', wide: true, max: 120 },
    { k: 'episode', label: 'Episode number', type: 'number', min: 1, help: 'Episodes only.' },
    { k: 'access', label: 'Access', type: 'select', options: ACCESS, dflt: 'free', help: 'Premium needs the video hosted in R2.' },
    sourceField(),
    { k: 'thumbnail', label: 'Thumbnail', type: 'image', maxWidth: 1000, wide: true, help: 'Required for R2 videos; YouTube videos use their own thumbnail.' },
    { k: 'duration', label: 'Duration (mm:ss)', req: true, placeholder: '12:34' }, { k: 'publishedAt', label: 'Published', type: 'datetime', req: true },
    { k: 'views', label: 'Views', type: 'number', min: 0 },
    { k: 'id', label: 'ID', req: true, readonly: !create, max: 64, help: create ? 'Filled in automatically; letters, digits, - and _.' : '', wide: true },
  ];
  const editVideo = (v) => {
    const create = !v;
    const base = v ? { ...v, duration: fmtDur(v.duration) } : { kind: 'episode', access: 'free', source: { type: 'youtube' }, publishedAt: new Date().toISOString(), views: 0, showId: F.show || '' };
    formModal({ title: create ? 'New video' : 'Edit video', wide: true, fields: videoFields(create), values: base, note,
      extra: (form, m) => {
        const sync = () => { const t = form.srcType.value; $$('[data-for]', form).forEach((d) => { d.hidden = d.dataset.for !== (t === 'mp4' || t === 'hls' ? 'url' : t); }); if (t === 'r2' && form.access.value === 'free' && create) form.access.value = 'premium'; };
        form.srcType.addEventListener('change', sync); sync();
        let touched = !create; form.id.addEventListener('input', () => { touched = true; });
        const autoId = () => { if (touched) return; const y = form.srcType.value === 'youtube' ? ytId(form.ytUrl.value) : ''; form.id.value = y || slug(`${showTitle(form.showId.value)} ${form.title.value} ${form.episode.value}`) || ''; };
        for (const n of ['ytUrl', 'title', 'episode', 'showId', 'srcType']) form.elements[n].addEventListener('input', autoId);
        form.r2File.addEventListener('change', async () => {
          const f = form.r2File.files[0]; if (!f) return; const bar = $('progress', form), st = $('.r2-st', form); bar.hidden = false; bar.value = 0; st.textContent = 'Preparing upload…';
          try {
            const j = await api.post('/uploads/video', { filename: f.name, size: f.size, slug: showTitle(form.showId.value) || form.title.value });
            st.textContent = 'Uploading… keep this window open.'; await putFile(j.uploadUrl, f, (p) => { bar.value = p; st.textContent = `Uploading… ${Math.round(p * 100)}%`; });
            form.r2Key.value = j.key; st.textContent = `Uploaded ✓ (${(f.size / 1048576).toFixed(0)} MB) — key ${j.key}`; form.access.value = 'premium'; autoId();
            if (!parseDur(form.duration.value)) { const vid = document.createElement('video'); vid.preload = 'metadata'; vid.onloadedmetadata = () => { if (!form.duration.value.trim() || form.duration.value === '0:00') form.duration.value = fmtDur(vid.duration); URL.revokeObjectURL(vid.src); }; vid.src = URL.createObjectURL(f); }
          } catch (e) { st.textContent = ''; bar.hidden = true; toast(errMsg(e), 'err'); } finally { form.r2File.value = ''; }
        });
      },
      onSubmit: async (val) => {
        const d = parseDur(val.duration); if (Number.isNaN(d)) throw new Error('Duration must look like 12:34 (or a number of seconds).');
        const body = { ...val, duration: d, episode: val.kind === 'episode' ? val.episode : '', showId: val.showId || '' };
        if (create) await api.post('/catalog/videos', body); else await api.put(`/catalog/videos/${encodeURIComponent(v.id)}`, body);
        toast(create ? 'Video added' : 'Video saved'); await reload();
      } });
  };
  function drawVideos() {
    root.innerHTML = html`${pageHead('Videos & reels', note, html`<button class="btn primary" id="new">${icon('plus', 16)} New video</button>`)}
      <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Search titles…" value="${F.q}"></div>
        <select id="fshow"><option value="">All shows</option>${data.shows.map((s) => html`<option value="${s.id}" ${F.show === s.id ? 'selected' : ''}>${s.titleEn || s.title}</option>`)}<option value="_none" ${F.show === '_none' ? 'selected' : ''}>No show</option></select>
        <select id="fkind"><option value="">All kinds</option>${KINDS.map((k) => html`<option value="${k.v}" ${F.kind === k.v ? 'selected' : ''}>${k.l}s</option>`)}</select>
        <select id="facc"><option value="">Free & premium</option><option value="premium" ${F.access === 'premium' ? 'selected' : ''}>Premium only</option><option value="free" ${F.access === 'free' ? 'selected' : ''}>Free only</option></select></div>
      <div id="list"></div>`.s;
    $('#new').onclick = () => editVideo(null);
    const set = (k, el, ev) => el.addEventListener(ev, () => { F[k] = el.value; F.offset = 0; drawList(); });
    set('q', $('#q'), 'input'); set('show', $('#fshow'), 'change'); set('kind', $('#fkind'), 'change'); set('access', $('#facc'), 'change');
    drawList();
  }
  function drawList() {
    const q = F.q.trim().toLowerCase();
    const rows = data.videos.filter((v) => (!q || `${v.title} ${v.shortTitle || ''} ${v.id}`.toLowerCase().includes(q)) && (!F.show || (F.show === '_none' ? !v.showId : v.showId === F.show)) && (!F.kind || v.kind === F.kind) && (!F.access || v.access === F.access))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const pageRows = rows.slice(F.offset, F.offset + PAGE);
    $('#list').innerHTML = html`<div class="card flush">${rows.length ? html`<table class="tbl"><thead><tr><th></th><th>Title</th><th>Show</th><th>Duration</th><th>Published</th><th class="end">Views</th><th></th></tr></thead><tbody>
      ${pageRows.map((v) => html`<tr><td class="thumb wide">${thumb(v) ? html`<img src="${thumb(v)}" alt="" loading="lazy">` : ''}</td>
        <td class="title-cell"><strong class="clip">${v.shortTitle || v.title}</strong><br>${badge(v.kind === 'episode' && v.episode ? `EP ${v.episode}` : v.kind)} ${v.access === 'premium' ? badge('premium', 'gold') : ''} ${v.source.type === 'r2' ? badge('R2') : ''}</td>
        <td>${showTitle(v.showId) || html`<span class="muted">—</span>`}</td><td>${fmtDur(v.duration)}</td><td class="small">${fmtDT(v.publishedAt)}</td><td class="end">${v.views.toLocaleString('en-IN')}</td>
        <td class="end nowrap"><a class="icon-btn" href="/#/watch/${v.id}" target="_blank" rel="noopener" title="Open on site">${icon('external', 16)}</a><button class="icon-btn" data-edit="${v.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${v.id}" title="Delete">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>` : empty('No videos match.')}</div>
      ${pager({ total: rows.length, offset: F.offset, limit: PAGE })}`.s;
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editVideo(data.videos.find((v) => v.id === b.dataset.edit)));
    $$('[data-del]', root).forEach((b) => b.onclick = async () => {
      const v = data.videos.find((x) => x.id === b.dataset.del);
      if (await confirmBox({ title: 'Delete this video?', text: `“${v.shortTitle || v.title}” will disappear from the site and from viewers’ lists${v.source.type === 'r2' ? '. The file stays in your R2 bucket (delete it there to save storage)' : ''}.`, confirm: 'Delete', danger: true })) mutate(() => api.del(`/catalog/videos/${encodeURIComponent(v.id)}`), 'Video deleted');
    });
    $$('[data-page]', root).forEach((b) => b.onclick = () => { F.offset = Number(b.dataset.page); drawList(); window.scrollTo(0, 0); });
  }

  /* ---------- coming soon ---------- */
  const upFields = (create) => [
    { k: 'id', label: 'ID', req: true, readonly: !create, max: 64, help: create ? 'Letters, digits, - and _.' : '' }, { k: 'title', label: 'Title', req: true }, { k: 'titleEn', label: 'Title in English' },
    { k: 'type', label: 'Type', type: 'select', options: SHOW_TYPES, dflt: 'series' }, { k: 'genres', label: 'Genres', type: 'tags' }, { k: 'note', label: 'Note (e.g. “New comedy web series”)', wide: true, max: 200 },
    { k: 'poster', label: 'Poster (card)', type: 'image', req: true, maxWidth: 700, wide: true }, { k: 'posterLg', label: 'Poster (large)', type: 'image', wide: true }, { k: 'backdrop', label: 'Backdrop (wide, optional)', type: 'image', wide: true },
  ];
  const editUp = (u) => {
    const create = !u;
    formModal({ title: create ? 'New coming-soon title' : `Edit “${u.titleEn || u.title}”`, wide: true, fields: upFields(create), values: u || { type: 'series' }, note,
      extra: (form) => { if (create) { let t = false; form.id.addEventListener('input', () => { t = true; }); form.titleEn.addEventListener('input', () => { if (!t) form.id.value = slug(form.titleEn.value); }); } },
      onSubmit: async (v) => { create ? await api.post('/catalog/upcoming', v) : await api.put(`/catalog/upcoming/${encodeURIComponent(u.id)}`, v); toast('Saved'); await reload(); } });
  };
  function drawUpcoming() {
    root.innerHTML = html`${pageHead('Coming soon', note, html`<button class="btn primary" id="new">${icon('plus', 16)} New title</button>`)}
      <div class="card flush">${data.upcoming.length ? html`<table class="tbl"><thead><tr><th></th><th>Title</th><th>Type</th><th class="end">Order</th><th></th></tr></thead><tbody>${data.upcoming.map((u, i) => html`<tr><td class="thumb"><img src="${imgSrc(u.poster)}" alt="" loading="lazy"></td><td><strong>${u.titleEn || u.title}</strong>${u.titleEn ? html`<br><small class="muted bn">${u.title}</small>` : ''}${u.note ? html`<br><small class="muted">${u.note}</small>` : ''}</td><td>${u.type}</td><td class="end nowrap">${orderBtns(u.id, i, data.upcoming.length)}</td>
        <td class="end nowrap"><button class="icon-btn" data-edit="${u.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${u.id}" title="Delete">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>` : empty('Nothing announced.')}</div>`.s;
    $('#new').onclick = () => editUp(null);
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editUp(data.upcoming.find((u) => u.id === b.dataset.edit)));
    $$('[data-del]', root).forEach((b) => b.onclick = async () => { const u = data.upcoming.find((x) => x.id === b.dataset.del); if (await confirmBox({ title: `Delete “${u.titleEn || u.title}”?`, text: 'Viewers’ reminders and list entries for it are removed too.', confirm: 'Delete', danger: true })) mutate(() => api.del(`/catalog/upcoming/${encodeURIComponent(u.id)}`), 'Deleted'); });
    wireMoves(data.upcoming);
  }

  /* ---------- gallery ---------- */
  const galFields = (create) => [
    { k: 'id', label: 'ID', req: true, readonly: !create, max: 64, help: create ? 'Filled in for you; letters, digits, - and _.' : '' }, { k: 'group', label: 'Group (album)', req: true, max: 60, help: 'Photos with the same group are shown together.' },
    { k: 'image', label: 'Photo (thumbnail)', type: 'image', req: true, maxWidth: 700, wide: true }, { k: 'imageLg', label: 'Photo (large)', type: 'image', maxWidth: 1800, wide: true }, { k: 'caption', label: 'Caption', wide: true, max: 200 },
  ];
  const editPhoto = (g) => {
    const create = !g;
    formModal({ title: create ? 'Add photo' : 'Edit photo', wide: true, fields: galFields(create), values: g || { group: data.gallery.at(-1)?.group || '' }, note,
      extra: (form) => { if (create) { form.id.value = 'photo-' + Date.now().toString(36); } },
      onSubmit: async (v) => { create ? await api.post('/catalog/gallery', v) : await api.put(`/catalog/gallery/${encodeURIComponent(g.id)}`, v); toast('Saved'); await reload(); } });
  };
  function drawGallery() {
    root.innerHTML = html`${pageHead('Gallery', note, html`<button class="btn primary" id="new">${icon('plus', 16)} Add photo</button>`)}
      ${data.gallery.length ? html`<div class="photos">${data.gallery.map((g, i) => html`<figure class="photo"><img src="${imgSrc(g.image)}" alt="" loading="lazy"><figcaption><strong>${g.group}</strong><small class="muted">${g.caption || ''}</small></figcaption>
        <div class="photo-actions"><button class="icon-btn" data-move="${g.id}:-1" ${i === 0 ? 'disabled' : ''} title="Move earlier">${icon('left', 16)}</button><button class="icon-btn" data-move="${g.id}:1" ${i === data.gallery.length - 1 ? 'disabled' : ''} title="Move later">${icon('right', 16)}</button><button class="icon-btn" data-edit="${g.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${g.id}" title="Delete">${icon('trash', 16)}</button></div></figure>`)}</div>` : html`<div class="card">${empty('No photos yet.')}</div>`}`.s;
    $('#new').onclick = () => editPhoto(null);
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editPhoto(data.gallery.find((g) => g.id === b.dataset.edit)));
    $$('[data-del]', root).forEach((b) => b.onclick = async () => { if (await confirmBox({ title: 'Delete this photo?', confirm: 'Delete', danger: true })) mutate(() => api.del(`/catalog/gallery/${encodeURIComponent(b.dataset.del)}`), 'Photo deleted'); });
    wireMoves(data.gallery);
  }

  const VIEWS = { shows: drawShows, videos: drawVideos, upcoming: drawUpcoming, gallery: drawGallery };
  draw();
}
