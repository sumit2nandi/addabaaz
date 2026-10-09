// Cross-cutting HTTP policy belongs at the composition edge, not inside feature routes.
import compression from 'compression';

/**
 * The website's Content-Security-Policy. Kept as a module constant (rather than built inside the
 * middleware) because two responses need to reason about it: the admin/console pages replace it with a
 * stricter policy, and the maintenance page must allow exactly one inline script by hash instead of
 * switching the whole site to `'unsafe-inline'`.
 */
export const SITE_CSP = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "script-src 'self' https://accounts.google.com https://www.youtube.com https://checkout.razorpay.com https://connect.facebook.net https://appleid.cdn-apple.com https://cdn.jsdelivr.net https://www.googletagmanager.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  // NOTE: `https:` is deliberate — the app talks to whichever API origin it was launched from (a
  // Render preview, a staging host), and CSP cannot express "the origin of this document" for connect-src.
  "connect-src 'self' https:",
  // NOTE: api.razorpay.com must stay in frame-src — Razorpay Checkout loads the payment-form iframe from there
  // (checkout.razorpay.com is only the script host). Without it the popup opens as a blank white screen.
  "frame-src 'self' https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com https://checkout.razorpay.com https://api.razorpay.com https://www.facebook.com",
  "worker-src 'self' blob:", "manifest-src 'self'",
].join('; ');

/** The CORS_ORIGINS setting as a list of exact origins ('*' meaning "any"). */
export const parseCorsOrigins = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
/** Exact-origin match; `*` allows everything (the documented default for a public API + native WebView). */
export const allowedOrigin = (origin, list) => list.includes(origin);

/** Install transport/security policy and return normalized SEO settings for the web renderer. */
export function installSecurityMiddleware(app, { corsOrigins = '*', production = false, seo = {}, log = console } = {}) {
  // The API is called by the website, by the native WebViews and (for /health) by monitoring — the
  // allow-list is what stops any other page from reading responses cross-origin.
  const corsOriginList = parseCorsOrigins(corsOrigins);
  if (corsOrigins === '*' && production) {
    log.warn?.('[cors] CORS_ORIGINS is unset/`*`, so any web page may call this API cross-origin. Sessions are bearer tokens (not cookies), so no account data is readable that way, but a public API also has no origin barrier for abuse: set CORS_ORIGINS to the site, the app origin and nothing else.');
  }
  // An entry that is not a bare https/http origin can never match a browser `Origin`, so it would silently
  // do nothing (a trailing slash or a path is the usual typo) — say so instead of leaving a "configured"
  // allow-list that silently refuses the app.
  for (const o of corsOriginList) {
    if (o !== '*' && !/^https?:\/\/[A-Za-z0-9.\-_]+(?::\d{1,5})?$/.test(o)) {
      log.warn?.(`[cors] CORS_ORIGINS entry "${o}" is not a bare origin (https://host[:port]) and will never match a browser Origin header — remove the path, trailing slash or scheme mismatch.`);
    }
  }
  // Search-engine settings. Indexing is off unless explicitly allowed so staging copies never compete with the real site.
  const seoCfg = {
    siteUrl: seo.siteUrl ?? process.env.PUBLIC_SITE_URL ?? '',     // https://addabaaz.in — canonical URLs, sitemap and structured data use it
    // Only the real production site should be indexed: staging/preview copies would compete with it (duplicate content).
    indexable: seo.indexable ?? (process.env.ALLOW_INDEXING ? /^(1|true|yes)$/i.test(process.env.ALLOW_INDEXING) : production),
    compress: seo.compress ?? !/^(1|true|yes)$/i.test(process.env.DISABLE_COMPRESSION || ''),
    google: seo.googleVerification ?? process.env.GOOGLE_SITE_VERIFICATION ?? '',
    bing: seo.bingVerification ?? process.env.BING_SITE_VERIFICATION ?? '',
    ga4: seo.ga4 ?? process.env.GA4_MEASUREMENT_ID ?? '',          // optional Google Analytics 4 — loads only after the visitor accepts analytics
  };
  // gzip responses (but never server-sent-event streams, which must flush immediately).
  if (seoCfg.compress) app.use(compression({ filter: (req, res) => !/event-stream/.test(res.getHeader('Content-Type') || '') && compression.filter(req, res) }));
  // Behind nginx / a load balancer the real client IP comes from X-Forwarded-For; needed for rate limits.
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);
  // Keep API, admin and raw data files out of Google.
  app.use(['/api', '/admin', '/data'], (_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });   // machine endpoints and the admin console never belong in search results
  // Security headers on every response, then CORS: only origins listed in CORS_ORIGINS (or * ) may call the API from a browser.
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': SITE_CSP,
      'Permissions-Policy': 'accelerometer=(), autoplay=*, camera=(), display-capture=(), encrypted-media=*, fullscreen=*, geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), picture-in-picture=*, usb=()',
    });
    if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.headers.origin;
    // `Vary: Origin` is set on every request, not only on the allowed ones: a shared cache must never reuse
    // one origin's response (with or without Access-Control-Allow-Origin) for a different Origin.
    if (origin) res.append('Vary', 'Origin');
    if (origin && (corsOrigins === '*' || allowedOrigin(origin, corsOriginList))) {
      // X-Device-* / X-Parental-Pin are sent by the site AND the Android app WebView (origin app.addabaaz.in):
      // without them in the allow-list the preflight fails and every API call looks "offline" in the app.
      res.set({ 'Access-Control-Allow-Origin': corsOrigins === '*' ? '*' : origin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, If-Range, X-Device-Id, X-Device-Label, X-Parental-Pin', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  return seoCfg;
}
