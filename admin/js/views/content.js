// Catalog management: shows, videos (free or premium), upcoming titles and the gallery. One page module handles all four sections; `section` comes from the URL.
import { api, putFile } from '../api.js';
import { html, raw, $, $$, icon, badge, empty, pager, pageHead, openModal, formModal, confirmBox, guard, toast, errMsg, imgSrc, fmtDur, parseDur, fmtDT, fmtD, slug, ytId, plural, esc } from '../ui.js';

// Option lists for the forms.
const SHOW_TYPES = [['series', 'Series'], ['standup', 'Stand-up'], ['podcast', 'Podcast'], ['film', 'Film']].map(([v, l]) => ({ v, l }));
const ACCESS = [{ v: 'free', l: 'Free' }, { v: 'premium', l: 'Premium (login + paid plan)' }];
const KINDS = [['episode', 'Episode'], ['reel', 'Reel'], ['clip', 'Clip'], ['trailer', 'Trailer']].map(([v, l]) => ({ v, l }));
// Thumbnail URL for a video row (custom image, else YouTube's).
const thumb = (v) => v.thumbnail ? imgSrc(v.thumbnail) : v.source?.type === 'youtube' ? `https://i.ytimg.com/vi/${v.source.id}/default.jpg` : '';
// Rows per page in lists.
const PAGE = 25;
const HOME_POSTER_DEFAULTS = { releasingThisMonth: 'media/upcoming/durga-lg.webp', releasingThisMonthMobile: 'media/upcoming/durga-sm.webp' };

