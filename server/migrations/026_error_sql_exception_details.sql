-- Store the safe structured MySQL exception metadata separately from its SQL template and stack.
-- Do not persist mysql2's `err.sql`: it may contain interpolated bound values.
SET @error_sql_exception_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE error_log ADD COLUMN sql_exception TEXT NULL AFTER sql_param_count',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'error_log'
    AND COLUMN_NAME = 'sql_exception'
);
PREPARE error_sql_exception_stmt FROM @error_sql_exception_ddl;
EXECUTE error_sql_exception_stmt;
DEALLOCATE PREPARE error_sql_exception_stmt;
