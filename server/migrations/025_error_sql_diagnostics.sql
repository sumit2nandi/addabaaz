-- Keep a safe SQL template on server error reports, without storing bound values.
SET @error_sql_query_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE error_log ADD COLUMN sql_query TEXT NULL AFTER stack',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'error_log'
    AND COLUMN_NAME = 'sql_query'
);
PREPARE error_sql_query_stmt FROM @error_sql_query_ddl;
EXECUTE error_sql_query_stmt;
DEALLOCATE PREPARE error_sql_query_stmt;

-- Parameter count is useful for debugging; parameter values are intentionally never written.
SET @error_sql_params_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE error_log ADD COLUMN sql_param_count SMALLINT UNSIGNED NULL AFTER sql_query',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'error_log'
    AND COLUMN_NAME = 'sql_param_count'
);
PREPARE error_sql_params_stmt FROM @error_sql_params_ddl;
EXECUTE error_sql_params_stmt;
DEALLOCATE PREPARE error_sql_params_stmt;