// Draws the chosen section's list plus its add/edit dialogs. Saving calls the admin API and reloads the list.
export default async function content(root, [section], ctx) {
  let data, youtubeImports = { last: null, todayVideoIds: [] }, youtubeHistoryError = '';
  const load = async () => {
    data = await api.get('/catalog');
    youtubeHistoryError = '';
    if (section === 'videos') {
      try { youtubeImports = await api.get('/catalog/youtube/imports'); }
      catch (e) { youtubeImports = { last: null, todayVideoIds: [] }; youtubeHistoryError = errMsg(e); }
    }
  };
  await load();
  if (ctx.stale()) return;
  const reload = async () => { await load(); if (!ctx.stale()) draw(); };
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
    { k: 'tagline', label: 'Tagline', wide: true, max: 300, help: 'One line. Shown under the title and used in Google results — about 60–120 characters works best.' },
    { k: 'description', label: 'Description', type: 'textarea', req: true, wide: true, help: 'Google shows roughly the first 155 characters — put the hook first, and name the show, genre and language.' },
    ratingField,
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

  // Shows list and editor.
  function drawShows() {
    root.innerHTML = html`${pageHead('Shows', note, html`<button class="btn primary" id="new">${icon('plus', 16)} New show</button>`)}
      <div class="card flush">${data.shows.length ? html`<table class="tbl"><thead><tr><th></th><th>Show</th><th>Type</th><th>Videos</th><th>Access</th><th class="end">Order</th><th></th></tr></thead><tbody>
      ${data.shows.map((s, i) => html`<tr><td class="thumb"><img src="${imgSrc(s.poster)}" alt="" loading="lazy"></td>
        <td><strong>${s.titleEn || s.title}</strong>${s.titleEn ? html`<br><small class="muted bn">${s.title}</small>` : ''}${s.featured ? html` ${badge('featured', 'gold')}` : ''}</td>
        <td>${s.type}<br><small class="muted">${s.status}</small></td><td>${videosOf(s.id).length}</td><td>${s.access === 'premium' ? badge('premium', 'gold') : badge('free')}</td>
        <td class="end nowrap">${orderBtns(s.id, i, data.shows.length)}</td>
        <td class="end nowrap"><a class="icon-btn" href="/show/${s.id}" target="_blank" rel="noopener" title="View on site">${icon('external', 16)}</a><button class="icon-btn" data-edit="${s.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${s.id}" title="Delete">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>` : empty('No shows yet.')}</div>`.s;
    $('#new').onclick = () => editShow(null);
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editShow(data.shows.find((s) => s.id === b.dataset.edit)));
    $$('[data-del]', root).forEach((b) => b.onclick = () => deleteShow(data.shows.find((s) => s.id === b.dataset.del)));
    wireMoves(data.shows);
  }

  /* ---------- videos ---------- */
  const F = { q: '', show: '', kind: '', access: '', source: '', rating: '', duration: '', visibility: '', offset: 0 };
  const selectedVideoIds = new Set();
  const MAX_VIDEO_SELECTION = 500;
  const videoVisibility = (v) => v.hidden ? 'hidden' : v.publishAt && Date.parse(v.publishAt) > Date.now() ? 'scheduled' : 'visible';
  const showOptions = () => [{ v: '', l: '— none (studio-wide) —' }, ...data.shows.map((s) => ({ v: s.id, l: s.titleEn || s.title })), ...data.upcoming.map((u) => ({ v: u.id, l: `(coming soon) ${u.titleEn || u.title}` }))];
  const RATING_OPTS = [{ v: '', l: 'Not rated (hidden from Kids profiles)' }, { v: 'U', l: 'U — everyone' }, { v: '7+', l: '7+' }, { v: '13+', l: '13+' }, { v: '16+', l: '16+' }, { v: '18+', l: '18+' }];
  const ratingField = { k: 'rating', label: 'Maturity rating', type: 'select', options: RATING_OPTS, help: 'Kids profiles show only titles rated U or 7+.' };
  const subRow = (t = {}) => html`<div class="sub-row row wrap"><input name="subLang" class="sm-in" placeholder="bn" maxlength="12" value="${t.lang || ''}" aria-label="Language code"><input name="subLabel" placeholder="Bengali" maxlength="40" value="${t.label || ''}" aria-label="Label"><input name="subUrl" class="grow" placeholder="uploaded file or https://….vtt" maxlength="500" value="${t.url || ''}" aria-label="File"><label class="btn sm">${icon('upload', 14)}<input type="file" name="subFile" accept=".srt,.vtt,text/vtt" hidden></label><button type="button" class="icon-btn danger" data-rm title="Remove">${icon('x', 14)}</button></div>`;
  const subtitlesField = () => ({
    type: 'custom',
    render: (v) => html`<div class="field wide"><label>Subtitles <small class="muted">(optional · .srt or .vtt — plays with the caption button in the player; free YouTube videos use YouTube’s own captions)</small></label><div class="sub-rows">${(v.subtitles || []).map(subRow)}</div><button type="button" class="btn sm" data-add-sub>${icon('plus', 14)} Add subtitle track</button></div>`,
    read: (f) => ({ subtitles: [...f.querySelectorAll('.sub-row')].map((r) => ({ lang: r.querySelector('[name=subLang]').value.trim().toLowerCase(), label: r.querySelector('[name=subLabel]').value.trim(), url: r.querySelector('[name=subUrl]').value.trim() })).filter((t) => t.lang || t.label || t.url) }),
  });
  const wireSubtitles = (form) => {
    const rows = form.querySelector('.sub-rows');
    form.querySelector('[data-add-sub]').onclick = () => rows.insertAdjacentHTML('beforeend', subRow().s);
    rows.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.sub-row').remove(); });
    rows.addEventListener('change', async (e) => {
      if (e.target.name !== 'subFile' || !e.target.files[0]) return; const row = e.target.closest('.sub-row');
      try { const r = await api.uploadSubtitle(e.target.files[0]); row.querySelector('[name=subUrl]').value = r.path; toast(`Uploaded — ${r.cues} cues`); } catch (x) { toast(errMsg(x), 'err'); } finally { e.target.value = ''; }
    });
  };
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
    { k: 'description', label: 'Description for Google (optional)', type: 'textarea', wide: true, max: 500, help: 'One or two sentences about this video (120–155 characters is ideal). Episodes get an automatic description from their show if this is empty; reels are kept out of Google unless you write one.' },
    { k: 'episode', label: 'Episode number', type: 'number', min: 1, help: 'Episodes only.' },
    { k: 'access', label: 'Access', type: 'select', options: ACCESS, dflt: 'free', help: 'Premium needs the video hosted in R2.' },
    sourceField(),
    { k: 'thumbnail', label: 'Thumbnail', type: 'image', maxWidth: 1000, wide: true, help: 'Required for R2 videos; YouTube videos use their own thumbnail.' },
    { k: 'duration', label: 'Duration (mm:ss)', req: true, placeholder: '12:34', help: 'The public YouTube feed has no duration. Imported videos show — until you enter the real runtime here.' }, { k: 'publishedAt', label: 'Published', type: 'datetime', req: true },
    { k: 'publishAt', label: 'Publish at (optional)', type: 'datetime', help: 'Leave empty to publish now. A future time hides the video from viewers, Google and the API until then — admins still see it, and followers get a notification when it goes live.' },
    { k: 'hidden', label: 'Hide from the public website', type: 'bool', wide: true, help: 'Hidden videos stay in the admin catalog and can be restored later.' },
    ratingField, subtitlesField(),
    { k: 'views', label: 'Views', type: 'number', min: 0 },
    { k: 'id', label: 'ID', req: true, readonly: !create, max: 64, help: create ? 'Filled in automatically; letters, digits, - and _.' : '', wide: true },
  ];
  const editVideo = (v) => {
    const create = !v;
    const base = v ? { ...v, duration: fmtDur(v.duration) } : { kind: 'episode', access: 'free', source: { type: 'youtube' }, publishedAt: new Date().toISOString(), views: 0, showId: F.show || '' };
    formModal({ title: create ? 'New video' : 'Edit video', wide: true, fields: videoFields(create), values: base, note,
      extra: (form, m) => {
        const sync = () => { const t = form.srcType.value; $$('[data-for]', form).forEach((d) => { d.hidden = d.dataset.for !== (t === 'mp4' || t === 'hls' ? 'url' : t); }); if (t === 'r2' && form.access.value === 'free' && create) form.access.value = 'premium'; };
        form.srcType.addEventListener('change', sync); sync(); wireSubtitles(form);
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
  const youtubeKindLabel = (v) => v.source?.type === 'youtube' && v.kind === 'reel' ? 'Reel / Short'
    : v.source?.type === 'youtube' && v.kind === 'clip' ? 'Landscape video'
      : v.kind === 'episode' && v.episode ? `EP ${v.episode}` : v.kind;

  function openYoutubePreview(preview) {
    const items = Array.isArray(preview.items) ? preview.items : [];
    const newItems = items.filter((v) => !v.alreadyImported);
    const selected = new Set(newItems.map((v) => v.id));
    const kinds = new Map(items.map((v) => [v.id, v.suggestedKind === 'reel' ? 'reel' : 'clip']));
    const PAGE_SIZE = 25, IMPORT_CHUNK = 100;
    let query = '', filter = 'all', page = 0, submitting = false, batchId = null;
    const m = openModal(html`
      <p class="muted">All public uploads from the channel are checked against the catalog. Choose missing videos to add; set each one to <strong>Reel / Short</strong> or <strong>Landscape video</strong>. The title-based kind is only a suggestion.</p>
      <div class="yt-preview-summary muted small" id="ytPreviewSummary"></div>
      <div class="yt-preview-tools row wrap">
        <div class="search">${icon('search', 16)}<input id="ytPreviewSearch" type="search" placeholder="Search all channel videos…"></div>
        <select id="ytPreviewFilter" aria-label="Filter YouTube uploads"><option value="all">All channel videos</option><option value="missing">Missing from catalog</option><option value="present">Already in catalog</option></select>
        <button class="btn sm" id="ytSelectAll">Select all missing</button><button class="btn sm" id="ytSelectNone">Clear selection</button>
      </div>
      <div class="yt-preview-list" id="ytPreviewList"></div>
      <div class="yt-preview-pager row wrap"><button class="btn sm" id="ytPreviewPrev">Previous</button><span class="muted small" id="ytPreviewPageInfo"></span><button class="btn sm" id="ytPreviewNext">Next</button></div>
      <div id="ytImportProgress" class="muted small" aria-live="polite"></div>
      <div id="ytPreviewError" class="form-err" hidden></div>
      <div class="row wrap end yt-preview-submit"><button class="btn" data-close>Cancel</button><button class="btn" id="ytImportSelected" disabled>Import selected (0)</button><button class="btn primary" id="ytImportAll" ${newItems.length ? '' : 'disabled'}>Import all missing (${newItems.length})</button></div>`,
    { title: 'Preview full YouTube channel', wide: true });

    const selectedButton = $('#ytImportSelected', m.el), allButton = $('#ytImportAll', m.el);
    const error = $('#ytPreviewError', m.el), progress = $('#ytImportProgress', m.el);
    const updateCount = () => {
      selectedButton.textContent = `Import selected (${selected.size.toLocaleString('en-IN')})`;
      selectedButton.disabled = submitting || selected.size === 0;
      allButton.disabled = submitting || newItems.length === 0;
    };
    const filteredItems = () => {
      const q = query.trim().toLowerCase();
      return items.filter((v) => {
        if ((filter === 'missing' && v.alreadyImported) || (filter === 'present' && !v.alreadyImported)) return false;
        return !q || `${v.title} ${v.id} ${v.publishedAt}`.toLowerCase().includes(q);
      });
    };
    const drawPreviewList = () => {
      const rows = filteredItems(), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      page = Math.min(page, pages - 1);
      const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      $('#ytPreviewSummary', m.el).textContent = `${items.length.toLocaleString('en-IN')} channel videos checked · ${newItems.length.toLocaleString('en-IN')} missing from catalog · ${(items.length - newItems.length).toLocaleString('en-IN')} already present · checked ${fmtDT(preview.checkedAt)}`;
      $('#ytPreviewPageInfo', m.el).textContent = rows.length ? `${(page * PAGE_SIZE + 1).toLocaleString('en-IN')}–${Math.min(rows.length, (page + 1) * PAGE_SIZE).toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')}` : '0 videos';
      $('#ytPreviewPrev', m.el).disabled = page === 0;
      $('#ytPreviewNext', m.el).disabled = page >= pages - 1;
      $('#ytPreviewList', m.el).innerHTML = visible.length ? html`${visible.map((v) => html`<div class="yt-preview-row ${v.alreadyImported ? 'is-imported' : ''}">
        <input type="checkbox" data-yt-select="${v.id}" aria-label="Select ${v.title}" ${v.alreadyImported ? 'disabled' : ''} ${selected.has(v.id) ? 'checked' : ''}>
        <img src="${v.thumbnail}" alt="" loading="lazy">
        <div class="yt-preview-info"><a href="${v.url}" target="_blank" rel="noopener noreferrer">${v.title}</a><small>${fmtDT(v.publishedAt)}</small><div class="yt-preview-badges">${v.alreadyImported ? badge('Already in catalog', 'ok') : badge(kinds.get(v.id) === 'reel' ? 'Suggested: Reel / Short' : 'Suggested: Landscape video', 'warn')}</div></div>
        <label class="yt-kind-field"><small>Import as</small><select data-yt-kind="${v.id}" aria-label="Import ${v.title} as" ${v.alreadyImported ? 'disabled' : ''}><option value="reel" ${kinds.get(v.id) === 'reel' ? 'selected' : ''}>Reel / Short</option><option value="clip" ${kinds.get(v.id) !== 'reel' ? 'selected' : ''}>Landscape video</option></select></label>
      </div>`)}`.s : empty(items.length ? 'No videos match this search or filter.' : 'No uploads were found on this channel.').s;
      $$('[data-yt-select]', m.el).forEach((box) => box.addEventListener('change', () => {
        if (box.checked) selected.add(box.dataset.ytSelect); else selected.delete(box.dataset.ytSelect);
        updateCount();
      }));
      $$('[data-yt-kind]', m.el).forEach((select) => select.addEventListener('change', () => kinds.set(select.dataset.ytKind, select.value)));
      updateCount();
    };
    $('#ytPreviewSearch', m.el).addEventListener('input', (e) => { query = e.target.value; page = 0; drawPreviewList(); });
    $('#ytPreviewFilter', m.el).addEventListener('change', (e) => { filter = e.target.value; page = 0; drawPreviewList(); });
    $('#ytPreviewPrev', m.el).onclick = () => { page--; drawPreviewList(); };
    $('#ytPreviewNext', m.el).onclick = () => { page++; drawPreviewList(); };
    $('#ytSelectAll', m.el).onclick = () => { newItems.forEach((v) => selected.add(v.id)); drawPreviewList(); };
    $('#ytSelectNone', m.el).onclick = () => { selected.clear(); drawPreviewList(); };
    drawPreviewList();

    const submit = async (all) => {
      const chosen = all ? newItems : items.filter((v) => selected.has(v.id) && !v.alreadyImported);
      if (!chosen.length || submitting) return;
      const button = all ? allButton : selectedButton, label = button.innerHTML;
      const selections = chosen.map((v) => ({ id: v.id, kind: kinds.get(v.id) || 'clip' }));
      const chunks = Array.from({ length: Math.ceil(selections.length / IMPORT_CHUNK) }, (_, i) => selections.slice(i * IMPORT_CHUNK, (i + 1) * IMPORT_CHUNK));
      batchId ||= crypto.randomUUID();
      let added = 0, skipped = 0, completed = 0;
      submitting = true; button.classList.add('busy'); error.hidden = true; updateCount();
      try {
        for (let i = 0; i < chunks.length; i++) {
          progress.textContent = `Importing batch ${i + 1} of ${chunks.length}…`;
          const result = await api.post('/catalog/youtube/import', { previewToken: preview.previewToken, batchId, selections: chunks[i] });
          added += result.added; skipped += result.skipped; completed++;
        }
        m.close();
        toast(added ? `Imported ${plural(added, 'video')}${skipped ? ` · ${plural(skipped, 'upload')} already in the catalog` : ''}` : `No new videos · ${plural(skipped, 'upload')} already in the catalog`);
        try { await reload(); } catch (e) { toast(errMsg(e), 'err'); }
      } catch (e) {
        error.textContent = `${errMsg(e)}${completed ? ` ${plural(added, 'video')} were added before the import stopped; retrying safely skips duplicates.` : ''}`;
        error.hidden = false; progress.textContent = '';
      } finally {
        submitting = false;
        if (m.el.isConnected) { button.classList.remove('busy'); button.innerHTML = label; updateCount(); }
      }
    };
    selectedButton.onclick = () => submit(false);
    allButton.onclick = () => submit(true);
  }

  async function removeYoutubeImports(scope) {
    const ids = scope === 'last' ? (youtubeImports.last?.videoIds || []) : youtubeImports.todayVideoIds;
    if (!ids.length) return;
    const titles = ids.map((id) => data.videos.find((v) => v.id === id)?.shortTitle || data.videos.find((v) => v.id === id)?.title).filter(Boolean);
    const shown = titles.slice(0, 4), suffix = titles.length > shown.length ? `, and ${plural(titles.length - shown.length, 'more')}` : '';
    const scopeLabel = scope === 'last' ? 'the last YouTube import' : "today’s YouTube imports";
    if (!(await confirmBox({ title: `Remove ${scope === 'last' ? 'last import' : "today’s imports"}?`, text: `This removes ${plural(ids.length, 'YouTube video')} from ${scopeLabel}${shown.length ? `: ${shown.join(', ')}${suffix}` : ''}. The videos disappear from the site and viewers’ lists. This can’t be undone.`, confirm: `Remove ${ids.length} videos`, danger: true }))) return;
    const button = scope === 'last' ? $('#removeYoutubeLast') : $('#removeYoutubeToday');
    await guard(button, async () => {
      const result = await api.post('/catalog/youtube/remove-imports', { scope });
      toast(`Removed ${plural(result.removed, 'video')}${result.skipped ? ` · ${plural(result.skipped, 'video')} already gone` : ''}`);
      await reload();
    });
  }

  function drawVideos() {
    const lastCount = youtubeImports.last?.videoIds?.length || 0, todayCount = youtubeImports.todayVideoIds?.length || 0;
    const videoNote = `${note} Preview the complete YouTube channel, add videos not already in the catalog, or manage selected videos in bulk. Public page loads never fetch YouTube.`;
    root.innerHTML = html`${pageHead('Videos & reels', videoNote, html`<button class="btn" id="previewYoutube">${icon('refresh', 16)} Preview YouTube channel</button><button class="btn primary" id="new">${icon('plus', 16)} New video</button>`)}
      ${youtubeHistoryError ? html`<p class="form-err">YouTube import-removal controls unavailable: ${youtubeHistoryError}</p>` : ''}
      <div class="yt-history row wrap"><strong>Recent YouTube imports</strong><button class="btn danger" id="removeYoutubeLast" ${lastCount ? '' : 'disabled'}>Undo last import (${lastCount})</button><button class="btn danger" id="removeYoutubeToday" ${todayCount ? '' : 'disabled'}>Remove today’s imports (${todayCount})</button><small>Today is based on India Standard Time.</small></div>
      <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Search titles, IDs…" value="${F.q}"></div>
        <select id="fshow"><option value="">All shows</option>${data.shows.map((s) => html`<option value="${s.id}" ${F.show === s.id ? 'selected' : ''}>${s.titleEn || s.title}</option>`)}${data.upcoming.map((u) => html`<option value="${u.id}" ${F.show === u.id ? 'selected' : ''}>(coming soon) ${u.titleEn || u.title}</option>`)}<option value="_none" ${F.show === '_none' ? 'selected' : ''}>No show</option></select>
        <select id="fkind"><option value="">All kinds</option>${KINDS.map((k) => html`<option value="${k.v}" ${F.kind === k.v ? 'selected' : ''}>${k.l}s</option>`)}</select>
        <select id="facc"><option value="">Free & premium</option><option value="premium" ${F.access === 'premium' ? 'selected' : ''}>Premium only</option><option value="free" ${F.access === 'free' ? 'selected' : ''}>Free only</option></select>
        <select id="fsource"><option value="">All sources</option><option value="youtube" ${F.source === 'youtube' ? 'selected' : ''}>YouTube</option><option value="r2" ${F.source === 'r2' ? 'selected' : ''}>Cloudflare R2</option><option value="mp4" ${F.source === 'mp4' ? 'selected' : ''}>MP4 link</option><option value="hls" ${F.source === 'hls' ? 'selected' : ''}>HLS link</option></select>
        <select id="frating"><option value="">All ratings</option><option value="unrated" ${F.rating === 'unrated' ? 'selected' : ''}>Unrated</option>${['U', '7+', '13+', '16+', '18+'].map((r) => html`<option value="${r}" ${F.rating === r ? 'selected' : ''}>${r}</option>`)}</select>
        <select id="fduration"><option value="">Any duration</option><option value="known" ${F.duration === 'known' ? 'selected' : ''}>Duration set</option><option value="unknown" ${F.duration === 'unknown' ? 'selected' : ''}>Duration missing</option></select>
        <select id="fvisibility"><option value="">All website statuses</option><option value="visible" ${F.visibility === 'visible' ? 'selected' : ''}>Visible now</option><option value="hidden" ${F.visibility === 'hidden' ? 'selected' : ''}>Hidden</option><option value="scheduled" ${F.visibility === 'scheduled' ? 'selected' : ''}>Scheduled</option></select></div>
      <div class="video-bulk-bar" id="videoBulkActions" hidden><strong id="videoSelectedCount"></strong><div class="row wrap"><button class="btn sm" id="bulkHide">Hide from website</button><button class="btn sm" id="bulkShow">Restore to website</button><button class="btn sm danger" id="bulkDelete">Delete selected</button><button class="btn sm" id="bulkClear">Clear selection</button></div></div>
      <div class="video-list-summary muted small" id="videoListSummary"></div><div id="list"></div>`.s;
    $('#new').onclick = () => editVideo(null);
    $('#previewYoutube').onclick = () => guard($('#previewYoutube'), async () => {
      const preview = await api.post('/catalog/youtube/preview');
      if (!ctx.stale()) openYoutubePreview(preview);
    });
    $('#removeYoutubeLast').onclick = () => removeYoutubeImports('last');
    $('#removeYoutubeToday').onclick = () => removeYoutubeImports('today');
    $('#bulkHide').onclick = () => bulkVideos('hide');
    $('#bulkShow').onclick = () => bulkVideos('show');
    $('#bulkDelete').onclick = () => bulkVideos('delete');
    $('#bulkClear').onclick = () => { selectedVideoIds.clear(); drawList(); };
    const set = (k, el, ev) => el.addEventListener(ev, () => { F[k] = el.value; F.offset = 0; drawList(); });
    set('q', $('#q'), 'input'); set('show', $('#fshow'), 'change'); set('kind', $('#fkind'), 'change'); set('access', $('#facc'), 'change');
    set('source', $('#fsource'), 'change'); set('rating', $('#frating'), 'change'); set('duration', $('#fduration'), 'change'); set('visibility', $('#fvisibility'), 'change');
    drawList();
  }
  async function bulkVideos(action) {
    const ids = [...selectedVideoIds]; if (!ids.length) return;
    if (action === 'delete') {
      const r2Count = ids.filter((id) => data.videos.find((v) => v.id === id)?.source?.type === 'r2').length;
      const text = `This permanently removes ${plural(ids.length, 'video')} from the website and viewers’ lists${r2Count ? `; the ${plural(r2Count, 'R2 file')} remain in storage and must be removed there separately` : ''}. This cannot be undone.`;
      if (!(await confirmBox({ title: `Delete ${ids.length} selected videos?`, text, confirm: `Delete ${ids.length} videos`, danger: true }))) return;
    }
    const button = action === 'hide' ? $('#bulkHide') : action === 'show' ? $('#bulkShow') : $('#bulkDelete');
    await guard(button, async () => {
      const result = await api.post('/catalog/videos/bulk', { action, ids });
      selectedVideoIds.clear();
      const label = action === 'hide' ? 'Hidden' : action === 'show' ? 'Restored' : 'Deleted';
      toast(`${label} ${plural(result.affected, 'video')}${result.skipped ? ` · ${plural(result.skipped, 'video')} no longer available` : ''}`);
      await reload();
    });
  }
  function drawList() {
    const q = F.q.trim().toLowerCase();
    const rows = data.videos.filter((v) => {
      const text = `${v.title || ''} ${v.shortTitle || ''} ${v.id} ${v.source?.type || ''}`.toLowerCase();
      return (!q || text.includes(q))
        && (!F.show || (F.show === '_none' ? !v.showId : v.showId === F.show))
        && (!F.kind || v.kind === F.kind)
        && (!F.access || v.access === F.access)
        && (!F.source || v.source?.type === F.source)
        && (!F.rating || (F.rating === 'unrated' ? !v.rating : v.rating === F.rating))
        && (!F.duration || (F.duration === 'unknown' ? !(v.duration > 0) : v.duration > 0))
        && (!F.visibility || videoVisibility(v) === F.visibility);
    }).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    const maxOffset = rows.length ? Math.floor((rows.length - 1) / PAGE) * PAGE : 0;
    F.offset = Math.min(F.offset, maxOffset);
    const pageRows = rows.slice(F.offset, F.offset + PAGE);
    $('#videoListSummary').textContent = `${rows.length.toLocaleString('en-IN')} matching videos · ${data.videos.length.toLocaleString('en-IN')} total · ${selectedVideoIds.size.toLocaleString('en-IN')} selected (up to ${MAX_VIDEO_SELECTION})`;
    const bulkBar = $('#videoBulkActions'); bulkBar.hidden = selectedVideoIds.size === 0;
    $('#videoSelectedCount').textContent = `${plural(selectedVideoIds.size, 'video')} selected`;
    $('#list').innerHTML = html`<div class="card flush">${rows.length ? html`<table class="tbl"><thead><tr><th class="select-col"><input type="checkbox" id="selectPage" aria-label="Select this page"></th><th></th><th>Title</th><th>Show</th><th>Website</th><th>Duration</th><th>Published</th><th class="end">Views</th><th></th></tr></thead><tbody>
      ${pageRows.map((v) => html`<tr><td class="select-col"><input type="checkbox" data-video-select="${v.id}" aria-label="Select ${v.title}" ${selectedVideoIds.has(v.id) ? 'checked' : ''}></td><td class="thumb wide">${thumb(v) ? html`<img src="${thumb(v)}" alt="" loading="lazy">` : ''}</td>
        <td class="title-cell"><strong class="clip">${v.shortTitle || v.title}</strong><br>${badge(youtubeKindLabel(v))} ${badge(v.source?.type === 'youtube' ? 'YouTube' : v.source?.type === 'r2' ? 'R2' : v.source?.type?.toUpperCase() || 'Video')} ${v.access === 'premium' ? badge('premium', 'gold') : ''}</td>
        <td>${showTitle(v.showId) || html`<span class="muted">—</span>`}</td><td>${videoVisibility(v) === 'hidden' ? badge('Hidden', 'bad') : videoVisibility(v) === 'scheduled' ? badge('Scheduled', 'warn') : badge('Visible', 'ok')}</td>
        <td>${v.duration > 0 ? fmtDur(v.duration) : '—'}</td><td class="small">${fmtDT(v.publishedAt)}</td><td class="end">${Number(v.views || 0).toLocaleString('en-IN')}</td>
        <td class="end nowrap"><a class="icon-btn" href="/watch/${v.id}" target="_blank" rel="noopener" title="Open on site">${icon('external', 16)}</a><button class="icon-btn" data-edit="${v.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${v.id}" title="Delete">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>` : empty('No videos match.')}</div>
      ${pager({ total: rows.length, offset: F.offset, limit: PAGE })}`.s;
    const pageChecks = $$('[data-video-select]', $('#list'));
    const selectPage = $('#selectPage', $('#list'));
    if (selectPage) {
      const count = pageChecks.filter((box) => selectedVideoIds.has(box.dataset.videoSelect)).length;
      selectPage.checked = pageChecks.length > 0 && count === pageChecks.length;
      selectPage.indeterminate = count > 0 && count < pageChecks.length;
      selectPage.addEventListener('change', () => {
        if (selectPage.checked) {
          for (const box of pageChecks) {
            if (!selectedVideoIds.has(box.dataset.videoSelect) && selectedVideoIds.size >= MAX_VIDEO_SELECTION) break;
            selectedVideoIds.add(box.dataset.videoSelect);
          }
          if (selectedVideoIds.size >= MAX_VIDEO_SELECTION) toast(`Select up to ${MAX_VIDEO_SELECTION} videos at a time.`, 'err');
        } else pageChecks.forEach((box) => selectedVideoIds.delete(box.dataset.videoSelect));
        drawList();
      });
    }
    pageChecks.forEach((box) => box.addEventListener('change', () => {
      if (box.checked && selectedVideoIds.size >= MAX_VIDEO_SELECTION && !selectedVideoIds.has(box.dataset.videoSelect)) {
        box.checked = false; toast(`Select up to ${MAX_VIDEO_SELECTION} videos at a time.`, 'err'); return;
      }
      if (box.checked) selectedVideoIds.add(box.dataset.videoSelect); else selectedVideoIds.delete(box.dataset.videoSelect);
      const count = pageChecks.filter((x) => selectedVideoIds.has(x.dataset.videoSelect)).length;
      if (selectPage) { selectPage.checked = pageChecks.length > 0 && count === pageChecks.length; selectPage.indeterminate = count > 0 && count < pageChecks.length; }
      bulkBar.hidden = selectedVideoIds.size === 0;
      $('#videoSelectedCount').textContent = `${plural(selectedVideoIds.size, 'video')} selected`;
      $('#videoListSummary').textContent = `${rows.length.toLocaleString('en-IN')} matching videos · ${data.videos.length.toLocaleString('en-IN')} total · ${selectedVideoIds.size.toLocaleString('en-IN')} selected (up to ${MAX_VIDEO_SELECTION})`;
    }));
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editVideo(data.videos.find((v) => v.id === b.dataset.edit)));
    $$('[data-del]', root).forEach((b) => b.onclick = async () => {
      const v = data.videos.find((x) => x.id === b.dataset.del);
      if (await confirmBox({ title: 'Delete this video?', text: `“${v.shortTitle || v.title}” will disappear from the site and from viewers’ lists${v.source.type === 'r2' ? '. The file stays in your R2 bucket (delete it there to save storage)' : ''}.`, confirm: 'Delete', danger: true })) {
        selectedVideoIds.delete(v.id); mutate(() => api.del(`/catalog/videos/${encodeURIComponent(v.id)}`), 'Video deleted');
      }
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
  const editReleaseBanner = () => {
    formModal({
      title: 'Edit “Releasing This Month” poster', wide: true,
      note: 'This artwork is the homepage banner above the Coming Soon carousel. Posters for the carousel are edited on each title below.',
      fields: [
        { k: 'releasingThisMonth', label: 'Desktop poster', type: 'image', maxWidth: 1600, wide: true, help: 'Wide artwork recommended.' },
        { k: 'releasingThisMonthMobile', label: 'Mobile poster', type: 'image', maxWidth: 1000, wide: true, help: 'Optional separate crop for phones; if cleared, the bundled mobile artwork is restored.' },
      ],
      values: { ...HOME_POSTER_DEFAULTS, ...(data.homePosters || {}) },
      onSubmit: async (v) => {
        await api.put('/studio', { ...data.studio, homePosters: v });
        toast('Releasing This Month poster saved'); await reload();
      },
    });
  };
  function drawUpcoming() {
    root.innerHTML = html`${pageHead('Coming soon', 'Edit the homepage banner here, and edit each carousel poster with its title below.', html`<button class="btn" id="editReleaseBanner" title="Edit the Releasing This Month poster">${icon('image', 16)} Edit banner</button><button class="btn primary" id="new">${icon('plus', 16)} New title</button>`)}
      <div class="card flush">${data.upcoming.length ? html`<table class="tbl"><thead><tr><th></th><th>Title</th><th>Type</th><th class="end">Order</th><th></th></tr></thead><tbody>${data.upcoming.map((u, i) => html`<tr><td class="thumb"><img src="${imgSrc(u.poster)}" alt="" loading="lazy"></td><td><strong>${u.titleEn || u.title}</strong>${u.titleEn ? html`<br><small class="muted bn">${u.title}</small>` : ''}${u.note ? html`<br><small class="muted">${u.note}</small>` : ''}</td><td>${u.type}</td><td class="end nowrap">${orderBtns(u.id, i, data.upcoming.length)}</td>
        <td class="end nowrap"><button class="icon-btn" data-edit="${u.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${u.id}" title="Delete">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>` : empty('Nothing announced.')}</div>`.s;
    $('#new').onclick = () => editUp(null);
    $('#editReleaseBanner').onclick = editReleaseBanner;
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
