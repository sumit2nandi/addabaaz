# Security review — October 2026

Whole-repository audit and remediation pass. 586 source files (`server/src/**`, `app/`, `admin/`, `content/`,
`mobile/`, `.github/workflows/`, `scripts/`), roughly 47k lines of JS/JSON/HTML, reviewed by reading the code
plus a static-analysis sweep (semgrep `p/ci`, `p/security-audit`, `p/owasp-top-ten`, `p/nodejs-sast`,
`p/javascript`, `p/typescript`, `p/json`, `p/yaml` — 1 135 raw findings, triaged by hand), dependency audit,
and a live probe of the mounted HTTP surface.

Every fix below is in this branch and covered by a test that runs without MySQL. Nothing was "fixed" by
deleting a feature or by loosening a check.

## 1. Fixed

| # | Severity | Issue | Where |
|---|---|---|---|
| 1 | **High** | Open redirect: `Location` built from the request path (`///evil.com/` → 301 off-site) | `seo.js`, `web.js`, `http.js` |
| 2 | Medium | `Host` header reflected into canonical / `og:url` / sitemap URLs (Host-header injection) | `seo.js` |
| 3 | Medium | CSV formula injection (`=`, `+`, `-`, `@`, tab, CR) in the exported sales register | `billing.js` |
| 4 | Medium | No timeout on *any* outbound request: one hung upstream pinned a request handler and a pool connection | `payments.js`, `social.js`, `apple.js`, `sms.js`, `r2.js`, `routes/contact.js`, `http.js` |
| 5 | Medium | Unbounded R2 read: a 400 MB object served at `/media/:token/master.m3u8` was buffered into a string | `r2.js` |
| 6 | Medium | Inline `<script>` on the maintenance page was blocked by the site CSP (the countdown silently never ran) | `web.js`, `maintenance.html` |
| 7 | Medium | CI ran PR-authored code with the repository's default (write) token | `.github/workflows/ci.yml` |
| 8 | Medium | The public rolling `apk` GitHub release could be moved by a pull request event | `.github/workflows/apk.yml` |
| 9 | Medium | `Vary: Origin` missing on CORS responses → shared-cache header leak; wildcard `CORS_ORIGINS` in production passed silently | `middleware/security.js`, `app.js` |
| 10 | Low | Long-lived media token (`STREAM_URL_TTL`) accepted without bounds | `app.js` |
| 11 | Low | Production MySQL over cleartext TCP, or with `rejectUnauthorized: false`, was silent | `config.js`, `index.js`, `.env.example` |
| 12 | Low | Truncated encrypted backup read as a "damaged" file after a wasted scrypt derivation | `backup.js` |
| 13 | Low | `String.replace` pattern injection: `$&` typed in an operator's maintenance message rewrote the page | `web.js` |

### 1 · Open redirect through the canonicalisation redirect

The SEO router canonicalises trailing slashes by echoing the request path into `Location`:

```js
res.redirect(301, urlPath.replace(/\/+$/, '') + search);   // before
```

A path is not automatically same-origin. WHATWG URL parsing — browsers, and `new URL()` — treats `//host`
*and* `///host` as "same scheme, this authority", so `GET ///evil.com/` answered
`301 Location: ///evil.com`, which a browser resolves to `https://evil.com`. Reproduced against the real
mounted website before the fix:

```
"///evil.com/"     -> status 301 location: "///evil.com"     ← off-site
"//evil.com/"      -> status 301 location: "//evil.com"      ← off-site
```

Fix: one validator at the producer *and* at the sink, so a future `redirect()` cannot forget it
(`http.js:31`):

```js
export function safeRedirectLocation(target, fallback = '') {
  const s = String(target ?? '');
  if (!s.startsWith('/') || s.startsWith('//')) return fallback;   // never "//host" or an absolute URL
  if (/[\\\s\u0000-\u001f\u007f]/.test(s)) return fallback;         // no backslash, whitespace, CRLF, control
  return s;
}
```

Applied at all three path-derived redirects (`seo.js:179,183,193`) and the upload-preview redirect
(`web.js:168`); an empty result means "do not redirect", which falls through to the normal 404/200. After
the fix the same probe returns `404` for both hostile paths while `/show/shahid/` → `301 /show/shahid` and
`/index.html` → `301 /` still work. Header injection is refused by the same guard. Covered by
`server/test/redirect-hardening.test.js`.

