import { loadPublishedWorkbook, assertValid, PREVIEW_KEY } from './workbook.js';
import { renderContent, runtimeData } from './site-content.js';

const components = ['navigation', 'home', 'player', 'upcoming', 'bts', 'about', 'services', 'contact', 'video-preview', 'poster-preview', 'modal', 'footer'];
const scripts = ['helpers', 'hero', 'video-preview', 'galleries', 'poster-preview', 'navigation', 'catalog', 'contact', 'app'];
const status = document.getElementById('siteStatus');

function loadScript(name) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `assets/js/site/${name}.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Unable to load the ${name} component.`));
    document.body.append(script);
  });
}

async function start() {
  if (location.protocol === 'file:') throw new Error('Please serve this folder over HTTP rather than opening index.html directly. See README.md for instructions.');
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  const contentPromise = preview ? Promise.resolve().then(() => {
    const saved = localStorage.getItem(PREVIEW_KEY);
    if (!saved) throw new Error('No preview data found. Open admin.html and choose Preview changes first.');
    return assertValid(JSON.parse(saved));
  }) : loadPublishedWorkbook();
  const [tables, templates] = await Promise.all([
    contentPromise,
    Promise.all(components.map(async name => {
      const response = await fetch(`components/${name}.html`);
      if (!response.ok) throw new Error(`Unable to load the ${name} template (HTTP ${response.status}).`);
      return response.text();
    }))
  ]);
  // Only repository-owned templates are parsed as HTML; workbook text is never markup.
  document.getElementById('siteRoot').innerHTML = templates.join('\n');
  renderContent(tables);
  Object.assign(window, runtimeData(tables));
  for (const script of scripts) await loadScript(script);
  window.initializeSite();
  if (preview) {
    status.textContent = 'LOCAL PREVIEW — these changes are not published. Close this tab to return to your editor. ';
    status.classList.add('preview-banner');
    const back = document.createElement('a');
    back.href = 'index.html';
    back.textContent = 'View published website';
    status.append(back);
  } else status.remove();
}

start().catch(error => {
  console.error('[ADDABAAZ] Website load failed:', error);
  document.getElementById('siteRoot').replaceChildren();
  status.setAttribute('role', 'alert');
  status.textContent = `The website could not load. ${error.message} Please check the workbook or try reloading.`;
});
