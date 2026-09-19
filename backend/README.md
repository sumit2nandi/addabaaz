# ADDABAAZ API

Spring Boot REST API behind the Angular site. Every show, episode, promo, poster,
team member, service and setting is served from PostgreSQL — the frontend keeps no
content of its own.

```
backend/
  pom.xml
  src/main/java/in/addabaaz/
    common/       error types + global handler
    config/       security, CORS, JWT beans, bootstrap admin, maintenance job
    security/     JWT service, bearer filter, Google sign-in handler
    user/         accounts, roles, refresh tokens, auth endpoints
    catalog/      shows, episodes, promos, posters, banners, team, services, settings
    engagement/   profiles, watchlist, continue-watching, history, ratings, reviews, devices
    billing/      plans, subscriptions, payments
    contact/      contact inquiries + image CAPTCHA
    admin/        CRUD endpoints under /api/admin/** (ROLE_ADMIN)
```

* **Spring Boot 4.1.1** (Spring Framework 7.0.9), **Java 21 LTS**, Maven, PostgreSQL 16+.

## 1. Create the database

```bash
psql -U postgres -f ../db/postgresql/00_create_database.sql
psql -U addabaaz -d addabaaz -f ../db/postgresql/V1__schema.sql
psql -U addabaaz -d addabaaz -f ../db/postgresql/V2__seed_content.sql   # the migrated catalogue
psql -U addabaaz -d addabaaz -f ../db/postgresql/V3__seed_ott.sql       # roles + plans
```

See `../db/README.md` for details. `spring.jpa.hibernate.ddl-auto` is `none` — the
schema is owned by those scripts, Hibernate never touches it.

## 2. Configure

Everything has a working default for local development; override with environment
variables when deploying.

| Variable | Default | Meaning |
|---|---|---|
| `DB_URL` | `jdbc:postgresql://localhost:5432/addabaaz?stringtype=unspecified` | JDBC URL — keep `stringtype=unspecified`, it lets Hibernate write the `jsonb` settings column |
| `DB_USERNAME` / `DB_PASSWORD` | `addabaaz` / `addabaaz_dev_password` | database credentials |
| `JWT_SECRET` | dev-only value | **must** be ≥ 32 bytes in every real environment |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | placeholders | from the Google Cloud console; needed for “Continue with Google” |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:4200` | Angular origin |
| `FRONTEND_BASE_URL` | `http://localhost:4200` | where the OAuth2 handler redirects after Google sign-in |
| `BOOTSTRAP_ADMIN_*` | `admin@addabaaz.in` / `Admin@123` | first administrator, created on boot if missing |
| `PORT` | `8080` | HTTP port |

Google console → Credentials → OAuth client ID (Web application), authorised
redirect URI `http://localhost:8080/login/oauth2/code/google`.

## 3. Run

```bash
cd backend
./mvnw spring-boot:run          # or: mvn spring-boot:run
# package for deployment
mvn clean package && java -jar target/addabaaz-api.jar
```

Then start the site (`cd ../frontend && npm start`) — it proxies `/api` to port 8080.

First admin login: `admin@addabaaz.in` / `Admin@123` (change it immediately).

## Authentication

* `POST /api/auth/register` → access + refresh token
* `POST /api/auth/login` → access + refresh token
* `POST /api/auth/refresh` → rotates the refresh token (old one is revoked; replaying it kills the whole token family)
* `POST /api/auth/logout` / `/logout-all`
* `GET /oauth2/authorization/google` → Google sign-in; the handler redirects back to
  `{frontend}/oauth2/callback?accessToken=…&refreshToken=…`
* Access tokens are HS256 JWTs (15 min). Refresh tokens are opaque 256-bit values,
  stored **hashed** (SHA-256) for 30 days.

Send `Authorization: Bearer <access-token>` on every `/api/me/**` call.

## Endpoints

Public (no token):

```
GET  /api/health
GET  /api/home                              banners + shows (with episodes) + promos + posters
GET  /api/shows                             GET  /api/shows/{key}
GET  /api/shows/{key}/episodes              GET  /api/shows/{key}/episodes/{episodeId}
GET  /api/promos?kind=PROMO                 GET  /api/promos/{id}
GET  /api/posters?kind=UPCOMING|BTS         GET  /api/banners
GET  /api/team                              GET  /api/services
GET  /api/settings                          GET  /api/settings/{key}
GET  /api/plans                             GET  /api/shows/{key}/reviews
GET  /api/shows/{key}/rating                GET  /api/contact/captcha
POST /api/contact/inquiries
```

Signed in:

```
GET    /api/me                              user + profiles + subscription
GET    /api/me/profiles                     POST   /api/me/profiles
DELETE /api/me/profiles/{id}
GET    /api/me/watchlist                    POST   /api/me/watchlist   {showKey}
DELETE /api/me/watchlist/{showKey}
GET    /api/me/continue-watching            POST   /api/me/progress
DELETE /api/me/continue-watching/{id}       GET    /api/me/history
GET    /api/me/devices                      DELETE /api/me/devices/{id}
GET    /api/me/reviews                      GET    /api/me/ratings/{key}
PUT    /api/shows/{key}/rating  {score}     DELETE /api/shows/{key}/rating
POST   /api/shows/{key}/reviews             DELETE /api/reviews/{id}
GET    /api/me/subscription                 POST   /api/me/subscription {planCode}
POST   /api/me/subscription/cancel          GET    /api/me/payments
```

Admin (`ROLE_ADMIN`):

```
POST/PUT/DELETE /api/admin/shows[/{key}]            POST /api/admin/shows/{key}/episodes
PUT/DELETE      /api/admin/shows/{key}/episodes/{externalId}
POST            /api/admin/shows/{key}/episodes:replace
POST/PUT/DELETE /api/admin/promos[/{externalId}]    POST/PUT/DELETE /api/admin/posters[/{id}]
POST/PUT/DELETE /api/admin/banners[/{id}]           POST/PUT/DELETE /api/admin/team[/{id}]
POST/PUT/DELETE /api/admin/services[/{id}]          PUT/DELETE      /api/admin/settings/{key}
GET/PATCH       /api/admin/users[/{id}]             POST /api/admin/users/{id}/revoke-sessions
GET/PATCH/DELETE /api/admin/inquiries[/{id}]
```

## Notes

* Passwords are BCrypt hashed; a Google-only account has no password until it sets one.
* The payment call is stubbed: `POST /api/me/subscription` records a `PAID` payment so
  the flow can be exercised locally. Drop the Razorpay/Stripe verification in
  `BillingService.subscribe()` before going live.
* The CAPTCHA image is rendered on the server (`CaptchaService`); only the SHA-256 hash
  of the code is stored, and a wrong or replayed answer invalidates the challenge.
* Expired CAPTCHAs and refresh tokens are purged every 30 minutes by `MaintenanceJob`,
  which also flips lapsed subscriptions to `EXPIRED`.
