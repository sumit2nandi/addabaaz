-- Account safety (password reset, email verification, PIN), Sign in with Apple, kids profiles, ratings & comments,
-- web push, playback sessions (device limit), analytics, refund requests, error log.

ALTER TABLE users
  ADD COLUMN email_verified_at  DATETIME(3)  NULL,
  ADD COLUMN session_version    INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN parental_pin_hash  VARCHAR(255) NULL,
  ADD COLUMN pin_failed         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN pin_locked_until   DATETIME(3)  NULL;

-- Accounts created through Google/Facebook already have a provider-verified email.
UPDATE users SET email_verified_at = created_at WHERE password_hash IS NULL;

ALTER TABLE auth_identities MODIFY provider ENUM('google','facebook','apple') NOT NULL;

ALTER TABLE profiles ADD COLUMN kids TINYINT(1) NOT NULL DEFAULT 0;

-- One-time links: password reset and email verification. Only a SHA-256 of the token is stored.
CREATE TABLE auth_tokens (
  token_hash CHAR(64)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  purpose    ENUM('reset','verify') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at    DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY ix_tokens_user (user_id, purpose, created_at),
  CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thumbs up (1) / down (-1) per profile.
CREATE TABLE ratings (
  profile_id CHAR(36)    NOT NULL,
  item_type  ENUM('show','video') NOT NULL,
  item_id    VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  value      TINYINT     NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (profile_id, item_type, item_id),
  KEY ix_ratings_item (item_type, item_id),
  CONSTRAINT fk_ratings_profile FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Moderated comments on videos. Reports auto-hide a comment until an admin reviews it.
CREATE TABLE comments (
  id            CHAR(36)     NOT NULL,
  video_id      VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  author        VARCHAR(24)  NOT NULL,
  body          VARCHAR(1000) NOT NULL,
  status        ENUM('visible','hidden') NOT NULL DEFAULT 'visible',
  reports       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  hidden_reason VARCHAR(60)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_comments_video (video_id, status, created_at),
  KEY ix_comments_review (status, reports),
  KEY ix_comments_user (user_id, created_at),
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comment_reports (
  comment_id CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (comment_id, user_id),
  CONSTRAINT fk_creports_comment FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Web Push subscriptions (one per browser/device).
CREATE TABLE push_subscriptions (
  id            CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  endpoint_hash CHAR(64)     NOT NULL,
  endpoint      TEXT         NOT NULL,
  p256dh        VARCHAR(200) NOT NULL,
  auth          VARCHAR(100) NOT NULL,
  episodes      TINYINT(1)   NOT NULL DEFAULT 1,
  launches      TINYINT(1)   NOT NULL DEFAULT 1,
  news          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_ok_at    DATETIME(3)  NULL,
  fail_count    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY ix_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Makes automatic notifications idempotent: (kind, ref, user) is sent at most once.
CREATE TABLE notify_sent (
  kind       VARCHAR(20) NOT NULL,
  ref        VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (kind, ref, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who is watching right now (concurrent-stream limit) and which devices used the account.
CREATE TABLE playback_sessions (
  user_id      CHAR(36)    NOT NULL,
  device_id    VARCHAR(64) NOT NULL,
  device_label VARCHAR(80) NOT NULL DEFAULT '',
  video_id     VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  started_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, device_id),
  KEY ix_playback_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily aggregates: plays and watch seconds per video (no personal data).
CREATE TABLE play_stats (
  day      DATE        NOT NULL,
  video_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  show_id  VARCHAR(64) NULL,
  plays    INT UNSIGNED NOT NULL DEFAULT 0,
  seconds  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (day, video_id),
  KEY ix_stats_show (show_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE refund_requests (
  id         CHAR(36)     NOT NULL,
  payment_id VARCHAR(64)  NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  reason     VARCHAR(500) NOT NULL DEFAULT '',
  status     ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
  admin_note VARCHAR(500) NULL,
  decided_by VARCHAR(254) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_refreq_status (status, created_at),
  KEY ix_refreq_payment (payment_id),
  KEY ix_refreq_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE error_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source     ENUM('server','client') NOT NULL,
  message    VARCHAR(500) NOT NULL,
  stack      TEXT         NULL,
  url        VARCHAR(300) NOT NULL DEFAULT '',
  user_agent VARCHAR(200) NOT NULL DEFAULT '',
  user_id    CHAR(36)     NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_errors_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
