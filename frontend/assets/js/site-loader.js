import { loadContent } from '/shared/api-client.js';
import { renderContent, runtimeData } from './site-content.js?v=04539462fb7a';

const ASSET_VERSION = '04539462fb7a';
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
  const contentPromise = loadContent({ baseUrl: window.ADDABAAZ_API_BASE_URL, signal }).then(data => data.tables);
  // Download code and content concurrently. Scripts only define functions/listeners;
  // initialization still waits until templates, validated data and every script exist.
  const scriptsReady = Promise.all(scripts.map(name => loadScript(name, signal)));
  const contentReady = Promise.all([
    contentPromise,
    Promise.all(components.map(async name => {
      const response = await fetch(`components/${name}.html?v=${ASSET_VERSION}`, { signal });
      if (!response.ok) throw new Error(`Unable to load the ${name} template (HTTP ${response.status}).`);
      return response.text();
    }))
  ]).then(([tables, templates]) => {
    signal.throwIfAborted();
    // Only repository-owned templates are parsed as HTML; API text is never markup.
    document.getElementById('siteRoot').innerHTML = templates.join('\n');
    renderContent(tables);
    Object.assign(window, runtimeData(tables));
  });
  await Promise.all([contentReady, scriptsReady]);
  signal.throwIfAborted();
  window.initializeSite();
}
