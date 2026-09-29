-- Admin console: admin accounts, database-backed catalog, message triage, audit log.

ALTER TABLE users
  ADD COLUMN is_admin    TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN disabled_at DATETIME(3) NULL,
  ADD KEY ix_users_created (created_at);

ALTER TABLE contact_messages
  ADD COLUMN handled_at DATETIME(3)  NULL,
  ADD COLUMN handled_by VARCHAR(254) NULL;

-- The catalog (shows, episodes/reels/clips, coming soon, gallery, studio profile) — one JSON document per item, in the
-- exact shape of data/catalog.json, so the public API and the static export stay identical. Seeded once from the file.
CREATE TABLE catalog_items (
  type       ENUM('show','video','upcoming','gallery','studio') NOT NULL,
  id         VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  position   INT UNSIGNED NOT NULL DEFAULT 0,
  doc        JSON         NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (type, id),
  KEY ix_catalog_position (type, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 'version' is bumped on every catalog write (servers compare it to refresh their cache); 'seeded' = imported from the file.
CREATE TABLE catalog_meta (
  k  VARCHAR(30) NOT NULL,
  n  BIGINT      NOT NULL DEFAULT 0,
  at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO catalog_meta (k, n) VALUES ('version', 0);

CREATE TABLE admin_audit (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_id  CHAR(36)     NULL,
  actor     VARCHAR(254) NOT NULL,
  action    VARCHAR(60)  NOT NULL,
  target    VARCHAR(200) NULL,
  meta      JSON         NULL,
  ip        VARCHAR(45)  NULL,
  PRIMARY KEY (id),
  KEY ix_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
