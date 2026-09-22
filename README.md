# ADDABAAZ — website, Android, iOS and MySQL API

The **Node.js/Express backend is now the live content source for all three clients**. MySQL stores the complete catalogue, page copy, settings and contact inquiries. Media files are hosted by the backend, with their paths stored in MySQL (not database BLOBs).

```text
backend/    Node API, MySQL schema, import tools, private seed and public media
frontend/   Website HTML, CSS, templates and JavaScript
android/    Home-only Capacitor Android app and native project
iOS/        Home-only Capacitor iPhone/iPad app and native project
shared/     Schema, runtime mapping, API client and mobile build helpers
```

The existing content is preserved in `backend/seed/website.xlsx`: Shows, Episodes, Promos, Upcoming, BTS, Team, Services, Missions, Copy and Settings. The import preserves IDs, ordering, Bengali text and display strings. **Excel is an import format, not the runtime database.** The old public editor and Google login are not used. Content writes require a server-only admin token.

## Run with Docker (recommended)

Requires Docker Engine with Compose. From the repository root:

```sh
cp .env.example .env
# Edit .env: independently generate MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD and
# ADMIN_TOKEN using `openssl rand -hex 32`. Do not commit .env.
docker compose up --build -d
# First run only, after the schema is ready:
docker compose exec backend npm run import
```

Open `http://localhost:3000`. The same server provides the website, `/api` and `/media`. An empty database intentionally shows an initialization error until imported. Schema migration runs on container startup; **content is never automatically reimported on restart**.

MySQL is not published to a host port. Named volumes preserve the database and uploaded media. Do not run `docker compose down -v` unless intentionally deleting both. Back up both volumes before upgrading or replacing content.

## Run without Docker

Requires Node **22+** and a MySQL **8.4** database/user with schema creation and data permissions:

```sh
npm ci
npm run setup
cp backend/.env.example backend/.env
# Set DB_* and a random ADMIN_TOKEN in backend/.env.
npm --prefix backend run migrate
npm --prefix backend run import
npm start
```

The website is at port 3000. For a separate frontend dev server, run `npm run dev` in another terminal (port 5173). Its `/api` and `/media` proxy to the backend. `BACKEND_URL` configures the **Node proxy only**, not the user's browser.

## Client API configuration

- **Website on the backend:** no URL changes. `frontend/assets/js/api-config.js` defaults to same-origin requests.
- **Separately hosted website:** set `window.ADDABAAZ_API_BASE_URL` in that public configuration file to the deployed HTTPS API origin, and allow the website's origin in backend `CORS_ORIGINS`. Serve frontend directories at `/`, plus the allowlisted shared modules at `/shared/` (see `frontend/README.md`).
- **Android/iOS:** set `API_BASE_URL=https://your-api-host.example` when running native `sync`, `debug`, `simulator` or `open` commands. These commands refuse an absent/non-HTTPS URL. Set the GitHub Actions repository variable `API_BASE_URL` to enable native CI builds. Never put `ADMIN_TOKEN` or database credentials in client config.
- Allow native origins `https://app.addabaaz.in` and `capacitor://app.addabaaz.in` in backend CORS. These are virtual WebView origins, not the API hostname.

Clients fetch the current revision on launch/reload; mobile has **Refresh content**. Content edits do not require rebuilding an installed app. Interface or API-origin changes still require rebuilding. No catalogue/workbook is packaged as a silent offline fallback: connection failures show a retry screen. Android/iOS retain Home-only navigation, the branded splash, swipeable looping posters and YouTube fallback.

See [backend deployment/API instructions](backend/README.md), [website](frontend/README.md), [Android](android/README.md) and [iOS](iOS/README.md).

## Verify

```sh
npm test                         # workbook/schema + isolated API tests
npm run validate                 # validates the preserved migration workbook
npx playwright install chromium
npm run test:browser              # website + API-loading/splash/interactions
npm --prefix android ci
npm --prefix android test
npm --prefix iOS ci
npm --prefix iOS test             # Chromium interface checks, not native iOS
```

Browser/API unit tests use a clearly isolated in-memory test repository. Production always uses MySQL. `npm --prefix backend run test:mysql` exercises actual SQL migration, persistence, revisions, ordering and rollback; it **requires a disposable database with a name ending `_test`** and deletes its content. `.github/workflows/backend-test.yml` supplies MySQL 8.4 in CI. No client browser test proves device behavior or unrestricted YouTube streaming.

Dependencies are locked. The `uuid@11.1.1` override keeps the CommonJS `v4` API used by ExcelJS/Xcode tooling while avoiding the vulnerable older versions. Re-run import/round-trip/native synchronization tests when updating it.

## Deployment boundary

**A push does not deploy Node or create a production database. GitHub Pages alone cannot run this application.** Deploy the backend and MySQL, run the one-time import, configure HTTPS/CORS and the client API origin before switching public traffic or building release apps. No production host or credentials are included. Never expose database ports or the admin token to browser/mobile code. Use a HTTPS reverse proxy, restrict admin access and keep independent backups. Native signing/store distribution remains a separate step.
