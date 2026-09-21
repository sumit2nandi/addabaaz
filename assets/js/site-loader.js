import { loadPublishedWorkbook, assertValid, PREVIEW_KEY } from './workbook.js?v=f6ed6ee8481c';
import { renderContent, runtimeData } from './site-content.js?v=f6ed6ee8481c';

const ASSET_VERSION = 'f6ed6ee8481c';
const components = ['navigation', 'home', 'player', 'upcoming', 'bts', 'about', 'services', 'contact', 'video-preview', 'poster-preview', 'modal', 'footer'];
const scripts = ['helpers', 'hero', 'video-preview', 'galleries', 'featured-upcoming', 'poster-preview', 'navigation', 'catalog', 'contact', 'app'];

function loadScript(name, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const script = document.createElement('script');
    // Append every file at once but execute in the original dependency order.
    script.async = false;
    script.src = `assets/js/site/${name}.js?v=${ASSET_VERSION}`;
    const clean = () => { script.onload = script.onerror = null; signal.removeEventListener('abort', abort); };
    const abort = () => { clean(); script.remove(); reject(signal.reason); };
    script.onload = () => { clean(); resolve(); };
    script.onerror = () => { clean(); reject(new Error(`Unable to load the ${name} component.`)); };
    signal.addEventListener('abort', abort, { once: true });
    document.body.append(script);
  });
}

export async function start({ signal }) {
  if (location.protocol === 'file:') throw new Error('Please serve this folder over HTTP rather than opening index.html directly. See README.md for instructions.');
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  const contentPromise = preview ? Promise.resolve().then(() => {
    const saved = localStorage.getItem(PREVIEW_KEY);
    if (!saved) throw new Error('No preview data found. Open admin.html and choose Preview changes first.');
    return assertValid(JSON.parse(saved));
  }) : loadPublishedWorkbook({ signal });
  const [tables, templates] = await Promise.all([
    contentPromise,
    Promise.all(components.map(async name => {
      const response = await fetch(`components/${name}.html?v=${ASSET_VERSION}`, { signal });
      if (!response.ok) throw new Error(`Unable to load the ${name} template (HTTP ${response.status}).`);
      return response.text();
    }))
  ]);
  signal.throwIfAborted();
  // Only repository-owned templates are parsed as HTML; workbook text is never markup.
  document.getElementById('siteRoot').innerHTML = templates.join('\n');
  renderContent(tables);
  Object.assign(window, runtimeData(tables));
  await Promise.all(scripts.map(name => loadScript(name, signal)));
  signal.throwIfAborted();
  window.initializeSite();
  if (preview) {
    const status = document.createElement('div');
    status.id = 'previewBanner';
    status.inert = true;
    status.className = 'site-status preview-banner';
    status.setAttribute('role', 'status');
    status.textContent = 'LOCAL PREVIEW — these changes are not published. Close this tab to return to your editor. ';
    const back = document.createElement('a');
    back.href = 'index.html';
    back.textContent = 'View published website';
    status.append(back);
    document.body.insertBefore(status, document.getElementById('siteRoot'));
  }
}
