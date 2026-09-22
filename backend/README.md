# Backend operations and API

Node 22+, Express 5, MySQL 8.4/InnoDB. See the root README for installation, Docker and environment setup. `backend/.env` is read by the Node CLI scripts. Required environment values are validated on startup; no default database password or admin secret is provided.

## Storage and migration

- Ten `content_*` tables store every field from the seed workbook as UTF-8 text, with explicit `sort_order`, original IDs and an Episodes → Shows foreign key.
- `content_meta` holds the monotonically increasing revision and last update time.
- `inquiries` persists submitted name, email, phone, message and timestamp.
- `media/{images,UpcomingReleases,BTS}` contains the existing images. MySQL stores references, not binary image data. Videos remain YouTube references.
- The seed is unchanged from the existing workbook and is **not served over HTTP**. Its historical Read Me/editor instructions are superseded by these docs. Files in a public Git repository/history are still public; never put secrets in a workbook or content table.

`npm run migrate` applies the idempotent initial schema without resetting rows. It is not a schema-diff engine; future structural changes require new, reviewed migrations. On a blank schema use `npm run import`. For a trusted replacement workbook:

```sh
# From backend/, after taking a backup:
npm run import -- /absolute/path/updated.xlsx --replace
```

Without `--replace`, imports refuse to overwrite an existing revision. Rows are validated before any writes; replacement uses a transaction, a locked revision row and parameterized inserts. Concurrent changes produce a conflict rather than silently overwriting another editor. Import does not upload images. Keep dates, durations, numbers with leading zeros and Bengali values formatted as **Text**, not formulas, in Excel. Preserve sheet names, column headers and fixed Copy/Settings keys. `shared/workbook.js` documents each section and its columns. Legacy Google form settings remain for lossless migration but submission now uses MySQL exclusively.

## Public endpoints

| Method/path | Result |
|---|---|
| `GET /api/health` | Database connectivity (not a content-readiness guarantee) |
| `GET /api/v1/content` | `{schemaVersion:1, revision, updatedAt, tables}` for the website |
| `GET /api/v1/content?view=home` | `{schemaVersion:1, revision, updatedAt, runtime, copy}` for mobile Home |
| `POST /api/v1/inquiries` | JSON `{name,email,phone,message}` → 201 after storage; phone may be empty |
| `GET /media/...` | Backend-hosted image files; encoded filenames including Bengali supported |

Content responses have `Cache-Control: no-store` and a revision `ETag`. The Home response omits non-Home page copy/form configuration. Public media references start `/media/`; the shared client resolves them against the API host, never a native virtual origin. External image URLs remain external. No-content/unreachable-database responses are 503, with no workbook fallback. API v1 is validated by clients. All content tables are public display content, not a place for secrets.

## Protected administration (no Google login)

All `/api/v1/admin/*` routes require `Authorization: Bearer <ADMIN_TOKEN>`. CORS is **not** authentication. Keep the token only in trusted server/operator environments; rotate by changing the environment and restarting. This is a single-operator token interface, not a multi-user CMS. The old unauthenticated `admin.html` has deliberately been removed.

- `GET /api/v1/admin/content`: current raw stored `{tables, revision, updatedAt}` and `ETag`.
- `PUT /api/v1/admin/content`: complete JSON `{tables: ...}` and **`If-Match: "N"`**, where N is the revision read above. Preserves array ordering. Success increments revision. Missing precondition → 428; stale revision → 409; invalid content → 422. Never send the public projection back as an edit—it contains rewritten media paths.
- `PUT /api/v1/admin/media/:bucket/:filename`: raw image body with `Content-Type: image/png`, `image/jpeg`, `image/webp` or `image/gif`; maximum 10 MB, magic bytes checked, no SVG/executable/hidden/traversal filenames. Buckets are `images`, `UpcomingReleases`, `BTS`. Returns `{path:"images/new.png"}`; update the content separately. Existing names return 409, never overwrite. Use new filenames so cached images cannot hide an update.
- `GET /api/v1/admin/inquiries`: latest 100 stored messages, newest first. No email delivery is configured. Export/archive/delete older inquiries according to your retention policy using a trusted DB operator account.

Example from a trusted terminal, with `API` and `ADMIN_TOKEN` set in your local environment (do not paste secrets into source files):

```sh
curl --fail -H "Authorization: Bearer $ADMIN_TOKEN" "$API/api/v1/admin/content" > current.json
# Create edited.json containing {"tables": ...} from current.json's tables.
# Replace 1 below with current.json's revision; do not force a stale update.
curl --fail -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -H 'If-Match: "1"' \
  --data-binary @edited.json "$API/api/v1/admin/content"
curl --fail -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: image/png' --data-binary @poster.png \
  "$API/api/v1/admin/media/UpcomingReleases/new-poster.png"
```

## Hosting/security checklist

1. Put the Node service behind HTTPS on a root origin (for example `https://api.example.com`), not a URL with a subpath. Proxy `/api`, `/media`, `/assets`, `/components`, `/shared` and `/` if also serving the website. Bind Node to `0.0.0.0`.
2. Set exact allowed web/native origins in `CORS_ORIGINS`, comma separated, without trailing paths. Built-in mobile origins are `https://app.addabaaz.in` and `capacitor://app.addabaaz.in`. Set `TRUST_PROXY_HOPS` only to the actual trusted proxy depth, not an arbitrary large value. Set an upstream body limit of at least 10 MB if using uploads.
3. Keep MySQL private. For a managed database set `DB_SSL_CA` to its CA file for verified TLS. Restrict privileges; consider using a separate migration role and runtime data-only role. Use UTC database/server time.
4. Back up MySQL **and** the media volume independently, with protected access and tested restoration. A DB backup alone does not contain images. Do not replace the Docker media volume on redeploy. Existing volumes do not automatically receive new files added to an image; use the upload API or an operator copy.
5. General API rate limit: 120 requests/minute/IP; inquiry limit: 5/15 minutes/IP. Limits are process-local; multiple replicas require a shared rate-limit store and shared media storage. The legacy visual CAPTCHA is UX only, not a server security boundary. Consider additional abuse protection before public launch.
6. Keep inquiry data private, publish an appropriate privacy notice, establish deletion/retention policies. The app records inquiries; it does not promise that an email was delivered.
7. Never expose `.env`, seed workbooks, server directories or admin tokens. The built-in server serves an explicit public allowlist; do not point a static web server at the repository root.

Production deployment, domain/TLS setup, database provisioning, monitoring and backup infrastructure must be performed on your hosting account. The repository contains no production credentials.

## Tests

`npm test` uses an injected test repository. `npm run test:mysql` is different: it performs destructive tests against a real disposable MySQL database named `*_test`. It verifies the initial empty state, full import round trip, second-instance reads, migration idempotence, Unicode/order, revision conflicts, rollback after a genuine SQL constraint failure and inquiry persistence. CI provisions MySQL 8.4 for this test. Never point it at production.
