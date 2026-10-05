# Database (MySQL)

User data and the live catalog (shows, videos, upcoming, gallery) are stored in **MySQL 5.7+ or 8.x** (InnoDB, `utf8mb4`, UTC timestamps). `data/catalog.json` is the one-time seed and static-mode fallback; catalog references in other tables use ids validated by the API on write.

## Schema

```
users ──< profiles ──< list_items        (My List:   PK profile_id, item_type, item_id)
   │           ├─────< watch_progress    (Continue watching: PK profile_id, video_id)
   │           └─────< reminders         (Coming-soon reminders: PK profile_id, upcoming_id)
   ├── auth_identities                   (linked Google / Facebook accounts: PK provider, subject)
   ├── subscriptions                     (1:1, no row = free plan)
   ├── payments ──< refunds              (kept if the user is deleted; user_id → NULL)
   │       └──< invoices                 (tax invoices + credit notes; numbered per financial year)

contact_messages                         (standalone inbox for the Contact form; handled_at/by set from the admin console)
catalog_items, catalog_meta              (the catalog: one JSON document per show/video/upcoming/gallery/studio; edited in /admin)
uploaded_files                           (admin-uploaded images and subtitles, stored as binary; the upload folder is only a cache of these)
youtube_import_items                     (YouTube import batches; retained to support safe undo/removal)
youtube_preview_snapshots                (15-minute full-channel preview snapshots for multi-instance-safe imports)
admin_audit                              (append-only log of admin actions)
database_monitor_samples                (one-minute, retention-limited samples for the admin database history charts)
app_settings                            (server-side key/value settings, including monitor-history retention)
schema_migrations                        (applied migration files)
```

