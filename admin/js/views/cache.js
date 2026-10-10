// Admin → Client cache: the "refresh everyone" button.
//
// Every browser and installed app keeps a copy of the site (service worker + HTTP cache) so it opens fast
// and works offline. If a file or an image is ever wrong, this page invalidates those copies: the server
// bumps a version number, and each client that checks in drops its cached files and downloads them again
// the next time it opens (or comes back to the foreground). Nobody is signed out and no preference is lost.
import { api } from '../api.js';
import { html, $, $$, icon, badge, pageHead, confirmBox, guard, toast, errMsg, fmtDT } from '../ui.js';

export default async function cache(root, _p, ctx) {
  const load = async () => {
    let s;
    try { s = await api.get('/cache'); }
    catch (e) { root.innerHTML = html`${pageHead('Client cache')}<div class="card error-card"><h2>Couldn’t read the cache state</h2><p>${errMsg(e)}</p></div>`.s; return; }
    if (ctx.stale()) return;
    root.innerHTML = html`${pageHead('Client cache', 'Force every browser and installed app to fetch fresh files on its next launch.')}
      <div class="grid two">
        <section class="card">
          <h2>${icon('refresh', 18)} Cache generation</h2>
          <p class="cache-version"><span class="muted small">Current generation</span><strong>${s.version}</strong>
            ${badge(s.scope === 'all' ? 'clears everything' : 'app files only', s.scope === 'all' ? 'warn' : '')}</p>
          <p class="muted small">Last read ${fmtDT(s.checkedAt)}. The number goes up by one every time you clear.</p>
          <div class="row wrap">
            <button class="btn primary" id="purgeAssets">${icon('refresh', 16)} Clear app files</button>
            <button class="btn danger" id="purgeAll">${icon('trash', 16)} Clear everything</button>
          </div>
        </section>
        <section class="card">
          <h2>${icon('info', 18)} What each option does</h2>
          <ul class="muted small cache-notes">
            <li><b>Clear app files</b> — drops the cached site (HTML, JavaScript, CSS, catalog JSON) on every
              client. Use it after deploying a fix that people are not seeing.</li>
            <li><b>Clear everything</b> — the same, plus every other cache the site keeps, including uploaded
              artwork and posters saved for offline use. Slower on the next launch, nothing is lost.</li>
          </ul>
          <p class="muted small">Nobody is signed out and no preference is changed: the sign-in token, profiles,
            parental PIN and notification switches live in the clients’ own storage, not in the cache.</p>
        </section>
      </div>
      <section class="card">
        <h2>${icon('users', 18)} When it takes effect</h2>
        <ul class="muted small cache-notes">
          <li>An <b>open tab</b> notices within a few seconds and offers a restart (“ADDABAAZ was updated”).</li>
          <li>An <b>installed app</b> or a closed browser picks it up the next time it opens, or when it comes back to the foreground.</li>
          <li>An <b>Android / iOS app</b> checks the same number every time it starts; a device that never opens the app again keeps its copy (nothing can reach it).</li>
          <li>Clearing here does not touch the app stores’ own binaries — an app-store update is still the only way to ship new native code.</li>
        </ul>
      </section>`.s;

    const purge = (scope) => async () => {
      const all = scope === 'all';
      const ok = await confirmBox({
        title: all ? 'Clear every client cache?' : 'Clear cached app files?',
        text: all
          ? 'Every browser and installed app will re-download the site and its artwork the next time it opens. Slower once, then back to normal.'
          : 'Every browser and installed app will re-download the site’s files the next time it opens. Artwork and offline posters are kept.',
        confirm: all ? 'Clear everything' : 'Clear app files',
        danger: all,
      });
      if (!ok) return;
      try { const r = await api.post('/cache/purge', { scope }); toast(`Cache cleared — generation ${r.version}`, 'ok'); await load(); }
      catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#purgeAssets', root)?.addEventListener('click', (e) => guard(e.target.closest('button'), purge('assets')));
    $('#purgeAll', root)?.addEventListener('click', (e) => guard(e.target.closest('button'), purge('all')));
  };
  await load();
}
