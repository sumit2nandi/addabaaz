# addabaaz

ADDABAAZ — film & ad production house, Kolkata. OTT-style streaming site: web series,
promos & reels, upcoming releases and behind-the-scenes galleries.

## Repository layout

| Path | What it is |
| --- | --- |
| `frontend/` | The Angular 21 app (the site). See [`frontend/README.md`](frontend/README.md). |
| `backend/` | Spring Boot 4.1 REST API — serves every show, episode, promo, poster, team member, service and setting from the database, plus OTT accounts (login, profiles, watchlist, plans). See [`backend/README.md`](backend/README.md). |
| `db/` | PostgreSQL create-table and insert scripts (schema + the catalogue migrated out of the old `index.html`). See [`db/README.md`](db/README.md). |
| `index.html` | The original single-file version of the site, kept for reference only. |
| `images/`, `BTS/`, `UpcomingReleases/` | Media shared by both versions. `npm start` mirrors them into `frontend/public/` with hard links (no duplication). |

The frontend keeps **no content of its own** — everything renders from the API.

## Quick start (full stack)

```bash
# 1. database (PostgreSQL 16+)
psql -U postgres -f db/postgresql/00_create_database.sql
psql -U addabaaz -d addabaaz -f db/postgresql/V1__schema.sql
psql -U addabaaz -d addabaaz -f db/postgresql/V2__seed_content.sql
psql -U addabaaz -d addabaaz -f db/postgresql/V3__seed_ott.sql

# 2. API (Java 21+, Maven)  → http://localhost:8080
cd backend && mvn spring-boot:run

# 3. site (Node 20.19+/22.12+/24+) → http://localhost:4200 (proxies /api to :8080)
cd frontend && npm install && npm start
```

First administrator: `admin@addabaaz.in` / `Admin@123` (created on first boot —
change it). Google sign-in needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
environment variables; everything else works out of the box.

## Production

```bash
cd backend && mvn clean package && java -jar target/addabaaz-api.jar
cd frontend && npm run build && npm run serve:ssr:frontend   # Node SSR host
```

Or serve the Angular app from any Node host / reverse proxy that forwards `/api`
and `/oauth2` to the API. The API listens on `:8080` by default (`PORT` env var).
