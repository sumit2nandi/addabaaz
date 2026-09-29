-- ADDABAAZ schema v1 — MySQL 5.7+ / 8.x, InnoDB, utf8mb4.
-- All timestamps are stored in UTC (DATETIME(3)).
-- Catalog content (shows, episodes, ...) lives in data/catalog.json, so tables reference catalog ids by value.

-- Accounts. `id` is a UUID string. E-mails are unique (stored lower-case). Passwords are hashed with scrypt, never stored in clear text.
-- (Later migrations add social login, admin role, session versions, e-mail verification and the parental PIN.)
CREATE TABLE users (
  id            CHAR(36)     NOT NULL,
  email         VARCHAR(254) NOT NULL,
  name          VARCHAR(60)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Viewer profiles inside one account (like Netflix). Deleting the account deletes its profiles (ON DELETE CASCADE).
-- `color` picks an avatar colour from a fixed palette.
CREATE TABLE profiles (
  id         CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  name       VARCHAR(24) NOT NULL,
  color      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_profiles_user (user_id, created_at),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "My List". item_type/item_id point at catalog.json (show | video | upcoming). item_id is case-sensitive (YouTube ids).
CREATE TABLE list_items (
  profile_id CHAR(36)    NOT NULL,
  item_type  ENUM('show','video','upcoming') NOT NULL,
  item_id    VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  added_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (profile_id, item_type, item_id),
  KEY ix_list_profile_added (profile_id, added_at),
  CONSTRAINT fk_list_profile FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Continue Watching: one row per (profile, video).
CREATE TABLE watch_progress (
  profile_id   CHAR(36)    NOT NULL,
  video_id     VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  position_sec INT UNSIGNED NOT NULL DEFAULT 0,
  duration_sec INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (profile_id, video_id),
  KEY ix_progress_recent (profile_id, updated_at),
  CONSTRAINT fk_progress_profile FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Remind me" for Coming Soon titles.
CREATE TABLE reminders (
  profile_id  CHAR(36)    NOT NULL,
  upcoming_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (profile_id, upcoming_id),
  CONSTRAINT fk_reminders_profile FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No row = free plan.
-- One row per user with their plan; the plan id refers to server/src/plans.js. (003_payments.sql adds the expiry date.)
CREATE TABLE subscriptions (
  user_id     CHAR(36)    NOT NULL,
  plan_id     VARCHAR(40) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  provider    VARCHAR(30) NULL,
  is_demo     TINYINT(1)  NOT NULL DEFAULT 0,
  started_at  DATETIME(3) NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_subs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages sent through the public Contact form.
CREATE TABLE contact_messages (
  id         CHAR(36)     NOT NULL,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(254) NOT NULL,
  phone      VARCHAR(40)  NOT NULL DEFAULT '',
  message    TEXT         NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_contact_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