| Table | Columns |
|---|---|
| `users` | `id` CHAR(36) PK · `email` VARCHAR(254) **UNIQUE** · `name` · `password_hash` (scrypt; **NULL** for accounts created with Google/Facebook) · `created_at` |
| `auth_identities` | `provider` ENUM(google, facebook) · `subject` (provider's user id, case-sensitive) · `user_id` FK→users · `email` · `created_at` · `last_login_at` — PK (provider, subject) |
| `profiles` | `id` PK · `user_id` FK→users · `name` VARCHAR(24) · `color` · `created_at` |
| `list_items` | `profile_id` FK · `item_type` ENUM(show, video, upcoming) · `item_id` (case-sensitive) · `added_at` |
| `watch_progress` | `profile_id` FK · `video_id` (case-sensitive) · `position_sec` · `duration_sec` · `updated_at` — capped at the 500 most recent rows per profile |
| `reminders` | `profile_id` FK · `upcoming_id` · `created_at` |
| `subscriptions` | `user_id` PK/FK · `plan_id` · `status` · `provider` · `is_demo` · `started_at` · **`expires_at`** (prepaid access ends here; past = treated as free) · `updated_at` |
| `payments` | `id` PK · `user_id` FK→users **ON DELETE SET NULL** (kept for accounting) · `plan_id` · `provider` · `provider_order_id` / `provider_payment_id` (each UNIQUE per provider → a payment can only ever be applied once) · `amount_paise` · `currency` · `status` ENUM(created, paid, failed) · `created_at` · `paid_at` |
| `coupons` | `code` PK · `kind` ENUM(percent, flat) · `value` (percent, or paise) · `plan_ids` · `max_redemptions` · `per_user_limit` · `starts_at` / `expires_at` · `active`. Redemptions are counted from `payments.coupon_code` |
| `refunds` | `id` PK · `payment_id` FK · `provider_refund_id` **UNIQUE** (a refund event is applied once) · `amount_paise` · `status` ENUM(pending, processed, failed) · `source` ENUM(admin, provider) · `revoked_access` |
| `invoices` | `id` PK · `number` **UNIQUE** (e.g. `AB/2627/000001`) · `kind` ENUM(invoice, credit_note) · `doc_key` **UNIQUE** (one invoice per payment, one credit note per refund) · `payment_id` / `refund_id` / `parent_id` · `user_id` FK **ON DELETE SET NULL** · `fy` · `issued_at` · `taxable_paise` / `cgst_paise` / `sgst_paise` / `igst_paise` / `total_paise` · `gst_rate` · `doc` JSON (seller & buyer snapshot) |
| `invoice_counters` | `(series, fy)` PK · `last_no` — row-locked while numbering, so numbers are gapless |
| `catalog_items` | `(type, id)` PK · `position` (display order) · `doc` JSON — the item exactly as in `data/catalog.json`; video docs may include `hidden: true` to keep them admin-visible but exclude them from public catalogs. Seeded once from the file |
| `youtube_preview_snapshots` | `snapshot_id` PK · `actor` · `checked_at` · `expires_at` · `videos` JSON — temporary complete-channel preview used by imports; expired rows are reaped on the next preview |
| `catalog_meta` | `k` PK · `n` — `version` (bumped on every catalog write; servers compare it to refresh their cache) and `seeded` |
| `uploaded_files` | `name` PK (content-hash file name, e.g. `3f9c…e1.webp`) · `content_type` · `bytes` · `data` MEDIUMBLOB · `created_at` UTC — served at `/uploads/<name>` whenever the file is not in the local upload folder; catalog documents refer to it as `uploads/<name>` |
| `youtube_import_items` | `(batch_id, video_id)` PK · `actor` · `imported_at` UTC; retained after catalog deletion so admin can undo the last batch or remove today's imports |
| `admin_audit` | `id` PK · `at` · `actor_id` / `actor` (email, or `token`) · `action` · `target` · `meta` JSON · `ip` |
| `database_monitor_samples` | UTC minute bucket (PK) · estimated schema data/index/row metrics · server-wide buffer-pool and connection gauges · counter deltas used to derive per-minute SQL activity; retention is configurable in Admin → System → Database (default 7 days, maximum 30) |
| `app_settings` | `k` PK · `v` · `updated_at` — server-side settings such as database-monitor history retention |
| `users` (additions) | `is_admin` · `disabled_at` (a disabled user is refused everywhere) · `email_opt_out_at` (set when someone clicks the unsubscribe link in a broadcast e-mail; campaign audiences skip them) · **`email_norm` UNIQUE** (the normalized address — one address = one account) · `email_dup` (this row is a duplicate of an older account — it gets listed in Admin → Users to merge and its `email_norm` stays NULL so the unique index can be created) |
| `push_subscriptions` | one row per browser/device that allowed Web Push · `endpoint_hash` UNIQUE · `p256dh` · `auth` · preference flags `episodes`/`launches`/`news` (all on by default since migration 020) · `last_ok_at` · `fail_count` (deleted after 5 failures) |
| `push_devices` | one row per **native app** installation (FCM token) · nullable `user_id` FK→users (NULL for guests) · `platform` ENUM(android,ios,web) · `token_hash` UNIQUE · `token` · `label` · the same preference flags as a browser subscription (`episodes`/`launches`/`news`, migration 019; all on by default since migration 020) · `last_seen` · `fail_count`; idle tokens are purged after 180 days, unregistered ones are deleted on the next send |
| `campaigns` | one row per Admin → Broadcast send: `channel` ENUM(push,email) · `audience` · `title` · `body` · `url` · `button` · `status` ENUM(queued,sending,sent,partial,failed,cancelled) · `total`/`sent`/`failed`/`skipped` (live progress) · `page_cursor` (e-mail paging, so an interrupted send resumes) · `error` · `created_by` · timestamps |
| `notify_sent` | `(kind, ref, user_id)` PK — makes automatic notifications at-most-once across restarts and instances |
| `contact_messages` | `id` PK · `name` · `email` · `phone` · `message` TEXT · `created_at` |

All foreign keys are `ON DELETE CASCADE` (except `payments.user_id` and `invoices.user_id`, which become NULL so payment and tax records survive account deletion), so `DELETE /me` (account deletion, required by the app stores) removes everything belonging to the user in one statement. Ids are UUID v4 strings. Video/list ids use `utf8mb4_bin` because YouTube ids are case-sensitive. Full DDL: [`001_init.sql`](../server/migrations/001_init.sql), social login in [`002_social_login.sql`](../server/migrations/002_social_login.sql), payments in [`003_payments.sql`](../server/migrations/003_payments.sql), coupons/invoices/refunds in [`004_billing.sql`](../server/migrations/004_billing.sql), YouTube import tracking in [`007_youtube_imports.sql`](../server/migrations/007_youtube_imports.sql), full-channel preview snapshots in [`008_youtube_preview_snapshots.sql`](../server/migrations/008_youtube_preview_snapshots.sql), video-deletion lookup indexes in [`009_bulk_video_delete_indexes.sql`](../server/migrations/009_bulk_video_delete_indexes.sql), broadcast notifications in [`011_notifications.sql`](../server/migrations/011_notifications.sql), the normalized e-mail index in [`012_email_norm.sql`](../server/migrations/012_email_norm.sql), and historical database-monitor samples in [`027_database_monitor_history.sql`](../server/migrations/027_database_monitor_history.sql). `payments` also gained `list_price_paise`, `discount_paise`, `coupon_code`, `billing` (buyer name/state/GSTIN snapshot), `refunded_paise`.

Concurrency: the unique email index makes simultaneous sign-ups safe; the 5-profile limit and "can't delete your last profile" rules run in transactions that lock the user row; progress uses `INSERT … ON DUPLICATE KEY UPDATE`.

## Configuration

Set either `DATABASE_URL=mysql://user:pass@host:3306/addabaaz` or `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`. Extras: `DB_SSL=true` (managed MySQL; `DB_SSL_CA_FILE`/`DB_SSL_CA` for providers with their own CA, e.g. Aiven), `DB_POOL_SIZE`, `DB_CREATE=true` (create the database on start), `DB_MIGRATE=false` (skip auto-migrate). See [`.env.example`](../.env.example).

Create a dedicated least-privilege user:

```sql
CREATE DATABASE addabaaz CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'addabaaz'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON addabaaz.* TO 'addabaaz'@'%';
-- CREATE/ALTER/INDEX/REFERENCES are only needed by migrations; if you run `npm run db:migrate`
-- with a separate admin account (DB_MIGRATE=false for the app), the app user needs just the first four.
```

## Migrations

- Files live in `server/migrations/NNN_description.sql` and are applied **in order, once each**, recorded in `schema_migrations`.
- They run automatically on server start (guarded by a MySQL advisory lock, so several instances can boot together) or explicitly with `npm run db:migrate`.
- Never edit an applied migration — add a new file (`002_add_devices.sql`, …). MySQL DDL isn't transactional, so keep migrations small.

## Operations

- **Backups:** `npm run backup` (pure Node, encrypted option, R2 copy, verified restore — see `docs/ENGAGEMENT.md`), or `mysqldump --single-transaction --routines addabaaz | gzip > addabaaz-$(date +%F).sql.gz` daily, or enable your provider's automated backups + PITR. Test a restore.
- **Health:** `GET /api/v1/health` (liveness, includes `db: up|down`) and `GET /api/v1/health/ready` (503 when MySQL is unreachable).
- **Inspect:** `SELECT COUNT(*) FROM users;` · newest contact enquiries: `SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 20;`
- **Privacy:** passwords are only stored as scrypt hashes; deleting an account deletes its rows (cascade). Keep backups' retention in line with your privacy policy.

## Tests

`npm test` runs the API integration tests against a real MySQL server: set `TEST_DATABASE_URL=mysql://user:pass@host:3306` (default `mysql://root@127.0.0.1:3306`). Each run creates a throw-away `addabaaz_test_*` database, runs the migrations, and drops it afterwards — the account needs `CREATE`/`DROP` on `addabaaz\_test%`. CI uses a `mysql:8.0` service container.