### 2 · `Host` header in canonical URLs

`siteOrigin(req)` preferred `PUBLIC_SITE_URL` and fell back to the request's `Host`. With
`app.set('trust proxy', 1)` (this app does that, and `web.js` reads `x-forwarded-proto`), an attacker
supplies `Host: attacker.example` and gets it written into `<link rel=canonical>`, `og:url`, `twitter:url`
and the sitemap for the page they poisoned — a phishing/SEO injection and a cache-key poisoning vector.

Fix (`seo.js:32`): a `Host` that is not a bare `name[:port]` is discarded and the page is rendered with
relative URLs only.

```js
const SAFE_HOST = /^[A-Za-z0-9.\-_]+(?::\d{1,5})?$/;
```

Residual, by design: with `PUBLIC_SITE_URL` unset, a *well-formed but foreign* host (`evil.example`) still
becomes the canonical origin. Only malformed hosts can be refused at that layer; setting `PUBLIC_SITE_URL`
removes the exposure entirely, which is what the deployment docs already recommend.

### 3 · CSV formula injection in the sales register

`GET /billing/invoices.csv` is a Tally-style export whose `Customer` and `Customer GSTIN` columns are text a
buyer typed at checkout. Excel, Google Sheets and Numbers evaluate a cell starting with `=`, `+`, `@`, tab
or CR, so the account name `=HYPERLINK("http://evil/","x")` or `=cmd|'/C calc'!A0` executes on the machine of
whoever opens the export (CWE-1236).

Fix (`billing.js:363`) — the standard "spreadsheet literal text" marker, applied *before* quoting, and only
to cells that are not numbers:

