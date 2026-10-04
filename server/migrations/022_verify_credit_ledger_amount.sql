-- Re-check the credit amount column even when 021 was already recorded. This is a safe no-op on
-- healthy databases and repairs a later restore/schema drift that brought back the older table shape.
SET @credit_amount_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE user_credit ADD COLUMN amount_paise INT NOT NULL DEFAULT 0',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_credit'
    AND COLUMN_NAME = 'amount_paise'
);
PREPARE credit_amount_stmt FROM @credit_amount_ddl;
EXECUTE credit_amount_stmt;
DEALLOCATE PREPARE credit_amount_stmt;

-- Keep any still-spendable legacy grants usable if the original movement amount was missing.
UPDATE user_credit
SET amount_paise = remaining_paise
WHERE amount_paise = 0 AND remaining_paise > 0;
