// Browser delivery (static assets, SEO rendering, uploads cache and admin shell).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createSeo } from './seo.js';
import { wrap } from './http.js';
import { UPLOAD_NAME, uploadType, cacheUpload } from './uploads.js';

export function mountWebsite(app, { serveStatic = true, ROOT, db, catalog, PLANS, uploadDir, billing, corsOrigins, seoCfg }) {
  /* ---------- static site (same origin => the web app auto-detects this API) ---------- */
  // ---- Website ----
  // Static files, plus server-rendered HTML for every page so search engines see real titles and content.
  if (serveStatic) {
    // Defence in depth: even though only the folders below are mounted, explicitly refuse anything that
    // looks like repository internals (git, docs, tests, sources, keys, backups) so a future mount or
    // route can never accidentally expose it.
    const DENY = /(^\/\.(?:git|env|npm|ssh)|\/(?:server|scripts|docs|test|tests|mobile|resources|node_modules|\.github)(?:\/|$)|\/package(?:-lock)?\.json$|\.(?:map|md|mdx|ts|tsx|mjs|cjs|yml|yaml|toml|ini|cfg|log|sql|sqlite|pem|key|p12|keystore|bak|old)$)/i;
    app.use((req, res, next) => {
      let p; try { p = decodeURIComponent(req.path); } catch { return res.status(404).type('text/plain').send('Not found'); }
      if (DENY.test(p)) return res.status(404).type('text/plain').send('Not found');
      next();
    });
    // Common options for express.static: no directory index, ignore dotfiles.
    const opts = (maxAge) => ({ maxAge, index: false, dotfiles: 'ignore' });
    const seoSvc = createSeo({ catalog, root: ROOT, plans: PLANS, origin: seoCfg.siteUrl, indexable: seoCfg.indexable, verification: { google: seoCfg.google, bing: seoCfg.bing, ga4: seoCfg.ga4 } });
    // robots.txt and sitemap.xml are generated (they depend on the catalog and on whether indexing is allowed).
    app.get('/robots.txt', (req, res) => res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(seoSvc.robotsTxt(req)));
    app.get('/sitemap.xml', wrap(async (req, res) => { res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(await seoSvc.sitemapXml(req)); }));
    // The web app manifest: on this server the app uses real URLs, so an installed app should open on "/" rather than "/#/".
    app.get('/manifest.webmanifest', (_q, res) => {
      try { const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')); m.start_url = '/'; m.scope = '/'; res.type('application/manifest+json').send(JSON.stringify(m)); }
      catch { res.sendFile(path.join(ROOT, 'manifest.webmanifest')); }
    });
    // The service worker must never be cached hard, or updates would not reach users.
    // Production serves the minified mirror prepared at boot (index.js) — same URLs, no readable source.
    const built = fs.existsSync(path.join(ROOT, '.build', 'app', 'js', 'main.js')) && fs.existsSync(path.join(ROOT, '.build', 'sw.js'));
    const appRoot = built ? path.join(ROOT, '.build', 'app') : path.join(ROOT, 'app');
    const swRoot = built ? path.join(ROOT, '.build', 'sw.js') : path.join(ROOT, 'sw.js');
    app.get('/sw.js', (_q, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(swRoot); });
    // Images belong to this site: other pages may not hot-link them (crawlers for social previews and
    // direct visits without a referrer keep working).
    const HOTLINK_BOTS = /bot|crawler|spider|slurp|preview|embed|facebookexternalhit|twitterbot|whatsapp|telegrambot|slackbot|discordbot|linkedinbot|pinterest|snapchat|skypeuripreview|vkshare|w3c_validator|applebot|metadata/i;
    // Pages that may show these images: this server's own host(s), plus the public site (PUBLIC_SITE_URL, with and without www), any explicit
    // CORS_ORIGINS, the native apps' WebView (capacitor.config.json server.hostname - the app loads admin-uploaded posters from this API,
    // and without this their requests, which carry that origin as the Referer, were refused) and IMAGE_ALLOWED_HOSTS (comma-separated extras).
    const hostOf = (url) => { try { return new URL(url).host.toLowerCase(); } catch { return ''; } };
    const imageHosts = new Set([
      ...[hostOf(billing?.config?.siteUrl)].flatMap((h) => (h ? [h, h.startsWith('www.') ? h.slice(4) : `www.${h}`] : [])),
      ...(corsOrigins === '*' ? [] : String(corsOrigins).split(',').map((s) => hostOf(s.trim()))),
      'app.addabaaz.in',
      ...String(process.env.IMAGE_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()),
    ].filter(Boolean));
    const guardImages = (req, res, next) => {
      const ref = req.get('referer');
      if (ref) {
        let same = false;
        try { const u = new URL(ref); same = u.host === req.headers.host || u.host === (req.get('x-forwarded-host') || '') || imageHosts.has(u.host.toLowerCase()); } catch { same = false; }
        if (!same && !HOTLINK_BOTS.test(req.get('user-agent') || '')) return res.status(403).type('text/plain').send('Forbidden');
      }
      next();
    };
    // Admin uploads are stored in MySQL; the upload folder is only a cache that a restart or redeploy can empty (Render's free plan, a
    // Hostinger redeploy, a second server). When a file is not on disk, serve it from MySQL and put a copy back on disk. The names are
    // content hashes, so a URL never changes meaning and can be cached for a year.
    const uploadFromDb = wrap(async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const name = req.path.slice(1);
      if (!UPLOAD_NAME.test(name)) return next();
      const file = await db.uploads.get(name); if (!file) return next();
      cacheUpload(uploadDir, name, file.data);
      res.set({ 'Content-Type': uploadType(name), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      res.send(file.data);
    });
    // Static asset folders. Longer cache times for rarely-changing ones.
    app.use('/app', express.static(appRoot, { ...opts(0), etag: true }));
    app.use('/data', express.static(path.join(ROOT, 'data'), opts(60_000)));
    app.use('/media', guardImages, express.static(path.join(ROOT, 'media'), opts(7 * 86_400_000)));
    app.use('/uploads', guardImages, express.static(uploadDir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'ignore' }), uploadFromDb);   // admin-uploaded images and subtitles (content-hash names): disk cache first, then MySQL
    // The admin console: its own page + scripts, never cached, locked down with a strict CSP (no inline script, no framing).
    const adminHeaders = (_q, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' https://accounts.google.com https://connect.facebook.net https://appleid.cdn-apple.com; connect-src 'self' https:; frame-src 'self' https://accounts.google.com https://www.facebook.com https://appleid.apple.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); next(); };
    // Admin console page + its scripts.
    app.get(['/admin', '/admin/'], adminHeaders, (_q, res) => res.sendFile(path.join(ROOT, 'admin/index.html')));
    app.use('/admin', adminHeaders, express.static(path.join(ROOT, 'admin'), { index: false, dotfiles: 'ignore', etag: true }));

    // Every other GET is a page of the web app (/, /show/shahid …). Unknown pages get a REAL 404 status (with the app shell, so
    // people still see the site) — otherwise search engines index every mistyped URL as a "soft 404".
    app.get('*', async (req, res, next) => {
      if (req.path !== '/index.html' && (/^\/(api|app|data|media|uploads|admin)(\/|$)/.test(req.path) || /\.[a-z0-9]{1,8}$/i.test(req.path))) return res.status(404).type('text/plain').send('Not found');
      // Render the requested page (or redirect, or a real 404 status for unknown URLs).
      try {
        const r = await seoSvc.render(req);
        if (r.redirect) return res.redirect(r.status || 301, r.redirect);
        res.status(r.status).set(r.headers).send(r.body);
      } catch (e) {
        console.error('[seo] page render failed:', e.message);
        res.status(503).set({ 'Cache-Control': 'no-store', 'Retry-After': '30' }).sendFile(path.join(ROOT, 'index.html'));   // 503, not 200: never let a crawler index a broken page
      }
    });
  }

}
