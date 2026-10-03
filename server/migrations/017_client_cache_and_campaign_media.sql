-- Two small additions that share one migration:
--
-- 1. app_settings — a tiny key/value table for server-side flags. Its first tenant is the "clear client
--    cache" button in the admin console: bumping `client_cache_version` makes every browser and installed
--    app that checks in drop its cached files (see app/js/cache.js). Read with GET /api/v1/client-version.
-- 2. campaigns.image_url / image_alt — an optional image attached to a broadcast: shown in the browser /
--    app notification (rich push) and inserted at the top of the e-mail (Admin → Broadcast).

CREATE TABLE IF NOT EXISTS app_settings (
  k          VARCHAR(64)  NOT NULL,
  v          VARCHAR(255) NOT NULL,
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (k, v) VALUES ('client_cache_version', '1');

ALTER TABLE campaigns
  ADD COLUMN image_url VARCHAR(500) NULL AFTER button,
  ADD COLUMN image_alt VARCHAR(200) NULL AFTER image_url;