```js
const text = (v) => { const s = String(v ?? ''); return /^[=+\-\@\t\r]/.test(s) ? `'${s}` : s; };
```

Deliberately *not* neutralised: credit-note amounts, which are negative on purpose so an accountant's column
totals net out. `server/test/csv-export.test.js` pins both halves — hostile names carry the marker and keep
their text, `Shahid Traders` is untouched, `[-500, -45, -45, 0, -590]` stays numeric. The pre-existing
MySQL-backed billing test's CSV assertions are unaffected.

### 4 · Every outbound call now has a budget

Only `youtube-feed.js` had a timeout; `fetch` with no signal waits for the OS TCP limit, minutes at best. The
server calls third parties from request handlers, so one stalled upstream pinned a handler, its connection
and (through the shared pool) capacity to serve. `http.js` now exports a shared budget:

```js
export const OUTBOUND_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS) || 15_000;
export function withTimeout(init = {}, ms = OUTBOUND_TIMEOUT_MS) { … }   // caller's own signal wins
```

Applied to: Razorpay order creation (with a `502 payment_provider_timeout` that leaves the order to the
webhook instead of losing it), Razorpay key-config fetch, Google JWKS + ID-token verification, Facebook
token exchange, Apple JWKS, MSG91 send/status, Textlocal send, the contact form's SMTP-less POST, and R2
`putObject` (120 s) / `head`. `AbortSignal.timeout` is unref'd, so a timer can never keep a closing process
alive. Google's JWKS fetch failing now surfaces as `503 provider_unavailable` rather than a `500` that also
evicted the cached keys.

Two deliberate non-changes, documented in the code: R2 `getObject` (HLS segments and uploads) and media
streaming stay untimed, because `AbortSignal.timeout` also covers body consumption and would truncate a
legitimate multi-megabyte segment. `r2.getObject` carries a comment saying so, so the next reader does not
"fix" it.

### 5 · R2 playlist read capped

`getText` buffered a whole object into a string to detect a master playlist. A client that puts a huge key in
`video.source.key` turns one request into a 400 MB allocation. Now refused above
`MAX_PLAYLIST_BYTES = 2_000_000` — using the advertised `content-length` first, so an oversized object is
rejected without transferring it. A real playlist is a few KB. See `server/test/outbound-limits.test.js`.

### 6 · Maintenance page under the site CSP

`script-src 'self'` (plus the two provider exceptions) means the maintenance page's inline countdown script
was blocked, and the operator could not see or edit the countdown while the API was offline — exactly when
the page matters. Rather than adding `'unsafe-inline'` site-wide, `web.js` now derives a per-response policy
allowing *that page's* inline scripts by hash:

```js
cspForInlineScripts(html)   // one 'sha256-…' per <script> without a src, appended to script-src
```

The hash only matches if the block is byte-identical, so `{{until}}` moved out of the script into
`data-until` on the tag and the script reads it with `JSON.parse(getAttribute(…))` — static source,
runtime data. `script-src` is never widened, and the `GET /maintenance` preview goes through the same code
path, so the policy is testable without taking the site down. Verified end to end: one inline script, its
hash present in the header, no `unsafe-inline`.

### 7, 8 · CI and release workflows

- `ci.yml` runs `npm ci`, the whole test suite and `esbuild` **on pull-request code**, and GitHub grants that
  job the repository's default token — which on a repo whose default is write means PR code could push a tag
  or publish a release. Now `permissions: { contents: read }` on both jobs, with a comment; no step needs
  more.
- `apk.yml`'s publish job moves the rolling `apk` release and uploads a signed APK with `GH_TOKEN`/`APK_PASS`.
  That is already safe from fork PRs (GitHub withholds `secrets.*` from them, so the job skips), but it is
  *not* safe from a pull request **event** carrying a `pull_request.target` ref — which the old condition
  did not exclude — and it rebuilt the APK from PR code. `publish` is now `github.event_name == 'push' ||
  … workflow_dispatch || … workflow_call`. The build/sign jobs are unchanged, so PRs are still verified, and
  a maintainer can still publish manually with an explicit `release_tag`.
  Also note `mobile/debug.keystore` is intentionally committed and required by this workflow — not a leak.
- Unchanged and reported as advice: 15 `actions/*@vN` references are floating tags (pin to full commit SHAs),
  and there is no `dependabot.yml` even though `package-lock.json` is committed.

### 9 · CORS: honest caching, and a warning when production is wide open

The API authenticates with `Authorization: Bearer` from `localStorage`, not cookies, so there is no classic
CSRF surface — the origin policy is the *only* thing that stops another website calling `/account/*`,
`/billing/*` and `/admin/*` as a signed-in user. Three changes in `middleware/security.js`:

- `Vary: Origin` on **every** response, not only on allowed preflights. Without it, a shared cache that saw a
  preflight with `Access-Control-Allow-Origin: https://a.in` can serve that header to a page from another
  origin (wildcard replies need no Vary, and are marked as such).
- `*` in production logs a warning at boot instead of passing silently (this is what `.env.example` ships as
  the out-of-the-box default); malformed entries in the allow-list also warn. The `.env.example` comment now
  explains what the switch controls.
- `SITE_CSP` extracted to a named export so the maintenance page (above) and one policy cannot drift apart;
  `csp` may still be overridden per mount.

Behaviour is unchanged for existing configurations, including the two origin-less mobile WebView clients —
`cors.test.js` and `csp.test.js` pass as written.

### 10–13 · Smaller, but real

- **`STREAM_URL_TTL` clamped** (`app.js`): a typo like `86400000` minted media tokens valid for years; the
  window is now 300 s … 12 h with the clamp commented (the documented default, 6 h, is inside it).
- **Database transport advisories** (`config.js:87` + `index.js:28`): the README recommends a managed MySQL
  with `DB_SSL=true` "certificates checked by default", yet `ssl: false` was an unremarkable default. A
  production `DB_HOST` that is not loopback / RFC 1918 / a single-label container name now warns at boot, as
  do `DB_SSL_VERIFY=false` (any certificate is accepted, so TLS is confidentiality without
  authentication) and TLS with no CA on a public host with the private-CA hint. `DB_SSL=disabled|off|no`
  opts out explicitly; development never nags; `npm run db:setup`/`db:migrate` are unaffected because
  `dbConfigFromEnv` stays a pure mapping.
- **Backup truncation guard** (`backup.js:141`): `fs.readSync` clamps a short read instead of failing, so a
  file shorter than `MAGIC + salt + IV + tag` used to read a partial tag and burn a scrypt derivation before
  reporting "damaged". Now refused immediately. `setAuthTag` is left exactly as Node expects —
  `setAuthTagLength` is a *WebCrypto* API and does not exist on Node's `Decipher`; calling it (as one static
  analyzer suggests) throws and would have made **every encrypted backup unrestorable**. The new
  `server/test/backup-crypto.test.js` is what caught that: it proves a well-formed encrypted backup still
  reads, a wrong passphrase is refused by GCM authentication, a single flipped byte in the ciphertext is
  refused even at the correct length, and six truncation sizes are refused.
- **Maintenance text is now inert** (`web.js`): the `{{message}}`/`{{until}}` substitutions use function
  replacers, so `$&` in an operator's message is inserted literally rather than being interpreted as a
  `String.replace` pattern (previously it spliced a fragment of the page into the message). Values are
  escaped as before, so this closes the last non-XSS way a message changed the document.

## 2. Reviewed and found sound

Read line by line and left alone because it is already correct — this list is the audit's coverage record:

- **SQL**: all queries are backtick templates whose `${…}` slots are confined to `COLS`/`INSERT`/`UPDATE`/
  `LIST` constant lists, `IN (${placeholders})`, column allow-lists, `q()`-escaped identifiers, or
  `Number.isSafeInteger`-validated pagination. No string interpolation of user values. `db.js` exposes only
  `query(sql, params)` with placeholders, and `mysql2` runs with `multipleStatements: false`, so a smuggled
  `;` cannot chain a statement. `q()`/`escape`/`escapeId` are `mysql2`'s own.
- **XSS**: no `innerHTML` sink takes untrusted data outside `esc()` in `app/`, `admin/`, `content/`; no
  `eval`, `new Function` or dynamic method dispatch; `document.write` appears nowhere. Admin HTML previews
  escape user data (`renderHtmlPreview`, `studio.js`). The PWA's service worker caches per-scope correctly
  and does not shadow `/api`.
- **Auth & tokens**: `auth.js` uses HS256 with an algorithm check and a key-rotation lookup (its one `fetch`
  is a documented, configurable egress probe); passwords are scrypt with an explicit maxmem; OTP and
  phone-link code is constant-time compared, single-use and rate limited; admin sign-in is rate limited and
  locked out; `publicUser` never leaks hashes or reset challenges.
- **Payments**: Razorpay order + webhook signature verified with `timingSafeEqual` and provider-amount
  cross-checks; refunds are recorded from the provider response; the webhook path never trusts a client-
  supplied price.
- **Login providers**: Google (JWKS + `kid`, audience and issuer checks), Facebook (app-secret proof) and
  Apple (JWKS, `aud`, `iss`) verifiers are correct in structure; only the missing timeout was added.
- **Uploads/media**: signed media tokens are HMAC'd with expiry; `uploads.js` restricts extension and MIME
  and serves `image/*` with `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`;
  `sharp` is wrapped in try/catch so a crafted image cannot crash a worker; `hls.js` passes a fixed argument
  vector to `ffmpeg` with no shell involved; `web-assets.js` refuses traversal with both `path.relative` and
  an explicit extension allow-list.
- **Error surface**: `error.js` never leaks stack traces in production responses, the CSP frame-ancestors
  policy is `X-Frame-Options: DENY` with matching CSP, and the express-internal `_friendlyError` override
  turns a `zlib` failure into a 4xx instead of an uncaught `ERR_STREAM_destroyed_after_end` crash loop.
- **Secrets**: no committed credentials, tokens or private keys anywhere in the repository (`.gitignore`
  covers `.env`; only `mobile/debug.keystore` and `admin/apple-touch-icon.png` match a binary-secrets search,
  and the keystore is intentional).
- **Dependencies**: `npm audit --omit=dev` and `npm audit` both report **0 vulnerabilities**, dev included.
  No transitive package currently needs a bump.
- `email-address.js`'s local-part pattern is linear (no nested quantifiers → no ReDoS), the newsletter
  unsubscribe token is an HMAC of the address and correctly *not* an expiry-free shared secret in the auth
  sense (see below for the one caveat), and mailer header injection is impossible because each value is
  single-line validated.

## 3. Not fixed — judgement calls for the owner

Each of these is a design or operations decision, not a code defect I could patch without changing behaviour
someone depends on. All of them are one-line fixes if you want them; say which.

| Item | Why it is left | If you want it changed |
|---|---|---|
| `support.js`: a guest ticket is readable by anyone who knows the address it was filed with | "reply from your e-mail" is the product's design | require a per-message token, or expire guest reads |
| `javascript:`-scheme links fed by studio/content/notification data (`app/js/views/studio.js:91`, `watch.js:156`, `plans.js:157`, `admin/js/views/content.js:275`, `notifications.js:260`, `maintenance.js:43`) | only an authenticated admin can write those fields; a URL allow-list would reject legitimate deep links | `^(https?:|mailto:|tel:|/)` guard at render *and* at write |
| `media.js`: `dir === '.'` makes `startsWith('')` vacuously true, so a token can read any file under `dirname(video.source.key)` | by design ("all renditions of the same title"); keys come from our own encoder | pin the allow-list to the exact filename per rendition |
| `/media/:token/*` is not re-checked per segment | a revoked entitlement keeps streaming until the token expires (now ≤ 12 h) | re-verify `mediaEntitlements` per manifest/segment request |
| `billing.js`: `GET /billing`, `GET /invoices/:id/pdf` and `DELETE /subscription` are unthrottled | consistency with the rest of the module | add them to the strict bucket |
| `accounts.js`: `DELETE /me` needs only the current password, no step-up | re-authentication is present (password verified) | add a 2nd-factor check for account deletion |
| Rate limiter is in-process and keyed on `req.ip`; it is bypassed if `TRUST_PROXY` is unset behind a proxy | single-process design, documented in `http.js` | Redis limiter, or set `TRUST_PROXY` in deployment |
| `guardImages` trusts `x-forwarded-host` | it is an image-referrer policy, not an authorisation boundary | derive from `PUBLIC_SITE_URL` only |
| `web.js`'s `DENY` path blocklist is prefix-based, so an unlisted top-level path is allowed | deliberate: it is a maintenance bypass list, not a security boundary | flip to an allow-list of public page routes |
| `/data/catalog.json` is served as-is and includes internal fields (`source`, `studio` blocks) | the browser app reads that same file to render | strip internal fields into a separate public JSON |
| `publicUser` exposes `isAdmin` | needed by the client to show the console | harmless; noted for completeness |
| `compose.yml` passes `MYSQL_ROOT_PASSWORD` on the command line | visible in `ps` to the same user only | use `MYSQL_ROOT_PASSWORD_FILE` + a secret |
| CSP keeps `style-src 'unsafe-inline'` (and inline style attributes are used everywhere) | removing it needs the styles moved to a stylesheet | extract styles, then drop `'unsafe-inline'` |
| Newsletter unsubscribe tokens never expire | token is derived from the address + secret, no PII beyond it | add a timestamp to the HMAC input |
| `features.js:220` `reportError` details bypass `sanitizeErrorDetails` | diagnostics-only path; no secrets verified in it | run details through the same sanitizer |
| `index.html` links external CSS without Subresource Integrity | third-party CSS hosts (Google Fonts) rotate files, so SRI breaks the site | self-host the fonts, then pin |

## 4. How to verify

```bash
npm test                       # full suite — the MySQL-backed tests need a live TEST_DATABASE_URL
node --test server/test/redirect-hardening.test.js server/test/csv-export.test.js \
          server/test/outbound-limits.test.js server/test/backup-crypto.test.js   # 38 new tests, no DB
node --test server/test/{csp,cors,config,http,gst,email-address,catalog,catalog-schema,
                         backup-lines,module-hygiene,architecture}.test.js        # 33 existing, no DB
npm run validate:catalog && npm run build:app && npm run build:mobile
```

Status when this was written: `node --check` clean on every touched file; **71/71** (38 new + 33 pre-existing) of the tests that do not
need a database pass, including the four architecture tests that enforce an acyclic import graph (the new
`web.js → security.js` and `seo.js → http.js` edges are legal); `validate:catalog` green.
`server/test/*.test.js` that need MySQL (billing, auth, admin, uploads, sessions, backups-against-a-real-DB)
**could not be run here — no MySQL server is reachable in this environment**, so those suites should be run
once on a machine with `TEST_DATABASE_URL` set; the only touched file in their path is `billing.js`, and the
existing billing test's CSV assertions were checked against the new code by hand.

The three static-analyzer findings that drove items 1, 3 and 5 are reproducible with:

```bash
semgrep --config p/ci --config p/security-audit --config p/owasp-top-ten \
        --config p/nodejs-sast --config p/javascript --config p/typescript --config p/json --config p/yaml .
```

The remaining raw findings were triaged as false positives and are listed in section 2 — chiefly
`tainted-sql-string` (placeholder lists), `unsafe-dynamic-method`, `direct-response-write`,
`node-mysql-sqli` (backtick templates in the DB layer), `html-in-template-string` in `seo.js` (every
interpolation goes through `esc()`), and `gcm-no-tag-length` in `backup.js` (a WebCrypto rule matched against
a Node API — see item 12).
