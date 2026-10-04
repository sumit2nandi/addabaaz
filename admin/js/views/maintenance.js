// Admin → Maintenance: the switch that takes the viewer side of the site offline on purpose.
//
// Nothing is deployed and nothing is migrated — the running server starts answering viewers with the
// branded maintenance page (maintenance.html) and refuses viewer API calls, while the console, health
// checks, sign-in and payment webhooks keep working so the job can be finished and the switch turned off.
// The window can end by itself: fill in “Back by” and the site reopens on time even if nobody remembers.
import { api } from '../api.js';
import { html, $, icon, badge, pageHead, guard, toast, errMsg, fmtDT } from '../ui.js';

const PRESETS = [
  ['30 minutes', 30], ['1 hour', 60], ['2 hours', 120], ['4 hours', 240],
];

/** A `datetime-local` value → ISO (or null). */
const toIso = (v) => (v ? new Date(v).toISOString() : null);
/** ISO → the `datetime-local` shape the input wants, in the browser’s own timezone. */
function localValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function maintenance(root, _p, ctx) {
  const load = async () => {
    let s;
    try { s = await api.get('/maintenance'); }
    catch (e) { root.innerHTML = html`${pageHead('Maintenance')}<div class="card error-card"><h2>Couldn’t read the switch</h2><p>${errMsg(e)}</p></div>`.s; return; }
    if (ctx.stale()) return;

    const on = s.active || s.enabled;
    root.innerHTML = html`${pageHead('Maintenance', 'Take the viewer side of the site offline while you work — the console stays open so you can turn it back on.')}
      <div class="grid two">
        <section class="card">
          <h2>${icon('power', 18)} The switch ${s.active ? badge('live now', 'danger') : s.expired ? badge('window ended', 'warn') : badge('normal', 'ok')}</h2>
          ${s.active ? html`<p class="muted small">Viewers have been seeing the maintenance page since <b>${fmtDT(s.startedAt)}</b>.</p>`
            : s.expired ? html`<p class="muted small">The window you set ended <b>${fmtDT(s.until)}</b>, so the site is back by itself. The switch below is still on — turn it off to tidy up.</p>`
              : html`<p class="muted small">The site is serving normally. Turn the switch on when you are ready to work.</p>`}
          <label class="row-switch"><span><b>Maintenance mode</b><small>${s.active ? 'Viewers see the maintenance page right now.' : 'Turn on to take the viewer side offline.'}</small></span>
            <span class="switch"><input type="checkbox" id="mEnabled" ${on ? 'checked' : ''}><span class="track"></span></span></label>
          <div class="row wrap" style="margin-top:10px">
            <a class="btn" href="${s.page || '/maintenance'}" target="_blank" rel="noopener">${icon('eye', 16)} Preview the page</a>
          </div>
        </section>
        <section class="card">
          <h2>${icon('chat', 18)} What viewers see</h2>
          <label class="field"><span>Message on the page</span>
            <textarea id="mMessage" rows="4" maxlength="${s.defaults.maxMessage}" placeholder="${s.defaults.message}">${on ? (s.message || '') : ''}</textarea></label>
          <p class="muted small"><span id="mCount">0</span>/${s.defaults.maxMessage} characters. Leave it empty to use the default: “${s.defaults.message}”</p>
          <label class="field"><span>Back by <span class="muted">(optional — the site reopens on its own)</span></span>
            <input type="datetime-local" id="mUntil" value="${localValue(s.until)}"></label>
          <div class="row wrap">
            ${PRESETS.map(([label, mins]) => html`<button class="btn sm" data-mins="${mins}">${label}</button>`).join('')}
            ${s.until ? html`<button class="btn sm" id="mClearUntil">No end time</button>` : ''}
          </div>
          <div class="row end" style="margin-top:12px"><button class="btn primary" id="mSave">${icon('check', 16)} Save</button></div>
        </section>
      </div>
      <div class="grid two">
        <section class="card">
          <h2>${icon('info', 18)} What keeps working</h2>
          <ul class="muted small cache-notes">
            ${s.stillOnline.map((x) => `<li>${x}</li>`).join('')}
            <li>Everything else under <code>/api/v1</code> answers <b>503 maintenance</b> to viewers</li>
            <li>Browser pages are answered with the maintenance page (and a real 503, so search engines back off)</li>
          </ul>
        </section>
        <section class="card">
          <h2>${icon('warning', 18)} Before you switch it on</h2>
          <ul class="muted small cache-notes">
            <li>A payment that is already in flight still settles — the Razorpay webhook is never blocked.</li>
            <li>Open tabs and the installed apps show the maintenance screen on their next API call; they reload themselves when the site is back.</li>
            <li>Do not leave the switch on with no end time unless somebody is watching this page.</li>
          </ul>
        </section>
      </div>`.s;

    const box = $('#mMessage', root), count = $('#mCount', root), until = $('#mUntil', root);
    const paintCount = () => { count.textContent = String(box.value.length); };
    paintCount();
    box.addEventListener('input', paintCount);
    root.querySelectorAll('[data-mins]').forEach((b) => b.addEventListener('click', () => {
      until.value = localValue(new Date(Date.now() + Number(b.dataset.mins) * 60_000).toISOString());
    }));
    $('#mClearUntil', root)?.addEventListener('click', () => { until.value = ''; });

    const save = async (patch, message = 'Saved') => {
      try {
        const next = await api.patch('/maintenance', patch);
        toast(message, 'ok');
        if (next.active) toast('Maintenance mode is ON — viewers cannot use the app.', 'warn');
        await load();
      } catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#mSave', root)?.addEventListener('click', (e) => guard(e.target.closest('button'), () => save({ message: box.value, until: toIso(until.value) }, 'Maintenance settings saved')));
    $('#mEnabled', root)?.addEventListener('change', (e) => {
      const on = e.target.checked;
      guard(e.target.closest('.switch'), () => save({ enabled: on }, on ? 'Maintenance mode is on' : 'The site is live again'));
    });
  };
  await load();
}
