-- Admin-uploaded images and subtitles, stored in MySQL so they survive restarts, redeploys and extra servers.
-- The UPLOAD_DIR folder is now only a local cache of these rows: on a host with a throw-away disk (Render's free plan, a Hostinger
-- redeploy) it starts empty, and any file that is missing from it is served from this table instead.
-- `name` is content-hash based; paired artwork may add `-hq` and `-low` rendition suffixes tied to the same image hash.
CREATE TABLE uploaded_files (
  name         VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  bytes        INT UNSIGNED NOT NULL,
  data         MEDIUMBLOB NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
