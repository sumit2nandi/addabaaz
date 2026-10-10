-- Broadcast notifications (Admin → Notifications).
--
-- 1. push_devices: the tokens the native Android/iOS apps register for real app push (FCM/APNs).
--    These are separate from push_subscriptions, which hold BROWSER Web-Push subscriptions.
-- 2. campaigns: one row per broadcast the admin sent (push or email) with live progress, so the
--    console can show what went out, to whom, and how it went.
-- 3. users.email_opt_out_at: set when someone clicks the unsubscribe link in a campaign email;
--    transactional mail (receipts, password resets) is not affected.

CREATE TABLE IF NOT EXISTS push_devices (
  id            CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  platform      ENUM('android','ios','web') NOT NULL DEFAULT 'android',
  token_hash    CHAR(64)     NOT NULL,
  token         VARCHAR(512) NOT NULL,
  label         VARCHAR(120) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  fail_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_token (token_hash),
  KEY ix_device_user (user_id),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaigns (
  id          CHAR(36)     NOT NULL,
  channel     ENUM('push','email') NOT NULL,
  audience    VARCHAR(120) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT         NOT NULL,
  url         VARCHAR(300) NULL,
  button      VARCHAR(80)  NULL,
  status      ENUM('queued','sending','sent','partial','failed','cancelled') NOT NULL DEFAULT 'queued',
  total       INT UNSIGNED NOT NULL DEFAULT 0,
  sent        INT UNSIGNED NOT NULL DEFAULT 0,
  failed      INT UNSIGNED NOT NULL DEFAULT 0,
  skipped     INT UNSIGNED NOT NULL DEFAULT 0,
  page_cursor INT UNSIGNED NOT NULL DEFAULT 0,   -- e-mail paging: how many accounts have been mailed so far
  is_test     TINYINT(1)   NOT NULL DEFAULT 0,
  error       VARCHAR(300) NULL,
  created_by  VARCHAR(254) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_campaign_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN email_opt_out_at DATETIME(3) NULL;
