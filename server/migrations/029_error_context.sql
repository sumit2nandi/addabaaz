-- Keep the original message/stack fields while making request, runtime and structured client details searchable.
-- Every addition is guarded so a partially applied DDL change is safe to retry manually.
-- Dynamic DDL is kept in single-quoted string literals: with ANSI_QUOTES enabled MySQL reads a
-- double-quoted token as an identifier, so the earlier double-quoted form failed with
-- Unknown column 'ALTER TABLE ...' in 'field list'. Inner single quotes are doubled instead.
SET @error_severity_ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE error_log ADD COLUMN severity ENUM(''warning'',''error'',''fatal'') NOT NULL DEFAULT ''error'' AFTER source',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'severity'
);
PREPARE error_severity_stmt FROM @error_severity_ddl;
EXECUTE error_severity_stmt;
DEALLOCATE PREPARE error_severity_stmt;

SET @error_name_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN error_name VARCHAR(128) NULL AFTER message', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'error_name'
);
PREPARE error_name_stmt FROM @error_name_ddl;
EXECUTE error_name_stmt;
DEALLOCATE PREPARE error_name_stmt;

SET @error_code_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN error_code VARCHAR(128) NULL AFTER error_name', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'error_code'
);
PREPARE error_code_stmt FROM @error_code_ddl;
EXECUTE error_code_stmt;
DEALLOCATE PREPARE error_code_stmt;

SET @error_status_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN http_status SMALLINT UNSIGNED NULL AFTER error_code', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'http_status'
);
PREPARE error_status_stmt FROM @error_status_ddl;
EXECUTE error_status_stmt;
DEALLOCATE PREPARE error_status_stmt;

SET @error_method_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN http_method VARCHAR(12) NULL AFTER http_status', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'http_method'
);
PREPARE error_method_stmt FROM @error_method_ddl;
EXECUTE error_method_stmt;
DEALLOCATE PREPARE error_method_stmt;

SET @error_request_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN request_id VARCHAR(64) NULL AFTER http_method', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'request_id'
);
PREPARE error_request_stmt FROM @error_request_ddl;
EXECUTE error_request_stmt;
DEALLOCATE PREPARE error_request_stmt;

SET @error_release_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN release_id VARCHAR(64) NULL AFTER request_id', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'release_id'
);
PREPARE error_release_stmt FROM @error_release_ddl;
EXECUTE error_release_stmt;
DEALLOCATE PREPARE error_release_stmt;

SET @error_environment_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN environment VARCHAR(32) NULL AFTER release_id', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'environment'
);
PREPARE error_environment_stmt FROM @error_environment_ddl;
EXECUTE error_environment_stmt;
DEALLOCATE PREPARE error_environment_stmt;

SET @error_instance_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN instance_id CHAR(36) NULL AFTER environment', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'instance_id'
);
PREPARE error_instance_stmt FROM @error_instance_ddl;
EXECUTE error_instance_stmt;
DEALLOCATE PREPARE error_instance_stmt;

SET @error_details_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD COLUMN details JSON NULL AFTER instance_id', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND COLUMN_NAME = 'details'
);
PREPARE error_details_stmt FROM @error_details_ddl;
EXECUTE error_details_stmt;
DEALLOCATE PREPARE error_details_stmt;

-- Browsers can send long user-agent strings (native WebViews in particular); retain the full value.
ALTER TABLE error_log MODIFY COLUMN user_agent VARCHAR(512) NOT NULL DEFAULT '';

SET @error_request_index_ddl = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE error_log ADD KEY ix_errors_request_id (request_id)', 'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_log' AND INDEX_NAME = 'ix_errors_request_id'
);
PREPARE error_request_index_stmt FROM @error_request_index_ddl;
EXECUTE error_request_index_stmt;
DEALLOCATE PREPARE error_request_index_stmt;
