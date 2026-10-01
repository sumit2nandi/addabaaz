-- Track manually imported YouTube catalog items so admins can undo one import or remove today's imports.
-- Rows intentionally survive catalog deletion as an audit trail; active catalog rows are checked before removal.
CREATE TABLE youtube_import_items (
  batch_id    CHAR(36) NOT NULL,
  video_id    VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  actor       VARCHAR(254) NOT NULL,
  imported_at DATETIME(3) NOT NULL,
  PRIMARY KEY (batch_id, video_id),
  KEY ix_youtube_imported_at (imported_at),
  KEY ix_youtube_batch_time (batch_id, imported_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
