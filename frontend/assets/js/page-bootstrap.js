/* Small, async entry point. Unlike a static module entry, it can report failed
   module imports and does not wait for optional external stylesheets. */
(() => {
  const ASSET_VERSION = '367f9decdeb8';
  const script = document.currentScript;
  const status = document.getElementById('siteStatus');
  const recovery = document.getElementById('loadRecovery');
  const controller = new AbortController();
  const { signal } = controller;
  const assetUrl = name => new URL(`${name}?v=${ASSET_VERSION}`, script.src).href;
  let timeout;

  function dismissSplash() {
    const splash = document.getElementById('siteSplash');
    const root = document.getElementById('siteRoot');
    return new Promise(resolve => {
      let fallback;
      const finish = () => {
        clearTimeout(fallback);
        splash?.removeEventListener('animationend', onEnd);
        splash?.remove();
        document.body.classList.remove('site-loading');
        root.inert = false;
        root.setAttribute('aria-busy', 'false');
        resolve();
      };
      const onEnd = event => { if (event.target === splash) finish(); };
      if (!splash || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
      splash.addEventListener('animationend', onEnd);
      splash.classList.add('is-leaving');
      // Recover even if a stylesheet or animation event is blocked/interrupted.
      fallback = setTimeout(finish, 850);
    });
  }

  async function initialize() {
    if (location.protocol === 'file:') throw new Error('Serve this folder over HTTP rather than opening the HTML file directly. See README.md.');
    const app = await import(assetUrl('site-loader.js'));
    signal.throwIfAborted();
    await app.start({ signal });
    signal.throwIfAborted();
  }

  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('Loading took too long. A website file or network request may be blocked. Check your connection, then reload.');
      controller.abort(error);
      reject(error);
    }, 25000);
  });
  Promise.race([initialize(), deadline]).then(() => {
    clearTimeout(timeout);
    return dismissSplash();
  }).catch(error => {
    controller.abort(error);
    console.error('[ADDABAAZ] Startup failed:', error);
    document.getElementById('siteRoot').replaceChildren();
    document.getElementById('siteRoot').setAttribute('aria-busy', 'false');
    document.getElementById('siteSplash')?.classList.add('has-error');
    status.setAttribute('role', 'alert');
    status.classList.add('error');
    status.textContent = `The website could not load. ${error.message || 'Please check the deployment files and reload.'}`;
    recovery.hidden = false;
  }).finally(() => clearTimeout(timeout));
})();
