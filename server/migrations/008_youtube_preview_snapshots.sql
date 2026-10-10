-- Short-lived, multi-instance-safe snapshots for the admin's full-channel YouTube preview.
-- The signed browser token contains only snapshot_id + expiry; upload details stay server-side.
CREATE TABLE youtube_preview_snapshots (
  snapshot_id CHAR(36) NOT NULL,
  actor       VARCHAR(254) NOT NULL,
  checked_at  DATETIME(3) NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  videos      JSON NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (snapshot_id),
  KEY ix_youtube_preview_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
