// Cross-cutting HTTP policy belongs at the composition edge, not inside feature routes.
import compression from 'compression';

/** Install transport/security policy and return normalized SEO settings for the web renderer. */
export function installSecurityMiddleware(app, { corsOrigins = '*', production = false, seo = {} } = {}) {
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
  // Content-Security-Policy for the website: only the origins the app actually uses (Google sign-in, YouTube,
  // Razorpay, fonts, consent-gated analytics…). The admin console overwrites this with its own, stricter policy.
  // Permissions-Policy disables every powerful browser feature the app never needs.
  const CSP = [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "script-src 'self' https://accounts.google.com https://www.youtube.com https://checkout.razorpay.com https://connect.facebook.net https://appleid.cdn-apple.com https://cdn.jsdelivr.net https://www.googletagmanager.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "connect-src 'self' https:",
    "frame-src 'self' https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com https://checkout.razorpay.com https://www.facebook.com",
    "worker-src 'self' blob:", "manifest-src 'self'",
  ].join('; ');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': CSP,
      'Permissions-Policy': 'accelerometer=(), autoplay=*, camera=(), display-capture=(), encrypted-media=*, fullscreen=*, geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), picture-in-picture=*, usb=()',
    });
    if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.headers.origin;
    if (origin && (corsOrigins === '*' || corsOrigins.split(',').map((s) => s.trim()).includes(origin))) {
      // X-Device-* / X-Parental-Pin are sent by the site AND the Android app WebView (origin app.addabaaz.in):
      // without them in the allow-list the preflight fails and every API call looks "offline" in the app.
      res.set({ 'Access-Control-Allow-Origin': corsOrigins === '*' ? '*' : origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, If-Range, X-Device-Id, X-Device-Label, X-Parental-Pin', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  return seoCfg;
}
