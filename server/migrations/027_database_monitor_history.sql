-- One minute of low-cardinality MySQL/schema metrics per sample. The primary key doubles as the time-range index;
-- the minute bucket means multiple app instances cannot duplicate the same sample.
CREATE TABLE IF NOT EXISTS database_monitor_samples (
  sampled_at                    DATETIME(3)      NOT NULL,
  total_storage_bytes           BIGINT UNSIGNED  NOT NULL,
  data_bytes                    BIGINT UNSIGNED  NOT NULL,
  index_bytes                   BIGINT UNSIGNED  NOT NULL,
  estimated_rows                BIGINT UNSIGNED  NULL,
  table_count                   INT UNSIGNED     NOT NULL,
  buffer_pool_capacity_bytes    BIGINT UNSIGNED  NULL,
  buffer_pool_used_bytes        BIGINT UNSIGNED  NULL,
  buffer_pool_hit_rate_pct      DECIMAL(7,3)     NULL,
  connections_current           INT UNSIGNED     NULL,
  connections_running           INT UNSIGNED     NULL,
  connections_max               INT UNSIGNED     NULL,
  queries_since_restart         BIGINT UNSIGNED  NULL,
  slow_queries_since_restart    BIGINT UNSIGNED  NULL,
  disk_tmp_tables_since_restart BIGINT UNSIGNED  NULL,
  queries_delta                 BIGINT UNSIGNED  NULL,
  slow_queries_delta            BIGINT UNSIGNED  NULL,
  disk_tmp_tables_delta         BIGINT UNSIGNED  NULL,
  sample_interval_seconds       INT UNSIGNED     NOT NULL DEFAULT 0,
  PRIMARY KEY (sampled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
