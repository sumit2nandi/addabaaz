-- Legacy admin-uploaded images and all subtitle uploads, retained in MySQL for compatibility and durability.
-- New catalog and Broadcast photos are stored in private R2; UPLOAD_DIR remains a local cache for legacy image/subtitle rows.
-- `name` is content-hash based; historical paired artwork may add `-hq` and `-low` rendition suffixes tied to the same image hash.
CREATE TABLE uploaded_files (
  name         VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  bytes        INT UNSIGNED NOT NULL,
  data         MEDIUMBLOB NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
