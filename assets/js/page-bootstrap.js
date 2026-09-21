/* Small, async entry point. Unlike a static module entry, it can report failed
   module imports and does not wait for optional external stylesheets. */
(() => {
  const ASSET_VERSION = 'f6ed6ee8481c';
  const script = document.currentScript;
  const admin = script.dataset.page === 'admin';
  const status = document.getElementById(admin ? 'status' : 'siteStatus');
  const recovery = document.getElementById('loadRecovery');
  const controller = new AbortController();
  const { signal } = controller;
  const assetUrl = name => new URL(`${name}?v=${ASSET_VERSION}`, script.src).href;
  let timeout;

  function loadExcelReader() {
    return new Promise((resolve, reject) => {
      const library = document.createElement('script');
      library.src = assetUrl('../vendor/exceljs.min.js');
      library.async = true;
      const clean = () => { library.onload = library.onerror = null; signal.removeEventListener('abort', abort); };
      const abort = () => { clean(); library.remove(); reject(signal.reason); };
      library.onload = () => {
        clean();
        if (window.ExcelJS?.Workbook) resolve();
        else reject(new Error('The Excel reader did not initialize. Please reload.'));
      };
      library.onerror = () => { clean(); reject(new Error('The Excel reader could not be downloaded. Check assets/vendor/exceljs.min.js and your connection.')); };
      signal.addEventListener('abort', abort, { once: true });
      document.head.append(library);
    });
  }

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
        const preview = document.getElementById('previewBanner');
        if (preview) preview.inert = false;
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
    if (admin) document.getElementById('adminBuild').textContent = ASSET_VERSION;
    // Module parsing and downloading the Excel library run concurrently. The app
    // starts only after BOTH finish, avoiding a race with window.ExcelJS.
    const [, app] = await Promise.all([
      loadExcelReader(),
      import(assetUrl(admin ? 'admin.js' : 'site-loader.js'))
    ]);
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
    if (!admin) return dismissSplash();
  }).catch(error => {
    controller.abort(error);
    console.error('[ADDABAAZ] Startup failed:', error);
    if (!admin) {
      document.getElementById('siteRoot').replaceChildren();
      document.getElementById('siteRoot').setAttribute('aria-busy', 'false');
      document.getElementById('siteSplash')?.classList.add('has-error');
    }
    else {
      document.getElementById('saveState').textContent = 'Editor could not start';
      document.querySelectorAll('#editorShell button').forEach(button => { button.disabled = true; });
    }
    status.setAttribute('role', 'alert');
    status.classList.add('error');
    status.textContent = `The ${admin ? 'editor' : 'website'} could not load. ${error.message || 'Please check the deployment files and reload.'}`;
    recovery.hidden = false;
  }).finally(() => clearTimeout(timeout));
})();
